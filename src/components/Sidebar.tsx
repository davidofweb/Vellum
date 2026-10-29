import React, { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Moon,
  Plus,
  Search,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { AgentRole, Conversation, InboundAgentTask, SavedUserKey } from '../types';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  activeKey: SavedUserKey | null;
  onOpenKeyManager: (tab: 'models' | 'keys') => void;
  conversations: Conversation[];
  activeId: string;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  roles: AgentRole[];
  selectedRoleId: string;
  onSelectRole: (roleId: string) => void;
  onCreateRole: (role: Omit<AgentRole, 'id'>) => void;
  onDeleteRole: (roleId: string) => void;
  inboxTasks: InboundAgentTask[];
  onOpenInboxTaskInChat: (task: InboundAgentTask) => void;
  onDeleteInboxTask: (id: string) => void;
  onSendSampleInboundRequest: (prompt: string) => Promise<void>;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  stickyScroll: boolean;
  onToggleStickyScroll: () => void;
  showInstallButton: boolean;
  onInstallApp: () => void;
  selectedModel: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  workspaceId,
  activeKey,
  onOpenKeyManager,
  conversations,
  activeId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  roles,
  selectedRoleId,
  onSelectRole,
  onCreateRole,
  onDeleteRole,
  inboxTasks,
  onOpenInboxTaskInChat,
  onDeleteInboxTask,
  onSendSampleInboundRequest,
  darkMode,
  onToggleDarkMode,
  stickyScroll,
  onToggleStickyScroll,
  showInstallButton,
  onInstallApp,
  selectedModel,
}) => {
  const [section, setSection] = useState<'chats' | 'inbox' | 'roles'>('chats');
  const [query, setQuery] = useState('');
  const [addingRole, setAddingRole] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [roleTagline, setRoleTagline] = useState('');
  const [roleInstructions, setRoleInstructions] = useState('');
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [inboundPrompt, setInboundPrompt] = useState('');
  const [submittingInbound, setSubmittingInbound] = useState(false);

  const filteredConversations = conversations.filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  });

  const handleSaveRole = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName.trim() || !roleInstructions.trim()) return;
    onCreateRole({
      name: roleName.trim(),
      tagline: roleTagline.trim() || 'Custom workspace role',
      instructions: roleInstructions.trim(),
      temperature: 0.4,
      isCustom: true,
    });
    setRoleName('');
    setRoleTagline('');
    setRoleInstructions('');
    setAddingRole(false);
  };

  const handleCopyCurl = async () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    const modelArg = selectedModel || 'YOUR_SYNCED_MODEL_ID';
    const baseArg = activeKey?.baseUrl || 'YOUR_BASE_API_URL';
    const cmd = `curl -X POST "${origin}/api/inbox?workspaceId=${workspaceId}" -H "Content-Type: application/json" -H "x-agentrouter-base-url: ${baseArg}" -H "Authorization: Bearer YOUR_API_KEY" -d '{"title":"Daily Brief","prompt":"Summarize three practical ways to speed up web page loads.","model":"${modelArg}"}'`;
    await navigator.clipboard.writeText(cmd);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 1800);
  };

  const handleDispatchInbound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inboundPrompt.trim() || submittingInbound || !activeKey || !selectedModel) return;
    setSubmittingInbound(true);
    try {
      await onSendSampleInboundRequest(inboundPrompt.trim());
      setInboundPrompt('');
    } finally {
      setSubmittingInbound(false);
    }
  };

  const formatShortDate = (ts: number) => {
    const diffMins = Math.floor((Date.now() - ts) / 60000);
    if (diffMins < 1) return 'Now';
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/25 backdrop-blur-xs lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[86vw] max-w-[300px] lg:w-[292px] flex flex-col bg-background text-foreground border-r border-foreground/10 transition-transform duration-300 ease-out lg:static lg:z-auto ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:hidden'
        }`}
      >
        {/* Optimus Brand Wordmark + Primary Capsule Button */}
        <div className="h-[60px] flex items-center justify-between px-5 border-b border-foreground/10 shrink-0">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display tracking-tight text-2xl text-foreground whitespace-nowrap shrink-0">
              Vellum
            </span>
            <span className="text-muted-foreground font-mono text-[10px]">TM</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onNewChat();
                if (window.innerWidth < 1024) onClose();
              }}
              className="min-h-[38px] px-4 rounded-full bg-foreground hover:bg-foreground/90 text-background text-xs font-medium flex items-center gap-1.5 active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New chat</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="lg:hidden min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Optimus Architectural Underline Tabs: Chats | Inbox | Roles */}
        <div className="grid grid-cols-3 border-b border-foreground/10 shrink-0">
          <button
            type="button"
            onClick={() => setSection('chats')}
            className={`min-h-[46px] text-xs font-mono transition-colors relative whitespace-nowrap shrink-0 ${
              section === 'chats'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Chats
            {section === 'chats' && (
              <span className="absolute bottom-0 left-0 right-0 h-px bg-foreground" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setSection('inbox')}
            className={`min-h-[46px] text-xs font-mono transition-colors relative whitespace-nowrap shrink-0 ${
              section === 'inbox'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Inbox {inboxTasks.length > 0 ? `(${inboxTasks.length})` : ''}
            {section === 'inbox' && (
              <span className="absolute bottom-0 left-0 right-0 h-px bg-foreground" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setSection('roles')}
            className={`min-h-[46px] text-xs font-mono transition-colors relative whitespace-nowrap shrink-0 ${
              section === 'roles'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Roles
            {section === 'roles' && (
              <span className="absolute bottom-0 left-0 right-0 h-px bg-foreground" />
            )}
          </button>
        </div>

        {/* Section Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {section === 'chats' && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a conversation"
                  className="w-full min-h-[44px] pl-10 pr-3 bg-foreground/[0.02] border border-foreground/12 text-base sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40 transition-colors"
                />
              </div>

              {filteredConversations.length === 0 ? (
                <div className="px-3 py-12 text-center">
                  <p className="font-display text-xl text-foreground">
                    {query ? 'No matching chats' : 'No saved chats yet'}
                  </p>
                  <p className="text-xs font-mono text-muted-foreground mt-1.5">
                    Start writing to begin a live session.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-foreground/10 border-t border-b border-foreground/10">
                  {filteredConversations.map((conv) => {
                    const isActive = conv.id === activeId;
                    const isConvRunning = conv.messages.some((m) => m.isStreaming);
                    return (
                      <div
                        key={conv.id}
                        className={`group flex items-center justify-between transition-colors ${
                          isActive
                            ? 'bg-foreground/[0.06] text-foreground'
                            : 'text-foreground/75 hover:bg-foreground/[0.03] hover:text-foreground'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectConversation(conv.id);
                            if (window.innerWidth < 1024) onClose();
                          }}
                          className="flex-1 min-w-0 min-h-[52px] px-3 py-2.5 text-left"
                        >
                          <div className="text-sm font-medium truncate">
                            {conv.title || 'Untitled chat'}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground truncate tabular-nums mt-0.5 flex items-center gap-1.5">
                            {isConvRunning && (
                              <>
                                <span className="inline-flex items-center gap-1 text-foreground font-semibold">
                                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                                  Running
                                </span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            <span>
                              {formatShortDate(conv.updatedAt)} · {conv.messages.length}{' '}
                              {conv.messages.length === 1 ? 'msg' : 'msgs'}
                            </span>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteConversation(conv.id);
                          }}
                          aria-label="Delete chat"
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground hover:text-destructive opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {section === 'inbox' && (
            <div className="space-y-4">
              <div className="p-4 border border-foreground/12 bg-foreground/[0.02] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground">
                    <span className="w-4 h-px bg-foreground/30" />
                    Receive Requests
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCurl}
                    className="min-h-[34px] px-3 rounded-full border border-foreground/20 hover:bg-foreground/5 text-[11px] font-mono text-foreground flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    {copiedCurl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCurl ? 'Copied' : 'Copy curl'}</span>
                  </button>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  Post tasks to <code className="font-mono text-foreground">/api/inbox</code> with your key and synced model ID to stream results straight into your workspace.
                </p>

                <form onSubmit={handleDispatchInbound} className="pt-1 flex gap-2">
                  <input
                    type="text"
                    value={inboundPrompt}
                    onChange={(e) => setInboundPrompt(e.target.value)}
                    placeholder={
                      activeKey && selectedModel
                        ? 'Queue a background task...'
                        : 'Add key & sync model first'
                    }
                    disabled={!activeKey || !selectedModel}
                    className="flex-1 min-w-0 min-h-[42px] px-3 bg-background border border-foreground/15 text-base sm:text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={
                      !inboundPrompt.trim() || submittingInbound || !activeKey || !selectedModel
                    }
                    className="min-h-[42px] px-4 rounded-full bg-foreground text-background text-xs font-medium disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    Run
                  </button>
                </form>
              </div>

              {inboxTasks.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="font-display text-xl text-foreground">Inbox is clear</p>
                  <p className="font-mono text-[11px] text-muted-foreground mt-1">
                    Incoming tasks appear here in real time.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {inboxTasks.map((task) => (
                    <div
                      key={task.id}
                      className="p-4 border border-foreground/12 bg-background space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="text-sm font-medium text-foreground truncate">
                            {task.title}
                          </h4>
                          <p className="font-mono text-[11px] text-muted-foreground tabular-nums mt-0.5">
                            {task.sender} · {task.status} · {formatShortDate(task.createdAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDeleteInboxTask(task.id)}
                          aria-label="Remove inbox item"
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {task.error ? (
                        <p className="text-xs text-destructive">{task.error}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                          {task.output || task.prompt}
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          onOpenInboxTaskInChat(task);
                          if (window.innerWidth < 1024) onClose();
                        }}
                        className="w-full min-h-[40px] px-4 rounded-full border border-foreground/20 hover:bg-foreground/5 text-xs font-medium text-foreground flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <span>Continue in chat</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === 'roles' && (
            <div className="space-y-3">
              {!addingRole ? (
                <button
                  type="button"
                  onClick={() => setAddingRole(true)}
                  className="w-full min-h-[44px] px-4 rounded-full border border-foreground/20 text-xs font-medium text-foreground hover:bg-foreground/5 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create custom role</span>
                </button>
              ) : (
                <form
                  onSubmit={handleSaveRole}
                  className="p-4 border border-foreground/15 bg-background space-y-3"
                >
                  <input
                    type="text"
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    placeholder="Role name (e.g. Swift Tutor)"
                    className="w-full min-h-[42px] px-3 bg-foreground/[0.02] border border-foreground/12 text-base sm:text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40"
                    required
                  />
                  <input
                    type="text"
                    value={roleTagline}
                    onChange={(e) => setRoleTagline(e.target.value)}
                    placeholder="Short description"
                    className="w-full min-h-[42px] px-3 bg-foreground/[0.02] border border-foreground/12 text-base sm:text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40"
                  />
                  <textarea
                    rows={3}
                    value={roleInstructions}
                    onChange={(e) => setRoleInstructions(e.target.value)}
                    placeholder="How should this role write and respond?"
                    className="w-full p-3 bg-foreground/[0.02] border border-foreground/12 text-base sm:text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40 resize-none"
                    required
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setAddingRole(false)}
                      className="min-h-[38px] px-3 rounded-full text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="min-h-[38px] px-4 rounded-full bg-foreground text-background text-xs font-medium"
                    >
                      Save role
                    </button>
                  </div>
                </form>
              )}

              <div className="divide-y divide-foreground/10 border-t border-b border-foreground/10">
                {roles.map((role, index) => {
                  const active = role.id === selectedRoleId;
                  return (
                    <div
                      key={role.id}
                      className={`py-3.5 px-3 transition-colors ${
                        active
                          ? 'bg-foreground/[0.06]'
                          : 'hover:bg-foreground/[0.03]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectRole(role.id)}
                          className="flex-1 text-left min-w-0 flex items-start gap-3"
                        >
                          <span className="font-mono text-xs text-muted-foreground pt-1 shrink-0">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0">
                            <div className="font-display text-lg leading-tight text-foreground">
                              {role.name}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                              {role.tagline}
                            </div>
                          </div>
                        </button>
                        {role.isCustom && (
                          <button
                            type="button"
                            onClick={() => onDeleteRole(role.id)}
                            aria-label="Delete custom role"
                            className="min-h-[38px] min-w-[38px] flex items-center justify-center text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer: Install App + Sticky Scroll Setting + User Key Switcher + Theme Toggle */}
        <div className="p-3 pb-safe border-t border-foreground/10 space-y-2 shrink-0">
          {showInstallButton && (
            <button
              type="button"
              onClick={onInstallApp}
              className="w-full min-h-[44px] px-3.5 rounded-2xl bg-foreground text-background hover:bg-foreground/90 flex items-center justify-between gap-3 transition-colors text-left"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Download className="w-4 h-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold tracking-tight">
                    Install Vellum App
                  </span>
                  <span className="block text-[11px] opacity-75 truncate">
                    Add to home screen or desktop
                  </span>
                </span>
              </span>
              <ArrowUpRight className="w-4 h-4 shrink-0 opacity-80" />
            </button>
          )}

          <button
            type="button"
            role="switch"
            aria-checked={stickyScroll}
            onClick={onToggleStickyScroll}
            className="w-full min-h-[44px] px-3.5 rounded-2xl border border-foreground/12 hover:bg-foreground/[0.04] flex items-center justify-between gap-3 transition-colors text-left"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <ArrowDownToLine className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold tracking-tight text-foreground">
                  Sticky Scroll
                </span>
                <span className="block text-[11px] text-muted-foreground truncate">
                  {stickyScroll ? 'Follows new replies at bottom' : 'Stays put while reading'}
                </span>
              </span>
            </span>

            <span
              className={`w-10 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 ${
                stickyScroll ? 'bg-foreground justify-end' : 'bg-foreground/15 justify-start'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full transition-transform shadow-xs ${
                  stickyScroll ? 'bg-background' : 'bg-foreground/70'
                }`}
              />
            </span>
          </button>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onOpenKeyManager('keys')}
              className="min-h-[44px] px-3.5 rounded-full border border-foreground/15 hover:bg-foreground/5 text-xs font-semibold text-foreground flex items-center gap-2 transition-colors min-w-0 flex-1"
            >
              <KeyRound className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{activeKey ? activeKey.label : 'Set Base API & Key'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label="Toggle light and dark mode"
              className="min-h-[44px] px-3.5 rounded-full border border-foreground/15 hover:bg-foreground/5 text-xs font-mono font-medium text-foreground flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span>{darkMode ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
