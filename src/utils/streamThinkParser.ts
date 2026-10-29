/**
 * Streaming parser that extracts <think>...</think> or <thinking>...</thinking>
 * blocks in real time so any model streams live planning steps into the
 * Thought process panel without leaking raw tags into the visible reply.
 */
export function withThinkingInstruction(baseSystemPrompt?: string): string {
  const guide =
    'Before writing code, HTML pages, or multi-step answers, write a short, clear step-by-step plan inside <think>...</think> tags first, then write your complete final response after </think>. For very short one-line replies, you may still briefly state your intent inside <think>...</think>.';
  const trimmed = (baseSystemPrompt || '').trim();
  return trimmed ? `${trimmed}\n\n${guide}` : guide;
}

export interface ThinkStreamSplitter {
  pushContent: (chunk: string) => void;
  pushNativeThinking: (chunk: string) => void;
  flush: () => void;
}

export function createThinkStreamSplitter(callbacks: {
  onContent: (delta: string) => void;
  onThinking: (delta: string) => void;
}): ThinkStreamSplitter {
  let state: 'initial' | 'in_think' | 'content' = 'initial';
  let pending = '';
  let activeCloseTag = '</think>';
  let hasEmittedThinking = false;
  let strippedLeadingAfterThink = false;

  const emitThinking = (text: string) => {
    if (!text) return;
    if (!hasEmittedThinking) {
      const cleaned = text.replace(/^\s+/, '');
      if (!cleaned) return;
      hasEmittedThinking = true;
      callbacks.onThinking(cleaned);
      return;
    }
    callbacks.onThinking(text);
  };

  const emitContent = (text: string) => {
    if (!text) return;
    if (!strippedLeadingAfterThink) {
      const cleaned = text.replace(/^\r?\n+/, '');
      if (!cleaned) return;
      strippedLeadingAfterThink = true;
      callbacks.onContent(cleaned);
      return;
    }
    callbacks.onContent(text);
  };

  const processPending = (finalFlush = false) => {
    while (pending.length > 0) {
      if (state === 'initial') {
        const trimmedStart = pending.replace(/^\s+/, '');
        if (!trimmedStart) {
          if (finalFlush) {
            strippedLeadingAfterThink = true;
            emitContent(pending);
            pending = '';
          }
          return;
        }

        const lower = trimmedStart.toLowerCase();
        if (lower.startsWith('<thinking>')) {
          const idx = pending.toLowerCase().indexOf('<thinking>');
          pending = pending.slice(idx + '<thinking>'.length);
          activeCloseTag = '</thinking>';
          state = 'in_think';
          continue;
        }
        if (lower.startsWith('<think>')) {
          const idx = pending.toLowerCase().indexOf('<think>');
          pending = pending.slice(idx + '<think>'.length);
          activeCloseTag = '</think>';
          state = 'in_think';
          continue;
        }

        // Wait if trimmedStart is still a prefix of '<thinking>'
        if (!finalFlush && ('<thinking>'.startsWith(lower) || '<think>'.startsWith(lower))) {
          return;
        }

        strippedLeadingAfterThink = true;
        state = 'content';
        emitContent(pending);
        pending = '';
        return;
      }

      if (state === 'in_think') {
        const lower = pending.toLowerCase();
        const closeIdx = lower.indexOf(activeCloseTag);
        if (closeIdx !== -1) {
          const thoughtPart = pending.slice(0, closeIdx);
          emitThinking(thoughtPart);
          pending = pending.slice(closeIdx + activeCloseTag.length);
          state = 'content';
          continue;
        }

        if (finalFlush) {
          emitThinking(pending);
          pending = '';
          return;
        }

        // Hold back any trailing partial match of activeCloseTag (e.g. "</thi")
        let holdBack = 0;
        const maxHold = Math.min(pending.length, activeCloseTag.length - 1);
        for (let len = maxHold; len >= 1; len--) {
          if (activeCloseTag.startsWith(lower.slice(-len))) {
            holdBack = len;
            break;
          }
        }

        const safeLen = pending.length - holdBack;
        if (safeLen > 0) {
          emitThinking(pending.slice(0, safeLen));
          pending = pending.slice(safeLen);
        }
        return;
      }

      // state === 'content'
      emitContent(pending);
      pending = '';
    }
  };

  return {
    pushContent(chunk: string) {
      if (!chunk) return;
      pending += chunk;
      processPending(false);
    },
    pushNativeThinking(chunk: string) {
      if (!chunk) return;
      emitThinking(chunk);
    },
    flush() {
      processPending(true);
    },
  };
}
