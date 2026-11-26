/** Saved rolls ("macros"): named dice formulas each user keeps for one-click rolling. */
import { z } from 'zod';
import { defineAction, type AuthContext, type AuthResult } from '../actions/define';
import { isGm } from '../actions/auth';
import { DiceError, parseDice } from '../dice';
import { IdSchema, MacroSchema } from '../state';

export const MAX_MACROS_PER_USER = 50;

function validFormula(formula: string | undefined): AuthResult {
  if (formula === undefined) return true;
  try {
    parseDice(formula);
    return true;
  } catch (e) {
    return e instanceof DiceError ? `Formula: ${e.message}` : 'Invalid formula';
  }
}

function requireOwn(ctx: AuthContext, id: string): AuthResult {
  const m = ctx.state.macros[id];
  if (!m) return 'Saved roll not found';
  return isGm(ctx.user) || m.ownerId === ctx.user.id || 'Not your saved roll';
}

export const macroActions = {
  create: defineAction('macro/create', z.object({ macro: MacroSchema }), {
    authorize(ctx, { macro }) {
      if (macro.ownerId !== ctx.user.id && !isGm(ctx.user)) return 'You can only add your own saved rolls';
      const count = Object.values(ctx.state.macros).filter((m) => m.ownerId === macro.ownerId).length;
      if (count >= MAX_MACROS_PER_USER) return `At most ${MAX_MACROS_PER_USER} saved rolls`;
      return validFormula(macro.formula);
    },
    apply(draft, { macro }) {
      if (!draft.macros[macro.id]) draft.macros[macro.id] = macro;
    },
  }),

  update: defineAction('macro/update', z.object({ id: IdSchema, changes: MacroSchema.pick({ name: true, formula: true }).partial() }), {
    authorize(ctx, { id, changes }) {
      const own = requireOwn(ctx, id);
      return own === true ? validFormula(changes.formula) : own;
    },
    apply(draft, { id, changes }) {
      const m = draft.macros[id];
      if (m) Object.assign(m, changes);
    },
  }),

  remove: defineAction('macro/delete', z.object({ id: IdSchema }), {
    authorize: (ctx, { id }) => requireOwn(ctx, id),
    apply(draft, { id }) {
      delete draft.macros[id];
    },
  }),
};
