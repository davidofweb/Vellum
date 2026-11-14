import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  GitBranch,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Sun,
  Volume2,
  WifiOff,
} from './components/RareIcons';
import {
  AgentRole,
  ArtifactItem,
  Attachment,
  BackgroundChatRunState,
  ChatMessage,
  Conversation,
  InboundAgentTask,
  ManagerTab,
  ModelOption,
  ModelTestResult,
  SavedUserKey,
  SharedKeyLinkSummary,
} from './types';
import { BASE_API_PRESETS, BUILT_IN_ROLES, STARTER_PROMPTS } from './constants';
import { extractArtifactsFromText } from './utils/artifacts';
import {
  AGENTROUTER_OPENAI_MODELS,
  cancelBackgroundChatRun,
  createSharedKeyLink,
  deleteSharedKeyLink,
  fetchBackgroundChatRun,
  fetchCatalogFallbackModels,
  fetchOwnerSharedLinks,
  fetchPublicSharePass,
  fetchWorkspaceChatRuns,
  isAgentRouterFamilyHost,
  isAgentRouterMainHost,
  isAuthKeyErrorString,
  isFirewallErrorString,
  isLocalOnlyBaseUrl,
  sanitizeApiKey,
  sanitizeBaseUrlInput,
  sanitizeWafCookie,
  startBackgroundChatRun,
  streamChatFromGateway,
  subscribeToBackgroundChatRun,
  syncModelsFromGateway,
  testModelOnGateway,
  updateSharedKeyLink,
} from './utils/gateway';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { CanvasDrawer } from './components/CanvasDrawer';
import { Sidebar } from './components/Sidebar';
import { Composer } from './components/Composer';
import {
  KeyModelsModal,
  formatShareRemainingTime,
} from './components/KeyModelsModal';
import { InstallAppModal } from './components/InstallAppModal';
import { isSpeechSynthesisSupported, prepareTextForSpeech } from './utils/speech';
import {
  createThinkStreamSplitter,
  withThinkingInstruction,
} from './utils/streamThinkParser';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';

const STORAGE_CHATS_KEY = 'vellum_conversations_v2';
const STORAGE_ROLES_KEY = 'vellum_custom_roles_v2';
const STORAGE_THEME_KEY = 'vellum_dark_mode_v2';
const STORAGE_MODEL_KEY = 'vellum_selected_model_v2';
const STORAGE_KEYS_LIST = 'vellum_user_keys_v2';
const STORAGE_ACTIVE_KEY_ID = 'vellum_active_key_id_v2';
const STORAGE_WORKSPACE_ID = 'vellum_workspace_id_v2';
const STORAGE_FAST_REPLIES_KEY = 'vellum_fast_replies_v1';
const STORAGE_STICKY_SCROLL_KEY = 'vellum_sticky_scroll_v1';
const STORAGE_ACTIVE_CHAT_ID = 'vellum_active_chat_id_v1';
const STORAGE_DRAFT_INPUT_KEY = 'vellum_draft_input_v1';
const STORAGE_OWNER_TOKEN_KEY = 'vellum_share_owner_token_v1';
const STORAGE_GUEST_SHARE_ID_KEY = 'vellum_guest_share_id_v1';
const STORAGE_GUEST_CUSTOM_MODELS_KEY = 'vellum_guest_custom_models_v1';

