import { useEffect, useRef, useState, type FormEvent } from 'react';
import { chatActions, formatTermNotation, newId, type ChatMessage, type RollResult, type User } from '@vtt/shared';
import { dispatch } from '../state/dispatch';
import { useGame, useIsGm } from '../state/hooks';

const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100];

/** "/r 1d20+5 # Attack" -> roll; anything else -> text. */
function submitChat(input: string): boolean {
  const roll = /^\/(?:r|roll)\s+(.+)$/i.exec(input);
  if (roll) {
    const [expression = '', ...labelParts] = roll[1]!.split('#');
    const label = labelParts.join('#').trim() || undefined;
    return dispatch(chatActions.roll.create({ id: newId(), expression: expression.trim(), label }));
  }
  return dispatch(chatActions.send.create({ id: newId(), text: input }));
}

export function ChatPanel() {
  const chat = useGame((s) => s.chat);
  const users = useGame((s) => s.users);
  const gm = useIsGm();
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (text && submitChat(text)) setInput('');
  }

  return (
    <div className="chat-panel">
      <div className="chat-log" ref={logRef}>
        {chat.length === 0 && <p className="muted">No messages yet. Try /r 1d20+5 # Attack</p>}
        {chat.map((m) => (
          <ChatLine key={m.id} message={m} author={users[m.userId]} />
        ))}
      </div>
      <div className="quick-dice">
        {QUICK_DICE.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => dispatch(chatActions.roll.create({ id: newId(), expression: `1d${d}` }))}
          >
            d{d}
          </button>
        ))}
      </div>
      <form className="chat-input" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message, or /r 2d6+3 # label"
          maxLength={2000}
        />
        <button type="submit">Send</button>
      </form>
      {gm && chat.length > 0 && (
        <button
          type="button"
          className="link-button"
          onClick={() => confirm('Clear the chat log for everyone?') && dispatch(chatActions.clear.create({}))}
        >
          Clear chat
        </button>
      )}
    </div>
  );
}

function ChatLine({ message, author }: { message: ChatMessage; author: User | undefined }) {
  const time = new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="chat-line">
      <div className="chat-meta">
        <span className="chat-author" style={{ color: author?.color }}>
          {author?.name ?? 'Unknown'}
        </span>
        <span className="chat-time">{time}</span>
      </div>
      {message.roll ? <RollCard roll={message.roll} label={message.text} /> : <div className="chat-text">{message.text}</div>}
    </div>
  );
}

function RollCard({ roll, label }: { roll: RollResult; label: string }) {
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
