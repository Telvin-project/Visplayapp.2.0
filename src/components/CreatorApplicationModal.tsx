import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { X, Film, CheckCircle2, AlertCircle, Sparkles, Video, ArrowRight, Shield } from 'lucide-react';

export const CreatorApplicationModal: React.FC = () => {
  const { creatorApplyModalOpen, closeCreatorApplyModal, creatorProfile, user, refreshUser, openAuthModal } = useAuth();
  const [channelName, setChannelName] = useState('');
  const [contentType, setContentType] = useState('Nollywood Action & Thrillers');
  const [description, setDescription] = useState('');
  const [channelAvatarUrl, setChannelAvatarUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!creatorApplyModalOpen) return null;

  if (!user) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <div className="relative w-full max-w-md bg-[#0d121d] border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl text-slate-100 text-center">
          <button
            onClick={closeCreatorApplyModal}
            className="absolute top-5 right-5 w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
          <Film className="w-12 h-12 text-cyan-400 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-white mb-2">Creator Account Required</h3>
          <p className="text-xs text-slate-400 mb-6">
            Please sign in or create a VisPlay account first to submit your creator application.
          </p>
          <button
            onClick={() => {
              closeCreatorApplyModal();
              openAuthModal('login');
            }}
            className="w-full py-2.5 px-4 rounded-xl font-semibold text-xs bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
          >
            Sign In to Apply
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelName.trim()) {
      setError('Channel name is required.');
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/creators/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_name: channelName,
          content_type: contentType,
          description,
          channel_avatar_url: channelAvatarUrl || user.avatar_url,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit application');
      }

      await refreshUser();
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        closeCreatorApplyModal();
      }, 2500);
    } catch (err: any) {
      setError(err.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const contentTypes = [
    'Nollywood Action & Thrillers',
    'Historical Epics & African Royalty',
    'Contemporary Romance & Drama',
    'Sci-Fi & Tech Mystery',
    'Nollywood Comedy & Satire',
    'Documentaries & Heritage Biopics',
    'Short Film Series & Anthology',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-[#0d121d] border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl text-slate-100 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <button
          onClick={closeCreatorApplyModal}
          className="absolute top-5 right-5 w-9 h-9 rounded-full bg-slate-800/80 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-fuchsia-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Video className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-display text-white">Apply as VisPlay Creator</h3>
            <p className="text-xs text-slate-400">Distribute your films, earn 85% revenue split, get monthly payouts</p>
          </div>
        </div>

        {creatorProfile?.status === 'pending' && !success && (
          <div className="p-4 bg-amber-950/40 border border-amber-800/70 rounded-2xl mb-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs">
              <Sparkles className="w-4 h-4" />
              <span>Application Under Review</span>
            </div>
            <p className="text-xs text-slate-300">
              Your channel application for <strong className="text-white">"{creatorProfile.channel_name}"</strong> has been received and is currently in the Super Admin review queue.
            </p>
            <p className="text-[11px] text-slate-400">
              Submitted on: {new Date(creatorProfile.submitted_at).toLocaleDateString()}
            </p>
          </div>
        )}

        {creatorProfile?.status === 'approved' && !success && (
          <div className="p-4 bg-emerald-950/40 border border-emerald-800/70 rounded-2xl mb-4 space-y-2">
            <div className="flex items-center gap-2 text-emerald-300 font-semibold text-xs">
              <CheckCircle2 className="w-4 h-4" />
              <span>Creator Profile Active</span>
            </div>
            <p className="text-xs text-slate-300">
              Your channel <strong className="text-white">"{creatorProfile.channel_name}"</strong> is approved! You can upload movies and access Creator Studio.
            </p>
          </div>
        )}

        {success ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-base font-bold text-white">Application Submitted!</h4>
            <p className="text-xs text-slate-300 max-w-sm mx-auto">
              Our Super Admin moderation team will review your channel and activate your Creator Studio access.
            </p>
          </div>
        ) : (
          <>
            {/* Value props */}
            <div className="grid grid-cols-3 gap-2.5 mb-6 text-center">
              <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
                <span className="block text-base font-bold text-cyan-300 font-mono">85%</span>
                <span className="text-[10px] text-slate-400">Creator Revenue</span>
              </div>
              <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
                <span className="block text-base font-bold text-fuchsia-300 font-mono">₦100</span>
                <span className="text-[10px] text-slate-400">Per Film Unlock</span>
              </div>
              <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
                <span className="block text-base font-bold text-emerald-300 font-mono">Monthly</span>
                <span className="text-[10px] text-slate-400">Direct Bank Payouts</span>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-rose-950/60 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Channel / Studio Name *</label>
                <input
                  type="text"
                  required
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  placeholder="e.g. Balogun Screenworks, Lagos Indie Films"
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Primary Content Genre *</label>
                <select
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                >
                  {contentTypes.map((t) => (
                    <option key={t} value={t} className="bg-slate-900 text-slate-100">
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Channel Description & Filmmaker Bio</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tell African film lovers about your production company, film style, and upcoming releases..."
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Channel Avatar URL (Optional)</label>
                <input
                  type="url"
                  value={channelAvatarUrl}
                  onChange={(e) => setChannelAvatarUrl(e.target.value)}
                  placeholder="https://... (defaults to your profile picture)"
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                />
              </div>

              <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl flex items-start gap-2.5 text-[11px] text-slate-400">
                <Shield className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  By applying, you verify that you hold legal rights or creator licenses to distribute your film uploads on VisPlay.
                </span>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 px-4 rounded-xl font-semibold text-sm bg-gradient-to-r from-cyan-500 via-blue-600 to-fuchsia-600 hover:from-cyan-400 hover:to-fuchsia-500 text-white shadow-lg shadow-cyan-500/20 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? 'Submitting Application...' : 'Submit Creator Application'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
