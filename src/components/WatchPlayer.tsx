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
  Crop,
  Lock,
  Unlock,
  Coins,
  Heart,
  Share2,
  Bookmark,
  RotateCcw,
  RotateCw,
  Sun,
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
  ThumbsUp,
  ThumbsDown,
  MessageCircle,
} from 'lucide-react';
import confetti from 'canvas-confetti';

const resolveMediaUrl = (url?: string | null) => {
  if (!url) return '';
  // Use the Vercel /uploads rewrite so media is served through the same origin
  // as the app instead of hard-coding the backend host in every player.
  if (url.startsWith('/uploads/')) return url;
  return url;
};

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
  const lastTrackedSecondRef = useRef(0);
  const resumePositionRef = useRef(0);
  const hasPendingPaymentResumeRef = useRef(false);
  const lastTapRef = useRef<{ at: number; x: number } | null>(null);
  const tapTimeoutRef = useRef<number | null>(null);
  const lastTouchAtRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const [fitScreen, setFitScreen] = useState(false);
  const [brightness, setBrightness] = useState(1);
  const [gestureNotice, setGestureNotice] = useState<'brightness' | 'volume' | 'backward' | 'forward' | null>(null);

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
  const [videoLoadError, setVideoLoadError] = useState(false);
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
  const [isSaved, setIsSaved] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);

  // Comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  // Unique session ID for analytics tracking
  const createViewSessionId = () => `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const [sessionId, setSessionId] = useState(() => {
    try {
      const key = `visplay-view-session:${movie.id}`;
      const existing = localStorage.getItem(key);
      if (existing) return existing;
      const created = createViewSessionId();
      localStorage.setItem(key, created);
      return created;
    } catch {
      return createViewSessionId();
    }
  });

  useEffect(() => {
    try {
      const key = `visplay-view-session:${movie.id}`;
      const existing = localStorage.getItem(key);
      const next = existing || createViewSessionId();
      localStorage.setItem(key, next);
      setSessionId(next);
    } catch {
      setSessionId(createViewSessionId());
    }
  }, [movie.id]);

  // Max free preview allowed: exactly 300 seconds (5 minutes)
  const FREE_PREVIEW_LIMIT = 300;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`visplay-saved-movies:${user?.id || 'guest'}`) || '[]');
      setIsSaved(Array.isArray(saved) && saved.includes(movie.id));
    } catch { setIsSaved(false); }
  }, [movie.id, user?.id, creator?.id]);

  const handleToggleSaved = () => {
    const key = `visplay-saved-movies:${user?.id || 'guest'}`;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      const current = Array.isArray(saved) ? saved.filter((id: string) => typeof id === 'string') : [];
      const next = isSaved ? current.filter((id: string) => id !== movie.id) : [...new Set([...current, movie.id])];
      localStorage.setItem(key, JSON.stringify(next));
      setIsSaved(!isSaved);
    } catch (error) { console.error('Could not update saved movies', error); }
  };

  useEffect(() => {
    // Check Picture-in-Picture browser support
    if (typeof document !== 'undefined') {
      const video = videoRef.current;
      const webkitVideo = video as (HTMLVideoElement & {
        webkitSupportsPresentationMode?: (mode: string) => boolean;
      }) | null;
      const supportsPiP = Boolean(
        (('pictureInPictureEnabled' in document && document.pictureInPictureEnabled) ||
          (video && 'requestPictureInPicture' in video)) ||
        webkitVideo?.webkitSupportsPresentationMode?.('picture-in-picture')
      );
      setIsPiPSupported(supportsPiP);
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
    // Try to start playback when the selected movie is ready.
    // Mobile browsers may still require a tap because of autoplay restrictions.
    const video = videoRef.current;
    if (!video) return;
    const tryAutoplay = () => {
      video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    };
    if (video.readyState >= 2) tryAutoplay();
    else video.addEventListener('canplay', tryAutoplay, { once: true });
    return () => video.removeEventListener('canplay', tryAutoplay);
  }, [movie.id, movie.video_url]);

  useEffect(() => {
    // Fetch initial comments
    fetchComments();

    // Check creator follow status
    if (creator && user) {
      checkFollowStatus();
    } else {
      setIsFollowing(false);
    }

    setCurrentTime(0);
    setPaywallReached(false);
    setIsPlaying(false);
    resumePositionRef.current = 0;
    lastTrackedSecondRef.current = 0;
    const localKey = `visplay-position:${user?.id || 'guest'}:${movie.id}`;
    const paymentResumeKey = `visplay-resume-after-payment:${user?.id || 'guest'}:${movie.id}`;
    hasPendingPaymentResumeRef.current = false;
    try {
      const paymentResume = Number(localStorage.getItem(paymentResumeKey)) || 0;
      if (paymentResume > 0) {
        resumePositionRef.current = paymentResume;
        hasPendingPaymentResumeRef.current = true;
      } else {
        resumePositionRef.current = Math.max(0, Number(localStorage.getItem(localKey)) || 0);
      }
    } catch { /* Optional resume cache. */ }
    if (user) {
      fetch('/api/user/library').then(response => response.ok ? response.json() : null).then(data => {
        const item = data?.watch_history?.find((entry: any) => entry.id === movie.id);
        // A verified movie payment's saved resume point takes precedence over older watch history.
        if (!item || hasPendingPaymentResumeRef.current) return;
        const position = Math.max(0, Number(item.last_position_seconds) || 0);
        resumePositionRef.current = position;
        try { localStorage.setItem(localKey, String(position)); } catch { /* Optional resume cache. */ }
        const video = videoRef.current;
        if (video && video.readyState >= 1) {
          const safePosition = movie.is_purchased ? position : Math.min(position, FREE_PREVIEW_LIMIT);
          video.currentTime = safePosition;
          setCurrentTime(safePosition);
          if (!movie.is_purchased && position >= FREE_PREVIEW_LIMIT) { video.pause(); setPaywallReached(true); }
        }
      }).catch(() => undefined);
    }
  }, [movie.id, user?.id]);

  const checkFollowStatus = async () => {
    if (!creator) return;
    try {
      const res = await fetch(`/api/creators/channel/${creator.id}`);
      if (res.ok) {
        const data = await res.json().catch(() => ({} as any));
        setFollowersCount(data.followers_count || 0);
        setIsFollowing(Boolean(data.is_following));
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
    try { localStorage.setItem(`visplay-position:${user?.id || 'guest'}:${movie.id}`, String(Math.floor(current))); } catch { /* Optional resume cache. */ }

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
      if (Math.floor(current) - lastTrackedSecondRef.current >= 10) {
        lastTrackedSecondRef.current = Math.floor(current);
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
          last_position_seconds: Math.floor(durationSec),
          reached_5_min: reached5Min,
          completed,
        }),
      });
      if (completed) {
        // A completed viewing session is closed. Replaying from the beginning gets a fresh session.
        const nextSessionId = createViewSessionId();
        try {
          localStorage.setItem(`visplay-view-session:${movie.id}`, nextSessionId);
        } catch {}
        setSessionId(nextSessionId);
      }
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

  const toggleFullscreen = async () => {
    const container = playerContainerRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!container || !video) return;

    try {
      const isFullscreenNow = Boolean(document.fullscreenElement || (video as any).webkitDisplayingFullscreen);
      if (!isFullscreenNow) {
        // Fullscreen the shared player component for every account type.
        if (container.requestFullscreen) {
          await container.requestFullscreen();
        } else if (video.webkitEnterFullscreen) {
          // iOS Safari uses its native video fullscreen UI.
          video.webkitEnterFullscreen();
        }

        setIsFullscreen(true);
        // Android browsers generally permit orientation lock only after fullscreen begins.
        try {
          const orientation = screen.orientation as ScreenOrientation & {
            lock?: (orientation: string) => Promise<void>;
          };
          if (orientation?.lock) {
            try {
              await orientation.lock('landscape');
            } catch {
              await orientation.lock('landscape-primary');
            }
          }
        } catch {
          // Some browsers and OS settings prohibit programmatic rotation.
          // Fullscreen remains available and the user can rotate the device manually.
        }
      } else {
        const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
        try { orientation?.unlock?.(); } catch { /* unsupported */ }
        if (document.fullscreenElement) await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (e) {
      console.error('Fullscreen could not be changed:', e);
    }
  };

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  const togglePiP = async () => {
    const video = videoRef.current as (HTMLVideoElement & {
      webkitSetPresentationMode?: (mode: string) => void;
      webkitPresentationMode?: string;
    }) | null;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPiPActive(false);
        return;
      }

      if (video.webkitSetPresentationMode && video.webkitPresentationMode === 'picture-in-picture') {
        video.webkitSetPresentationMode('inline');
        setIsPiPActive(false);
        return;
      }

      if (video.readyState < 1) {
        setPipNotice('Video is still loading. Start playback, then try Picture-in-Picture again.');
        setTimeout(() => setPipNotice(null), 3500);
        return;
      }

      if (document.pictureInPictureEnabled && 'requestPictureInPicture' in video) {
        await video.requestPictureInPicture();
        setIsPiPActive(true);
      } else if (video.webkitSetPresentationMode) {
        // Safari/iOS WebKit exposes PiP through presentation mode instead.
        video.webkitSetPresentationMode('picture-in-picture');
        setIsPiPActive(true);
      } else {
        setPipNotice('Picture-in-Picture is not supported by this browser or device.');
        setTimeout(() => setPipNotice(null), 3500);
      }
    } catch (err: any) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Start playback first, then tap Picture-in-Picture again.'
        : err?.name === 'SecurityError'
        ? 'Picture-in-Picture is restricted by this browser view.'
        : (err?.message || 'Picture-in-Picture is currently unavailable.');
      setPipNotice(msg);
      setTimeout(() => setPipNotice(null), 3500);
    }
  };

  // Purchase ₦100 Movie
  const handlePurchaseMovie = async () => {
    if (!user) {
      // Require sign-in before starting a movie-specific payment.
      openAuthModal('login');
      return;
    }

    setPurchaseError(null);
    setPurchasing(true);
    try {
      // Movie unlock is a direct Paystack purchase, separate from wallet deposits.
      const response = await fetch('/api/purchases/movie/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movie_id: movie.id }),
      });
      const checkout = await response.json().catch(() => ({} as any));
      if (!response.ok) throw new Error(checkout.error || 'Could not start movie payment. Please try again.');
      if (checkout.already_owned) {
        setPaywallReached(false);
        await onRefreshMovie();
        return;
      }
      if (!checkout.authorization_url) throw new Error('Secure checkout could not be started. Please try again.');
      // Persist the exact stop point before leaving for Paystack.
      try {
        localStorage.setItem(`visplay-position:${user.id}:${movie.id}`, String(Math.max(currentTime, FREE_PREVIEW_LIMIT)));
      } catch { /* Playback resume also uses server-side watch history. */ }
      window.location.assign(checkout.authorization_url);
    } catch (err: any) {
      const message = err instanceof TypeError && /fetch/i.test(err.message)
        ? 'Could not connect to the VisPlay payment server. Please try again. You have not been charged.'
        : (err.message || 'Payment setup failed. You have not been charged.');
      setPurchaseError(message);
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

  const handleCommentReaction = async (commentId: string, reaction: 'like' | 'dislike') => {
    if (!user) { openAuthModal('login'); return; }
    try {
      const response = await fetch(`/api/movies/${movie.id}/comments/${commentId}/reaction`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction }),
      });
      if (!response.ok) throw new Error('Could not save comment reaction.');
      const data = await response.json();
      setComments(current => current.map(comment => comment.id === commentId ? {
        ...comment, likes_count: data.likes_count, dislikes_count: data.dislikes_count,
        liked_by: data.liked_by, disliked_by: data.disliked_by,
      } : comment));
    } catch (error) { console.error(error); }
  };

  const handleSubmitReply = async (e: React.FormEvent, parentId: string) => {
    e.preventDefault();
    if (!user) { openAuthModal('login'); return; }
    if (!replyText.trim()) return;
    try {
      const response = await fetch(`/api/movies/${movie.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment_text: replyText.trim(), parent_id: parentId }),
      });
      if (response.ok) {
        const data = await response.json();
        setComments(current => [...current, data.comment]);
        setReplyText('');
        setReplyToId(null);
      }
    } catch (error) { console.error(error); }
  };

  const handleShareMovie = async () => {
    // A stable, dedicated deep link that opens this exact movie, not the current app page.
    const movieUrl = new URL(window.location.origin + '/');
    movieUrl.searchParams.set('watch', movie.id);
    const shareData = { title: movie.title, text: `Watch ${movie.title} on VisPlay`, url: movieUrl.toString() };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareData.url);
        alert('Sharing is not available in this browser. The movie link has been copied.');
      } else window.prompt('Copy this movie link to share:', shareData.url);
    } catch (error: any) {
      if (error?.name !== 'AbortError') console.error('Movie sharing failed:', error);
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

  // Mobile player gestures: double-tap either side to seek, vertical swipe to adjust volume/brightness.
  const handlePlayerTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (touch) {
      // Mark touch immediately so mobile browsers' synthetic mousemove doesn't
      // reveal controls just before the tap handler toggles them off again.
      lastTouchAtRef.current = Date.now();
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    }
  };

  const handlePlayerTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    // Taps on controls should activate the control, not toggle the overlay.
    if (event.target instanceof Element && event.target.closest('button, input')) {
      touchStartRef.current = null;
      return;
    }
    const touch = event.changedTouches[0];
    const start = touchStartRef.current;
    if (!touch || !start || !playerContainerRef.current) return;
    lastTouchAtRef.current = Date.now();
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const bounds = playerContainerRef.current.getBoundingClientRect();

    if (Math.abs(dy) > 35 && Math.abs(dy) > Math.abs(dx)) {
      if (tapTimeoutRef.current !== null) window.clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
      lastTapRef.current = null;
      const change = Math.min(0.25, Math.abs(dy) / Math.max(bounds.height, 1));
      if (start.x < bounds.left + bounds.width / 2) {
        setBrightness(value => Math.max(0.35, Math.min(1, value + (dy < 0 ? change : -change))));
        setGestureNotice('brightness');
      } else {
        const nextVolume = Math.max(0, Math.min(1, volume + (dy < 0 ? change * 2 : -change * 2)));
        setVolume(nextVolume);
        setIsMuted(nextVolume === 0);
        if (videoRef.current) { videoRef.current.volume = nextVolume; videoRef.current.muted = nextVolume === 0; }
        setGestureNotice('volume');
      }
      setShowControls(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3500);
      window.setTimeout(() => setGestureNotice(null), 900);
      touchStartRef.current = null;
      return;
    }

    if (Math.abs(dx) < 25 && Math.abs(dy) < 25) {
      const now = Date.now();
      const previous = lastTapRef.current;
      const tapX = touch.clientX - bounds.left;
      if (previous && now - previous.at < 300 && ((tapX < bounds.width / 2) === (previous.x < bounds.width / 2))) {
        if (tapTimeoutRef.current !== null) window.clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = null;
        const direction = tapX < bounds.width / 2 ? -10 : 10;
        const video = videoRef.current;
        if (video) {
          const maxTime = movie.is_purchased ? duration : FREE_PREVIEW_LIMIT;
          const next = Math.max(0, Math.min(maxTime, video.currentTime + direction));
          video.currentTime = next;
          setCurrentTime(next);
          if (!movie.is_purchased && next >= FREE_PREVIEW_LIMIT) setPaywallReached(true);
          setGestureNotice(direction < 0 ? 'backward' : 'forward');
          window.setTimeout(() => setGestureNotice(null), 900);
        }
        lastTapRef.current = null;
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3500);
      } else {
        lastTapRef.current = { at: now, x: tapX };
        if (tapTimeoutRef.current !== null) window.clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = window.setTimeout(() => {
          setShowControls(current => {
            const next = !current;
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
            if (next) {
              controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3500);
            }
            return next;
          });
          tapTimeoutRef.current = null;
        }, 300);
      }
    }
    touchStartRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (tapTimeoutRef.current !== null) window.clearTimeout(tapTimeoutRef.current);
    };
  }, []);

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
        className={`visplay-player ${isFullscreen ? 'fixed inset-0 z-[100] h-[100dvh] w-screen max-w-none rounded-none aspect-auto border-0' : 'sticky top-16 z-30 w-full max-w-none rounded-none aspect-video border-y'} bg-black overflow-hidden shadow-2xl group select-none`}
        onMouseMove={() => {
          // Ignore synthetic mouse movement generated by touch on mobile.
          if (Date.now() - lastTouchAtRef.current < 900) return;
          setShowControls(true);
          if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
          controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3500);
        }}
        onTouchStart={handlePlayerTouchStart}
        onTouchEnd={handlePlayerTouchEnd}
      >
        <video
          ref={videoRef}
          src={resolveMediaUrl(movie.video_url)}
          poster={resolveMediaUrl(movie.poster_url) || resolveMediaUrl(movie.backdrop_url)}
          className={`block w-full h-full ${fitScreen ? 'object-cover' : 'object-contain'} cursor-default`}
          style={{ filter: `brightness(${brightness})` }}
          playsInline
          width={1280}
          height={720}
          disablePictureInPicture={false}
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => {
            setIsVideoReady(true);
            if (videoRef.current && videoRef.current.duration) {
              setDuration(videoRef.current.duration);
              const savedPosition = Math.max(0, resumePositionRef.current || 0);
              if (savedPosition > 0) {
                const safePosition = movie.is_purchased ? Math.min(savedPosition, Math.max(0, videoRef.current.duration - 1)) : Math.min(savedPosition, FREE_PREVIEW_LIMIT);
                videoRef.current.currentTime = safePosition;
                setCurrentTime(safePosition);
                if (hasPendingPaymentResumeRef.current) {
                  try { localStorage.removeItem(`visplay-resume-after-payment:${user?.id || 'guest'}:${movie.id}`); } catch { /* Optional cache cleanup. */ }
                  hasPendingPaymentResumeRef.current = false;
                }
                if (!movie.is_purchased && savedPosition >= FREE_PREVIEW_LIMIT) {
                  videoRef.current.pause();
                  setIsPlaying(false);
                  setPaywallReached(true);
                }
              }
            }
          }}
          onCanPlay={() => { setIsVideoReady(true); setVideoLoadError(false); }}
          onError={() => { setIsPlaying(false); setIsVideoReady(false); setVideoLoadError(true); }}
          onEnded={() => {
            setIsPlaying(false);
            trackViewingEvent(duration, true, true);
          }}
          onClick={(event) => {
            // Mobile browsers synthesize a click after touch; the touch handler already
            // manages that tap, so don't override its show/hide toggle.
            if (Date.now() - lastTouchAtRef.current < 500) return;
            // Playback changes only through the explicit Play/Pause control.
            event.preventDefault();
            event.stopPropagation();
            setShowControls(current => {
              const next = !current;
              if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
              if (next) controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3500);
              return next;
            });
          }}
        />

        {showControls && !paywallReached && !videoLoadError && (
          <button
            type="button"
            aria-label={isPlaying ? 'Pause movie' : 'Play movie'}
            onClick={(event) => { event.stopPropagation(); handlePlayPause(); }}
            className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-black/55 border border-white/30 text-white shadow-xl backdrop-blur-sm flex items-center justify-center"
          >
            {isPlaying ? <Pause className="w-5 h-5 sm:w-6 sm:h-6" /> : <Play className="w-5 h-5 sm:w-6 sm:h-6 ml-0.5" />}
          </button>
        )}

        {gestureNotice && (
          <div className={`absolute z-40 pointer-events-none flex flex-col items-center gap-3 rounded-2xl border border-white/15 bg-black/75 px-5 py-4 text-white shadow-xl ${gestureNotice === 'brightness' ? 'left-5 top-1/2 -translate-y-1/2' : gestureNotice === 'volume' ? 'right-5 top-1/2 -translate-y-1/2' : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'}`}>
            {gestureNotice === 'backward' ? (
              <><RotateCcw className="h-8 w-8" /><span className="text-sm font-semibold">10 seconds</span></>
            ) : gestureNotice === 'forward' ? (
              <><RotateCw className="h-8 w-8" /><span className="text-sm font-semibold">10 seconds</span></>
            ) : gestureNotice === 'brightness' ? (
              <><Sun className="h-5 w-5" /><div className="h-28 w-2 overflow-hidden rounded-full bg-white/25 flex items-end"><div className="w-full rounded-full bg-cyan-300" style={{ height: `${brightness * 100}%` }} /></div></>
            ) : (
              <><Volume2 className="h-5 w-5" /><div className="h-28 w-2 overflow-hidden rounded-full bg-white/25 flex items-end"><div className="w-full rounded-full bg-cyan-300" style={{ height: `${(isMuted ? 0 : volume) * 100}%` }} /></div></>
            )}
          </div>
        )}
        {showControls && isPlaying && (
          <div className="absolute inset-0 z-20 flex items-center justify-center gap-20 sm:gap-28 pointer-events-none">
            <button type="button" onClick={(event) => { event.stopPropagation(); const video = videoRef.current; if (!video) return; const next = Math.max(0, video.currentTime - 10); video.currentTime = next; setCurrentTime(next); setGestureNotice('backward'); window.setTimeout(() => setGestureNotice(null), 1000); }} className="pointer-events-auto flex h-14 w-14 flex-col items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65" aria-label="Rewind 10 seconds"><RotateCcw className="h-6 w-6" /><span className="text-[10px]">10</span></button>
            <button type="button" onClick={(event) => { event.stopPropagation(); const video = videoRef.current; if (!video) return; const maxTime = movie.is_purchased ? duration : FREE_PREVIEW_LIMIT; const next = Math.min(maxTime, video.currentTime + 10); video.currentTime = next; setCurrentTime(next); if (!movie.is_purchased && next >= FREE_PREVIEW_LIMIT) setPaywallReached(true); setGestureNotice('forward'); window.setTimeout(() => setGestureNotice(null), 1000); }} className="pointer-events-auto flex h-14 w-14 flex-col items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65" aria-label="Forward 10 seconds"><RotateCw className="h-6 w-6" /><span className="text-[10px]">10</span></button>
          </div>
        )}

        {videoLoadError && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/90 px-6 text-center">
            <Film className="h-10 w-10 text-rose-300" />
            <p className="text-sm font-semibold text-white">This video could not be loaded.</p>
            <p className="max-w-md text-xs text-slate-300">Check your connection and try again. If it still fails, the uploaded video file may no longer be available on the server.</p>
            <button type="button" onClick={() => { setVideoLoadError(false); if (videoRef.current) { videoRef.current.load(); videoRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false)); } }} className="rounded-lg bg-white px-4 py-2 text-xs font-bold text-black">Try again</button>
          </div>
        )}

        {/* Picture-in-Picture notice/toast */}
        {pipNotice && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 border border-cyan-500/50 text-cyan-200 text-xs px-4 py-2 rounded-xl shadow-2xl backdrop-blur-md pointer-events-none animate-in fade-in duration-200 text-center max-w-sm">
            {pipNotice}
          </div>
        )}

        {/* ---------------- 5-MINUTE FREE PREVIEW PAYWALL OVERLAY ---------------- */}
        {paywallReached && !movie.is_purchased && (
          <div className="absolute inset-0 z-30 bg-[#07090e]/85 backdrop-blur-sm flex items-center justify-center p-2 sm:p-3 animate-in fade-in duration-300">
            <div className="max-w-[300px] w-full max-h-full overflow-y-auto bg-[#0d121d] border border-cyan-500/40 rounded-2xl p-3 sm:p-4 text-center shadow-2xl text-slate-100">
              <div className="w-9 h-9 mx-auto mb-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Lock className="w-4 h-4" />
              </div>

              <span className="text-[9px] font-semibold tracking-wider text-cyan-400 uppercase bg-cyan-950/80 border border-cyan-800 px-2 py-1 rounded-full">
                5-Minute Preview Ended
              </span>

              <h3 className="text-base sm:text-lg font-bold font-display text-white mt-2 mb-1 break-words">
                Unlock "{movie.title}"
              </h3>
              <p className="text-[11px] text-slate-300 mb-3">
                Enjoyed the first 5 minutes? Unlock the complete film for only{' '}
                <strong className="text-cyan-300 font-mono text-sm">₦100</strong>.
              </p>

              {/* Wallet info */}
              <div className="p-2 bg-slate-900 border border-slate-800 rounded-xl mb-3 flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Your VisPlay Wallet</span>
                <span className="font-bold text-cyan-300 font-mono text-sm">
                  ₦{(user?.wallet_balance || 0).toLocaleString()}
                </span>
              </div>

              {purchaseError && (
                <div className="mb-3 p-2 bg-rose-950/70 border border-rose-800 rounded-xl text-[11px]">
                  {purchaseError}
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  onClick={handlePurchaseMovie}
                  disabled={purchasing}
                  className="w-full py-2.5 px-3 rounded-xl font-bold text-xs bg-gradient-to-r from-cyan-500 via-blue-600 to-fuchsia-600 hover:from-cyan-400 hover:to-fuchsia-500 text-white shadow-lg shadow-cyan-500/25 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
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
                  className="w-full py-2 px-3 rounded-xl text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors flex items-center justify-center gap-2"
                >
                  <Coins className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Add Coins</span>
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
                max={duration}
                step={0.5}
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1.5 bg-slate-700/80 rounded-lg appearance-none cursor-pointer accent-cyan-400 hover:h-2.5 transition-all"
              />
              {/* Show the actual movie timeline; mark where the free preview ends. */}
              {!movie.is_purchased && duration > FREE_PREVIEW_LIMIT && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400 ring-2 ring-cyan-500/50 pointer-events-none"
                  style={{ left: `${Math.min(100, (FREE_PREVIEW_LIMIT / duration) * 100)}%` }}
                  title="Free preview ends at 5:00"
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
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Right Controls: fit/fill, PiP & fullscreen */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setFitScreen(value => !value);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] font-extrabold tracking-wide transition-colors ${fitScreen ? 'border-cyan-400/50 bg-cyan-950/70 text-cyan-200' : 'border-slate-700 bg-slate-900/80 text-slate-200 hover:border-cyan-400/50 hover:text-white'}`}
                  title={fitScreen ? 'Switch to FIT: show the whole picture' : 'Switch to FILL: use more of the screen, cropping edges if needed'}
                  aria-label={fitScreen ? 'Switch video to fit mode' : 'Switch video to fill mode'}
                  aria-pressed={fitScreen}
                >
                  <Crop className="h-4 w-4" />
                  <span>{fitScreen ? 'FIT' : 'FILL'}</span>
                </button>
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
              onClick={handleToggleSaved}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${isSaved ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300' : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'}`}
              title={isSaved ? 'Remove from saved movies' : 'Save movie'}
              aria-label={isSaved ? 'Remove from saved movies' : 'Save movie'}
            >
              <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-cyan-400' : ''}`} />
              <span className="hidden sm:inline">{isSaved ? 'Saved' : 'Save'}</span>
            </button>
            <button
              onClick={handleShareMovie}
              className="flex items-center justify-center w-11 h-11 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/40 transition-colors"
              title="Share movie"
              aria-label="Share movie"
            >
              <Share2 className="w-5 h-5" />
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
        <div className="flex items-center gap-6 border-b border-slate-800 pb-3">
          <h3 className="relative text-base font-bold text-white flex items-center gap-2 after:absolute after:-bottom-[13px] after:left-0 after:right-0 after:h-0.5 after:bg-cyan-400">
            <MessageCircle className="w-4 h-4 text-cyan-300" />
            <span>Comments</span>
            <span className="text-xs text-slate-400 font-mono">({comments.length})</span>
          </h3>
          <span className="text-sm text-slate-400">For you</span>
        </div>

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
            comments.filter(c => !c.parent_id).map((c) => (
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
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
                    <button type="button" onClick={() => handleCommentReaction(c.id, 'like')} className={`inline-flex items-center gap-1 ${user && c.liked_by?.includes(user.id) ? 'text-cyan-300' : 'text-slate-400'}`}>
                      <ThumbsUp className="w-3.5 h-3.5" /> {c.likes_count || 0}
                    </button>
                    <button type="button" onClick={() => handleCommentReaction(c.id, 'dislike')} className={`inline-flex items-center gap-1 ${user && c.disliked_by?.includes(user.id) ? 'text-rose-300' : 'text-slate-400'}`}>
                      <ThumbsDown className="w-3.5 h-3.5" /> {c.dislikes_count || 0}
                    </button>
                    <button type="button" onClick={() => setReplyToId(replyToId === c.id ? null : c.id)} className="inline-flex items-center gap-1 text-slate-400 hover:text-cyan-300">
                      <MessageCircle className="w-3.5 h-3.5" /> Reply
                    </button>
                  </div>
                  {replyToId === c.id && (
                    <form onSubmit={(e) => handleSubmitReply(e, c.id)} className="mt-3 flex gap-2">
                      <input value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Write a reply..." className="min-w-0 flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs" />
                      <button type="submit" disabled={!replyText.trim()} className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-50">Reply</button>
                    </form>
                  )}
                  <div className="mt-3 ml-2 space-y-2 border-l border-slate-700 pl-3">
                    {comments.filter(reply => reply.parent_id === c.id).map(reply => (
                      <div key={reply.id} className="rounded-lg bg-slate-950/70 p-3">
                        <span className="text-[11px] font-semibold text-white">{reply.user_name}</span>
                        <p className="mt-1 text-xs text-slate-300">{reply.comment_text}</p>
                        <div className="mt-2 flex gap-3 text-[11px]">
                          <button type="button" onClick={() => handleCommentReaction(reply.id, 'like')} className="inline-flex items-center gap-1 text-slate-400"><ThumbsUp className="w-3 h-3" /> {reply.likes_count || 0}</button>
                          <button type="button" onClick={() => handleCommentReaction(reply.id, 'dislike')} className="inline-flex items-center gap-1 text-slate-400"><ThumbsDown className="w-3 h-3" /> {reply.dislikes_count || 0}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
