import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { X, Coins, ShieldCheck, CheckCircle2, ArrowRight, CreditCard, Sparkles, AlertCircle } from 'lucide-react';
import confetti from 'canvas-confetti';

export const WalletDepositModal: React.FC = () => {
  const { depositModalOpen, closeDepositModal, user, refreshUser } = useAuth();
  const [selectedAmount, setSelectedAmount] = useState<number>(1000);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Paystack redirects back with a transaction reference. Verify it server-side.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref');
    if (!reference) return;
    const watchMovieId = params.get('watch');
    params.delete('reference');
    params.delete('trxref');
    params.delete('watch');
    const query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
    (async () => {
      try {
        const isMoviePayment = reference.startsWith('VIS_MOV_');
        const response = await fetch(isMoviePayment ? '/api/purchases/movie/verify' : '/api/wallet/deposit/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          setError(result.error || 'Payment has not been confirmed. If you paid, retry verification shortly.');
          return;
        }
        await refreshUser();
        if (isMoviePayment) {
          const movieId = result.movie_id || watchMovieId;
          window.dispatchEvent(new CustomEvent('visplay-movie-payment-complete', { detail: { movieId } }));
          setSuccessMessage('Payment confirmed. Your movie is unlocked.');
        } else {
          setSuccessMessage('Your wallet deposit has been verified successfully.');
        }
        confetti({ particleCount: 60, spread: 60, origin: { y: 0.6 } });
      } catch {
        setError('We could not verify this payment right now. Please try again.');
      }
    })();
  }, [refreshUser]);

  if (!depositModalOpen) return null;

  const depositPresets = [500, 1000, 2000, 5000, 10000];

  const effectiveAmount = customAmount ? parseInt(customAmount, 10) || 0 : selectedAmount;

  const handleDeposit = async () => {
    if (!effectiveAmount || effectiveAmount < 100) {
      setError('Minimum deposit is ₦100.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const initRes = await fetch('/api/wallet/deposit/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_ngn: effectiveAmount }),
      });
      const initData = await initRes.json();
      if (!initRes.ok || !initData.authorization_url) {
        throw new Error(initData.error || 'Could not start Paystack checkout.');
      }
      // Navigate to Paystack. The callback reference is verified when the user returns.
      window.location.assign(initData.authorization_url);
    } catch (err: any) {
      setError(err.message || 'Payment processing failed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-[#0d121d] border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl text-slate-100">
        <button
          onClick={closeDepositModal}
          className="absolute top-5 right-5 w-9 h-9 rounded-full bg-slate-800/80 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Coins className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-display text-white">Deposit Small Coins</h3>
            <p className="text-xs text-slate-400">Fund your Nigerian Naira (₦) VisPlay wallet</p>
          </div>
        </div>

        {/* Current balance */}
        <div className="p-4 bg-gradient-to-r from-slate-900 to-slate-950 border border-slate-800 rounded-2xl mb-5 flex items-center justify-between">
          <span className="text-xs text-slate-400">Current Wallet Balance</span>
          <span className="text-base font-bold text-cyan-300 font-mono">
            ₦{(user?.wallet_balance || 0).toLocaleString()}
          </span>
        </div>

        {successMessage ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-base font-bold text-white">Deposit Successful</h4>
            <p className="text-sm text-emerald-300">{successMessage}</p>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-3 bg-rose-950/60 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {/* Presets */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-300 mb-2">Select Amount (NGN)</label>
              <div className="grid grid-cols-3 gap-2">
                {depositPresets.map((amt) => {
                  const isSelected = effectiveAmount === amt && !customAmount;
                  return (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        setSelectedAmount(amt);
                        setCustomAmount('');
                      }}
                      className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition-all ${
                        isSelected
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-sm'
                          : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      ₦{amt.toLocaleString()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Amount */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Or Enter Custom Amount (₦)</label>
              <div className="relative">
                <span className="absolute left-3.5 top-2.5 text-sm font-semibold text-slate-400">₦</span>
                <input
                  type="number"
                  min="100"
                  step="50"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  placeholder="e.g. 1500"
                  className="w-full pl-8 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all font-mono"
                />
              </div>
            </div>

            {/* Value context */}
            <div className="p-3 bg-slate-900/60 border border-slate-800/80 rounded-xl mb-5 space-y-1.5 text-[11px] text-slate-400">
              <div className="flex justify-between items-center text-slate-300">
                <span>₦100 unlocks 1 Full Nollywood Movie</span>
                <span className="text-cyan-400 font-medium">₦100</span>
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span>₦700 unlocks Complete 10-Episode Bundle</span>
                <span className="text-fuchsia-400 font-medium">₦700</span>
              </div>
              <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-800">
                85% of content unlock fees go directly to African filmmakers.
              </p>
            </div>

            {/* Provider and Pay button */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleDeposit}
                disabled={submitting || effectiveAmount < 100}
                className="w-full py-3 px-4 rounded-xl font-semibold text-sm bg-gradient-to-r from-cyan-500 via-blue-600 to-fuchsia-600 hover:from-cyan-400 hover:to-fuchsia-500 text-white shadow-lg shadow-cyan-500/20 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <span>Processing Paystack checkout...</span>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    <span>Pay ₦{effectiveAmount.toLocaleString()} with Paystack</span>
                    <ArrowRight className="w-4 h-4 ml-auto" />
                  </>
                )}
              </button>

              <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Secured with Paystack PCI-DSS 256-bit encryption</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
