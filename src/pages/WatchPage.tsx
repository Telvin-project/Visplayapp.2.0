import React, { useState, useEffect } from 'react';
import { Movie, CreatorProfile } from '../types';
import { WatchPlayer } from '../components/WatchPlayer';
import { MovieCard } from '../components/MovieCard';
import { ArrowLeft, Film, AlertCircle } from 'lucide-react';

interface WatchPageProps {
  movieId: string;
  onBack: () => void;
  onSelectMovie: (id: string) => void;
  onSelectCreator: (id: string) => void;
}

export const WatchPage: React.FC<WatchPageProps> = ({
  movieId,
  onBack,
  onSelectMovie,
  onSelectCreator,
}) => {
  const [movie, setMovie] = useState<Movie | null>(null);
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [relatedMovies, setRelatedMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMovieDetails();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [movieId]);

  const fetchMovieDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/movies/${movieId}`);
      if (!res.ok) {
        throw new Error('Movie not found or failed to load');
      }
      const data = await res.json();
      setMovie(data.movie);
      setCreator(data.creator);
      setRelatedMovies(data.related || []);
    } catch (err: any) {
      setError(err.message || 'Error loading movie');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center space-y-4">
        <div className="w-12 h-12 border-3 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-400">Loading cinematic stream...</p>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="py-16 text-center space-y-4 bg-[#0d121d] rounded-3xl border border-slate-800 p-8 max-w-lg mx-auto">
        <AlertCircle className="w-12 h-12 text-rose-400 mx-auto" />
        <h3 className="text-lg font-bold text-white">Playback Error</h3>
        <p className="text-xs text-slate-400">{error || 'Movie could not be found.'}</p>
        <button
          onClick={onBack}
          className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold"
        >
          Return to Browse
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-16">
      {/* Back button */}
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 py-2 px-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Discovery</span>
        </button>
      </div>

      {/* Main Watch Player with 5-minute Preview & N100 Paywall */}
      <WatchPlayer
        movie={movie}
        creator={creator}
        onRefreshMovie={fetchMovieDetails}
        onSelectMovie={onSelectMovie}
        onSelectCreator={onSelectCreator}
      />

      {/* Related Movies from the Creator */}
      {relatedMovies.length > 0 && (
        <section className="space-y-4 pt-4 border-t border-slate-800/80">
          <h3 className="text-lg font-bold font-display text-white flex items-center gap-2">
            <Film className="w-5 h-5 text-cyan-400" />
            <span>More from {creator?.channel_name || 'this filmmaker'}</span>
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {relatedMovies.map((rel) => (
              <MovieCard
                key={rel.id}
                movie={rel}
                onSelectMovie={onSelectMovie}
                onSelectCreator={onSelectCreator}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
