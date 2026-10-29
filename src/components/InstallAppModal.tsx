import React from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';

interface InstallAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  isIOS: boolean;
  isInIframe: boolean;
}

export const InstallAppModal: React.FC<InstallAppModalProps> = ({
  isOpen,
  onClose,
  isIOS,
  isInIframe,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-xs p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-background border-t sm:border border-foreground/15 p-6 pb-safe shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-foreground text-background flex items-center justify-center font-display text-2xl font-bold shrink-0">
              V
            </div>
            <div>
              <h2 className="font-display text-2xl leading-tight tracking-tight text-foreground">
                Install Vellum
              </h2>
              <p className="text-xs font-medium text-muted-foreground mt-0.5">
                Launch full-screen from your home screen or dock
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close install guide"
            className="min-h-[40px] min-w-[40px] rounded-full border border-foreground/15 hover:bg-foreground/5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isIOS ? (
          <div className="space-y-3 border-t border-b border-foreground/10 py-4 text-sm text-foreground">
            <div className="flex items-start gap-3">
              <span className="font-mono text-xs font-semibold text-muted-foreground pt-0.5">
                01
              </span>
              <p className="font-medium leading-relaxed">
                Open this page in <strong>Safari</strong> and tap the{' '}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-foreground/15 font-mono text-xs">
                  <Share className="w-3 h-3" /> Share
                </span>{' '}
                button on the bottom bar.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-mono text-xs font-semibold text-muted-foreground pt-0.5">
                02
              </span>
              <p className="font-medium leading-relaxed">
                Scroll down and tap <strong>Add to Home Screen</strong>, then tap{' '}
                <strong>Add</strong>.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 border-t border-b border-foreground/10 py-4 text-sm text-foreground">
            {isInIframe && (
              <div className="flex items-start gap-3">
                <span className="font-mono text-xs font-semibold text-muted-foreground pt-0.5">
                  01
                </span>
                <p className="font-medium leading-relaxed">
                  Open your deployed Vellum link directly in a standalone browser tab (browsers block direct installation inside preview frames).
                </p>
              </div>
            )}
            <div className="flex items-start gap-3">
              <span className="font-mono text-xs font-semibold text-muted-foreground pt-0.5">
                {isInIframe ? '02' : '01'}
              </span>
              <p className="font-medium leading-relaxed">
                In Chrome, Edge, or Android browser, tap the{' '}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-foreground/15 font-mono text-xs">
                  <Download className="w-3 h-3" /> Install
                </span>{' '}
                icon in the address bar or open the browser menu and select{' '}
                <strong>Install app</strong> / <strong>Add to Home screen</strong>.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Smartphone className="w-3.5 h-3.5" />
            Works offline for saved chats
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 rounded-full bg-foreground text-background text-xs font-semibold tracking-tight hover:bg-foreground/90 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
