import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Movie, EpisodeBundle, WalletTransaction, CreatorProfile, Notification } from '../types';
import { MovieCard } from '../components/MovieCard';
import {
  FolderLock,
  Coins,
  Users,
  Settings,
  Bell,
  Play,
  Upload,
  CheckCircle2,
  AlertCircle,
  Plus,
  ArrowRight,
  Trash2,
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
  const { user, updateProfile, openDepositModal, refreshUser, openCreatorApplyModal, creatorProfile, openAuthModal, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'library' | 'history' | 'wallet' | 'creators' | 'notifications' | 'profile'>('library');
  const [libraryData, setLibraryData] = useState<any>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // Profile Edit State
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

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
      const [libRes, notifRes] = await Promise.all([
        fetch('/api/user/library'),
        fetch('/api/notifications'),
      ]);

      if (libRes.ok) {
        const data = await libRes.json();
        setLibraryData(data);
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

  const handleDeleteAccount = async () => {
    setDeleteAccountError(null);
    const confirmed = window.confirm(
      'Permanently delete your VisPlay account? Your profile, comments, follows, watch history, and any creator content you uploaded will be removed. Any remaining wallet balance will be lost. Necessary financial records may be retained in anonymized form. This cannot be undone.'
    );
    if (!confirmed) return;

    setDeletingAccount(true);
    try {
      const response = await fetch('/api/auth/account', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDeleteAccountError(result.error || 'We could not delete your account. Please try again later.');
        return;
      }
      await logout();
      window.location.assign('/');
    } catch (error: any) {
      setDeleteAccountError(error?.message || 'Network error. Your account has not been confirmed as deleted.');
    } finally {
      setDeletingAccount(false);
    }
  };

  const unlockedMovies: Movie[] = libraryData?.movies || [];
  const watchHistory: Movie[] = libraryData?.watch_history || [];
  const unlockedBundles: EpisodeBundle[] = libraryData?.bundles || [];
  const transactions: WalletTransaction[] = libraryData?.transactions || [];
  const followedCreators: CreatorProfile[] = libraryData?.followed_creators || [];

  if (!user) {
    return (
      <div className="py-20 text-center max-w-md mx-auto space-y-4 bg-[#0d121d] border border-slate-800 rounded-3xl p-8">
        <FolderLock className="w-12 h-12 text-cyan-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">Sign In to Access Your Library</h2>
        <p className="text-xs text-slate-400">
          Track your unlocked Nollywood blockbusters, 10-episode series passes, wallet transactions, and profile settings.
        </p>
        <button
          onClick={() => openAuthModal('login')}
          className="py-2.5 px-6 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 text-white font-bold rounded-xl text-xs shadow-lg shadow-cyan-500/20 transition-all"
        >
          Sign In to VisPlay
        </button>
      </div>
    );
  }

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
          { id: 'library', label: `Unlocked Movies (${unlockedMovies.length})` },
          { id: 'history', label: `Watch History (${watchHistory.length})` },
          { id: 'wallet', label: 'Wallet & Paystack History' },
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

      {/* ---------------- WATCH HISTORY ---------------- */}
      {activeTab === 'history' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-[#0d121d] p-4">
            <h3 className="text-base font-bold text-white">Continue Watching</h3>
            <p className="mt-1 text-xs text-slate-400">Pick up where you left off. Your last position is saved as you watch.</p>
          </div>
          {watchHistory.length === 0 ? (
            <div className="rounded-3xl border border-slate-800 bg-[#0d121d] p-10 text-center">
              <Play className="mx-auto h-9 w-9 text-slate-500" />
              <h3 className="mt-3 font-bold text-white">No watch history yet</h3>
              <p className="mt-1 text-xs text-slate-400">Movies you start watching will appear here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {watchHistory.map((m: any) => (
                <div key={m.id} className="space-y-2">
                  <MovieCard movie={m} onSelectMovie={onSelectMovie} onSelectCreator={onSelectCreator} />
                  <p className="text-[11px] text-cyan-300">Resume at {Math.floor((m.last_position_seconds || 0) / 60)}:{String(Math.floor((m.last_position_seconds || 0) % 60)).padStart(2, '0')}</p>
                  <button type="button" onClick={() => onSelectMovie(m.id)} className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/10 py-2 text-xs font-bold text-cyan-200">Resume watching</button>
                </div>
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

          <div className="mt-8 border-t border-red-900/50 pt-6 space-y-3">
            <div>
              <h4 className="text-sm font-bold text-red-300">Delete Account</h4>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Permanently remove your VisPlay account and associated personal data. Creator uploads and comments may also be removed. Financial records required for accounting or fraud prevention may be retained in anonymized form. Any unused wallet balance will be lost.
              </p>
            </div>
            {deleteAccountError && (
              <div role="alert" className="rounded-xl border border-red-800 bg-red-950/50 p-3 text-xs text-red-200">
                {deleteAccountError}
              </div>
            )}
            <button
              type="button"
              onClick={handleDeleteAccount}
              disabled={deletingAccount}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-700/70 bg-red-950/40 px-4 py-3 text-xs font-bold text-red-200 transition-colors hover:bg-red-900/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {deletingAccount ? 'Deleting Account…' : 'Permanently Delete My Account'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
