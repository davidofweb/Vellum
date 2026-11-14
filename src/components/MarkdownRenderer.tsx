import React, { useState, useMemo } from 'react';
import { Check, Copy, Maximize2 } from './RareIcons';
import { ArtifactItem } from '../types';

interface MarkdownRendererProps {
  content: string;
  messageId: string;
  onOpenArtifact?: (artifact: ArtifactItem) => void;
}

interface ParsedBlock {
  type: 'code' | 'table' | 'heading' | 'list' | 'OrderedList' | 'quote' | 'hr' | 'paragraph';
  lang?: string;
  code?: string;
  level?: number;
  text?: string;
  items?: string[];
  headers?: string[];
  rows?: string[][];
}

function parseBlocks(markdown: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const segments = markdown.split(/(```[a-zA-Z0-9_-]*\n[\s\S]*?(?:```|$))/g);

  let codeCounter = 0;

  for (const segment of segments) {
    if (!segment) continue;

    if (segment.startsWith('```')) {
      const match = segment.match(/^```([a-zA-Z0-9_-]*)\n([\s\S]*?)(?:```|$)$/);
      if (match) {
        codeCounter += 1;
        blocks.push({
          type: 'code',
          lang: (match[1] || 'text').trim().toLowerCase(),
          code: (match[2] || '').replace(/\n$/, ''),
          level: codeCounter,
        });
        continue;
      }
    }

    const lines = segment.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i += 1;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        blocks.push({ type: 'hr' });
        i += 1;
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        blocks.push({
          type: 'heading',
          level: headingMatch[1].length,
          text: headingMatch[2].trim(),
        });
        i += 1;
        continue;
      }

      if (
        trimmed.includes('|') &&
        i + 1 < lines.length &&
        /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])
      ) {
        const parseRow = (r: string) =>
          r
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((cell) => cell.trim());

        const headers = parseRow(trimmed);
        const rows: string[][] = [];
        i += 2;
        while (i < lines.length && lines[i].trim().includes('|')) {
          rows.push(parseRow(lines[i]));
          i += 1;
        }
        blocks.push({ type: 'table', headers, rows });
        continue;
      }

      if (trimmed.startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
          i += 1;
        }
        blocks.push({ type: 'quote', text: quoteLines.join('\n') });
        continue;
      }

      if (/^[-*+]\s+/.test(trimmed)) {
        const items: string[] = [];
        while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
          i += 1;
        }
        blocks.push({ type: 'list', items });
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
          i += 1;
        }
        blocks.push({ type: 'OrderedList', items });
        continue;
      }

      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !lines[i].trim().startsWith('#') &&
        !lines[i].trim().startsWith('>') &&
        !/^[-*+]\s+/.test(lines[i].trim()) &&
        !/^\d+\.\s+/.test(lines[i].trim()) &&
        !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
      ) {
        paraLines.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
    }
  }

  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return tokens.map((token, idx) => {
    if (!token) return null;

    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 border border-foreground/10 bg-foreground/[0.04] text-[0.86em] font-mono text-foreground"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      );
    }

    if (token.startsWith('*') && token.endsWith('*') && token.length >= 2) {
      return (
        <em key={idx} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    }

    const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={idx}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground transition-colors"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <React.Fragment key={idx}>{token}</React.Fragment>;
  });
}

