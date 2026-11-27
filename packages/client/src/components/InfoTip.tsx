/**
 * Instant, richly styled breakdown/glossary popover rendered in a fixed portal.
 * Uses top/bottom coordinates (never CSS transform) so animations never shift position.
 * Pass `clickToPin` to allow clicking a badge/pill to toggle-pin the popup open.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { signed, type StatLine } from '@vtt/shared';

export interface InfoTipProps {
  title?: string;
  line?: StatLine;
  body?: string;
  hint?: string;
  /** Clicking the trigger pins/unpins the popup (useful for glossary badges). */
  clickToPin?: boolean;
  children: ReactNode;
  className?: string;
}

interface TipPos {
  left: number;
  top?: number;
  bottom?: number;
  anchorTop: number;
}

function computePos(wrap: HTMLSpanElement | null): TipPos | null {
  const target = (wrap?.firstElementChild as HTMLElement | null) ?? wrap;
  if (!target) return null;
  const r = target.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const tipWidth = 280;
  const left = Math.max(10, Math.min(window.innerWidth - tipWidth - 10, r.left + r.width / 2 - tipWidth / 2));
  const below = r.top < 170;
  if (below) return { left, top: Math.min(window.innerHeight - 100, Math.round(r.bottom + 8)), anchorTop: r.top };
  return { left, bottom: Math.max(10, Math.round(window.innerHeight - r.top + 8)), anchorTop: r.top };
}

export function InfoTip({ title, line, body, hint, clickToPin, children, className }: InfoTipProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [hoverPos, setHoverPos] = useState<TipPos | null>(null);
  const [pinnedPos, setPinnedPos] = useState<TipPos | null>(null);

  const pos = pinnedPos ?? hoverPos;

  const showHover = useCallback(() => {
    const next = computePos(wrapRef.current);
    if (next) setHoverPos(next);
  }, []);

  const hideHover = useCallback(() => setHoverPos(null), []);

  const onClick = useCallback(
    (e: MouseEvent) => {
      if (!clickToPin) return;
      e.stopPropagation();
      setPinnedPos((cur) => (cur ? null : computePos(wrapRef.current)));
    },
    [clickToPin],
  );

  useEffect(() => {
    if (!pos) return;
    const onScroll = () => {
      setHoverPos(null);
      setPinnedPos((cur) => {
        if (!cur) return null;
        const target = (wrapRef.current?.firstElementChild as HTMLElement | null) ?? wrapRef.current;
        if (!target) return null;
        return Math.abs(target.getBoundingClientRect().top - cur.anchorTop) > 2 ? null : cur;
      });
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [pos]);

  useEffect(() => {
    if (!pinnedPos) return;
    const onDown = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      if (tipRef.current?.contains(target)) return;
      if (wrapRef.current?.contains(target)) return;
      setPinnedPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinnedPos(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pinnedPos]);

  const hasContent = !!(title || body || hint || (line && line.parts.length > 0));
  if (!hasContent) return <>{children}</>;

  return (
    <span
      ref={wrapRef}
      className={className}
      style={{ display: 'contents' }}
      onMouseEnter={showHover}
      onMouseLeave={hideHover}
      onFocus={showHover}
      onBlur={hideHover}
      onClick={clickToPin ? onClick : undefined}
    >
      {children}
      {pos &&
        createPortal(
          <div
            ref={tipRef}
            className={`infotip-portal${pinnedPos ? ' pinned' : ''}`}
            role="tooltip"
            style={{
              left: pos.left,
              ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
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
            {(hint || pinnedPos) && <div className="infotip-hint">{pinnedPos ? 'Click outside or press Esc to close' : hint}</div>}
          </div>,
          document.body,
        )}
    </span>
  );
}
