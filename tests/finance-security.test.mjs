import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FinanceStore, FinanceUnavailableError, financeErrorResponse, safeNaira } from '../server/financial.ts';
import { PaystackGatewayError, PaystackNotConfirmedError, initializePaystack, verifyPaystackCharge, verifyPaystackSignature } from '../server/paystack.ts';
import { auditLegacyFinance } from '../server/finance-reconciliation.ts';

const testReference = 'VIS_DEP_20261107_12345678';

test('signed Paystack webhook accepts original raw bytes only', () => {
  const secret = 'sk_test_hmac_test_key';
  const raw = Buffer.from('{"event":"charge.success","data":{"reference":"test"}}');
  const signature = createHmac('sha512', secret).update(raw).digest('hex');
  assert.equal(verifyPaystackSignature(raw, signature, secret), true);
  assert.equal(verifyPaystackSignature(Buffer.from(raw.toString() + ' '), signature, secret), false);
  assert.equal(verifyPaystackSignature(raw, signature.toUpperCase(), secret), true);
  assert.equal(verifyPaystackSignature(raw, signature, secret + 'invalid'), false);
  assert.equal(verifyPaystackSignature(raw, 'abcdef', secret), false);
  assert.equal(verifyPaystackSignature(raw, undefined, secret), false);
});

test('Paystack verification requires provider-approved amount, reference and metadata', async () => {
  const oldFetch = globalThis.fetch;
  const oldSecret = process.env.PAYSTACK_SECRET_KEY;
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      status: true, data: { reference: testReference, status: 'success', amount: 10100,
        currency: 'NGN', metadata: { user_id: 'usr_verified', purpose: 'wallet_deposit' } },
    }), { status: 200 });
    assert.deepEqual(await verifyPaystackCharge(testReference), {
      reference: testReference, amountKobo: 10100, currency: 'NGN', status: 'success',
      purpose: 'wallet_deposit', userId: 'usr_verified', itemId: undefined,
    });

    globalThis.fetch = async () => new Response(JSON.stringify({ status: true, data: {
      reference: testReference, status: 'success', amount: 10100, currency: 'NGN', metadata: {},
    } }), { status: 200 });
    await assert.rejects(verifyPaystackCharge(testReference), PaystackGatewayError);
    globalThis.fetch = async () => new Response(JSON.stringify({ status: true, data: {
      reference: testReference, status: 'pending', amount: 10100,
    } }), { status: 200 });
    await assert.rejects(verifyPaystackCharge(testReference), PaystackNotConfirmedError);
    await assert.rejects(verifyPaystackCharge('../unauthorized'), PaystackGatewayError);
  } finally { globalThis.fetch = oldFetch; process.env.PAYSTACK_SECRET_KEY = oldSecret; }
});

test('Paystack initialize rejects untrusted payment URLs and non-HTTPS redirects', async () => {
  const oldFetch = globalThis.fetch;
  const oldSecret = process.env.PAYSTACK_SECRET_KEY;
  const oldCallback = process.env.PAYSTACK_CALLBACK_URL;
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
  process.env.PAYSTACK_CALLBACK_URL = 'https://visplay.example/';
  const args = { email: 'test@visplay.example', userId: 'usr_test', reference: testReference,
    amountNgn: 100, purpose: 'wallet_deposit' };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ status: true,
      data: { authorization_url: 'https://attacker.example/card-harvest' } }), { status: 200 });
    await assert.rejects(initializePaystack(args), PaystackGatewayError);
    process.env.PAYSTACK_CALLBACK_URL = 'http://example.com/';
    await assert.rejects(initializePaystack(args), PaystackGatewayError);
    process.env.PAYSTACK_CALLBACK_URL = 'https://visplay.example/';
    await assert.rejects(initializePaystack({ ...args, amountNgn: Number.MAX_SAFE_INTEGER }), PaystackGatewayError);
  } finally {
    globalThis.fetch = oldFetch;
    process.env.PAYSTACK_SECRET_KEY = oldSecret;
    process.env.PAYSTACK_CALLBACK_URL = oldCallback;
  }
});

