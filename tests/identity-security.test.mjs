import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVerifiedIdentity } from '../server/identity.ts';

const admin = {
  id: 'legacy-admin', email: 'admin@visplay.example', role: 'admin', wallet_balance: 1000,
};
const creator = {
  id: 'legacy-creator', email: 'creator@visplay.example', role: 'creator', wallet_balance: 500,
};

test('new verified email creates an ordinary new identity, not a legacy link', () => {
  assert.deepEqual(resolveVerifiedIdentity([admin, creator], 'supabase-new', 'new@example.com'), { status: 'new' });
});

test('verified ownership of a seeded admin email does not grant admin access', () => {
  assert.deepEqual(resolveVerifiedIdentity([admin], 'attacker-auth-id', 'ADMIN@VISPLAY.EXAMPLE'), { status: 'migration-required' });
});

test('verified ownership of a pre-claimed creator email does not grant wallet or creator rights', () => {
  assert.deepEqual(resolveVerifiedIdentity([creator], 'attacker-auth-id', 'creator@visplay.example'), { status: 'migration-required' });
});

test('a previously verified and explicitly bound identity can resume its own account', () => {
  const migrated = { ...creator, supabase_auth_id: 'verified-supabase-id' };
  assert.deepEqual(resolveVerifiedIdentity([migrated], 'verified-supabase-id', 'creator@visplay.example'), {
    status: 'existing', account: migrated,
  });
});

test('a different provider identity cannot inherit an existing binding by email', () => {
  const migrated = { ...creator, supabase_auth_id: 'verified-supabase-id' };
  assert.deepEqual(resolveVerifiedIdentity([migrated], 'other-auth-id', 'creator@visplay.example'), { status: 'migration-required' });
});

test('a provider-side email change requires controlled migration', () => {
  const migrated = { ...creator, supabase_auth_id: 'verified-supabase-id' };
  assert.deepEqual(resolveVerifiedIdentity([migrated], 'verified-supabase-id', 'new-email@example.com'), { status: 'email-change' });
});

test('duplicate bindings and duplicate emails fail closed', () => {
  const a = { ...admin, supabase_auth_id: 'same-id' };
  const b = { ...creator, supabase_auth_id: 'same-id' };
  assert.deepEqual(resolveVerifiedIdentity([a, b], 'same-id', 'admin@visplay.example'), { status: 'conflict' });
  const duplicate = { ...creator, email: a.email };
  assert.deepEqual(resolveVerifiedIdentity([a, duplicate], 'same-id', a.email), { status: 'conflict' });
});

test('missing verified identity material fails closed', () => {
  assert.deepEqual(resolveVerifiedIdentity([], '', 'a@example.com'), { status: 'conflict' });
  assert.deepEqual(resolveVerifiedIdentity([], 'uuid', ''), { status: 'conflict' });
});
