import React from 'react';
import { Movie } from '../types';
import { Play, Clock, CheckCircle2, Eye, Heart } from 'lucide-react';

const resolvePosterUrl = (url?: string | null) => {
  if (!url) return '/posters/lagos_heist.jpg';
  // Uploaded files are routed through the app's /uploads rewrite.
  return url;
};

interface MovieCardProps {
  movie: Movie;
  onSelectMovie: (id: string) => void;
  onSelectCreator?: (creatorId: string) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({ movie, onSelectMovie, onSelectCreator }) => {
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hrs > 0) return `${hrs}h ${remMins}m`;
    return `${mins}m`;
  };

  return (
    <div className="group relative flex flex-col rounded-2xl bg-[#0d121d] border border-slate-800/80 overflow-hidden hover:border-cyan-500/50 hover:shadow-xl hover:shadow-cyan-950/20 transition-all duration-300">
      {/* Poster area */}
      <div
        onClick={() => onSelectMovie(movie.id)}
        className="relative aspect-[3/4] w-full overflow-hidden bg-slate-900 cursor-pointer"
      >
        <img
          src={resolvePosterUrl(movie.poster_url)}
          alt={movie.title}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/posters/lagos_heist.jpg';
          }}
        />

        {/* Ambient Gradient Scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0d121d] via-transparent to-black/30 pointer-events-none" />

        {/* Top Badges */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none">
          {movie.is_purchased ? (
            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-300 bg-emerald-950/90 border border-emerald-700/80 backdrop-blur-md px-2 py-0.5 rounded-lg">
              <CheckCircle2 className="w-3 h-3" />
              <span>UNLOCKED</span>
            </span>
          ) : (
            <span className="text-[11px] font-semibold text-cyan-200 bg-cyan-950/90 border border-cyan-800/80 backdrop-blur-md px-2 py-0.5 rounded-lg font-mono">
              ₦{movie.price_ngn || 100}
            </span>
          )}

          <span className="text-[10px] font-medium text-slate-300 bg-slate-900/90 border border-slate-800/80 backdrop-blur-md px-2 py-0.5 rounded-lg flex items-center gap-1">
            <Clock className="w-3 h-3 text-cyan-400" />
            <span>5m Free Preview</span>
          </span>
        </div>

        {/* Hover / Active Play Button Overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-[2px]">
          <div className="w-12 h-12 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-xl transform scale-90 group-hover:scale-100 transition-transform">
            <Play className="w-5 h-5 ml-0.5 fill-white" />
          </div>
        </div>
      </div>

      {/* Info Content */}
      <div className="p-3.5 flex flex-col flex-1 justify-between">
        <div>
          {/* Metadata clean text */}
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1">
            <span className="text-cyan-400 font-medium">{movie.genre}</span>
            <span aria-hidden="true">·</span>
            <span>{movie.release_year}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDuration(movie.duration_seconds)}</span>
          </div>

          {/* Title */}
          <h4
            onClick={() => onSelectMovie(movie.id)}
            className="text-sm font-bold text-white line-clamp-1 hover:text-cyan-400 transition-colors cursor-pointer"
            title={movie.title}
          >
            {movie.title}
          </h4>
        </div>

        {/* Creator Row & Views */}
        <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-xs">
          <div
            onClick={(e) => {
              e.stopPropagation();
              onSelectCreator?.(movie.creator_id);
            }}
            className="flex items-center gap-2 cursor-pointer group/creator"
          >
            <img
              src={movie.creator_avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'}
              alt={movie.creator_name || 'Creator'}
              className="w-5 h-5 rounded-full object-cover border border-slate-700"
            />
            <span className="text-[11px] text-slate-300 font-medium group-hover/creator:text-cyan-300 truncate max-w-[110px]">
              {movie.creator_name || 'Nollywood Studio'}
            </span>
          </div>

          <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
            <Eye className="w-3 h-3 text-slate-400" />
            <span>{(movie.views_count || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
