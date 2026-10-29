import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  KeyRound,
  Layers,
  Loader2,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Sun,
  Volume2,
} from 'lucide-react';
import {
  AgentRole,
  ArtifactItem,
  Attachment,
  ChatMessage,
  Conversation,
  InboundAgentTask,
  ModelOption,
  ModelTestResult,
  SavedUserKey,
} from './types';
import { BASE_API_PRESETS, BUILT_IN_ROLES, STARTER_PROMPTS } from './constants';
import { extractArtifactsFromText } from './utils/artifacts';
import {
  AGENTROUTER_OPENAI_MODELS,
  fetchCatalogFallbackModels,
  isAgentRouterMainHost,
  sanitizeApiKey,
  sanitizeBaseUrlInput,
  sanitizeWafCookie,
  streamChatFromGateway,
  syncModelsFromGateway,
  testModelOnGateway,
} from './utils/gateway';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { CanvasDrawer } from './components/CanvasDrawer';
import { Sidebar } from './components/Sidebar';
import { Composer } from './components/Composer';
import { KeyModelsModal } from './components/KeyModelsModal';
import { isSpeechSynthesisSupported, prepareTextForSpeech } from './utils/speech';

const STORAGE_CHATS_KEY = 'vellum_conversations_v2';
const STORAGE_ROLES_KEY = 'vellum_custom_roles_v2';
const STORAGE_THEME_KEY = 'vellum_dark_mode_v2';
const STORAGE_MODEL_KEY = 'vellum_selected_model_v2';
const STORAGE_KEYS_LIST = 'vellum_user_keys_v2';
const STORAGE_ACTIVE_KEY_ID = 'vellum_active_key_id_v2';
const STORAGE_WORKSPACE_ID = 'vellum_workspace_id_v2';
const STORAGE_FAST_REPLIES_KEY = 'vellum_fast_replies_v1';
const STORAGE_STICKY_SCROLL_KEY = 'vellum_sticky_scroll_v1';

function getOrCreateWorkspaceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_WORKSPACE_ID);
    if (existing) return existing;
    const created = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(STORAGE_WORKSPACE_ID, created);
    return created;
  } catch {
    return 'ws_local';
  }
}

