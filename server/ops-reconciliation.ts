import { createHash } from 'node:crypto';

/**
 * Offline comparison of independent provider evidence against a canonical
 * finance export. Does not call any banking API or mutate a ledger.
 */
export interface LedgerPayment {
  reference: string;
  amount_ngn: number;
  status: 'pending' | 'successful' | 'failed' | 'refund_required';
  payment_method: 'paystack' | 'wallet';
}
export interface ProviderPayment {
  reference: string;
  amount_kobo: number;
  currency: string;
  status: 'success' | 'pending' | 'failed' | 'reversed' | 'refunded';
}
export interface LedgerPayout {
  id: string;
  net_payout_ngn: number;
  status: 'pending' | 'processed' | 'paid';
}
export interface BankPayout {
  payout_id: string;
  reference: string;
  amount_ngn: number;
  status: 'success' | 'pending' | 'failed' | 'reversed';
}
export interface ReconciliationEvidence {
  ledger: { payments: LedgerPayment[]; payouts: LedgerPayout[]; refund_cases: Array<{ reference: string; status: string }> };
  provider: { payments: ProviderPayment[] };
  bank: { payouts: BankPayout[] };
}
export interface ReconciliationIssue { code: string; evidence_id: string; explanation: string }
export interface ReconciliationReport {
  checked: { ledger_payments: number; provider_payments: number; ledger_payouts: number; bank_payouts: number };
  issue_count: number;
  issues: ReconciliationIssue[];
  verdict: 'BLOCKED' | 'NO_DISCREPANCIES_FOUND';
}

export class ReconciliationInputError extends Error {}
const ID = /^[A-Za-z0-9_-]{3,160}$/;
const paymentStatuses = new Set(['pending', 'successful', 'failed', 'refund_required']);
const providerStatuses = new Set(['success', 'pending', 'failed', 'reversed', 'refunded']);
const payoutStatuses = new Set(['pending', 'processed', 'paid']);
const bankStatuses = new Set(['success', 'pending', 'failed', 'reversed']);
function hashId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
function assertRows(rows: unknown, label: string): asserts rows is Array<Record<string, any>> {
  if (!Array.isArray(rows) || rows.length > 50_000 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new ReconciliationInputError(`${label} must be an array of up to 50,000 records.`);
  }
}
function validMoney(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) > 0; }
function validId(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }

export function reconcileEvidence(input: ReconciliationEvidence): ReconciliationReport {
  if (!input || typeof input !== 'object' || !input.ledger || !input.provider || !input.bank) {
    throw new ReconciliationInputError('Provide ledger, provider and bank evidence objects.');
  }
  const { ledger, provider, bank } = input;
  assertRows(ledger.payments, 'Canonical payment records');
  assertRows(provider.payments, 'Paystack payment evidence');
  assertRows(ledger.payouts, 'Creator payout records');
  assertRows(bank.payouts, 'Independent bank payout evidence');
  assertRows(ledger.refund_cases, 'Refund case records');
  const issues: ReconciliationIssue[] = [];
  const add = (code: string, reference: string, explanation: string) => issues.push({ code, evidence_id: hashId(reference), explanation });
  const unique = <T extends Record<string, any>>(rows: T[], key: keyof T, label: string): Map<string, T> => {
    const byId = new Map<string, T>();
    for (const row of rows) {
      const ref = row[key];
      if (!validId(ref)) throw new ReconciliationInputError(`${label} has an invalid reference.`);
      if (byId.has(ref)) add('DUPLICATE_REFERENCE', ref, `${label} contains a repeated reference.`);
      else byId.set(ref, row);
    }
    return byId;
  };
  const canonical = unique(ledger.payments, 'reference', 'Canonical payments');
  const external = unique(provider.payments, 'reference', 'Paystack evidence');
  const refundCases = unique(ledger.refund_cases, 'reference', 'Refund cases');
  const payouts = unique(ledger.payouts, 'id', 'Creator payouts');
  const bankRecords = new Map<string, BankPayout[]>();
  const bankRefs = new Set<string>();
  for (const row of bank.payouts) {
    if (!validId(row.payout_id) || !validId(row.reference) || !validMoney(row.amount_ngn) || !bankStatuses.has(row.status)) {
      throw new ReconciliationInputError('Bank payout evidence has invalid fields.');
    }
    if (bankRefs.has(row.reference)) add('BANK_REFERENCE_DUPLICATE', row.reference, 'Independent payout reference is repeated.');
    bankRefs.add(row.reference);
    bankRecords.set(row.payout_id, [...(bankRecords.get(row.payout_id) || []), row]);
  }

  for (const row of ledger.payments) {
    if (!validMoney(row.amount_ngn) || !paymentStatuses.has(row.status) ||
      !['paystack', 'wallet'].includes(row.payment_method)) {
      throw new ReconciliationInputError('Canonical payment evidence has invalid fields.');
    }
    if (row.payment_method === 'wallet') continue;
    const verified = external.get(row.reference);
    if (!verified) {
      if (row.status === 'successful' || row.status === 'refund_required')
        add('PAID_WITHOUT_PAYSTACK_EVIDENCE', row.reference, 'A paid canonical entry lacks independent provider proof.');
      continue;
    }
    if (verified.currency !== 'NGN') add('CURRENCY_MISMATCH', row.reference, 'Provider currency is not NGN.');
    if (verified.amount_kobo !== row.amount_ngn * 100) {
      add('AMOUNT_MISMATCH', row.reference, 'Provider amount does not match the canonical NGN-to-kobo conversion.');
    }
    if (verified.status === 'success' && row.status !== 'successful' && row.status !== 'refund_required') {
      add('SETTLEMENT_MISSING', row.reference, 'Provider reports a successful charge but canonical settlement is not complete.');
    }
    if (row.status === 'successful' && verified.status !== 'success') {
      add('PROVIDER_DISAGREES', row.reference, 'Canonical successful charge conflicts with provider status.');
    }
    if (row.status === 'refund_required' && !refundCases.has(row.reference)) {
      add('REFUND_CASE_MISSING', row.reference, 'Refund-required payment has no case.');
    }
    if (['refunded', 'reversed'].includes(verified.status) && row.status === 'successful') {
      add('REVERSED_CHARGE_STILL_CREDITED', row.reference, 'Independent provider refund or reversal needs an approved compensating ledger event.');
    }
  }
  for (const row of provider.payments) {
    if (!validMoney(row.amount_kobo) || typeof row.currency !== 'string' || !providerStatuses.has(row.status)) {
      throw new ReconciliationInputError('Paystack evidence has invalid payment fields.');
    }
    if (row.status === 'success' && !canonical.has(row.reference)) {
      add('UNKNOWN_PROVIDER_PAYMENT', row.reference, 'Successful provider charge has no corresponding canonical payment reference.');
    }
  }
  for (const row of ledger.payouts) {
    if (!validMoney(row.net_payout_ngn) || !payoutStatuses.has(row.status)) {
      throw new ReconciliationInputError('Creator payout evidence has invalid fields.');
    }
    const matching = bankRecords.get(row.id) || [];
    const successes = matching.filter(item => item.status === 'success');
    if (row.status === 'paid' && successes.length !== 1) {
      add('PAID_PAYOUT_UNVERIFIED', row.id, 'Paid creator payout requires exactly one independent successful bank receipt.');
    }
    if (successes.length > 1) add('MULTIPLE_SUCCESSFUL_PAYOUTS', row.id, 'Multiple bank successes reference the same creator payout.');
    if (successes.some(item => item.amount_ngn !== row.net_payout_ngn)) {
      add('PAYOUT_AMOUNT_MISMATCH', row.id, 'Bank payout differs from the reserved creator payable amount.');
    }
    if (successes.length === 1 && row.status !== 'paid') {
      add('BANK_PAID_LEDGER_NOT_FINAL', row.id, 'Bank reports success, but canonical payout is not marked paid.');
    }
    if (matching.some(item => item.status === 'reversed') && row.status === 'paid') {
      add('PAID_PAYOUT_REVERSED', row.id, 'Bank reversed an apparently completed payout; investigate and post a compensating event.');
    }
  }
  for (const row of bank.payouts) if (!payouts.has(row.payout_id)) {
    add('UNKNOWN_BANK_PAYOUT', row.reference, 'Bank payout has no canonical creator payout request.');
  }
  return { checked: {
    ledger_payments: ledger.payments.length, provider_payments: provider.payments.length,
    ledger_payouts: ledger.payouts.length, bank_payouts: bank.payouts.length,
  }, issue_count: issues.length, issues, verdict: issues.length ? 'BLOCKED' : 'NO_DISCREPANCIES_FOUND' };
}
