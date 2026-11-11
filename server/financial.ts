import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CreatorLedger, CreatorPayout, Purchase, WalletTransaction } from './db.js';

type FinancialResult = Record<string, unknown>;

export class FinanceUnavailableError extends Error {
  constructor(message = 'Financial services are unavailable until the reconciled ledger is activated.') {
    super(message);
    this.name = 'FinanceUnavailableError';
  }
}

const USER_ERRORS: Record<string, { status: number; message: string }> = {
  FINANCE_INSUFFICIENT_BALANCE: { status: 402, message: 'Insufficient wallet balance.' },
  FINANCE_UNKNOWN_REFERENCE: { status: 404, message: 'Payment reference not found.' },
  FINANCE_PROVIDER_MISMATCH: { status: 400, message: 'Payment provider details do not match the original order.' },
  FINANCE_PAYMENT_NOT_PENDING: { status: 409, message: 'Payment is not eligible for settlement.' },
  FINANCE_PAYOUT_PENDING: { status: 409, message: 'This creator already has a pending payout.' },
  FINANCE_NO_EARNINGS: { status: 400, message: 'This creator has no unreserved earnings.' },
  FINANCE_WALLET_NOT_ZERO: { status: 409, message: 'Settle or refund the wallet balance before deleting your account.' },
  FINANCE_INVALID_AMOUNT: { status: 400, message: 'Invalid payment amount.' },
  FINANCE_BAD_INTENT: { status: 400, message: 'Invalid payment request.' },
  FINANCE_BAD_PURCHASE: { status: 400, message: 'Invalid purchase.' },
  FINANCE_BAD_PAYOUT: { status: 400, message: 'Invalid payout period.' },
  FINANCE_NOT_APPROVED: { status: 503, message: 'Financial operations are paused pending reconciliation approval.' },
  FINANCE_RATE_LIMIT: { status: 429, message: 'Too many checkout attempts. Please try again later.' },
};

export function financeErrorResponse(error: unknown): { status: number; message: string } {
  if (error instanceof FinanceUnavailableError) return { status: 503, message: error.message };
  const message = error instanceof Error ? error.message : '';
  const code = Object.keys(USER_ERRORS).find(value => message.includes(value));
  return code ? USER_ERRORS[code] : { status: 503, message: 'Unable to safely complete the financial operation. Please retry or contact support.' };
}

export function safeNaira(value: unknown): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0) throw new FinanceUnavailableError('Invalid amount returned by financial storage.');
  return converted;
}

