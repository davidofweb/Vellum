import { ArtifactItem } from '../types';

const PREVIEWABLE_LANGS = new Set(['html', 'htm', 'svg']);

const EXTENSION_MAP: Record<string, string> = {
  html: 'html',
  svg: 'svg',
  typescript: 'ts',
  tsx: 'tsx',
  javascript: 'js',
  jsx: 'jsx',
  python: 'py',
  json: 'json',
  css: 'css',
  sql: 'sql',
  bash: 'sh',
  sh: 'sh',
  markdown: 'md',
  md: 'md',
};

export function extractArtifactsFromText(messageId: string, text: string): ArtifactItem[] {
  if (!text) return [];

  const artifacts: ArtifactItem[] = [];
  const fenceRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)(?:```|$)/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = fenceRegex.exec(text)) !== null) {
    const rawLang = (match[1] || 'text').toLowerCase().trim();
    const content = match[2] || '';

    // Only treat substantial code blocks (>= 6 lines or >= 160 chars) as Canvas artifacts
    const lineCount = content.split('\n').length;
    if (lineCount < 6 && content.trim().length < 160) {
      continue;
    }

    index += 1;
    const isHtmlLike =
      PREVIEWABLE_LANGS.has(rawLang) ||
      (rawLang === 'xml' && content.trim().startsWith('<svg')) ||
      content.trim().toLowerCase().startsWith('<!doctype html');

    const title = inferArtifactTitle(content, rawLang, index);

    artifacts.push({
      id: `${messageId}_art_${index}`,
      title,
      language: rawLang || 'text',
      content: content.replace(/\n$/, ''),
      previewable: isHtmlLike,
    });
  }

  return artifacts;
}

function inferArtifactTitle(content: string, lang: string, index: number): string {
  const titleMatch = content.match(/<title>([^<]{1,50})<\/title>/i);
  if (titleMatch?.[1]) {
    return titleMatch[1].trim();
  }

  const firstLine = content.split('\n')[0]?.trim() || '';
  const commentClean = firstLine
    .replace(/^(\/\/|#|<!--|--|\/\*+)\s*/, '')
    .replace(/(-->|\*+\/)$/, '')
    .trim();

  if (commentClean && commentClean.length <= 42 && !commentClean.startsWith('<') && !commentClean.includes('{')) {
    return commentClean;
  }

  const label = lang ? lang.toUpperCase() : 'Snippet';
  return `${label} Draft ${index}`;
}

export function getFileExtension(lang: string): string {
  return EXTENSION_MAP[lang.toLowerCase()] || 'txt';
}