function createBlankConversation(model: string, roleId: string): Conversation {
  return {
    id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: 'New chat',
    roleId,
    model,
    messages: [],
    updatedAt: Date.now(),
  };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export default function App() {
  const [workspaceId] = useState<string>(() => getOrCreateWorkspaceId());

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_THEME_KEY);
      if (saved !== null) return saved === 'true';
    } catch {
      // Ignore
    }
    return false;
  });

  const [savedKeys, setSavedKeys] = useState<SavedUserKey[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS_LIST);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [activeKeyId, setActiveKeyId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_ACTIVE_KEY_ID) || '';
    } catch {
      return '';
    }
  });

  const activeKeyObj =
    savedKeys.find((k) => k.id === activeKeyId) || savedKeys[0] || null;

  const [models, setModels] = useState<ModelOption[]>([]);
  const [isSyncingModels, setIsSyncingModels] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncedSourceUrl, setSyncedSourceUrl] = useState<string | null>(null);
  const [modelTests, setModelTests] = useState<Record<string, ModelTestResult>>({});

  const [selectedModel, setSelectedModel] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_MODEL_KEY) || '';
    } catch {
      return '';
    }
  });

  const [customRoles, setCustomRoles] = useState<AgentRole[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_ROLES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const allRoles = [...BUILT_IN_ROLES, ...customRoles];
  const [selectedRoleId, setSelectedRoleId] = useState<string>(BUILT_IN_ROLES[0].id);

  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_CHATS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Ignore
    }
    return [createBlankConversation('', BUILT_IN_ROLES[0].id)];
  });

  const [activeId, setActiveId] = useState<string>(() => conversations[0]?.id || '');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1280 : false
  );

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactItem | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [speechSupported] = useState<boolean>(() => isSpeechSynthesisSupported());
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [inboxTasks, setInboxTasks] = useState<InboundAgentTask[]>([]);
  const [fastReplies, setFastReplies] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_FAST_REPLIES_KEY);
      if (saved !== null) return saved === 'true';
    } catch {
      // Ignore
    }
    return true;
  });
  const [stickyScroll, setStickyScroll] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_STICKY_SCROLL_KEY);
      if (saved !== null) return saved === 'true';
    } catch {
      // Ignore
    }
    return true;
  });
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const [managerOpen, setManagerOpen] = useState(false);
  const [managerTab, setManagerTab] = useState<'models' | 'keys'>('models');

  const [inlineLabel, setInlineLabel] = useState('');
  const [inlineBaseUrl, setInlineBaseUrl] = useState('https://agentrouter.org/v1');
  const [inlineKeyInput, setInlineKeyInput] = useState('');
  const [inlineWafCookie, setInlineWafCookie] = useState('');
  const [showInlineCookieField, setShowInlineCookieField] = useState(false);
  const [showInlineKey, setShowInlineKey] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const speechSessionRef = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const stickyScrollRef = useRef<boolean>(stickyScroll);
  const userScrolledUpRef = useRef<boolean>(false);
  const lastScrollTopRef = useRef<number>(0);
  const programmaticScrollRef = useRef<boolean>(false);

  const stopSpeaking = useCallback(() => {
    speechSessionRef.current += 1;
    if (isSpeechSynthesisSupported()) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMsgId(null);
  }, []);

  useEffect(() => {
    return () => {
      speechSessionRef.current += 1;
      if (isSpeechSynthesisSupported()) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light';
    try {
      localStorage.setItem(STORAGE_THEME_KEY, String(darkMode));
    } catch {
      // Ignore
    }
  }, [darkMode]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS_LIST, JSON.stringify(savedKeys));
    } catch {
      // Ignore
    }
  }, [savedKeys]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ACTIVE_KEY_ID, activeKeyObj?.id || '');
    } catch {
      // Ignore
    }
  }, [activeKeyObj?.id]);

  useEffect(() => {
    if (isStreaming) return;
    try {
      localStorage.setItem(STORAGE_CHATS_KEY, JSON.stringify(conversations));
    } catch {
      // Ignore
    }
  }, [conversations, isStreaming]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_FAST_REPLIES_KEY, String(fastReplies));
    } catch {
      // Ignore
    }
  }, [fastReplies]);

  useEffect(() => {
    stickyScrollRef.current = stickyScroll;
    try {
      localStorage.setItem(STORAGE_STICKY_SCROLL_KEY, String(stickyScroll));
    } catch {
      // Ignore
    }
  }, [stickyScroll]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ROLES_KEY, JSON.stringify(customRoles));
    } catch {
      // Ignore
    }
  }, [customRoles]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_MODEL_KEY, selectedModel);
    } catch {
      // Ignore
    }
  }, [selectedModel]);

  const syncModelsForKey = useCallback(async (keyItem: SavedUserKey | null) => {
    if (!keyItem?.apiKey || !keyItem?.baseUrl) {
      setModels([]);
      setSelectedModel('');
      setSyncError(null);
      setSyncedSourceUrl(null);
      return;
    }

    const buildCustomOptions = (ids?: string[]): ModelOption[] =>
      (ids || [])
        .map((s) => s.trim())
        .filter(Boolean)
        .map((id) => ({
          id,
          label: id,
          ownedBy: id.includes('/') ? id.split('/')[0] : 'openai',
        }));

    setIsSyncingModels(true);
    setSyncError(null);

    try {
      let data = await syncModelsFromGateway(
        keyItem.baseUrl,
        keyItem.apiKey,
        keyItem.wafCookie
      );

      // When initial /v1/models returns 0 results, automatically fall back to /api/pricing or /api/available_models
      if (data.models.length === 0) {
        const fallbackData = await fetchCatalogFallbackModels(
          keyItem.baseUrl,
          keyItem.apiKey,
          keyItem.wafCookie
        );

        if (fallbackData.models.length > 0) {
          data = {
            ...data,
            models: fallbackData.models,
            sourceUrl: fallbackData.sourceUrl || data.sourceUrl,
            gatewayMessage: fallbackData.gatewayMessage || data.gatewayMessage,
          };
        } else if (isAgentRouterMainHost(keyItem.baseUrl)) {
          data = {
            ...data,
            models: AGENTROUTER_OPENAI_MODELS.map((m) => ({ ...m })),
            sourceUrl: data.sourceUrl || sanitizeBaseUrlInput(keyItem.baseUrl),
          };
        }
      }

      setSyncedSourceUrl(data.sourceUrl);

      if (data.verifiedResults) {
        const now = Date.now();
        setModelTests((prev) => {
          const next = { ...prev };
          for (const [mId, info] of Object.entries(data.verifiedResults!)) {
            next[mId] = {
              status: 'ok',
              durationMs: info.durationMs,
              reply: info.reply,
              testedAt: now,
            };
          }
          return next;
        });
      }

      const seen = new Set<string>();
      const mergedModels: ModelOption[] = [];
      for (const m of [...data.models, ...buildCustomOptions(keyItem.customModels)]) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          mergedModels.push(m);
        }
      }

      setModels(mergedModels);

      if (mergedModels.length === 0) {
        setSelectedModel('');
        const gwMsg = data.gatewayMessage ? data.gatewayMessage.trim() : '';
        const hostLabel = (data.sourceUrl || keyItem.baseUrl).replace(/^https?:\/\//i, '');
        setSyncError(
          gwMsg
            ? `Gateway notice (${hostLabel}): ${gwMsg}`
            : `Connected to ${hostLabel}, but 0 models were returned from /v1/models, /api/pricing, or /api/available_models. Add your model IDs in API & Models.`
        );
      } else {
        setSelectedModel((prev) =>
          mergedModels.some((m) => m.id === prev) ? prev : mergedModels[0].id
        );
      }
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : 'Unable to sync models.';
      const isAuthFailure = /invalid api key|incorrect api key|unauthorized|401|enter your/i.test(
        errMessage
      );

      if (!isAuthFailure) {
        const fallbackData = await fetchCatalogFallbackModels(
          keyItem.baseUrl,
          keyItem.apiKey,
          keyItem.wafCookie
        );
        if (fallbackData.models.length > 0) {
          const seen = new Set<string>();
          const mergedModels: ModelOption[] = [];
          for (const m of [...fallbackData.models, ...buildCustomOptions(keyItem.customModels)]) {
            if (!seen.has(m.id)) {
              seen.add(m.id);
              mergedModels.push(m);
            }
          }
          setSyncedSourceUrl(fallbackData.sourceUrl || sanitizeBaseUrlInput(keyItem.baseUrl));
          setModels(mergedModels);
          setSelectedModel((prev) =>
            mergedModels.some((m) => m.id === prev) ? prev : mergedModels[0].id
          );
          setSyncError(null);
          return;
        }
      }

      const fallbackCustom = buildCustomOptions(keyItem.customModels);
      setModels(fallbackCustom);
      if (fallbackCustom.length > 0) {
        setSelectedModel((prev) =>
          fallbackCustom.some((m) => m.id === prev) ? prev : fallbackCustom[0].id
        );
      } else {
        setSelectedModel('');
      }
      setSyncedSourceUrl(null);
      setSyncError(errMessage);
    } finally {
      setIsSyncingModels(false);
    }
  }, []);

  useEffect(() => {
    syncModelsForKey(activeKeyObj);
  }, [
    activeKeyObj?.id,
    activeKeyObj?.apiKey,
    activeKeyObj?.baseUrl,
    activeKeyObj?.wafCookie,
    syncModelsForKey,
  ]);

  const handleTestModel = useCallback(
    async (modelId: string) => {
      if (!activeKeyObj?.apiKey || !activeKeyObj?.baseUrl) return;

      setModelTests((prev) => ({
        ...prev,
        [modelId]: { status: 'testing' },
      }));

      const result = await testModelOnGateway({
        baseUrl: activeKeyObj.baseUrl,
        rawApiKey: activeKeyObj.apiKey,
        rawWafCookie: activeKeyObj.wafCookie,
        model: modelId,
      });

      if (result.ok) {
        setModelTests((prev) => ({
          ...prev,
          [modelId]: {
            status: 'ok',
            durationMs: result.durationMs,
            reply: result.reply,
            testedAt: Date.now(),
          },
        }));
      } else {
        setModelTests((prev) => ({
          ...prev,
          [modelId]: {
            status: 'error',
            durationMs: result.durationMs,
            error: result.error || 'Model did not respond',
            testedAt: Date.now(),
          },
        }));
      }
    },
    [activeKeyObj]
  );

  const handleAddUserKey = async (
    label: string,
    apiKey: string,
    baseUrl: string,
    wafCookie?: string
  ) => {
    const cleanCookie = sanitizeWafCookie(wafCookie);
    const newEntry: SavedUserKey = {
      id: `key_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label,
      apiKey: sanitizeApiKey(apiKey),
      baseUrl: sanitizeBaseUrlInput(baseUrl),
      ...(cleanCookie ? { wafCookie: cleanCookie } : {}),
    };
    setModelTests({});
    setSavedKeys((prev) => [newEntry, ...prev]);
    setActiveKeyId(newEntry.id);
  };

  const handleUpdateUserKey = async (
    id: string,
    label: string,
    apiKey: string,
    baseUrl: string,
    wafCookie?: string
  ) => {
    const cleanKey = sanitizeApiKey(apiKey);
    const cleanBase = sanitizeBaseUrlInput(baseUrl);
    const cleanCookie = sanitizeWafCookie(wafCookie);
    setModelTests({});
    setSavedKeys((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              label,
              apiKey: cleanKey,
              baseUrl: cleanBase,
              wafCookie: cleanCookie || undefined,
            }
          : item
      )
    );
    setActiveKeyId(id);
  };

  const handleRemoveUserKey = (id: string) => {
    setSavedKeys((prev) => {
      const next = prev.filter((k) => k.id !== id);
      if (id === activeKeyObj?.id) {
        setActiveKeyId(next[0]?.id || '');
        setModelTests({});
      }
      return next;
    });
  };

  const handleAddCustomModels = (rawInput: string) => {
    if (!activeKeyObj) return;
    const additions = rawInput
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (additions.length === 0) return;

    setSavedKeys((prev) =>
      prev.map((item) => {
        if (item.id !== activeKeyObj.id) return item;
        const merged = Array.from(new Set([...(item.customModels || []), ...additions]));
        return { ...item, customModels: merged };
      })
    );

    setModels((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const addedOptions: ModelOption[] = [];
      for (const id of additions) {
        if (!seen.has(id)) {
          seen.add(id);
          addedOptions.push({
            id,
            label: id,
            ownedBy: id.includes('/') ? id.split('/')[0] : 'openai',
          });
        }
      }
      return [...addedOptions, ...prev];
    });

    setSelectedModel((prev) => prev || additions[0]);
    if (syncError && /0 models/i.test(syncError)) {
      setSyncError(null);
    }
  };

  const handleRemoveCustomModel = (modelId: string) => {
    if (!activeKeyObj) return;
    setSavedKeys((prev) =>
      prev.map((item) => {
        if (item.id !== activeKeyObj.id) return item;
        const nextCustom = (item.customModels || []).filter((id) => id !== modelId);
        return {
          ...item,
          customModels: nextCustom.length > 0 ? nextCustom : undefined,
        };
      })
    );
    setModels((prev) => {
      const next = prev.filter((m) => m.id !== modelId);
      if (selectedModel === modelId) {
        setSelectedModel(next[0]?.id || '');
      }
      return next;
    });
  };

  const handleInlineConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineBaseUrl.trim() || !inlineKeyInput.trim()) return;
    await handleAddUserKey(
      inlineLabel.trim() || `Connection ${savedKeys.length + 1}`,
      inlineKeyInput.trim(),
      inlineBaseUrl.trim(),
      inlineWafCookie.trim() || undefined
    );
    setInlineLabel('');
    setInlineKeyInput('');
    setInlineWafCookie('');
    setShowInlineCookieField(false);
  };

  useEffect(() => {
    const source = new EventSource(
      `/api/inbox/stream?workspaceId=${encodeURIComponent(workspaceId)}`
    );

    source.addEventListener('snapshot', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (Array.isArray(data.tasks)) setInboxTasks(data.tasks);
      } catch {
        // Ignore
      }
    });

    source.addEventListener('task_created', (e: MessageEvent) => {
      try {
        const task: InboundAgentTask = JSON.parse(e.data);
        setInboxTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
      } catch {
        // Ignore
      }
    });

    source.addEventListener('task_delta', (e: MessageEvent) => {
      try {
        const { id, contentDelta, thinkingDelta } = JSON.parse(e.data);
        setInboxTasks((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  output: (t.output || '') + (contentDelta || ''),
                  thinking: (t.thinking || '') + (thinkingDelta || ''),
                }
              : t
          )
        );
      } catch {
        // Ignore
      }
    });

    source.addEventListener('task_updated', (e: MessageEvent) => {
      try {
        const updated: InboundAgentTask = JSON.parse(e.data);
        setInboxTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      } catch {
        // Ignore
      }
    });

    source.addEventListener('task_deleted', (e: MessageEvent) => {
      try {
        const { id } = JSON.parse(e.data);
        setInboxTasks((prev) => prev.filter((t) => t.id !== id));
      } catch {
        // Ignore
      }
    });

    return () => {
      source.close();
    };
  }, [workspaceId]);

  const activeConversation =
    conversations.find((c) => c.id === activeId) || conversations[0];

  const selectedRole =
    allRoles.find((r) => r.id === selectedRoleId) || BUILT_IN_ROLES[0];

  const openKeyModelsModal = (tab: 'models' | 'keys') => {
    setManagerTab(tab);
    setManagerOpen(true);
  };

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    userScrolledUpRef.current = false;
    setShowJumpToBottom(false);
    const el = scrollContainerRef.current;
    if (el) {
      programmaticScrollRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior });
      lastScrollTopRef.current = el.scrollHeight;
      window.setTimeout(() => {
        programmaticScrollRef.current = false;
      }, behavior === 'smooth' ? 320 : 50);
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  const handleStageScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const currentScrollTop = el.scrollTop;
    const distanceFromBottom = el.scrollHeight - currentScrollTop - el.clientHeight;
    const hasMessages = Boolean(activeConversation?.messages.length);

    setShowJumpToBottom(hasMessages && distanceFromBottom > 120);

    if (!programmaticScrollRef.current) {
      if (currentScrollTop < lastScrollTopRef.current - 6 && distanceFromBottom > 48) {
        userScrolledUpRef.current = true;
      } else if (distanceFromBottom <= 48) {
        userScrolledUpRef.current = false;
      }
    }

    lastScrollTopRef.current = currentScrollTop;
  }, [activeConversation?.messages.length]);

  const handleToggleStickyScroll = useCallback(() => {
    setStickyScroll((prev) => {
      const next = !prev;
      stickyScrollRef.current = next;
      if (next) {
        userScrolledUpRef.current = false;
        if (isStreaming) {
          requestAnimationFrame(() => scrollToBottom('smooth'));
        }
      }
      return next;
    });
  }, [isStreaming, scrollToBottom]);

  useEffect(() => {
    userScrolledUpRef.current = false;
    requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJumpToBottom(Boolean(activeConversation?.messages.length) && distanceFromBottom > 120);
    });
  }, [activeId, activeConversation?.messages.length]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    if (isStreaming && stickyScroll && !userScrolledUpRef.current) {
      programmaticScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
      setShowJumpToBottom(false);
      const frame = requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
      return () => cancelAnimationFrame(frame);
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpToBottom(Boolean(activeConversation?.messages.length) && distanceFromBottom > 120);
  }, [activeConversation?.messages, isStreaming, stickyScroll]);

  const streamAgentResponse = useCallback(
    async (
      convId: string,
      historyMessages: ChatMessage[],
      modelToUse: string,
      roleToUse: AgentRole,
      userKey: SavedUserKey
    ) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const assistantMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const initialAssistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        thinking: '',
        model: modelToUse,
        createdAt: Date.now(),
        isStreaming: true,
      };

      setIsStreaming(true);
      userScrolledUpRef.current = false;

      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: [...historyMessages, initialAssistantMessage],
                updatedAt: Date.now(),
              }
            : c
        )
      );

      if (stickyScrollRef.current) {
        requestAnimationFrame(() => scrollToBottom('smooth'));
      }

      const payloadMessages = historyMessages.map((m) => {
        let fullText = m.content;
        if (m.attachments && m.attachments.length > 0) {
          const attBlocks = m.attachments
            .map((a) => `--- File: ${a.name} ---\n${a.content}\n--- End File ---`)
            .join('\n\n');
          fullText = fullText ? `${attBlocks}\n\n${fullText}` : attBlocks;
        }
        return {
          role: m.role,
          content: fullText,
        };
      });

      let rafId: number | null = null;
      let accumulatedContent = '';
      let accumulatedThinking = '';

      const commitStreamState = (done = false) => {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          content: accumulatedContent,
                          thinking: accumulatedThinking,
                          ...(done ? { isStreaming: false } : {}),
                        }
                      : m
                  ),
                  ...(done ? { updatedAt: Date.now() } : {}),
                }
              : c
          )
        );
      };

      const scheduleStreamFlush = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          commitStreamState(false);
        });
      };

      try {
        await streamChatFromGateway({
          baseUrl: userKey.baseUrl,
          rawApiKey: userKey.apiKey,
          rawWafCookie: userKey.wafCookie,
          model: modelToUse,
          messages: payloadMessages,
          systemPrompt: roleToUse.instructions,
          temperature: roleToUse.temperature,
          reasoningEffort: fastReplies ? 'low' : 'medium',
          signal: controller.signal,
          onContent: (delta) => {
            accumulatedContent += delta;
            scheduleStreamFlush();
          },
          onThinking: (delta) => {
            accumulatedThinking += delta;
            scheduleStreamFlush();
          },
        });

        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        commitStreamState(true);

        const extracted = extractArtifactsFromText(assistantMsgId, accumulatedContent);
        const firstPreviewable = extracted.find((a) => a.previewable);
        if (firstPreviewable && window.innerWidth >= 1280) {
          setActiveArtifact(firstPreviewable);
        }
      } catch (err: unknown) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (controller.signal.aborted) {
          commitStreamState(true);
        } else {
          const message = err instanceof Error ? err.message : 'Something went wrong.';
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, isStreaming: false, error: message }
                        : m
                    ),
                  }
                : c
            )
          );
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [scrollToBottom, fastReplies]
  );

  const handleSend = useCallback(
    (overridePrompt?: string) => {
      if (!activeKeyObj) {
        openKeyModelsModal('keys');
        return;
      }
      if (!selectedModel) {
        openKeyModelsModal('models');
        return;
      }

      const text = (overridePrompt !== undefined ? overridePrompt : input).trim();
      if ((!text && attachments.length === 0) || isStreaming || !activeConversation) return;

      const userMessage: ChatMessage = {
        id: `msg_${Date.now()}_u`,
        role: 'user',
        content: text,
        attachments:
          overridePrompt !== undefined
            ? undefined
            : attachments.length
              ? attachments
              : undefined,
        createdAt: Date.now(),
      };

      const nextMessages = [...activeConversation.messages, userMessage];
      const isFirstMessage = activeConversation.messages.length === 0;
      const cleanTitleSource = text || attachments[0]?.name || 'New chat';
      const nextTitle = isFirstMessage
        ? cleanTitleSource.replace(/\s+/g, ' ').slice(0, 46)
        : activeConversation.title;

      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id
            ? {
                ...c,
                title: nextTitle,
                model: selectedModel,
                roleId: selectedRole.id,
                messages: nextMessages,
                updatedAt: Date.now(),
              }
            : c
        )
      );

      if (overridePrompt === undefined) {
        setInput('');
        setAttachments([]);
      }

      streamAgentResponse(
        activeConversation.id,
        nextMessages,
        selectedModel,
        selectedRole,
        activeKeyObj
      );
    },
    [
      activeKeyObj,
      selectedModel,
      input,
      attachments,
      isStreaming,
      activeConversation,
      selectedRole,
      streamAgentResponse,
    ]
  );

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const handleNewChat = () => {
    stopSpeaking();
    if (isStreaming) abortControllerRef.current?.abort();
    const blank = createBlankConversation(selectedModel, selectedRoleId);
    setConversations((prev) => [blank, ...prev]);
    setActiveId(blank.id);
    setActiveArtifact(null);
    setInput('');
    setAttachments([]);
  };

  const handleDeleteConversation = (id: string) => {
    if (id === activeConversation?.id) {
      stopSpeaking();
    }
    setConversations((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (remaining.length === 0) {
        const fresh = createBlankConversation(selectedModel, selectedRoleId);
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeConversation?.id) {
        setActiveId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleRetryMessage = (assistantMsgIndex: number) => {
    if (isStreaming || !activeConversation || !activeKeyObj || !selectedModel) return;
    stopSpeaking();
    const historyBefore = activeConversation.messages.slice(0, assistantMsgIndex);
    if (historyBefore.length === 0) return;
    streamAgentResponse(
      activeConversation.id,
      historyBefore,
      selectedModel,
      selectedRole,
      activeKeyObj
    );
  };

  const handleBranchFromMessage = (msgIndex: number) => {
    if (!activeConversation) return;
    const branchedMessages = activeConversation.messages.slice(0, msgIndex + 1);
    const branch: Conversation = {
      id: `chat_${Date.now()}_br`,
      title: `${activeConversation.title} (Branch)`,
      roleId: activeConversation.roleId,
      model: activeConversation.model,
      messages: branchedMessages,
      updatedAt: Date.now(),
    };
    setConversations((prev) => [branch, ...prev]);
    setActiveId(branch.id);
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    await navigator.clipboard.writeText(msg.content);
    setCopiedMsgId(msg.id);
    setTimeout(() => setCopiedMsgId(null), 1800);
  };

  const handleToggleSpeakMessage = (msg: ChatMessage) => {
    if (!isSpeechSynthesisSupported()) return;

    if (speakingMsgId === msg.id) {
      stopSpeaking();
      return;
    }

    speechSessionRef.current += 1;
    const sessionId = speechSessionRef.current;
    window.speechSynthesis.cancel();

    const chunks = prepareTextForSpeech(msg.content);
    if (chunks.length === 0) {
      setSpeakingMsgId(null);
      return;
    }

    setSpeakingMsgId(msg.id);

    const speakChunkAt = (idx: number) => {
      if (speechSessionRef.current !== sessionId) return;
      if (idx >= chunks.length) {
        setSpeakingMsgId((curr) => (curr === msg.id ? null : curr));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[idx]);
      utterance.rate = 1;
      utterance.pitch = 1;

      utterance.onend = () => {
        if (speechSessionRef.current !== sessionId) return;
        speakChunkAt(idx + 1);
      };

      utterance.onerror = () => {
        if (speechSessionRef.current !== sessionId) return;
        setSpeakingMsgId((curr) => (curr === msg.id ? null : curr));
      };

      window.speechSynthesis.speak(utterance);
    };

    speakChunkAt(0);
  };

  const handleOpenInboxTaskInChat = (task: InboundAgentTask) => {
    const importedMessages: ChatMessage[] = [
      {
        id: `${task.id}_u`,
        role: 'user',
        content: task.prompt,
        createdAt: task.createdAt,
      },
    ];
    if (task.output || task.error) {
      importedMessages.push({
        id: `${task.id}_a`,
        role: 'assistant',
        content: task.output || '',
        thinking: task.thinking,
        model: task.model,
        createdAt: Date.now(),
        error: task.error,
      });
    }

    const conv: Conversation = {
      id: `chat_${Date.now()}_in`,
      title: task.title,
      roleId: selectedRoleId,
      model: task.model || selectedModel,
      messages: importedMessages,
      updatedAt: Date.now(),
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
  };

  const handleSendSampleInboundRequest = async (promptText: string) => {
    if (!activeKeyObj || !selectedModel) return;
    const res = await fetch(`/api/inbox?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agentrouter-key': activeKeyObj.apiKey,
        'x-agentrouter-base-url': activeKeyObj.baseUrl,
        ...(activeKeyObj.wafCookie
          ? { 'x-agentrouter-cookie': activeKeyObj.wafCookie }
          : {}),
      },
      body: JSON.stringify({
        workspaceId,
        title: promptText.slice(0, 44),
        prompt: promptText,
        sender: activeKeyObj.label,
        model: selectedModel,
        systemPrompt: selectedRole.instructions,
        autoRun: true,
      }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.task) {
        const returnedTask: InboundAgentTask = data.task;
        setInboxTasks((prev) => [
          returnedTask,
          ...prev.filter((t) => t.id !== returnedTask.id),
        ]);
      }
    }
  };

  const handleDeleteInboxTask = async (id: string) => {
    setInboxTasks((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/inbox/${id}?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'DELETE',
    });
  };

  const handleOpenArtifact = useCallback((art: ArtifactItem) => {
    setActiveArtifact(art);
  }, []);

  const allConversationArtifacts = useMemo(() => {
    if (!activeConversation) return [];
    return activeConversation.messages.flatMap((m) =>
      m.role === 'assistant' && !m.isStreaming
        ? extractArtifactsFromText(m.id, m.content)
        : []
    );
  }, [activeConversation]);

  const activeModelDisplay =
    models.find((m) => m.id === selectedModel)?.label || selectedModel;

  return (
    <div className="h-dvh w-full flex overflow-hidden bg-background text-foreground">
      {/* Left Navigation Drawer / Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaceId={workspaceId}
        activeKey={activeKeyObj}
        onOpenKeyManager={openKeyModelsModal}
        conversations={conversations}
        activeId={activeConversation?.id || ''}
        onSelectConversation={(id) => {
          stopSpeaking();
          setActiveId(id);
          setActiveArtifact(null);
        }}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        roles={allRoles}
        selectedRoleId={selectedRole.id}
        onSelectRole={(roleId) => setSelectedRoleId(roleId)}
        onCreateRole={(roleData) => {
          const created: AgentRole = {
            ...roleData,
            id: `role_${Date.now()}`,
          };
          setCustomRoles((prev) => [...prev, created]);
          setSelectedRoleId(created.id);
        }}
        onDeleteRole={(roleId) => {
          setCustomRoles((prev) => prev.filter((r) => r.id !== roleId));
          if (selectedRoleId === roleId) setSelectedRoleId(BUILT_IN_ROLES[0].id);
        }}
        inboxTasks={inboxTasks}
        onOpenInboxTaskInChat={handleOpenInboxTaskInChat}
        onDeleteInboxTask={handleDeleteInboxTask}
        onSendSampleInboundRequest={handleSendSampleInboundRequest}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        stickyScroll={stickyScroll}
        onToggleStickyScroll={handleToggleStickyScroll}
        selectedModel={selectedModel}
      />

      {/* Main Distraction-Free Conversation Column */}
      <main className="flex-1 min-w-0 flex flex-col h-full overflow-x-hidden">
        {/* Optimus Top Navigation Bar */}
        <header className="h-[60px] shrink-0 flex items-center justify-between gap-2 px-3 sm:px-6 border-b border-foreground/10 bg-background/85 backdrop-blur-md z-20">
          {/* Zone 1: Menu Toggle + Optimus Wordmark / Thread Title */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle navigation"
              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-foreground/75 hover:text-foreground hover:bg-foreground/5 transition-colors shrink-0"
            >
              <Menu className="w-5 h-5 lg:hidden" />
              {sidebarOpen ? (
                <PanelLeftClose className="w-4 h-4 hidden lg:block" />
              ) : (
                <PanelLeftOpen className="w-4 h-4 hidden lg:block" />
              )}
            </button>

            {activeConversation?.messages.length ? (
              <span className="text-base sm:text-lg font-display tracking-tight text-foreground truncate">
                {activeConversation.title}
              </span>
            ) : (
              <div className="flex items-baseline gap-1.5">
                <span className="font-display tracking-tight text-2xl text-foreground">
                  Vellum
                </span>
                <span className="text-muted-foreground font-mono text-[10px]">TM</span>
              </div>
            )}
          </div>

          {/* Zone 2: Optimus Contextual Controls + Light/Dark Switch + Primary Capsule CTA */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openKeyModelsModal(activeKeyObj ? 'models' : 'keys')}
              className="min-h-[40px] px-3 sm:px-4 rounded-full border border-foreground/15 hover:bg-foreground/5 text-xs font-mono text-foreground flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              {activeKeyObj ? (
                <>
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Models ({models.length})</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Base API</span>
                </>
              )}
            </button>

            {allConversationArtifacts.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setActiveArtifact((curr) =>
                    curr ? null : allConversationArtifacts[allConversationArtifacts.length - 1]
                  )
                }
                className="min-h-[40px] px-3 sm:px-4 rounded-full border border-foreground/15 hover:bg-foreground/5 text-xs font-mono text-foreground flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Layers className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  Canvas ({allConversationArtifacts.length})
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleToggleStickyScroll}
              aria-pressed={stickyScroll}
              aria-label={
                stickyScroll
                  ? 'Sticky Scroll is on. Tap to disable auto-scrolling.'
                  : 'Sticky Scroll is off. Tap to enable auto-scrolling.'
              }
              title={
                stickyScroll
                  ? 'Sticky Scroll: On — auto-scrolls with replies'
                  : 'Sticky Scroll: Off — stays put while reading'
              }
              className={`min-h-[40px] min-w-[40px] md:px-3.5 rounded-full border text-xs font-mono font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                stickyScroll
                  ? 'border-foreground/30 bg-foreground/[0.07] text-foreground'
                  : 'border-foreground/15 text-muted-foreground hover:text-foreground hover:bg-foreground/5'
              }`}
            >
              <ArrowDownToLine className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">
                Sticky {stickyScroll ? 'On' : 'Off'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="min-h-[40px] min-w-[40px] rounded-full border border-foreground/15 hover:bg-foreground/5 flex items-center justify-center text-foreground transition-colors shrink-0"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={handleNewChat}
              aria-label="Start new chat"
              className="min-h-[40px] px-4 sm:px-5 rounded-full bg-foreground hover:bg-foreground/90 text-background text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New chat</span>
            </button>
          </div>
        </header>

        {/* Scrollable Stage */}
        <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={scrollContainerRef}
          onScroll={handleStageScroll}
          className={`flex-1 overflow-y-auto px-4 sm:px-8 ${
            !activeKeyObj || !activeConversation || activeConversation.messages.length === 0
              ? 'optimus-grid'
              : ''
          }`}
        >
          {!activeKeyObj ? (
            /* Step 1 Onboarding: Optimus Editorial Grid + Manual Base API & Key Form */
            <div className="max-w-2xl mx-auto min-h-full flex flex-col justify-center py-10 sm:py-16 animate-optimus-in">
              <div className="mb-8 sm:mb-10">
                <span className="inline-flex items-center gap-3 text-xs font-mono text-muted-foreground mb-5">
                  <span className="w-8 h-px bg-foreground/30" />
                  API Setup
                </span>

                <h1 className="text-[clamp(2.5rem,9vw,4.75rem)] font-display leading-[0.95] tracking-tight text-foreground balance-text">
                  <span className="block">Save your Base API</span>
                  <span className="block">
                    and{' '}
                    <span className="relative inline-block">
                      <span>personal key.</span>
                      <span className="absolute -bottom-1 left-0 right-0 h-2.5 bg-foreground/10 pointer-events-none" />
                    </span>
                  </span>
                </h1>

                <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mt-5 max-w-xl">
                  Enter your Base API URL and personal key manually to sync models from your endpoint, test response times, and stream in real time.
                </p>
              </div>

              <form
                onSubmit={handleInlineConnect}
                className="p-5 sm:p-8 bg-background border border-foreground/15 space-y-4"
              >
                <div className="space-y-1.5">
                  <label className="block font-mono text-xs text-muted-foreground">
                    Label (optional)
                  </label>
                  <input
                    type="text"
                    value={inlineLabel}
                    onChange={(e) => setInlineLabel(e.target.value)}
                    placeholder="Personal or Work"
                    autoComplete="off"
                    className="w-full min-h-[48px] px-4 bg-foreground/[0.02] border border-foreground/15 text-[16px] sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/50 transition-colors"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block font-mono text-xs font-medium text-muted-foreground">
                    Base API URL
                  </label>
                  <input
                    type="text"
                    value={inlineBaseUrl}
                    onChange={(e) => setInlineBaseUrl(e.target.value)}
                    placeholder="https://agentrouter.org/v1"
                    required
                    autoComplete="off"
                    className="w-full min-h-[48px] px-4 bg-foreground/[0.02] border border-foreground/15 text-[16px] sm:text-sm font-mono font-medium text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-foreground/50 transition-colors"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {BASE_API_PRESETS.map((preset) => {
                      const activePreset =
                        inlineBaseUrl.trim().replace(/\/+$/, '') === preset.url;
                      return (
                        <button
                          key={preset.url}
                          type="button"
                          onClick={() => setInlineBaseUrl(preset.url)}
                          className={`min-h-[34px] px-3 rounded-full border text-[11px] font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                            activePreset
                              ? 'bg-foreground text-background border-foreground'
                              : 'border-foreground/15 text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block font-mono text-xs font-medium text-muted-foreground">
                    API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showInlineKey ? 'text' : 'password'}
                      value={inlineKeyInput}
                      onChange={(e) => setInlineKeyInput(e.target.value)}
                      placeholder="Paste your OpenAI / AgentRouter key (sk-...)"
                      required
                      autoComplete="off"
                      className="w-full min-h-[48px] pl-4 pr-12 bg-foreground/[0.02] border border-foreground/15 text-[16px] sm:text-sm font-mono font-medium text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-foreground/50 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowInlineKey((v) => !v)}
                      aria-label={showInlineKey ? 'Hide key' : 'Show key'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[42px] min-w-[42px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground"
                    >
                      {showInlineKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowInlineCookieField((v) => !v)}
                    className="min-h-[36px] inline-flex items-center gap-1.5 text-xs font-mono font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showInlineCookieField ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    <span>Optional desktop session header</span>
                  </button>

                  {showInlineCookieField && (
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={inlineWafCookie}
                        onChange={(e) => setInlineWafCookie(e.target.value)}
                        placeholder="acw_tc=..."
                        autoComplete="off"
                        className="w-full min-h-[44px] px-4 bg-foreground/[0.02] border border-foreground/15 text-[16px] sm:text-xs font-mono text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-foreground/50 transition-colors"
                      />
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Not needed on mobile. Leave blank unless you want to forward a custom desktop Cookie header.
                      </p>
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={!inlineBaseUrl.trim() || !inlineKeyInput.trim()}
                    className="w-full h-13 px-8 rounded-full bg-foreground hover:bg-foreground/90 text-background text-sm sm:text-base font-medium flex items-center justify-center gap-2 disabled:opacity-30 transition-all group"
                  >
                    <span>Save & Sync Models</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>

                <p className="font-mono text-[11px] text-muted-foreground text-center pt-1">
                  Both your Base API URL and key are saved locally in this browser.
                </p>
              </form>
            </div>
          ) : !activeConversation || activeConversation.messages.length === 0 ? (
            /* Step 2 Empty Chat Stage: Optimus Hero Typography + 01–04 Numbered Prompts */
            <div className="max-w-3xl mx-auto min-h-full flex flex-col justify-center py-8 sm:py-14 animate-optimus-in">
              <div className="mb-10 sm:mb-12">
                <div className="inline-flex flex-wrap items-center gap-3 text-xs font-mono text-muted-foreground mb-5 tabular-nums">
                  <span className="w-8 h-px bg-foreground/30 shrink-0" />
                  <span>{selectedRole.name}</span>
                  <span aria-hidden="true">·</span>
                  {isSyncingModels ? (
                    <span className="inline-flex items-center gap-1.5 text-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Syncing models...
                    </span>
                  ) : models.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => openKeyModelsModal('models')}
                      className="text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground transition-colors"
                    >
                      {activeModelDisplay} ({models.length} synced — test models)
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openKeyModelsModal('keys')}
                      className="text-destructive underline underline-offset-4"
                    >
                      {syncError || 'No models synced — check Base API & key'}
                    </button>
                  )}
                </div>

                <h1 className="text-[clamp(2.4rem,8vw,4.5rem)] font-display leading-[0.95] tracking-tight text-foreground balance-text">
                  Everything you need.
                  <br />
                  <span className="text-muted-foreground">What shall we create?</span>
                </h1>
              </div>

              {syncError && (
                <div className="mb-8 p-4 border border-destructive/40 bg-background flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-mono text-destructive">{syncError}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => syncModelsForKey(activeKeyObj)}
                      className="min-h-[44px] px-4 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-mono font-medium text-foreground flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Retry Sync</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        openKeyModelsModal(/0 models/i.test(syncError) ? 'models' : 'keys')
                      }
                      className="min-h-[44px] px-4 rounded-full bg-foreground text-background text-xs font-semibold"
                    >
                      {/0 models/i.test(syncError) ? 'Add Model IDs' : 'Edit Base API'}
                    </button>
                  </div>
                </div>
              )}

              {/* Optimus Numbered Editorial Rows (01–04) */}
              <div className="border-t border-foreground/12 bg-background/85 backdrop-blur-xs">
                {STARTER_PROMPTS.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={!selectedModel || isSyncingModels}
                    onClick={() => handleSend(item.prompt)}
                    className="group w-full text-left py-5 sm:py-6 px-3 sm:px-4 border-b border-foreground/12 hover:bg-foreground/[0.025] disabled:opacity-40 transition-colors flex items-start gap-4 sm:gap-8"
                  >
                    <span className="font-mono text-xs text-muted-foreground pt-1.5 shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xl sm:text-2xl font-display text-foreground group-hover:translate-x-1.5 transition-transform duration-300">
                        {item.title}
                      </div>
                      <div className="text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                        {item.prompt}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all mt-2 shrink-0 hidden sm:block" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Active Conversation Thread */
            <div className="max-w-3xl mx-auto py-6 sm:py-10 space-y-9">
              {activeConversation.messages.map((msg, index) => {
                const isUser = msg.role === 'user';
                const msgArtifacts =
                  !isUser && !msg.isStreaming
                    ? extractArtifactsFromText(msg.id, msg.content)
                    : [];
                const thinkingOpen = Boolean(expandedThinking[msg.id]);

                if (isUser) {
                  return (
                    <div key={msg.id} className="flex flex-col items-end">
                      <div className="max-w-[90%] sm:max-w-[78%] px-4 sm:px-5 py-3.5 bg-secondary text-secondary-foreground border border-foreground/10">
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mb-2 font-mono text-xs text-muted-foreground">
                            {msg.attachments.map((a) => a.name).join(' · ')}
                          </div>
                        )}
                        <p className="text-[15.5px] sm:text-base leading-relaxed whitespace-pre-wrap break-words">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  );
                }

                return (
                  <article
                    key={msg.id}
                    className="space-y-3.5 pb-6 border-b border-foreground/10 last:border-b-0"
                  >
                    {msg.thinking && (
                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedThinking((prev) => ({
                              ...prev,
                              [msg.id]: !prev[msg.id],
                            }))
                          }
                          className="min-h-[38px] inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {thinkingOpen ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {msg.isStreaming && !msg.content ? 'Thinking...' : 'Thought process'}
                          </span>
                        </button>
                        {thinkingOpen && (
                          <div className="mt-2 p-4 border border-foreground/10 bg-foreground/[0.02] font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                            {msg.thinking}
                          </div>
                        )}
                      </div>
                    )}

                    {msg.content ? (
                      <MarkdownRenderer
                        content={msg.content}
                        messageId={msg.id}
                        onOpenArtifact={handleOpenArtifact}
                      />
                    ) : msg.isStreaming && !msg.thinking ? (
                      <div className="py-2 font-mono text-xs text-muted-foreground">
                        Writing...
                      </div>
                    ) : null}

                    {msg.error && (
                      <div className="p-4 border border-destructive/40 bg-destructive/5 font-mono text-xs text-destructive">
                        {msg.error}
                      </div>
                    )}

                    {msgArtifacts.length > 0 && !msg.isStreaming && (
                      <div className="flex flex-wrap gap-2.5 pt-1">
                        {msgArtifacts.map((art) => (
                          <button
                            key={art.id}
                            type="button"
                            onClick={() => setActiveArtifact(art)}
                            className="min-h-[48px] px-4 py-2.5 bg-background border border-foreground/15 hover:border-foreground/45 text-left flex items-center gap-3 transition-colors group"
                          >
                            <Layers className="w-4 h-4 text-foreground shrink-0" />
                            <div>
                              <div className="font-display text-base leading-tight text-foreground group-hover:translate-x-0.5 transition-transform">
                                {art.title}
                              </div>
                              <div className="font-mono text-[11px] text-muted-foreground">
                                {art.previewable
                                  ? 'Interactive preview'
                                  : `${art.language} source`}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {!msg.isStreaming && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                        <div className="font-mono text-xs text-muted-foreground tabular-nums">
                          <span>
                            {models.find((m) => m.id === msg.model)?.label || msg.model}
                          </span>
                          {msg.content && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span>{countWords(msg.content)} words</span>
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                          {speechSupported && msg.content.trim() && (
                            <button
                              type="button"
                              onClick={() => handleToggleSpeakMessage(msg)}
                              aria-label={
                                speakingMsgId === msg.id
                                  ? 'Stop reading response aloud'
                                  : 'Read response aloud'
                              }
                              aria-pressed={speakingMsgId === msg.id}
                              className={`min-h-[40px] px-3 rounded-full font-mono text-xs font-medium flex items-center gap-1.5 transition-colors ${
                                speakingMsgId === msg.id
                                  ? 'bg-foreground text-background'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                              }`}
                            >
                              {speakingMsgId === msg.id ? (
                                <>
                                  <Square className="w-3 h-3 fill-current" />
                                  <span>Stop</span>
                                </>
                              ) : (
                                <>
                                  <Volume2 className="w-3.5 h-3.5" />
                                  <span>Read</span>
                                </>
                              )}
                            </button>
                          )}

                          {msg.content && (
                            <button
                              type="button"
                              onClick={() => handleCopyMessage(msg)}
                              className="min-h-[40px] px-3 rounded-full font-mono text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 flex items-center gap-1.5 transition-colors"
                            >
                              {copiedMsgId === msg.id ? (
                                <Check className="w-3.5 h-3.5 text-foreground" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              <span>{copiedMsgId === msg.id ? 'Copied' : 'Copy'}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleRetryMessage(index)}
                            className="min-h-[40px] px-3 rounded-full font-mono text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 flex items-center gap-1.5 transition-colors"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Retry</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleBranchFromMessage(index)}
                            className="min-h-[40px] px-3 rounded-full font-mono text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 flex items-center gap-1.5 transition-colors"
                          >
                            <GitBranch className="w-3.5 h-3.5" />
                            <span>Branch</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
              <div ref={messagesEndRef} className="h-4" />
            </div>
          )}
        </div>

        {showJumpToBottom && activeKeyObj && Boolean(activeConversation?.messages.length) && (
          <div className="pointer-events-none absolute bottom-3 left-0 right-0 flex justify-center px-4 z-10">
            <button
              type="button"
              onClick={() => scrollToBottom('smooth')}
              aria-label="Jump to bottom of chat"
              className="pointer-events-auto min-h-[40px] px-4 rounded-full bg-background/95 backdrop-blur-md border border-foreground/20 hover:border-foreground/40 shadow-sm text-xs font-semibold tracking-tight text-foreground flex items-center gap-1.5 transition-colors"
            >
              <ArrowDown className="w-3.5 h-3.5 shrink-0" />
              <span>{isStreaming ? 'Reply streaming below' : 'Jump to bottom'}</span>
            </button>
          </div>
        )}
        </div>

        {/* Ergonomic Bottom Thumb-Zone Composer */}
        <Composer
          input={input}
          onChangeInput={setInput}
          onSend={() => handleSend()}
          onStop={handleStop}
          isStreaming={isStreaming}
          hasActiveKey={Boolean(activeKeyObj)}
          attachments={attachments}
          onAddAttachments={(added) => setAttachments((prev) => [...prev, ...added])}
          onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={(modelId) => setSelectedModel(modelId)}
          modelTests={modelTests}
          onTestModel={handleTestModel}
          isSyncingModels={isSyncingModels}
          onSyncModels={() => syncModelsForKey(activeKeyObj)}
          onOpenModelsManager={openKeyModelsModal}
          roles={allRoles}
          selectedRole={selectedRole}
          onSelectRole={(roleId) => setSelectedRoleId(roleId)}
          fastReplies={fastReplies}
          onToggleFastReplies={() => setFastReplies((v) => !v)}
        />
      </main>

      {/* Right Side / Mobile Sheet Artifact Canvas */}
      <CanvasDrawer
        artifact={activeArtifact}
        onClose={() => setActiveArtifact(null)}
      />

      {/* Base API, Keys & Live Synced Models Test Sheet */}
      <KeyModelsModal
        isOpen={managerOpen}
        initialTab={managerTab}
        onClose={() => setManagerOpen(false)}
        savedKeys={savedKeys}
        activeKeyId={activeKeyObj?.id || ''}
        onAddKey={handleAddUserKey}
        onUpdateKey={handleUpdateUserKey}
        onSelectKey={(id) => {
          setModelTests({});
          setActiveKeyId(id);
        }}
        onRemoveKey={handleRemoveUserKey}
        models={models}
        selectedModel={selectedModel}
        onSelectModel={(modelId) => setSelectedModel(modelId)}
        isSyncing={isSyncingModels}
        syncError={syncError}
        syncedSourceUrl={syncedSourceUrl}
        onSyncModels={() => syncModelsForKey(activeKeyObj)}
        modelTests={modelTests}
        onTestModel={handleTestModel}
        customModels={activeKeyObj?.customModels || []}
        onAddCustomModels={handleAddCustomModels}
        onRemoveCustomModel={handleRemoveCustomModel}
      />
    </div>
  );
}
