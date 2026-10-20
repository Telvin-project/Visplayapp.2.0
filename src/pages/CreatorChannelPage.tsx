import React, { useState, useEffect } from 'react';
import { CreatorProfile, Movie } from '../types';
import { useAuth } from '../context/AuthContext';
import { MovieCard } from '../components/MovieCard';
import { ArrowLeft, UserPlus, UserCheck, Film, Users, ShieldCheck } from 'lucide-react';

interface CreatorChannelPageProps {
  creatorId: string;
  onBack: () => void;
  onSelectMovie: (id: string) => void;
}

export const CreatorChannelPage: React.FC<CreatorChannelPageProps> = ({
  creatorId,
  onBack,
  onSelectMovie,
}) => {
  const { user, openAuthModal } = useAuth();
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [followersCount, setFollowersCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChannel();
  }, [creatorId, user?.id]);

  const fetchChannel = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/creators/channel/${creatorId}`);
      if (res.ok) {
        const data = await res.json();
        setCreator(data.creator);
        setMovies(data.movies || []);
        setFollowersCount(data.followers_count || 0);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFollow = async () => {
    if (!user) {
      openAuthModal('login');
      return;
    }
    try {
      const res = await fetch(`/api/creators/follow/${creatorId}`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setIsFollowing(data.is_following);
        setFollowersCount(data.followers_count);
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center space-y-3">
        <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-400">Loading creator channel...</p>
      </div>
    );
  }

  if (!creator) {
    return (
      <div className="py-16 text-center bg-[#0d121d] rounded-3xl border border-slate-800 p-8 max-w-md mx-auto space-y-3">
        <h3 className="text-base font-bold text-white">Creator Channel Not Found</h3>
        <button onClick={onBack} className="py-2 px-4 bg-slate-800 rounded-xl text-xs text-white">
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-16">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 py-2 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      {/* Channel Banner & Header */}
      <div className="relative rounded-3xl overflow-hidden bg-[#0d121d] border border-slate-800 shadow-2xl">
        {/* Banner */}
        <div className="h-44 sm:h-56 w-full relative bg-slate-900">
          <img
            src={creator.channel_banner_url || '/posters/lagos_heist.jpg'}
            alt="Banner"
            className="w-full h-full object-cover filter brightness-60"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0d121d] via-transparent to-transparent" />
        </div>

        {/* Profile Info Overlay */}
        <div className="px-6 sm:px-8 pb-8 pt-4 flex flex-col sm:flex-row items-center sm:items-end justify-between gap-4 -mt-16 sm:-mt-20 relative z-10 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <img
              src={creator.channel_avatar_url || '/visplay-symbol.png'}
              alt={creator.channel_name}
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl object-cover border-4 border-[#0d121d] shadow-2xl bg-slate-900"
            />
            <div className="space-y-1">
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <h1 className="text-xl sm:text-2xl font-bold font-display text-white">
                  {creator.channel_name}
                </h1>
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
              </div>
              <p className="text-xs text-cyan-400 font-medium">{creator.content_type}</p>
              <div className="flex items-center justify-center sm:justify-start gap-2 text-xs text-slate-400 font-mono">
                <span>{followersCount} Followers</span>
                <span>·</span>
                <span>{movies.length} Films</span>
              </div>
            </div>
          </div>

          <button
            onClick={handleToggleFollow}
            className={`py-2.5 px-5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              isFollowing
                ? 'bg-slate-800 text-slate-300 border border-slate-700'
                : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md'
            }`}
          >
            {isFollowing ? (
              <>
                <UserCheck className="w-4 h-4" />
                <span>Following (Free)</span>
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                <span>Follow Channel (Free)</span>
              </>
            )}
          </button>
        </div>

        {creator.description && (
          <div className="px-6 sm:px-8 pb-6 border-t border-slate-800/60 pt-4">
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">{creator.description}</p>
          </div>
        )}
      </div>

      {/* Movies from this Channel */}
      <div className="space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Film className="w-5 h-5 text-cyan-400" />
          <span>Films by {creator.channel_name}</span>
          <span className="text-xs text-slate-400 font-mono">({movies.length})</span>
        </h3>

        {movies.length === 0 ? (
          <p className="text-xs text-slate-500 py-6">No published films on this channel yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {movies.map((m) => (
              <MovieCard
                key={m.id}
                movie={m}
                onSelectMovie={onSelectMovie}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
