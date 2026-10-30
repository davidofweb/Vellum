import React, { useState, useMemo, useRef } from 'react';
import {
  AlertCircle,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  ManagerTab,
  ModelOption,
  ModelTestResult,
  SavedUserKey,
  SharedKeyLinkSummary,
} from '../types';
import { BASE_API_PRESETS } from '../constants';
import { isAgentRouterMainHost } from '../utils/gateway';

interface KeyModelsModalProps {
  isOpen: boolean;
  initialTab?: ManagerTab;
  initialShareKeyId?: string;
  onClose: () => void;
  savedKeys: SavedUserKey[];
  activeKeyId: string;
  onAddKey: (
    label: string,
    apiKey: string,
    baseUrl: string,
    wafCookie?: string
  ) => Promise<void>;
  onUpdateKey: (
    id: string,
    label: string,
    apiKey: string,
    baseUrl: string,
    wafCookie?: string
  ) => Promise<void>;
  onSelectKey: (id: string) => void;
  onRemoveKey: (id: string) => void;
  models: ModelOption[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  isSyncing: boolean;
  syncError: string | null;
  syncedSourceUrl?: string | null;
  onSyncModels: () => Promise<void>;
  modelTests: Record<string, ModelTestResult>;
  onTestModel: (modelId: string) => Promise<void>;
  customModels?: string[];
  onAddCustomModels?: (rawInput: string) => void;
  onRemoveCustomModel?: (modelId: string) => void;
  isGuestMode?: boolean;
  guestShareId?: string;
  guestSharePass?: SharedKeyLinkSummary | null;
  guestPassError?: string | null;
  isRefreshingGuestPass?: boolean;
  onRefreshGuestPass?: () => Promise<void>;
  onExitGuestMode?: () => void;
  hasPersonalKeys?: boolean;
  sharedLinks?: SharedKeyLinkSummary[];
  isLoadingShares?: boolean;
  onRefreshShares?: () => Promise<void>;
  onCreateShareLink?: (params: {
    keyId: string;
    label: string;
    expiresInHours: number | null;
    maxMessages: number | null;
  }) => Promise<SharedKeyLinkSummary>;
  onToggleRevokeShareLink?: (
    shareId: string,
    nextStatus: 'active' | 'revoked'
  ) => Promise<void>;
  onDeleteShareLink?: (shareId: string) => Promise<void>;
}

const EXPIRY_PRESETS: Array<{ label: string; hours: number | null }> = [
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
  { label: 'No limit', hours: null },
];

const MESSAGE_LIMIT_PRESETS: Array<{ label: string; count: number | null | 'custom' }> = [
  { label: '10', count: 10 },
  { label: '25', count: 25 },
  { label: '50', count: 50 },
  { label: '100', count: 100 },
  { label: '500', count: 500 },
  { label: 'Unlimited', count: null },
  { label: 'Custom', count: 'custom' },
];

function maskApiKey(key: string): string {
  const clean = key.trim();
  if (clean.length <= 10) return '••••••••';
  return `${clean.slice(0, 5)}••••${clean.slice(-4)}`;
}

function formatContext(ctx?: number): string | null {
  if (!ctx || ctx <= 0) return null;
  if (ctx >= 1000000) return `${(ctx / 1000000).toFixed(ctx % 1000000 === 0 ? 0 : 1)}M ctx`;
  if (ctx >= 1000) return `${Math.round(ctx / 1000)}k ctx`;
  return `${ctx} ctx`;
}

export function formatShareRemainingTime(expiresAt: number | null): string {
  if (expiresAt === null) return 'No time limit';
  const diffMs = expiresAt - Date.now();
  if (diffMs <= 0) return 'Time ended';
  const mins = Math.ceil(diffMs / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 48) {
    const remMins = Math.floor((diffMs % 3600000) / 60000);
    return remMins > 0 && hours < 6 ? `${hours}h ${remMins}m left` : `${hours}h left`;
  }
  const days = Math.ceil(diffMs / 86400000);
  return `${days}d left`;
}

export function formatShareStatusLabel(status: SharedKeyLinkSummary['effectiveStatus']): string {
  if (status === 'revoked') return 'Revoked';
  if (status === 'expired') return 'Time ended';
  if (status === 'exhausted') return 'Limit reached';
  return 'Active';
}

export function buildDisguisedShareUrl(shareId: string): string {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  return `${origin}/?share=${encodeURIComponent(shareId)}`;
}

export const KeyModelsModal: React.FC<KeyModelsModalProps> = ({
  isOpen,
  initialTab = 'models',
  initialShareKeyId,
  onClose,
  savedKeys,
  activeKeyId,
  onAddKey,
  onUpdateKey,
  onSelectKey,
  onRemoveKey,
  models,
  selectedModel,
  onSelectModel,
  isSyncing,
  syncError,
  syncedSourceUrl,
  onSyncModels,
  modelTests,
  onTestModel,
  customModels = [],
  onAddCustomModels,
  onRemoveCustomModel,
  isGuestMode = false,
  guestShareId = '',
  guestSharePass = null,
  guestPassError = null,
  isRefreshingGuestPass = false,
  onRefreshGuestPass,
  onExitGuestMode,
  hasPersonalKeys = false,
  sharedLinks = [],
  isLoadingShares = false,
  onRefreshShares,
  onCreateShareLink,
  onToggleRevokeShareLink,
  onDeleteShareLink,
}) => {
  const resolveDefaultTab = (): ManagerTab => {
    if (isGuestMode) {
      return initialTab === 'keys' ? 'shares' : initialTab;
    }
    if (savedKeys.length === 0 && initialTab === 'models') {
      return 'keys';
    }
    return initialTab;
  };

  const [tab, setTab] = useState<ManagerTab>(resolveDefaultTab);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'working' | 'untested'>('all');
  const [customModelInput, setCustomModelInput] = useState('');

  const [labelInput, setLabelInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [wafCookieInput, setWafCookieInput] = useState('');
  const [showCookieField, setShowCookieField] = useState(false);
  const [showRawKey, setShowRawKey] = useState(false);
  const [addingKeyForm, setAddingKeyForm] = useState(savedKeys.length === 0);
  const [savingKey, setSavingKey] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editWafCookie, setEditWafCookie] = useState('');
  const [showEditCookieField, setShowEditCookieField] = useState(false);
  const [showEditRawKey, setShowEditRawKey] = useState(false);

  // Share link builder & list state
  const [shareKeyId, setShareKeyId] = useState<string>(
    initialShareKeyId || activeKeyId || savedKeys[0]?.id || ''
  );
  const [shareLabel, setShareLabel] = useState('');
  const [shareExpiryHours, setShareExpiryHours] = useState<number | null>(24);
  const [shareLimitPreset, setShareLimitPreset] = useState<number | null | 'custom'>(50);
  const [customMaxMessages, setCustomMaxMessages] = useState('30');
  const [creatingShare, setCreatingShare] = useState(false);
  const [shareFormError, setShareFormError] = useState<string | null>(null);
  const [justCreatedShare, setJustCreatedShare] = useState<SharedKeyLinkSummary | null>(null);
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);
  const [busyShareId, setBusyShareId] = useState<string | null>(null);

