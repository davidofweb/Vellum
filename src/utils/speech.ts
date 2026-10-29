export function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  );
}

/**
 * Converts Markdown response text into natural spoken sentence chunks
 * suitable for the browser Web Speech API on mobile and desktop.
 */
export function prepareTextForSpeech(rawContent: string): string[] {
  if (!rawContent || !rawContent.trim()) return [];

  const withoutCodeBlocks = rawContent.replace(/```[\s\S]*?```/g, ' ');
  const hasProseOutsideCode = withoutCodeBlocks.replace(/\s+/g, '').length > 0;

  let text = hasProseOutsideCode
    ? rawContent.replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    : rawContent.replace(/```[a-zA-Z0-9_-]*\n?/g, ' ').replace(/```/g, ' ');

  text = text
    // Images and links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Headings, blockquotes, horizontal rules, list markers
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')
    .replace(/^\s*[-*+]\s+/gm, '')
    // Inline formatting tokens and HTML tags
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/<[^>]+>/g, ' ')
    // Table pipes and excess punctuation
    .replace(/\|+/g, ', ')
    .replace(/\r?\n+/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/(\.\s*){2,}/g, '. ')
    .trim();

  if (!text) return [];

  const maxChunkLength = 220;
  const rawSentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks: string[] = [];
  let current = '';

  const pushLongSegment = (segment: string) => {
    const words = segment.trim().split(/\s+/);
    let line = '';
    for (const word of words) {
      if (!line) {
        line = word;
      } else if (line.length + 1 + word.length <= maxChunkLength) {
        line += ` ${word}`;
      } else {
        chunks.push(line);
        line = word;
      }
    }
    if (line) chunks.push(line);
  };

  for (const rawSentence of rawSentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;

    if (sentence.length > maxChunkLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      pushLongSegment(sentence);
      continue;
    }

    if (!current) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= maxChunkLength) {
      current += ` ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
