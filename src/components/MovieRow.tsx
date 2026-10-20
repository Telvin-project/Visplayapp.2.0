import React, { useRef } from 'react';
import { Movie } from '../types';
import { MovieCard } from './MovieCard';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MovieRowProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: string;
  movies: Movie[];
  onSelectMovie: (id: string) => void;
  onSelectCreator?: (creatorId: string) => void;
}

export const MovieRow: React.FC<MovieRowProps> = ({
  title,
  subtitle,
  icon,
  badge,
  movies,
  onSelectMovie,
  onSelectCreator,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);

  if (!movies || movies.length === 0) return null;

  const scroll = (direction: 'left' | 'right') => {
    if (rowRef.current) {
      const scrollAmount = rowRef.current.clientWidth * 0.75;
      rowRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  return (
    <section className="space-y-3 relative group/row">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2.5">
          {icon && <div className="shrink-0">{icon}</div>}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-bold font-display text-white tracking-tight">
                {title}
              </h2>
              {badge && (
                <span className="text-[10px] font-bold text-cyan-300 bg-cyan-950/80 border border-cyan-800/80 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  {badge}
                </span>
              )}
            </div>
            {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>

        {/* Desktop Arrow Scroll Controls */}
        <div className="hidden sm:flex items-center gap-1.5 opacity-80 group-hover/row:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => scroll('left')}
            aria-label={`Scroll ${title} left`}
            className="w-8 h-8 rounded-full bg-slate-900/90 hover:bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 hover:text-white transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scroll('right')}
            aria-label={`Scroll ${title} right`}
            className="w-8 h-8 rounded-full bg-slate-900/90 hover:bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 hover:text-white transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Horizontal Swipeable Track */}
      <div
        ref={rowRef}
        className="flex gap-4 overflow-x-auto no-scrollbar scroll-smooth snap-x snap-mandatory py-2 px-1 -mx-1"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {movies.map((movie) => (
          <div
            key={movie.id}
            className="w-[180px] sm:w-[210px] md:w-[230px] shrink-0 snap-start"
          >
            <MovieCard
              movie={movie}
              onSelectMovie={onSelectMovie}
              onSelectCreator={onSelectCreator}
            />
          </div>
        ))}
      </div>
    </section>
  );
};