function CodeBlockCard({
  lang,
  code,
  index,
  messageId,
  onOpenArtifact,
}: {
  lang: string;
  code: string;
  index: number;
  messageId: string;
  onOpenArtifact?: (artifact: ArtifactItem) => void;
}) {
  const [copied, setCopied] = useState(false);

  const lineCount = code.split('\n').length;
  const canOpenCanvas = lineCount >= 6 || code.trim().length >= 160;
  const previewable =
    lang === 'html' ||
    lang === 'htm' ||
    lang === 'svg' ||
    code.trim().toLowerCase().startsWith('<!doctype html');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="my-5 border border-foreground/12 bg-foreground/[0.02] overflow-hidden">
      <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-2.5 bg-background/60">
        <span className="font-mono text-xs text-muted-foreground relative py-1">
          {lang || 'text'} · <span className="tabular-nums">{lineCount}</span>{' '}
          {lineCount === 1 ? 'line' : 'lines'}
        </span>
        <div className="flex items-center gap-1">
          {canOpenCanvas && onOpenArtifact && (
            <button
              type="button"
              onClick={() =>
                onOpenArtifact({
                  id: `${messageId}_art_${index}`,
                  title: `${(lang || 'code').toUpperCase()} Draft ${index}`,
                  language: lang || 'text',
                  content: code,
                  previewable,
                })
              }
              className="min-h-[36px] px-3 font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>{previewable ? 'Preview' : 'Canvas'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="min-h-[36px] px-3 font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-foreground" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <pre className="p-4 sm:p-6 overflow-x-auto text-[13px] sm:text-sm leading-relaxed font-mono text-foreground/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const MarkdownRendererInner: React.FC<MarkdownRendererProps> = ({
  content,
  messageId,
  onOpenArtifact,
}) => {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className="space-y-4 text-[15.5px] sm:text-base leading-relaxed text-foreground/90 break-words">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'heading': {
            const sizes: Record<number, string> = {
              1: 'text-3xl sm:text-4xl font-display tracking-tight mt-7 mb-2 text-foreground balance-text',
              2: 'text-2xl sm:text-3xl font-display tracking-tight mt-6 mb-2 text-foreground balance-text',
              3: 'text-xl sm:text-2xl font-display tracking-tight mt-5 mb-1.5 text-foreground balance-text',
              4: 'text-base sm:text-lg font-semibold tracking-tight mt-4 mb-1 text-foreground',
            };
            const cls = sizes[block.level || 2] || sizes[2];
            return (
              <h3 key={idx} className={cls}>
                {renderInline(block.text || '')}
              </h3>
            );
          }

          case 'code':
            return (
              <CodeBlockCard
                key={idx}
                lang={block.lang || 'text'}
                code={block.code || ''}
                index={block.level || 1}
                messageId={messageId}
                onOpenArtifact={onOpenArtifact}
              />
            );

          case 'list':
            return (
              <ul key={idx} className="space-y-2 pl-5 list-disc marker:text-muted-foreground">
                {(block.items || []).map((item, itemIdx) => (
                  <li key={itemIdx} className="pl-1">
                    {renderInline(item)}
                  </li>
                ))}
              </ul>
            );

          case 'OrderedList':
            return (
              <ol
                key={idx}
                className="space-y-2 pl-5 list-decimal marker:font-mono marker:text-xs marker:text-muted-foreground tabular-nums"
              >
                {(block.items || []).map((item, itemIdx) => (
                  <li key={itemIdx} className="pl-1">
                    {renderInline(item)}
                  </li>
                ))}
              </ol>
            );

          case 'quote':
            return (
              <blockquote
                key={idx}
                className="my-4 px-4 sm:px-5 py-3.5 border border-foreground/12 bg-foreground/[0.02] text-muted-foreground"
              >
                {renderInline(block.text || '')}
              </blockquote>
            );

          case 'table':
            return (
              <div
                key={idx}
                className="my-5 overflow-x-auto border border-foreground/12 bg-foreground/[0.01]"
              >
                <table className="w-full text-left border-collapse text-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-foreground/12 bg-foreground/[0.03]">
                      {(block.headers || []).map((header, hIdx) => (
                        <th
                          key={hIdx}
                          className="px-4 py-3 font-mono text-xs font-medium text-foreground whitespace-nowrap"
                        >
                          {renderInline(header)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/10">
                    {(block.rows || []).map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className="hover:bg-foreground/[0.03] transition-colors"
                      >
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="px-4 py-3 text-foreground/85">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case 'hr':
            return <hr key={idx} className="my-6 border-foreground/10" />;

          case 'paragraph':
          default:
            return (
              <p key={idx} className="whitespace-pre-wrap">
                {renderInline(block.text || '')}
              </p>
            );
        }
      })}
    </div>
  );
};

export const MarkdownRenderer = React.memo(
  MarkdownRendererInner,
  (prev, next) =>
    prev.content === next.content &&
    prev.messageId === next.messageId &&
    prev.onOpenArtifact === next.onOpenArtifact
);
