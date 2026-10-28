import { ModelOption } from '../types';

export interface ChatPayloadMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GatewaySyncResponse {
  models: ModelOption[];
  sourceUrl: string | null;
  gatewayMessage?: string;
  verifiedResults?: Record<string, { durationMs: number; reply: string }>;
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
    .trim()
    .replace(/^bearer\s+/i, '')
    .replace(/^['"`]+|['"`]+$/g, '')
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
    .replace(/\/api\/pricing$/i, '')
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

  const catalogUrls: string[] = [];
  const host = getHostname(cleaned);
  const skipWebCatalog =
    host === 'agentrouter.org' ||
    host === 'www.agentrouter.org' ||
    host === 'co.agentrouter.org' ||
    host === 'api.openai.com';

  if (!skipWebCatalog && originHost) {
    pushUnique(catalogUrls, `${originHost}/api/pricing`);
    pushUnique(catalogUrls, `${originHost}/api/models`);
  }

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
      return 'Temporary firewall check on agentrouter.org. Open agentrouter.org once in a browser tab to clear the slider, wait 30 seconds, then retry — or switch Base API to co.agentrouter.org/v1.';
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

function isReasoningStyleModel(model: string): boolean {
  return /codex|gpt-[56]|\bsol\b|-sol\b|_sol\b|\bastra\b|-astra\b|_astra\b|\bluna\b|-luna\b|\bterra\b|-terra\b|^o[134]\b|\/o[134]\b|-o[134]\b/i.test(
    model
  );
}

function shouldPreferResponsesEndpoint(model: string): boolean {
  return /codex/i.test(model);
}

function isFirewallErrorString(msg: string): boolean {
  return /firewall|slider|aliyun_waf/i.test(msg);
}

/**
 * Syncs OpenAI models cleanly without firing multi-request bursts that trip edge firewalls:
 * 1. Single direct browser GET `/v1/models` on the configured Base API URL.
 * 2. For `agentrouter.org`, when `/v1/models` returns `[]` or scanner-blocks `/v1/models`,
 *    quietly checks `co.agentrouter.org/v1/models` once and resolves AgentRouter's OpenAI
 *    Group 1 models (`gpt-6.1-sol`, `gpt-6-astra`, `gpt-5.4-sol`, etc.) with zero request storms.
 * 3. For other gateways, gently checks `/api/pricing` and `/api/models` or the backend proxy.
 */
export async function syncModelsFromGateway(
  baseUrl: string,
  rawApiKey: string,
  rawWafCookie?: string
): Promise<GatewaySyncResponse> {
  const apiKey = sanitizeApiKey(rawApiKey);
  const cleanBase = sanitizeBaseUrlInput(baseUrl);
  const wafCookie = sanitizeWafCookie(rawWafCookie);
  const { v1Urls, catalogUrls } = normalizeBaseUrlCandidates(cleanBase);

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

  if (definitiveAuthError) {
    throw new Error(definitiveAuthError);
  }

  // AgentRouter handling: /v1/models on agentrouter.org either returns [] for Group 1 keys
  // or triggers Aliyun's scanner rule on GET /v1/models. Never fire multi-endpoint bursts.
  if (isAgentRouterMainHost(cleanBase)) {
    // Quietly check co.agentrouter.org/v1/models once in case the key belongs to that endpoint
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

    return {
      models: AGENTROUTER_OPENAI_MODELS.map((m) => ({ ...m })),
      sourceUrl: directConnectedBase || v1Urls[0],
      gatewayMessage: directGatewayNotice,
    };
  }

  // Stage 2: Gentle secondary catalog check (only when Stage 1 did not hit an HTML firewall)
  if (!directHitFirewall && catalogUrls.length > 0) {
    for (const catalogUrl of catalogUrls) {
      const isPublicPricing = /\/api\/pricing$/i.test(catalogUrl);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      try {
        const res = await fetch(catalogUrl, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          ...(isPublicPricing
            ? {}
            : {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  Accept: 'application/json',
                },
              }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) continue;
        const ct = res.headers.get('content-type') || '';
        const rawText = await res.text().catch(() => '');
        if (!rawText || isHtmlFirewallOrPage(ct, rawText)) continue;

        const parsed = JSON.parse(rawText);
        if (extractGatewayErrorFromJson(parsed)) continue;

        const { models, gatewayMessage } = extractModelsFromPayload(parsed);
        if (models.length > 0) {
          return {
            models,
            sourceUrl: directConnectedBase || v1Urls[0] || catalogUrl,
            gatewayMessage,
          };
        }
      } catch {
        clearTimeout(timer);
      }
    }
  }

  // Stage 3: Backend proxy (/api/models) — never overwrite a valid browser connection with datacenter WAF
  let proxyError: Error | null = null;
  try {
    const proxyResult = await callServerProxy();
    if (proxyResult.models.length > 0) {
      return proxyResult;
    }
    if (!directConnectedBase && proxyResult.sourceUrl) {
      directConnectedBase = proxyResult.sourceUrl;
    }
    if (!directGatewayNotice && proxyResult.gatewayMessage) {
      directGatewayNotice = proxyResult.gatewayMessage;
    }
  } catch (err: unknown) {
    proxyError = err instanceof Error ? err : new Error(lastDirectError);
  }

  if (directConnectedBase) {
    return {
      models: [],
      sourceUrl: directConnectedBase,
      gatewayMessage: directGatewayNotice,
    };
  }

  if (proxyError && !isFirewallErrorString(proxyError.message)) {
    throw proxyError;
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
  signal: AbortSignal;
}): Promise<
  | { kind: 'ok'; response: Response; protocol: BrowserWireProtocol }
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
    signal,
  } = params;

  const { v1Urls, responsesUrls, anthropicMessageUrls } = normalizeBaseUrlCandidates(baseUrl);
  const reasoningModel = isReasoningStyleModel(model);
  const preferResponsesFirst = shouldPreferResponsesEndpoint(model);

  const state: {
    hitFirewallMsg: string | null;
    lastJsonError: { status: number; message: string } | null;
  } = {
    hitFirewallMsg: null,
    lastJsonError: null,
  };

  const tryOpenAiChat = async (targetBases: string[]): Promise<Response | null> => {
    const openAiMessages: ChatPayloadMessage[] = [];
    if (systemPrompt && systemPrompt.trim()) {
      openAiMessages.push({ role: 'system', content: systemPrompt.trim() });
    }
    for (const m of messages) {
      openAiMessages.push({ role: m.role, content: String(m.content || '') });
    }

    for (const candidateBase of targetBases) {
      try {
        const res = await fetch(`${candidateBase}/chat/completions`, {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream, application/json',
            Authorization: `Bearer ${apiKey}`,
            ...getBrowserSpoofHeadersForUrl(candidateBase),
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
        });

        const ct = res.headers.get('content-type') || '';
        if (res.ok && res.body) {
          if (isHtmlFirewallOrPage(ct, '')) {
            const htmlBody = await res.text().catch(() => '');
            state.hitFirewallMsg = parseGatewayErrorText(htmlBody, res.status, ct, candidateBase);
            return null;
          }
          return res;
        }

        const errBody = await res.text().catch(() => '');
        if (isHtmlFirewallOrPage(ct, errBody)) {
          state.hitFirewallMsg = parseGatewayErrorText(errBody, res.status, ct, candidateBase);
          return null;
        }

        const parsedMsg = parseGatewayErrorText(errBody, res.status, ct, candidateBase);
        state.lastJsonError = { status: res.status || 502, message: parsedMsg };
      } catch (err: unknown) {
        if (signal.aborted) throw err;
      }
    }
    return null;
  };

  const tryOpenAiResponses = async (targetRespUrls: string[]): Promise<Response | null> => {
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

    for (const respUrl of targetRespUrls) {
      try {
        const res = await fetch(respUrl, {
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
            ...(systemPrompt && systemPrompt.trim()
              ? { instructions: systemPrompt.trim() }
              : {}),
            input: responsesInput,
            stream: true,
            ...(typeof temperature === 'number' && !reasoningModel ? { temperature } : {}),
            ...(typeof maxTokens === 'number' ? { max_output_tokens: maxTokens } : {}),
          }),
          signal,
        });

        const ct = res.headers.get('content-type') || '';
        if (res.ok && res.body) {
          if (isHtmlFirewallOrPage(ct, '')) {
            const htmlBody = await res.text().catch(() => '');
            state.hitFirewallMsg = parseGatewayErrorText(htmlBody, res.status, ct, respUrl);
            return null;
          }
          return res;
        }

        const errBody = await res.text().catch(() => '');
        if (isHtmlFirewallOrPage(ct, errBody)) {
          state.hitFirewallMsg = parseGatewayErrorText(errBody, res.status, ct, respUrl);
          return null;
        }

        const parsedMsg = parseGatewayErrorText(errBody, res.status, ct, respUrl);
        if (!state.lastJsonError) {
          state.lastJsonError = { status: res.status || 502, message: parsedMsg };
        }
      } catch (err: unknown) {
        if (signal.aborted) throw err;
      }
    }
    return null;
  };

  const tryAnthropicMessages = async (targetMsgUrls: string[]): Promise<Response | null> => {
    const anthropicMessages = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: String(m.content || '') }));

    for (const msgUrl of targetMsgUrls) {
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
    }
    return null;
  };

  const isDefinitiveKeyRejection = (err: { status: number; message: string } | null) =>
    Boolean(
      err &&
        err.status === 401 &&
        /invalid api key|incorrect api key|无效的令牌|未提供令牌/i.test(err.message)
    );

  if (preferResponsesFirst) {
    const rRes = await tryOpenAiResponses(responsesUrls);
    if (rRes) return { kind: 'ok', response: rRes, protocol: 'openai-responses' };
    if (!state.hitFirewallMsg && !isDefinitiveKeyRejection(state.lastJsonError)) {
      const cRes = await tryOpenAiChat(v1Urls);
      if (cRes) return { kind: 'ok', response: cRes, protocol: 'openai-chat' };
    }
  } else {
    const cRes = await tryOpenAiChat(v1Urls);
    if (cRes) return { kind: 'ok', response: cRes, protocol: 'openai-chat' };
    if (!state.hitFirewallMsg && !isDefinitiveKeyRejection(state.lastJsonError)) {
      const rRes = await tryOpenAiResponses(responsesUrls);
      if (rRes) return { kind: 'ok', response: rRes, protocol: 'openai-responses' };
    }
  }

  // On agentrouter.org, if OpenAI routes returned 404/unsupported (not firewall, not invalid key), try /v1/messages
  if (
    !state.hitFirewallMsg &&
    !isDefinitiveKeyRejection(state.lastJsonError) &&
    isAgentRouterMainHost(baseUrl) &&
    anthropicMessageUrls.length > 0
  ) {
    const mRes = await tryAnthropicMessages(anthropicMessageUrls);
    if (mRes) return { kind: 'ok', response: mRes, protocol: 'anthropic' };
  }

  // If agentrouter.org hit a temporary firewall check on the phone IP, try co.agentrouter.org/v1 once
  if (state.hitFirewallMsg && isAgentRouterMainHost(baseUrl)) {
    const savedFirewallMsg = state.hitFirewallMsg;
    const savedJsonError = state.lastJsonError;
    const coRes = preferResponsesFirst
      ? await tryOpenAiResponses(['https://co.agentrouter.org/v1/responses'])
      : await tryOpenAiChat(['https://co.agentrouter.org/v1']);
    if (coRes) {
      return {
        kind: 'ok',
        response: coRes,
        protocol: preferResponsesFirst ? 'openai-responses' : 'openai-chat',
      };
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
    } else if (typeof delta.thinking === 'string' && delta.thinking) {
      callbacks.onThinking(delta.thinking);
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

    for (const rawLine of lines) {
      processLine(rawLine);
    }
  }

  if (buffer.trim()) {
    processLine(buffer);
  }
}

