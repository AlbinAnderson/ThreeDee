/**
 * Card decks (Harrow decks, tarot, a plain 52, custom item decks...).
 *
 * The order of the draw pile is secret: the server shuffles, only GMs receive
 * the order, and players' copies keep the pile sorted. Drawing takes the real
 * top card on the server. Face-down cards are only shown to the drawer and
 * the GM in the UI (the card id itself does reach other clients).
 */
import { z } from 'zod';
import type { Draft } from 'immer';
import { defineAction, type AuthContext, type AuthResult, type Redactor } from '../actions/define';
import { isGm, requireGm } from '../actions/auth';
import { CardSchema, DeckSchema, IdSchema, type Deck, type GameState } from '../state';
import { pushMessage } from './chat';

function requireDeck(ctx: AuthContext, id: string): AuthResult {
  const gm = requireGm(ctx);
  if (gm !== true) return gm;
  return ctx.state.decks[id] ? true : 'Deck not found';
}

function requireDrawnBy(ctx: AuthContext, deckId: string, cardId: string): AuthResult {
  const deck = ctx.state.decks[deckId];
  const drawn = deck?.drawn.find((d) => d.cardId === cardId);
  if (!drawn) return 'That card is not in play';
  return isGm(ctx.user) || drawn.userId === ctx.user.id || 'Not your card';
}

function removeCard(deck: Draft<Deck>, cardId: string) {
  deck.drawPile = deck.drawPile.filter((id) => id !== cardId);
  deck.drawn = deck.drawn.filter((d) => d.cardId !== cardId);
  deck.discard = deck.discard.filter((id) => id !== cardId);
}

function postCard(draft: Draft<GameState>, deck: Draft<Deck>, cardId: string, chatId: string, userId: string, ts: number) {
  const card = deck.cards[cardId];
  if (!card) return;
  pushMessage(draft.chat, {
    id: chatId,
    userId,
    ts,
    text: '',
    card: { title: card.name, subtitle: `Drawn from ${deck.name}`, text: card.text || undefined, imageUrl: card.imageUrl },
  });
}