/** Only the backend may use this client; anon and authenticated have no access to the tables/RPC. */
export class FinanceStore {
  private readonly client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!client && (!url || !key)) throw new FinanceUnavailableError();
    this.client = client || createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async assertReady(): Promise<void> {
    const { data, error } = await this.client.from('visplay_finance_control')
      .select('migration_approved,approval_reference').eq('id', 'main').maybeSingle();
    if (error || data?.migration_approved !== true || !data?.approval_reference) {
      throw new FinanceUnavailableError('Reconciled financial schema is not approved; no purchases or deposits may be processed.');
    }
  }

  private async rpc(name: string, params: FinancialResult): Promise<FinancialResult> {
    const { data, error } = await this.client.rpc(name, params);
    if (error) {
      // Preserve only known error codes; never disclose schema internals to API clients.
      const code = Object.keys(USER_ERRORS).find(value => error.message.includes(value));
      if (code) throw new Error(code);
      throw new FinanceUnavailableError();
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new FinanceUnavailableError();
    return data as FinancialResult;
  }

  async createIntent(params: { userId: string; reference: string; kind: 'wallet_deposit' | 'movie_purchase'; amount: number; itemId?: string; creatorId?: string; bundleId?: string }) {
    await this.rpc('visplay_finance_create_intent', {
      p_user_id: params.userId, p_reference: params.reference, p_intent_kind: params.kind,
      p_amount_ngn: params.amount, p_item_id: params.itemId || null,
      p_creator_id: params.creatorId || null, p_bundle_id: params.bundleId || null,
    });
  }

  async getIntent(reference: string, userId?: string): Promise<WalletTransaction | null> {
    let query = this.client.from('visplay_finance_transactions').select('*').eq('reference', reference);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new FinanceUnavailableError();
    return data ? this.mapTransaction(data) : null;
  }

  async settlePaystack(params: { reference: string; amountKobo: number; currency: string; status: string; purpose: string; userId: string; itemId?: string }): Promise<FinancialResult> {
    return this.rpc('visplay_finance_settle_paystack', {
      p_reference: params.reference, p_paystack_amount_kobo: params.amountKobo,
      p_currency: params.currency, p_status: params.status,
      p_purpose: params.purpose, p_user_id: params.userId, p_item_id: params.itemId || null,
    });
  }

  async buyWallet(params: { userId: string; itemType: 'movie' | 'bundle'; itemId: string; creatorId: string; bundleId?: string; amount: number; reference: string }): Promise<FinancialResult> {
    return this.rpc('visplay_finance_buy_wallet', {
      p_user_id: params.userId, p_item_type: params.itemType, p_item_id: params.itemId,
      p_creator_id: params.creatorId, p_bundle_id: params.bundleId || null,
      p_amount_ngn: params.amount, p_reference: params.reference,
    });
  }

  async getBalance(userId: string): Promise<number> {
    const { data, error } = await this.client.from('visplay_finance_wallets')
      .select('balance_ngn').eq('user_id', userId).maybeSingle();
    if (error) throw new FinanceUnavailableError();
    return safeNaira(data?.balance_ngn ?? 0);
  }

  async getBalances(userIds: string[]): Promise<Map<string, number>> {
    const balances = new Map<string, number>();
    if (!userIds.length) return balances;
    for (let start = 0; start < userIds.length; start += 100) {
      const { data, error } = await this.client.from('visplay_finance_wallets').select('user_id,balance_ngn').in('user_id', userIds.slice(start, start + 100));
      if (error) throw new FinanceUnavailableError();
      for (const row of data || []) balances.set(row.user_id, safeNaira(row.balance_ngn));
    }
    return balances;
  }

  private async allRows<T>(table: string, filters: Record<string, string> = {}, orderBy = 'created_at'): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; ; offset += 500) {
      let query = this.client.from(table).select('*');
      for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
      const { data, error } = await query.order(orderBy, { ascending: false }).range(offset, offset + 499);
      if (error) throw new FinanceUnavailableError();
      rows.push(...((data || []) as T[]));
      if (!data || data.length < 500) return rows;
    }
  }

  async purchases(userId: string): Promise<Purchase[]> {
    return this.allRows<Purchase>('visplay_finance_purchases', { user_id: userId });
  }

  async hasPurchasedItem(itemType: 'movie' | 'bundle', itemId: string): Promise<boolean> {
    const { data, error } = await this.client.from('visplay_finance_purchases')
      .select('id').eq('item_type', itemType).eq('item_id', itemId).limit(1);
    if (error) throw new FinanceUnavailableError();
    return Boolean(data?.length);
  }

  async adminMetrics(): Promise<{ gross_sales_ngn: number; creator_share_ngn: number; platform_revenue_ngn: number; wallet_deposits_ngn: number; total_paid_unlocks: number }> {
    const raw = await this.rpc('visplay_finance_admin_metrics', {});
    return {
      gross_sales_ngn: safeNaira(raw.gross_sales_ngn),
      creator_share_ngn: safeNaira(raw.creator_share_ngn),
      platform_revenue_ngn: safeNaira(raw.platform_revenue_ngn),
      wallet_deposits_ngn: safeNaira(raw.wallet_deposits_ngn),
      total_paid_unlocks: safeNaira(raw.total_paid_unlocks),
    };
  }

  async transactions(userId: string): Promise<WalletTransaction[]> {
    const rows = await this.allRows<Record<string, unknown>>('visplay_finance_transactions', { user_id: userId });
    return rows.map(row => this.mapTransaction(row));
  }

  async creatorLedger(creatorId: string): Promise<CreatorLedger[]> {
    const { data, error } = await this.client.from('visplay_finance_creator_ledger').select('*')
      .eq('creator_id', creatorId).order('created_at', { ascending: false }).limit(50);
    if (error) throw new FinanceUnavailableError();
    return (data || []) as CreatorLedger[];
  }

  async creatorPayouts(creatorId: string): Promise<CreatorPayout[]> {
    const { data, error } = await this.client.from('visplay_finance_payouts').select('*')
      .eq('creator_id', creatorId).order('created_at', { ascending: false }).limit(100);
    if (error) throw new FinanceUnavailableError();
    return (data || []) as CreatorPayout[];
  }

  async creatorSummary(creatorId: string): Promise<{ total_earnings_ngn: number; pending_payout_ngn: number; total_paid_out_ngn: number; total_paid_unlocks: number }> {
    const raw = await this.rpc('visplay_finance_creator_summary', { p_creator_id: creatorId });
    return {
      total_earnings_ngn: safeNaira(raw.total_earnings_ngn),
      pending_payout_ngn: safeNaira(raw.pending_payout_ngn),
      total_paid_out_ngn: safeNaira(raw.total_paid_out_ngn),
      total_paid_unlocks: safeNaira(raw.total_paid_unlocks),
    };
  }

  async reservePayout(creatorId: string, monthPeriod: string, adminId: string): Promise<CreatorPayout> {
    return this.rpc('visplay_finance_reserve_payout', {
      p_creator_id: creatorId, p_month_period: monthPeriod, p_admin_id: adminId,
    }) as unknown as CreatorPayout;
  }

  async anonymize(userId: string, deletedId: string, creatorId?: string): Promise<void> {
    await this.rpc('visplay_finance_anonymize_user', {
      p_user_id: userId, p_deleted_id: deletedId, p_creator_id: creatorId || null,
    });
  }

  async adminTransactions(): Promise<WalletTransaction[]> {
    const { data, error } = await this.client.from('visplay_finance_transactions')
      .select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw new FinanceUnavailableError();
    return (data || []).map(row => this.mapTransaction(row));
  }

  async adminLedger(): Promise<CreatorLedger[]> {
    const { data, error } = await this.client.from('visplay_finance_creator_ledger')
      .select('*').order('created_at', { ascending: false }).limit(50);
    if (error) throw new FinanceUnavailableError();
    return (data || []) as CreatorLedger[];
  }

  async movieSales(): Promise<Record<string, { gross_sales_ngn: number; creator_share_ngn: number; platform_fee_ngn: number }>> {
    const raw = await this.rpc('visplay_finance_movie_sales', {});
    const result: Record<string, { gross_sales_ngn: number; creator_share_ngn: number; platform_fee_ngn: number }> = {};
    for (const [movieId, totals] of Object.entries(raw)) {
      if (!totals || typeof totals !== 'object' || Array.isArray(totals)) throw new FinanceUnavailableError();
      const values = totals as Record<string, unknown>;
      result[movieId] = { gross_sales_ngn: safeNaira(values.gross_sales_ngn),
        creator_share_ngn: safeNaira(values.creator_share_ngn), platform_fee_ngn: safeNaira(values.platform_fee_ngn) };
    }
    return result;
  }

  async adminPayouts(): Promise<CreatorPayout[]> {
    const { data, error } = await this.client.from('visplay_finance_payouts')
      .select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw new FinanceUnavailableError();
    return (data || []) as CreatorPayout[];
  }

  async refundCases(): Promise<Array<{ reference: string; reason: string; status: string; created_at: string }>> {
    const { data, error } = await this.client.from('visplay_finance_refund_cases')
      .select('*').neq('status', 'refunded').order('created_at', { ascending: false }).limit(200);
    if (error) throw new FinanceUnavailableError();
    return data || [];
  }

  private mapTransaction(row: Record<string, any>): WalletTransaction {
    return {
      id: String(row.id), reference: String(row.reference), user_id: String(row.user_id),
      amount_ngn: safeNaira(row.amount_ngn), type: row.intent_kind === 'wallet_deposit' ? 'deposit' : 'purchase',
      status: row.status, payment_method: row.payment_method,
      description: row.description || (row.intent_kind === 'wallet_deposit' ? 'Wallet funding' : 'Purchase'),
      metadata: { purpose: row.intent_kind, movie_id: row.item_type === 'movie' ? row.item_id : undefined },
      created_at: String(row.created_at),
    };
  }
}

let store: FinanceStore | undefined;
export function getFinanceStore(): FinanceStore {
  return store ||= new FinanceStore();
}