export async function testModelOnGateway(params: {
  baseUrl: string;
  rawApiKey: string;
  rawWafCookie?: string;
  model: string;
}): Promise<{ ok: boolean; durationMs: number; reply?: string; error?: string }> {
  const apiKey = sanitizeApiKey(params.rawApiKey);
  const cleanBase = sanitizeBaseUrlInput(params.baseUrl);
  const wafCookie = sanitizeWafCookie(params.rawWafCookie);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let browserDirectError: string | null = null;

  try {
    if (!wafCookie) {
      const direct = await openDirectBrowserStream({
        baseUrl: cleanBase,
        apiKey,
        model: params.model,
        messages: [{ role: 'user', content: 'Reply with only the single word: Ready' }],
        signal: controller.signal,
      });

      if (direct.kind === 'ok') {
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
        // Only try server CLI User-Agent fallback on 401/403; return all other JSON errors directly
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
        'x-agentrouter-key': apiKey,
        'x-agentrouter-base-url': cleanBase,
        ...(wafCookie ? { 'x-agentrouter-cookie': wafCookie } : {}),
      },
      body: JSON.stringify({ model: params.model }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();

    if (!data.ok && browserDirectError && isFirewallErrorString(String(data.error || ''))) {
      // Never mask a real upstream JSON error received in the browser with Cloud Run's datacenter firewall error
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
          ? 'Timed out after 20s'
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
  model: string;
  messages: ChatPayloadMessage[];
  systemPrompt?: string;
  temperature?: number;
  signal: AbortSignal;
  onContent: (chunk: string) => void;
  onThinking: (chunk: string) => void;
}): Promise<void> {
  const apiKey = sanitizeApiKey(params.rawApiKey);
  const cleanBase = sanitizeBaseUrlInput(params.baseUrl);
  const wafCookie = sanitizeWafCookie(params.rawWafCookie);

  let browserDirectError: string | null = null;

  if (!wafCookie) {
    const direct = await openDirectBrowserStream({
      baseUrl: cleanBase,
      apiKey,
      model: params.model,
      messages: params.messages,
      systemPrompt: params.systemPrompt,
      temperature: params.temperature,
      signal: params.signal,
    });

    if (direct.kind === 'ok') {
      await consumeWireStream(direct.response, direct.protocol, {
        onContent: params.onContent,
        onThinking: params.onThinking,
      });
      return;
    }

    if (direct.kind === 'api_error') {
      browserDirectError = direct.message;
      // Only fall through to server CLI User-Agent proxy on 401/403
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
      'x-agentrouter-key': apiKey,
      'x-agentrouter-base-url': cleanBase,
      ...(wafCookie ? { 'x-agentrouter-cookie': wafCookie } : {}),
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      systemPrompt: params.systemPrompt,
      temperature: params.temperature,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
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

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;

      const packet = JSON.parse(jsonStr);
      if (packet.type === 'content' && typeof packet.delta === 'string') {
        params.onContent(packet.delta);
      } else if (packet.type === 'thinking' && typeof packet.delta === 'string') {
        params.onThinking(packet.delta);
      } else if (packet.type === 'error') {
        const proxyMsg = String(packet.message || 'Stream interrupted.');
        if (browserDirectError && isFirewallErrorString(proxyMsg)) {
          throw new Error(browserDirectError);
        }
        throw new Error(proxyMsg);
      }
    }
  }
}
