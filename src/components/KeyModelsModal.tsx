import React, { useState, useMemo, useRef } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { ModelOption, ModelTestResult, SavedUserKey } from '../types';
import { BASE_API_PRESETS } from '../constants';

interface KeyModelsModalProps {
  isOpen: boolean;
  initialTab?: 'models' | 'keys';
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
}

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

export const KeyModelsModal: React.FC<KeyModelsModalProps> = ({
  isOpen,
  initialTab = 'models',
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
}) => {
  const [tab, setTab] = useState<'models' | 'keys'>(
    savedKeys.length === 0 ? 'keys' : initialTab
  );
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

  const [batchTesting, setBatchTesting] = useState(false);
  const stopBatchRef = useRef(false);

  React.useEffect(() => {
    if (isOpen) {
      setTab(savedKeys.length === 0 ? 'keys' : initialTab);
      setAddingKeyForm(savedKeys.length === 0);
      setEditingId(null);
    }
  }, [isOpen, initialTab, savedKeys.length]);

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

        {/* Optimus Architectural Underline Tab Bar */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 border-b border-foreground/10 shrink-0">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setTab('models')}
              className={`min-h-[52px] px-4 sm:px-5 text-xs font-mono font-semibold transition-colors relative whitespace-nowrap shrink-0 ${
                tab === 'models'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Models ({models.length})
              {tab === 'models' && (
                <span className="absolute bottom-0 left-0 right-0 h-[1.5px] bg-foreground" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab('keys')}
              className={`min-h-[52px] px-4 sm:px-5 text-xs font-mono font-semibold transition-colors relative whitespace-nowrap shrink-0 ${
                tab === 'keys'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Base API & Keys ({savedKeys.length})
              {tab === 'keys' && (
                <span className="absolute bottom-0 left-0 right-0 h-[1.5px] bg-foreground" />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {tab === 'keys' ? (
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
            <div className="space-y-2">
              <span className="inline-flex items-center gap-3 text-xs font-mono font-medium text-muted-foreground">
                <span className="w-6 h-px bg-foreground/30" />
                Configuration
              </span>
              <h2 className="text-3xl font-display tracking-tight text-foreground">
                Base API & Keys
              </h2>
              <p className="text-sm font-medium text-muted-foreground leading-relaxed">
                Type your Base API URL manually or tap a preset below, then paste your personal API key. Everything stays in this browser.
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
                          <label className="block font-mono text-xs font-medium text-muted-foreground">
                            Label
                          </label>
                          <input
                            type="text"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            placeholder="Personal or Work"
                            className="w-full min-h-[46px] px-3.5 bg-background border border-foreground/15 text-base sm:text-sm font-medium text-foreground focus:outline-none focus:border-foreground/45"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="block font-mono text-xs font-medium text-muted-foreground">
                            Base API URL
                          </label>
                          <input
                            type="text"
                            value={editBaseUrl}
                            onChange={(e) => setEditBaseUrl(e.target.value)}
                            placeholder="https://agentrouter.org/v1"
                            required
                            autoComplete="off"
                            className="w-full min-h-[46px] px-3.5 bg-background border border-foreground/15 text-base sm:text-sm font-mono font-medium text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
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
                              type={showEditRawKey ? 'text' : 'password'}
                              value={editApiKey}
                              onChange={(e) => setEditApiKey(e.target.value)}
                              placeholder="Paste your OpenAI / AgentRouter key (sk-...)"
                              required
                              autoComplete="off"
                              className="w-full min-h-[46px] pl-3.5 pr-12 bg-background border border-foreground/15 text-base sm:text-sm font-mono font-medium text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
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
                            className="min-h-[36px] inline-flex items-center gap-1.5 text-xs font-mono font-medium text-muted-foreground hover:text-foreground transition-colors"
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
                            className="min-h-[42px] px-4 rounded-full text-xs font-semibold text-muted-foreground hover:text-foreground"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={!editBaseUrl.trim() || !editApiKey.trim() || savingKey}
                            className="min-h-[42px] px-5 rounded-full bg-foreground text-background text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
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
                        <div className="text-xs font-mono font-medium text-muted-foreground break-all">
                          {item.baseUrl}
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground/80">
                          {maskApiKey(item.apiKey)}
                          {item.wafCookie ? ' · firewall cookie set' : ''}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isActive ? (
                          <span className="px-3 font-mono text-xs font-semibold text-foreground">
                            Active
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectKey(item.id);
                              setTab('models');
                            }}
                            className="min-h-[40px] px-4 rounded-full bg-foreground hover:bg-foreground/90 text-background text-xs font-semibold transition-opacity whitespace-nowrap shrink-0"
                          >
                            Use & Sync
                          </button>
                        )}
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
                className="w-full min-h-[46px] rounded-full border border-foreground/20 text-xs font-semibold text-foreground hover:bg-foreground/5 flex items-center justify-center gap-1.5 transition-colors"
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
                  <label className="block font-mono text-xs font-medium text-muted-foreground">
                    Label (optional)
                  </label>
                  <input
                    type="text"
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    placeholder="Personal, Work, or Client"
                    className="w-full min-h-[46px] px-3.5 bg-background border border-foreground/15 text-base sm:text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block font-mono text-xs font-medium text-muted-foreground">
                    Base API URL
                  </label>
                  <input
                    type="text"
                    value={baseUrlInput}
                    onChange={(e) => setBaseUrlInput(e.target.value)}
                    placeholder="https://agentrouter.org/v1"
                    required
                    autoComplete="off"
                    className="w-full min-h-[46px] px-3.5 bg-background border border-foreground/15 text-base sm:text-sm font-mono font-medium text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
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
                      type={showRawKey ? 'text' : 'password'}
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      placeholder="Paste your OpenAI / AgentRouter key (sk-...)"
                      required
                      autoComplete="off"
                      className="w-full min-h-[46px] pl-3.5 pr-12 bg-background border border-foreground/15 text-base sm:text-sm font-mono font-medium text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
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
                    className="min-h-[36px] inline-flex items-center gap-1.5 text-xs font-mono font-medium text-muted-foreground hover:text-foreground transition-colors"
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
                    className="min-h-[46px] px-6 rounded-full bg-foreground hover:bg-foreground/90 text-background text-xs font-semibold flex items-center gap-2 disabled:opacity-35 transition-all whitespace-nowrap shrink-0"
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
                <div className="font-mono text-xs font-medium text-muted-foreground tabular-nums">
                  <span>{models.length} synced from Base API</span>
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
                  {filteredModels.length > 0 && (
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
                    disabled={isSyncing || !activeKeyId}
                    className="min-h-[40px] px-4 rounded-full bg-foreground hover:bg-foreground/90 text-background text-xs font-semibold flex items-center gap-1.5 disabled:opacity-35 transition-opacity whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'Syncing...' : 'Sync API'}</span>
                  </button>
                </div>
              </div>

              {syncError && (
                <div className="p-3.5 border border-destructive/40 bg-destructive/5 text-xs font-medium text-destructive flex flex-wrap items-center justify-between gap-3">
                  <span>{syncError}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const activeItem = savedKeys.find((k) => k.id === activeKeyId);
                      setTab('keys');
                      if (activeItem) {
                        startEditing(activeItem, false);
                      }
                    }}
                    className="min-h-[36px] inline-flex items-center font-mono font-semibold underline whitespace-nowrap shrink-0"
                  >
                    Edit Base API & Key
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
                    className="w-full min-h-[44px] pl-10 pr-3 bg-foreground/[0.02] border border-foreground/12 text-base sm:text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                  />
                </div>

                <div className="flex border border-foreground/12 shrink-0">
                  {(['all', 'working', 'untested'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setFilterMode(mode)}
                      className={`flex-1 sm:flex-initial min-h-[44px] px-3.5 font-mono text-xs font-semibold capitalize transition-colors whitespace-nowrap shrink-0 ${
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

              {activeKeyId && onAddCustomModels && (
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
                    className="flex-1 min-h-[44px] px-3.5 bg-foreground/[0.02] border border-foreground/12 text-base sm:text-xs font-mono font-medium text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-foreground/45"
                  />
                  <button
                    type="submit"
                    disabled={!customModelInput.trim()}
                    className="min-h-[44px] px-4 rounded-full border border-foreground/25 hover:bg-foreground hover:text-background text-xs font-semibold text-foreground flex items-center gap-1.5 disabled:opacity-35 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Model</span>
                  </button>
                </form>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
              {!activeKeyId ? (
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
                    className="min-h-[46px] px-6 rounded-full bg-foreground text-background text-xs font-semibold inline-flex items-center gap-2"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>Set Base API & Key</span>
                  </button>
                </div>
              ) : isSyncing && models.length === 0 ? (
                <div className="py-16 text-center space-y-3">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                  <p className="font-mono text-xs font-medium text-muted-foreground">
                    Checking gateway catalog & live OpenAI models...
                  </p>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="py-10 text-center space-y-4 max-w-md mx-auto">
                  <p className="font-display text-2xl text-foreground">
                    {models.length === 0 ? 'Gateway hid its /v1/models list' : 'No models match your filter'}
                  </p>
                  {models.length === 0 && (
                    <>
                      <p className="text-xs font-medium text-muted-foreground leading-relaxed">
                        Some gateways return an empty list on /v1/models even when your key works for chat. Tap below to add your Group 1 OpenAI models or type any model ID above, then tap Test.
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {onAddCustomModels && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                onAddCustomModels('gpt-6.1-sol, gpt-6-astra, gpt-5.4-sol')
                              }
                              className="min-h-[44px] px-4 rounded-full bg-foreground text-background text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
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
                          <span className="font-mono text-xs font-medium text-muted-foreground pt-1 shrink-0 tabular-nums">
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
                              <div className="pt-0.5 font-mono text-xs font-medium tabular-nums flex items-center gap-1.5">
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
                            disabled={test?.status === 'testing'}
                            className="min-h-[44px] px-4 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-mono font-semibold text-foreground flex items-center gap-1.5 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
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
                            className={`min-h-[44px] px-5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
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
