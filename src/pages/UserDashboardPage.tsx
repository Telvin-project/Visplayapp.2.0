import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Movie, EpisodeBundle, WalletTransaction, CreatorProfile, Reward, Notification } from '../types';
import { MovieCard } from '../components/MovieCard';
import {
  FolderLock,
  Coins,
  Sparkles,
  Users,
  Settings,
  Bell,
  Play,
  Upload,
  CheckCircle2,
  AlertCircle,
  Plus,
  ArrowRight,
  Flame,
  Award,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface UserDashboardPageProps {
  onSelectMovie: (id: string) => void;
  onSelectCreator: (id: string) => void;
  onSelectBundle: (id: string) => void;
}

export const UserDashboardPage: React.FC<UserDashboardPageProps> = ({
  onSelectMovie,
  onSelectCreator,
  onSelectBundle,
}) => {
  const { user, updateProfile, openDepositModal, refreshUser, openCreatorApplyModal, creatorProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<'library' | 'wallet' | 'rewards' | 'creators' | 'notifications' | 'profile'>('library');
  const [libraryData, setLibraryData] = useState<any>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [rewardPoints, setRewardPoints] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // Profile Edit State
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchUserDashboard();
      setFullName(user.full_name);
      setPhone(user.phone || '');
      setAvatarUrl(user.avatar_url);
    }
  }, [user?.id, activeTab]);

  const fetchUserDashboard = async () => {
    try {
      setLoading(true);
      const [libRes, rewRes, notifRes] = await Promise.all([
        fetch('/api/user/library'),
        fetch('/api/rewards'),
        fetch('/api/notifications'),
      ]);

      if (libRes.ok) {
        const data = await libRes.json();
        setLibraryData(data);
      }
      if (rewRes.ok) {
        const data = await rewRes.json();
        setRewards(data.rewards || []);
        setRewardPoints(data.total_points || 0);
      }
      if (notifRes.ok) {
        const data = await notifRes.json();
        setNotifications(data.notifications || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMessage(null);
    const res = await updateProfile({ full_name: fullName, phone, avatar_url: avatarUrl });
    if (res.success) {
      setProfileMessage('Profile updated successfully.');
      confetti({ particleCount: 30 });
      setTimeout(() => setProfileMessage(null), 3000);
    } else {
      setProfileMessage(res.error || 'Failed to update profile.');
    }
    setProfileSaving(false);
  };

  const handleClaimReward = async () => {
    try {
      const res = await fetch('/api/rewards/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: 250, reason: 'Nollywood 5-Day Viewing Streak Bonus' }),
      });
      if (res.ok) {
        confetti({ particleCount: 60, spread: 70 });
        await refreshUser();
        await fetchUserDashboard();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const unlockedMovies: Movie[] = libraryData?.movies || [];
  const unlockedBundles: EpisodeBundle[] = libraryData?.bundles || [];
  const transactions: WalletTransaction[] = libraryData?.transactions || [];
  const followedCreators: CreatorProfile[] = libraryData?.followed_creators || [];

  return (
    <div className="space-y-8 pb-16">
      {/* Viewer Header */}
      <div className="rounded-3xl bg-gradient-to-r from-[#0d121d] via-[#101726] to-[#0f1220] border border-slate-800 p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-2xl">
        <div className="flex items-center gap-4">
          <img
            src={user?.avatar_url || '/visplay-symbol.png'}
            alt={user?.full_name}
            className="w-16 h-16 rounded-2xl object-cover border-2 border-cyan-500/50 shadow-md"
          />
          <div className="space-y-0.5">
            <h1 className="text-xl sm:text-2xl font-bold font-display text-white">{user?.full_name}</h1>
            <p className="text-xs text-slate-400">{user?.email}</p>
            <div className="flex items-center gap-2 pt-1 text-xs">
              <span className="text-[10px] font-bold uppercase bg-slate-800 text-cyan-300 px-2 py-0.5 rounded">
                {user?.role}
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400 font-mono">
                Balance: <strong className="text-cyan-300">₦{(user?.wallet_balance || 0).toLocaleString()}</strong>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => openDepositModal()}
            className="py-2.5 px-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Fund Wallet</span>
          </button>

          {creatorProfile?.status !== 'approved' && (
            <button
              onClick={openCreatorApplyModal}
              className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-fuchsia-300 border border-fuchsia-900/50 rounded-xl text-xs font-bold transition-all"
            >
              Apply as Creator
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar border-b border-slate-800 pb-2">
        {[
          { id: 'library', label: `My Purchases (${unlockedMovies.length})` },
          { id: 'wallet', label: 'Wallet & Paystack History' },
          { id: 'rewards', label: `Rewards & Streaks (${rewardPoints} Pts)` },
          { id: 'creators', label: `Followed Creators (${followedCreators.length})` },
          { id: 'notifications', label: `Notifications (${notifications.filter(n => !n.is_read).length})` },
          { id: 'profile', label: 'Account Profile' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-white bg-slate-900/60 border border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---------------- TAB 1: LIBRARY ---------------- */}
      {activeTab === 'library' && (
        <div className="space-y-6">
          {unlockedMovies.length === 0 && unlockedBundles.length === 0 ? (
            <div className="py-16 text-center bg-[#0d121d] border border-slate-800 rounded-3xl p-8 space-y-3">
              <FolderLock className="w-10 h-10 text-slate-500 mx-auto" />
              <h3 className="text-base font-bold text-white">No Movies Unlocked Yet</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Explore the homepage, watch 5-minute previews free, and unlock any full Nollywood blockbuster for ₦100 coins!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {unlockedMovies.map((m) => (
                <MovieCard
                  key={m.id}
                  movie={{ ...m, is_purchased: true }}
                  onSelectMovie={onSelectMovie}
                  onSelectCreator={onSelectCreator}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------------- TAB 2: WALLET TRANSACTIONS ---------------- */}
      {activeTab === 'wallet' && (
        <div className="space-y-6">
          <div className="p-6 bg-[#0d121d] border border-slate-800 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-xs text-slate-400">Current Balance</span>
              <p className="text-3xl font-extrabold font-mono text-cyan-300">
                ₦{(user?.wallet_balance || 0).toLocaleString()}
              </p>
            </div>
            <button
              onClick={() => openDepositModal()}
              className="py-3 px-5 rounded-xl font-bold text-xs bg-gradient-to-r from-cyan-500 to-blue-600 text-white flex items-center gap-2"
            >
              <Coins className="w-4 h-4" />
              <span>Deposit Coins with Paystack</span>
            </button>
          </div>

          <div className="bg-[#0d121d] border border-slate-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-900/40">
                <tr>
                  <th className="py-3 px-3">Reference</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Amount</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Description</th>
                  <th className="py-3 px-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="py-3 px-3 text-slate-400">{tx.reference}</td>
                    <td className="py-3 px-3 uppercase text-[10px]">{tx.type}</td>
                    <td className={`py-3 px-3 font-bold ${tx.type === 'deposit' ? 'text-emerald-300' : 'text-slate-200'}`}>
                      {tx.type === 'deposit' ? '+' : '-'}₦{tx.amount_ngn.toLocaleString()}
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded uppercase">
                        {tx.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-sans text-slate-300">{tx.description}</td>
                    <td className="py-3 px-3 text-slate-500 font-sans">{new Date(tx.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- TAB 3: REWARDS & STREAKS ---------------- */}
      {activeTab === 'rewards' && (
        <div className="space-y-6">
          <div className="p-6 bg-gradient-to-r from-cyan-950/30 to-fuchsia-950/30 border border-slate-800 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-xs text-cyan-400 font-semibold flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-orange-400" />
                <span>Audience Loyalty Rewards</span>
              </span>
              <h3 className="text-xl font-bold text-white">Daily Watch Time Streak</h3>
              <p className="text-xs text-slate-400">
                Earn streak points for watching previews and supporting Nollywood filmmakers. Convert points to wallet coins!
              </p>
            </div>

            <button
              onClick={handleClaimReward}
              className="py-3 px-5 rounded-xl font-bold text-xs bg-gradient-to-r from-fuchsia-600 to-cyan-500 text-white flex items-center gap-1.5 shrink-0"
            >
              <Award className="w-4 h-4" />
              <span>Claim +₦50 Streak Bonus</span>
            </button>
          </div>

          <div className="space-y-3">
            {rewards.map((r) => (
              <div
                key={r.id}
                className="p-4 bg-[#0d121d] border border-slate-800 rounded-2xl flex items-center justify-between"
              >
                <div>
                  <h4 className="text-xs font-bold text-white">{r.reason}</h4>
                  <span className="text-[10px] text-slate-500">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-cyan-300 font-mono">+{r.points} Pts</span>
                  <span className="block text-[10px] text-emerald-400 font-mono">₦{r.naira_equivalent} credited</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- TAB 4: FOLLOWED CREATORS ---------------- */}
      {activeTab === 'creators' && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-white">Followed Nollywood Studios</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {followedCreators.map((c) => (
              <div
                key={c.id}
                onClick={() => onSelectCreator(c.id)}
                className="p-4 bg-[#0d121d] border border-slate-800 rounded-2xl flex items-center gap-3.5 cursor-pointer hover:border-cyan-500 transition-colors"
              >
                <img
                  src={c.channel_avatar_url || '/visplay-symbol.png'}
                  alt={c.channel_name}
                  className="w-12 h-12 rounded-xl object-cover border border-slate-700"
                />
                <div>
                  <h4 className="text-sm font-bold text-white">{c.channel_name}</h4>
                  <p className="text-xs text-slate-400">{c.content_type}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- TAB 5: NOTIFICATIONS ---------------- */}
      {activeTab === 'notifications' && (
        <div className="space-y-3">
          <h3 className="text-base font-bold text-white">Notifications Inbox</h3>
          {notifications.map((n) => (
            <div key={n.id} className="p-4 bg-[#0d121d] border border-slate-800 rounded-2xl space-y-1">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-white">{n.title}</h4>
                <span className="text-[10px] text-slate-500">{new Date(n.created_at).toLocaleDateString()}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{n.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- TAB 6: PROFILE SETTINGS ---------------- */}
      {activeTab === 'profile' && (
        <div className="bg-[#0d121d] border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-lg mx-auto space-y-5">
          <h3 className="text-lg font-bold text-white">Account Settings & Persistent Avatar</h3>

          {profileMessage && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-800 rounded-xl text-xs text-emerald-300">
              {profileMessage}
            </div>
          )}

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Nigerian Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Avatar Image URL (Persists Across Platform)</label>
              <input
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white"
              />
            </div>

            <button
              type="submit"
              disabled={profileSaving}
              className="w-full py-3 px-4 rounded-xl font-bold text-xs bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors shadow-md"
            >
              {profileSaving ? 'Saving Changes...' : 'Save Profile Changes'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
