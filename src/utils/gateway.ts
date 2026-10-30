import { BackgroundChatRunState, ModelOption, SharedKeyLinkSummary } from '../types';

export interface ChatPayloadMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GatewaySyncResponse {
  models: ModelOption[];
  sourceUrl: string | null;
  gatewayMessage?: string;
  verifiedResults?: Record<string, { durationMs: number; reply: string }>;
  share?: SharedKeyLinkSummary;
}

type BrowserWireProtocol = 'openai-chat' | 'openai-responses' | 'anthropic';

export const AGENTROUTER_OPENAI_MODELS: ModelOption[] = [
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

export function sanitizeApiKey(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    .trim()
    .replace(/^(authorization\s*:\s*)?bearer\s+/i, '')
    .replace(/^x-api-key\s*:\s*/i, '')
    .replace(/^['"`“”‘’]+|['"`“”‘’]+$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

export function sanitizeBaseUrlInput(raw: string): string {
  let cleaned = raw.trim().replace(/\/+$/, '');
  if (!cleaned) return '';
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
    .replace(/\/api\/pricing(_new)?$/i, '')
    .replace(/\/api\/available_models?$/i, '')
    .replace(/\/+$/, '');
  return cleaned;
}

export function sanitizeWafCookie(raw?: string): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/^cookie:\s*/i, '')
    .replace(/[\r\n]+/g, '; ')
    .trim();
}

function getHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isAgentRouterMainHost(urlStr: string): boolean {
  const host = getHostname(urlStr);
  return host === 'agentrouter.org' || host === 'www.agentrouter.org';
}

export function isAgentRouterFamilyHost(urlStr: string): boolean {
  const host = getHostname(urlStr);
  return (
    host === 'agentrouter.org' ||
    host === 'www.agentrouter.org' ||
    host === 'co.agentrouter.org'
  );
}

export function isAuthKeyErrorString(msg: string): boolean {
  return /invalid api key|incorrect api key|invalid token|unauthorized|authentication|无效的令牌|未提供令牌/i.test(
    msg
  );
}

function getBrowserSpoofHeadersForUrl(urlStr: string): Record<string, string> {
  if (!isAgentRouterMainHost(urlStr)) {
    return {};
  }
  // agentrouter.org sets Access-Control-Allow-Headers: *, allowing CLI SDK headers directly from browser fetch
  return {
    'X-App': 'cli',
    'X-Stainless-Helper-Method': 'stream',
    'X-Stainless-Retry-Count': '0',
    'X-Stainless-Runtime': 'node',
    'X-Stainless-Lang': 'js',
    Originator: 'codex_cli_rs',
  };
}

export function isHtmlFirewallOrPage(contentType: string, bodySample: string): boolean {
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

export function normalizeBaseUrlCandidates(raw: string): {
  v1Urls: string[];
  catalogUrls: string[];
  responsesUrls: string[];
  anthropicMessageUrls: string[];
} {
  const cleaned = sanitizeBaseUrlInput(raw);
  if (!cleaned) {
    return { v1Urls: [], catalogUrls: [], responsesUrls: [], anthropicMessageUrls: [] };
  }

  const pushUnique = (list: string[], url: string) => {
    if (url && !list.includes(url)) list.push(url);
  };

  const v1Urls: string[] = [];
  if (cleaned.endsWith('/v1')) {
    // Keep strictly the /v1 base so we never hit web root /models and trigger a firewall check
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

  const catalogUrls = buildCatalogFallbackUrls(cleaned);

  const responsesUrls: string[] = [];
  for (const base of v1Urls) {
    pushUnique(responsesUrls, `${base}/responses`);
  }

  const anthropicMessageUrls: string[] = [];
  for (const base of v1Urls) {
    pushUnique(anthropicMessageUrls, `${base}/messages`);
  }

  return { v1Urls, catalogUrls, responsesUrls, anthropicMessageUrls };
}

export function buildCatalogFallbackUrls(rawBaseUrl: string): string[] {
  const cleaned = sanitizeBaseUrlInput(rawBaseUrl);
  if (!cleaned) return [];

  const host = getHostname(cleaned);
  if (host === 'api.openai.com' || host === 'co.agentrouter.org') {
    return [];
  }

  const pushUnique = (list: string[], url: string) => {
    if (url && !list.includes(url)) list.push(url);
  };

  const baseWithoutV1 = cleaned.replace(/\/v1$/i, '');
  let originHost = '';
  try {
    originHost = new URL(cleaned).origin;
  } catch {
    originHost = baseWithoutV1;
  }

  const roots: string[] = [];
  pushUnique(roots, baseWithoutV1);
  pushUnique(roots, originHost);

  const urls: string[] = [];
  for (const root of roots) {
    pushUnique(urls, `${root}/api/pricing`);
    pushUnique(urls, `${root}/api/available_models`);
    pushUnique(urls, `${root}/api/available_model`);
  }
  return urls;
}

export function parseGatewayErrorText(
  raw: string,
  status: number,
  contentType = '',
  targetUrl = ''
): string {
  if (!raw) return `Server returned HTTP ${status}.`;
  if (isHtmlFirewallOrPage(contentType, raw)) {
    if (status === 404) {
      return 'Endpoint not found (HTTP 404). Check your Base API URL.';
    }
    const host = getHostname(targetUrl) || targetUrl.replace(/^https?:\/\//i, '').split('/')[0];
    if (host === 'agentrouter.org' || host === 'www.agentrouter.org') {
      return 'Temporary firewall check on agentrouter.org. Open agentrouter.org once in a browser tab to clear the slider, wait 30 seconds, then retry.';
    }
    const hostHint = host ? ` on ${host}` : '';
    return `Temporary web firewall check${hostHint}. Open the site once in a browser tab to clear verification, then retry.`;
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
    // Plain text
  }
  return raw.slice(0, 260);
}

export function extractGatewayErrorFromJson(
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

function modelPriorityRank(item: ModelOption): number {
  const id = item.id.toLowerCase();
  const owner = item.ownedBy.toLowerCase();
  if (id.includes('6.1-sol') || id.includes('6.1_sol')) return 0;
  if (id.includes('gpt-6') && (id.includes('astra') || id.includes('sol'))) return 1;
  if (id.includes('gpt-6')) return 2;
  if (id.includes('5.4-sol') || id.includes('-sol') || id.includes('-astra')) return 3;
  if (id.includes('codex') || id.startsWith('gpt-5')) return 4;
  if (id.startsWith('gpt-') || /^o[134](-|$)/.test(id) || owner === 'openai') return 5;
  if (id.startsWith('claude') || owner === 'anthropic') return 9;
  return 7;
}

export function extractModelsFromPayload(payload: unknown): {
  models: ModelOption[];
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

  const reservedKeys = new Set([
    'object',
    'total',
    'page',
    'limit',
    'has_more',
    'code',
    'msg',
    'message',
    'success',
    'status',
    'group_ratio',
    'usable_group',
    'auto_groups',
    'vendors',
    'supported_endpoint',
  ]);

  const appendObjectMapEntries = (mapObj: Record<string, any>) => {
    const entries = Object.entries(mapObj).filter(([k]) => !reservedKeys.has(k));
    for (const [key, val] of entries) {
      if (Array.isArray(val)) {
        for (const sub of val) {
          rawList.push(sub);
        }
      } else if (val && typeof val === 'object') {
        const valObj = val as Record<string, unknown>;
        const existingStrId =
          typeof valObj.id === 'string' && valObj.id.trim() && !/^\d+$/.test(valObj.id.trim())
            ? valObj.id.trim()
            : key;
        rawList.push({ ...valObj, id: existingStrId });
      } else if (typeof val === 'string' && !/^\d+$/.test(key)) {
        rawList.push(key);
      } else if (val === true && !/^\d+$/.test(key)) {
        rawList.push(key);
      }
    }
  };

  if (Array.isArray(payload)) {
    rawList = payload;
  } else if (Array.isArray(obj.data)) {
    rawList = obj.data;
  } else if (Array.isArray(obj.available_models)) {
    rawList = obj.available_models;
  } else if (Array.isArray(obj.availableModels)) {
    rawList = obj.availableModels;
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
  } else if (obj.pricing && typeof obj.pricing === 'object') {
    appendObjectMapEntries(obj.pricing as Record<string, any>);
  } else if (obj.available_models && typeof obj.available_models === 'object') {
    appendObjectMapEntries(obj.available_models as Record<string, any>);
  } else if (obj.availableModels && typeof obj.availableModels === 'object') {
    appendObjectMapEntries(obj.availableModels as Record<string, any>);
  } else if (obj.data && typeof obj.data === 'object') {
    const nested = obj.data as Record<string, any>;
    if (Array.isArray(nested.data)) {
      rawList = nested.data;
    } else if (Array.isArray(nested.available_models)) {
      rawList = nested.available_models;
    } else if (Array.isArray(nested.availableModels)) {
      rawList = nested.availableModels;
    } else if (Array.isArray(nested.models)) {
      rawList = nested.models;
    } else if (Array.isArray(nested.pricing)) {
      rawList = nested.pricing;
    } else if (Array.isArray(nested.items)) {
      rawList = nested.items;
    } else if (Array.isArray(nested.list)) {
      rawList = nested.list;
    } else {
      appendObjectMapEntries(nested);
    }
  } else if (payload && typeof payload === 'object') {
    appendObjectMapEntries(obj);
  }

  const seen = new Set<string>();
  const syncedModels: ModelOption[] = [];

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
    const candidateIds = [
      item.model_name,
      item.model_id,
      item.model,
      item.id,
      item.slug,
      item.key,
      item.name,
      item.value,
    ];
    let id = '';
    for (const candidate of candidateIds) {
      if (candidate === undefined || candidate === null) continue;
      const trimmed = String(candidate).trim();
      if (trimmed && !/^\d+$/.test(trimmed)) {
        id = trimmed;
        break;
      }
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const rawOwner = String(
      item.owned_by || item.provider || item.vendor || item.owner_by || ''
    ).trim();
    const ownedBy = inferModelOwner(id, rawOwner);
    const rawLabel = String(
      item.display_name || item.label || item.model_name || item.name || id
    ).trim();
    const label = rawLabel && !/^\d+$/.test(rawLabel) ? rawLabel : id;
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

export type ReasoningEffortMode = 'low' | 'medium';

export function isReasoningStyleModel(model: string): boolean {
  return /codex|gpt-[56]|\bsol\b|-sol\b|_sol\b|\bastra\b|-astra\b|_astra\b|\bluna\b|-luna\b|\bterra\b|-terra\b|^o[134]\b|\/o[134]\b|-o[134]\b/i.test(
    model
  );
}

function shouldPreferResponsesEndpoint(model: string): boolean {
  return /codex/i.test(model);
}

export function isFirewallErrorString(msg: string): boolean {
  return /firewall|slider|aliyun_waf/i.test(msg);
}

export function isLocalOnlyBaseUrl(rawBaseUrl: string): boolean {
  const host = getHostname(sanitizeBaseUrlInput(rawBaseUrl));
  if (!host) return false;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^10\.\d+\.\d+\.\d+$/.test(host)
  );
}

function isEndpointMismatchError(status: number, message: string): boolean {
  if (status === 401 || status === 402 || status === 403 || status === 429) {
    return false;
  }
  if (status === 404 || status === 405 || status >= 500) return true;
  if (status === 400 || status === 422) {
    return /responses|endpoint|messages|wire_api|channel|无可用渠道|not supported|only supported|unsupported|v1\/responses|v1\/messages/i.test(
      message
    );
  }
  return false;
}

function isReasoningParamRejectedError(status: number, message: string): boolean {
  if (status !== 400 && status !== 422) return false;
  return /reasoning_effort|reasoning\.effort|\breasoning\b|unknown parameter|unrecognized request argument|extra_forbidden|additional properties/i.test(
    message
  );
}

interface CachedBrowserRoute {
  transport: 'direct' | 'proxy';
  protocol?: BrowserWireProtocol;
  endpointUrl?: string;
}

const browserRouteCache = new Map<string, CachedBrowserRoute>();
const unsupportedReasoningParamCache = new Set<string>();

/**
 * Attempts to fetch and parse model lists from `/api/pricing` or `/api/available_models`
 * on the user's Base API URL when `/v1/models` returns 0 results.
 */
export async function fetchCatalogFallbackModels(
  baseUrl: string,
  rawApiKey: string,
  rawWafCookie?: string,
  shareId?: string
): Promise<GatewaySyncResponse> {
  const cleanShareId = (shareId || '').trim();
  if (cleanShareId) {
    try {
      const res = await fetch('/api/models/catalog', {
        headers: {
          'x-vellum-share-id': cleanShareId,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return {
          models: Array.isArray(data.models) ? data.models : [],
          sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : null,
          gatewayMessage: typeof data.gatewayMessage === 'string' ? data.gatewayMessage : undefined,
          share: data.share as SharedKeyLinkSummary | undefined,
        };
      }
    } catch {
      // Ignore fallback error
    }
    return { models: [], sourceUrl: null };
  }

  const apiKey = sanitizeApiKey(rawApiKey);
  const cleanBase = sanitizeBaseUrlInput(baseUrl);
  const wafCookie = sanitizeWafCookie(rawWafCookie);
  const { v1Urls } = normalizeBaseUrlCandidates(cleanBase);
  const catalogUrls = buildCatalogFallbackUrls(cleanBase);

  if (catalogUrls.length === 0) {
    return { models: [], sourceUrl: v1Urls[0] || null };
  }

  const isMainAgentRouter = isAgentRouterMainHost(cleanBase);

  // 1. Direct browser attempt on /api/pricing and /api/available_models (stops immediately if HTML firewall appears)
  if (!wafCookie) {
    let stopBrowserCatalog = false;

    for (const catalogUrl of catalogUrls) {
      if (stopBrowserCatalog) break;

      const isPricingRoute = /\/api\/pricing$/i.test(catalogUrl);
      const headerAttempts: Array<Record<string, string> | undefined> = isMainAgentRouter
        ? [undefined]
        : isPricingRoute
          ? [undefined, { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }]
          : [{ Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, undefined];

      for (const hdrs of headerAttempts) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        try {
          const res = await fetch(catalogUrl, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            ...(hdrs ? { headers: hdrs } : {}),
            signal: controller.signal,
          });
          clearTimeout(timer);

          const ct = res.headers.get('content-type') || '';
          const rawText = await res.text().catch(() => '');

          if (isHtmlFirewallOrPage(ct, rawText) && res.status !== 404) {
            stopBrowserCatalog = true;
            break;
          }

          if (!res.ok || !rawText) continue;

          const parsed = JSON.parse(rawText);
          if (extractGatewayErrorFromJson(parsed)) continue;

          const { models, gatewayMessage } = extractModelsFromPayload(parsed);
          if (models.length > 0) {
            return {
              models,
              sourceUrl: v1Urls[0] || catalogUrl,
              gatewayMessage,
            };
          }
        } catch {
          clearTimeout(timer);
          if (isMainAgentRouter) {
            stopBrowserCatalog = true;
          }
          // Network/CORS failure on this URL in browser — skip duplicate header attempt and let proxy try
          break;
        }
      }
    }
  }

  // 2. Backend proxy fallback (/api/models/catalog) for gateways without CORS on /api/pricing or /api/available_models
  if (!isMainAgentRouter || Boolean(wafCookie)) {
    try {
      const res = await fetch('/api/models/catalog', {
        headers: {
          'x-agentrouter-key': apiKey,
          'x-agentrouter-base-url': cleanBase,
          ...(wafCookie ? { 'x-agentrouter-cookie': wafCookie } : {}),
        },
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const proxyModels = Array.isArray(data.models) ? data.models : [];
        if (proxyModels.length > 0) {
          return {
            models: proxyModels,
            sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : v1Urls[0] || null,
            gatewayMessage:
              typeof data.gatewayMessage === 'string' ? data.gatewayMessage : undefined,
          };
        }
      }
    } catch {
      // Ignore proxy catalog errors so caller can continue cleanly
    }
  }

  return { models: [], sourceUrl: v1Urls[0] || null };
}

/**
 * Syncs models from the primary `/v1/models` endpoint on the user's Base API URL
 * or via a disguised shared pass (`x-vellum-share-id`).
 */
export async function syncModelsFromGateway(
  baseUrl: string,
  rawApiKey: string,
  rawWafCookie?: string,
  shareId?: string
): Promise<GatewaySyncResponse> {
  const cleanShareId = (shareId || '').trim();
  if (cleanShareId) {
    const res = await fetch('/api/models', {
      headers: {
        'x-vellum-share-id': cleanShareId,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(String(data.error || `Failed to sync models (${res.status})`)) as Error & {
        share?: SharedKeyLinkSummary;
      };
      if (data.share) {
        err.share = data.share as SharedKeyLinkSummary;
      }
      throw err;
    }
    return {
      models: Array.isArray(data.models) ? data.models : [],
      sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : null,
      gatewayMessage: typeof data.gatewayMessage === 'string' ? data.gatewayMessage : undefined,
      verifiedResults:
        data.verifiedResults && typeof data.verifiedResults === 'object'
          ? data.verifiedResults
          : undefined,
      share: data.share as SharedKeyLinkSummary | undefined,
    };
  }

  const apiKey = sanitizeApiKey(rawApiKey);
  const cleanBase = sanitizeBaseUrlInput(baseUrl);
  const wafCookie = sanitizeWafCookie(rawWafCookie);
  const { v1Urls } = normalizeBaseUrlCandidates(cleanBase);

  if (!v1Urls.length) {
    throw new Error('Enter your Base API URL first.');
  }
  if (!apiKey) {
    throw new Error('Enter your API key first.');
  }

  const callServerProxy = async (): Promise<GatewaySyncResponse> => {
    const res = await fetch('/api/models', {
      headers: {
        'x-agentrouter-key': apiKey,
        'x-agentrouter-base-url': cleanBase,
        ...(wafCookie ? { 'x-agentrouter-cookie': wafCookie } : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Failed to sync models (${res.status})`);
    }
    return {
      models: Array.isArray(data.models) ? data.models : [],
      sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : null,
      gatewayMessage: typeof data.gatewayMessage === 'string' ? data.gatewayMessage : undefined,
      verifiedResults:
        data.verifiedResults && typeof data.verifiedResults === 'object'
          ? data.verifiedResults
          : undefined,
    };
  };

  if (wafCookie) {
    return callServerProxy();
  }

  let directConnectedBase: string | null = null;
  let directGatewayNotice: string | undefined;
  let definitiveAuthError: string | null = null;
  let directHitFirewall = false;
  let lastDirectError = 'Unable to sync models from your Base API URL.';

  // Stage 1: Single clean browser GET /v1/models
  for (const candidateBase of v1Urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(`${candidateBase}/models`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...getBrowserSpoofHeadersForUrl(candidateBase),
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      const contentType = res.headers.get('content-type') || '';
      const rawBody = await res.text().catch(() => '');

      if (isHtmlFirewallOrPage(contentType, rawBody)) {
        directHitFirewall = true;
        lastDirectError = parseGatewayErrorText(rawBody, res.status, contentType, candidateBase);
        continue;
      }

      if (!res.ok) {
        lastDirectError = parseGatewayErrorText(rawBody, res.status, contentType, candidateBase);
        if (
          res.status === 401 &&
          /invalid api key|incorrect api key|无效的令牌|未提供令牌/i.test(lastDirectError)
        ) {
          definitiveAuthError = lastDirectError;
          break;
        }
        continue;
      }

      const payload = JSON.parse(rawBody);
      const gwErr = extractGatewayErrorFromJson(payload);
      if (gwErr) {
        lastDirectError = gwErr.message;
        if (
          gwErr.status === 401 &&
          /invalid api key|incorrect api key|无效的令牌|未提供令牌/i.test(gwErr.message)
        ) {
          definitiveAuthError = gwErr.message;
          break;
        }
        continue;
      }

      const { models, gatewayMessage } = extractModelsFromPayload(payload);
      directConnectedBase = directConnectedBase || candidateBase;
      if (gatewayMessage) {
        directGatewayNotice = gatewayMessage;
      }

      if (models.length > 0) {
        return {
          models,
          sourceUrl: candidateBase,
          gatewayMessage,
        };
      }
      break;
    } catch {
      clearTimeout(timer);
    }
  }

  // Cross-check sibling AgentRouter domain before treating 401 or 0-model response as final
  if (isAgentRouterMainHost(cleanBase)) {
    try {
      const coCtrl = new AbortController();
      const coTimer = setTimeout(() => coCtrl.abort(), 6000);
      const coRes = await fetch('https://co.agentrouter.org/v1/models', {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: coCtrl.signal,
      });
      clearTimeout(coTimer);
      if (coRes.ok) {
        const coText = await coRes.text().catch(() => '');
        if (coText && !isHtmlFirewallOrPage(coRes.headers.get('content-type') || '', coText)) {
          const coJson = JSON.parse(coText);
          if (!extractGatewayErrorFromJson(coJson)) {
            const { models: coModels, gatewayMessage: coMsg } = extractModelsFromPayload(coJson);
            if (coModels.length > 0) {
              return {
                models: coModels,
                sourceUrl: 'https://co.agentrouter.org/v1',
                gatewayMessage: coMsg,
              };
            }
          }
        }
      }
    } catch {
      // Ignore co.agentrouter.org check errors
    }

    if (definitiveAuthError) {
      throw new Error(definitiveAuthError);
    }

    // Return 0 models here so syncModelsForKey runs its /api/pricing & /api/available_models fallback next
    return {
      models: [],
      sourceUrl: directConnectedBase || v1Urls[0],
      gatewayMessage: directGatewayNotice,
    };
  }

  if (getHostname(cleanBase) === 'co.agentrouter.org' && definitiveAuthError) {
    try {
      const arCtrl = new AbortController();
      const arTimer = setTimeout(() => arCtrl.abort(), 6500);
      const arRes = await fetch('https://agentrouter.org/v1/models', {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...getBrowserSpoofHeadersForUrl('https://agentrouter.org/v1'),
        },
        signal: arCtrl.signal,
      });
      clearTimeout(arTimer);
      const arCt = arRes.headers.get('content-type') || '';
      const arText = await arRes.text().catch(() => '');
      if (arRes.ok && arText && !isHtmlFirewallOrPage(arCt, arText)) {
        const arJson = JSON.parse(arText);
        if (!extractGatewayErrorFromJson(arJson)) {
          const { models: arModels, gatewayMessage: arMsg } = extractModelsFromPayload(arJson);
          return {
            models: arModels.length > 0 ? arModels : AGENTROUTER_OPENAI_MODELS.map((m) => ({ ...m })),
            sourceUrl: 'https://agentrouter.org/v1',
            gatewayMessage: arMsg,
          };
        }
      }
    } catch {
      // Ignore sibling check failure
    }
  }

  if (definitiveAuthError) {
    throw new Error(definitiveAuthError);
  }

  // Backend proxy (/api/models) for /v1/models when browser had CORS/transport block
  if (!directConnectedBase && !directHitFirewall) {
    let proxyError: Error | null = null;
    try {
      const proxyResult = await callServerProxy();
      if (proxyResult.models.length > 0) {
        return proxyResult;
      }
      if (proxyResult.sourceUrl) {
        directConnectedBase = proxyResult.sourceUrl;
      }
      if (!directGatewayNotice && proxyResult.gatewayMessage) {
        directGatewayNotice = proxyResult.gatewayMessage;
      }
    } catch (err: unknown) {
      proxyError = err instanceof Error ? err : new Error(lastDirectError);
    }

    if (!directConnectedBase && proxyError && !isFirewallErrorString(proxyError.message)) {
      throw proxyError;
    }
  }

  if (directConnectedBase) {
    return {
      models: [],
      sourceUrl: directConnectedBase,
      gatewayMessage: directGatewayNotice,
    };
  }

  throw new Error(lastDirectError);
}

async function openDirectBrowserStream(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatPayloadMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffortMode;
  signal: AbortSignal;
}): Promise<
  | { kind: 'ok'; response: Response; protocol: BrowserWireProtocol; endpointUrl: string }
  | { kind: 'api_error'; status: number; message: string }
  | { kind: 'firewall_error'; message: string }
  | { kind: 'transport_error'; message?: string }
> {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    systemPrompt,
    temperature,
    maxTokens,
    reasoningEffort,
    signal,
  } = params;

  const { v1Urls, responsesUrls, anthropicMessageUrls } = normalizeBaseUrlCandidates(baseUrl);
  const reasoningModel = isReasoningStyleModel(model);
  const preferResponsesFirst = shouldPreferResponsesEndpoint(model);
  const routeKey = `${baseUrl}::${model}`;

  const state: {
    hitFirewallMsg: string | null;
    lastJsonError: { status: number; message: string } | null;
  } = {
    hitFirewallMsg: null,
    lastJsonError: null,
  };

  const openAiMessages: ChatPayloadMessage[] = [];
  if (systemPrompt && systemPrompt.trim()) {
    openAiMessages.push({ role: 'system', content: systemPrompt.trim() });
  }
  for (const m of messages) {
    openAiMessages.push({ role: m.role, content: String(m.content || '') });
  }

  const tryOpenAiChatUrl = async (chatUrl: string): Promise<Response | null> => {
    const canSendEffort =
      reasoningModel &&
      reasoningEffort === 'low' &&
      !unsupportedReasoningParamCache.has(routeKey);

    const sendChatPost = async (includeEffort: boolean): Promise<Response> =>
      fetch(chatUrl, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
          Authorization: `Bearer ${apiKey}`,
          ...getBrowserSpoofHeadersForUrl(chatUrl),
        },
        body: JSON.stringify({
          model,
          messages: openAiMessages,
          stream: true,
          ...(includeEffort ? { reasoning_effort: 'low' } : {}),
          ...(typeof temperature === 'number' && !reasoningModel ? { temperature } : {}),
          ...(typeof maxTokens === 'number'
            ? reasoningModel
              ? { max_completion_tokens: maxTokens }
              : { max_tokens: maxTokens }
            : {}),
        }),
        signal,
      });

    try {
      let res = await sendChatPost(canSendEffort);
      let ct = res.headers.get('content-type') || '';

      if (res.ok && res.body) {
        if (isHtmlFirewallOrPage(ct, '')) {
          const htmlBody = await res.text().catch(() => '');
          state.hitFirewallMsg = parseGatewayErrorText(htmlBody, res.status, ct, chatUrl);
          return null;
        }
        return res;
      }

      let errBody = await res.text().catch(() => '');
      if (isHtmlFirewallOrPage(ct, errBody)) {
        state.hitFirewallMsg = parseGatewayErrorText(errBody, res.status, ct, chatUrl);
        return null;
      }

      let parsedMsg = parseGatewayErrorText(errBody, res.status, ct, chatUrl);

      if (canSendEffort && isReasoningParamRejectedError(res.status, parsedMsg)) {
        unsupportedReasoningParamCache.add(routeKey);
        res = await sendChatPost(false);
        ct = res.headers.get('content-type') || '';
        if (res.ok && res.body && !isHtmlFirewallOrPage(ct, '')) {
          return res;
        }
        errBody = await res.text().catch(() => '');
        parsedMsg = parseGatewayErrorText(errBody, res.status, ct, chatUrl);
      }

      state.lastJsonError = { status: res.status || 502, message: parsedMsg };
    } catch (err: unknown) {
      if (signal.aborted) throw err;
    }
    return null;
  };

  const tryOpenAiChat = async (
    targetBases: string[]
  ): Promise<{ response: Response; endpointUrl: string } | null> => {
    for (const candidateBase of targetBases) {
      const chatUrl = `${candidateBase}/chat/completions`;
      const res = await tryOpenAiChatUrl(chatUrl);
      if (res) return { response: res, endpointUrl: chatUrl };
      if (state.hitFirewallMsg) break;
    }
    return null;
  };

  const tryOpenAiResponsesUrl = async (respUrl: string): Promise<Response | null> => {
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

    const canSendReasoning =
      reasoningModel && !unsupportedReasoningParamCache.has(routeKey);

    const sendRespPost = async (includeReasoning: boolean): Promise<Response> =>
      fetch(respUrl, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
          Authorization: `Bearer ${apiKey}`,
          ...getBrowserSpoofHeadersForUrl(respUrl),
        },
        body: JSON.stringify({
          model,
          ...(systemPrompt && systemPrompt.trim() ? { instructions: systemPrompt.trim() } : {}),
          input: responsesInput,
          stream: true,
          ...(includeReasoning
            ? {
                reasoning: {
                  effort: reasoningEffort === 'low' ? 'low' : 'medium',
                  summary: 'auto',
                },
              }
            : {}),
          ...(typeof temperature === 'number' && !reasoningModel ? { temperature } : {}),
          ...(typeof maxTokens === 'number' ? { max_output_tokens: maxTokens } : {}),
        }),
        signal,
      });

    try {
      let res = await sendRespPost(canSendReasoning);
      let ct = res.headers.get('content-type') || '';

      if (res.ok && res.body) {
        if (isHtmlFirewallOrPage(ct, '')) {
          const htmlBody = await res.text().catch(() => '');
          state.hitFirewallMsg = parseGatewayErrorText(htmlBody, res.status, ct, respUrl);
          return null;
        }
        return res;
      }

      let errBody = await res.text().catch(() => '');
      if (isHtmlFirewallOrPage(ct, errBody)) {
        state.hitFirewallMsg = parseGatewayErrorText(errBody, res.status, ct, respUrl);
        return null;
      }

      let parsedMsg = parseGatewayErrorText(errBody, res.status, ct, respUrl);

      if (
        canSendReasoning &&
        (isReasoningParamRejectedError(res.status, parsedMsg) ||
          (res.status === 400 && /summary|reasoning/i.test(parsedMsg)))
      ) {
        unsupportedReasoningParamCache.add(routeKey);
        res = await sendRespPost(false);
        ct = res.headers.get('content-type') || '';
        if (res.ok && res.body && !isHtmlFirewallOrPage(ct, '')) {
          return res;
        }
        errBody = await res.text().catch(() => '');
        parsedMsg = parseGatewayErrorText(errBody, res.status, ct, respUrl);
      }

      if (!state.lastJsonError) {
        state.lastJsonError = { status: res.status || 502, message: parsedMsg };
      }
    } catch (err: unknown) {
      if (signal.aborted) throw err;
    }
    return null;
  };

  const tryOpenAiResponses = async (
    targetRespUrls: string[]
  ): Promise<{ response: Response; endpointUrl: string } | null> => {
    for (const respUrl of targetRespUrls) {
      const res = await tryOpenAiResponsesUrl(respUrl);
      if (res) return { response: res, endpointUrl: respUrl };
      if (state.hitFirewallMsg) break;
    }
    return null;
  };

  const tryAnthropicUrl = async (msgUrl: string): Promise<Response | null> => {
    const anthropicMessages = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: String(m.content || '') }));

    try {
      const res = await fetch(msgUrl, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
          'x-api-key': apiKey,
          Authorization: `Bearer ${apiKey}`,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          ...getBrowserSpoofHeadersForUrl(msgUrl),
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
      });

      const ct = res.headers.get('content-type') || '';
      if (res.ok && res.body && !isHtmlFirewallOrPage(ct, '')) {
        return res;
      }
    } catch (err: unknown) {
      if (signal.aborted) throw err;
    }
    return null;
  };

  // Fast path: if we already discovered the exact working direct URL & protocol for this baseUrl+model, try it first
  const cached = browserRouteCache.get(routeKey);
  if (cached?.transport === 'direct' && cached.endpointUrl && cached.protocol) {
    if (cached.protocol === 'openai-chat') {
      const fastRes = await tryOpenAiChatUrl(cached.endpointUrl);
      if (fastRes) {
        return {
          kind: 'ok',
          response: fastRes,
          protocol: 'openai-chat',
          endpointUrl: cached.endpointUrl,
        };
      }
    } else if (cached.protocol === 'openai-responses') {
      const fastRes = await tryOpenAiResponsesUrl(cached.endpointUrl);
      if (fastRes) {
        return {
          kind: 'ok',
          response: fastRes,
          protocol: 'openai-responses',
          endpointUrl: cached.endpointUrl,
        };
      }
    } else if (cached.protocol === 'anthropic') {
      const fastRes = await tryAnthropicUrl(cached.endpointUrl);
      if (fastRes) {
        return {
          kind: 'ok',
          response: fastRes,
          protocol: 'anthropic',
          endpointUrl: cached.endpointUrl,
        };
      }
    }
    browserRouteCache.delete(routeKey);
  }

  const shouldTrySecondaryProtocol = () => {
    if (state.hitFirewallMsg) return false;
    if (!state.lastJsonError) return false;
    return isEndpointMismatchError(state.lastJsonError.status, state.lastJsonError.message);
  };

  if (preferResponsesFirst) {
    const rHit = await tryOpenAiResponses(responsesUrls);
    if (rHit) {
      return {
        kind: 'ok',
        response: rHit.response,
        protocol: 'openai-responses',
        endpointUrl: rHit.endpointUrl,
      };
    }
    if (shouldTrySecondaryProtocol()) {
      const cHit = await tryOpenAiChat(v1Urls);
      if (cHit) {
        return {
          kind: 'ok',
          response: cHit.response,
          protocol: 'openai-chat',
          endpointUrl: cHit.endpointUrl,
        };
      }
    }
  } else {
    const cHit = await tryOpenAiChat(v1Urls);
    if (cHit) {
      return {
        kind: 'ok',
        response: cHit.response,
        protocol: 'openai-chat',
        endpointUrl: cHit.endpointUrl,
      };
    }
    if (shouldTrySecondaryProtocol()) {
      const rHit = await tryOpenAiResponses(responsesUrls);
      if (rHit) {
        return {
          kind: 'ok',
          response: rHit.response,
          protocol: 'openai-responses',
          endpointUrl: rHit.endpointUrl,
        };
      }
    }
  }

  // Only try /v1/messages when endpoint mismatch occurred on agentrouter.org
  if (
    shouldTrySecondaryProtocol() &&
    isAgentRouterMainHost(baseUrl) &&
    anthropicMessageUrls.length > 0
  ) {
    for (const msgUrl of anthropicMessageUrls) {
      const mRes = await tryAnthropicUrl(msgUrl);
      if (mRes) {
        return { kind: 'ok', response: mRes, protocol: 'anthropic', endpointUrl: msgUrl };
      }
    }
  }

  // Cross-check sibling AgentRouter domain in browser if primary hit firewall or 401 key mismatch,
  // while preserving the original error if the sibling also rejects the request.
  const isMainAr = isAgentRouterMainHost(baseUrl);
  const isCoAr = getHostname(baseUrl) === 'co.agentrouter.org';
  const hadAuthMismatch = state.lastJsonError?.status === 401;

  if ((isMainAr && (state.hitFirewallMsg || hadAuthMismatch)) || (isCoAr && hadAuthMismatch)) {
    const savedFirewallMsg = state.hitFirewallMsg;
    const savedJsonError = state.lastJsonError;
    state.hitFirewallMsg = null;
    state.lastJsonError = null;

    const siblingBase = isMainAr ? 'https://co.agentrouter.org/v1' : 'https://agentrouter.org/v1';
    const siblingRespUrl = `${siblingBase}/responses`;

    if (preferResponsesFirst) {
      const sibResp = await tryOpenAiResponses([siblingRespUrl]);
      if (sibResp) {
        return {
          kind: 'ok',
          response: sibResp.response,
          protocol: 'openai-responses',
          endpointUrl: sibResp.endpointUrl,
        };
      }
      if (shouldTrySecondaryProtocol()) {
        const sibChat = await tryOpenAiChat([siblingBase]);
        if (sibChat) {
          return {
            kind: 'ok',
            response: sibChat.response,
            protocol: 'openai-chat',
            endpointUrl: sibChat.endpointUrl,
          };
        }
      }
    } else {
      const sibChat = await tryOpenAiChat([siblingBase]);
      if (sibChat) {
        return {
          kind: 'ok',
          response: sibChat.response,
          protocol: 'openai-chat',
          endpointUrl: sibChat.endpointUrl,
        };
      }
      if (shouldTrySecondaryProtocol()) {
        const sibResp = await tryOpenAiResponses([siblingRespUrl]);
        if (sibResp) {
          return {
            kind: 'ok',
            response: sibResp.response,
            protocol: 'openai-responses',
            endpointUrl: sibResp.endpointUrl,
          };
        }
      }
    }

    state.hitFirewallMsg = savedFirewallMsg;
    state.lastJsonError = savedJsonError;
  }

  if (state.lastJsonError) {
    return {
      kind: 'api_error',
      status: state.lastJsonError.status,
      message: state.lastJsonError.message,
    };
  }

  if (state.hitFirewallMsg) {
    return { kind: 'firewall_error', message: state.hitFirewallMsg };
  }

  return { kind: 'transport_error' };
}

function extractResponsesArrayText(
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

export async function consumeWireStream(
  upstream: Response,
  protocol: BrowserWireProtocol,
  callbacks: {
    onContent: (chunk: string) => void;
    onThinking: (chunk: string) => void;
  }
): Promise<void> {
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
      extractResponsesArrayText(json.output, callbacks);
      return;
    }

    const openAiReasoning =
      json?.choices?.[0]?.message?.reasoning_content ??
      json?.choices?.[0]?.message?.reasoning ??
      json?.data?.choices?.[0]?.message?.reasoning_content;
    if (typeof openAiReasoning === 'string' && openAiReasoning) {
      callbacks.onThinking(openAiReasoning);
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

    if (protocol === 'anthropic') {
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
      return;
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
        if (extractResponsesArrayText([packet.item], callbacks)) {
          emittedContent = true;
        }
        return;
      }
      if (packet?.type === 'response.completed' && !emittedContent) {
        const out = packet?.response?.output;
        if (Array.isArray(out) && extractResponsesArrayText(out, callbacks)) {
          emittedContent = true;
        }
        return;
      }
      if (packet?.type === 'response.failed') {
        throw new Error(
          packet?.response?.error?.message || 'OpenAI Responses stream failed.'
        );
      }
    }

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
    } else if (typeof delta.reasoning === 'string' && delta.reasoning) {
      callbacks.onThinking(delta.reasoning);
    } else if (typeof delta.thinking === 'string' && delta.thinking) {
      callbacks.onThinking(delta.thinking);
    } else if (typeof delta.thought === 'string' && delta.thought) {
      callbacks.onThinking(delta.thought);
    }

    if (typeof delta.content === 'string' && delta.content) {
      emittedContent = true;
      callbacks.onContent(delta.content);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    let chunkContent = '';
    let chunkThinking = '';
    const chunkCallbacks = {
      onContent: (c: string) => {
        chunkContent += c;
      },
      onThinking: (t: string) => {
        chunkThinking += t;
      },
    };

    for (const rawLine of lines) {
      processLineWithCallbacks(rawLine, chunkCallbacks);
    }

    if (chunkThinking) callbacks.onThinking(chunkThinking);
    if (chunkContent) callbacks.onContent(chunkContent);
  }

  if (buffer.trim()) {
    processLineWithCallbacks(buffer, callbacks);
  }

  function processLineWithCallbacks(
    rawLine: string,
    targetCallbacks: { onContent: (chunk: string) => void; onThinking: (chunk: string) => void }
  ) {
    const savedCallbacks = callbacks;
    callbacks = targetCallbacks;
    try {
      processLine(rawLine);
    } finally {
      callbacks = savedCallbacks;
    }
  }
}

export async function testModelOnGateway(params: {
  baseUrl: string;
  rawApiKey: string;
  rawWafCookie?: string;
  shareId?: string;
  onShareUpdated?: (share: SharedKeyLinkSummary) => void;
  model: string;
}): Promise<{ ok: boolean; durationMs: number; reply?: string; error?: string }> {
  const cleanShareId = (params.shareId || '').trim();
  const apiKey = sanitizeApiKey(params.rawApiKey);
  const cleanBase = sanitizeBaseUrlInput(params.baseUrl);
  const wafCookie = sanitizeWafCookie(params.rawWafCookie);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 16000);
  const reasoningModel = isReasoningStyleModel(params.model);
  const testMaxTokens = reasoningModel ? 64 : 16;

  let browserDirectError: string | null = null;

  try {
    if (!cleanShareId && !wafCookie) {
      const direct = await openDirectBrowserStream({
        baseUrl: cleanBase,
        apiKey,
        model: params.model,
        messages: [{ role: 'user', content: 'Reply with only the single word: Ready' }],
        maxTokens: testMaxTokens,
        reasoningEffort: 'low',
        signal: controller.signal,
      });

      if (direct.kind === 'ok') {
        browserRouteCache.set(`${cleanBase}::${params.model}`, {
          transport: 'direct',
          protocol: direct.protocol,
          endpointUrl: direct.endpointUrl,
        });
        let replyText = '';
        let thinkingText = '';
        await consumeWireStream(direct.response, direct.protocol, {
          onContent: (c) => {
            replyText += c;
          },
          onThinking: (c) => {
            thinkingText += c;
          },
        });
        clearTimeout(timeout);
        return {
          ok: true,
          durationMs: Date.now() - startedAt,
          reply: (replyText.trim() || thinkingText.trim() || 'Connected').slice(0, 60),
        };
      }

      if (direct.kind === 'api_error') {
        browserDirectError = direct.message;
        if (direct.status !== 401 && direct.status !== 403) {
          clearTimeout(timeout);
          return {
            ok: false,
            durationMs: Date.now() - startedAt,
            error: direct.message,
          };
        }
      } else if (direct.kind === 'firewall_error') {
        browserDirectError = direct.message;
      }
    }

    const res = await fetch('/api/models/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cleanShareId
          ? { 'x-vellum-share-id': cleanShareId }
          : {
              'x-agentrouter-key': apiKey,
              'x-agentrouter-base-url': cleanBase,
              ...(wafCookie ? { 'x-agentrouter-cookie': wafCookie } : {}),
            }),
      },
      body: JSON.stringify({ model: params.model }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json().catch(() => ({}));

    if (data?.share && params.onShareUpdated) {
      params.onShareUpdated(data.share as SharedKeyLinkSummary);
    }

    if (data.ok && !cleanShareId) {
      browserRouteCache.set(`${cleanBase}::${params.model}`, { transport: 'proxy' });
    }

    if (!data.ok && browserDirectError && isFirewallErrorString(String(data.error || ''))) {
      return {
        ok: false,
        durationMs: Date.now() - startedAt,
        error: browserDirectError,
      };
    }

    return {
      ok: Boolean(data.ok),
      durationMs: data.durationMs || Date.now() - startedAt,
      reply: data.reply,
      error: data.error,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      error:
        browserDirectError ||
        (err instanceof Error && err.name === 'AbortError'
          ? 'Timed out after 16s'
          : err instanceof Error
            ? err.message
            : 'Model test failed'),
    };
  }
}

export async function streamChatFromGateway(params: {
  baseUrl: string;
  rawApiKey: string;
  rawWafCookie?: string;
  shareId?: string;
  model: string;
  messages: ChatPayloadMessage[];
  systemPrompt?: string;
  temperature?: number;
  reasoningEffort?: ReasoningEffortMode;
  signal: AbortSignal;
  onContent: (chunk: string) => void;
  onThinking: (chunk: string) => void;
}): Promise<void> {
  const cleanShareId = (params.shareId || '').trim();
  const apiKey = sanitizeApiKey(params.rawApiKey);
  const cleanBase = sanitizeBaseUrlInput(params.baseUrl);
  const wafCookie = sanitizeWafCookie(params.rawWafCookie);
  const routeKey = `${cleanShareId || cleanBase}::${params.model}`;
  const cachedRoute = browserRouteCache.get(routeKey);

  let browserDirectError: string | null = null;

  if (!cleanShareId && !wafCookie && cachedRoute?.transport !== 'proxy') {
    const direct = await openDirectBrowserStream({
      baseUrl: cleanBase,
      apiKey,
      model: params.model,
      messages: params.messages,
      systemPrompt: params.systemPrompt,
      temperature: params.temperature,
      reasoningEffort: params.reasoningEffort,
      signal: params.signal,
    });

    if (direct.kind === 'ok') {
      browserRouteCache.set(routeKey, {
        transport: 'direct',
        protocol: direct.protocol,
        endpointUrl: direct.endpointUrl,
      });
      await consumeWireStream(direct.response, direct.protocol, {
        onContent: params.onContent,
        onThinking: params.onThinking,
      });
      return;
    }

    if (direct.kind === 'api_error') {
      browserDirectError = direct.message;
      if (direct.status !== 401 && direct.status !== 403) {
        throw new Error(direct.message);
      }
    } else if (direct.kind === 'firewall_error') {
      browserDirectError = direct.message;
    }
  }

  const res = await fetch('/api/agent/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cleanShareId
        ? { 'x-vellum-share-id': cleanShareId }
        : {
            'x-agentrouter-key': apiKey,
            'x-agentrouter-base-url': cleanBase,
            ...(wafCookie ? { 'x-agentrouter-cookie': wafCookie } : {}),
          }),
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      systemPrompt: params.systemPrompt,
      temperature: params.temperature,
      reasoningEffort: params.reasoningEffort,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    if (cachedRoute?.transport === 'proxy') {
      browserRouteCache.delete(routeKey);
    }
    const errJson = await res.json().catch(() => ({}));
    const proxyMsg = String(errJson.error || `Request failed (${res.status})`);
    if (browserDirectError && isFirewallErrorString(proxyMsg)) {
      throw new Error(browserDirectError);
    }
    throw new Error(proxyMsg);
  }

  if (!res.body) {
    throw new Error(browserDirectError || 'Empty stream returned from server.');
  }

  if (!cleanShareId) {
    browserRouteCache.set(routeKey, { transport: 'proxy' });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let batchContent = '';
    let batchThinking = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;

      const packet = JSON.parse(jsonStr);
      if (packet.type === 'content' && typeof packet.delta === 'string') {
        batchContent += packet.delta;
      } else if (packet.type === 'thinking' && typeof packet.delta === 'string') {
        batchThinking += packet.delta;
      } else if (packet.type === 'error') {
        if (cachedRoute?.transport === 'proxy') {
          browserRouteCache.delete(routeKey);
        }
        const proxyMsg = String(packet.message || 'Stream interrupted.');
        if (browserDirectError && isFirewallErrorString(proxyMsg)) {
          throw new Error(browserDirectError);
        }
        throw new Error(proxyMsg);
      }
    }

    if (batchThinking) params.onThinking(batchThinking);
    if (batchContent) params.onContent(batchContent);
  }
}

export async function startBackgroundChatRun(params: {
  runId: string;
  workspaceId: string;
  conversationId: string;
  assistantMsgId: string;
  baseUrl: string;
  rawApiKey: string;
  rawWafCookie?: string;
  shareId?: string;
  onShareUpdated?: (share: SharedKeyLinkSummary) => void;
  model: string;
  messages: ChatPayloadMessage[];
  systemPrompt?: string;
  temperature?: number;
  reasoningEffort?: ReasoningEffortMode;
  initialContent?: string;
  initialThinking?: string;
  baseThinkingSeconds?: number;
}): Promise<BackgroundChatRunState> {
  const cleanShareId = (params.shareId || '').trim();
  const apiKey = sanitizeApiKey(params.rawApiKey);
  const cleanBase = sanitizeBaseUrlInput(params.baseUrl);
  const wafCookie = sanitizeWafCookie(params.rawWafCookie);

  const bodyStr = JSON.stringify({
    runId: params.runId,
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
    assistantMsgId: params.assistantMsgId,
    model: params.model,
    messages: params.messages,
    systemPrompt: params.systemPrompt,
    temperature: params.temperature,
    reasoningEffort: params.reasoningEffort,
    initialContent: params.initialContent || '',
    initialThinking: params.initialThinking || '',
    baseThinkingSeconds: params.baseThinkingSeconds || 0,
  });

  const res = await fetch('/api/chat/runs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cleanShareId
        ? { 'x-vellum-share-id': cleanShareId }
        : {
            'x-agentrouter-key': apiKey,
            'x-agentrouter-base-url': cleanBase,
            ...(wafCookie ? { 'x-agentrouter-cookie': wafCookie } : {}),
          }),
    },
    body: bodyStr,
    // Keep initiation alive across tab close when payload fits browser keepalive limit
    ...(bodyStr.length < 56000 ? { keepalive: true } : {}),
  });

  const data = await res.json().catch(() => ({}));
  if (data?.share && params.onShareUpdated) {
    params.onShareUpdated(data.share as SharedKeyLinkSummary);
  }
  if (!res.ok || !data?.run) {
    throw new Error(String(data?.error || `Unable to start background run (${res.status})`));
  }

  return data.run as BackgroundChatRunState;
}

export async function createSharedKeyLink(params: {
  ownerToken: string;
  label: string;
  baseUrl: string;
  rawApiKey: string;
  rawWafCookie?: string;
  customModels?: string[];
  expiresInHours: number | null;
  maxMessages: number | null;
}): Promise<SharedKeyLinkSummary> {
  const res = await fetch('/api/shares', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-vellum-owner-token': params.ownerToken,
    },
    body: JSON.stringify({
      label: params.label,
      baseUrl: sanitizeBaseUrlInput(params.baseUrl),
      apiKey: sanitizeApiKey(params.rawApiKey),
      wafCookie: sanitizeWafCookie(params.rawWafCookie) || undefined,
      customModels: params.customModels || [],
      expiresInHours: params.expiresInHours,
      maxMessages: params.maxMessages,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.share) {
    throw new Error(String(data?.error || `Could not create shared link (${res.status})`));
  }
  return data.share as SharedKeyLinkSummary;
}

export async function fetchOwnerSharedLinks(
  ownerToken: string
): Promise<SharedKeyLinkSummary[]> {
  if (!ownerToken.trim()) return [];
  const res = await fetch('/api/shares', {
    headers: {
      Accept: 'application/json',
      'x-vellum-owner-token': ownerToken,
    },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data?.shares) ? (data.shares as SharedKeyLinkSummary[]) : [];
}

export async function fetchPublicSharePass(
  shareId: string
): Promise<SharedKeyLinkSummary> {
  const res = await fetch(`/api/shares/${encodeURIComponent(shareId.trim())}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.share) {
    throw new Error(String(data?.error || 'This shared link is no longer available.'));
  }
  return data.share as SharedKeyLinkSummary;
}

export async function updateSharedKeyLink(params: {
  ownerToken: string;
  shareId: string;
  status?: 'active' | 'revoked';
  label?: string;
  maxMessages?: number | null;
  expiresInHours?: number | null;
}): Promise<SharedKeyLinkSummary> {
  const res = await fetch(`/api/shares/${encodeURIComponent(params.shareId.trim())}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-vellum-owner-token': params.ownerToken,
    },
    body: JSON.stringify({
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.label !== undefined ? { label: params.label } : {}),
      ...(params.maxMessages !== undefined ? { maxMessages: params.maxMessages } : {}),
      ...(params.expiresInHours !== undefined ? { expiresInHours: params.expiresInHours } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.share) {
    throw new Error(String(data?.error || `Could not update shared link (${res.status})`));
  }
  return data.share as SharedKeyLinkSummary;
}

export async function deleteSharedKeyLink(
  ownerToken: string,
  shareId: string
): Promise<void> {
  const res = await fetch(`/api/shares/${encodeURIComponent(shareId.trim())}`, {
    method: 'DELETE',
    headers: {
      'x-vellum-owner-token': ownerToken,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(String(data?.error || `Could not remove shared link (${res.status})`));
  }
}

export async function fetchWorkspaceChatRuns(
  workspaceId: string
): Promise<BackgroundChatRunState[]> {
  const res = await fetch(
    `/api/chat/runs?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }
  );
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data?.runs) ? (data.runs as BackgroundChatRunState[]) : [];
}

export async function fetchBackgroundChatRun(
  runId: string
): Promise<BackgroundChatRunState | null> {
  const res = await fetch(`/api/chat/runs/${encodeURIComponent(runId)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.run ? (data.run as BackgroundChatRunState) : null;
}

export async function cancelBackgroundChatRun(
  runId: string
): Promise<BackgroundChatRunState | null> {
  try {
    const res = await fetch(`/api/chat/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.run ? (data.run as BackgroundChatRunState) : null;
  } catch {
    return null;
  }
}

export async function subscribeToBackgroundChatRun(
  runId: string,
  callbacks: {
    onSnapshot: (run: BackgroundChatRunState) => void;
    onDelta: (delta: {
      contentDelta: string;
      thinkingDelta: string;
      thinkingSeconds: number;
    }) => void;
    onFinished: (run: BackgroundChatRunState) => void;
  },
  signal: AbortSignal
): Promise<'completed' | 'not_found'> {
  const res = await fetch(`/api/chat/runs/${encodeURIComponent(runId)}/stream`, {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
    cache: 'no-store',
    signal,
  });

  if (res.status === 404) {
    return 'not_found';
  }

  if (!res.ok || !res.body) {
    throw new Error(`Stream connection dropped (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawTerminalEvent = false;

  const handleLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const jsonStr = line.slice(5).trim();
    if (!jsonStr) return;

    let packet: Record<string, any>;
    try {
      packet = JSON.parse(jsonStr);
    } catch {
      return;
    }

    if (packet.type === 'snapshot' && packet.run) {
      callbacks.onSnapshot(packet.run as BackgroundChatRunState);
    } else if (packet.type === 'delta') {
      callbacks.onDelta({
        contentDelta: typeof packet.contentDelta === 'string' ? packet.contentDelta : '',
        thinkingDelta: typeof packet.thinkingDelta === 'string' ? packet.thinkingDelta : '',
        thinkingSeconds: Number(packet.thinkingSeconds) || 0,
      });
    } else if ((packet.type === 'done' || packet.type === 'finished') && packet.run) {
      sawTerminalEvent = true;
      callbacks.onFinished(packet.run as BackgroundChatRunState);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      handleLine(rawLine);
    }
  }

  if (buffer.trim()) {
    handleLine(buffer);
  }

  if (!sawTerminalEvent) {
    throw new Error('SSE stream ended before terminal run state.');
  }

  return 'completed';
}
