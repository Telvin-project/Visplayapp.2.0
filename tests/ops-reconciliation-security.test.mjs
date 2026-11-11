import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileEvidence, ReconciliationInputError } from '../server/ops-reconciliation.ts';

const fixture = () => ({
  ledger: {
    payments: [{ reference: 'VIS_DEP_example123', amount_ngn: 100, status: 'successful', payment_method: 'paystack' }],
    payouts: [{ id: 'pay_approved123', net_payout_ngn: 85, status: 'paid' }], refund_cases: [],
  },
  provider: { payments: [{ reference: 'VIS_DEP_example123', amount_kobo: 10000, currency: 'NGN', status: 'success' }] },
  bank: { payouts: [{ payout_id: 'pay_approved123', reference: 'bank_proof123', amount_ngn: 85, status: 'success' }] },
});

test('matching independent provider and bank evidence has no detected discrepancies', () => {
  const result = reconcileEvidence(fixture());
  assert.equal(result.verdict, 'NO_DISCREPANCIES_FOUND');
  assert.equal(result.issue_count, 0);
});

test('Paystack successful charge missing a canonical transaction blocks reconciliation', () => {
  const input = fixture(); input.ledger.payments = [];
  const result = reconcileEvidence(input);
  assert.equal(result.issues.some(item => item.code === 'UNKNOWN_PROVIDER_PAYMENT'), true);
  assert.equal(result.verdict, 'BLOCKED');
});

test('a mismatched amount and a pending ledger status are both reported', () => {
  const input = fixture(); input.ledger.payments[0].amount_ngn = 120; input.ledger.payments[0].status = 'pending';
  const result = reconcileEvidence(input);
  assert.equal(result.issues.some(item => item.code === 'AMOUNT_MISMATCH'), true);
  assert.equal(result.issues.some(item => item.code === 'SETTLEMENT_MISSING'), true);
});

test('duplicated provider references are not silently collapsed', () => {
  const input = fixture(); input.provider.payments.push({ ...input.provider.payments[0] });
  assert.equal(reconcileEvidence(input).issues.some(item => item.code === 'DUPLICATE_REFERENCE'), true);
});

test('a paid creator payout requires independent successful bank evidence', () => {
  const input = fixture(); input.bank.payouts = [];
  assert.equal(reconcileEvidence(input).issues.some(item => item.code === 'PAID_PAYOUT_UNVERIFIED'), true);
});

test('multiple bank successes and bank payout amount differences block release', () => {
  const input = fixture(); input.bank.payouts[0].amount_ngn = 100;
  input.bank.payouts.push({ ...input.bank.payouts[0], reference: 'bank_other123' });
  const result = reconcileEvidence(input);
  assert.equal(result.issues.some(item => item.code === 'MULTIPLE_SUCCESSFUL_PAYOUTS'), true);
  assert.equal(result.issues.some(item => item.code === 'PAYOUT_AMOUNT_MISMATCH'), true);
});

test('provider reversal against a credited transaction is a blocker', () => {
  const input = fixture(); input.provider.payments[0].status = 'reversed';
  const result = reconcileEvidence(input);
  assert.equal(result.issues.some(item => item.code === 'REVERSED_CHARGE_STILL_CREDITED'), true);
});

test('refund-required payment with no case cannot be ignored', () => {
  const input = fixture(); input.ledger.payments[0].status = 'refund_required';
  assert.equal(reconcileEvidence(input).issues.some(item => item.code === 'REFUND_CASE_MISSING'), true);
});

test('malformed and unsafe evidence is refused instead of treated as empty', () => {
  const input = fixture(); input.provider.payments[0].amount_kobo = Number.NaN;
  assert.throws(() => reconcileEvidence(input), ReconciliationInputError);
  assert.throws(() => reconcileEvidence({ ledger: { payments: [] } }), ReconciliationInputError);
});

test('reports carry hashed identifiers rather than raw payment references', () => {
  const input = fixture(); input.ledger.payments = [];
  const serialized = JSON.stringify(reconcileEvidence(input));
  assert.equal(serialized.includes('VIS_DEP_example123'), false);
});