  const [batchTesting, setBatchTesting] = useState(false);
  const stopBatchRef = useRef(false);

  React.useEffect(() => {
    if (isOpen) {
      const nextTab = isGuestMode
        ? initialTab === 'keys'
          ? 'shares'
          : initialTab
        : savedKeys.length === 0 && initialTab === 'models'
          ? 'keys'
          : initialTab;
      setTab(nextTab);
      setAddingKeyForm(savedKeys.length === 0);
      setEditingId(null);
      setShareFormError(null);
      setShareKeyId(initialShareKeyId || activeKeyId || savedKeys[0]?.id || '');
      if (!isGuestMode && nextTab === 'shares' && onRefreshShares) {
        void onRefreshShares();
      }
    }
  }, [isOpen, initialTab, initialShareKeyId, isGuestMode, savedKeys.length, activeKeyId]);

  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      if (search.trim()) {
        const tokens = search
          .toLowerCase()
          .replace(/[-_/]+/g, ' ')
          .split(/\s+/)
          .filter(Boolean);
        const normalizedHaystack = `${m.id} ${m.label} ${m.ownedBy}`
          .toLowerCase()
          .replace(/[-_/]+/g, ' ');
        const rawHaystack = `${m.id} ${m.label} ${m.ownedBy}`.toLowerCase();
        const matches = tokens.every(
          (tok) => normalizedHaystack.includes(tok) || rawHaystack.includes(tok)
        );
        if (!matches) return false;
      }

