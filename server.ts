import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface SyncedModelItem {
  id: string;
  label: string;
  ownedBy: string;
  contextWindow?: number;
}

interface InboundAgentTask {
  id: string;
  workspaceId: string;
  title: string;
  prompt: string;
  sender: string;
  model: string;
  systemPrompt?: string;
  createdAt: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  output?: string;
  thinking?: string;
  error?: string;
}

type WireProtocol = 'openai-chat' | 'openai-responses' | 'anthropic';

const inboxByWorkspace = new Map<string, InboundAgentTask[]>();
const inboxClientsByWorkspace = new Map<string, Set<Response>>();
const hostCookieJar = new Map<string, Map<string, string>>();
const hostWarmupInFlight = new Map<string, Promise<boolean>>();

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const OPENAI_CLIENT_PROFILES: Record<string, string>[] = [
  {
    'User-Agent': 'claude-cli/2.1.92 (external, sdk-cli)',
    'X-App': 'cli',
    'X-Stainless-Helper-Method': 'stream',
    'X-Stainless-Retry-Count': '0',
    'X-Stainless-Runtime-Version': 'v24.14.0',
    'X-Stainless-Package-Version': '0.80.0',
    'X-Stainless-Runtime': 'node',
    'X-Stainless-Lang': 'js',
    'X-Stainless-Arch': 'arm64',
    'X-Stainless-Os': 'Linux',
    'X-Stainless-Timeout': '600',
  },
  {
    'User-Agent': 'codex_cli_rs/0.101.0 (Mac OS; arm64)',
    Originator: 'codex_cli_rs',
    Version: '0.101.0',
  },
  {
    'User-Agent': 'opencode/1.17.12',
  },
];

