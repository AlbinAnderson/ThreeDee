/**
 * Instant, richly styled breakdown popover rendered in a fixed portal so it
 * never clips inside scrolling panels and appears immediately on hover/focus.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { signed, type StatLine } from '@vtt/shared';

export interface InfoTipProps {
  title?: string;
  line?: StatLine;
  body?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function InfoTip({ title, line, body, hint, children, className }: InfoTipProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  const show = useCallback(() => {
    const wrap = wrapRef.current;
    const target = (wrap?.firstElementChild as HTMLElement | null) ?? wrap;
    if (!target) return;
    const r = target.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const tipWidth = 260;
    const left = Math.max(10, Math.min(window.innerWidth - tipWidth - 10, r.left + r.width / 2 - tipWidth / 2));
    const below = r.top < 170;
    const top = below ? Math.min(window.innerHeight - 120, r.bottom + 8) : Math.max(10, r.top - 8);
    setPos({ left, top, below });
  }, []);

  const hide = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!pos) return;
    const onScroll = () => setPos(null);
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [pos]);

  const hasContent = !!(title || body || hint || (line && line.parts.length > 0));
  if (!hasContent) return <>{children}</>;

  return (
    <span
      ref={wrapRef}
      className={className}
      style={{ display: 'contents' }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <div
            className="infotip-portal"
            role="tooltip"
            style={{
              left: pos.left,
              top: pos.top,
              transform: pos.below ? undefined : 'translateY(-100%)',
            }}
          >
            {title && <div className="infotip-title">{title}</div>}
            {body && <div className="infotip-body">{body}</div>}
            {line && line.parts.length > 0 && (
              <ul className="infotip-parts">
                {line.parts.map((p, i) => (
                  <li key={`${p.source}-${i}`} className={p.applied ? '' : 'overruled'}>
                    <span>
                      {p.source}
                      {p.type !== 'base' && p.type !== 'ability' && p.type !== 'untyped' ? ` (${p.type})` : ''}
                    </span>
                    <strong>{p.type === 'base' ? p.value : signed(p.value)}</strong>
                  </li>
                ))}
              </ul>
            )}
            {hint && <div className="infotip-hint">{hint}</div>}
          </div>,
          document.body,
        )}
    </span>
  );
}
