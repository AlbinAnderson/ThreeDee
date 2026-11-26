/**
 * Jukebox. The GM uploads tracks and plays/stops them for everyone. Playback
 * is synced by the server timestamp the track started at; clients seek to
 * (now - startedAt). Several tracks can play at once (music + ambience).
 */
import { z } from 'zod';
import { defineAction } from '../actions/define';
import { requireGm } from '../actions/auth';
import { AudioTrackSchema, IdSchema } from '../state';

const exists = (id: string) => (ctx: { state: { audio: Record<string, unknown> } }) => !!ctx.state.audio[id] || 'Track not found';

export const audioActions = {
  add: defineAction('audio/add', z.object({ track: AudioTrackSchema }), {
    authorize: requireGm,
    apply(draft, { track }) {
      if (!draft.audio[track.id]) draft.audio[track.id] = { ...track, startedAt: null };
    },
  }),

  update: defineAction(
    'audio/update',
    z.object({ id: IdSchema, changes: AudioTrackSchema.pick({ name: true, volume: true, loop: true }).partial() }),
    {
      authorize: (ctx, { id }) => (requireGm(ctx) === true ? exists(id)(ctx) : requireGm(ctx)),
      apply(draft, { id, changes }) {
        const t = draft.audio[id];
        if (t) Object.assign(t, changes);
      },
    },
  ),

  play: defineAction('audio/play', z.object({ id: IdSchema }), {
    authorize: (ctx, { id }) => (requireGm(ctx) === true ? exists(id)(ctx) : requireGm(ctx)),
    apply(draft, { id }, meta) {
      const t = draft.audio[id];
      if (t) t.startedAt = meta.ts;
    },
  }),

  stop: defineAction('audio/stop', z.object({ id: IdSchema.optional() }), {
    authorize: requireGm,
    apply(draft, { id }) {
      for (const t of Object.values(draft.audio)) if (!id || t.id === id) t.startedAt = null;
    },
  }),

  remove: defineAction('audio/delete', z.object({ id: IdSchema }), {
    authorize: requireGm,
    apply(draft, { id }) {
      delete draft.audio[id];
    },
  }),
};
