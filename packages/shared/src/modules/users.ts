import { z } from 'zod';
import { defineAction } from '../actions/define';
import { allowAnyone, denyClients } from '../actions/auth';
import { ColorSchema, UserNameSchema, UserSchema } from '../state';

export const userActions = {
  /** Issued by the server when someone joins. */
  upsert: defineAction('user/upsert', z.object({ user: UserSchema }), {
    authorize: denyClients,
    apply(draft, { user }) {
      draft.users[user.id] = user;
    },
  }),

  /** A user edits their own profile. */
  updateSelf: defineAction(
    'user/updateSelf',
    z.object({ name: UserNameSchema.optional(), color: ColorSchema.optional() }),
    {
      authorize: allowAnyone,
      apply(draft, changes, meta) {
        const user = draft.users[meta.userId];
        if (!user) return;
        if (changes.name !== undefined) user.name = changes.name;
        if (changes.color !== undefined) user.color = changes.color;
      },
    },
  ),
};
