import React, { useRef, useState, useEffect } from 'react';
import { Movie, CreatorProfile, Comment } from '../types';
import { useAuth } from '../context/AuthContext';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  PictureInPicture2,
  Lock,
  Unlock,
  Coins,
  Heart,
  Share2,
  AlertTriangle,
  Send,
  Trash2,
  CheckCircle2,
  UserPlus,
  UserCheck,
  Eye,
  Film,
  Sparkles,
  ArrowRight,
  Tv,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface WatchPlayerProps {
  movie: Movie;
  creator: CreatorProfile | null;
  onRefreshMovie: () => void;
  onSelectMovie: (id: string) => void;
  onSelectCreator: (id: string) => void;
}

export const WatchPlayer: React.FC<WatchPlayerProps> = ({
  movie,
  creator,
  onRefreshMovie,
  onSelectMovie,
  onSelectCreator,
}) => {
  const { user, openAuthModal, openDepositModal, refreshUser } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(movie.duration_seconds || 3600);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiPSupported, setIsPiPSupported] = useState(false);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [pipNotice, setPipNotice] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Paywall & Purchase State
  const [paywallReached, setPaywallReached] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [isLiked, setIsLiked] = useState(movie.is_liked || false);
  const [likesCount, setLikesCount] = useState(movie.likes_count || 0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);

  // Comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Unique session ID for analytics tracking
  const [sessionId] = useState(() => `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);

  // Max free preview allowed: exactly 300 seconds (5 minutes)
  const FREE_PREVIEW_LIMIT = 300;

  useEffect(() => {
    // Check Picture-in-Picture browser support
    if (typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled) {
      setIsPiPSupported(true);
    }

    const video = videoRef.current;
    if (video) {
      const handleEnterPiP = () => setIsPiPActive(true);
      const handleLeavePiP = () => setIsPiPActive(false);
      const handleLoadedMeta = () => {
        setIsVideoReady(true);
        if (video.duration) setDuration(video.duration);
      };

      video.addEventListener('enterpictureinpicture', handleEnterPiP);
      video.addEventListener('leavepictureinpicture', handleLeavePiP);
      video.addEventListener('loadedmetadata', handleLoadedMeta);

      if (video.readyState >= 1) {
        setIsVideoReady(true);
        if (video.duration) setDuration(video.duration);
      }

      return () => {
        video.removeEventListener('enterpictureinpicture', handleEnterPiP);
        video.removeEventListener('leavepictureinpicture', handleLeavePiP);
        video.removeEventListener('loadedmetadata', handleLoadedMeta);
      };
    }
  }, [movie.video_url]);

  useEffect(() => {
    // Fetch initial comments
    fetchComments();

    // Check creator follow status
    if (creator && user) {
      checkFollowStatus();
    }

    // Reset playback on movie change
    setCurrentTime(0);
    setPaywallReached(false);
    setIsPlaying(false);
  }, [movie.id, user?.id]);

  const checkFollowStatus = async () => {
    if (!creator) return;
    try {
      const res = await fetch(`/api/creators/channel/${creator.id}`);
      if (res.ok) {
        const data = await res.json();
        setFollowersCount(data.followers_count || 0);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchComments = async () => {
    try {
      const res = await fetch(`/api/movies/${movie.id}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Video Time Update & Paywall Enforcement
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const current = videoRef.current.currentTime;
    setCurrentTime(current);

    // Enforce 5-minute (300 seconds) free preview if unpaid
    if (!movie.is_purchased && current >= FREE_PREVIEW_LIMIT) {
      videoRef.current.pause();
      videoRef.current.currentTime = FREE_PREVIEW_LIMIT;
      setIsPlaying(false);
      setPaywallReached(true);

      // Track milestone
      trackViewingEvent(FREE_PREVIEW_LIMIT, true, false);
    } else {
      // Periodically track duration
      if (Math.floor(current) % 30 === 0) {
        trackViewingEvent(current, current >= FREE_PREVIEW_LIMIT, false);
      }
    }
  };

  const trackViewingEvent = async (durationSec: number, reached5Min: boolean, completed: boolean) => {
    try {
      await fetch(`/api/movies/${movie.id}/track-view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          duration_watched_seconds: durationSec,
          reached_5_min: reached5Min,
          completed,
        }),
      });
    } catch (err) {
      // Background analytics fail quietly
    }
  };

  const handlePlayPause = () => {
    if (!videoRef.current) return;

    if (!movie.is_purchased && currentTime >= FREE_PREVIEW_LIMIT) {
      setPaywallReached(true);
      return;
    }

    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
        trackViewingEvent(currentTime, currentTime >= FREE_PREVIEW_LIMIT, false);
      }).catch(err => console.log('Autoplay blocked:', err));
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = parseFloat(e.target.value);
    if (!movie.is_purchased && target >= FREE_PREVIEW_LIMIT) {
      // Lock seek beyond 5 minutes
      if (videoRef.current) {
        videoRef.current.currentTime = FREE_PREVIEW_LIMIT;
      }
      setCurrentTime(FREE_PREVIEW_LIMIT);
      setPaywallReached(true);
      return;
    }

    if (videoRef.current) {
      videoRef.current.currentTime = target;
      setCurrentTime(target);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    videoRef.current.muted = nextMuted;
  };

  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(e => console.error(e));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(e => console.error(e));
    }
  };

  const togglePiP = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPiPActive(false);
        return;
      }

      if (!document.pictureInPictureEnabled) {
        setPipNotice('Picture-in-Picture is restricted or not supported by this browser.');
        setTimeout(() => setPipNotice(null), 3500);
        return;
      }

      // Check if metadata is loaded (video.readyState >= 1)
      if (video.readyState < 1) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            resolve();
          }, 2000);

          const onMeta = () => {
            cleanup();
            setIsVideoReady(true);
            resolve();
          };

          const onError = () => {
            cleanup();
            reject(new Error('Video stream metadata not available yet'));
          };

          const cleanup = () => {
            clearTimeout(timeout);
            video.removeEventListener('loadedmetadata', onMeta);
            video.removeEventListener('canplay', onMeta);
            video.removeEventListener('error', onError);
          };

          video.addEventListener('loadedmetadata', onMeta);
          video.addEventListener('canplay', onMeta);
          video.addEventListener('error', onError);

          video.load();
        });
      }

      await video.requestPictureInPicture();
      setIsPiPActive(true);
    } catch (err: any) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Picture-in-Picture requires an active video playback interaction.'
        : err?.name === 'SecurityError'
        ? 'Picture-in-Picture is disabled by container policy in this view.'
        : err?.name === 'InvalidStateError'
        ? 'Video stream metadata is still initializing. Please click play first then try PiP.'
        : (err?.message || 'Picture-in-Picture is currently unavailable.');
      setPipNotice(msg);
      setTimeout(() => setPipNotice(null), 3500);
    }
  };

  // Purchase ₦100 Movie
  const handlePurchaseMovie = async () => {
    if (!user) {
      openAuthModal('login');
      return;
    }

    setPurchaseError(null);
    setPurchasing(true);

    try {
      const res = await fetch('/api/purchases/buy-movie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movie_id: movie.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          // Insufficient funds -> launch Deposit Modal with seamless auto-resume!
          openDepositModal(() => {
            // Once user deposits, automatically re-attempt unlock
            handlePurchaseMovie();
          });
          setPurchaseError(`Insufficient coins. Please deposit ₦${data.shortfall_ngn} to continue.`);
          setPurchasing(false);
          return;
        }
        throw new Error(data.error || 'Failed to complete movie purchase');
      }

      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#06b6d4', '#d946ef', '#10b981'],
      });

      await refreshUser();
      onRefreshMovie();
      setPaywallReached(false);

      // Resume video
      if (videoRef.current) {
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    } catch (err: any) {
      setPurchaseError(err.message || 'Purchase error');
    } finally {
      setPurchasing(false);
    }
  };

  // Social Likes
  const handleToggleLike = async () => {
    if (!user) {
      openAuthModal('login');
      return;
    }
    try {
      const res = await fetch(`/api/movies/${movie.id}/like`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setIsLiked(data.is_liked);
        setLikesCount(data.likes_count);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Follow Creator (Free)
  const handleToggleFollow = async () => {
    if (!creator) return;
    if (!user) {
      openAuthModal('login');
      return;
    }
    try {
      const res = await fetch(`/api/creators/follow/${creator.id}`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setIsFollowing(data.is_following);
        setFollowersCount(data.followers_count);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Post Comment
  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuthModal('login');
      return;
    }
    if (!newComment.trim()) return;

    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/movies/${movie.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment_text: newComment }),
      });
      if (res.ok) {
        const data = await res.json();
        setComments([data.comment, ...comments]);
        setNewComment('');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubmittingComment(false);
    }
  };

  // Delete Comment
  const handleDeleteComment = async (commentId: string) => {
    try {
      const res = await fetch(`/api/movies/${movie.id}/comments/${commentId}`, { method: 'DELETE' });
      if (res.ok) {
        setComments(comments.filter(c => c.id !== commentId));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remSecs = Math.floor(secs % 60);
    return `${mins}:${remSecs < 10 ? '0' : ''}${remSecs}`;
  };

  return (
    <div className="space-y-6">
      {/* ---------------- PLAYER CONTAINER ---------------- */}
      <div
        ref={playerContainerRef}
        className="relative aspect-video w-full max-h-[75vh] bg-black rounded-3xl overflow-hidden shadow-2xl border border-slate-800/80 group select-none"
        onMouseMove={() => {
          setShowControls(true);
          if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
          controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3500);
        }}
      >
        <video
          ref={videoRef}
          src={movie.video_url}
          poster={movie.backdrop_url || movie.poster_url}
          className="w-full h-full object-contain cursor-pointer"
          playsInline
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => {
            setIsVideoReady(true);
            if (videoRef.current && videoRef.current.duration) {
              setDuration(videoRef.current.duration);
            }
          }}
          onCanPlay={() => setIsVideoReady(true)}
          onEnded={() => {
            setIsPlaying(false);
            trackViewingEvent(duration, true, true);
          }}
          onClick={handlePlayPause}
        />

        {/* Picture-in-Picture notice/toast */}
        {pipNotice && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 border border-cyan-500/50 text-cyan-200 text-xs px-4 py-2 rounded-xl shadow-2xl backdrop-blur-md pointer-events-none animate-in fade-in duration-200 text-center max-w-sm">
            {pipNotice}
          </div>
        )}

        {/* ---------------- 5-MINUTE FREE PREVIEW PAYWALL OVERLAY ---------------- */}
        {paywallReached && !movie.is_purchased && (
          <div className="absolute inset-0 z-30 bg-[#07090e]/95 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
            <div className="max-w-md w-full bg-[#0d121d] border border-cyan-500/40 rounded-3xl p-6 sm:p-8 text-center shadow-2xl text-slate-100">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Lock className="w-7 h-7" />
              </div>

              <span className="text-[11px] font-semibold tracking-wider text-cyan-400 uppercase bg-cyan-950/80 border border-cyan-800 px-3 py-1 rounded-full">
                5-Minute Free Preview Ended
              </span>

              <h3 className="text-xl sm:text-2xl font-bold font-display text-white mt-3 mb-1.5">
                Unlock "{movie.title}"
              </h3>
              <p className="text-xs text-slate-300 mb-5">
                Enjoyed the first 5 minutes? Unlock the complete film for only{' '}
                <strong className="text-cyan-300 font-mono text-sm">₦100</strong>. 85% goes directly to the African creator.
              </p>

              {/* Wallet info */}
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl mb-4 flex items-center justify-between text-xs">
                <span className="text-slate-400">Your VisPlay Wallet</span>
                <span className="font-bold text-cyan-300 font-mono text-sm">
                  ₦{(user?.wallet_balance || 0).toLocaleString()}
                </span>
              </div>

              {purchaseError && (
                <div className="mb-4 p-2.5 bg-rose-950/70 border border-rose-800 rounded-xl text-xs text-rose-300">
                  {purchaseError}
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  onClick={handlePurchaseMovie}
                  disabled={purchasing}
                  className="w-full py-3.5 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-500 via-blue-600 to-fuchsia-600 hover:from-cyan-400 hover:to-fuchsia-500 text-white shadow-lg shadow-cyan-500/25 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {purchasing ? (
                    <span>Unlocking Movie...</span>
                  ) : (
                    <>
                      <Unlock className="w-4 h-4" />
                      <span>Unlock Full Movie for ₦100</span>
                      <ArrowRight className="w-4 h-4 ml-auto" />
                    </>
                  )}
                </button>

                <button
                  onClick={() => openDepositModal()}
                  className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors flex items-center justify-center gap-2"
                >
                  <Coins className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Deposit Coins via Paystack</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---------------- CUSTOM PLAYER CONTROLS OVERLAY ---------------- */}
        <div
          className={`absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/40 pointer-events-none transition-opacity duration-300 flex flex-col justify-between p-4 sm:p-6 ${
            showControls || !isPlaying ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Top Bar inside player */}
          <div className="flex items-center justify-between pointer-events-auto">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white drop-shadow truncate max-w-xs sm:max-w-md">
                {movie.title}
              </span>
              {!movie.is_purchased && (
                <span className="text-[10px] font-medium text-cyan-300 bg-cyan-950/80 border border-cyan-800 px-2 py-0.5 rounded-md">
                  Preview: 5m Limit
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {movie.is_purchased ? (
                <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950/90 border border-emerald-700 px-2.5 py-1 rounded-lg flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>UNLOCKED</span>
                </span>
              ) : (
                <button
                  onClick={handlePurchaseMovie}
                  className="px-3 py-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-[11px] font-bold rounded-lg shadow-md active:scale-95 transition-all flex items-center gap-1"
                >
                  <Unlock className="w-3 h-3" />
                  <span>Unlock (₦100)</span>
                </button>
              )}
            </div>
          </div>

          {/* Bottom Bar: Timeline & Control Buttons */}
          <div className="pointer-events-auto space-y-2">
            {/* Seekbar */}
            <div className="relative flex items-center group/seek">
              <input
                type="range"
                min={0}
                max={movie.is_purchased ? duration : FREE_PREVIEW_LIMIT}
                step={0.5}
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1.5 bg-slate-700/80 rounded-lg appearance-none cursor-pointer accent-cyan-400 hover:h-2.5 transition-all"
              />
              {/* 5-minute visual marker if unpaid */}
              {!movie.is_purchased && (
                <div
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400 ring-2 ring-cyan-500/50"
                  title="5-minute preview limit"
                />
              )}
            </div>

            <div className="flex items-center justify-between text-white text-xs">
              {/* Left Controls */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePlayPause}
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>

                <div className="flex items-center gap-1.5">
                  <button onClick={toggleMute} className="text-slate-300 hover:text-white">
                    {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <div className="text-[11px] text-slate-300 font-mono">
                  <span>{formatTime(currentTime)}</span>
                  <span className="mx-1">/</span>
                  <span>{formatTime(movie.is_purchased ? duration : FREE_PREVIEW_LIMIT)}</span>
                </div>
              </div>

              {/* Right Controls: PiP & Fullscreen */}
              <div className="flex items-center gap-2">
                {isPiPSupported && (
                  <button
                    onClick={togglePiP}
                    className={`p-2 rounded-lg text-slate-300 hover:text-white transition-colors ${
                      isPiPActive ? 'text-cyan-400 bg-cyan-950/60' : 'hover:bg-white/10'
                    }`}
                    title="Picture in Picture"
                  >
                    <PictureInPicture2 className="w-4 h-4" />
                  </button>
                )}

                <button
                  onClick={toggleFullscreen}
                  className="p-2 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
                  title="Fullscreen"
                >
                  {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- MOVIE METADATA & ACTIONS ---------------- */}
      <div className="bg-[#0d121d] border border-slate-800/80 rounded-3xl p-6 md:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="text-cyan-400 font-medium">{movie.genre}</span>
              <span>·</span>
              <span>{movie.release_year}</span>
              <span>·</span>
              <span>{Math.floor(movie.duration_seconds / 60)} mins</span>
              <span>·</span>
              <span className="flex items-center gap-1 text-slate-300 font-mono">
                <Eye className="w-3.5 h-3.5 text-slate-400" />
                <span>{(movie.views_count || 0).toLocaleString()} views</span>
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold font-display text-white">
              {movie.title}
            </h1>
          </div>

          {/* Social Interaction Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleLike}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
                isLiked
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              <Heart className={`w-4 h-4 ${isLiked ? 'fill-rose-400 text-rose-400' : ''}`} />
              <span className="font-mono">{likesCount}</span>
            </button>

            <button
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                alert('Watch link copied to clipboard!');
              }}
              className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-colors"
              title="Share movie"
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Synopsis */}
        <p className="text-sm text-slate-300 leading-relaxed max-w-3xl">
          {movie.synopsis}
        </p>

        {/* Creator Channel Card & Attribution */}
        {creator && (
          <div className="pt-6 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div
              onClick={() => onSelectCreator(creator.id)}
              className="flex items-center gap-3.5 cursor-pointer group"
            >
              <img
                src={creator.channel_avatar_url || movie.creator_avatar}
                alt={creator.channel_name}
                className="w-12 h-12 rounded-2xl object-cover border border-slate-700 group-hover:border-cyan-500 transition-colors"
              />
              <div>
                <h4 className="text-sm font-bold text-white group-hover:text-cyan-400 transition-colors">
                  {creator.channel_name}
                </h4>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>{creator.content_type}</span>
                  <span>·</span>
                  <span className="font-mono">{followersCount} followers</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleToggleFollow}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 self-start sm:self-auto ${
                isFollowing
                  ? 'bg-slate-800 text-slate-200 border border-slate-700'
                  : 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              }`}
            >
              {isFollowing ? (
                <>
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Following (Free)</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Follow Creator</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* ---------------- COMMENTS & COMMUNITY DISCUSSION ---------------- */}
      <div className="bg-[#0d121d] border border-slate-800/80 rounded-3xl p-6 md:p-8 space-y-6">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <span>Audience Discussion</span>
          <span className="text-xs text-slate-400 font-mono">({comments.length})</span>
        </h3>

        {/* Comment input form */}
        <form onSubmit={handlePostComment} className="flex gap-3">
          <img
            src={user?.avatar_url || '/visplay-symbol.png'}
            alt="User"
            className="w-9 h-9 rounded-xl object-cover border border-slate-700 shrink-0"
          />
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={user ? 'Write a review or reaction...' : 'Sign in to leave a comment...'}
              disabled={!user || submittingComment}
              className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 transition-all"
            />
            <button
              type="submit"
              disabled={!user || !newComment.trim() || submittingComment}
              className="px-4 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-xl text-xs shadow-md transition-colors disabled:opacity-40 shrink-0 flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Post</span>
            </button>
          </div>
        </form>

        {/* Comments list */}
        <div className="space-y-4 pt-2">
          {comments.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">
              Be the first to share your thoughts on this Nollywood release.
            </p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="flex gap-3 p-3 bg-slate-900/60 rounded-2xl border border-slate-800/60">
                <img
                  src={c.user_avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'}
                  alt={c.user_name}
                  className="w-8 h-8 rounded-lg object-cover border border-slate-700 shrink-0"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">{c.user_name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500">
                        {new Date(c.created_at).toLocaleDateString()}
                      </span>
                      {(user?.id === c.user_id || user?.role === 'admin') && (
                        <button
                          onClick={() => handleDeleteComment(c.id)}
                          className="text-slate-500 hover:text-rose-400 p-0.5"
                          title="Delete comment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">{c.comment_text}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
