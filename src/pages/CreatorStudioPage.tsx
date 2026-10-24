import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Movie, CreatorPayout, CreatorLedger } from '../types';
import {
  Film,
  Upload,
  Coins,
  Eye,
  Unlock,
  Users,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileVideo,
  Image,
  ShieldCheck,
  Plus,
  ArrowUpRight,
  Landmark,
  Radio,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface CreatorStudioPageProps {
  onSelectMovie: (id: string) => void;
}

export const CreatorStudioPage: React.FC<CreatorStudioPageProps> = ({ onSelectMovie }) => {
  const { user, creatorProfile, openCreatorApplyModal } = useAuth();
  const [channelData, setChannelData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'upload' | 'movies' | 'earnings' | 'livestream'>('overview');

  // Upload Form State
  const [title, setTitle] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [genre, setGenre] = useState('Action & Crime');
  const [releaseYear, setReleaseYear] = useState(new Date().getFullYear().toString());
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Livestream Schedule State
  const [liveTitle, setLiveTitle] = useState('');
  const [liveDesc, setLiveDesc] = useState('');
  const [liveDate, setLiveDate] = useState('');
  const [schedulingLive, setSchedulingLive] = useState(false);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchChannelData();
  }, [user?.id]);

  const fetchChannelData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/creators/my-channel');
      if (res.ok) {
        const data = await res.json();
        setChannelData(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleMovieUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !synopsis.trim() || !genre) {
      setUploadError('Please fill in movie title, synopsis and genre.');
      return;
    }
    if (!rightsConfirmed) {
      setUploadError('You must confirm distribution ownership & rights.');
      return;
    }

    setUploadError(null);
    setUploadSuccess(null);
    setUploading(true);
    setUploadProgress(15);

    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('synopsis', synopsis);
      formData.append('genre', genre);
      formData.append('release_year', releaseYear);
      formData.append('rights_confirmed', 'true');

      if (videoFile) {
        formData.append('video', videoFile);
      }
      if (posterFile) {
        formData.append('poster', posterFile);
      }

      setUploadProgress(45);

      const res = await fetch('/api/movies/upload', {
        method: 'POST',
        body: formData,
      });

      setUploadProgress(85);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setUploadProgress(100);
      confetti({ particleCount: 50, spread: 60 });
      setUploadSuccess(`"${title}" submitted! It is now in the Super Admin moderation queue.`);
      
      // Reset form
      setTitle('');
      setSynopsis('');
      setVideoFile(null);
      setPosterFile(null);
      setRightsConfirmed(false);

      await fetchChannelData();
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload movie');
    } finally {
      setUploading(false);
    }
  };

  const handleScheduleLive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!liveTitle.trim()) return;
    setSchedulingLive(true);
    try {
      const res = await fetch('/api/livestreams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: liveTitle,
          description: liveDesc,
          scheduled_at: liveDate || new Date().toISOString(),
        }),
      });
      if (res.ok) {
        setLiveMessage('Livestream scheduled successfully! Visible on public feed.');
        setLiveTitle('');
        setLiveDesc('');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSchedulingLive(false);
    }
  };

  if (!creatorProfile || creatorProfile.status !== 'approved') {
    return (
      <div className="py-16 text-center max-w-lg mx-auto bg-[#0d121d] border border-slate-800 rounded-3xl p-8 space-y-4">
        <Film className="w-12 h-12 text-cyan-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">Creator Access Required</h2>
        <p className="text-xs text-slate-400">
          {creatorProfile?.status === 'pending'
            ? 'Your creator application is currently under review by the Super Admin.'
            : 'You must apply and be approved as a VisPlay creator to access Creator Studio.'}
        </p>
        <button
          onClick={openCreatorApplyModal}
          className="py-2.5 px-5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl text-xs font-semibold"
        >
          {creatorProfile?.status === 'pending' ? 'View Application Status' : 'Apply for Creator Account'}
        </button>
      </div>
    );
  }

  const stats = channelData?.stats || {
    total_movies: 0,
    total_views: 0,
    total_paid_unlocks: 0,
    total_earnings_ngn: 0,
    total_paid_out_ngn: 0,
    pending_payout_ngn: 0,
    followers_count: 0,
  };

  const myMovies: Movie[] = channelData?.movies || [];
  const payouts: CreatorPayout[] = channelData?.payouts || [];
  const ledger: CreatorLedger[] = channelData?.ledger || [];

  return (
    <div className="space-y-8 pb-16">
      {/* Studio Header */}
      <div className="rounded-3xl bg-gradient-to-r from-[#0d1322] via-[#11162b] to-[#15102a] border border-slate-800 p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
        <div className="flex items-center gap-4">
          <img
            src={creatorProfile.channel_avatar_url || user?.avatar_url || '/visplay-symbol.png'}
            alt={creatorProfile.channel_name}
            className="w-16 h-16 rounded-2xl object-cover border-2 border-cyan-500/60 shadow-lg"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold font-display text-white">
                {creatorProfile.channel_name}
              </h1>
              <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-700 px-2 py-0.5 rounded-full">
                APPROVED CREATOR
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{creatorProfile.content_type}</p>
          </div>
        </div>

        <button
          onClick={() => setActiveTab('upload')}
          className="py-3 px-5 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 text-white shadow-lg shadow-cyan-500/20 active:scale-95 transition-all flex items-center gap-2"
        >
          <Upload className="w-4 h-4" />
          <span>Upload New Movie</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar border-b border-slate-800 pb-2">
        {[
          { id: 'overview', label: 'Overview & Analytics' },
          { id: 'upload', label: 'Upload Film' },
          { id: 'movies', label: `My Movies (${myMovies.length})` },
          { id: 'earnings', label: '85% Earnings & Payouts' },
          { id: 'livestream', label: 'Schedule Livestream' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-white bg-slate-900/60 border border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW & STATS */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-400">Total Views</span>
              <p className="text-2xl font-bold font-mono text-white">
                {stats.total_views.toLocaleString()}
              </p>
            </div>
            <div className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-400">Paid Unlocks</span>
              <p className="text-2xl font-bold font-mono text-cyan-300">
                {stats.total_paid_unlocks.toLocaleString()}
              </p>
            </div>
            <div className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-400">Accrued 85% Earnings</span>
              <p className="text-2xl font-bold font-mono text-emerald-300">
                ₦{stats.total_earnings_ngn.toLocaleString()}
              </p>
            </div>
            <div className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-400">Channel Followers</span>
              <p className="text-2xl font-bold font-mono text-fuchsia-300">
                {stats.followers_count.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="bg-[#0d121d] border border-slate-800 rounded-3xl p-6 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Coins className="w-4 h-4 text-cyan-400" />
              <span>VisPlay Creator Monetization Model</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-300">
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-cyan-400 font-bold block mb-1">85% Revenue Share</span>
                <span>You receive ₦85 per ₦100 movie unlock. Platform takes 15% maintenance.</span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-emerald-400 font-bold block mb-1">Monthly Payouts</span>
                <span>Automatic reconciliation and monthly bank wire disbursements to your Nigerian account.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: UPLOAD FILM */}
      {activeTab === 'upload' && (
        <div className="bg-[#0d121d] border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-2xl mx-auto space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold font-display text-white">Upload Nollywood Feature Film</h2>
            <p className="text-xs text-slate-400">
              Files are securely stored in persistent storage and forwarded to the Super Admin queue.
            </p>
          </div>

          {uploadSuccess && (
            <div className="p-4 bg-emerald-950/60 border border-emerald-800 rounded-2xl text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
              <span>{uploadSuccess}</span>
            </div>
          )}

          {uploadError && (
            <div className="p-4 bg-rose-950/60 border border-rose-800 rounded-2xl text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
              <span>{uploadError}</span>
            </div>
          )}

          <form onSubmit={handleMovieUpload} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Movie Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Lagos Undercover"
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Synopsis *</label>
              <textarea
                rows={3}
                required
                value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                placeholder="Gripping overview of the plot, characters, and dramatic stakes..."
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-500 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Genre *</label>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  <option value="Action & Crime">Action & Crime</option>
                  <option value="Historical & Epic">Historical & Epic</option>
                  <option value="Romance & Drama">Romance & Drama</option>
                  <option value="Sci-Fi & Thriller">Sci-Fi & Thriller</option>
                  <option value="Comedy">Comedy</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Release Year</label>
                <input
                  type="number"
                  value={releaseYear}
                  onChange={(e) => setReleaseYear(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>
            </div>

            {/* Video File Input */}
            <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl space-y-2">
              <label className="block text-xs font-medium text-slate-200 flex items-center gap-2">
                <FileVideo className="w-4 h-4 text-cyan-400" />
                <span>Upload Movie Video File (MP4, WebM)</span>
              </label>
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-cyan-500/20 file:text-cyan-300 hover:file:bg-cyan-500/30 cursor-pointer"
              />
              <p className="text-[10px] text-slate-500">
                Supports real file uploads up to 250MB. (Demo fallback stream provided if omitted).
              </p>
            </div>

            {/* Poster File Input */}
            <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl space-y-2">
              <label className="block text-xs font-medium text-slate-200 flex items-center gap-2">
                <Image className="w-4 h-4 text-fuchsia-400" />
                <span>Upload Movie Poster (JPG, PNG)</span>
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setPosterFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-fuchsia-500/20 file:text-fuchsia-300 hover:file:bg-fuchsia-500/30 cursor-pointer"
              />
            </div>

            {/* Fixed pricing disclosure */}
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-[11px] text-slate-400 flex items-center justify-between">
              <span>Standard Movie Pricing:</span>
              <span className="font-bold text-white font-mono">₦100 (85% Creator / 15% Platform)</span>
            </div>

            {/* Rights declaration */}
            <div className="flex items-start gap-3 p-3 bg-slate-900/60 rounded-xl border border-slate-800">
              <input
                type="checkbox"
                id="rights"
                checked={rightsConfirmed}
                onChange={(e) => setRightsConfirmed(e.target.checked)}
                className="mt-0.5 rounded border-slate-700 text-cyan-500 focus:ring-cyan-500"
              />
              <label htmlFor="rights" className="text-xs text-slate-300">
                I certify that I hold full legal intellectual property and distribution rights for this title.
              </label>
            </div>

            {uploading && (
              <div className="space-y-1">
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 block text-right font-mono">
                  {uploadProgress}% Uploaded
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={uploading}
              className="w-full py-3.5 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-500 via-blue-600 to-fuchsia-600 hover:from-cyan-400 hover:to-fuchsia-500 text-white shadow-lg active:scale-95 transition-all disabled:opacity-50"
            >
              {uploading ? 'Uploading Video to Storage...' : 'Submit Movie to Moderation'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: MY MOVIES */}
      {activeTab === 'movies' && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-white">Your Film Catalog</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myMovies.map((movie) => (
              <div
                key={movie.id}
                className="p-4 bg-[#0d121d] border border-slate-800 rounded-2xl flex gap-4 items-center"
              >
                <img
                  src={movie.poster_url || '/posters/lagos_heist.jpg'}
                  alt={movie.title}
                  className="w-20 aspect-[3/4] object-cover rounded-xl"
                />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        movie.status === 'published'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : movie.status === 'pending'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-rose-950 text-rose-300 border border-rose-800'
                      }`}
                    >
                      {movie.status}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">₦{movie.price_ngn}</span>
                  </div>

                  <h4 className="text-sm font-bold text-white line-clamp-1">{movie.title}</h4>
                  <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
                    <span>{movie.views_count} views</span>
                    <span>·</span>
                    <span className="text-cyan-400">{movie.paid_unlocks_count} unlocks</span>
                  </div>

                  {movie.status === 'published' && (
                    <button
                      onClick={() => onSelectMovie(movie.id)}
                      className="text-xs text-cyan-400 hover:underline pt-1 inline-block"
                    >
                      Open Watch Page →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: EARNINGS & PAYOUTS */}
      {activeTab === 'earnings' && (
        <div className="space-y-6">
          <div className="p-6 bg-[#0d121d] border border-slate-800 rounded-3xl space-y-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Landmark className="w-5 h-5 text-emerald-400" />
              <span>Monthly Payout Ledger (85% Creator Split)</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Disbursements occur once per month directly to your verified Nigerian bank account. All transactions are logged with an immutable audit trail.
            </p>

            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="border-b border-slate-800 text-slate-400 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Period</th>
                    <th className="py-2.5 px-3">Gross Sales</th>
                    <th className="py-2.5 px-3">15% Fee</th>
                    <th className="py-2.5 px-3">Net Payout (85%)</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Bank Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {payouts.map((p) => (
                    <tr key={p.id}>
                      <td className="py-3 px-3 font-sans font-medium text-white">{p.month_period}</td>
                      <td className="py-3 px-3">₦{p.total_earnings_ngn.toLocaleString()}</td>
                      <td className="py-3 px-3 text-slate-400">₦{p.platform_fee_ngn.toLocaleString()}</td>
                      <td className="py-3 px-3 font-bold text-emerald-300">₦{p.net_payout_ngn.toLocaleString()}</td>
                      <td className="py-3 px-3">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 uppercase">
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-[11px] text-slate-400 font-sans">
                        {p.bank_name} ({p.account_number})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: LIVESTREAM SCHEDULER */}
      {activeTab === 'livestream' && (
        <div className="bg-[#0d121d] border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-xl mx-auto space-y-4">
          <div className="flex items-center gap-2 text-rose-400">
            <Radio className="w-5 h-5 animate-pulse" />
            <h3 className="text-lg font-bold text-white">Schedule Creator Livestream</h3>
          </div>

          {liveMessage && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-800 rounded-xl text-xs text-emerald-300">
              {liveMessage}
            </div>
          )}

          <form onSubmit={handleScheduleLive} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Live Title *</label>
              <input
                type="text"
                required
                value={liveTitle}
                onChange={(e) => setLiveTitle(e.target.value)}
                placeholder="e.g. Behind the Scenes with the Director"
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Description</label>
              <textarea
                rows={2}
                value={liveDesc}
                onChange={(e) => setLiveDesc(e.target.value)}
                placeholder="Live audience Q&A, scene breakdown..."
                className="w-full px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={schedulingLive}
              className="w-full py-3 px-4 rounded-xl font-bold text-xs bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-md"
            >
              {schedulingLive ? 'Scheduling...' : 'Launch Live Schedule'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
