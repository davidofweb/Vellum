import React, { useState, useEffect } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { ArtifactItem } from '../types';
import { getFileExtension } from '../utils/artifacts';

interface CanvasDrawerProps {
  artifact: ArtifactItem | null;
  onClose: () => void;
}

export const CanvasDrawer: React.FC<CanvasDrawerProps> = ({ artifact, onClose }) => {
  const [tab, setTab] = useState<'preview' | 'code'>('code');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (artifact) {
      setTab(artifact.previewable ? 'preview' : 'code');
    }
  }, [artifact?.id, artifact?.previewable]);

  if (!artifact) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = () => {
    const ext = getFileExtension(artifact.language);
    const safeName = artifact.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName || 'vellum-draft'}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const srcDoc =
    artifact.language === 'svg'
      ? `<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fafaf9;">${artifact.content}</body></html>`
      : artifact.content;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-xs xl:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="fixed inset-x-0 bottom-0 top-10 z-50 xl:static xl:z-auto xl:w-[490px] 2xl:w-[560px] shrink-0 flex flex-col bg-background text-foreground border-t xl:border-t-0 xl:border-l border-foreground/12 shadow-2xl xl:shadow-none">
        {/* Mobile grab handle */}
        <div className="w-10 h-1 bg-foreground/20 rounded-full mx-auto mt-3 mb-1 xl:hidden" />

        {/* Optimus Architectural Header & Underline Tabs */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 border-b border-foreground/10 min-h-[58px]">
          <div className="min-w-0 py-2">
            <h2 className="text-lg font-display tracking-tight text-foreground truncate">
              {artifact.title}
            </h2>
            <p className="font-mono text-[11px] text-muted-foreground">
              {artifact.language} ·{' '}
              <span className="tabular-nums">{artifact.content.split('\n').length}</span> lines
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {artifact.previewable && (
              <div className="flex items-center mr-1">
                <button
                  type="button"
                  onClick={() => setTab('preview')}
                  className={`min-h-[44px] px-3.5 text-xs font-mono transition-colors relative whitespace-nowrap shrink-0 ${
                    tab === 'preview'
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Preview
                  {tab === 'preview' && (
                    <span className="absolute bottom-0 left-2 right-2 h-px bg-foreground" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setTab('code')}
                  className={`min-h-[44px] px-3.5 text-xs font-mono transition-colors relative whitespace-nowrap shrink-0 ${
                    tab === 'code'
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Source
                  {tab === 'code' && (
                    <span className="absolute bottom-0 left-2 right-2 h-px bg-foreground" />
                  )}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleCopy}
              title="Copy content"
              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-foreground" /> : <Copy className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              title="Download file"
              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onClose}
              title="Close canvas"
              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-foreground/[0.015] pb-safe">
          {tab === 'preview' && artifact.previewable ? (
            <iframe
              title={artifact.title}
              srcDoc={srcDoc}
              sandbox="allow-scripts"
              className="w-full h-full border-0 bg-white"
            />
          ) : (
            <pre className="p-4 sm:p-6 text-[13px] leading-relaxed font-mono text-foreground/90 whitespace-pre overflow-x-auto">
              <code>{artifact.content}</code>
            </pre>
          )}
        </div>
      </aside>
    </>
  );
};
