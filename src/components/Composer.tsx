import React, { useRef, useState, useEffect } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Loader2,
  Paperclip,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Square,
  X,
  Zap,
} from 'lucide-react';
import { AgentRole, Attachment, ModelOption, ModelTestResult } from '../types';
import { isReasoningStyleModel } from '../utils/gateway';

interface ComposerProps {
  input: string;
  onChangeInput: (val: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  hasActiveKey: boolean;
  attachments: Attachment[];
  onAddAttachments: (items: Attachment[]) => void;
  onRemoveAttachment: (id: string) => void;
  models: ModelOption[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  modelTests: Record<string, ModelTestResult>;
  onTestModel: (modelId: string) => Promise<void>;
  isSyncingModels: boolean;
  onSyncModels: () => Promise<void>;
  onOpenModelsManager: (tab: 'models' | 'keys') => void;
  roles: AgentRole[];
  selectedRole: AgentRole;
  onSelectRole: (roleId: string) => void;
  fastReplies: boolean;
  onToggleFastReplies: () => void;
}

export const Composer: React.FC<ComposerProps> = ({
  input,
  onChangeInput,
  onSend,
  onStop,
  isStreaming,
  hasActiveKey,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  models,
  selectedModel,
  onSelectModel,
  modelTests,
  onTestModel,
  isSyncingModels,
  onSyncModels,
  onOpenModelsManager,
  roles,
  selectedRole,
  onSelectRole,
  fastReplies,
  onToggleFastReplies,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showModelSheet, setShowModelSheet] = useState(false);
  const [showRoleSheet, setShowRoleSheet] = useState(false);
  const [quickFilter, setQuickFilter] = useState('');

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const canSend =
    hasActiveKey &&
    Boolean(selectedModel) &&
    !isStreaming &&
    (Boolean(input.trim()) || attachments.length > 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const loaded: Attachment[] = [];
    for (const file of files.slice(0, 4)) {
      const text = await file.text();
      loaded.push({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        content: text.slice(0, 40000),
        size: file.size,
      });
    }
    onAddAttachments(loaded);
    e.target.value = '';
  };

  const activeModelObj = models.find((m) => m.id === selectedModel);
  const modelButtonText = !hasActiveKey
    ? 'Set Base API & key'
    : isSyncingModels && models.length === 0
      ? 'Syncing models...'
      : activeModelObj
        ? activeModelObj.label
        : models.length === 0
          ? 'Sync models'
          : 'Choose model';

  const quickFilteredModels = models.filter((m) => {
    if (!quickFilter.trim()) return true;
    const q = quickFilter.toLowerCase();
    return m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q);
  });

  return (
    <div className="w-full max-w-3xl mx-auto px-3 sm:px-6 pb-safe pt-2 shrink-0 bg-background/85 backdrop-blur-md">
      <div className="relative border border-foreground/15 bg-card focus-within:border-foreground/45 transition-colors">
        {/* Attached text files */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1 border-b border-foreground/10">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 px-2.5 py-1 border border-foreground/15 bg-foreground/[0.03] font-mono text-xs text-foreground"
              >
                <span className="truncate max-w-[150px]">{att.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.id)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${att.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea (16px font prevents mobile browser zoom) */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => onChangeInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !hasActiveKey
              ? 'Save your Base API and key above to begin...'
              : !selectedModel
                ? 'Sync and pick a model below to start writing...'
                : `Message ${selectedRole.name}...`
          }
          className="w-full max-h-[200px] px-4 sm:px-5 pt-3.5 pb-2 bg-transparent text-[16px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
        />

        {/* Bottom Action Toolbar */}
        <div className="flex items-center justify-between gap-2 px-2.5 sm:px-3.5 pb-2.5 pt-1">
          <div className="flex items-center gap-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.css,.sql,.xml,.yaml,.yml"
              onChange={handleFilesSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach text or code file"
              className="min-h-[44px] min-w-[40px] sm:min-w-[44px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors shrink-0"
            >
              <Paperclip className="w-[17px] h-[17px]" />
            </button>

            {/* Role Selector Trigger */}
            <button
              type="button"
              onClick={() => {
                setShowRoleSheet((v) => !v);
                setShowModelSheet(false);
              }}
              className="min-h-[44px] px-2.5 sm:px-3 rounded-full text-xs font-mono font-medium text-foreground hover:bg-foreground/5 flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
            >
              <span className="truncate max-w-[78px] sm:max-w-[130px]">{selectedRole.name}</span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </button>

            {/* Synced Model Selector Trigger */}
            <button
              type="button"
              onClick={() => {
                if (!hasActiveKey) {
                  onOpenModelsManager('keys');
                  return;
                }
                setShowModelSheet((v) => !v);
                setShowRoleSheet(false);
              }}
              className="min-h-[44px] px-2.5 sm:px-3 rounded-full text-xs font-mono font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 flex items-center gap-1 transition-colors shrink-0"
            >
              <span className="truncate max-w-[100px] sm:max-w-[190px]">{modelButtonText}</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-70 shrink-0" />
            </button>

            {/* Reasoning Speed Toggle (Fast low-effort vs Deep thinking) */}
            {Boolean(selectedModel) && isReasoningStyleModel(selectedModel) && (
              <button
                type="button"
                onClick={onToggleFastReplies}
                title={
                  fastReplies
                    ? 'Fast replies active (tap to switch to deeper thinking)'
                    : 'Deeper thinking active (tap to switch to fast replies)'
                }
                aria-pressed={fastReplies}
                className={`min-h-[40px] px-2.5 rounded-full text-xs font-mono font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                  fastReplies
                    ? 'bg-foreground/[0.07] text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                }`}
              >
                <Zap className={`w-3 h-3 shrink-0 ${fastReplies ? 'fill-current' : ''}`} />
                <span>{fastReplies ? 'Fast' : 'Deep'}</span>
              </button>
            )}
          </div>

          {/* Optimus Monochrome Capsule Primary Send / Stop Action */}
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop response"
              className="min-h-[44px] min-w-[44px] px-4 rounded-full bg-foreground hover:bg-foreground/90 text-background text-xs font-medium flex items-center justify-center gap-1.5 active:scale-95 transition-all shrink-0"
            >
              <Square className="w-3 h-3 fill-current" />
              <span className="hidden sm:inline">Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              aria-label="Send message"
              className="min-h-[44px] min-w-[44px] rounded-full bg-foreground hover:bg-foreground/90 text-background flex items-center justify-center disabled:opacity-20 disabled:pointer-events-none active:scale-95 transition-all shrink-0"
            >
              <ArrowUp className="w-4 h-4 stroke-[2.2]" />
            </button>
          )}
        </div>

        {/* Role Popover / Mobile Sheet */}
        {showRoleSheet && (
          <>
            <div
              className="fixed inset-0 z-40 bg-foreground/20 sm:bg-transparent backdrop-blur-xs sm:backdrop-blur-none"
              onClick={() => setShowRoleSheet(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-x-0 bottom-0 sm:absolute sm:inset-x-auto sm:left-3 sm:bottom-16 z-50 sm:w-80 max-h-[70dvh] flex flex-col bg-background text-foreground border-t sm:border border-foreground/15 shadow-2xl pb-safe sm:pb-0">
              <div className="w-10 h-1 bg-foreground/20 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
              <div className="px-4 py-3 border-b border-foreground/10 flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground">
                  <span className="w-4 h-px bg-foreground/30" />
                  Choose role
                </span>
                <button
                  type="button"
                  onClick={() => setShowRoleSheet(false)}
                  className="sm:hidden min-h-[36px] min-w-[36px] flex items-center justify-center text-muted-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto divide-y divide-foreground/10">
                {roles.map((r, idx) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      onSelectRole(r.id);
                      setShowRoleSheet(false);
                    }}
                    className="w-full min-h-[52px] px-4 py-3 hover:bg-foreground/[0.04] flex items-center justify-between gap-3 text-left transition-colors"
                  >
                    <div className="min-w-0 flex items-baseline gap-3">
                      <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0">
                        <div className="font-display text-lg leading-tight text-foreground truncate">
                          {r.name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {r.tagline}
                        </div>
                      </div>
                    </div>
                    {r.id === selectedRole.id && (
                      <Check className="w-4 h-4 text-foreground shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Synced Models Quick Switcher + Inline Test */}
        {showModelSheet && (
          <>
            <div
              className="fixed inset-0 z-40 bg-foreground/20 sm:bg-transparent backdrop-blur-xs sm:backdrop-blur-none"
              onClick={() => setShowModelSheet(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-x-0 bottom-0 sm:absolute sm:inset-x-auto sm:left-20 sm:bottom-16 z-50 sm:w-[400px] max-h-[75dvh] sm:max-h-[400px] flex flex-col bg-background text-foreground border-t sm:border border-foreground/15 shadow-2xl pb-safe sm:pb-0">
              <div className="w-10 h-1 bg-foreground/20 rounded-full mx-auto mt-3 mb-1 sm:hidden" />

              <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/10 gap-2">
                <span className="font-mono text-xs text-foreground tabular-nums">
                  Synced Models ({models.length})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onSyncModels}
                    disabled={isSyncingModels}
                    title="Re-sync from Base API"
                    className="min-h-[34px] px-3 rounded-full border border-foreground/15 hover:bg-foreground/5 text-[11px] font-mono text-foreground flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${isSyncingModels ? 'animate-spin' : ''}`} />
                    <span>Sync</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowModelSheet(false);
                      onOpenModelsManager('models');
                    }}
                    className="min-h-[34px] px-3 rounded-full border border-foreground/15 hover:bg-foreground/5 text-[11px] font-mono text-foreground flex items-center gap-1"
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    <span>Manage</span>
                  </button>
                </div>
              </div>

              {models.length > 5 && (
                <div className="p-3 border-b border-foreground/10">
                  <input
                    type="text"
                    value={quickFilter}
                    onChange={(e) => setQuickFilter(e.target.value)}
                    placeholder="Search synced models..."
                    className="w-full min-h-[40px] px-3 bg-foreground/[0.02] border border-foreground/12 text-base sm:text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40"
                  />
                </div>
              )}

              <div className="flex-1 overflow-y-auto divide-y divide-foreground/10">
                {models.length === 0 ? (
                  <div className="py-10 px-4 text-center space-y-3">
                    <p className="font-display text-xl text-foreground">
                      No models synced from API yet.
                    </p>
                    <button
                      type="button"
                      onClick={onSyncModels}
                      className="min-h-[40px] px-5 rounded-full bg-foreground text-background text-xs font-medium"
                    >
                      Sync Now
                    </button>
                  </div>
                ) : quickFilteredModels.length === 0 ? (
                  <div className="py-8 text-center font-mono text-xs text-muted-foreground">
                    No matching synced models
                  </div>
                ) : (
                  quickFilteredModels.map((m) => {
                    const test = modelTests[m.id];
                    const isCurrent = m.id === selectedModel;
                    return (
                      <div
                        key={m.id}
                        className={`flex items-center justify-between gap-2 px-4 py-2.5 transition-colors ${
                          isCurrent
                            ? 'bg-foreground/[0.06]'
                            : 'hover:bg-foreground/[0.03]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectModel(m.id);
                            setShowModelSheet(false);
                          }}
                          className="flex-1 min-w-0 text-left py-1"
                        >
                          <div className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                            <span className="truncate">{m.label}</span>
                            {isCurrent && <Check className="w-3.5 h-3.5 text-foreground shrink-0" />}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground truncate tabular-nums mt-0.5">
                            {m.id}
                            {test?.status === 'ok' && (
                              <span className="text-foreground">
                                {' '}
                                · Ready ({test.durationMs}ms)
                              </span>
                            )}
                            {test?.status === 'error' && (
                              <span className="text-destructive"> · Failed</span>
                            )}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onTestModel(m.id);
                          }}
                          disabled={test?.status === 'testing'}
                          title="Test this model live"
                          className="min-h-[36px] px-3 rounded-full border border-foreground/20 hover:bg-foreground/5 text-[11px] font-mono text-foreground flex items-center gap-1 shrink-0"
                        >
                          {test?.status === 'testing' ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          <span>Test</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
