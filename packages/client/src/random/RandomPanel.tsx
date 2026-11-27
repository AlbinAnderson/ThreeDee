import { useMemo, useState } from 'react';
import { deckActions, newId, tableActions, type Card, type Deck, type RollTable, type TableEntry } from '@vtt/shared';
import { CheckboxField, ImageUploadButton, TextAreaField, TextField } from '../components/fields';
import { uploadAsset } from '../lib/assets';
import { confirmDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { useGame, useIsGm, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { currentWhisper } from '../state/uiStore';

/** Rollable tables and card decks. */
export function RandomPanel() {
  return (
    <div className="panel-scroll">
      <TablesSection />
      <DecksSection />
    </div>
  );
}

// ------------------------------------------------------------------ tables

/** "3: Goblins" or "Goblins" per line -> entries (weight defaults to 1). */
function parseEntries(text: string, previous: TableEntry[]): TableEntry[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 500)
    .map((line, i) => {
      const m = /^(\d{1,4})\s*[:|]\s*(.+)$/.exec(line);
      const weight = m ? Math.max(1, Math.min(1000, Number(m[1]))) : 1;
      const text = (m ? m[2]! : line).slice(0, 500);
      return { id: previous[i]?.id ?? newId(), text, weight };
    });
}

const entriesToText = (entries: TableEntry[]) => entries.map((e) => (e.weight !== 1 ? `${e.weight}: ${e.text}` : e.text)).join('\n');

function TablesSection() {
  const tables = useGame((s) => s.tables);
  const gm = useIsGm();
  const [editing, setEditing] = useState<string | null>(null);
  const list = useMemo(() => Object.values(tables).sort((a, b) => a.name.localeCompare(b.name)), [tables]);

  function create() {
    const id = newId();
    if (dispatch(tableActions.create.create({ table: { id, name: 'New table', entries: [], playersCanRoll: false } }))) setEditing(id);
  }

  return (
    <section>
      <div className="section-header">
        <h3>Rollable tables</h3>
        {gm && (
          <button type="button" className="small primary" onClick={create}>
            + New
          </button>
        )}
      </div>
      {list.length === 0 && <p className="muted small-text">{gm ? 'Random encounters, loot, weather, NPC names…' : 'No tables shared with players.'}</p>}
      <ul className="handout-list">
        {list.map((t) => (
          <li key={t.id}>
            <div className="handout-row">
              <span className="handout-title flex1">{t.name}</span>
              <span className="muted small-text">{t.entries.length}</span>
              {gm && !t.playersCanRoll && <span className="badge subtle">GM</span>}
              <button
                type="button"
                className="small"
                disabled={!t.entries.length}
                onClick={() => dispatch(tableActions.roll.create({ tableId: t.id, chatId: newId(), whisper: currentWhisper() }))}
              >
                🎲 Roll
              </button>
              {gm && (
                <button type="button" className="small" onClick={() => setEditing(editing === t.id ? null : t.id)}>
                  {editing === t.id ? 'Done' : 'Edit'}
                </button>
              )}
            </div>
            {gm && editing === t.id && <TableEditor table={t} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TableEditor({ table: t }: { table: RollTable }) {
  const update = (changes: Parameters<typeof tableActions.update.create>[0]['changes']) =>
    dispatch(tableActions.update.create({ id: t.id, changes }));
  return (
    <div className="loot-editor">
      <TextField label="Name" value={t.name} onCommit={(name) => update({ name })} />
      <TextAreaField
        label="Entries: one per line, optional weight like “3: Goblins”"
        value={entriesToText(t.entries)}
        rows={8}
        onCommit={(text) => update({ entries: parseEntries(text, t.entries) })}
      />
      <CheckboxField label="Players can see and roll" value={t.playersCanRoll} onCommit={(playersCanRoll) => update({ playersCanRoll })} />
      <button
        type="button"
        className="danger small"
        onClick={async () => {
          if (await confirmDialog({ title: `Delete "${t.name}"?`, message: 'Remove this roll table?', confirmLabel: 'Delete', danger: true })) {
            dispatch(tableActions.remove.create({ id: t.id }));
          }
        }}
      >
        Delete table
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ decks

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function standardDeckCards(): Card[] {
  const cards = SUITS.flatMap((s) => RANKS.map((r) => ({ id: newId(), name: `${r}${s}`, imageUrl: null, text: '' })));
  cards.push({ id: newId(), name: 'Joker', imageUrl: null, text: '' }, { id: newId(), name: 'Joker', imageUrl: null, text: '' });
  return cards;
}

function emptyDeck(name: string, cards: Card[]): Deck {
  const ids = cards.map((c) => c.id);
  return {
    id: newId(),
    name,
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    cardOrder: ids,
    drawPile: [...ids],
    drawn: [],
    discard: [],
    playersCanDraw: true,
  };
}

function DecksSection() {
  const decks = useGame((s) => s.decks);
  const gm = useIsGm();
  const list = useMemo(() => Object.values(decks).sort((a, b) => a.name.localeCompare(b.name)), [decks]);

  function create(standard: boolean) {
    const deck = emptyDeck(standard ? 'Playing cards' : 'New deck', standard ? standardDeckCards() : []);
    if (dispatch(deckActions.create.create({ deck })) && standard) dispatch(deckActions.shuffle.create({ deckId: deck.id }));
  }

  return (
    <section>
      <div className="section-header">
        <h3>Card decks</h3>
        {gm && (
          <div className="button-row compact">
            <button type="button" className="small" onClick={() => create(true)} title="52 cards + 2 jokers, shuffled">
              + 52-card
            </button>
            <button type="button" className="small primary" onClick={() => create(false)}>
              + New
            </button>
          </div>
        )}
      </div>
      {list.length === 0 && <p className="muted small-text">{gm ? 'Harrow decks, tarot, custom item decks…' : 'No decks yet.'}</p>}
      {list.map((d) => (
        <DeckView key={d.id} deck={d} />
      ))}
    </section>
  );
}

function DeckView({ deck }: { deck: Deck }) {
  const gm = useIsGm();
  const self = useSelf();
  const users = useGame((s) => s.users);
  const [editing, setEditing] = useState(false);
  const canDraw = gm || deck.playersCanDraw;

  const draw = (faceUp: boolean) => dispatch(deckActions.draw.create({ deckId: deck.id, faceUp, chatId: newId() }));

  return (
    <div className="deck">
      <div className="handout-row">
        <span className="handout-title flex1">{deck.name}</span>
        <span className="muted small-text" title="Cards left in the draw pile">
          🂠 {deck.drawPile.length}/{deck.cardOrder.length}
        </span>
        {gm && (
          <button type="button" className="small" onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>
      {canDraw && (
        <div className="button-row">
          <button type="button" className="small" disabled={!deck.drawPile.length} onClick={() => draw(true)}>
            Draw face up
          </button>
          <button type="button" className="small" disabled={!deck.drawPile.length} onClick={() => draw(false)}>
            Draw face down
          </button>
          {gm && (
            <button
              type="button"
              className="small"
              onClick={() => {
                dispatch(deckActions.reset.create({ deckId: deck.id }));
                dispatch(deckActions.shuffle.create({ deckId: deck.id }));
              }}
            >
              Gather &amp; shuffle
            </button>
          )}
        </div>
      )}
      {deck.drawn.length > 0 && (
        <ul className="drawn-cards">
          {deck.drawn.map((d) => {
            const card = deck.cards[d.cardId];
            const mine = d.userId === self.id;
            const visible = d.faceUp || mine || gm;
            return (
              <li key={d.cardId} className={d.faceUp ? '' : 'face-down'}>
                {visible && card?.imageUrl ? <img src={card.imageUrl} alt="" className="card-thumb" /> : <span className="card-thumb back">🂠</span>}
                <span className="flex1">
                  <strong>{visible ? card?.name : 'Face-down card'}</strong>
                  <span className="muted small-text"> · {users[d.userId]?.name ?? '?'}</span>
                  {visible && card?.text && <div className="small-text">{card.text}</div>}
                </span>
                {(mine || gm) && !d.faceUp && (
                  <button type="button" className="small" onClick={() => dispatch(deckActions.reveal.create({ deckId: deck.id, cardId: d.cardId, chatId: newId() }))}>
                    Reveal
                  </button>
                )}
                {(mine || gm) && (
                  <button type="button" className="small" onClick={() => dispatch(deckActions.discard.create({ deckId: deck.id, cardId: d.cardId }))}>
                    Discard
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {deck.discard.length > 0 && <p className="muted small-text">Discard pile: {deck.discard.length}</p>}
      {gm && editing && <DeckEditor deck={deck} />}
    </div>
  );
}

function DeckEditor({ deck }: { deck: Deck }) {
  const [lines, setLines] = useState('');
  const update = (changes: Parameters<typeof deckActions.update.create>[0]['changes']) =>
    dispatch(deckActions.update.create({ id: deck.id, changes }));

  function addTextCards() {
    const cards = lines
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((l) => {
        const [name = '', ...rest] = l.split('|');
        return { id: newId(), name: name.trim().slice(0, 80) || 'Card', imageUrl: null, text: rest.join('|').trim().slice(0, 2000) };
      });
    if (cards.length && dispatch(deckActions.addCards.create({ deckId: deck.id, cards }))) setLines('');
  }

  return (
    <div className="loot-editor">
      <TextField label="Name" value={deck.name} onCommit={(name) => update({ name })} />
      <CheckboxField label="Players can draw" value={deck.playersCanDraw} onCommit={(playersCanDraw) => update({ playersCanDraw })} />
      <div className="button-row">
        <ImageUploadButton
          label="+ Cards from images"
          multiple
          onFile={async (file) => {
            try {
              const url = await uploadAsset(file);
              dispatch(
                deckActions.addCards.create({
                  deckId: deck.id,
                  cards: [{ id: newId(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Card', imageUrl: url, text: '' }],
                }),
              );
            } catch (e) {
              notify(`${file.name}: ${(e as Error).message}`);
            }
          }}
        />
      </div>
      <div className="field">
        <label>Add text cards: one per line, “Name | description”</label>
        <textarea rows={3} value={lines} onChange={(e) => setLines(e.target.value)} />
      </div>
      <div className="button-row">
        <button type="button" className="small" onClick={addTextCards} disabled={!lines.trim()}>
          Add cards
        </button>
      </div>
      <details>
        <summary className="muted small-text">All cards ({deck.cardOrder.length})</summary>
        <ul className="macro-list">
          {deck.cardOrder.map((id) => (
            <li key={id}>
              <span className="macro-name">{deck.cards[id]?.name}</span>
              <button type="button" className="icon-button" title="Remove card" onClick={() => dispatch(deckActions.removeCard.create({ deckId: deck.id, cardId: id }))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      </details>
      <button
        type="button"
        className="danger small"
        onClick={async () => {
          if (await confirmDialog({ title: `Delete "${deck.name}"?`, message: 'Remove this card deck?', confirmLabel: 'Delete', danger: true })) {
            dispatch(deckActions.remove.create({ id: deck.id }));
          }
        }}
      >
        Delete deck
      </button>
    </div>
  );
}