const AGENTROUTER_OPENAI_MODELS: SyncedModelItem[] = [
  { id: 'gpt-6.1-sol', label: 'gpt-6.1-sol', ownedBy: 'openai' },
  { id: 'gpt-6-astra', label: 'gpt-6-astra', ownedBy: 'openai' },
  { id: 'gpt-5.4-sol', label: 'gpt-5.4-sol', ownedBy: 'openai' },
  { id: 'gpt-6-sol', label: 'gpt-6-sol', ownedBy: 'openai' },
  { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol', ownedBy: 'openai' },
  { id: 'gpt-5-codex', label: 'gpt-5-codex', ownedBy: 'openai' },
  { id: 'gpt-5', label: 'gpt-5', ownedBy: 'openai' },
  { id: 'gpt-4.1', label: 'gpt-4.1', ownedBy: 'openai' },
  { id: 'gpt-4o', label: 'gpt-4o', ownedBy: 'openai' },
  { id: 'o4-mini', label: 'o4-mini', ownedBy: 'openai' },
];

function sanitizeApiKey(raw: string): string {
  return raw
    .trim()
    .replace(/^bearer\s+/i, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim();
}

function sanitizeCookieHeader(raw: string): string {
  return raw
    .trim()
    .replace(/^cookie:\s*/i, '')
    .replace(/[\r\n]+/g, '; ')
    .trim();
}

function extractRequestApiKey(req: Request): string {
  const headerKey = sanitizeApiKey(String(req.headers['x-agentrouter-key'] || ''));
  if (headerKey) return headerKey;

  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return sanitizeApiKey(authHeader.slice(7));
  }

  return '';
}

function extractRequestBaseUrl(req: Request): string {
  const headerBase = String(req.headers['x-agentrouter-base-url'] || '').trim();
  if (headerBase) return headerBase;

  const bodyBase = String(req.body?.baseUrl || '').trim();
  if (bodyBase) return bodyBase;

  return '';
}

function extractRequestWafCookie(req: Request): string {
  const headerCookie = sanitizeCookieHeader(String(req.headers['x-agentrouter-cookie'] || ''));
  if (headerCookie) return headerCookie;

  const bodyCookie = sanitizeCookieHeader(String(req.body?.wafCookie || ''));
  if (bodyCookie) return bodyCookie;

  return '';
}

function getHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isAgentRouterMainHost(urlStr: string): boolean {
  const host = getHostname(urlStr);
  return host === 'agentrouter.org' || host === 'www.agentrouter.org';
}

const WAF_COOKIE_NAMES = new Set(['acw_tc', 'acw_sc__v2', 'acw_sc__v3', 'cdn_sec_tc']);

function recordUpstreamCookies(targetUrl: string, res: globalThis.Response): boolean {
  const host = getHostname(targetUrl);
  if (!host) return false;

  const rawCookies: string[] =
    typeof (res.headers as any).getSetCookie === 'function'
      ? (res.headers as any).getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie')!]
        : [];

  if (rawCookies.length === 0) return false;

  if (!hostCookieJar.has(host)) {
    hostCookieJar.set(host, new Map());
  }
  const jar = hostCookieJar.get(host)!;
  let captured = false;

  for (const line of rawCookies) {
    const firstPair = line.split(';')[0]?.trim();
    if (!firstPair) continue;
    const eqIdx = firstPair.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = firstPair.slice(0, eqIdx).trim();
    const val = firstPair.slice(eqIdx + 1).trim();
    if (name && val && WAF_COOKIE_NAMES.has(name)) {
      jar.set(name, val);
      captured = true;
    }
  }
  return captured;
}

async function warmupHostWaf(targetUrl: string): Promise<boolean> {
  const host = getHostname(targetUrl);
  if (!host) return false;

  const existing = hostWarmupInFlight.get(host);
  if (existing) return existing;

  const task = (async () => {
    try {
      const origin = new URL(targetUrl).origin;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${origin}/`, {
        method: 'GET',
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const gotCookie = recordUpstreamCookies(targetUrl, res);
      const bodyText = await res.text().catch(() => '');
      const solvedJs = trySolveAliyunAcwScV2(targetUrl, bodyText);
      return gotCookie || solvedJs;
    } catch {
      return false;
    } finally {
      hostWarmupInFlight.delete(host);
    }
  })();

  hostWarmupInFlight.set(host, task);
  return task;
}

function buildCookieHeaderForUrl(targetUrl: string, userWafCookie: string): string {
  const host = getHostname(targetUrl);
  const merged = new Map<string, string>();

  if (host && hostCookieJar.has(host)) {
    for (const [k, v] of hostCookieJar.get(host)!.entries()) {
      merged.set(k, v);
    }
  }

  if (userWafCookie) {
    for (const part of userWafCookie.split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        merged.set(trimmed.slice(0, eqIdx).trim(), trimmed.slice(eqIdx + 1).trim());
      }
    }
  }

  if (merged.size === 0) return '';
  return Array.from(merged.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Solves Aliyun WAF dynamic JS `arg1` -> `acw_sc__v2` cookie challenges automatically.
 */
function trySolveAliyunAcwScV2(targetUrl: string, htmlBody: string): boolean {
  const match = htmlBody.match(/arg1\s*=\s*['"]([0-9a-fA-F]{40})['"]/);
  if (!match) return false;

  const arg1 = match[1];
  const posList = [
    15, 35, 29, 24, 33, 16, 1, 38, 10, 9, 19, 31, 40, 27, 22, 23, 25, 13, 6, 11,
    39, 18, 20, 8, 14, 21, 32, 26, 2, 30, 7, 4, 17, 5, 3, 28, 34, 37, 12, 36,
  ];
  const mask = '3000176000856006061501533003690027800375';
  const out: string[] = new Array(posList.length).fill('');

  for (let i = 0; i < arg1.length; i++) {
    const ch = arg1[i];
    for (let j = 0; j < posList.length; j++) {
      if (posList[j] === i + 1) {
        out[j] = ch;
      }
    }
  }

  const unsboxed = out.join('');
  let acwScV2 = '';
  for (let i = 0; i < unsboxed.length && i < mask.length; i += 2) {
    const xorByte =
      parseInt(unsboxed.slice(i, i + 2), 16) ^ parseInt(mask.slice(i, i + 2), 16);
    acwScV2 += xorByte.toString(16).padStart(2, '0');
  }

  const host = getHostname(targetUrl);
  if (!host || !acwScV2) return false;

  if (!hostCookieJar.has(host)) {
    hostCookieJar.set(host, new Map());
  }
  hostCookieJar.get(host)!.set('acw_sc__v2', acwScV2);
  return true;
}

function isHtmlFirewallOrPage(contentType: string, bodySample: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return true;
  const trimmed = bodySample.trimStart().slice(0, 512).toLowerCase();
  return (
    trimmed.startsWith('<!doctype html') ||
    trimmed.startsWith('<html') ||
    trimmed.includes('aliyun_waf') ||
    trimmed.includes('<title>404 not found</title>') ||
    trimmed.includes('<title>just a moment')
  );
}

function normalizeManualBaseUrl(raw: string): {
  v1Urls: string[];
  catalogUrls: string[];
  responsesUrls: string[];
  anthropicMessageUrls: string[];
} {
  let cleaned = raw.trim().replace(/\/+$/, '');
  if (!cleaned) {
    return { v1Urls: [], catalogUrls: [], responsesUrls: [], anthropicMessageUrls: [] };
  }
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }

  cleaned = cleaned
    .replace(/\/v1\/chat\/completions$/i, '/v1')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/v1\/responses$/i, '/v1')
    .replace(/\/responses$/i, '')
    .replace(/\/v1\/messages$/i, '/v1')
    .replace(/\/messages$/i, '')
    .replace(/\/v1\/models$/i, '/v1')
    .replace(/\/models$/i, '')
    .replace(/\/api\/pricing$/i, '')
    .replace(/\/+$/, '');

  const pushUnique = (list: string[], url: string) => {
    if (url && !list.includes(url)) list.push(url);
  };

  const v1Urls: string[] = [];
  if (cleaned.endsWith('/v1')) {
    pushUnique(v1Urls, cleaned);
  } else {
    pushUnique(v1Urls, `${cleaned}/v1`);
    try {
      const parsed = new URL(cleaned);
      if (parsed.pathname && parsed.pathname !== '/') {
        pushUnique(v1Urls, cleaned);
      }
    } catch {
      // Ignore malformed URL fallback
    }
  }

  const originRoot = cleaned.replace(/\/v1$/i, '');
  let originHost = '';
  try {
    originHost = new URL(cleaned).origin;
  } catch {
    originHost = originRoot;
  }

  const host = getHostname(cleaned);
  const skipWebCatalog =
    host === 'agentrouter.org' ||
    host === 'www.agentrouter.org' ||
    host === 'co.agentrouter.org' ||
    host === 'api.openai.com';

  const catalogUrls: string[] = [];
  if (!skipWebCatalog && originHost) {
    pushUnique(catalogUrls, `${originHost}/api/pricing`);
    pushUnique(catalogUrls, `${originHost}/api/models`);
  }

  const responsesUrls: string[] = [];
  for (const base of v1Urls) {
    pushUnique(responsesUrls, `${base}/responses`);
  }

  const anthropicMessageUrls: string[] = [];
  if (originRoot) {
    pushUnique(anthropicMessageUrls, `${originRoot}/v1/messages`);
    pushUnique(anthropicMessageUrls, `${cleaned}/messages`);
  }

  return { v1Urls, catalogUrls, responsesUrls, anthropicMessageUrls };
}

function parseErrorMessage(raw: string, status: number, contentType = '', targetUrl = ''): string {
  if (!raw) return `Server returned HTTP ${status}.`;
  if (isHtmlFirewallOrPage(contentType, raw)) {
    if (status === 404) {
      return 'Endpoint not found (HTTP 404). Check your Base API URL.';
    }
    if (isAgentRouterMainHost(targetUrl)) {
      return 'Temporary firewall check on agentrouter.org. Open agentrouter.org once in a browser tab to clear the slider, wait 30 seconds, then retry — or switch Base API to co.agentrouter.org/v1.';
    }
    return 'Temporary web firewall check on this domain. Open your Base API site once in a browser tab to clear verification, then retry.';
  }
  try {
    const parsed = JSON.parse(raw);
    const msg =
      parsed?.error?.message ||
      (typeof parsed?.error === 'string' ? parsed.error : '') ||
      parsed?.msg ||
      parsed?.message ||
      parsed?.detail;
    if (msg) return String(msg);
  } catch {
    // Plain text body
  }
  return raw.slice(0, 260);
}

function extractGatewayErrorFromJson(
  payload: unknown
): { status: number; message: string } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const obj = payload as Record<string, any>;

  if (typeof obj.code === 'number' && obj.code !== 200 && obj.code !== 0) {
    const status = obj.code >= 400 && obj.code < 600 ? obj.code : 502;
    const message = String(
      obj.msg || obj.message || obj?.error?.message || `Gateway returned code ${obj.code}.`
    );
    return { status, message };
  }

  if (obj.success === false) {
    const message = String(
      obj.msg || obj.message || obj?.error?.message || 'Gateway rejected the request.'
    );
    return { status: 502, message };
  }

  if (obj.error) {
    const message =
      typeof obj.error === 'string'
        ? obj.error
        : String(obj.error?.message || obj.msg || obj.message || 'Gateway returned an error.');
    return { status: 502, message };
  }

  return null;
}

function inferModelOwner(id: string, rawOwner: string): string {
  const cleanOwner = rawOwner.trim();
  if (cleanOwner && !/^\d+$/.test(cleanOwner) && cleanOwner.toLowerCase() !== 'custom') {
    return cleanOwner;
  }
  if (id.includes('/')) {
    return id.split('/')[0];
  }
  const lower = id.toLowerCase();
  if (
    lower.startsWith('gpt-') ||
    lower.startsWith('chatgpt-') ||
    lower.includes('codex') ||
    lower.includes('-sol') ||
    lower.includes('-astra') ||
    lower.includes('-luna') ||
    lower.includes('-terra') ||
    /^o[134](-|$)/.test(lower)
  ) {
    return 'openai';
  }
  if (lower.startsWith('claude')) return 'anthropic';
  if (lower.startsWith('gemini')) return 'google';
  if (lower.startsWith('deepseek')) return 'deepseek';
  if (lower.startsWith('glm')) return 'zhipu';
  if (lower.startsWith('qwen')) return 'alibaba';
  return cleanOwner || 'openai';
}

function modelPriorityRank(item: SyncedModelItem): number {
  const id = item.id.toLowerCase();
  const owner = item.ownedBy.toLowerCase();
  // Prioritize GPT-6 Sol / Astra and GPT-5.4 Sol families first, followed by other OpenAI models
  if (id.includes('6.1-sol') || id.includes('6.1_sol')) return 0;
  if (id.includes('gpt-6') && (id.includes('astra') || id.includes('sol'))) return 1;
  if (id.includes('gpt-6')) return 2;
  if (id.includes('5.4-sol') || id.includes('-sol') || id.includes('-astra')) return 3;
  if (id.includes('codex') || id.startsWith('gpt-5')) return 4;
  if (id.startsWith('gpt-') || /^o[134](-|$)/.test(id) || owner === 'openai') return 5;
  if (id.startsWith('claude') || owner === 'anthropic') return 9;
  return 7;
}

function extractSyncedModelsFromPayload(payload: unknown): {
  models: SyncedModelItem[];
  gatewayMessage?: string;
} {
  let gatewayMessage: string | undefined;

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const rootObj = payload as Record<string, any>;
    const rawMsg =
      typeof rootObj.msg === 'string'
        ? rootObj.msg.trim()
        : typeof rootObj.message === 'string'
          ? rootObj.message.trim()
          : '';
    if (rawMsg && !['success', 'ok', 'true', ''].includes(rawMsg.toLowerCase())) {
      gatewayMessage = rawMsg;
    }
  }

  const obj = (payload && typeof payload === 'object' ? payload : {}) as Record<string, any>;
  let rawList: unknown[] = [];

  if (Array.isArray(payload)) {
    rawList = payload;
  } else if (Array.isArray(obj.data)) {
    rawList = obj.data;
  } else if (Array.isArray(obj.models)) {
    rawList = obj.models;
  } else if (Array.isArray(obj.pricing)) {
    rawList = obj.pricing;
  } else if (Array.isArray(obj.items)) {
    rawList = obj.items;
  } else if (Array.isArray(obj.result)) {
    rawList = obj.result;
  } else if (obj.catalog && typeof obj.catalog === 'object' && Array.isArray(obj.catalog.models)) {
    rawList = obj.catalog.models;
  } else if (obj.data && typeof obj.data === 'object') {
    const nested = obj.data as Record<string, any>;
    if (Array.isArray(nested.data)) {
      rawList = nested.data;
    } else if (Array.isArray(nested.models)) {
      rawList = nested.models;
    } else if (Array.isArray(nested.pricing)) {
      rawList = nested.pricing;
    } else if (Array.isArray(nested.items)) {
      rawList = nested.items;
    } else if (Array.isArray(nested.list)) {
      rawList = nested.list;
    } else {
      const reservedKeys = new Set([
        'object',
        'total',
        'page',
        'limit',
        'has_more',
        'code',
        'msg',
        'message',
        'group_ratio',
        'usable_group',
        'auto_groups',
        'vendors',
        'supported_endpoint',
      ]);
      const entries = Object.entries(nested).filter(([k]) => !reservedKeys.has(k));
      for (const [key, val] of entries) {
        if (Array.isArray(val)) {
          // New API /api/models group -> string[] or object[] map (e.g. { "1": ["gpt-6-astra", "gpt-6.1-sol"] })
          for (const sub of val) {
            rawList.push(sub);
          }
        } else if (val && typeof val === 'object') {
          rawList.push({ id: key, ...(val as Record<string, unknown>) });
        } else if (typeof val === 'string' && !/^\d+$/.test(key)) {
          rawList.push(key);
        } else if (val === true && !/^\d+$/.test(key)) {
          rawList.push(key);
        }
      }
    }
  }

  const seen = new Set<string>();
  const syncedModels: SyncedModelItem[] = [];

  for (const entry of rawList) {
    if (typeof entry === 'string') {
      const id = entry.trim();
      if (!id || /^\d+$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      const ownedBy = inferModelOwner(id, '');
      syncedModels.push({ id, label: id, ownedBy });
      continue;
    }

    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, any>;
    const id = String(
      item.id ||
        item.model_name ||
        item.model ||
        item.model_id ||
        item.slug ||
        item.key ||
        item.name ||
        item.value ||
        ''
    ).trim();
    if (!id || /^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);

    const rawOwner = String(
      item.owned_by || item.provider || item.vendor || item.owner_by || ''
    ).trim();
    const ownedBy = inferModelOwner(id, rawOwner);
    const label = String(item.display_name || item.label || item.model_name || item.name || id).trim();
    const contextWindow =
      typeof item.contextWindow === 'number'
        ? item.contextWindow
        : typeof item.context_length === 'number'
          ? item.context_length
          : typeof item.max_context_length === 'number'
            ? item.max_context_length
            : typeof item.input_token_limit === 'number'
              ? item.input_token_limit
              : undefined;

    syncedModels.push({
      id,
      label,
      ownedBy,
      ...(contextWindow ? { contextWindow } : {}),
    });
  }

  syncedModels.sort((a, b) => modelPriorityRank(a) - modelPriorityRank(b));

  return { models: syncedModels, gatewayMessage };
}

function getWorkspaceTasks(workspaceId: string): InboundAgentTask[] {
  if (!inboxByWorkspace.has(workspaceId)) {
    inboxByWorkspace.set(workspaceId, []);
  }
  return inboxByWorkspace.get(workspaceId)!;
}

function broadcastInboxEvent(workspaceId: string, event: string, payload: unknown) {
  const clients = inboxClientsByWorkspace.get(workspaceId);
  if (!clients || clients.size === 0) return;

  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.write(frame);
    } catch {
      clients.delete(client);
    }
  }
}

function isReasoningStyleModel(model: string): boolean {
  return /codex|gpt-[56]|\bsol\b|-sol\b|_sol\b|\bastra\b|-astra\b|_astra\b|\bluna\b|-luna\b|\bterra\b|-terra\b|^o[134]\b|\/o[134]\b|-o[134]\b/i.test(
    model
  );
}

function shouldPreferResponsesEndpoint(model: string): boolean {
  return /codex/i.test(model);
}

async function fetchWithWafHandling(
  url: string,
  init: RequestInit,
  userWafCookie: string
): Promise<globalThis.Response> {
  const host = getHostname(url);
  if (!userWafCookie && isAgentRouterMainHost(url) && !hostCookieJar.has(host)) {
    await warmupHostWaf(url);
  }

  const baseHeaders: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };
  const cookieHeader = buildCookieHeaderForUrl(url, userWafCookie);
  if (cookieHeader) {
    baseHeaders.Cookie = cookieHeader;
  }

  const firstRes = await fetch(url, {
    ...init,
    headers: baseHeaders,
  });
  recordUpstreamCookies(url, firstRes);

  const ct = firstRes.headers.get('content-type') || '';
  if (ct.toLowerCase().includes('text/html')) {
    const htmlText = await firstRes.text().catch(() => '');
    const solved = trySolveAliyunAcwScV2(url, htmlText);
    const warmed = !solved && !userWafCookie ? await warmupHostWaf(url) : false;

    if (solved || warmed) {
      const retryCookie = buildCookieHeaderForUrl(url, userWafCookie);
      const retryRes = await fetch(url, {
        ...init,
        headers: {
          ...baseHeaders,
          ...(retryCookie ? { Cookie: retryCookie } : {}),
        },
      });
      recordUpstreamCookies(url, retryRes);
      return retryRes;
    }

    return new Response(htmlText, {
      status: firstRes.status,
      headers: firstRes.headers,
    });
  }

  return firstRes;
}

async function openUpstreamStream(params: {
  apiKey: string;
  baseUrl: string;
  wafCookie?: string;
  model: string;
  messages: ChatMessagePayload[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  signal: AbortSignal;
}): Promise<{ response: globalThis.Response; protocol: WireProtocol }> {
  const {
    apiKey,
    baseUrl,
    wafCookie = '',
    model,
    messages,
    systemPrompt,
    temperature,
    maxTokens,
    signal,
  } = params;

  const { v1Urls, responsesUrls, anthropicMessageUrls } = normalizeManualBaseUrl(baseUrl);
  if (v1Urls.length === 0) {
    throw new Error('Enter your Base API URL first.');
  }

  const reasoningModel = isReasoningStyleModel(model);
  const preferResponsesFirst = shouldPreferResponsesEndpoint(model);

  const openAiMessages: ChatMessagePayload[] = [];
  if (systemPrompt && systemPrompt.trim()) {
    openAiMessages.push({ role: 'system', content: systemPrompt.trim() });
  }
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'user' || m.role === 'assistant') {
      openAiMessages.push({ role: m.role, content: String(m.content || '') });
    }
  }

  let lastError = 'Unable to connect to the Base API URL.';

  const tryOpenAiChatCompletions = async (): Promise<globalThis.Response | null> => {
    for (const candidateBase of v1Urls) {
      for (let pIdx = 0; pIdx < OPENAI_CLIENT_PROFILES.length; pIdx++) {
        try {
          const res = await fetchWithWafHandling(
            `${candidateBase}/chat/completions`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream, application/json',
                Authorization: `Bearer ${apiKey}`,
                ...OPENAI_CLIENT_PROFILES[pIdx],
              },
              body: JSON.stringify({
                model,
                messages: openAiMessages,
                stream: true,
                ...(typeof temperature === 'number' && !reasoningModel ? { temperature } : {}),
                ...(typeof maxTokens === 'number'
                  ? reasoningModel
                    ? { max_completion_tokens: maxTokens }
                    : { max_tokens: maxTokens }
                  : {}),
              }),
              signal,
            },
            wafCookie
          );

          const contentType = res.headers.get('content-type') || '';

          if (res.ok && res.body) {
            if (isHtmlFirewallOrPage(contentType, '')) {
              const htmlBody = await res.text().catch(() => '');
              lastError = parseErrorMessage(htmlBody, res.status, contentType, candidateBase);
              break;
            }
            return res;
          }

          const errText = await res.text().catch(() => '');
          lastError = parseErrorMessage(errText, res.status, contentType, candidateBase);

          if (isHtmlFirewallOrPage(contentType, errText)) {
            break;
          }

          // Retry next CLI profile only on 401/403 client fingerprint rejection
          if ((res.status === 401 || res.status === 403) && pIdx < OPENAI_CLIENT_PROFILES.length - 1) {
            continue;
          }
          break;
        } catch (err: unknown) {
          if (signal.aborted) throw err;
          lastError = err instanceof Error ? err.message : 'Network error reaching Base API URL.';
          break;
        }
      }
    }
    return null;
  };

  const tryOpenAiResponses = async (): Promise<globalThis.Response | null> => {
    const responsesInput = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        type: 'message',
        role: m.role,
        content: [
          {
            type: m.role === 'assistant' ? 'output_text' : 'input_text',
            text: String(m.content || ''),
          },
        ],
      }));

    for (const respUrl of responsesUrls) {
      for (let pIdx = 0; pIdx < OPENAI_CLIENT_PROFILES.length; pIdx++) {
        try {
          const res = await fetchWithWafHandling(
            respUrl,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream, application/json',
                Authorization: `Bearer ${apiKey}`,
                ...OPENAI_CLIENT_PROFILES[pIdx],
              },
              body: JSON.stringify({
                model,
                ...(systemPrompt && systemPrompt.trim()
                  ? { instructions: systemPrompt.trim() }
                  : {}),
                input: responsesInput,
                stream: true,
                ...(typeof temperature === 'number' && !reasoningModel ? { temperature } : {}),
                ...(typeof maxTokens === 'number' ? { max_output_tokens: maxTokens } : {}),
              }),
              signal,
            },
            wafCookie
          );

          const contentType = res.headers.get('content-type') || '';

          if (res.ok && res.body) {
            if (isHtmlFirewallOrPage(contentType, '')) {
              const htmlBody = await res.text().catch(() => '');
              lastError = parseErrorMessage(htmlBody, res.status, contentType, respUrl);
              break;
            }
            return res;
          }

          const errText = await res.text().catch(() => '');
          if (errText && !isHtmlFirewallOrPage(contentType, errText)) {
            lastError = parseErrorMessage(errText, res.status, contentType, respUrl);
          }

          if (isHtmlFirewallOrPage(contentType, errText)) {
            break;
          }

          if ((res.status === 401 || res.status === 403) && pIdx < OPENAI_CLIENT_PROFILES.length - 1) {
            continue;
          }
          break;
        } catch (err: unknown) {
          if (signal.aborted) throw err;
          break;
        }
      }
    }
    return null;
  };

  if (preferResponsesFirst) {
    const rRes = await tryOpenAiResponses();
    if (rRes) return { response: rRes, protocol: 'openai-responses' };
    const cRes = await tryOpenAiChatCompletions();
    if (cRes) return { response: cRes, protocol: 'openai-chat' };
  } else {
    const cRes = await tryOpenAiChatCompletions();
    if (cRes) return { response: cRes, protocol: 'openai-chat' };
    const rRes = await tryOpenAiResponses();
    if (rRes) return { response: rRes, protocol: 'openai-responses' };
  }

  // Fallback to /v1/messages when agentrouter.org or a claude model is used
  if (/claude/i.test(model) || isAgentRouterMainHost(baseUrl)) {
    const anthropicMessages = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: String(m.content || '') }));

    for (const msgUrl of anthropicMessageUrls) {
      try {
        const res = await fetchWithWafHandling(
          msgUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream, application/json',
              'x-api-key': apiKey,
              Authorization: `Bearer ${apiKey}`,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
              ...OPENAI_CLIENT_PROFILES[0],
            },
            body: JSON.stringify({
              model,
              max_tokens: typeof maxTokens === 'number' ? maxTokens : 4096,
              ...(systemPrompt && systemPrompt.trim() ? { system: systemPrompt.trim() } : {}),
              ...(typeof temperature === 'number' && !reasoningModel ? { temperature } : {}),
              messages: anthropicMessages,
              stream: true,
            }),
            signal,
          },
          wafCookie
        );

        const contentType = res.headers.get('content-type') || '';
        if (res.ok && res.body && !isHtmlFirewallOrPage(contentType, '')) {
          return { response: res, protocol: 'anthropic' };
        }
      } catch (err: unknown) {
        if (signal.aborted) throw err;
      }
    }
  }

  // If agentrouter.org hit datacenter firewall on Cloud Run, also try co.agentrouter.org/v1 once
  if (isAgentRouterMainHost(baseUrl)) {
    try {
      const coRes = await fetch('https://co.agentrouter.org/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
          Authorization: `Bearer ${apiKey}`,
          ...OPENAI_CLIENT_PROFILES[0],
        },
        body: JSON.stringify({
          model,
          messages: openAiMessages,
          stream: true,
          ...(typeof temperature === 'number' && !reasoningModel ? { temperature } : {}),
        }),
        signal,
      });
      const coCt = coRes.headers.get('content-type') || '';
      if (coRes.ok && coRes.body && !isHtmlFirewallOrPage(coCt, '')) {
        return { response: coRes, protocol: 'openai-chat' };
      }
    } catch (err: unknown) {
      if (signal.aborted) throw err;
    }
  }

  throw new Error(lastError);
}

function extractTextFromResponsesOutputArray(
  outputArr: unknown[],
  callbacks: { onContent: (chunk: string) => void; onThinking: (chunk: string) => void }
): boolean {
  let emitted = false;
  for (const rawItem of outputArr) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as Record<string, any>;
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (
          (block?.type === 'output_text' || block?.type === 'text') &&
          typeof block.text === 'string' &&
          block.text
        ) {
          callbacks.onContent(block.text);
          emitted = true;
        }
      }
    } else if (item.type === 'reasoning' && Array.isArray(item.summary)) {
      for (const s of item.summary) {
        if (typeof s?.text === 'string' && s.text) {
          callbacks.onThinking(s.text);
        }
      }
    }
  }
  return emitted;
}

async function consumeAgentRouterStream(
  upstream: globalThis.Response,
  protocol: WireProtocol,
  callbacks: {
    onContent: (chunk: string) => void;
    onThinking: (chunk: string) => void;
  }
) {
  const contentType = (upstream.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/json')) {
    const json = await upstream.json();
    const gwErr = extractGatewayErrorFromJson(json);
    if (gwErr) {
      throw new Error(gwErr.message);
    }

    if (typeof json?.output_text === 'string' && json.output_text) {
      callbacks.onContent(json.output_text);
      return;
    }

    if (Array.isArray(json?.output)) {
      extractTextFromResponsesOutputArray(json.output, callbacks);
      return;
    }

    const openAiText =
      json?.choices?.[0]?.message?.content ?? json?.data?.choices?.[0]?.message?.content;
    if (typeof openAiText === 'string' && openAiText) {
      callbacks.onContent(openAiText);
      return;
    }

    const anthropicBlocks = Array.isArray(json?.content)
      ? json.content
      : Array.isArray(json?.data?.content)
        ? json.data.content
        : [];
    for (const block of anthropicBlocks) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        callbacks.onContent(block.text);
      } else if (block?.type === 'thinking' && typeof block.thinking === 'string') {
        callbacks.onThinking(block.thinking);
      }
    }
    return;
  }

  if (!upstream.body) return;

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let emittedContent = false;

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':') || line.startsWith('event:')) return;
    if (!line.startsWith('data:')) return;

    const dataStr = line.slice(5).trim();
    if (!dataStr || dataStr === '[DONE]') return;

    let packet: Record<string, any>;
    try {
      packet = JSON.parse(dataStr);
    } catch {
      return;
    }

    const gwErr = extractGatewayErrorFromJson(packet);
    if (gwErr) {
      throw new Error(gwErr.message);
    }

    if (protocol === 'openai-responses') {
      if (packet?.type === 'response.output_text.delta' && typeof packet.delta === 'string') {
        emittedContent = true;
        callbacks.onContent(packet.delta);
        return;
      }
      if (
        packet?.type === 'response.content_part.delta' &&
        typeof (packet.delta?.text ?? packet.delta) === 'string'
      ) {
        const chunk = String(packet.delta?.text ?? packet.delta);
        if (chunk) {
          emittedContent = true;
          callbacks.onContent(chunk);
        }
        return;
      }
      if (
        (packet?.type === 'response.reasoning_summary_text.delta' ||
          packet?.type === 'response.reasoning_text.delta') &&
        typeof packet.delta === 'string'
      ) {
        callbacks.onThinking(packet.delta);
        return;
      }
      if (packet?.type === 'response.output_item.done' && !emittedContent && packet.item) {
        if (extractTextFromResponsesOutputArray([packet.item], callbacks)) {
          emittedContent = true;
        }
        return;
      }
      if (packet?.type === 'response.completed' && !emittedContent) {
        const out = packet?.response?.output;
        if (Array.isArray(out)) {
          if (extractTextFromResponsesOutputArray(out, callbacks)) {
            emittedContent = true;
          }
        }
        return;
      }
      if (packet?.type === 'response.failed') {
        throw new Error(
          packet?.response?.error?.message || 'OpenAI Responses stream failed.'
        );
      }
    }

    if (protocol === 'openai-chat' || protocol === 'openai-responses') {
      const delta = packet?.choices?.[0]?.delta;
      if (!delta) {
        const fullMsg = packet?.choices?.[0]?.message?.content;
        if (typeof fullMsg === 'string' && fullMsg) {
          emittedContent = true;
          callbacks.onContent(fullMsg);
        }
        return;
      }

      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        callbacks.onThinking(delta.reasoning_content);
      } else if (typeof delta.thinking === 'string' && delta.thinking) {
        callbacks.onThinking(delta.thinking);
      }

      if (typeof delta.content === 'string' && delta.content) {
        emittedContent = true;
        callbacks.onContent(delta.content);
      }
    } else {
      if (packet?.type === 'content_block_delta') {
        const delta = packet.delta;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          emittedContent = true;
          callbacks.onContent(delta.text);
        } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          callbacks.onThinking(delta.thinking);
        }
      } else if (packet?.type === 'error') {
        throw new Error(packet?.error?.message || 'Stream error from API.');
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      processLine(rawLine);
    }
  }

  if (buffer.trim()) {
    processLine(buffer);
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '4mb' }));

  // 1. Live OpenAI Model Sync using manually provided Base API URL, API Key & optional WAF Cookie
  app.get('/api/models', async (req: Request, res: Response) => {
    const apiKey = extractRequestApiKey(req);
    const baseUrl = extractRequestBaseUrl(req);
    const wafCookie = extractRequestWafCookie(req);

    if (!baseUrl) {
      res.status(400).json({
        error: 'Enter and save your Base API URL in the frontend.',
        models: [],
      });
      return;
    }

    if (!apiKey) {
      res.status(401).json({
        error: 'Enter and save your API key in the frontend.',
        models: [],
      });
      return;
    }

    const { v1Urls, catalogUrls } = normalizeManualBaseUrl(baseUrl);
    let lastError = 'Could not load models from your Base API URL.';
    let lastStatus = 502;
    let connectedSourceUrl: string | null = null;
    let emptyGatewayNotice: string | undefined;
    let definitiveAuthFailure = false;

    for (const candidateBase of v1Urls) {
      let tryNextUrl = false;

      for (let pIdx = 0; pIdx < OPENAI_CLIENT_PROFILES.length; pIdx++) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 14000);

          const upstream = await fetchWithWafHandling(
            `${candidateBase}/models`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
                ...OPENAI_CLIENT_PROFILES[pIdx],
              },
              signal: controller.signal,
            },
            wafCookie
          );
          clearTimeout(timeout);

          const contentType = upstream.headers.get('content-type') || '';
          const rawBody = await upstream.text().catch(() => '');

          if (!upstream.ok) {
            lastStatus = upstream.status;
            lastError = parseErrorMessage(rawBody, upstream.status, contentType, candidateBase);
            if (isHtmlFirewallOrPage(contentType, rawBody)) {
              tryNextUrl = true;
              break;
            }
            if (
              (upstream.status === 401 || upstream.status === 403) &&
              pIdx < OPENAI_CLIENT_PROFILES.length - 1
            ) {
              continue;
            }
            if (upstream.status === 401 || upstream.status === 403) {
              definitiveAuthFailure = true;
            }
            tryNextUrl = upstream.status !== 401 && upstream.status !== 403;
            break;
          }

          if (isHtmlFirewallOrPage(contentType, rawBody)) {
            lastStatus = 502;
            lastError = parseErrorMessage(rawBody, upstream.status, contentType, candidateBase);
            tryNextUrl = true;
            break;
          }

          let payload: unknown;
          try {
            payload = JSON.parse(rawBody);
          } catch {
            lastStatus = 502;
            lastError = 'Gateway returned invalid JSON while syncing models.';
            tryNextUrl = true;
            break;
          }

          const gwErr = extractGatewayErrorFromJson(payload);
          if (gwErr) {
            lastStatus = gwErr.status;
            lastError = gwErr.message;
            if (
              (gwErr.status === 401 || gwErr.status === 403) &&
              pIdx < OPENAI_CLIENT_PROFILES.length - 1
            ) {
              continue;
            }
            if (gwErr.status === 401 || gwErr.status === 403) {
              definitiveAuthFailure = true;
            }
            tryNextUrl = gwErr.status !== 401 && gwErr.status !== 403;
            break;
          }

          const { models: syncedModels, gatewayMessage } =
            extractSyncedModelsFromPayload(payload);

          connectedSourceUrl = connectedSourceUrl || candidateBase;
          definitiveAuthFailure = false;
          if (gatewayMessage) {
            emptyGatewayNotice = gatewayMessage;
          }

          if (syncedModels.length > 0) {
            res.json({
              models: syncedModels,
              sourceUrl: candidateBase,
              ...(gatewayMessage ? { gatewayMessage } : {}),
            });
            return;
          }

          // /v1/models returned 0 models — try next UA profile or cascade to catalogUrls below
          if (pIdx < OPENAI_CLIENT_PROFILES.length - 1) {
            continue;
          }
          tryNextUrl = true;
          break;
        } catch (err: unknown) {
          lastError =
            err instanceof Error && err.name === 'AbortError'
              ? 'Connection timed out while syncing models.'
              : err instanceof Error
                ? err.message
                : 'Network error while reaching your Base API URL.';
          tryNextUrl = true;
          break;
        }
      }

      if (!tryNextUrl && definitiveAuthFailure) {
        break;
      }
    }

    // Cascade to secondary gateway catalog routes (e.g. /api/pricing, /api/models, /api/available_model)
    // whenever /v1/models returned 0 models (or 404/non-auth failure) so New API catalogs load cleanly
    if (!definitiveAuthFailure && catalogUrls.length > 0) {
      for (const catalogUrl of catalogUrls) {
        const isPublicPricingRoute = /\/api\/pricing(_new)?$/i.test(catalogUrl);
        const headerAttempts: Record<string, string>[] = isPublicPricingRoute
          ? [
              {
                Accept: 'application/json',
                'User-Agent': BROWSER_USER_AGENT,
              },
              {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
                ...OPENAI_CLIENT_PROFILES[0],
              },
            ]
          : [
              {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
                ...OPENAI_CLIENT_PROFILES[0],
              },
              {
                Accept: 'application/json',
                'User-Agent': BROWSER_USER_AGENT,
              },
            ];

        for (const hdrs of headerAttempts) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);

            const catalogRes = await fetchWithWafHandling(
              catalogUrl,
              {
                method: 'GET',
                headers: hdrs,
                signal: controller.signal,
              },
              wafCookie
            );
            clearTimeout(timeout);

            if (!catalogRes.ok) continue;

            const ct = catalogRes.headers.get('content-type') || '';
            const rawCatalog = await catalogRes.text().catch(() => '');
            if (!rawCatalog || isHtmlFirewallOrPage(ct, rawCatalog)) continue;

            let catalogPayload: unknown;
            try {
              catalogPayload = JSON.parse(rawCatalog);
            } catch {
              continue;
            }

            if (extractGatewayErrorFromJson(catalogPayload)) continue;

            const { models: catalogModels, gatewayMessage } =
              extractSyncedModelsFromPayload(catalogPayload);

            if (catalogModels.length > 0) {
              res.json({
                models: catalogModels,
                sourceUrl: connectedSourceUrl || v1Urls[0] || catalogUrl,
                ...(gatewayMessage ? { gatewayMessage } : {}),
              });
              return;
            }
          } catch {
            // Continue to next catalog route
          }
        }
      }
    }

    if (!definitiveAuthFailure && isAgentRouterMainHost(baseUrl)) {
      res.json({
        models: AGENTROUTER_OPENAI_MODELS.map((m) => ({ ...m })),
        sourceUrl: connectedSourceUrl || v1Urls[0] || 'https://agentrouter.org/v1',
        ...(emptyGatewayNotice ? { gatewayMessage: emptyGatewayNotice } : {}),
      });
      return;
    }

    if (connectedSourceUrl) {
      res.json({
        models: [],
        sourceUrl: connectedSourceUrl,
        ...(emptyGatewayNotice ? { gatewayMessage: emptyGatewayNotice } : {}),
      });
      return;
    }

    res.status(lastStatus === 401 || lastStatus === 403 ? 401 : 502).json({
      error: lastError,
      models: [],
    });
  });

  // 2. Live OpenAI Model Test Endpoint (supports /v1/chat/completions and /v1/responses)
  app.post('/api/models/test', async (req: Request, res: Response) => {
    const apiKey = extractRequestApiKey(req);
    const baseUrl = extractRequestBaseUrl(req);
    const wafCookie = extractRequestWafCookie(req);
    const model = String(req.body?.model || '').trim();

    if (!baseUrl) {
      res.status(400).json({ ok: false, error: 'Missing Base API URL.' });
      return;
    }
    if (!apiKey) {
      res.status(401).json({ ok: false, error: 'Missing API key.' });
      return;
    }
    if (!model) {
      res.status(400).json({ ok: false, error: 'Model ID is required.' });
      return;
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const { response: upstream, protocol } = await openUpstreamStream({
        apiKey,
        baseUrl,
        wafCookie,
        model,
        messages: [{ role: 'user', content: 'Reply with only the single word: Ready' }],
        signal: controller.signal,
      });

      let replyText = '';
      let thinkingText = '';

      await consumeAgentRouterStream(upstream, protocol, {
        onContent: (chunk) => {
          replyText += chunk;
        },
        onThinking: (chunk) => {
          thinkingText += chunk;
        },
      });

      clearTimeout(timeout);
      const durationMs = Date.now() - startedAt;
      const sample = (replyText.trim() || thinkingText.trim() || 'Connected').slice(0, 60);

      res.json({
        ok: true,
        model,
        durationMs,
        reply: sample,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      const durationMs = Date.now() - startedAt;
      const errorMessage =
        err instanceof Error && err.name === 'AbortError'
          ? 'Timed out after 20s'
          : err instanceof Error
            ? err.message
            : 'Model test failed';

      res.json({
        ok: false,
        model,
        durationMs,
        error: errorMessage,
      });
    }
  });

  // 3. Real-Time Streaming Chat Endpoint (OpenAI Chat Completions + OpenAI Responses API)
  app.post('/api/agent/stream', async (req: Request, res: Response) => {
    const apiKey = extractRequestApiKey(req);
    const baseUrl = extractRequestBaseUrl(req);
    const wafCookie = extractRequestWafCookie(req);

    if (!baseUrl) {
      res.status(400).json({
        error: 'Add and save your Base API URL first.',
      });
      return;
    }

    if (!apiKey) {
      res.status(401).json({
        error: 'Add and save your API key first.',
      });
      return;
    }

    const { model, messages, systemPrompt, temperature, maxTokens } = req.body || {};
    const selectedModel = String(model || '').trim();

    if (!selectedModel) {
      res.status(400).json({
        error: 'Sync and select a model before sending a message.',
      });
      return;
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Please write a message first.' });
      return;
    }

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) {
        abortController.abort();
      }
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (type: string, data: Record<string, unknown>) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
      }
    };

    try {
      const { response: upstream, protocol } = await openUpstreamStream({
        apiKey,
        baseUrl,
        wafCookie,
        model: selectedModel,
        messages,
        systemPrompt,
        temperature,
        maxTokens,
        signal: abortController.signal,
      });

      await consumeAgentRouterStream(upstream, protocol, {
        onContent: (chunk) => sendEvent('content', { delta: chunk }),
        onThinking: (chunk) => sendEvent('thinking', { delta: chunk }),
      });

      sendEvent('done', {});
      res.end();
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        res.end();
        return;
      }
      const message = err instanceof Error ? err.message : 'Streaming request failed.';
      sendEvent('error', { message });
      res.end();
    }
  });

  // 4. Per-Workspace Inbound Agent Requests Receiver & SSE Feed
  app.get('/api/inbox', (req: Request, res: Response) => {
    const workspaceId = String(req.query.workspaceId || 'default').trim();
    res.json({ tasks: getWorkspaceTasks(workspaceId) });
  });

  app.get('/api/inbox/stream', (req: Request, res: Response) => {
    const workspaceId = String(req.query.workspaceId || 'default').trim();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(
      `event: snapshot\ndata: ${JSON.stringify({ tasks: getWorkspaceTasks(workspaceId) })}\n\n`
    );

    if (!inboxClientsByWorkspace.has(workspaceId)) {
      inboxClientsByWorkspace.set(workspaceId, new Set());
    }
    const clients = inboxClientsByWorkspace.get(workspaceId)!;
    clients.add(res);

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
        clients.delete(res);
      }
    }, 20000);

    res.on('close', () => {
      clearInterval(keepAlive);
      clients.delete(res);
    });
  });

  app.post('/api/inbox', async (req: Request, res: Response) => {
    const apiKey = extractRequestApiKey(req);
    const baseUrl = extractRequestBaseUrl(req);
    const wafCookie = extractRequestWafCookie(req);
    const {
      workspaceId: bodyWorkspace,
      prompt,
      title,
      sender,
      model,
      systemPrompt,
      autoRun = true,
    } = req.body || {};

    const workspaceId = String(req.query.workspaceId || bodyWorkspace || 'default').trim();
    const cleanPrompt = String(prompt || '').trim();
    const cleanModel = String(model || '').trim();

    if (!cleanPrompt) {
      res.status(400).json({ error: 'A prompt field is required.' });
      return;
    }
    if (!cleanModel) {
      res.status(400).json({ error: 'A synced model ID is required.' });
      return;
    }

    const task: InboundAgentTask = {
      id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      workspaceId,
      title: String(title || cleanPrompt.slice(0, 56)).trim(),
      prompt: cleanPrompt,
      sender: String(sender || 'External Agent').trim(),
      model: cleanModel,
      systemPrompt: systemPrompt ? String(systemPrompt) : undefined,
      createdAt: Date.now(),
      status: autoRun ? 'running' : 'pending',
      output: '',
      thinking: '',
    };

    const tasks = getWorkspaceTasks(workspaceId);
    tasks.unshift(task);
    if (tasks.length > 50) tasks.pop();
    broadcastInboxEvent(workspaceId, 'task_created', task);

    res.status(202).json({ task });

    if (!autoRun) return;

    if (!baseUrl || !apiKey) {
      task.status = 'failed';
      task.error =
        'Provide x-agentrouter-base-url and Authorization: Bearer <KEY> headers to run tasks.';
      broadcastInboxEvent(workspaceId, 'task_updated', task);
      return;
    }

    try {
      const controller = new AbortController();
      const { response: upstream, protocol } = await openUpstreamStream({
        apiKey,
        baseUrl,
        wafCookie,
        model: task.model,
        messages: [{ role: 'user', content: task.prompt }],
        systemPrompt: task.systemPrompt,
        signal: controller.signal,
      });

      await consumeAgentRouterStream(upstream, protocol, {
        onContent: (chunk) => {
          task.output = (task.output || '') + chunk;
          broadcastInboxEvent(workspaceId, 'task_delta', {
            id: task.id,
            contentDelta: chunk,
          });
        },
        onThinking: (chunk) => {
          task.thinking = (task.thinking || '') + chunk;
          broadcastInboxEvent(workspaceId, 'task_delta', {
            id: task.id,
            thinkingDelta: chunk,
          });
        },
      });

      task.status = 'done';
      broadcastInboxEvent(workspaceId, 'task_updated', task);
    } catch (err: unknown) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : 'Failed to run agent request.';
      broadcastInboxEvent(workspaceId, 'task_updated', task);
    }
  });

  app.delete('/api/inbox/:id', (req: Request, res: Response) => {
    const workspaceId = String(req.query.workspaceId || 'default').trim();
    const tasks = getWorkspaceTasks(workspaceId);
    const idx = tasks.findIndex((t) => t.id === req.params.id);
    if (idx !== -1) {
      const [removed] = tasks.splice(idx, 1);
      broadcastInboxEvent(workspaceId, 'task_deleted', { id: removed.id });
    }
    res.json({ ok: true });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vellum server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