function getOrCreateOwnerToken(): string {
  try {
    const existing = localStorage.getItem(STORAGE_OWNER_TOKEN_KEY);
    if (existing && existing.trim().length >= 16) {
      return existing.trim();
    }
    const bytes = new Uint8Array(24);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    const token =
      'own_' +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    localStorage.setItem(STORAGE_OWNER_TOKEN_KEY, token);
    return token;
  } catch {
    return `own_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  }
}

function readInitialGuestShareId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const url = new URL(window.location.href);
    const fromQuery = (url.searchParams.get('share') || '').trim();
    if (fromQuery) {
      localStorage.setItem(STORAGE_GUEST_SHARE_ID_KEY, fromQuery);
      url.searchParams.delete('share');
      const nextRelative =
        url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '') + url.hash;
      window.history.replaceState({}, '', nextRelative);
      return fromQuery;
    }
    return (localStorage.getItem(STORAGE_GUEST_SHARE_ID_KEY) || '').trim();
  } catch {
    return '';
  }
}

function recoverSavedConversations(rawList: unknown): Conversation[] | null {
  if (!Array.isArray(rawList) || rawList.length === 0) return null;
  return rawList.map((conv: Conversation) => ({
    ...conv,
    messages: Array.isArray(conv.messages)
      ? conv.messages.map((m) => {
          if (!m.isStreaming) return m;
          // Keep backend-tracked runs in streaming state so startup sync seamlessly reattaches or loads finished output
          if (m.runId) {
            return {
              ...m,
              isStreaming: true,
              interrupted: false,
            };
          }
          return {
            ...m,
            isStreaming: false,
            interrupted: true,
          };
        })
      : [],
  }));
}

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

  const [ownerToken] = useState<string>(() => getOrCreateOwnerToken());
  const [sharedLinks, setSharedLinks] = useState<SharedKeyLinkSummary[]>([]);
  const [isLoadingShares, setIsLoadingShares] = useState<boolean>(false);

  const [guestShareId, setGuestShareId] = useState<string>(() => readInitialGuestShareId());
  const [guestSharePass, setGuestSharePass] = useState<SharedKeyLinkSummary | null>(null);
  const [guestPassError, setGuestPassError] = useState<string | null>(null);
  const [isRefreshingGuestPass, setIsRefreshingGuestPass] = useState<boolean>(false);
  const [guestCustomModels, setGuestCustomModels] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_GUEST_CUSTOM_MODELS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const isGuestMode = Boolean(guestShareId);
  const hasActiveConnection = isGuestMode || Boolean(activeKeyObj);

  const guestPassBlockedReason = useMemo(() => {
    if (!isGuestMode) return null;
    if (guestPassError) return guestPassError;
    if (!guestSharePass) return null;
    if (guestSharePass.effectiveStatus === 'revoked') {
      return 'This shared link was turned off by its owner.';
    }
    if (guestSharePass.effectiveStatus === 'expired') {
      return 'This shared link has passed its time limit.';
    }
    if (guestSharePass.effectiveStatus === 'exhausted') {
      return 'This shared link has used all of its allowed messages.';
    }
    return null;
  }, [isGuestMode, guestPassError, guestSharePass]);

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
        const recovered = recoverSavedConversations(JSON.parse(raw));
        if (recovered) return recovered;
      }
    } catch {
      // Ignore
    }
    return [createBlankConversation('', BUILT_IN_ROLES[0].id)];
  });

  const [activeId, setActiveId] = useState<string>(() => {
    try {
      const savedId = localStorage.getItem(STORAGE_ACTIVE_CHAT_ID);
      if (savedId && conversations.some((c) => c.id === savedId)) {
        return savedId;
      }
    } catch {
      // Ignore
    }
    return conversations[0]?.id || '';
  });
  const activeConversation =
    conversations.find((c) => c.id === activeId) || conversations[0];

  const isStreaming = Boolean(
    activeConversation?.messages.some((m) => m.isStreaming)
  );
  const anyConversationStreaming = useMemo(
    () => conversations.some((c) => c.messages.some((m) => m.isStreaming)),
    [conversations]
  );

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1280 : false
  );

  const [input, setInput] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_DRAFT_INPUT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [liveThinkingSec, setLiveThinkingSec] = useState(0);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactItem | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [speechSupported] = useState<boolean>(() => isSpeechSynthesisSupported());
  const [expandedThinking, setExpandedThinking] = useState<
    Record<string, boolean | undefined>
  >({});
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
  const [installModalOpen, setInstallModalOpen] = useState(false);

  const {
    canPromptDirectly,
    isInstalled: isAppInstalled,
    isIOS,
    isInIframe,
    install: promptInstallApp,
  } = usePWAInstall();
  const isOnline = useOnlineStatus();

  const [activeView, setActiveView] = useState<'chat' | 'sharing' | 'settings'>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      if (hash === '#sharing') return 'sharing';
      if (hash === '#settings') return 'settings';
    }
    return 'chat';
  });

  const [managerOpen, setManagerOpen] = useState(false);
  const [managerTab, setManagerTab] = useState<ManagerTab>('models');
  const [managerShareKeyId, setManagerShareKeyId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash === '#sharing') {
        setActiveView('sharing');
        setManagerTab('shares');
        setManagerOpen(true);
      } else if (hash === '#settings') {
        setActiveView('settings');
        setManagerTab('models');
        setManagerOpen(true);
      } else {
        setActiveView('chat');
        setManagerOpen(false);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateToView = useCallback((view: 'chat' | 'sharing' | 'settings') => {
    setActiveView(view);
    if (view === 'chat') {
      window.location.hash = '';
      setManagerOpen(false);
    } else if (view === 'sharing') {
      window.location.hash = 'sharing';
      setManagerTab('shares');
      setManagerOpen(true);
    } else if (view === 'settings') {
      window.location.hash = 'settings';
      setManagerTab('models');
      setManagerOpen(true);
    }
  }, []);

  const openKeyModelsModal = useCallback((tab: ManagerTab, shareKeyId?: string) => {
    setManagerTab(tab);
    setManagerShareKeyId(shareKeyId);
    setManagerOpen(true);
    if (tab === 'shares') {
      setActiveView('sharing');
      window.location.hash = 'sharing';
    } else {
      setActiveView('settings');
      window.location.hash = 'settings';
    }
  }, []);

  const [inlineLabel, setInlineLabel] = useState('');
  const [inlineBaseUrl, setInlineBaseUrl] = useState('https://agentrouter.org/v1');
  const [inlineKeyInput, setInlineKeyInput] = useState('');
  const [inlineWafCookie, setInlineWafCookie] = useState('');
  const [showInlineCookieField, setShowInlineCookieField] = useState(false);
  const [showInlineKey, setShowInlineKey] = useState(false);

  const localStreamControllersRef = useRef<Map<string, AbortController>>(new Map());
  const attachedRunStreamsRef = useRef<Map<string, AbortController>>(new Map());
  const reconcilingRunsRef = useRef<boolean>(false);
  const speechSessionRef = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const stickyScrollRef = useRef<boolean>(stickyScroll);
  const userScrolledUpRef = useRef<boolean>(false);
  const lastScrollTopRef = useRef<number>(0);
  const programmaticScrollRef = useRef<boolean>(false);
  const conversationsRef = useRef<Conversation[]>(conversations);
  const activeIdRef = useRef<string>(activeId);
  const draftInputRef = useRef<string>(input);
  const lastSavedChatsAtRef = useRef<number>(0);

  conversationsRef.current = conversations;
  activeIdRef.current = activeId;
  draftInputRef.current = input;

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
      // Detach browser SSE listeners on unmount without cancelling backend runs
      attachedRunStreamsRef.current.forEach((ctrl) => ctrl.abort());
      attachedRunStreamsRef.current.clear();
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

  const persistConversationsSnapshot = useCallback((snapshot: Conversation[]) => {
    try {
      localStorage.setItem(STORAGE_CHATS_KEY, JSON.stringify(snapshot));
      lastSavedChatsAtRef.current = Date.now();
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    const flushNow = () => {
      persistConversationsSnapshot(conversationsRef.current);
    };
    const handleVisibilityFlush = () => {
      if (document.visibilityState === 'hidden') {
        flushNow();
      }
    };
    window.addEventListener('pagehide', flushNow);
    window.addEventListener('beforeunload', flushNow);
    document.addEventListener('visibilitychange', handleVisibilityFlush);
    return () => {
      window.removeEventListener('pagehide', flushNow);
      window.removeEventListener('beforeunload', flushNow);
      document.removeEventListener('visibilitychange', handleVisibilityFlush);
    };
  }, [persistConversationsSnapshot]);

  useEffect(() => {
    if (!anyConversationStreaming) {
      persistConversationsSnapshot(conversations);
      return;
    }

    const elapsed = Date.now() - lastSavedChatsAtRef.current;
    if (elapsed >= 700) {
      persistConversationsSnapshot(conversations);
      return;
    }

    const timer = window.setTimeout(() => {
      persistConversationsSnapshot(conversationsRef.current);
    }, 700 - elapsed);
    return () => window.clearTimeout(timer);
  }, [conversations, anyConversationStreaming, persistConversationsSnapshot]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ACTIVE_CHAT_ID, activeId);
    } catch {
      // Ignore
    }
  }, [activeId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DRAFT_INPUT_KEY, input);
    } catch {
      // Ignore
    }
  }, [input]);

  useEffect(() => {
    const flushAllProgress = () => {
      try {
        localStorage.setItem(STORAGE_CHATS_KEY, JSON.stringify(conversationsRef.current));
        localStorage.setItem(STORAGE_ACTIVE_CHAT_ID, activeIdRef.current);
        localStorage.setItem(STORAGE_DRAFT_INPUT_KEY, draftInputRef.current);
      } catch {
        // Ignore
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushAllProgress();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushAllProgress);
    window.addEventListener('beforeunload', flushAllProgress);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushAllProgress);
      window.removeEventListener('beforeunload', flushAllProgress);
    };
  }, []);

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

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_GUEST_CUSTOM_MODELS_KEY, JSON.stringify(guestCustomModels));
    } catch {
      // Ignore
    }
  }, [guestCustomModels]);

  const refreshOwnerShares = useCallback(async () => {
    if (!ownerToken) return;
    setIsLoadingShares(true);
    try {
      const list = await fetchOwnerSharedLinks(ownerToken);
      setSharedLinks(list);
    } finally {
      setIsLoadingShares(false);
    }
  }, [ownerToken]);

  useEffect(() => {
    if (savedKeys.length > 0) {
      void refreshOwnerShares();
    }
  }, [savedKeys.length, refreshOwnerShares]);

  const handleCreateShareLink = useCallback(
    async (params: {
      keyId: string;
      label: string;
      expiresInHours: number | null;
      maxMessages: number | null;
    }): Promise<SharedKeyLinkSummary> => {
      const targetKey =
        savedKeys.find((k) => k.id === params.keyId) || activeKeyObj;
      if (!targetKey) {
        throw new Error('Pick a saved key first.');
      }
      const created = await createSharedKeyLink({
        ownerToken,
        label: params.label,
        baseUrl: targetKey.baseUrl,
        rawApiKey: targetKey.apiKey,
        rawWafCookie: targetKey.wafCookie,
        customModels: targetKey.customModels,
        expiresInHours: params.expiresInHours,
        maxMessages: params.maxMessages,
      });
      setSharedLinks((prev) => [
        created,
        ...prev.filter((item) => item.shareId !== created.shareId),
      ]);
      return created;
    },
    [savedKeys, activeKeyObj, ownerToken]
  );

  const handleToggleRevokeShareLink = useCallback(
    async (shareId: string, nextStatus: 'active' | 'revoked') => {
      const updated = await updateSharedKeyLink({
        ownerToken,
        shareId,
        status: nextStatus,
      });
      setSharedLinks((prev) =>
        prev.map((item) => (item.shareId === shareId ? updated : item))
      );
      if (guestShareId === shareId) {
        setGuestSharePass(updated);
        if (updated.effectiveStatus === 'active') {
          setGuestPassError(null);
        }
      }
    },
    [ownerToken, guestShareId]
  );

  const handleDeleteShareLink = useCallback(
    async (shareId: string) => {
      await deleteSharedKeyLink(ownerToken, shareId);
      setSharedLinks((prev) => prev.filter((item) => item.shareId !== shareId));
      if (guestShareId === shareId) {
        setGuestSharePass(null);
        setGuestPassError('This shared link was removed by its owner.');
      }
    },
    [ownerToken, guestShareId]
  );

  const handleRefreshGuestPass = useCallback(async () => {
    if (!guestShareId) return;
    setIsRefreshingGuestPass(true);
    try {
      const latestPass = await fetchPublicSharePass(guestShareId);
      setGuestSharePass(latestPass);
      setGuestPassError(null);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'This shared link is no longer available.';
      setGuestPassError(msg);
    } finally {
      setIsRefreshingGuestPass(false);
    }
  }, [guestShareId]);

  const handleExitGuestMode = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_GUEST_SHARE_ID_KEY);
    } catch {
      // Ignore
    }
    setGuestShareId('');
    setGuestSharePass(null);
    setGuestPassError(null);
    setModelTests({});
    setSyncError(null);
  }, []);

  const buildCustomModelOptions = useCallback(
    (ids?: string[]): ModelOption[] =>
      (ids || [])
        .map((s) => s.trim())
        .filter(Boolean)
        .map((id) => ({
          id,
          label: id,
          ownedBy: id.includes('/') ? id.split('/')[0] : 'openai',
        })),
    []
  );

  const syncModelsForGuest = useCallback(
    async (shareIdToSync: string, localCustomIds: string[]) => {
      if (!shareIdToSync.trim()) return;
      setIsSyncingModels(true);
      setSyncError(null);
      setGuestPassError(null);

      try {
        let passSummary: SharedKeyLinkSummary | undefined;
        try {
          passSummary = await fetchPublicSharePass(shareIdToSync);
          setGuestSharePass(passSummary);
        } catch (passErr: unknown) {
          const msg =
            passErr instanceof Error
              ? passErr.message
              : 'This shared link was not found or was removed.';
          setGuestSharePass(null);
          setGuestPassError(msg);
          setModels([]);
          setSelectedModel('');
          setSyncedSourceUrl(null);
          return;
        }

        if (
          passSummary.effectiveStatus === 'revoked' ||
          passSummary.effectiveStatus === 'expired'
        ) {
          const customFallback = buildCustomModelOptions([
            ...passSummary.customModels,
            ...localCustomIds,
          ]);
          setModels(customFallback);
          setSelectedModel((prev) =>
            customFallback.some((m) => m.id === prev) ? prev : customFallback[0]?.id || ''
          );
          setSyncedSourceUrl(passSummary.hostHint);
          return;
        }

        let data = await syncModelsFromGateway('', '', undefined, shareIdToSync);
        if (data.share) {
          passSummary = data.share;
          setGuestSharePass(data.share);
        }

        if (data.models.length === 0) {
          const fallbackData = await fetchCatalogFallbackModels(
            '',
            '',
            undefined,
            shareIdToSync
          );
          if (fallbackData.share) {
            passSummary = fallbackData.share;
            setGuestSharePass(fallbackData.share);
          }
          if (fallbackData.models.length > 0) {
            data = {
              ...data,
              models: fallbackData.models,
              sourceUrl: fallbackData.sourceUrl || data.sourceUrl,
              gatewayMessage: fallbackData.gatewayMessage || data.gatewayMessage,
            };
          } else if (
            passSummary?.hostHint === 'agentrouter.org' ||
            passSummary?.hostHint === 'www.agentrouter.org'
          ) {
            data = {
              ...data,
              models: AGENTROUTER_OPENAI_MODELS.map((m) => ({ ...m })),
              sourceUrl: data.sourceUrl || passSummary.hostHint,
            };
          }
        }

        setSyncedSourceUrl(data.sourceUrl || passSummary?.hostHint || null);

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
        for (const m of [
          ...data.models,
          ...buildCustomModelOptions(passSummary?.customModels),
          ...buildCustomModelOptions(localCustomIds),
        ]) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            mergedModels.push(m);
          }
        }

        setModels(mergedModels);
        if (mergedModels.length === 0) {
          setSelectedModel('');
          setSyncError(
            data.gatewayMessage ||
              'Connected via shared link, but 0 models were returned. Add model IDs in Models to continue.'
          );
        } else {
          setSelectedModel((prev) =>
            mergedModels.some((m) => m.id === prev) ? prev : mergedModels[0].id
          );
        }
      } catch (err: unknown) {
        const errWithShare = err as Error & { share?: SharedKeyLinkSummary };
        if (errWithShare?.share) {
          setGuestSharePass(errWithShare.share);
        }
        const errMessage = err instanceof Error ? err.message : 'Unable to sync models.';
        const fallbackCustom = buildCustomModelOptions([
          ...(errWithShare?.share?.customModels || []),
          ...localCustomIds,
        ]);
        setModels(fallbackCustom);
        if (fallbackCustom.length > 0) {
          setSelectedModel((prev) =>
            fallbackCustom.some((m) => m.id === prev) ? prev : fallbackCustom[0].id
          );
        } else {
          setSelectedModel('');
        }
        setSyncError(errMessage);
      } finally {
        setIsSyncingModels(false);
      }
    },
    [buildCustomModelOptions]
  );

  const syncModelsForKey = useCallback(async (keyItem: SavedUserKey | null) => {
    if (!keyItem?.apiKey || !keyItem?.baseUrl) {
      setModels([]);
      setSelectedModel('');
      setSyncError(null);
      setSyncedSourceUrl(null);
      return;
    }

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
      for (const m of [...data.models, ...buildCustomModelOptions(keyItem.customModels)]) {
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
          for (const m of [...fallbackData.models, ...buildCustomModelOptions(keyItem.customModels)]) {
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

      const fallbackCustom = buildCustomModelOptions(keyItem.customModels);
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
  }, [buildCustomModelOptions]);

  const guestCustomModelsRef = useRef<string[]>(guestCustomModels);
  guestCustomModelsRef.current = guestCustomModels;

  const syncModelsForActiveConnection = useCallback(async () => {
    if (isGuestMode) {
      await syncModelsForGuest(guestShareId, guestCustomModelsRef.current);
      return;
    }
    await syncModelsForKey(activeKeyObj);
  }, [isGuestMode, guestShareId, activeKeyObj, syncModelsForGuest, syncModelsForKey]);

  useEffect(() => {
    if (isGuestMode) {
      void syncModelsForGuest(guestShareId, guestCustomModelsRef.current);
      return;
    }
    void syncModelsForKey(activeKeyObj);
  }, [
    isGuestMode,
    guestShareId,
    activeKeyObj?.id,
    activeKeyObj?.apiKey,
    activeKeyObj?.baseUrl,
    activeKeyObj?.wafCookie,
    syncModelsForGuest,
    syncModelsForKey,
  ]);

  const handleTestModel = useCallback(
    async (modelId: string) => {
      if (!isGuestMode && (!activeKeyObj?.apiKey || !activeKeyObj?.baseUrl)) return;

      setModelTests((prev) => ({
        ...prev,
        [modelId]: { status: 'testing' },
      }));

      const result = isGuestMode
        ? await testModelOnGateway({
            baseUrl: '',
            rawApiKey: '',
            shareId: guestShareId,
            onShareUpdated: (updated) => {
              setGuestSharePass(updated);
              setGuestPassError(null);
            },
            model: modelId,
          })
        : await testModelOnGateway({
            baseUrl: activeKeyObj!.baseUrl,
            rawApiKey: activeKeyObj!.apiKey,
            rawWafCookie: activeKeyObj!.wafCookie,
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
    [isGuestMode, guestShareId, activeKeyObj]
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
    if (!isGuestMode && !activeKeyObj) return;
    const additions = rawInput
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (additions.length === 0) return;

    if (isGuestMode) {
      setGuestCustomModels((prev) => Array.from(new Set([...prev, ...additions])));
    } else if (activeKeyObj) {
      setSavedKeys((prev) =>
        prev.map((item) => {
          if (item.id !== activeKeyObj.id) return item;
          const merged = Array.from(new Set([...(item.customModels || []), ...additions]));
          return { ...item, customModels: merged };
        })
      );
    }

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
    if (!isGuestMode && !activeKeyObj) return;
    if (isGuestMode) {
      setGuestCustomModels((prev) => prev.filter((id) => id !== modelId));
    } else if (activeKeyObj) {
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
    }
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

  const selectedRole =
    allRoles.find((r) => r.id === selectedRoleId) || BUILT_IN_ROLES[0];


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

  const handleInstallClick = useCallback(async () => {
    if (canPromptDirectly) {
      const result = await promptInstallApp();
      if (result === 'manual') {
        setInstallModalOpen(true);
      }
      return;
    }
    setInstallModalOpen(true);
  }, [canPromptDirectly, promptInstallApp]);

  const applyRunStateToConversations = useCallback(
    (run: BackgroundChatRunState) => {
      setConversations((prev) => {
        let changed = false;
        const next = prev.map((c) => {
          const hasMatchingMsg =
            c.id === run.conversationId ||
            c.messages.some(
              (m) => m.runId === run.runId || m.id === run.assistantMsgId
            );
          if (!hasMatchingMsg) return c;

          const updatedMessages = c.messages.map((m) => {
            if (m.runId !== run.runId && m.id !== run.assistantMsgId) return m;
            changed = true;
            const nextContent = run.content || m.content;
            const nextThinking = run.thinking || m.thinking;
            const nextSecs = run.thinkingSeconds || m.thinkingSeconds;

            if (run.status === 'running') {
              return {
                ...m,
                runId: run.runId,
                content: nextContent,
                thinking: nextThinking,
                thinkingSeconds: nextSecs || undefined,
                isStreaming: true,
                interrupted: false,
                error: undefined,
              };
            }

            if (run.status === 'done') {
              return {
                ...m,
                runId: run.runId,
                content: nextContent,
                thinking: nextThinking,
                thinkingSeconds: nextSecs || undefined,
                isStreaming: false,
                interrupted: false,
                error: undefined,
              };
            }

            if (run.status === 'cancelled') {
              return {
                ...m,
                runId: run.runId,
                content: nextContent,
                thinking: nextThinking,
                thinkingSeconds: nextSecs || undefined,
                isStreaming: false,
                interrupted: true,
                error: undefined,
              };
            }

            // status === 'failed'
            const hasPartial = Boolean(
              (nextContent || '').trim() || (nextThinking || '').trim()
            );
            return {
              ...m,
              runId: run.runId,
              content: nextContent,
              thinking: nextThinking,
              thinkingSeconds: nextSecs || undefined,
              isStreaming: false,
              interrupted: hasPartial,
              error: run.error || 'Something went wrong.',
            };
          });

          return {
            ...c,
            messages: updatedMessages,
            ...(run.status !== 'running' ? { updatedAt: run.updatedAt || Date.now() } : {}),
          };
        });

        if (!changed) return prev;
        if (run.status !== 'running' || document.visibilityState === 'hidden') {
          persistConversationsSnapshot(next);
        }
        return next;
      });

      if (
        run.status === 'done' &&
        run.conversationId === activeIdRef.current &&
        typeof window !== 'undefined' &&
        window.innerWidth >= 1280
      ) {
        const extracted = extractArtifactsFromText(run.assistantMsgId, run.content);
        const firstPreviewable = extracted.find((a) => a.previewable);
        if (firstPreviewable) {
          setActiveArtifact((curr) => curr || firstPreviewable);
        }
      }
    },
    [persistConversationsSnapshot]
  );

  const runDirectBrowserStreamFallback = useCallback(
    async (params: {
      convId: string;
      assistantMsgId: string;
      payloadMessages: { role: 'system' | 'user' | 'assistant'; content: string }[];
      modelToUse: string;
      roleToUse: AgentRole;
      userKey: SavedUserKey;
      baseContent: string;
      baseThinking: string;
      baseSeconds: number;
    }) => {
      const {
        convId,
        assistantMsgId,
        payloadMessages,
        modelToUse,
        roleToUse,
        userKey,
        baseContent,
        baseThinking,
        baseSeconds,
      } = params;

      localStreamControllersRef.current.get(convId)?.abort();
      const controller = new AbortController();
      localStreamControllersRef.current.set(convId, controller);

      // Clear detached runId immediately so background reconciliation never overwrites active browser fallback
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, runId: undefined, isStreaming: true, error: undefined }
                    : m
                ),
              }
            : c
        )
      );

      let rafId: number | null = null;
      let bgTimerId: number | null = null;
      let accumulatedContent = baseContent;
      let accumulatedThinking = baseThinking;
      const startedThinkingAt = Date.now();
      let recordedThinkingSec = baseSeconds;
      let hasStartedContent = Boolean(baseContent.trim());

      const tickInterval = window.setInterval(() => {
        if (!hasStartedContent) {
          const sec =
            baseSeconds + Math.max(1, Math.round((Date.now() - startedThinkingAt) / 1000));
          recordedThinkingSec = sec;
          if (convId === activeIdRef.current) {
            setLiveThinkingSec(sec);
          }
        }
      }, 1000);

      const commitLocalState = (done = false, interrupted = false) => {
        setConversations((prev) => {
          const next = prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          runId: undefined,
                          content: accumulatedContent,
                          thinking: accumulatedThinking,
                          thinkingSeconds: recordedThinkingSec || undefined,
                          ...(done
                            ? {
                                isStreaming: false,
                                interrupted,
                                error: undefined,
                              }
                            : { isStreaming: true, error: undefined }),
                        }
                      : m
                  ),
                  ...(done ? { updatedAt: Date.now() } : {}),
                }
              : c
          );
          if (done || document.visibilityState === 'hidden') {
            persistConversationsSnapshot(next);
          }
          return next;
        });
      };

      const cancelPendingFlush = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (bgTimerId !== null) {
          window.clearTimeout(bgTimerId);
          bgTimerId = null;
        }
      };

      const scheduleStreamFlush = () => {
        if (document.visibilityState === 'hidden') {
          if (bgTimerId !== null) return;
          bgTimerId = window.setTimeout(() => {
            bgTimerId = null;
            commitLocalState(false);
          }, 220);
          return;
        }
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          commitLocalState(false);
        });
      };

      const splitter = createThinkStreamSplitter({
        onContent: (cleanDelta) => {
          if (!hasStartedContent && cleanDelta.trim()) {
            hasStartedContent = true;
            recordedThinkingSec =
              baseSeconds + Math.max(1, Math.round((Date.now() - startedThinkingAt) / 1000));
            if (convId === activeIdRef.current) {
              setLiveThinkingSec(recordedThinkingSec);
            }
          }
          accumulatedContent += cleanDelta;
          scheduleStreamFlush();
        },
        onThinking: (cleanThought) => {
          if (!hasStartedContent) {
            recordedThinkingSec =
              baseSeconds + Math.max(1, Math.round((Date.now() - startedThinkingAt) / 1000));
          }
          accumulatedThinking += cleanThought;
          scheduleStreamFlush();
        },
      });

      try {
        await streamChatFromGateway({
          baseUrl: userKey.baseUrl,
          rawApiKey: userKey.apiKey,
          rawWafCookie: userKey.wafCookie,
          model: modelToUse,
          messages: payloadMessages,
          systemPrompt: withThinkingInstruction(roleToUse.instructions),
          temperature: roleToUse.temperature,
          reasoningEffort: fastReplies ? 'low' : 'medium',
          signal: controller.signal,
          onContent: (delta) => splitter.pushContent(delta),
          onThinking: (delta) => {
            if (
              accumulatedThinking &&
              !accumulatedThinking.endsWith('\n') &&
              delta.startsWith('-')
            ) {
              splitter.pushNativeThinking(`\n${delta}`);
            } else {
              splitter.pushNativeThinking(delta);
            }
          },
        });

        splitter.flush();
        cancelPendingFlush();
        commitLocalState(true, false);

        if (convId === activeIdRef.current && window.innerWidth >= 1280) {
          const extracted = extractArtifactsFromText(assistantMsgId, accumulatedContent);
          const firstPreviewable = extracted.find((a) => a.previewable);
          if (firstPreviewable) setActiveArtifact(firstPreviewable);
        }
      } catch (err: unknown) {
        splitter.flush();
        cancelPendingFlush();
        if (controller.signal.aborted) {
          commitLocalState(true, true);
        } else {
          const message = err instanceof Error ? err.message : 'Something went wrong.';
          const hasPartialProgress = Boolean(
            accumulatedContent.trim() || accumulatedThinking.trim()
          );
          setConversations((prev) => {
            const next = prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsgId
                        ? {
                            ...m,
                            runId: undefined,
                            content: accumulatedContent,
                            thinking: accumulatedThinking,
                            thinkingSeconds: recordedThinkingSec || undefined,
                            isStreaming: false,
                            interrupted: hasPartialProgress,
                            error: message,
                          }
                        : m
                    ),
                    updatedAt: Date.now(),
                  }
                : c
            );
            persistConversationsSnapshot(next);
            return next;
          });
        }
      } finally {
        window.clearInterval(tickInterval);
        if (localStreamControllersRef.current.get(convId) === controller) {
          localStreamControllersRef.current.delete(convId);
        }
      }
    },
    [fastReplies, persistConversationsSnapshot]
  );

  const attachToBackgroundRun = useCallback(
    (
      convId: string,
      assistantMsgId: string,
      runId: string,
      firewallFallback?: () => Promise<void>
    ) => {
      if (attachedRunStreamsRef.current.has(runId)) {
        return;
      }

      const sseController = new AbortController();
      attachedRunStreamsRef.current.set(runId, sseController);

      let rafId: number | null = null;
      let bgTimerId: number | null = null;
      let accumulatedContent = '';
      let accumulatedThinking = '';
      let recordedThinkingSec = 0;

      const cancelPendingFlush = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (bgTimerId !== null) {
          window.clearTimeout(bgTimerId);
          bgTimerId = null;
        }
      };

      const commitLiveProgress = () => {
        if (convId === activeIdRef.current && recordedThinkingSec > 0) {
          setLiveThinkingSec(recordedThinkingSec);
        }
        setConversations((prev) => {
          const next = prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.runId === runId || m.id === assistantMsgId
                      ? {
                          ...m,
                          runId,
                          content: accumulatedContent,
                          thinking: accumulatedThinking,
                          thinkingSeconds: recordedThinkingSec || m.thinkingSeconds,
                          isStreaming: true,
                          interrupted: false,
                          error: undefined,
                        }
                      : m
                  ),
                }
              : c
          );
          if (document.visibilityState === 'hidden') {
            persistConversationsSnapshot(next);
          }
          return next;
        });
      };

      const scheduleLiveFlush = () => {
        if (document.visibilityState === 'hidden') {
          if (bgTimerId !== null) return;
          bgTimerId = window.setTimeout(() => {
            bgTimerId = null;
            commitLiveProgress();
          }, 250);
          return;
        }
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          commitLiveProgress();
        });
      };

      let usedFirewallFallback = false;

      void (async () => {
        try {
          const outcome = await subscribeToBackgroundChatRun(
            runId,
            {
              onSnapshot: (run) => {
                accumulatedContent = run.content || '';
                accumulatedThinking = run.thinking || '';
                recordedThinkingSec = run.thinkingSeconds || 0;
                cancelPendingFlush();
                commitLiveProgress();
              },
              onDelta: ({ contentDelta, thinkingDelta, thinkingSeconds }) => {
                if (contentDelta) accumulatedContent += contentDelta;
                if (thinkingDelta) accumulatedThinking += thinkingDelta;
                if (thinkingSeconds > 0) {
                  recordedThinkingSec = thinkingSeconds;
                  if (convId === activeIdRef.current && !contentDelta && !thinkingDelta) {
                    setLiveThinkingSec(thinkingSeconds);
                    return;
                  }
                }
                scheduleLiveFlush();
              },
              onFinished: (run) => {
                cancelPendingFlush();
                const errText = run.error || '';
                const shouldFallbackToBrowser =
                  run.status === 'failed' &&
                  !run.content.trim() &&
                  Boolean(firewallFallback) &&
                  (isFirewallErrorString(errText) || isAuthKeyErrorString(errText));

                if (shouldFallbackToBrowser) {
                  usedFirewallFallback = true;
                  return;
                }
                applyRunStateToConversations(run);
              },
            },
            sseController.signal
          );

          if (usedFirewallFallback && firewallFallback) {
            await firewallFallback();
            return;
          }

          if (outcome === 'not_found') {
            setConversations((prev) => {
              const next = prev.map((c) =>
                c.id === convId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.runId === runId || m.id === assistantMsgId
                          ? {
                              ...m,
                              isStreaming: false,
                              interrupted: true,
                            }
                          : m
                      ),
                    }
                  : c
              );
              persistConversationsSnapshot(next);
              return next;
            });
          }
        } catch {
          cancelPendingFlush();
          // If the browser tab went into mobile background suspension or Wi-Fi blipped,
          // the backend job is STILL running! Never mark failed — reconcile when visible.
          if (!sseController.signal.aborted && document.visibilityState === 'visible') {
            window.setTimeout(async () => {
              try {
                const latest = await fetchBackgroundChatRun(runId);
                if (!latest) return;
                if (latest.status === 'running') {
                  attachToBackgroundRun(convId, assistantMsgId, runId);
                } else {
                  applyRunStateToConversations(latest);
                }
              } catch {
                // Will reconcile automatically on focus / online / visibilitychange
              }
            }, 1200);
          }
        } finally {
          if (attachedRunStreamsRef.current.get(runId) === sseController) {
            attachedRunStreamsRef.current.delete(runId);
          }
        }
      })();
    },
    [applyRunStateToConversations, persistConversationsSnapshot]
  );

  const reconcileWorkspaceRuns = useCallback(async () => {
    if (reconcilingRunsRef.current) return;
    if (conversationsRef.current.length === 0) return;

    reconcilingRunsRef.current = true;
    try {
      const serverRuns = await fetchWorkspaceChatRuns(workspaceId);
      const runsById = new Map(serverRuns.map((r) => [r.runId, r]));
      const runsByMsgKey = new Map(
        serverRuns.map((r) => [`${r.conversationId}:${r.assistantMsgId}`, r])
      );

      const missingStreamingTargets: Array<{ convId: string; msgId: string; runId: string }> =
        [];

      for (const conv of conversationsRef.current) {
        if (localStreamControllersRef.current.has(conv.id)) continue;
        for (const msg of conv.messages) {
          if (msg.role !== 'assistant') continue;
          const serverRun =
            (msg.runId ? runsById.get(msg.runId) : undefined) ||
            runsByMsgKey.get(`${conv.id}:${msg.id}`);
          if (serverRun) {
            const shouldApply =
              msg.isStreaming ||
              (serverRun.status === 'done' &&
                (msg.interrupted || serverRun.content.length > msg.content.length)) ||
              serverRun.content.length > msg.content.length;

            if (shouldApply) {
              applyRunStateToConversations(serverRun);
            }
            if (serverRun.status === 'running') {
              attachToBackgroundRun(conv.id, msg.id, serverRun.runId);
            }
          } else if (msg.isStreaming && msg.runId) {
            missingStreamingTargets.push({
              convId: conv.id,
              msgId: msg.id,
              runId: msg.runId,
            });
          }
        }
      }

      for (const missing of missingStreamingTargets) {
        const directCheck = await fetchBackgroundChatRun(missing.runId);
        if (directCheck) {
          applyRunStateToConversations(directCheck);
          if (directCheck.status === 'running') {
            attachToBackgroundRun(missing.convId, missing.msgId, directCheck.runId);
          }
        } else {
          setConversations((prev) => {
            const next = prev.map((c) =>
              c.id === missing.convId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === missing.msgId
                        ? {
                            ...m,
                            isStreaming: false,
                            interrupted: true,
                          }
                        : m
                    ),
                  }
                : c
            );
            persistConversationsSnapshot(next);
            return next;
          });
        }
      }
    } catch {
      // Ignore transient offline sync errors; will retry on online / focus
    } finally {
      reconcilingRunsRef.current = false;
    }
  }, [
    workspaceId,
    applyRunStateToConversations,
    attachToBackgroundRun,
    persistConversationsSnapshot,
  ]);

  useEffect(() => {
    void reconcileWorkspaceRuns();

    const handleVisibleSync = () => {
      if (document.visibilityState === 'visible') {
        void reconcileWorkspaceRuns();
      }
    };

    const handleResumeSync = () => {
      void reconcileWorkspaceRuns();
    };

    document.addEventListener('visibilitychange', handleVisibleSync);
    window.addEventListener('pageshow', handleResumeSync);
    window.addEventListener('focus', handleResumeSync);
    window.addEventListener('online', handleResumeSync);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibleSync);
      window.removeEventListener('pageshow', handleResumeSync);
      window.removeEventListener('focus', handleResumeSync);
      window.removeEventListener('online', handleResumeSync);
    };
  }, [reconcileWorkspaceRuns]);

  useEffect(() => {
    if (!anyConversationStreaming) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void reconcileWorkspaceRuns();
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [anyConversationStreaming, reconcileWorkspaceRuns]);

  const streamAgentResponse = useCallback(
    async (
      convId: string,
      historyMessages: ChatMessage[],
      modelToUse: string,
      roleToUse: AgentRole,
      connection:
        | { mode: 'guest'; shareId: string }
        | { mode: 'key'; userKey: SavedUserKey },
      resumeTarget?: {
        msgId: string;
        existingContent: string;
        existingThinking: string;
        existingSeconds: number;
      }
    ) => {
      const assistantMsgId =
        resumeTarget?.msgId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const baseSeconds = resumeTarget?.existingSeconds || 0;
      const baseContent = resumeTarget?.existingContent || '';
      const baseThinking = resumeTarget?.existingThinking || '';
      const useLocalOnly =
        connection.mode === 'key' && isLocalOnlyBaseUrl(connection.userKey.baseUrl);
      const runId = useLocalOnly
        ? undefined
        : `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      setLiveThinkingSec(baseSeconds);
      userScrolledUpRef.current = false;

      if (resumeTarget) {
        setConversations((prev) => {
          const next = prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          runId,
                          isStreaming: true,
                          interrupted: false,
                          error: undefined,
                        }
                      : m
                  ),
                  updatedAt: Date.now(),
                }
              : c
          );
          persistConversationsSnapshot(next);
          return next;
        });
      } else {
        const initialAssistantMessage: ChatMessage = {
          id: assistantMsgId,
          role: 'assistant',
          content: '',
          thinking: '',
          thinkingSeconds: 0,
          model: modelToUse,
          createdAt: Date.now(),
          isStreaming: true,
          interrupted: false,
          runId,
        };

        setConversations((prev) => {
          const next = prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: [...historyMessages, initialAssistantMessage],
                  updatedAt: Date.now(),
                }
              : c
          );
          persistConversationsSnapshot(next);
          return next;
        });
      }

      if (stickyScrollRef.current) {
        requestAnimationFrame(() => scrollToBottom('smooth'));
      }

      const payloadMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] =
        historyMessages.map((m) => {
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

      if (resumeTarget && baseContent.trim()) {
        payloadMessages.push({
          role: 'assistant',
          content: baseContent,
        });
        payloadMessages.push({
          role: 'user',
          content:
            'Continue directly from the exact character where your previous output stopped. Do not repeat earlier code or text; finish the remaining output cleanly.',
        });
      }

      if (connection.mode === 'guest') {
        try {
          await startBackgroundChatRun({
            runId: runId!,
            workspaceId,
            conversationId: convId,
            assistantMsgId,
            baseUrl: '',
            rawApiKey: '',
            shareId: connection.shareId,
            onShareUpdated: (updated) => {
              setGuestSharePass(updated);
              setGuestPassError(null);
            },
            model: modelToUse,
            messages: payloadMessages,
            systemPrompt: withThinkingInstruction(roleToUse.instructions),
            temperature: roleToUse.temperature,
            reasoningEffort: fastReplies ? 'low' : 'medium',
            initialContent: baseContent,
            initialThinking: baseThinking,
            baseThinkingSeconds: baseSeconds,
          });

          // Never fall back to browser-direct streaming in Guest Mode so raw keys never leave the server
          attachToBackgroundRun(convId, assistantMsgId, runId!);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unable to start request.';
          setConversations((prev) => {
            const next = prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsgId
                        ? {
                            ...m,
                            runId: undefined,
                            isStreaming: false,
                            interrupted: Boolean(baseContent.trim() || baseThinking.trim()),
                            error: message,
                          }
                        : m
                    ),
                    updatedAt: Date.now(),
                  }
                : c
            );
            persistConversationsSnapshot(next);
            return next;
          });
        }
        return;
      }

      const { userKey } = connection;

      if (useLocalOnly || !runId) {
        await runDirectBrowserStreamFallback({
          convId,
          assistantMsgId,
          payloadMessages,
          modelToUse,
          roleToUse,
          userKey,
          baseContent,
          baseThinking,
          baseSeconds,
        });
        return;
      }

      const effectiveBaseUrl =
        syncedSourceUrl &&
        isAgentRouterFamilyHost(userKey.baseUrl) &&
        isAgentRouterFamilyHost(syncedSourceUrl)
          ? syncedSourceUrl
          : userKey.baseUrl;
      const effectiveUserKey: SavedUserKey =
        effectiveBaseUrl !== userKey.baseUrl
          ? { ...userKey, baseUrl: effectiveBaseUrl }
          : userKey;

      try {
        await startBackgroundChatRun({
          runId,
          workspaceId,
          conversationId: convId,
          assistantMsgId,
          baseUrl: effectiveUserKey.baseUrl,
          rawApiKey: effectiveUserKey.apiKey,
          rawWafCookie: effectiveUserKey.wafCookie,
          model: modelToUse,
          messages: payloadMessages,
          systemPrompt: withThinkingInstruction(roleToUse.instructions),
          temperature: roleToUse.temperature,
          reasoningEffort: fastReplies ? 'low' : 'medium',
          initialContent: baseContent,
          initialThinking: baseThinking,
          baseThinkingSeconds: baseSeconds,
        });

        attachToBackgroundRun(convId, assistantMsgId, runId, () =>
          runDirectBrowserStreamFallback({
            convId,
            assistantMsgId,
            payloadMessages,
            modelToUse,
            roleToUse,
            userKey: effectiveUserKey,
            baseContent,
            baseThinking,
            baseSeconds,
          })
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unable to start request.';
        setConversations((prev) => {
          const next = prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          runId: undefined,
                          isStreaming: false,
                          interrupted: Boolean(baseContent.trim() || baseThinking.trim()),
                          error: message,
                        }
                      : m
                  ),
                  updatedAt: Date.now(),
                }
              : c
          );
          persistConversationsSnapshot(next);
          return next;
        });
      }
    },
    [
      workspaceId,
      fastReplies,
      syncedSourceUrl,
      scrollToBottom,
      persistConversationsSnapshot,
      attachToBackgroundRun,
      runDirectBrowserStreamFallback,
    ]
  );

  const handleSend = useCallback(
    (overridePrompt?: string) => {
      if (isGuestMode) {
        if (guestPassBlockedReason) {
          openKeyModelsModal('shares');
          return;
        }
      } else if (!activeKeyObj) {
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
      const cleanTitleSource = text || attachments[0]?.name || 'New task';
      const taskSnippet = cleanTitleSource.replace(/\s+/g, ' ').slice(0, 42);
      const nextTitle = isFirstMessage
        ? `Task: ${taskSnippet}`
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

      void streamAgentResponse(
        activeConversation.id,
        nextMessages,
        selectedModel,
        selectedRole,
        isGuestMode
          ? { mode: 'guest', shareId: guestShareId }
          : { mode: 'key', userKey: activeKeyObj! }
      );
    },
    [
      isGuestMode,
      guestShareId,
      guestPassBlockedReason,
      activeKeyObj,
      selectedModel,
      input,
      attachments,
      isStreaming,
      activeConversation,
      selectedRole,
      openKeyModelsModal,
      streamAgentResponse,
    ]
  );

  const handleStop = () => {
    if (!activeConversation) return;
    localStreamControllersRef.current.get(activeConversation.id)?.abort();

    const runningMessages = activeConversation.messages.filter((m) => m.isStreaming);
    for (const msg of runningMessages) {
      if (msg.runId) {
        attachedRunStreamsRef.current.get(msg.runId)?.abort();
        attachedRunStreamsRef.current.delete(msg.runId);
        void cancelBackgroundChatRun(msg.runId);
      }
    }

    if (runningMessages.length > 0) {
      setConversations((prev) => {
        const next = prev.map((c) =>
          c.id === activeConversation.id
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.isStreaming
                    ? {
                        ...m,
                        isStreaming: false,
                        interrupted: true,
                      }
                    : m
                ),
                updatedAt: Date.now(),
              }
            : c
        );
        persistConversationsSnapshot(next);
        return next;
      });
    }
  };

  const handleNewChat = () => {
    stopSpeaking();
    // Existing chats continue running in the backend while you start a new chat
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
    localStreamControllersRef.current.get(id)?.abort();
    const targetConv = conversations.find((c) => c.id === id);
    if (targetConv) {
      for (const m of targetConv.messages) {
        if (m.isStreaming && m.runId) {
          attachedRunStreamsRef.current.get(m.runId)?.abort();
          attachedRunStreamsRef.current.delete(m.runId);
          void cancelBackgroundChatRun(m.runId);
        }
      }
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
    if (isStreaming || !activeConversation || !hasActiveConnection || !selectedModel) return;
    if (isGuestMode && guestPassBlockedReason) {
      openKeyModelsModal('shares');
      return;
    }
    stopSpeaking();
    const historyBefore = activeConversation.messages.slice(0, assistantMsgIndex);
    if (historyBefore.length === 0) return;
    void streamAgentResponse(
      activeConversation.id,
      historyBefore,
      selectedModel,
      selectedRole,
      isGuestMode
        ? { mode: 'guest', shareId: guestShareId }
        : { mode: 'key', userKey: activeKeyObj! }
    );
  };

  const handleContinueInterruptedMessage = (assistantMsgIndex: number) => {
    if (isStreaming || !activeConversation || !hasActiveConnection || !selectedModel) return;
    if (isGuestMode && guestPassBlockedReason) {
      openKeyModelsModal('shares');
      return;
    }
    stopSpeaking();
    const targetMsg = activeConversation.messages[assistantMsgIndex];
    if (!targetMsg || targetMsg.role !== 'assistant') return;
    const historyBefore = activeConversation.messages.slice(0, assistantMsgIndex);
    if (historyBefore.length === 0) return;

    const conn = isGuestMode
      ? ({ mode: 'guest', shareId: guestShareId } as const)
      : ({ mode: 'key', userKey: activeKeyObj! } as const);

    if (!targetMsg.content.trim()) {
      void streamAgentResponse(
        activeConversation.id,
        historyBefore,
        targetMsg.model || selectedModel,
        selectedRole,
        conn
      );
      return;
    }

    void streamAgentResponse(
      activeConversation.id,
      historyBefore,
      targetMsg.model || selectedModel,
      selectedRole,
      conn,
      {
        msgId: targetMsg.id,
        existingContent: targetMsg.content,
        existingThinking: targetMsg.thinking || '',
        existingSeconds: targetMsg.thinkingSeconds || 0,
      }
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
    if (!hasActiveConnection || !selectedModel) return;
    const res = await fetch(`/api/inbox?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(isGuestMode
          ? { 'x-vellum-share-id': guestShareId }
          : {
              'x-agentrouter-key': activeKeyObj!.apiKey,
              'x-agentrouter-base-url': activeKeyObj!.baseUrl,
              ...(activeKeyObj!.wafCookie
                ? { 'x-agentrouter-cookie': activeKeyObj!.wafCookie }
                : {}),
            }),
      },
      body: JSON.stringify({
        workspaceId,
        title: promptText.slice(0, 44),
        prompt: promptText,
        sender: isGuestMode ? guestSharePass?.label || 'Shared Pass' : activeKeyObj!.label,
        model: selectedModel,
        systemPrompt: selectedRole.instructions,
        autoRun: true,
      }),
    });
    const data = await res.json().catch(() => null);
    if (data?.share) {
      setGuestSharePass(data.share as SharedKeyLinkSummary);
    }
    if (res.ok && data?.task) {
      const returnedTask: InboundAgentTask = data.task;
      setInboxTasks((prev) => [
        returnedTask,
        ...prev.filter((t) => t.id !== returnedTask.id),
      ]);
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
        onOpenKeyManager={(tab) => openKeyModelsModal(tab)}
        isGuestMode={isGuestMode}
        guestShareId={guestShareId}
        guestSharePass={guestSharePass}
        sharedLinksCount={sharedLinks.length}
        conversations={conversations}
        activeId={activeConversation?.id || ''}
        onSelectConversation={(id) => {
          stopSpeaking();
          setLiveThinkingSec(0);
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
        showInstallButton={!isAppInstalled}
        onInstallApp={handleInstallClick}
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

            <div className="flex items-center gap-2.5 min-w-0">
              <span className="font-display font-bold tracking-tight text-xl text-foreground">
                Vellum
              </span>
              {activeConversation?.messages.length > 0 && (
                <span className="text-xs font-mono text-muted-foreground truncate max-w-[240px]">
                  · {activeConversation.title}
                </span>
              )}
            </div>
          </div>
        </header>

        {isGuestMode && (
          <div
            className={`px-3 sm:px-6 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums shrink-0 ${
              guestPassBlockedReason
                ? 'border-destructive/35 bg-destructive/5 text-destructive'
                : 'border-foreground/12 bg-foreground/[0.025] text-foreground'
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              <Link2 className="w-3.5 h-3.5 shrink-0" />
              {guestPassBlockedReason ? (
                <span className="font-semibold">{guestPassBlockedReason}</span>
              ) : guestSharePass ? (
                <>
                  <span className="font-bold truncate max-w-[160px] sm:max-w-[240px]">
                    {guestSharePass.label}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    ·
                  </span>
                  <span className="font-semibold">
                    {guestSharePass.maxMessages !== null
                      ? `${guestSharePass.usedMessages}/${guestSharePass.maxMessages} msgs`
                      : `${guestSharePass.usedMessages} msgs`}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    ·
                  </span>
                  <span className="text-muted-foreground">
                    {formatShareRemainingTime(guestSharePass.expiresAt)}
                  </span>
                  <span aria-hidden="true" className="hidden sm:inline text-muted-foreground">
                    ·
                  </span>
                  <span className="hidden sm:inline text-muted-foreground">Key hidden</span>
                </>
              ) : (
                <span className="text-muted-foreground">Connecting shared link...</span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => openKeyModelsModal('shares')}
                className="min-h-[36px] px-3 rounded-full border border-foreground/15 hover:bg-foreground/5 text-[11px] font-mono font-semibold text-foreground transition-colors whitespace-nowrap shrink-0"
              >
                Pass Details
              </button>
              <button
                type="button"
                onClick={handleExitGuestMode}
                className="min-h-[36px] px-3 rounded-full bg-foreground hover:bg-foreground/90 text-background text-[11px] font-sans font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                {savedKeys.length > 0 ? 'Switch to My Key' : 'Use Own Key'}
              </button>
            </div>
          </div>
        )}

        {!isOnline && (
          <div className="px-4 py-2 border-b border-foreground/15 bg-foreground/[0.04] flex items-center justify-center gap-2 text-xs font-medium text-foreground shrink-0">
            <WifiOff className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <span>Offline — your saved chats stay available here until you reconnect.</span>
          </div>
        )}

        {/* Scrollable Stage */}
        <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={scrollContainerRef}
          onScroll={handleStageScroll}
          className={`flex-1 overflow-y-auto px-4 sm:px-8 ${
            !hasActiveConnection || !activeConversation || activeConversation.messages.length === 0
              ? 'optimus-grid'
              : ''
          }`}
        >
          {!hasActiveConnection ? (
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
                  Enter your Base API URL and personal key manually to sync models from your endpoint, test response times, and create disguised share links whenever you want.
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
                        Not needed on mobile for personal use. Useful if you plan to share an agentrouter.org link.
                      </p>
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={!inlineBaseUrl.trim() || !inlineKeyInput.trim()}
                    className="w-full h-13 px-8 rounded-full bg-foreground hover:bg-foreground/90 text-background text-sm sm:text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-30 transition-all group"
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
                      onClick={() => openKeyModelsModal(isGuestMode ? 'shares' : 'keys')}
                      className="text-destructive underline underline-offset-4"
                    >
                      {syncError ||
                        guestPassBlockedReason ||
                        (isGuestMode
                          ? 'No models synced — check shared pass'
                          : 'No models synced — check Base API & key')}
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
                      onClick={() => void syncModelsForActiveConnection()}
                      className="min-h-[44px] px-4 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-mono font-semibold text-foreground flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Retry Sync</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        openKeyModelsModal(
                          /0 models/i.test(syncError)
                            ? 'models'
                            : isGuestMode
                              ? 'shares'
                              : 'keys'
                        )
                      }
                      className="min-h-[44px] px-4 rounded-full bg-foreground text-background text-xs font-semibold whitespace-nowrap"
                    >
                      {/0 models/i.test(syncError)
                        ? 'Add Model IDs'
                        : isGuestMode
                          ? 'Pass Details'
                          : 'Edit Base API'}
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
                const userToggledThinking = expandedThinking[msg.id];
                const thinkingOpen =
                  userToggledThinking !== undefined
                    ? userToggledThinking
                    : Boolean(msg.isStreaming);
                const activeThinkingSecs = msg.isStreaming
                  ? liveThinkingSec || msg.thinkingSeconds || 0
                  : msg.thinkingSeconds || 0;

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
                    {(msg.thinking || msg.isStreaming) && (
                      <div className="rounded-2xl border border-foreground/12 bg-foreground/[0.025] overflow-hidden">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedThinking((prev) => ({
                              ...prev,
                              [msg.id]: !thinkingOpen,
                            }))
                          }
                          className="w-full min-h-[42px] px-3.5 py-2 flex items-center justify-between gap-2 font-mono text-xs font-semibold text-foreground/85 hover:text-foreground transition-colors text-left"
                        >
                          <span className="inline-flex flex-wrap items-center gap-2 min-w-0">
                            {msg.isStreaming ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-muted-foreground" />
                            ) : thinkingOpen ? (
                              <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span>
                              {msg.isStreaming && !msg.content
                                ? 'Thinking through your request'
                                : 'Thought process'}
                            </span>
                            {activeThinkingSecs > 0 && (
                              <span className="text-muted-foreground font-normal tabular-nums">
                                · {activeThinkingSecs}s
                              </span>
                            )}
                            {msg.isStreaming && msg.runId && (
                              <span className="text-[11px] font-normal text-muted-foreground hidden sm:inline">
                                · Continues in background if closed
                              </span>
                            )}
                          </span>
                          <span className="text-[11px] font-normal text-muted-foreground shrink-0">
                            {thinkingOpen ? 'Hide' : 'Show'}
                          </span>
                        </button>
                        {thinkingOpen && (
                          <div className="px-4 pb-3.5 pt-2 border-t border-foreground/10 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                            {msg.thinking ||
                              (msg.isStreaming && msg.runId
                                ? 'Running in the background — keeps going even if you close the app.'
                                : 'Planning structure and steps...')}
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
                    ) : null}

                    {msg.interrupted && !msg.isStreaming && (
                      <div className="p-3.5 rounded-2xl border border-foreground/20 bg-foreground/[0.03] flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs font-semibold tracking-tight text-foreground">
                          Paused before finishing — your request and progress were saved.
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleContinueInterruptedMessage(index)}
                            className="min-h-[40px] px-4 rounded-full bg-foreground text-background text-xs font-semibold flex items-center gap-1.5 hover:bg-foreground/90 transition-colors"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>
                              {msg.content.trim() ? 'Continue building' : 'Run request now'}
                            </span>
                          </button>
                          {msg.content.trim() && (
                            <button
                              type="button"
                              onClick={() => handleRetryMessage(index)}
                              className="min-h-[40px] px-3.5 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-semibold text-foreground flex items-center gap-1.5 transition-colors"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Start over</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {msg.error && (
                      <div className="p-4 border border-destructive/40 bg-destructive/5 flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="font-mono text-xs font-semibold text-destructive break-words">
                            {msg.error}
                          </div>
                          {!isGuestMode && isAuthKeyErrorString(msg.error) && (
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              Make sure your API key matches your selected Base API URL (keys from agentrouter.org and co.agentrouter.org are separate) and has no extra characters.
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {isGuestMode ? (
                            <button
                              type="button"
                              onClick={() => openKeyModelsModal('shares')}
                              className="min-h-[38px] px-3.5 rounded-full bg-foreground text-background text-xs font-semibold flex items-center gap-1.5 hover:bg-foreground/90 transition-colors whitespace-nowrap"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                              <span>Pass Details</span>
                            </button>
                          ) : (
                            isAuthKeyErrorString(msg.error) && (
                              <button
                                type="button"
                                onClick={() => openKeyModelsModal('keys')}
                                className="min-h-[38px] px-3.5 rounded-full bg-foreground text-background text-xs font-semibold flex items-center gap-1.5 hover:bg-foreground/90 transition-colors whitespace-nowrap"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                                <span>Check API Key</span>
                              </button>
                            )
                          )}
                          <button
                            type="button"
                            onClick={() => handleRetryMessage(index)}
                            className="min-h-[38px] px-3.5 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-semibold text-foreground flex items-center gap-1.5 transition-colors whitespace-nowrap"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Retry</span>
                          </button>
                        </div>
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

        {showJumpToBottom && hasActiveConnection && Boolean(activeConversation?.messages.length) && (
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
          hasActiveKey={hasActiveConnection}
          isGuestMode={isGuestMode}
          guestPassBlockedReason={guestPassBlockedReason}
          attachments={attachments}
          onAddAttachments={(added) => setAttachments((prev) => [...prev, ...added])}
          onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={(modelId) => setSelectedModel(modelId)}
          modelTests={modelTests}
          onTestModel={handleTestModel}
          isSyncingModels={isSyncingModels}
          onSyncModels={syncModelsForActiveConnection}
          onOpenModelsManager={(tab) => openKeyModelsModal(tab)}
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

      {/* Base API, Keys, Disguised Share Links & Live Synced Models Test Sheet */}
      <KeyModelsModal
        isOpen={managerOpen}
        initialTab={managerTab}
        initialShareKeyId={managerShareKeyId}
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
        onSyncModels={syncModelsForActiveConnection}
        modelTests={modelTests}
        onTestModel={handleTestModel}
        customModels={isGuestMode ? guestCustomModels : activeKeyObj?.customModels || []}
        onAddCustomModels={handleAddCustomModels}
        onRemoveCustomModel={handleRemoveCustomModel}
        isGuestMode={isGuestMode}
        guestShareId={guestShareId}
        guestSharePass={guestSharePass}
        guestPassError={guestPassError}
        isRefreshingGuestPass={isRefreshingGuestPass}
        onRefreshGuestPass={handleRefreshGuestPass}
        onExitGuestMode={handleExitGuestMode}
        hasPersonalKeys={savedKeys.length > 0}
        sharedLinks={sharedLinks}
        isLoadingShares={isLoadingShares}
        onRefreshShares={refreshOwnerShares}
        onCreateShareLink={handleCreateShareLink}
        onToggleRevokeShareLink={handleToggleRevokeShareLink}
        onDeleteShareLink={handleDeleteShareLink}
      />

      {/* Install App Guide Modal (iOS Safari / Browser Fallback) */}
      <InstallAppModal
        isOpen={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        isIOS={isIOS}
        isInIframe={isInIframe}
      />
    </div>
  );
}