      const testState = modelTests[m.id]?.status || 'idle';
      if (filterMode === 'working') return testState === 'ok';
      if (filterMode === 'untested') return testState === 'idle';
      return true;
    });
  }, [models, search, filterMode, modelTests]);

  if (!isOpen) return null;

  const selectedShareKeyObj =
    savedKeys.find((k) => k.id === shareKeyId) ||
    savedKeys.find((k) => k.id === activeKeyId) ||
    savedKeys[0] ||
    null;

  const copyShareUrlToClipboard = async (targetShareId: string) => {
    const url = buildDisguisedShareUrl(targetShareId);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedShareId(targetShareId);
      window.setTimeout(() => {
        setCopiedShareId((curr) => (curr === targetShareId ? null : curr));
      }, 2000);
    } catch {
      // Clipboard blocked in restricted context — input remains selectable
    }
  };

  const handleSaveNewKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseUrlInput.trim() || !keyInput.trim() || savingKey) return;
    setSavingKey(true);
    try {
      await onAddKey(
        labelInput.trim() || `Connection ${savedKeys.length + 1}`,
        keyInput.trim(),
        baseUrlInput.trim(),
        wafCookieInput.trim() || undefined
      );
      setLabelInput('');
      setBaseUrlInput('');
      setKeyInput('');
      setWafCookieInput('');
      setShowCookieField(false);
      setAddingKeyForm(false);
      setTab('models');
    } finally {
      setSavingKey(false);
    }
  };

  const startEditing = (item: SavedUserKey, expandCookie = false) => {
    setEditingId(item.id);
    setEditLabel(item.label);
    setEditBaseUrl(item.baseUrl);
    setEditApiKey(item.apiKey);
    setEditWafCookie(item.wafCookie || '');
    setShowEditCookieField(Boolean(item.wafCookie) || expandCookie);
    setShowEditRawKey(false);
    setAddingKeyForm(false);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId || !editBaseUrl.trim() || !editApiKey.trim() || savingKey) return;
    setSavingKey(true);
    try {
      await onUpdateKey(
        editingId,
        editLabel.trim() || 'Connection',
        editApiKey.trim(),
        editBaseUrl.trim(),
        editWafCookie.trim() || undefined
      );
      setEditingId(null);
      setTab('models');
    } finally {
      setSavingKey(false);
    }
  };

  const handleCreateShareSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateShareLink || !selectedShareKeyObj || creatingShare) return;

    let resolvedMaxMessages: number | null = null;
    if (shareLimitPreset === 'custom') {
      const parsed = Number.parseInt(customMaxMessages.trim(), 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        setShareFormError('Enter a message limit of at least 1, or choose Unlimited.');
        return;
      }
      resolvedMaxMessages = parsed;
    } else {
      resolvedMaxMessages = shareLimitPreset;
    }

    setCreatingShare(true);
    setShareFormError(null);
    try {
      const created = await onCreateShareLink({
        keyId: selectedShareKeyObj.id,
        label: shareLabel.trim() || `${selectedShareKeyObj.label} Pass`,
        expiresInHours: shareExpiryHours,
        maxMessages: resolvedMaxMessages,
      });
      setJustCreatedShare(created);
      setShareLabel('');
      await copyShareUrlToClipboard(created.shareId);
    } catch (err: unknown) {
      setShareFormError(
        err instanceof Error ? err.message : 'Could not create disguised link.'
      );
    } finally {
      setCreatingShare(false);
    }
  };

  const handleToggleRevoke = async (item: SharedKeyLinkSummary) => {
    if (!onToggleRevokeShareLink || busyShareId) return;
    const nextStatus = item.status === 'active' ? 'revoked' : 'active';
    setBusyShareId(item.shareId);
    try {
      await onToggleRevokeShareLink(item.shareId, nextStatus);
      if (justCreatedShare?.shareId === item.shareId && nextStatus === 'revoked') {
        setJustCreatedShare(null);
      }
    } catch (err: unknown) {
      setShareFormError(
        err instanceof Error ? err.message : 'Could not update link status.'
      );
    } finally {
      setBusyShareId(null);
    }
  };

  const handleDeleteShare = async (shareId: string) => {
    if (!onDeleteShareLink || busyShareId) return;
    setBusyShareId(shareId);
    try {
      await onDeleteShareLink(shareId);
      if (justCreatedShare?.shareId === shareId) {
        setJustCreatedShare(null);
      }
    } catch (err: unknown) {
      setShareFormError(
        err instanceof Error ? err.message : 'Could not delete link.'
      );
    } finally {
      setBusyShareId(null);
    }
  };

  const handleBatchTestVisible = async () => {
    if (batchTesting) {
      stopBatchRef.current = true;
      setBatchTesting(false);
      return;
    }

    const targets = filteredModels.slice(0, 6);
    if (targets.length === 0) return;

    stopBatchRef.current = false;
    setBatchTesting(true);

    for (const item of targets) {
      if (stopBatchRef.current) break;
      await onTestModel(item.id);
    }

    setBatchTesting(false);
  };

  const workingCount = models.filter((m) => modelTests[m.id]?.status === 'ok').length;
  const hasUsableConnection = isGuestMode
    ? Boolean(guestShareId) && (!guestSharePass || guestSharePass.effectiveStatus === 'active')
    : Boolean(activeKeyId);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div
        className="fixed inset-0 bg-foreground/25 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full sm:max-w-2xl max-h-[92dvh] flex flex-col bg-background text-foreground border-t sm:border border-foreground/15 shadow-2xl overflow-hidden pb-safe sm:pb-0">
        {/* Mobile Handle */}
        <div className="w-10 h-1 bg-foreground/20 rounded-full mx-auto mt-3 mb-1 sm:hidden" />

        {/* Architectural Underline Tab Bar */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-6 border-b border-foreground/10 shrink-0">
          <div className="flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setTab('models')}
              className={`min-h-[52px] px-3.5 sm:px-5 text-xs font-mono font-bold transition-colors relative whitespace-nowrap shrink-0 ${
                tab === 'models'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Models ({models.length})
              {tab === 'models' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
              )}
            </button>

            {!isGuestMode && (
              <button
                type="button"
                onClick={() => setTab('keys')}
                className={`min-h-[52px] px-3.5 sm:px-5 text-xs font-mono font-bold transition-colors relative whitespace-nowrap shrink-0 ${
                  tab === 'keys'
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Base API & Keys ({savedKeys.length})
                {tab === 'keys' && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setTab('shares');
                if (!isGuestMode && onRefreshShares) {
                  void onRefreshShares();
                }
              }}
              className={`min-h-[52px] px-3.5 sm:px-5 text-xs font-mono font-bold transition-colors relative whitespace-nowrap shrink-0 ${
                tab === 'shares'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {isGuestMode ? 'Shared Pass' : `Shared Links (${sharedLinks.length})`}
              {tab === 'shares' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {tab === 'shares' ? (
          isGuestMode ? (
            /* Guest Mode: Shared Access Pass Details (Zero Raw Keys Visible) */
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
              <div className="space-y-2">
                <span className="inline-flex items-center gap-3 text-xs font-mono font-semibold text-muted-foreground">
                  <span className="w-6 h-px bg-foreground/30" />
                  Shared Access Pass
                </span>
                <h2 className="text-3xl font-display tracking-tight text-foreground balance-text">
                  {guestSharePass?.label || 'Shared Workspace Link'}
                </h2>
                <p className="text-sm font-medium text-muted-foreground leading-relaxed">
                  You are connected through a disguised link. You have full access to synced models and custom roles while the owner’s API key stays hidden on the server.
                </p>
              </div>

              {guestPassError && (
                <div className="p-4 border border-destructive/40 bg-destructive/5 text-xs font-semibold text-destructive">
                  {guestPassError}
                </div>
              )}

              <div className="divide-y divide-foreground/10 border border-foreground/12 bg-foreground/[0.015]">
                <div className="p-4 flex items-center justify-between gap-4">
                  <span className="text-xs font-mono font-semibold text-muted-foreground">
                    Pass status
                  </span>
                  <span
                    className={`text-xs font-mono font-bold tabular-nums ${
                      guestSharePass?.effectiveStatus === 'active'
                        ? 'text-foreground'
                        : 'text-destructive'
                    }`}
                  >
                    {guestSharePass
                      ? formatShareStatusLabel(guestSharePass.effectiveStatus)
                      : guestPassError
                        ? 'Unavailable'
                        : 'Checking...'}
                  </span>
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                  <span className="text-xs font-mono font-semibold text-muted-foreground">
                    Messages used
                  </span>
                  <span className="text-xs font-mono font-bold text-foreground tabular-nums">
                    {guestSharePass
                      ? guestSharePass.maxMessages !== null
                        ? `${guestSharePass.usedMessages} / ${guestSharePass.maxMessages} messages`
                        : `${guestSharePass.usedMessages} used · Unlimited`
                      : '—'}
                  </span>
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                  <span className="text-xs font-mono font-semibold text-muted-foreground">
                    Time remaining
                  </span>
                  <span className="text-xs font-mono font-bold text-foreground tabular-nums">
                    {guestSharePass ? formatShareRemainingTime(guestSharePass.expiresAt) : '—'}
                  </span>
                </div>

                {guestSharePass?.hostHint && (
                  <div className="p-4 flex items-center justify-between gap-4">
                    <span className="text-xs font-mono font-semibold text-muted-foreground">
                      Connected host
                    </span>
                    <span className="text-xs font-mono font-semibold text-foreground truncate">
                      {guestSharePass.hostHint}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  {onRefreshGuestPass && (
                    <button
                      type="button"
                      onClick={() => void onRefreshGuestPass()}
                      disabled={isRefreshingGuestPass}
                      className="min-h-[44px] px-4 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-semibold text-foreground flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isRefreshingGuestPass ? 'animate-spin' : ''}`}
                      />
                      <span>Refresh Pass</span>
                    </button>
                  )}

                  {guestShareId && (
                    <button
                      type="button"
                      onClick={() => void copyShareUrlToClipboard(guestShareId)}
                      className="min-h-[44px] px-4 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-semibold text-foreground flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      {copiedShareId === guestShareId ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {copiedShareId === guestShareId ? 'Copied Link' : 'Copy Link'}
                      </span>
                    </button>
                  )}
                </div>

                {onExitGuestMode && (
                  <button
                    type="button"
                    onClick={() => {
                      onExitGuestMode();
                      onClose();
                    }}
                    className="min-h-[44px] px-5 rounded-full bg-foreground hover:bg-foreground/90 text-background text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>{hasPersonalKeys ? 'Switch to My Key' : 'Use My Own Key'}</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Owner Mode: Disguised Share Link Generator & Saved Links Manager */
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
              <div className="space-y-2">
                <span className="inline-flex items-center gap-3 text-xs font-mono font-semibold text-muted-foreground">
                  <span className="w-6 h-px bg-foreground/30" />
                  Disguised Sharing
                </span>
                <h2 className="text-3xl font-display tracking-tight text-foreground balance-text">
                  Share Your Key Without Showing It
                </h2>
                <p className="text-sm font-medium text-muted-foreground leading-relaxed">
                  Create a disguised link with time and message limits. Anyone opening it can use your full model list and custom roles without ever seeing or receiving your API key.
                </p>
              </div>

              {savedKeys.length === 0 ? (
                <div className="p-6 border border-foreground/12 bg-foreground/[0.015] text-center space-y-4">
                  <p className="font-display text-2xl text-foreground">
                    Save an API key first to share it
                  </p>
                  <p className="text-xs font-medium text-muted-foreground max-w-sm mx-auto leading-relaxed">
                    Add your Base API URL and personal API key once, then create as many disguised guest links as you want.
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab('keys')}
                    className="min-h-[46px] px-6 rounded-full bg-foreground text-background text-xs font-bold inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>Add Base API & Key</span>
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={handleCreateShareSubmit}
                  className="p-4 sm:p-5 border border-foreground/12 bg-foreground/[0.015] space-y-4"
                >
                  {savedKeys.length > 1 ? (
                    <div className="space-y-1.5">
                      <label className="block font-mono text-xs font-semibold text-muted-foreground">
                        Connection to disguise
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {savedKeys.map((k) => {
                          const isChosen = k.id === selectedShareKeyObj?.id;
                          return (
                            <button
                              key={k.id}
                              type="button"
                              onClick={() => setShareKeyId(k.id)}
                              className={`min-h-[42px] px-3.5 rounded-full border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                                isChosen
                                  ? 'bg-foreground text-background border-foreground'
                                  : 'border-foreground/15 text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                              }`}
                            >
                              {k.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : selectedShareKeyObj ? (
                    <div className="font-mono text-xs font-semibold text-muted-foreground">
                      <span>Disguising connection: </span>
                      <span className="text-foreground">{selectedShareKeyObj.label}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{selectedShareKeyObj.baseUrl.replace(/^https?:\/\//i, '')}</span>
                    </div>
                  ) : null}

                  {selectedShareKeyObj &&
                    isAgentRouterMainHost(selectedShareKeyObj.baseUrl) &&
                    !selectedShareKeyObj.wafCookie && (
                      <div className="p-3.5 border border-foreground/15 bg-background text-xs font-medium text-muted-foreground leading-relaxed">
                        Shared links run on the server so guests never touch your key. If{' '}
                        <span className="font-mono text-foreground">agentrouter.org</span> asks for a browser slider check,{' '}
                        <span className="font-mono text-foreground">co.agentrouter.org/v1</span> or{' '}
                        <span className="font-mono text-foreground">api.openai.com/v1</span> works best for shared links.
                      </div>
                    )}

                  <div className="space-y-1.5">
                    <label className="block font-mono text-xs font-semibold text-muted-foreground">
                      Link label (optional)
                    </label>
                    <input
                      type="text"
                      value={shareLabel}
                      onChange={(e) => setShareLabel(e.target.value)}
                      placeholder="Teammate, Design Review, or Friend Pass"
                      className="w-full min-h-[46px] px-3.5 bg-background border border-foreground/15 text-base sm:text-sm font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block font-mono text-xs font-semibold text-muted-foreground">
                      Expiration time
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {EXPIRY_PRESETS.map((preset) => {
                        const active = shareExpiryHours === preset.hours;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => setShareExpiryHours(preset.hours)}
                            className={`min-h-[44px] px-3.5 rounded-full border text-xs font-mono font-semibold transition-colors whitespace-nowrap shrink-0 ${
                              active
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

                  <div className="space-y-2">
                    <label className="block font-mono text-xs font-semibold text-muted-foreground">
                      Message limit
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {MESSAGE_LIMIT_PRESETS.map((preset) => {
                        const active = shareLimitPreset === preset.count;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => setShareLimitPreset(preset.count)}
                            className={`min-h-[44px] px-3.5 rounded-full border text-xs font-mono font-semibold tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                              active
                                ? 'bg-foreground text-background border-foreground'
                                : 'border-foreground/15 text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>

                    {shareLimitPreset === 'custom' && (
                      <div className="pt-1 flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={100000}
                          inputMode="numeric"
                          value={customMaxMessages}
                          onChange={(e) => setCustomMaxMessages(e.target.value)}
                          placeholder="Max messages (e.g. 30)"
                          className="w-48 min-h-[44px] px-3.5 bg-background border border-foreground/15 text-base sm:text-sm font-mono font-semibold text-foreground tabular-nums focus:outline-none focus:border-foreground/45"
                        />
                        <span className="text-xs font-mono text-muted-foreground">
                          total messages allowed
                        </span>
                      </div>
                    )}
                  </div>

                  {shareFormError && (
                    <div className="p-3 border border-destructive/40 bg-destructive/5 text-xs font-semibold text-destructive">
                      {shareFormError}
                    </div>
                  )}

                  <div className="flex items-center justify-end pt-1">
                    <button
                      type="submit"
                      disabled={!selectedShareKeyObj || creatingShare}
                      className="w-full sm:w-auto min-h-[48px] px-6 rounded-full bg-foreground hover:bg-foreground/90 text-background text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-40 transition-all whitespace-nowrap shrink-0"
                    >
                      {creatingShare ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Link2 className="w-4 h-4" />
                      )}
                      <span>Create Disguised Link</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Ready-to-Share Newly Created Link Bar */}
              {justCreatedShare && (
                <div className="p-4 border border-foreground/30 bg-foreground/[0.03] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-foreground">
                      Link ready to share · {justCreatedShare.label}
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-muted-foreground tabular-nums">
                      Key hidden on server
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={buildDisguisedShareUrl(justCreatedShare.shareId)}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 min-h-[44px] px-3.5 bg-background border border-foreground/15 text-base sm:text-xs font-mono font-semibold text-foreground focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void copyShareUrlToClipboard(justCreatedShare.shareId)}
                      className="min-h-[44px] px-5 rounded-full bg-foreground text-background text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      {copiedShareId === justCreatedShare.shareId ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {copiedShareId === justCreatedShare.shareId ? 'Copied!' : 'Copy Link'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Saved Shared Links Management List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-mono text-xs font-bold text-foreground tabular-nums">
                    Saved Shared Links ({sharedLinks.length})
                  </h3>
                  {onRefreshShares && (
                    <button
                      type="button"
                      onClick={() => void onRefreshShares()}
                      disabled={isLoadingShares}
                      className="min-h-[40px] px-3.5 rounded-full border border-foreground/15 hover:bg-foreground/5 text-xs font-mono font-semibold text-foreground flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isLoadingShares ? 'animate-spin' : ''}`}
                      />
                      <span>Refresh Usage</span>
                    </button>
                  )}
                </div>

                {sharedLinks.length === 0 ? (
                  <div className="py-10 px-4 border border-foreground/10 text-center space-y-1.5">
                    <p className="font-display text-2xl text-foreground">
                      No disguised links created yet
                    </p>
                    <p className="text-xs font-medium text-muted-foreground">
                      Every link you create appears here with live message counts and instant cutoff.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-foreground/10 border border-foreground/12">
                    {sharedLinks.map((item) => {
                      const isActiveState = item.effectiveStatus === 'active';
                      const isCopied = copiedShareId === item.shareId;
                      const isBusy = busyShareId === item.shareId;

                      return (
                        <div
                          key={item.shareId}
                          className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 bg-background hover:bg-foreground/[0.015] transition-colors"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="font-display text-xl text-foreground truncate">
                              {item.label}
                            </div>

                            <div className="font-mono text-xs font-semibold tabular-nums flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <span
                                className={
                                  isActiveState ? 'text-foreground' : 'text-destructive'
                                }
                              >
                                {formatShareStatusLabel(item.effectiveStatus)}
                              </span>
                              <span className="text-muted-foreground" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-foreground">
                                {item.maxMessages !== null
                                  ? `${item.usedMessages} / ${item.maxMessages} msgs`
                                  : `${item.usedMessages} msgs · Unlimited`}
                              </span>
                              <span className="text-muted-foreground" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-muted-foreground">
                                {formatShareRemainingTime(item.expiresAt)}
                              </span>
                              <span className="text-muted-foreground" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-muted-foreground">{item.hostHint}</span>
                            </div>

                            <div className="font-mono text-[11px] text-muted-foreground truncate">
                              ?share={item.shareId}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => void copyShareUrlToClipboard(item.shareId)}
                              className="min-h-[44px] px-4 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-semibold text-foreground flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                            >
                              {isCopied ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              <span>{isCopied ? 'Copied' : 'Copy Link'}</span>
                            </button>

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleToggleRevoke(item)}
                              className={`min-h-[44px] px-4 rounded-full border text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-45 whitespace-nowrap shrink-0 ${
                                item.status === 'active'
                                  ? 'border-destructive/35 text-destructive hover:bg-destructive/10'
                                  : 'border-foreground/20 text-foreground hover:bg-foreground/5'
                              }`}
                            >
                              {isBusy ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : item.status === 'active' ? (
                                <Ban className="w-3.5 h-3.5" />
                              ) : (
                                <RotateCcw className="w-3.5 h-3.5" />
                              )}
                              <span>{item.status === 'active' ? 'Revoke' : 'Restore'}</span>
                            </button>

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleDeleteShare(item.shareId)}
                              aria-label={`Remove ${item.label}`}
                              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-foreground/5 transition-colors disabled:opacity-45 shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        ) : tab === 'keys' && !isGuestMode ? (
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
            <div className="space-y-2">
              <span className="inline-flex items-center gap-3 text-xs font-mono font-semibold text-muted-foreground">
                <span className="w-6 h-px bg-foreground/30" />
                Configuration
              </span>
              <h2 className="text-3xl font-display tracking-tight text-foreground">
                Base API & Keys
              </h2>
              <p className="text-sm font-medium text-muted-foreground leading-relaxed">
                Type your Base API URL manually or tap a preset below, then paste your personal API key. Everything stays in this browser unless you create a disguised guest link.
              </p>
            </div>

            {/* Saved Connections List */}
            {savedKeys.length > 0 && (
              <div className="divide-y divide-foreground/10 border border-foreground/12">
                {savedKeys.map((item) => {
                  const isActive = item.id === activeKeyId;
                  const isEditingThis = editingId === item.id;

                  if (isEditingThis) {
                    return (
                      <form
                        key={item.id}
                        onSubmit={handleSaveEdit}
                        className="p-4 sm:p-5 bg-foreground/[0.02] space-y-4"
                      >
                        <div className="space-y-1.5">
                          <label className="block font-mono text-xs font-semibold text-muted-foreground">
                            Label
                          </label>
                          <input
                            type="text"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            placeholder="Personal or Work"
                            className="w-full min-h-[46px] px-3.5 bg-background border border-foreground/15 text-base sm:text-sm font-semibold text-foreground focus:outline-none focus:border-foreground/45"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="block font-mono text-xs font-semibold text-muted-foreground">
                            Base API URL
                          </label>
                          <input
                            type="text"
                            value={editBaseUrl}
                            onChange={(e) => setEditBaseUrl(e.target.value)}
                            placeholder="https://agentrouter.org/v1"
                            required
                            autoComplete="off"
                            className="w-full min-h-[46px] px-3.5 bg-background border border-foreground/15 text-base sm:text-sm font-mono font-semibold text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                          />
                          <div className="flex flex-wrap items-center gap-1.5">
                            {BASE_API_PRESETS.map((preset) => {
                              const activePreset =
                                editBaseUrl.trim().replace(/\/+$/, '') === preset.url;
                              return (
                                <button
                                  key={preset.url}
                                  type="button"
                                  onClick={() => setEditBaseUrl(preset.url)}
                                  className={`min-h-[36px] px-3 rounded-full border text-[11px] font-mono font-semibold transition-colors whitespace-nowrap shrink-0 ${
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
                          <label className="block font-mono text-xs font-semibold text-muted-foreground">
                            API Key
                          </label>
                          <div className="relative">
                            <input
                              type={showEditRawKey ? 'text' : 'password'}
                              value={editApiKey}
                              onChange={(e) => setEditApiKey(e.target.value)}
                              placeholder="Paste your OpenAI / AgentRouter key (sk-...)"
                              required
                              autoComplete="off"
                              className="w-full min-h-[46px] pl-3.5 pr-12 bg-background border border-foreground/15 text-base sm:text-sm font-mono font-semibold text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                            />
                            <button
                              type="button"
                              onClick={() => setShowEditRawKey((v) => !v)}
                              aria-label={showEditRawKey ? 'Hide key' : 'Show key'}
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground"
                            >
                              {showEditRawKey ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2 pt-0.5">
                          <button
                            type="button"
                            onClick={() => setShowEditCookieField((v) => !v)}
                            className="min-h-[36px] inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {showEditCookieField ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                            <span>Optional desktop session header</span>
                          </button>

                          {showEditCookieField && (
                            <div className="space-y-1.5">
                              <input
                                type="text"
                                value={editWafCookie}
                                onChange={(e) => setEditWafCookie(e.target.value)}
                                placeholder="acw_tc=..."
                                autoComplete="off"
                                className="w-full min-h-[44px] px-3.5 bg-background border border-foreground/15 text-base sm:text-xs font-mono text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                              />
                              <p className="text-[11px] text-muted-foreground leading-relaxed">
                                Not needed on mobile. Leave blank unless you want to forward a custom desktop Cookie header.
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="min-h-[44px] px-4 rounded-full text-xs font-semibold text-muted-foreground hover:text-foreground"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={!editBaseUrl.trim() || !editApiKey.trim() || savingKey}
                            className="min-h-[44px] px-5 rounded-full bg-foreground text-background text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap shrink-0"
                          >
                            {savingKey && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span>Save & Sync</span>
                          </button>
                        </div>
                      </form>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                        isActive ? 'bg-foreground/[0.04]' : 'bg-background hover:bg-foreground/[0.02]'
                      }`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="font-display text-xl text-foreground truncate">
                          {item.label}
                        </div>
                        <div className="text-xs font-mono font-semibold text-muted-foreground break-all">
                          {item.baseUrl}
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground/80">
                          {maskApiKey(item.apiKey)}
                          {item.wafCookie ? ' · session cookie set' : ''}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {isActive ? (
                          <span className="px-2.5 font-mono text-xs font-bold text-foreground">
                            Active
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectKey(item.id);
                              setTab('models');
                            }}
                            className="min-h-[42px] px-4 rounded-full bg-foreground hover:bg-foreground/90 text-background text-xs font-bold transition-opacity whitespace-nowrap shrink-0"
                          >
                            Use & Sync
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setShareKeyId(item.id);
                            setTab('shares');
                            if (onRefreshShares) {
                              void onRefreshShares();
                            }
                          }}
                          className="min-h-[42px] px-3.5 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-semibold text-foreground flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          <span>Share</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditing(item, false)}
                          aria-label={`Edit ${item.label}`}
                          className="min-h-[42px] min-w-[42px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveKey(item.id)}
                          aria-label={`Remove ${item.label}`}
                          className="min-h-[42px] min-w-[42px] rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-foreground/5 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add New Connection Form */}
            {!addingKeyForm && savedKeys.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setAddingKeyForm(true);
                }}
                className="w-full min-h-[46px] rounded-full border border-foreground/20 text-xs font-bold text-foreground hover:bg-foreground/5 flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add another Base API & Key</span>
              </button>
            ) : !editingId ? (
              <form
                onSubmit={handleSaveNewKey}
                className="p-4 sm:p-5 border border-foreground/12 bg-foreground/[0.015] space-y-4"
              >
                <div className="space-y-1.5">
                  <label className="block font-mono text-xs font-semibold text-muted-foreground">
                    Label (optional)
                  </label>
                  <input
                    type="text"
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    placeholder="Personal, Work, or Client"
                    className="w-full min-h-[46px] px-3.5 bg-background border border-foreground/15 text-base sm:text-sm font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block font-mono text-xs font-semibold text-muted-foreground">
                    Base API URL
                  </label>
                  <input
                    type="text"
                    value={baseUrlInput}
                    onChange={(e) => setBaseUrlInput(e.target.value)}
                    placeholder="https://agentrouter.org/v1"
                    required
                    autoComplete="off"
                    className="w-full min-h-[46px] px-3.5 bg-background border border-foreground/15 text-base sm:text-sm font-mono font-semibold text-foreground placeholder:font-sans placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {BASE_API_PRESETS.map((preset) => {
                      const activePreset =
                        baseUrlInput.trim().replace(/\/+$/, '') === preset.url;
                      return (
                        <button
                          key={preset.url}
                          type="button"
                          onClick={() => setBaseUrlInput(preset.url)}
                          className={`min-h-[36px] px-3 rounded-full border text-[11px] font-mono font-semibold transition-colors whitespace-nowrap shrink-0 ${
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
                  <label className="block font-mono text-xs font-semibold text-muted-foreground">
                    API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showRawKey ? 'text' : 'password'}
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      placeholder="Paste your OpenAI / AgentRouter key (sk-...)"
                      required
                      autoComplete="off"
                      className="w-full min-h-[46px] pl-3.5 pr-12 bg-background border border-foreground/15 text-base sm:text-sm font-mono font-semibold text-foreground placeholder:font-sans placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRawKey((v) => !v)}
                      aria-label={showRawKey ? 'Hide key' : 'Show key'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground"
                    >
                      {showRawKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setShowCookieField((v) => !v)}
                    className="min-h-[36px] inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showCookieField ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    <span>Optional desktop session header</span>
                  </button>

                  {showCookieField && (
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={wafCookieInput}
                        onChange={(e) => setWafCookieInput(e.target.value)}
                        placeholder="acw_tc=..."
                        autoComplete="off"
                        className="w-full min-h-[44px] px-3.5 bg-background border border-foreground/15 text-base sm:text-xs font-mono text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                      />
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Not needed on mobile. Leave blank unless you want to forward a custom desktop Cookie header.
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  {savedKeys.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setAddingKeyForm(false)}
                      className="min-h-[44px] px-4 rounded-full text-xs font-semibold text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={!baseUrlInput.trim() || !keyInput.trim() || savingKey}
                    className="min-h-[46px] px-6 rounded-full bg-foreground hover:bg-foreground/90 text-background text-xs font-bold flex items-center gap-2 disabled:opacity-35 transition-all whitespace-nowrap shrink-0"
                  >
                    {savingKey ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <KeyRound className="w-4 h-4" />
                    )}
                    <span>Save & Sync Models</span>
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        ) : (
          /* Models Sync & Live Test Tab */
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-4 sm:px-6 pt-4 pb-3 space-y-3 border-b border-foreground/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-xs font-semibold text-muted-foreground tabular-nums">
                  <span>
                    {models.length} synced {isGuestMode ? 'on shared pass' : 'from Base API'}
                  </span>
                  {workingCount > 0 && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="text-foreground">{workingCount} verified</span>
                    </>
                  )}
                  {syncedSourceUrl && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span>{syncedSourceUrl.replace(/^https?:\/\//i, '')}</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {filteredModels.length > 0 && hasUsableConnection && (
                    <button
                      type="button"
                      onClick={handleBatchTestVisible}
                      className="min-h-[40px] px-4 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-semibold text-foreground flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      {batchTesting ? (
                        <>
                          <Square className="w-3 h-3 fill-current" />
                          <span>Stop test</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3" />
                          <span>Test top {Math.min(6, filteredModels.length)}</span>
                        </>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onSyncModels}
                    disabled={isSyncing || (!activeKeyId && !isGuestMode)}
                    className="min-h-[40px] px-4 rounded-full bg-foreground hover:bg-foreground/90 text-background text-xs font-bold flex items-center gap-1.5 disabled:opacity-35 transition-opacity whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'Syncing...' : 'Sync Models'}</span>
                  </button>
                </div>
              </div>

              {syncError && (
                <div className="p-3.5 border border-destructive/40 bg-destructive/5 text-xs font-semibold text-destructive flex flex-wrap items-center justify-between gap-3">
                  <span>{syncError}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (isGuestMode) {
                        setTab('shares');
                        return;
                      }
                      const activeItem = savedKeys.find((k) => k.id === activeKeyId);
                      setTab('keys');
                      if (activeItem) {
                        startEditing(activeItem, false);
                      }
                    }}
                    className="min-h-[36px] inline-flex items-center font-mono font-bold underline whitespace-nowrap shrink-0"
                  >
                    {isGuestMode ? 'View Shared Pass' : 'Edit Base API & Key'}
                  </button>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search models (e.g. 6.1 sol, gpt 6 astra)..."
                    className="w-full min-h-[44px] pl-10 pr-3 bg-foreground/[0.02] border border-foreground/12 text-base sm:text-sm font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                  />
                </div>

                <div className="flex border border-foreground/12 shrink-0">
                  {(['all', 'working', 'untested'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setFilterMode(mode)}
                      className={`flex-1 sm:flex-initial min-h-[44px] px-3.5 font-mono text-xs font-bold capitalize transition-colors whitespace-nowrap shrink-0 ${
                        filterMode === mode
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {(activeKeyId || isGuestMode) && onAddCustomModels && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!customModelInput.trim()) return;
                    onAddCustomModels(customModelInput);
                    setCustomModelInput('');
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    placeholder="Add model ID directly (e.g. gpt-6.1-sol, gpt-6-astra, gpt-5.4-sol)"
                    autoComplete="off"
                    className="flex-1 min-h-[44px] px-3.5 bg-foreground/[0.02] border border-foreground/12 text-base sm:text-xs font-mono font-semibold text-foreground placeholder:font-sans placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                  />
                  <button
                    type="submit"
                    disabled={!customModelInput.trim()}
                    className="min-h-[44px] px-4 rounded-full border border-foreground/25 hover:bg-foreground hover:text-background text-xs font-bold text-foreground flex items-center gap-1.5 disabled:opacity-35 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Model</span>
                  </button>
                </form>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
              {!activeKeyId && !isGuestMode ? (
                <div className="py-12 text-center space-y-4">
                  <p className="font-display text-3xl text-foreground">
                    No Base API or key saved yet
                  </p>
                  <p className="text-sm font-medium text-muted-foreground max-w-xs mx-auto">
                    Enter your Base API URL and OpenAI key manually to sync models and test them live.
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab('keys')}
                    className="min-h-[46px] px-6 rounded-full bg-foreground text-background text-xs font-bold inline-flex items-center gap-2"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>Set Base API & Key</span>
                  </button>
                </div>
              ) : isSyncing && models.length === 0 ? (
                <div className="py-16 text-center space-y-3">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                  <p className="font-mono text-xs font-semibold text-muted-foreground">
                    Checking gateway catalog & live OpenAI models...
                  </p>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="py-10 text-center space-y-4 max-w-md mx-auto">
                  <p className="font-display text-2xl text-foreground">
                    {models.length === 0
                      ? 'Gateway hid its /v1/models list'
                      : 'No models match your filter'}
                  </p>
                  {models.length === 0 && (
                    <>
                      <p className="text-xs font-medium text-muted-foreground leading-relaxed">
                        Some gateways return an empty list on /v1/models even when chat works. Tap below to add OpenAI models or type any model ID above, then tap Test.
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {onAddCustomModels && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                onAddCustomModels('gpt-6.1-sol, gpt-6-astra, gpt-5.4-sol')
                              }
                              className="min-h-[44px] px-4 rounded-full bg-foreground text-background text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Add gpt-6.1-sol, gpt-6-astra & gpt-5.4-sol</span>
                            </button>
                            <button
                              type="button"
                              onClick={onSyncModels}
                              className="min-h-[44px] px-4 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-semibold text-foreground inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Retry Sync</span>
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-foreground/10 border-t border-b border-foreground/10">
                  {filteredModels.map((model, index) => {
                    const isSelected = model.id === selectedModel;
                    const isCustomSaved = customModels.includes(model.id);
                    const test = modelTests[model.id];
                    const ctxLabel = formatContext(model.contextWindow);

                    return (
                      <div
                        key={model.id}
                        className={`py-4 px-2 sm:px-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                          isSelected
                            ? 'bg-foreground/[0.05]'
                            : 'hover:bg-foreground/[0.02]'
                        }`}
                      >
                        <div className="min-w-0 flex items-start gap-3">
                          <span className="font-mono text-xs font-semibold text-muted-foreground pt-1 shrink-0 tabular-nums">
                            {String(index + 1).padStart(2, '0')}
                          </span>

                          <div className="min-w-0 space-y-1">
                            <div className="font-display text-xl leading-tight text-foreground break-words">
                              {model.label}
                            </div>

                            <div className="font-mono text-xs text-muted-foreground break-all tabular-nums">
                              <span>{model.id}</span>
                              <span aria-hidden="true"> · </span>
                              <span>{model.ownedBy}</span>
                              {ctxLabel && (
                                <>
                                  <span aria-hidden="true"> · </span>
                                  <span>{ctxLabel}</span>
                                </>
                              )}
                            </div>

                            {test && test.status !== 'idle' && (
                              <div className="pt-0.5 font-mono text-xs font-semibold tabular-nums flex items-center gap-1.5">
                                {test.status === 'testing' && (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
                                    <span className="text-muted-foreground">Sending live ping...</span>
                                  </>
                                )}
                                {test.status === 'ok' && (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
                                    <span className="text-foreground truncate">
                                      Working · {test.durationMs}ms · “{test.reply}”
                                    </span>
                                  </>
                                )}
                                {test.status === 'error' && (
                                  <>
                                    <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                                    <span className="text-destructive line-clamp-1">
                                      Failed · {test.error}
                                    </span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pl-7 sm:pl-0 shrink-0">
                          {isCustomSaved && onRemoveCustomModel && (
                            <button
                              type="button"
                              onClick={() => onRemoveCustomModel(model.id)}
                              aria-label={`Remove ${model.id}`}
                              title="Remove custom model"
                              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-foreground/5 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onTestModel(model.id)}
                            disabled={test?.status === 'testing' || !hasUsableConnection}
                            className="min-h-[44px] px-4 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-mono font-bold text-foreground flex items-center gap-1.5 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
                          >
                            {test?.status === 'testing' ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                            <span>Test</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              onSelectModel(model.id);
                              onClose();
                            }}
                            className={`min-h-[44px] px-5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                              isSelected
                                ? 'bg-foreground text-background'
                                : 'border border-foreground/25 hover:bg-foreground hover:text-background text-foreground'
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5" />}
                            <span>{isSelected ? 'Selected' : 'Use'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
