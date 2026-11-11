import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PaystackCharge {
  reference: string;
  amountKobo: number;
  currency: string;
  status: string;
  purpose: string;
  userId: string;
  itemId?: string;
}

export class PaystackNotConfirmedError extends Error {}
export class PaystackGatewayError extends Error {}

function requireSecret(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !/^sk_(test|live)_/.test(key)) throw new PaystackGatewayError('Secure Paystack credentials are not configured.');
  return key;
}

export function verifyPaystackSignature(raw: Buffer, signature: unknown, secret: string): boolean {
  if (!Buffer.isBuffer(raw) || typeof signature !== 'string' || !/^[a-fA-F0-9]{128}$/.test(signature)) return false;
  const expected = createHmac('sha512', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

function checkoutCallback(extra?: Record<string, string>): string {
  const callback = process.env.PAYSTACK_CALLBACK_URL;
  if (!callback) throw new PaystackGatewayError('A VisPlay checkout callback URL must be configured.');
  let url: URL;
  try { url = new URL(callback); } catch { throw new PaystackGatewayError('Invalid checkout callback URL.'); }
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) {
    throw new PaystackGatewayError('Paystack callback must use HTTPS.');
  }
  for (const [key, value] of Object.entries(extra || {})) url.searchParams.set(key, value);
  return url.toString();
}

export async function initializePaystack(args: {
  email: string; reference: string; amountNgn: number; userId: string;
  purpose: 'wallet_deposit' | 'movie_purchase'; movieId?: string; title?: string;
}): Promise<string> {
  const secret = requireSecret();
  if (!Number.isSafeInteger(args.amountNgn) || args.amountNgn <= 0 || args.amountNgn > 1000000) {
    throw new PaystackGatewayError('Invalid amount.');
  }
  const callback = checkoutCallback(args.movieId ? { watch: args.movieId } : {});
  let response: Response;
  try {
    response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: args.email, amount: args.amountNgn * 100, currency: 'NGN',
        reference: args.reference, callback_url: callback,
        metadata: { user_id: args.userId, purpose: args.purpose,
          ...(args.movieId ? { movie_id: args.movieId, movie_title: args.title || '' } : {}) },
      }),
      signal: AbortSignal.timeout(12000),
    });
  } catch { throw new PaystackGatewayError('Secure checkout could not be reached.'); }
  const result = await response.json().catch(() => ({})) as any;
  if (!response.ok || result.status !== true || typeof result.data?.authorization_url !== 'string') {
    throw new PaystackGatewayError('Secure checkout could not be started.');
  }
  const authorization = new URL(result.data.authorization_url);
  if (authorization.protocol !== 'https:' || !/(^|\.)paystack\.com$/.test(authorization.hostname)) {
    throw new PaystackGatewayError('Payment provider returned an untrusted checkout URL.');
  }
  return authorization.toString();
}

/** Verify provider state server-side. Never settle from callback query strings or webhook JSON alone. */
export async function verifyPaystackCharge(reference: string): Promise<PaystackCharge> {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(reference)) throw new PaystackGatewayError('Invalid payment reference.');
  const secret = requireSecret();
  let response: Response;
  try {
    response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(12000),
    });
  } catch { throw new PaystackGatewayError('Could not contact the payment provider.'); }
  const payload = await response.json().catch(() => ({})) as any;
  const data = payload?.data;
  if (!response.ok || payload?.status !== true || data?.status !== 'success') {
    throw new PaystackNotConfirmedError('Payment has not been confirmed by Paystack.');
  }
  if (data.reference !== reference || !Number.isSafeInteger(data.amount) || data.amount <= 0 ||
      typeof data.currency !== 'string' || typeof data.metadata?.user_id !== 'string' ||
      typeof data.metadata?.purpose !== 'string') {
    throw new PaystackGatewayError('Paystack verification returned invalid payment details.');
  }
  return {
    reference, amountKobo: data.amount, currency: data.currency, status: data.status,
    purpose: data.metadata.purpose, userId: data.metadata.user_id,
    itemId: typeof data.metadata.movie_id === 'string' ? data.metadata.movie_id : undefined,
  };
}
