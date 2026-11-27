import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Compass, Dices } from 'lucide-react';
import {
  chatActions,
  formatTermNotation,
  newId,
  type ChatCard,
  type ChatMessage,
  type ChatWhisper,
  type RollResult,
  type User,
} from '@vtt/shared';
import { dispatch } from '../state/dispatch';
import { confirmDialog } from '../state/dialogs';
import { useGameStore } from '../state/gameStore';
import { useGame, useIsGm, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { currentWhisper, useUi } from '../state/uiStore';
import { armTemplate } from '../tools/templateTool';

const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100];

/** Roll dice into chat using the current chat mode (or an explicit visibility). */
export function rollToChat(expression: string, label?: string, whisper: ChatWhisper | undefined = currentWhisper()) {
  return dispatch(chatActions.roll.create({ id: newId(), expression, label, whisper }));
}

/** Split "expr # label". */
function splitLabel(input: string): [string, string | undefined] {
  const [expression = '', ...rest] = input.split('#');
  return [expression.trim(), rest.join('#').trim() || undefined];
}

/**
 * Find the user whose name prefixes `text` (longest match), for "/w Some Name
 * message". If several users share a name, prefer whoever is online.
 */
function matchRecipient(text: string, users: User[]): { user: User; rest: string } | null {
  const lower = text.toLowerCase();
  const online = useGameStore.getState().online;
  let best: User | null = null;
  for (const u of users) {
    const n = u.name.toLowerCase();
    if (lower !== n && !lower.startsWith(n + ' ')) continue;
    const better =
      !best ||
      n.length > best.name.length ||
      (n.length === best.name.length && online.includes(u.id) && !online.includes(best.id));
    if (better) best = u;
  }
  return best ? { user: best, rest: text.slice(best.name.length).trim() } : null;
}

/**
 * Commands:
 *   /r 1d20+5 # Attack     roll (current chat mode)
 *   /gr 1d20+5 # Stealth   GM-only roll
 *   /w Name message        whisper (also /w Name /r 1d20)
 *   anything else          message (current chat mode)
 */
function submitChat(input: string, users: User[]): boolean {
  const gr = /^\/(?:gr|gmroll)\s+(.+)$/i.exec(input);
  if (gr) return rollToChat(...splitLabel(gr[1]!), { mode: 'gm', to: [] });

  const r = /^\/(?:r|roll)\s+(.+)$/i.exec(input);
  if (r) return rollToChat(...splitLabel(r[1]!));

  const w = /^\/(?:w|whisper)\s+(.+)$/i.exec(input);
  if (w) {
    const match = matchRecipient(w[1]!, users);
    if (!match || !match.rest) {
      notify('Usage: /w <player name> <message>');
      return false;
    }
    const whisper: ChatWhisper = { mode: 'whisper', to: [match.user.id] };
    const inner = /^\/(?:r|roll)\s+(.+)$/i.exec(match.rest);
    if (inner) return rollToChat(...splitLabel(inner[1]!), whisper);
    return dispatch(chatActions.send.create({ id: newId(), text: match.rest, whisper }));
  }

  if (input.startsWith('/')) {
    notify('Unknown command. Try /r, /gr or /w');
    return false;
  }
  return dispatch(chatActions.send.create({ id: newId(), text: input, whisper: currentWhisper() }));
}

