import { AgentRole } from './types';

export const BUILT_IN_ROLES: AgentRole[] = [
  {
    id: 'general',
    name: 'Clear Thinker',
    tagline: 'Direct, thoughtful answers without filler',
    instructions:
      'You write with calm clarity and precision. Skip filler introductions, get straight to the substance, and organize complex ideas cleanly.',
    temperature: 0.5,
  },
  {
    id: 'builder',
    name: 'Product Builder',
    tagline: 'Clean code, architecture, and working interfaces',
    instructions:
      'You are a senior product engineer. Provide complete, working code with clear structure, modern best practices, and concise explanations.',
    temperature: 0.2,
  },
  {
    id: 'writer',
    name: 'Editorial Writer',
    tagline: 'Sharp essays, memos, and crisp copy',
    instructions:
      'You are an experienced editor. Use plain, vivid human words, strong rhythm, and zero corporate jargon.',
    temperature: 0.7,
  },
  {
    id: 'analyst',
    name: 'Deep Analyst',
    tagline: 'First-principles breakdowns and structured tables',
    instructions:
      'Break problems down from first principles. Highlight trade-offs clearly, quantify assumptions, and present comparisons in clean markdown tables.',
    temperature: 0.3,
  },
];

export const STARTER_PROMPTS = [
  {
    title: 'Design a minimalist landing page',
    prompt:
      'Create a single-file responsive HTML + Tailwind landing page for an independent industrial design studio in Tokyo. Use bold typography, generous whitespace, and zero visual clutter.',
  },
  {
    title: 'Turn rough notes into a clear memo',
    prompt:
      'Help me structure a one-page product decision memo. Give me a crisp template with problem, options considered, trade-offs, and final call, filled out for launching a mobile habit app.',
  },
  {
    title: 'Audit slow API bottlenecks',
    prompt:
      'Walk me through a practical checklist to cut Node.js + PostgreSQL API response times from 900ms to under 80ms, ordered by highest impact first.',
  },
  {
    title: 'Compare pricing models in a table',
    prompt:
      'Compare seat-based, usage-based, and flat-tier pricing for a lightweight developer tool in a clean table, and recommend which to launch with.',
  },
];

export const BASE_API_PRESETS = [
  {
    label: 'agentrouter.org/v1',
    url: 'https://agentrouter.org/v1',
  },
  {
    label: 'co.agentrouter.org/v1',
    url: 'https://co.agentrouter.org/v1',
  },
  {
    label: 'api.openai.com/v1',
    url: 'https://api.openai.com/v1',
  },
];