function fakeClient({ approved = true, balance = 250 } = {}) {
  const calls = [];
  const obj = {
    from(table) {
      calls.push({ table });
      const query = {
        select() { return query; }, eq() { return query; }, order() { return query; }, range() { return query; }, in() { return query; }, limit() { return query; },
        maybeSingle: async () => table === 'visplay_finance_control'
          ? { data: { migration_approved: approved, approval_reference: approved ? 'FIN-APPROVED' : null }, error: null }
          : { data: { balance_ngn: balance }, error: null },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
      return query;
    },
    rpc: async (name, params) => {
      calls.push({ name, params });
      return { data: { already_owned: false, wallet_balance: 150 }, error: null };
    },
  };
  return { obj, calls };
}

test('financial activation requires explicit reconciliation approval', async () => {
  await assert.rejects(new FinanceStore(fakeClient({ approved: false }).obj).assertReady(), FinanceUnavailableError);
  await new FinanceStore(fakeClient({ approved: true }).obj).assertReady();
});

test('financial actions forward only server-chosen amounts and provider facts to database RPC', async () => {
  const fake = fakeClient();
  const store = new FinanceStore(fake.obj);
  const request = { userId: 'usr_1', itemType: 'movie', itemId: 'mov_1', creatorId: 'creator_1',
    amount: 100, reference: 'VIS_PUR_MOV_100000_abcdefghi' };
  await store.buyWallet(request);
  const call = fake.calls.find(c => c.name === 'visplay_finance_buy_wallet');
  assert.equal(call.params.p_amount_ngn, 100);
  assert.equal(call.params.p_user_id, 'usr_1');
  const verified = { reference: testReference, amountKobo: 10000, currency: 'NGN', status: 'success',
    purpose: 'wallet_deposit', userId: 'usr_1' };
  await store.settlePaystack(verified);
  const settle = fake.calls.find(c => c.name === 'visplay_finance_settle_paystack');
  assert.equal(settle.params.p_paystack_amount_kobo, 10000);
  assert.equal(settle.params.p_user_id, 'usr_1');
  assert.equal(await store.getBalance('usr_1'), 250);
  assert.deepEqual(financeErrorResponse(new Error('FINANCE_INSUFFICIENT_BALANCE')), {
    status: 402, message: 'Insufficient wallet balance.',
  });
  assert.throws(() => safeNaira(Number.MAX_SAFE_INTEGER + 1), FinanceUnavailableError);
});

test('database migration includes atomic wallet locking, unique refs and protected RPC execution', () => {
  const sql = readFileSync('migrations/20261107_visplay_financial_core.sql', 'utf8');
  for (const pattern of [/for update/i, /unique\s*\(user_id,item_type,item_id\)/i,
    /reference text not null unique/i, /visplay_finance_wallet_entries/i,
    /on conflict \(user_id,item_type,item_id\) do nothing/i,
    /revoke all on function public/i, /to service_role/i,
    /migration_approved boolean not null default false/i,
    /FINANCE_PROVIDER_MISMATCH/i, /visplay_finance_refund_cases/i]) {
    assert.match(sql, pattern);
  }
});

test('legacy audit blocks demonstration money and unbacked creator payouts', () => {
  const fake = {
    users: [{ id: 'u1', wallet_balance: 0 }], transactions: [{
      id: 'tx1', user_id: 'u1', reference: 'VIS_DEP_SEED_FAKE', amount_ngn: 100,
      status: 'successful', type: 'deposit', payment_method: 'paystack',
    }], purchases: [], ledger: [], payouts: [{
      id: 'pay1', creator_id: 'c1', status: 'paid', net_payout_ngn: 100,
    }],
  };
  const audit = auditLegacyFinance(fake);
  assert.equal(audit.readyForReviewedImport, false);
  assert(audit.issues.some(issue => issue.code === 'UNRECONCILED_WALLET'));
  assert(audit.issues.some(issue => issue.code === 'SAMPLE_PAYMENT_REFERENCE'));
  assert(audit.issues.some(issue => issue.code === 'UNBACKED_PAID_PAYOUT'));
});
