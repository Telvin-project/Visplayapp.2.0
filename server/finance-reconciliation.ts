import type { DatabaseSchema } from './db.js';

export interface FinanceAuditIssue { code: string; message: string; blocking: boolean }
export interface FinanceAuditReport {
  counts: { users: number; transactions: number; purchases: number; ledger: number; payouts: number };
  issues: FinanceAuditIssue[];
  readyForReviewedImport: boolean;
}

/** Read-only: never derive live entitlements or wallet credits from these legacy arrays. */
export function auditLegacyFinance(db: DatabaseSchema): FinanceAuditReport {
  const issues: FinanceAuditIssue[] = [];
  const add = (code: string, message: string, blocking = true) => issues.push({ code, message, blocking });
  const users = new Map(db.users.map(user => [user.id, user]));
  const txByRef = new Map<string, typeof db.transactions[number]>();
  for (const tx of db.transactions) {
    if (txByRef.has(tx.reference)) add('DUPLICATE_TRANSACTION_REFERENCE', 'Duplicate payment reference: ' + tx.reference);
    txByRef.set(tx.reference, tx);
    if (!users.has(tx.user_id) && !tx.user_id.startsWith('deleted_')) add('UNKNOWN_FINANCE_USER', 'Transaction has no corresponding verified account: ' + tx.id);
    if (!Number.isSafeInteger(tx.amount_ngn) || tx.amount_ngn <= 0) add('INVALID_TRANSACTION_AMOUNT', 'Invalid amount for reference: ' + tx.reference);
    if (/SEED|DEMO|TEST/i.test(tx.reference)) add('SAMPLE_PAYMENT_REFERENCE', 'Demonstration transaction needs provenance or exclusion: ' + tx.reference);
  }

  const purchases = new Map<string, typeof db.purchases[number]>();
  const purchaseReference = new Set<string>();
  for (const purchase of db.purchases) {
    if (purchases.has(purchase.id)) add('DUPLICATE_PURCHASE_ID', 'Duplicate purchase identifier: ' + purchase.id);
    purchases.set(purchase.id, purchase);
    const key = purchase.user_id + ':' + purchase.item_type + ':' + purchase.item_id;
    if (purchaseReference.has(key)) add('DUPLICATE_ENTITLEMENT', 'Same customer item appears more than once: ' + purchase.item_id);
    purchaseReference.add(key);
    const tx = txByRef.get(purchase.reference);
    if (!tx || tx.status !== 'successful' || tx.type !== 'purchase') add('UNBACKED_PURCHASE', 'Purchase has no successful matching payment reference: ' + purchase.id);
    if (tx && tx.amount_ngn !== purchase.amount_ngn) add('PURCHASE_AMOUNT_MISMATCH', 'Purchase does not match its payment amount: ' + purchase.id);
  }

  const ledgerByPurchase = new Set<string>();
  for (const entry of db.ledger) {
    if (ledgerByPurchase.has(entry.purchase_id)) add('DUPLICATE_CREATOR_EARNINGS', 'Creator ledger has duplicate purchase: ' + entry.purchase_id);
    ledgerByPurchase.add(entry.purchase_id);
    const purchase = purchases.get(entry.purchase_id);
    if (!purchase) add('UNBACKED_CREATOR_EARNINGS', 'Creator earning has no underlying purchase: ' + entry.id);
    if (purchase && purchase.amount_ngn !== entry.gross_amount_ngn) add('CREATOR_GROSS_MISMATCH', 'Ledger gross differs from purchase: ' + entry.id);
    const share = Math.round(entry.gross_amount_ngn * 0.85);
    if (entry.creator_share_ngn !== share || entry.platform_fee_ngn !== entry.gross_amount_ngn - share) {
      add('INCORRECT_CREATOR_SPLIT', 'Ledger does not follow the contractual 85/15 split: ' + entry.id);
    }
  }
  for (const purchase of db.purchases) {
    if (!ledgerByPurchase.has(purchase.id)) add('MISSING_CREATOR_LEDGER', 'A paid purchase has no revenue allocation: ' + purchase.id);
  }

  const walletExpected = new Map<string, number>();
  for (const tx of db.transactions.filter(tx => tx.status === 'successful')) {
    if (tx.type === 'deposit') walletExpected.set(tx.user_id, (walletExpected.get(tx.user_id) || 0) + tx.amount_ngn);
    else if (tx.type === 'purchase' && tx.payment_method === 'wallet') {
      walletExpected.set(tx.user_id, (walletExpected.get(tx.user_id) || 0) - tx.amount_ngn);
    }
  }
  for (const user of db.users) {
    if (!Number.isSafeInteger(user.wallet_balance) || user.wallet_balance < 0) add('INVALID_WALLET', 'Negative or noninteger wallet balance: ' + user.id);
    const expected = walletExpected.get(user.id) || 0;
    if (expected !== user.wallet_balance && (expected !== 0 || user.wallet_balance !== 0)) {
      add('UNRECONCILED_WALLET', 'Current balance differs from recorded net wallet deposits/spending: ' + user.id);
    }
    if (!user.supabase_auth_id && (user.wallet_balance > 0 || db.purchases.some(p => p.user_id === user.id))) {
      add('UNBOUND_ACCOUNT_WITH_VALUE', 'A valuable account requires documented identity binding: ' + user.id);
    }
  }
  for (const payout of db.payouts) {
    const earned = db.ledger.filter(entry => entry.creator_id === payout.creator_id && entry.status === 'paid')
      .reduce((sum, entry) => sum + entry.creator_share_ngn, 0);
    if (payout.status === 'paid' && payout.net_payout_ngn > earned) {
      add('UNBACKED_PAID_PAYOUT', 'Historical paid payout exceeds linked paid earnings: ' + payout.id);
    }
  }

  return {
    counts: { users: db.users.length, transactions: db.transactions.length, purchases: db.purchases.length,
      ledger: db.ledger.length, payouts: db.payouts.length },
    issues,
    readyForReviewedImport: !issues.some(issue => issue.blocking),
  };
}
