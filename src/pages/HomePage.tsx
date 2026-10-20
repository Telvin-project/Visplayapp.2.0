import React, { useState, useEffect } from 'react';
import { Movie, EpisodeBundle, Livestream, Premiere } from '../types';
import { MovieCard } from '../components/MovieCard';
import {
  Play,
  Clock,
  Sparkles,
  Tv,
  Radio,
  Calendar,
  CheckCircle2,
  ChevronRight,
  TrendingUp,
  Flame,
  ShieldCheck,
  Video,
} from 'lucide-react';

interface HomePageProps {
  onSelectMovie: (id: string) => void;
  onSelectCreator: (id: string) => void;
  onSelectBundle: (id: string) => void;
  searchQuery: string;
}

export const HomePage: React.FC<HomePageProps> = ({
  onSelectMovie,
  onSelectCreator,
  onSelectBundle,
  searchQuery,
}) => {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [bundles, setBundles] = useState<EpisodeBundle[]>([]);
  const [livestreams, setLivestreams] = useState<Livestream[]>([]);
  const [premieres, setPremieres] = useState<Premiere[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>('All');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchContent();
  }, [selectedGenre, searchQuery]);

  const fetchContent = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedGenre !== 'All') params.append('genre', selectedGenre);
      if (searchQuery) params.append('search', searchQuery);

      const [moviesRes, bundlesRes, liveRes, premRes] = await Promise.all([
        fetch(`/api/movies?${params.toString()}`),
        fetch('/api/bundles'),
        fetch('/api/livestreams'),
        fetch('/api/premieres'),
      ]);

      if (moviesRes.ok) {
        const mData = await moviesRes.json();
        // Exclude episodes that belong to bundles from the standalone film shelf
        setMovies(mData.movies.filter((m: Movie) => !m.is_bundle_only));
      }
      if (bundlesRes.ok) {
        const bData = await bundlesRes.json();
        setBundles(bData.bundles || []);
      }
      if (liveRes.ok) {
        const lData = await liveRes.json();
        setLivestreams(lData.livestreams || []);
      }
      if (premRes.ok) {
        const pData = await premRes.json();
        setPremieres(pData.premieres || []);
      }
    } catch (err) {
      console.error('Error fetching homepage content:', err);
    } finally {
      setLoading(false);
    }
  };

  const genres = [
    'All',
    'Action & Crime',
    'Historical & Epic',
    'Romance & Drama',
    'Sci-Fi & Thriller',
  ];

  // Lead spotlight film
  const heroMovie = movies.find(m => m.id === 'mov_lagos_syndicate') || movies[0];

  return (
    <div className="space-y-10 pb-16">
      {/* ---------------- CINEMATIC HERO SPOTLIGHT ---------------- */}
      {heroMovie && !searchQuery && (
        <div className="relative rounded-3xl overflow-hidden border border-slate-800/80 bg-gradient-to-r from-slate-950 to-slate-900 shadow-2xl">
          {/* Backdrop Image with Scrim */}
          <div className="absolute inset-0">
            <img
              src={heroMovie.poster_url || '/posters/lagos_heist.jpg'}
              alt={heroMovie.title}
              className="w-full h-full object-cover object-center opacity-35 filter brightness-75 scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#07090e] via-[#07090e]/70 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#07090e] via-[#07090e]/80 to-transparent" />
          </div>

          {/* Hero Content */}
          <div className="relative z-10 px-6 sm:px-10 lg:px-14 py-12 sm:py-20 max-w-2xl space-y-4">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span className="text-cyan-400 font-semibold uppercase tracking-wider">Spotlight Release</span>
              <span>·</span>
              <span>{heroMovie.genre}</span>
              <span>·</span>
              <span>{heroMovie.release_year}</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-black font-display text-white tracking-tight leading-tight">
              {heroMovie.title}
            </h1>

            <p className="text-sm sm:text-base text-slate-300 line-clamp-3 leading-relaxed">
              {heroMovie.synopsis}
            </p>

            {/* Pricing Value Callout */}
            <div className="flex items-center gap-3 text-xs text-slate-300 pt-1">
              <span className="font-bold text-cyan-300 font-mono text-sm">₦100 Full Unlock</span>
              <span>·</span>
              <span className="flex items-center gap-1 text-slate-400">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>5-Minute Free Preview</span>
              </span>
              <span>·</span>
              <span className="text-fuchsia-400 font-medium">85% to Filmmaker</span>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <button
                onClick={() => onSelectMovie(heroMovie.id)}
                className="py-3 px-6 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-500 via-blue-600 to-fuchsia-600 hover:from-cyan-400 hover:to-fuchsia-500 text-white shadow-xl shadow-cyan-500/20 active:scale-95 transition-all flex items-center gap-2"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Watch 5m Preview Free</span>
              </button>

              <button
                onClick={() => onSelectCreator(heroMovie.creator_id)}
                className="py-3 px-5 rounded-xl font-semibold text-xs bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-200 transition-colors"
              >
                View Channel: {heroMovie.creator_name}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- GENRE FILTER BAR (Interactive Controls) ---------------- */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
        {genres.map((g) => {
          const isActive = selectedGenre === g;
          return (
            <button
              key={g}
              onClick={() => setSelectedGenre(g)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20'
                  : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
              }`}
            >
              {g}
            </button>
          );
        })}
      </div>

      {/* ---------------- 10-EPISODE BUNDLES SPOTLIGHT (₦700) ---------------- */}
      {bundles.length > 0 && !searchQuery && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tv className="w-5 h-5 text-fuchsia-400" />
              <h2 className="text-lg sm:text-xl font-bold font-display text-white">
                10-Episode Serialized Sagas
              </h2>
            </div>
            <span className="text-xs text-fuchsia-300 font-medium">₦700 Complete Season Pass</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bundles.map((bundle) => (
              <div
                key={bundle.id}
                onClick={() => onSelectBundle(bundle.id)}
                className="group relative rounded-3xl bg-gradient-to-br from-[#0e1424] to-[#120f24] border border-fuchsia-900/40 hover:border-fuchsia-500/60 p-5 sm:p-6 transition-all cursor-pointer shadow-lg hover:shadow-fuchsia-950/30 flex flex-col sm:flex-row gap-5 items-center"
              >
                <div className="relative w-full sm:w-36 aspect-[3/4] shrink-0 rounded-2xl overflow-hidden bg-slate-900 shadow-md">
                  <img
                    src={bundle.poster_url || '/posters/lagos_heist.jpg'}
                    alt={bundle.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <span className="absolute top-2 left-2 text-[10px] font-bold text-white bg-fuchsia-600/90 px-2 py-0.5 rounded-md backdrop-blur-sm">
                    10 EPISODES
                  </span>
                </div>

                <div className="flex-1 space-y-2.5 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-2 text-[11px] text-fuchsia-300">
                    <span className="font-semibold">Full Series Bundle</span>
                    <span>·</span>
                    <span>10 Episodes</span>
                    <span>·</span>
                    <span className="font-bold font-mono text-cyan-300">₦700 Total</span>
                  </div>

                  <h3 className="text-base sm:text-lg font-bold text-white group-hover:text-fuchsia-300 transition-colors">
                    {bundle.title}
                  </h3>

                  <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                    {bundle.description}
                  </p>

                  <div className="pt-2 flex items-center justify-center sm:justify-start gap-2">
                    <span className="py-2 px-4 rounded-xl text-xs font-bold bg-fuchsia-600 hover:bg-fuchsia-500 text-white flex items-center gap-1.5 shadow-md">
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>{bundle.is_purchased ? 'Watch Series' : 'Explore Bundle (₦700)'}</span>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------------- MAIN MOVIE DISCOVERY SHELF ---------------- */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg sm:text-xl font-bold font-display text-white">
              {searchQuery ? `Search Results for "${searchQuery}"` : 'Nollywood Blockbusters & New Releases'}
            </h2>
          </div>
          <span className="text-xs text-slate-400 font-mono">₦100 per movie</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="aspect-[3/4] rounded-2xl bg-slate-900/60 animate-pulse border border-slate-800" />
            ))}
          </div>
        ) : movies.length === 0 ? (
          <div className="py-12 text-center bg-[#0d121d] rounded-3xl border border-slate-800">
            <p className="text-sm text-slate-400">No movies found matching your selection.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {movies.map((movie) => (
              <MovieCard
                key={movie.id}
                movie={movie}
                onSelectMovie={onSelectMovie}
                onSelectCreator={onSelectCreator}
              />
            ))}
          </div>
        )}
      </section>

      {/* ---------------- LIVE & UPCOMING PREMIERES ---------------- */}
      {!searchQuery && (livestreams.length > 0 || premieres.length > 0) && (
        <section className="space-y-4 pt-4 border-t border-slate-800/60">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-rose-500 animate-pulse" />
            <h2 className="text-lg sm:text-xl font-bold font-display text-white">
              Live Sets & Upcoming Premieres
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {livestreams.map((ls) => (
              <div
                key={ls.id}
                className="p-5 bg-gradient-to-r from-rose-950/20 to-slate-900/60 border border-rose-900/40 rounded-3xl flex items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-300 bg-rose-950/80 border border-rose-800 px-2 py-0.5 rounded-md uppercase">
                      <Radio className="w-3 h-3 text-rose-400 animate-ping" />
                      LIVE NOW
                    </span>
                    <span className="text-xs text-slate-400 font-mono">{ls.viewer_count} watching</span>
                  </div>
                  <h4 className="text-sm font-bold text-white">{ls.title}</h4>
                  <p className="text-xs text-slate-400">{ls.creator_name}</p>
                </div>

                <button
                  onClick={() => onSelectMovie('mov_lagos_syndicate')}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shrink-0"
                >
                  Tune In
                </button>
              </div>
            ))}

            {premieres.map((prem) => (
              <div
                key={prem.id}
                className="p-5 bg-gradient-to-r from-cyan-950/20 to-slate-900/60 border border-cyan-900/40 rounded-3xl flex items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-300 bg-cyan-950/80 border border-cyan-800 px-2 py-0.5 rounded-md uppercase">
                      <Calendar className="w-3 h-3 text-cyan-400" />
                      PREMIERE COUNTDOWN
                    </span>
                    <span className="text-xs text-slate-400">Nov 2026</span>
                  </div>
                  <h4 className="text-sm font-bold text-white">{prem.movie_title}</h4>
                  <p className="text-xs text-slate-400">{prem.creator_name}</p>
                </div>

                <button
                  onClick={() => onSelectMovie(prem.movie_id)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-xl text-xs font-bold transition-all shrink-0"
                >
                  Set Reminder
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------------- CREATOR REVENUE PROMISE FOOTER BANNER ---------------- */}
      <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-cyan-950/40 via-slate-900 to-fuchsia-950/40 border border-slate-800/80 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-1 text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start gap-2 text-cyan-400 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Fair African Creator Economics</span>
          </div>
          <h3 className="text-lg font-bold text-white">Filmmakers Keep 85% of All Box-Office Coins</h3>
          <p className="text-xs text-slate-400 max-w-xl">
            VisPlay charges only a 15% platform maintenance fee. Support authentic Nollywood storytelling directly from Lagos, Abuja, and Accra.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right hidden sm:block">
            <span className="block text-xs text-slate-400 font-mono">VisPlay by</span>
            <span className="text-sm font-bold text-white">Visibyl Technologies</span>
          </div>
        </div>
      </div>
    </div>
  );
};
