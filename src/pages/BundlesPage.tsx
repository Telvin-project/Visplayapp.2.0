import React, { useState, useEffect } from 'react';
import { EpisodeBundle, Movie } from '../types';
import { useAuth } from '../context/AuthContext';
import { Tv, Play, Lock, Unlock, CheckCircle2, Clock, Sparkles, Coins, ArrowRight } from 'lucide-react';
import confetti from 'canvas-confetti';

interface BundlesPageProps {
  onSelectMovie: (id: string) => void;
  onSelectCreator: (id: string) => void;
  selectedBundleId?: string | null;
}

export const BundlesPage: React.FC<BundlesPageProps> = ({
  onSelectMovie,
  onSelectCreator,
  selectedBundleId,
}) => {
  const { user, openAuthModal, openDepositModal, refreshUser } = useAuth();
  const [bundles, setBundles] = useState<EpisodeBundle[]>([]);
  const [activeBundle, setActiveBundle] = useState<EpisodeBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  useEffect(() => {
    fetchBundles();
  }, [user?.id]);

  const fetchBundles = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/bundles');
      if (res.ok) {
        const data = await res.json();
        setBundles(data.bundles || []);
        if (data.bundles && data.bundles.length > 0) {
          const matched = selectedBundleId
            ? data.bundles.find((b: EpisodeBundle) => b.id === selectedBundleId)
            : data.bundles[0];
          setActiveBundle(matched || data.bundles[0]);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handlePurchaseBundle = async (bundle: EpisodeBundle) => {
    if (!user) {
      openAuthModal('login');
      return;
    }

    setPurchaseError(null);
    setPurchasing(true);

    try {
      const res = await fetch('/api/purchases/buy-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle_id: bundle.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          openDepositModal(() => {
            handlePurchaseBundle(bundle);
          });
          setPurchaseError(`Insufficient coins. Please deposit ₦${data.shortfall_ngn} to unlock this 10-episode bundle.`);
          setPurchasing(false);
          return;
        }
        throw new Error(data.error || 'Failed to purchase bundle');
      }

      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#d946ef', '#06b6d4', '#3b82f6', '#10b981'],
      });

      await refreshUser();
      await fetchBundles();
    } catch (err: any) {
      setPurchaseError(err.message || 'Error completing bundle purchase');
    } finally {
      setPurchasing(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center space-y-3">
        <div className="w-10 h-10 border-2 border-fuchsia-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-400">Loading 10-episode series bundles...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-16">
      {/* Header Banner */}
      <div className="rounded-3xl bg-gradient-to-r from-fuchsia-950/40 via-[#0e1424] to-cyan-950/40 border border-fuchsia-900/40 p-6 sm:p-10 shadow-2xl">
        <div className="max-w-2xl space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-fuchsia-300">
            <Tv className="w-4 h-4" />
            <span className="uppercase tracking-wider">Mandatory Bundle Pricing</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold font-display text-white">
            10-Episode Serialized Series (₦700 Total)
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            Get complete season access for ₦700 total (instead of ₦1,000 individually). All 10 episodes unlock instantly for unlimited HD playback with 85% revenue delivered directly to the production house.
          </p>
        </div>
      </div>

      {/* Active Bundle Showcase */}
      {activeBundle && (
        <div className="space-y-6">
          <div className="bg-[#0d121d] border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row gap-6 items-start justify-between">
            <div className="flex flex-col sm:flex-row gap-5 items-start">
              <img
                src={activeBundle.poster_url || '/posters/lagos_heist.jpg'}
                alt={activeBundle.title}
                className="w-full sm:w-44 aspect-[3/4] object-cover rounded-2xl shadow-xl border border-slate-700"
              />
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-fuchsia-300 font-semibold">
                  <span>10 Episodes Included</span>
                  <span>·</span>
                  <span className="font-mono text-cyan-300">₦700 Total</span>
                  {activeBundle.is_purchased && (
                    <span className="flex items-center gap-1 text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded">
                      <CheckCircle2 className="w-3 h-3" />
                      SERIES OWNED
                    </span>
                  )}
                </div>

                <h2 className="text-xl sm:text-2xl font-bold font-display text-white">
                  {activeBundle.title}
                </h2>
                <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
                  {activeBundle.description}
                </p>

                {purchaseError && (
                  <p className="text-xs text-rose-400 bg-rose-950/40 p-2.5 rounded-xl border border-rose-800">
                    {purchaseError}
                  </p>
                )}
              </div>
            </div>

            {/* Buy Bundle Button */}
            <div className="w-full md:w-auto shrink-0 space-y-2">
              {activeBundle.is_purchased ? (
                <div className="p-4 bg-emerald-950/30 border border-emerald-800/80 rounded-2xl text-center space-y-1">
                  <span className="text-xs font-bold text-emerald-300 flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    All 10 Episodes Unlocked
                  </span>
                  <span className="text-[11px] text-slate-400 block">Unlimited streaming access</span>
                </div>
              ) : (
                <button
                  onClick={() => handlePurchaseBundle(activeBundle)}
                  disabled={purchasing}
                  className="w-full sm:w-auto px-6 py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-fuchsia-600 to-cyan-500 hover:from-fuchsia-500 hover:to-cyan-400 text-white shadow-xl shadow-fuchsia-950/30 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Unlock className="w-4 h-4" />
                  <span>Unlock All 10 Episodes for ₦700</span>
                </button>
              )}
            </div>
          </div>

          {/* Episode List (Ep 1 to 10) */}
          <div className="space-y-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>Episodes Breakdown</span>
              <span className="text-xs text-slate-400 font-mono">({activeBundle.episodes?.length || 10} Episodes)</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(activeBundle.episodes || []).map((ep, idx) => (
                <div
                  key={ep.id}
                  onClick={() => onSelectMovie(ep.id)}
                  className="group p-4 bg-[#0d121d] hover:bg-slate-900 border border-slate-800/80 hover:border-cyan-500/50 rounded-2xl transition-all cursor-pointer flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-xs font-bold font-mono text-cyan-400 group-hover:bg-cyan-500 group-hover:text-black transition-colors shrink-0">
                      {ep.episode_number || idx + 1}
                    </div>

                    <div className="space-y-0.5">
                      <h4 className="text-xs sm:text-sm font-semibold text-white group-hover:text-cyan-300 transition-colors line-clamp-1">
                        {ep.title}
                      </h4>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        <span>{Math.floor(ep.duration_seconds / 60)} mins</span>
                        <span>·</span>
                        {activeBundle.is_purchased || ep.is_purchased ? (
                          <span className="text-emerald-400 font-medium">Unlocked</span>
                        ) : (
                          <span className="text-slate-400">5m Free Preview Available</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <div className="w-8 h-8 rounded-full bg-slate-800 group-hover:bg-cyan-500/20 text-slate-300 group-hover:text-cyan-300 flex items-center justify-center transition-colors">
                      <Play className="w-3.5 h-3.5 ml-0.5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