export const deckActions = {
  create: defineAction('deck/create', z.object({ deck: DeckSchema }), {
    authorize: requireGm,
    apply(draft, { deck }) {
      if (!draft.decks[deck.id]) draft.decks[deck.id] = deck;
    },
  }),

  update: defineAction('deck/update', z.object({ id: IdSchema, changes: DeckSchema.pick({ name: true, playersCanDraw: true }).partial() }), {
    authorize: (ctx, { id }) => requireDeck(ctx, id),
    apply(draft, { id, changes }) {
      const d = draft.decks[id];
      if (d) Object.assign(d, changes);
    },
  }),

  remove: defineAction('deck/delete', z.object({ id: IdSchema }), {
    authorize: requireGm,
    apply(draft, { id }) {
      delete draft.decks[id];
    },
  }),

  /** Add cards; they go on the bottom of the draw pile. */
  addCards: defineAction('deck/addCards', z.object({ deckId: IdSchema, cards: z.array(CardSchema).min(1).max(200) }), {
    authorize(ctx, { deckId, cards }) {
      const ok = requireDeck(ctx, deckId);
      if (ok !== true) return ok;
      return ctx.state.decks[deckId]!.cardOrder.length + cards.length <= 500 || 'A deck can hold at most 500 cards';
    },
    apply(draft, { deckId, cards }) {
      const deck = draft.decks[deckId];
      if (!deck) return;
      for (const c of cards) {
        if (deck.cards[c.id]) continue;
        deck.cards[c.id] = c;
        deck.cardOrder.push(c.id);
        deck.drawPile.push(c.id);
      }
    },
  }),

  removeCard: defineAction('deck/removeCard', z.object({ deckId: IdSchema, cardId: IdSchema }), {
    authorize: (ctx, { deckId }) => requireDeck(ctx, deckId),
    apply(draft, { deckId, cardId }) {
      const deck = draft.decks[deckId];
      if (!deck) return;
      delete deck.cards[cardId];
      deck.cardOrder = deck.cardOrder.filter((id) => id !== cardId);
      removeCard(deck, cardId);
    },
  }),

  /** Gather every card back into the draw pile (in editor order; shuffle afterwards). */
  reset: defineAction('deck/reset', z.object({ deckId: IdSchema }), {
    authorize: (ctx, { deckId }) => requireDeck(ctx, deckId),
    apply(draft, { deckId }) {
      const deck = draft.decks[deckId];
      if (!deck) return;
      deck.drawPile = [...deck.cardOrder];
      deck.drawn = [];
      deck.discard = [];
    },
  }),

  /** Shuffle the draw pile. The new order is only sent to GMs. */
  shuffle: defineAction('deck/shuffle', z.object({ deckId: IdSchema, order: z.array(IdSchema).max(500).optional() }), {
    optimistic: false,
    authorize: (ctx, { deckId }) => requireDeck(ctx, deckId),
    prepare(ctx, { deckId }) {
      const order = [...ctx.state.decks[deckId]!.drawPile];
      for (let i = order.length - 1; i > 0; i--) {
        const j = ctx.random(i + 1);
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      return { deckId, order };
    },
    audience: (viewer) => isGm(viewer),
    apply(draft, { deckId, order }) {
      const deck = draft.decks[deckId];
      if (!deck || !order) return;
      const same = order.length === deck.drawPile.length && order.every((id) => deck.drawPile.includes(id));
      if (same) deck.drawPile = order;
    },
  }),

  /** Draw the top card. Face up posts it to chat; face down keeps it private to you (and the GM). */
  draw: defineAction(
    'deck/draw',
    z.object({ deckId: IdSchema, faceUp: z.boolean(), chatId: IdSchema, cardId: IdSchema.optional() }),
    {
      optimistic: false,
      authorize(ctx, { deckId }) {
        const deck = ctx.state.decks[deckId];
        if (!deck) return 'Deck not found';
        if (!isGm(ctx.user) && !deck.playersCanDraw) return 'Only the GM can draw from that deck';
        return deck.drawPile.length > 0 || 'The deck is empty';
      },
      prepare: (ctx, payload) => ({ ...payload, cardId: ctx.state.decks[payload.deckId]!.drawPile[0] }),
      apply(draft, { deckId, faceUp, chatId, cardId }, meta) {
        const deck = draft.decks[deckId];
        if (!deck || !cardId || !deck.cards[cardId]) return;
        deck.drawPile = deck.drawPile.filter((id) => id !== cardId);
        deck.drawn.push({ cardId, userId: meta.userId, faceUp, ts: meta.ts });
        if (faceUp) postCard(draft, deck, cardId, chatId, meta.userId, meta.ts);
        else
          pushMessage(draft.chat, { id: chatId, userId: meta.userId, ts: meta.ts, text: `drew a card face down from ${deck.name}` });
      },
    },
  ),

  reveal: defineAction('deck/reveal', z.object({ deckId: IdSchema, cardId: IdSchema, chatId: IdSchema }), {
    authorize: (ctx, { deckId, cardId }) => requireDrawnBy(ctx, deckId, cardId),
    apply(draft, { deckId, cardId, chatId }, meta) {
      const deck = draft.decks[deckId];
      const drawn = deck?.drawn.find((d) => d.cardId === cardId);
      if (!deck || !drawn || drawn.faceUp) return;
      drawn.faceUp = true;
      postCard(draft, deck, cardId, chatId, meta.userId, meta.ts);
    },
  }),

  discard: defineAction('deck/discard', z.object({ deckId: IdSchema, cardId: IdSchema }), {
    authorize: (ctx, { deckId, cardId }) => requireDrawnBy(ctx, deckId, cardId),
    apply(draft, { deckId, cardId }) {
      const deck = draft.decks[deckId];
      if (!deck || !deck.drawn.some((d) => d.cardId === cardId)) return;
      deck.drawn = deck.drawn.filter((d) => d.cardId !== cardId);
      deck.discard.push(cardId);
    },
  }),
};

/** Players' copy of the draw pile is sorted so the order can't be read. */
export const redactDecks: Redactor = (draft, viewer) => {
  if (isGm(viewer)) return;
  for (const deck of Object.values(draft.decks)) {
    const sorted = [...deck.drawPile].sort();
    if (sorted.some((id, i) => id !== deck.drawPile[i])) deck.drawPile = sorted;
  }
};