export function ChatPanel() {
  const chat = useGame((s) => s.chat);
  const users = useGame((s) => s.users);
  const gm = useIsGm();
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const userList = useMemo(() => Object.values(users), [users]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (text && submitChat(text, userList)) setInput('');
  }

  return (
    <div className="chat-panel">
      <div className="chat-log" ref={logRef}>
        {chat.length === 0 && <p className="muted">No messages yet. Try /r 1d20+5 # Attack, /gr for a GM-only roll, /w Name to whisper.</p>}
        {chat.map((m) => (
          <ChatLine key={m.id} message={m} users={users} />
        ))}
      </div>
      <ChatModePicker />
      <div className="quick-dice">
        {QUICK_DICE.map((d) => (
          <button key={d} type="button" onClick={() => rollToChat(`1d${d}`)}>
            d{d}
          </button>
        ))}
      </div>
      <form className="chat-input" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message, /r 2d6+3 # label, /w Name hi"
          maxLength={2000}
        />
        <button type="submit">Send</button>
      </form>
      {gm && chat.length > 0 && (
        <button
          type="button"
          className="link-button"
          onClick={async () => {
            if (await confirmDialog({ title: 'Clear chat log?', message: 'Clear the chat log for everyone in the room?', confirmLabel: 'Clear chat', danger: true })) {
              dispatch(chatActions.clear.create({}));
            }
          }}
        >
          Clear chat
        </button>
      )}
    </div>
  );
}

function ChatModePicker() {
  const chatMode = useUi((s) => s.chatMode);
  const setChatMode = useUi((s) => s.setChatMode);
  const users = useGame((s) => s.users);
  const self = useSelf();
  const others = useMemo(() => Object.values(users).filter((u) => u.id !== self.id), [users, self.id]);

  return (
    <div className="chat-mode">
      <select
        value={chatMode.mode}
        onChange={(e) => setChatMode({ mode: e.target.value as typeof chatMode.mode, to: chatMode.to })}
        title="Who sees your messages and rolls"
      >
        <option value="public">Everyone</option>
        <option value="gm">GM only</option>
        <option value="whisper">Whisper…</option>
      </select>
      {chatMode.mode === 'whisper' && (
        <select
          value={chatMode.to[0] ?? ''}
          onChange={(e) => setChatMode({ mode: 'whisper', to: e.target.value ? [e.target.value] : [] })}
        >
          <option value="">Choose…</option>
          {others.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function visibilityLabel(m: ChatMessage, users: Record<string, User>): string | null {
  if (!m.whisper) return null;
  if (m.whisper.mode === 'gm') return 'GM only';
  return `to ${m.whisper.to.map((id) => users[id]?.name ?? '?').join(', ')}`;
}

function ChatLine({ message, users }: { message: ChatMessage; users: Record<string, User> }) {
  const author = users[message.userId];
  const time = new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const vis = visibilityLabel(message, users);
  return (
    <div className={`chat-line${message.whisper ? ' private' : ''}`}>
      <div className="chat-meta">
        <span className="chat-author" style={{ color: author?.color }}>
          {author?.name ?? (message.userId === 'system' ? 'Table' : 'Unknown')}
        </span>
        {vis && <span className="badge warn">{vis}</span>}
        <span className="chat-time">{time}</span>
      </div>
      {message.roll ? (
        <RollCard roll={message.roll} label={message.text} />
      ) : message.card ? (
        <CardAttachment card={message.card} authorId={message.userId} />
      ) : (
        <div className="chat-text">{message.text}</div>
      )}
    </div>
  );
}

function CardAttachment({ card, authorId }: { card: ChatCard; authorId: string }) {
  const self = useSelf();
  const gm = useIsGm();
  // A card's checks and area belong to whoever posted it (and the GM, who runs everyone).
  const mine = !!self && (self.id === authorId || gm);
  return (
    <div className="roll-card chat-card">
      {card.imageUrl && <img src={card.imageUrl} alt="" className="chat-card-image" />}
      <div>
        {card.subtitle && <div className="roll-expr">{card.subtitle}</div>}
        <div className="roll-label">{card.title}</div>
        {card.text && <div className="chat-text">{card.text}</div>}
        {mine && (card.rolls?.length || card.area) ? (
          <div className="button-row chat-card-actions">
            {card.rolls?.map((r) => (
              <button
                key={r.label}
                type="button"
                className="small rollable"
                onClick={() => rollToChat(`1d20${r.bonus >= 0 ? '+' : ''}${r.bonus}`, `${card.title} — ${r.label}`.slice(0, 100))}
              >
                <Dices size={12} /> {r.label} {r.bonus >= 0 ? '+' : ''}
                {r.bonus}
              </button>
            ))}
            {card.area && (
              <button type="button" className="small" title="Switch to the template tool with this area" onClick={() => armTemplate(card.area!)}>
                <Compass size={12} /> {card.area.label}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RollCard({ roll, label }: { roll: RollResult; label: string }) {
  return (
    <div className="roll-card">
      {label && <div className="roll-label">{label}</div>}
      <div className="roll-body">
        <div className="roll-breakdown">
          <div className="roll-expr">{roll.expression}</div>
          <div className="roll-terms">
            {roll.terms.map((t, i) => (
              <span key={i} className="roll-term" title={formatTermNotation(t)}>
                {i > 0 || t.sign < 0 ? (t.sign < 0 ? ' − ' : ' + ') : ''}
                {t.kind === 'const' ? (
                  t.value
                ) : (
                  <>
                    [
                    {t.rolls.map((r, j) => (
                      <span
                        key={j}
                        className={`die${r.dropped ? ' dropped' : ''}${r.value === t.sides ? ' max' : ''}${r.value === 1 ? ' min' : ''}`}
                      >
                        {j > 0 ? ', ' : ''}
                        {r.value}
                      </span>
                    ))}
                    ]
                  </>
                )}
              </span>
            ))}
          </div>
        </div>
        <div className="roll-total">{roll.total}</div>
      </div>
    </div>
  );
}
