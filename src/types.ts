export interface Attachment {
  id: string;
  name: string;
  content: string;
  size: number;
}

export interface ArtifactItem {
  id: string;
  title: string;
  language: string;
  content: string;
  previewable: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  thinkingSeconds?: number;
  attachments?: Attachment[];
  model?: string;
  createdAt: number;
  error?: string;
  isStreaming?: boolean;
  interrupted?: boolean;
  runId?: string;
}

export interface BackgroundChatRunState {
  runId: string;
  workspaceId: string;
  conversationId: string;
  assistantMsgId: string;
  model: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  content: string;
  thinking: string;
  thinkingSeconds: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  roleId: string;
  model: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface AgentRole {
  id: string;
  name: string;
  tagline: string;
  instructions: string;
  temperature: number;
  isCustom?: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
  ownedBy: string;
  contextWindow?: number;
}

export interface ModelTestResult {
  status: 'idle' | 'testing' | 'ok' | 'error';
  durationMs?: number;
  reply?: string;
  error?: string;
  testedAt?: number;
}

export interface SavedUserKey {
  id: string;
  label: string;
  apiKey: string;
  baseUrl: string;
  wafCookie?: string;
  customModels?: string[];
}

export interface InboundAgentTask {
  id: string;
  workspaceId?: string;
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
