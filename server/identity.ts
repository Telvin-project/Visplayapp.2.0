/**
 * Decide how a verified Supabase Auth user may access a VisPlay account.
 * Email alone is NEVER sufficient to inherit a local account, wallet or role.
 * This module has no side effects so the security boundary can be unit-tested.
 */
export interface BoundAccount {
  email: string;
  supabase_auth_id?: string;
}

export type IdentityDecision<T> =
  | { status: 'existing'; account: T }
  | { status: 'new' }
  | { status: 'migration-required' }
  | { status: 'email-change' }
  | { status: 'conflict' };

export function resolveVerifiedIdentity<T extends BoundAccount>(
  accounts: readonly T[],
  verifiedId: string,
  verifiedEmail: string,
): IdentityDecision<T> {
  if (!verifiedId || !verifiedEmail) return { status: 'conflict' };
  const email = verifiedEmail.trim().toLowerCase();
  const bindings = accounts.filter(account => account.supabase_auth_id === verifiedId);
  if (bindings.length > 1) return { status: 'conflict' };

  const emailOwners = accounts.filter(account => account.email.trim().toLowerCase() === email);
  const bound = bindings[0];
  if (bound) {
    if (bound.email.trim().toLowerCase() !== email) return { status: 'email-change' };
    if (emailOwners.some(owner => owner !== bound)) return { status: 'conflict' };
    return { status: 'existing', account: bound };
  }

  if (emailOwners.length) return { status: 'migration-required' };
  return { status: 'new' };
}
