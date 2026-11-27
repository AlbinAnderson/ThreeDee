/**
 * Floating roll & spell-card toasts shown over the board whenever Chat isn't
 * visible, so rolling from the Character Sheet, Skills, Spells or Actions gives
 * immediate visual feedback. Clicking a toast opens the Chat panel.
 */
import { useEffect, useRef, useState } from 'react';
import { Dices, Sparkles, X } from 'lucide-react';
import type { ChatMessage } from '@vtt/shared';
import { useGame } from '../state/hooks';
import { useUi } from '../state/uiStore';
import { d20Highlight } from '../lib/rolls';

interface FloatingEntry {
  id: string;
  message: ChatMessage;
}

export function RollToasts() {
  const chat = useGame((s) => s.chat);
  const users = useGame((s) => s.users);
  const sidebarPanel = useUi((s) => s.sidebarPanel);
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed);
  const chatVisible = sidebarPanel === 'chat' && !sidebarCollapsed;

  const seenCountRef = useRef<number | null>(null);
  const [items, setItems] = useState<FloatingEntry[]>([]);

  // Mark chat read whenever Chat panel is visible.
  useEffect(() => {
    if (chatVisible && chat.length > 0) {
      useUi.getState().markChatSeen(chat[chat.length - 1]!.id);
    }
  }, [chatVisible, chat]);

  useEffect(() => {
    if (seenCountRef.current === null) {
      seenCountRef.current = chat.length;
      if (chat.length > 0) useUi.getState().markChatSeen(chat[chat.length - 1]!.id);
      return;
    }
    if (chat.length <= seenCountRef.current) {
      seenCountRef.current = chat.length;
      return;
    }
    const fresh = chat.slice(seenCountRef.current);
    seenCountRef.current = chat.length;

    if (chatVisible) return;

    const notable = fresh.filter((m) => m.roll || m.card);
    if (!notable.length) return;

    setItems((prev) => [...prev, ...notable.map((m) => ({ id: m.id, message: m }))].slice(-3));
    const ids = new Set(notable.map((m) => m.id));
    const timer = window.setTimeout(() => {
      setItems((prev) => prev.filter((x) => !ids.has(x.id)));
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [chat, chatVisible]);

  if (chatVisible || items.length === 0) return null;

  const openChat = () => {
    setItems([]);
    const ui = useUi.getState();
    ui.setSidebarCollapsed(false);
    ui.setSidebarPanel('chat');
  };

  return (
    <div className="roll-toast-stack" aria-live="polite">
      {items.map(({ id, message: m }) => {
        const author = users[m.userId]?.name ?? 'Table';
        const hi = d20Highlight(m.roll);
        return (
          <div key={id} className="roll-toast" onClick={openChat} role="status">
            <div className="roll-toast-head">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
                {m.roll ? <Dices size={13} /> : <Sparkles size={13} />}
                {author}
              </span>
              {m.whisper && <span className="badge warn">{m.whisper.mode === 'gm' ? 'GM only' : 'Whisper'}</span>}
              <button
                type="button"
                className="icon-button"
                style={{ minWidth: 20, minHeight: 20, padding: 1 }}
                aria-label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  setItems((prev) => prev.filter((x) => x.id !== id));
                }}
              >
                <X size={12} />
              </button>
            </div>
            {m.roll ? (
              <div className="roll-toast-body">
                <div className="flex1">
                  <div className="roll-label">{m.text || 'Roll'}</div>
                  <div className="roll-expr">{m.roll.expression}</div>
                </div>
                <div className={`roll-toast-total${hi ? ` ${hi}` : ''}`}>{m.roll.total}</div>
              </div>
            ) : m.card ? (
              <div>
                <div className="roll-label">{m.card.title}</div>
                {m.card.subtitle && <div className="roll-expr">{m.card.subtitle}</div>}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
