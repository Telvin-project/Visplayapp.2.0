import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ShieldAlert,
  Users,
  Film,
  Coins,
  CheckCircle2,
  XCircle,
  Eye,
  Clock,
  Landmark,
  FileText,
  Activity,
  Search,
  Filter,
  Check,
  X,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Star,
  Trash2,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface SuperAdminDashboardProps {
  onSelectMovie: (id: string) => void;
}

export const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({ onSelectMovie }) => {
  const { user, openAuthModal } = useAuth();
  const [metrics, setMetrics] = useState<any>(null);
  const [viewingStats, setViewingStats] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [movies, setMovies] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [featuredMovieId, setFeaturedMovieId] = useState<string | null>(null);
  
  const [activeTab, setActiveTab] = useState<'overview' | 'applications' | 'moderation' | 'all_movies' | 'transactions' | 'payouts' | 'users' | 'audit'>('overview');
  const [loading, setLoading] = useState(true);
  const [movieSearch, setMovieSearch] = useState('');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchAdminData();
    }
  }, [user?.id, activeTab]);

  const fetchAdminData = async () => {
    try {
      setLoading(true);
      const [mRes, appRes, movRes, txRes, audRes, usrRes, payRes, featRes] = await Promise.all([
        fetch('/api/admin/metrics'),
        fetch('/api/admin/creator-applications'),
        fetch('/api/admin/movies'),
        fetch('/api/admin/transactions'),
        fetch('/api/admin/audit-logs'),
        fetch('/api/admin/users'),
        fetch('/api/admin/payouts'),
        fetch('/api/movies/featured'),
      ]);

      if (featRes.ok) {
        const featData = await featRes.json();
        setFeaturedMovieId(featData.movie?.id || null);
      }

      if (mRes.ok) {
        const data = await mRes.json();
        setMetrics(data.metrics);
        setViewingStats(data.viewing_stats);
      }
      if (appRes.ok) {
        const data = await appRes.json();
        setApplications(data.applications || []);
      }
      if (movRes.ok) {
        const data = await movRes.json();
        setMovies(data.movies || []);
      }
      if (txRes.ok) {
        const data = await txRes.json();
        setTransactions(data.transactions || []);
      }
      if (audRes.ok) {
        const data = await audRes.json();
        setAuditLogs(data.audit_logs || []);
      }
      if (usrRes.ok) {
        const data = await usrRes.json();
        setUsersList(data.users || []);
      }
      if (payRes.ok) {
        const data = await payRes.json();
        setPayouts(data.payouts || []);
      }
    } catch (err) {
      console.error('Error loading admin portal', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReviewApplication = async (appId: string, action: 'approve' | 'reject') => {
    try {
      const res = await fetch(`/api/admin/creator-applications/${appId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes: `Reviewed and ${action}d by Super Admin` }),
      });
      if (res.ok) {
        confetti({ particleCount: 40 });
        setActionSuccess(`Creator application ${action}d!`);
        setTimeout(() => setActionSuccess(null), 3000);
        fetchAdminData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleReviewMovie = async (movieId: string, action: 'approve' | 'reject') => {
    try {
      const res = await fetch(`/api/admin/movies/${movieId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setActionSuccess(`Movie status updated to ${action}d.`);
        setTimeout(() => setActionSuccess(null), 3000);
        fetchAdminData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleProcessPayout = async (creatorId: string) => {
    try {
      const res = await fetch('/api/admin/payouts/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator_id: creatorId, month_period: 'October 2026' }),
      });
      const data = await res.json();
      if (res.ok) {
        confetti({ particleCount: 50, spread: 60 });
        setActionSuccess(data.message || 'Disbursed payout!');
        setTimeout(() => setActionSuccess(null), 3500);
        fetchAdminData();
      } else {
        alert(data.error || 'Failed to process payout');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteMovie = async (movie: any) => {
    const reason = window.prompt(`Remove "${movie.title}" from VisPlay? Enter the moderation reason (optional):`);
    if (reason === null) return;
    if (!window.confirm(`Confirm removal of "${movie.title}" from the platform?`)) return;
    try {
      const res = await fetch(`/api/movies/${encodeURIComponent(movie.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Could not remove this movie.');
        return;
      }
      setActionSuccess(`Removed "${movie.title}" from VisPlay.`);
      setTimeout(() => setActionSuccess(null), 3500);
      await fetchAdminData();
    } catch (error) {
      console.error('Unable to remove movie:', error);
      alert('Could not remove this movie right now. Please try again.');
    }
  };

  const handleSetFeaturedMovie = async (movieId: string | null) => {
    try {
      const res = await fetch('/api/admin/featured-movie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movie_id: movieId }),
      });
      const data = await res.json();
      if (res.ok) {
        setFeaturedMovieId(movieId);
        confetti({ particleCount: 35, spread: 60 });
        setActionSuccess(movieId ? `Homepage Spotlight Hero set to "${data.message || 'selected film'}"` : 'Featured hero reset to automatic top-ranking.');
        setTimeout(() => setActionSuccess(null), 3500);
        fetchAdminData();
      } else {
        alert(data.error || 'Failed to update featured movie.');
      }
    } catch (e) {
      console.error('Error updating featured movie:', e);
    }
  };

  if (!user || user.role !== 'admin') {
    return (
      <div className="py-20 text-center max-w-md mx-auto space-y-4 bg-[#0d121d] border border-slate-800 rounded-3xl p-8">
        <ShieldAlert className="w-12 h-12 text-amber-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">Super Admin Access Only</h2>
        <p className="text-xs text-slate-400">
          This portal is restricted to authorized VisPlay system administrators.
        </p>
        <button
          onClick={() => openAuthModal('login')}
          className="py-2.5 px-5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs"
        >
          Sign in as Super Admin
        </button>
      </div>
    );
  }

  const filteredMovies = movies.filter(m =>
    m.title.toLowerCase().includes(movieSearch.toLowerCase()) ||
    (m.creator_name && m.creator_name.toLowerCase().includes(movieSearch.toLowerCase()))
  );

  return (
    <div className="space-y-8 pb-16">
      {/* Super Admin Title Bar */}
      <div className="rounded-3xl bg-gradient-to-r from-amber-950/40 via-[#0f1422] to-cyan-950/30 border border-amber-900/40 p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
        <div className="space-y-1 text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start gap-2 text-amber-400 text-xs font-semibold">
            <ShieldAlert className="w-4 h-4" />
            <span className="uppercase tracking-wider">Visibyl Technologies Executive Console</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black font-display text-white">
            VisPlay Super Admin Portal
          </h1>
          <p className="text-xs text-slate-400">
            Real platform metrics, creator application reviews, movie moderation, and financial ledgers.
          </p>
        </div>

        {actionSuccess && (
          <div className="p-3 bg-emerald-950/80 border border-emerald-700 rounded-2xl text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{actionSuccess}</span>
          </div>
        )}
      </div>

      {/* Admin Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar border-b border-slate-800 pb-2">
        {[
          { id: 'overview', label: 'Platform Overview' },
          { id: 'applications', label: `Creator Applications (${applications.filter(a => a.status === 'pending').length} Pending)` },
          { id: 'moderation', label: `Movie Moderation (${movies.filter(m => m.status === 'pending').length} Pending)` },
          { id: 'all_movies', label: `All Movies & Financials (${movies.length})` },
          { id: 'transactions', label: `Transactions Ledger (${transactions.length})` },
          { id: 'payouts', label: 'Creator Monthly Payouts' },
          { id: 'users', label: `Users (${usersList.length})` },
          { id: 'audit', label: 'Platform Audit Log' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-white bg-slate-900/60 border border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---------------- TAB 1: PLATFORM OVERVIEW ---------------- */}
      {activeTab === 'overview' && metrics && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-400">Total Registered Users</span>
              <p className="text-2xl font-bold font-mono text-white">{metrics.total_users}</p>
              <span className="text-[10px] text-slate-500">Includes {metrics.total_creators} Creators</span>
            </div>

            <div className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-400">Published Movies</span>
              <p className="text-2xl font-bold font-mono text-cyan-300">{metrics.published_movies}</p>
              <span className="text-[10px] text-amber-400">{metrics.pending_movies} Pending Moderation</span>
            </div>

            <div className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-400">Gross Platform Box Office</span>
              <p className="text-2xl font-bold font-mono text-emerald-300">
                ₦{metrics.gross_sales_ngn.toLocaleString()}
              </p>
              <span className="text-[10px] text-slate-500">From verified unlocks</span>
            </div>

            <div className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-400">VisPlay Platform Fee (15%)</span>
              <p className="text-2xl font-bold font-mono text-fuchsia-300">
                ₦{metrics.platform_revenue_ngn.toLocaleString()}
              </p>
              <span className="text-[10px] text-slate-500">85% (₦{metrics.creator_share_ngn.toLocaleString()}) to creators</span>
            </div>
          </div>

          {/* Viewing funnel stats */}
          {viewingStats && (
            <div className="p-6 bg-[#0d121d] border border-slate-800 rounded-3xl space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span>Audience Viewing & Conversion Funnel</span>
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400">Total Playback Starts</span>
                  <p className="text-xl font-bold text-white font-mono">{viewingStats.total_sessions}</p>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400">5-Min Preview Milestones</span>
                  <p className="text-xl font-bold text-cyan-300 font-mono">{viewingStats.reached_5_min}</p>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400">Completed Full Watches</span>
                  <p className="text-xl font-bold text-fuchsia-300 font-mono">{viewingStats.completed_watches}</p>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400">Preview-to-Purchase Conversions</span>
                  <p className="text-xl font-bold text-emerald-300 font-mono">{viewingStats.converted_to_purchases}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- TAB 2: CREATOR APPLICATIONS ---------------- */}
      {activeTab === 'applications' && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-white">Creator Verification & Applications Queue</h3>

          <div className="space-y-3">
            {applications.map((app) => (
              <div
                key={app.id}
                className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3.5">
                  <img
                    src={app.user_avatar || '/visplay-symbol.png'}
                    alt={app.user_name}
                    className="w-12 h-12 rounded-2xl object-cover border border-slate-700 shrink-0"
                  />
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-white">{app.channel_name}</h4>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                          app.status === 'approved'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : app.status === 'pending'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}
                      >
                        {app.status}
                      </span>
                    </div>
                    <p className="text-xs text-cyan-400 font-medium">{app.content_type}</p>
                    <p className="text-xs text-slate-400">
                      Applicant: {app.user_name} ({app.user_email}) · Submitted: {new Date(app.submitted_at).toLocaleDateString()}
                    </p>
                    {app.description && (
                      <p className="text-xs text-slate-300 pt-1 max-w-lg">{app.description}</p>
                    )}
                  </div>
                </div>

                {app.status === 'pending' && (
                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    <button
                      onClick={() => handleReviewApplication(app.id, 'approve')}
                      className="py-2 px-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve Creator</span>
                    </button>
                    <button
                      onClick={() => handleReviewApplication(app.id, 'reject')}
                      className="py-2 px-3 bg-slate-800 hover:bg-rose-950 text-rose-400 rounded-xl text-xs font-semibold transition-all border border-slate-700"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Decline</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- TAB 3: MOVIE MODERATION QUEUE ---------------- */}
      {activeTab === 'moderation' && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-white">Movie Content Moderation Queue</h3>

          <div className="space-y-3">
            {movies.filter(m => m.status === 'pending').length === 0 ? (
              <div className="py-12 text-center bg-[#0d121d] rounded-2xl border border-slate-800">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-xs text-slate-400">All creator movie submissions are up to date.</p>
              </div>
            ) : (
              movies.filter(m => m.status === 'pending').map((m) => (
                <div
                  key={m.id}
                  className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                >
                  <div className="flex gap-4 items-start">
                    <img
                      src={m.poster_url || '/posters/lagos_heist.jpg'}
                      alt={m.title}
                      className="w-16 aspect-[3/4] object-cover rounded-xl border border-slate-700 shrink-0"
                    />
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-white">{m.title}</h4>
                      <p className="text-xs text-slate-400">
                        {m.genre} · {m.creator_name} · ₦{m.price_ngn}
                      </p>
                      <p className="text-xs text-slate-300 max-w-xl">{m.synopsis}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
                    <button
                      onClick={() => handleReviewMovie(m.id, 'approve')}
                      className="py-2 px-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve & Publish</span>
                    </button>
                    <button
                      onClick={() => handleReviewMovie(m.id, 'reject')}
                      className="py-2 px-3 bg-slate-800 hover:bg-rose-950 text-rose-400 rounded-xl text-xs font-semibold border border-slate-700"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ---------------- TAB 4: ALL MOVIES & FINANCIALS TABLE ---------------- */}
      {activeTab === 'all_movies' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white">All Platform Movies & Box-Office Breakdown</h3>
              <p className="mt-1 text-xs text-slate-400">Choose any published creator movie to feature in the home-page hero.</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={movieSearch}
                onChange={(e) => setMovieSearch(e.target.value)}
                placeholder="Filter movies..."
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white"
              />
              <button
                type="button"
                onClick={() => handleSetFeaturedMovie(null)}
                className="mt-2 w-full rounded-lg border border-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-300 transition-colors hover:bg-slate-800"
              >
                Reset to automatic feature
              </button>
            </div>
          </div>

          <div className="overflow-x-auto bg-[#0d121d] border border-slate-800 rounded-2xl">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-900/40">
                <tr>
                  <th className="py-3 px-3">Movie</th>
                  <th className="py-3 px-3">Creator Channel</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Views</th>
                  <th className="py-3 px-3">5m Milestones</th>
                  <th className="py-3 px-3">Paid Unlocks</th>
                  <th className="py-3 px-3">Gross Sales</th>
                  <th className="py-3 px-3 text-cyan-300">Creator 85%</th>
                  <th className="py-3 px-3 text-fuchsia-300">VisPlay 15%</th>
                  <th className="py-3 px-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredMovies.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-900/30">
                    <td className="py-3 px-3 font-sans font-medium text-white flex items-center gap-2">
                      <img
                        src={m.poster_url || '/posters/lagos_heist.jpg'}
                        alt={m.title}
                        className="w-7 h-9 object-cover rounded"
                      />
                      <span className="line-clamp-1 max-w-[150px]">{m.title}</span>
                    </td>
                    <td className="py-3 px-3 font-sans text-slate-300">{m.creator_name || 'Studio'}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                          m.status === 'published'
                            ? 'bg-emerald-950 text-emerald-300'
                            : 'bg-amber-950 text-amber-300'
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td className="py-3 px-3">{m.views_count.toLocaleString()}</td>
                    <td className="py-3 px-3 text-slate-400">{m.milestones_5min || 0}</td>
                    <td className="py-3 px-3 font-bold text-white">{m.paid_unlocks_count}</td>
                    <td className="py-3 px-3">₦{(m.gross_sales_ngn || 0).toLocaleString()}</td>
                    <td className="py-3 px-3 text-cyan-300">₦{(m.creator_share_ngn || 0).toLocaleString()}</td>
                    <td className="py-3 px-3 text-fuchsia-300">₦{(m.platform_fee_ngn || 0).toLocaleString()}</td>
                    <td className="py-3 px-3 font-sans">
                      <div className="flex min-w-[125px] flex-col items-start gap-2">
                        <button
                          onClick={() => onSelectMovie(m.id)}
                          className="text-cyan-400 hover:underline"
                        >
                          Watch
                        </button>
                        <button
                          type="button"
                          disabled={m.status !== 'published'}
                          onClick={() => handleSetFeaturedMovie(m.id)}
                          title={m.status !== 'published' ? 'Only published movies can be featured' : 'Show this movie in the homepage hero'}
                          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${featuredMovieId === m.id ? 'border-amber-400/50 bg-amber-400/15 text-amber-300' : 'border-slate-700 text-slate-300 hover:border-amber-400/50 hover:text-amber-300'}`}
                        >
                          <Star className={`h-3 w-3 ${featuredMovieId === m.id ? 'fill-current' : ''}`} />
                          {featuredMovieId === m.id ? 'Featured now' : 'Feature on home'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMovie(m)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-900/70 bg-rose-950/40 px-2 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-900/60"
                          title="Remove this movie for a policy violation"
                        >
                          <Trash2 className="h-3 w-3" /> Remove movie
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- TAB 5: FINANCIAL TRANSACTIONS LEDGER ---------------- */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-white">Reconciled Financial Ledger</h3>
          <div className="overflow-x-auto bg-[#0d121d] border border-slate-800 rounded-2xl">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-900/40">
                <tr>
                  <th className="py-3 px-3">Reference</th>
                  <th className="py-3 px-3">User</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Amount</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Method</th>
                  <th className="py-3 px-3">Description</th>
                  <th className="py-3 px-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="py-3 px-3 text-slate-400">{tx.reference}</td>
                    <td className="py-3 px-3 font-sans text-white">{tx.user_name}</td>
                    <td className="py-3 px-3 uppercase text-[10px]">{tx.type}</td>
                    <td className="py-3 px-3 font-bold text-emerald-300">₦{tx.amount_ngn.toLocaleString()}</td>
                    <td className="py-3 px-3">
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded uppercase">
                        {tx.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 uppercase text-[10px]">{tx.payment_method}</td>
                    <td className="py-3 px-3 font-sans text-slate-300 max-w-xs truncate">{tx.description}</td>
                    <td className="py-3 px-3 text-slate-500 font-sans">{new Date(tx.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- TAB 6: CREATOR MONTHLY PAYOUTS ---------------- */}
      {activeTab === 'payouts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white">Monthly Creator Disbursements</h3>
            <span className="text-xs text-slate-400">85% Net Disbursal Rule</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl space-y-3">
              <h4 className="text-sm font-bold text-white">Disburse to Kunle Afolayan (Golden Effects)</h4>
              <p className="text-xs text-slate-400">
                Calculates accrued 85% net earnings from all movie and bundle unlocks.
              </p>
              <button
                onClick={() => handleProcessPayout('creator_01')}
                className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all"
              >
                Disburse Monthly Payout to Kunle Afolayan
              </button>
            </div>

            <div className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl space-y-3">
              <h4 className="text-sm font-bold text-white">Disburse to Nneka Adebayo (Heritage Screenworks)</h4>
              <p className="text-xs text-slate-400">
                Calculates accrued 85% net earnings from all movie and bundle unlocks.
              </p>
              <button
                onClick={() => handleProcessPayout('creator_02')}
                className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all"
              >
                Disburse Monthly Payout to Nneka Adebayo
              </button>
            </div>
          </div>

          <div className="overflow-x-auto bg-[#0d121d] border border-slate-800 rounded-2xl mt-4">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-900/40">
                <tr>
                  <th className="py-3 px-3">Period</th>
                  <th className="py-3 px-3">Creator Channel</th>
                  <th className="py-3 px-3">Gross Earnings</th>
                  <th className="py-3 px-3">15% Fee</th>
                  <th className="py-3 px-3 text-emerald-300">Net Disbursed</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Bank Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="py-3 px-3 font-sans text-white">{p.month_period}</td>
                    <td className="py-3 px-3 font-sans text-slate-200">{p.channel_name || 'Channel'}</td>
                    <td className="py-3 px-3">₦{p.total_earnings_ngn.toLocaleString()}</td>
                    <td className="py-3 px-3">₦{p.platform_fee_ngn.toLocaleString()}</td>
                    <td className="py-3 px-3 text-emerald-300 font-bold">₦{p.net_payout_ngn.toLocaleString()}</td>
                    <td className="py-3 px-3">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 uppercase">
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-sans text-slate-400">{p.bank_name} ({p.account_number})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- TAB 7: USERS MANAGEMENT ---------------- */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-white">Registered Users & Wallets</h3>
          <div className="overflow-x-auto bg-[#0d121d] border border-slate-800 rounded-2xl">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-900/40">
                <tr>
                  <th className="py-3 px-3">User</th>
                  <th className="py-3 px-3">Email</th>
                  <th className="py-3 px-3">Role</th>
                  <th className="py-3 px-3">Wallet Balance</th>
                  <th className="py-3 px-3">Phone</th>
                  <th className="py-3 px-3">Joined Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {usersList.map((u) => (
                  <tr key={u.id}>
                    <td className="py-3 px-3 font-sans text-white flex items-center gap-2">
                      <img src={u.avatar_url || '/visplay-symbol.png'} alt="" className="w-6 h-6 rounded-full" />
                      <span>{u.full_name}</span>
                    </td>
                    <td className="py-3 px-3 font-sans text-slate-300">{u.email}</td>
                    <td className="py-3 px-3">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 uppercase">
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-bold text-cyan-300">₦{u.wallet_balance.toLocaleString()}</td>
                    <td className="py-3 px-3 font-sans text-slate-400">{u.phone || '—'}</td>
                    <td className="py-3 px-3 font-sans text-slate-500">{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- TAB 8: AUDIT LOGS ---------------- */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-white">Platform System & Financial Audit Trail</h3>
          <div className="overflow-x-auto bg-[#0d121d] border border-slate-800 rounded-2xl">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-900/40">
                <tr>
                  <th className="py-3 px-3">Timestamp</th>
                  <th className="py-3 px-3">Admin</th>
                  <th className="py-3 px-3">Action</th>
                  <th className="py-3 px-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-3 px-3 text-slate-500">{new Date(log.created_at).toLocaleString()}</td>
                    <td className="py-3 px-3 font-sans text-white">{log.admin_name}</td>
                    <td className="py-3 px-3 text-amber-300 font-semibold">{log.action}</td>
                    <td className="py-3 px-3 font-sans text-slate-300">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
