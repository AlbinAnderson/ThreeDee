import type { Token, User } from '../state';
import type { AuthContext, AuthResult } from './define';

export const isGm = (user: User) => user.role === 'gm';

export const requireGm = (ctx: AuthContext): AuthResult => isGm(ctx.user) || 'Only the GM can do that';

export const allowAnyone = (): AuthResult => true;

export const denyClients = (): AuthResult => 'This action can only be performed by the server';

export function canControlToken(user: User, token: Token): boolean {
  return isGm(user) || token.ownerIds.includes(user.id);
}
