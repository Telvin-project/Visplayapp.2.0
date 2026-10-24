import React, { useState, useEffect } from 'react';
import { Movie, EpisodeBundle, Livestream, Premiere, CreatorProfile } from '../types';
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
  Users,
  Coins,
  Film,
  Award,
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
  const [featuredMovie, setFeaturedMovie] = useState<Movie | null>(null);
  const [bundles, setBundles] = useState<EpisodeBundle[]>([]);
  const [livestreams, setLivestreams] = useState<Livestream[]>([]);
  const [premieres, setPremieres] = useState<Premiere[]>([]);
  const [creators, setCreators] = useState<CreatorProfile[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>('All');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'trending' | 'new' | 'top_paid'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchContent();
  }, [selectedGenre, selectedCategory, searchQuery]);

  const fetchContent = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedGenre !== 'All') params.append('genre', selectedGenre);
      if (selectedCategory !== 'all') params.append('category', selectedCategory);
      if (searchQuery) params.append('search', searchQuery);

      const [moviesRes, featRes, bundlesRes, liveRes, premRes, creatorsRes] = await Promise.all([
        fetch(`/api/movies?${params.toString()}`),
        fetch('/api/movies/featured').catch(() => null),
        fetch('/api/bundles'),
        fetch('/api/livestreams'),
        fetch('/api/premieres'),
        fetch('/api/creators'),
      ]);

      if (moviesRes.ok) {
        const mData = await moviesRes.json();
        // Exclude episodes that belong to bundles from the standalone film shelf
        setMovies(mData.movies.filter((m: Movie) => !m.is_bundle_only));
      }
      if (featRes && featRes.ok) {
        const fData = await featRes.json();
        setFeaturedMovie(fData.movie || null);
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
      if (creatorsRes.ok) {
        const cData = await creatorsRes.json();
        setCreators(cData.creators || []);
      }
    } catch (err) {
      console.error('Error fetching homepage content:', err);
    } finally {
      setLoading(false);
    }
  };

  const genres = ['All', 'Drama', 'Comedy', 'Action', 'Romance', 'Thriller', 'Horror', 'Documentary', 'Series'];

  // Lead spotlight film from super admin setting or fallback
  const heroMovie = featuredMovie || movies.find(m => m.id === 'mov_lagos_syndicate') || movies[0];

  return (
    <div className="space-y-10 pb-16">
      {/* ---------------- ADMIN-CURATED CINEMATIC HERO ---------------- */}
      {heroMovie && !searchQuery && (
        <section className="relative isolate overflow-hidden border-y border-slate-800/80 bg-[#07090e] shadow-2xl">
          <div className="absolute inset-0 -z-20">
            <img
              src={heroMovie.backdrop_url || heroMovie.poster_url || '/posters/lagos_heist.jpg'}
              alt=""
              aria-hidden="true"
              className="h-full w-full scale-105 object-cover object-center opacity-30 blur-[1px]"
            />
          </div>
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#07090e] via-[#07090e]/90 to-[#07090e]/55" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#07090e]/90 via-transparent to-[#07090e]/30" />

          <div className="mx-auto grid min-h-[300px] max-w-7xl grid-cols-1 items-center gap-7 px-5 py-8 sm:min-h-[360px] sm:grid-cols-[minmax(150px,230px)_1fr] sm:gap-10 sm:px-8 sm:py-10 lg:px-12">
            <button
              type="button"
              onClick={() => onSelectMovie(heroMovie.id)}
              className="group mx-auto w-36 overflow-hidden rounded-2xl border border-white/15 shadow-2xl shadow-black/50 transition-transform duration-300 hover:scale-[1.03] sm:mx-0 sm:w-full sm:max-w-[230px]"
              aria-label={`Watch ${heroMovie.title}`}
            >
              <img
                src={heroMovie.poster_url || heroMovie.backdrop_url || '/posters/lagos_heist.jpg'}
                alt={heroMovie.title}
                className="aspect-[2/3] w-full object-cover"
              />
            </button>

            <div className="mx-auto max-w-2xl space-y-3 text-center sm:mx-0 sm:text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200">
                <Sparkles className="h-3.5 w-3.5" /> Featured on VisPlay
              </div>
              <h1 className="text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
                {heroMovie.title}
              </h1>
              <button
                type="button"
                onClick={() => onSelectCreator(heroMovie.creator_id)}
                className="text-sm font-semibold text-slate-300 transition-colors hover:text-cyan-300"
              >
                {heroMovie.creator_name || 'Featured Creator'}
              </button>
              <p className="mx-auto line-clamp-2 max-w-xl text-sm leading-relaxed text-slate-300 sm:mx-0">
                {heroMovie.synopsis?.trim() || 'Discover this featured story, selected by the VisPlay team.'}
              </p>
              <div className="pt-2">
                <button
                  onClick={() => onSelectMovie(heroMovie.id)}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-600 to-fuchsia-600 px-6 py-3 text-sm font-bold text-white shadow-xl shadow-cyan-500/20 transition-all hover:brightness-110 active:scale-95"
                >
                  <Play className="h-4 w-4 fill-white" />
                  Watch Now
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ---------------- DISCOVERY & FILTER CONTROLS ---------------- */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Category Sorting Pills */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-900/90 border border-slate-800 rounded-xl">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              selectedCategory === 'all'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            All Films
          </button>
          <button
            onClick={() => setSelectedCategory('trending')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
              selectedCategory === 'trending'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Trending</span>
          </button>
          <button
            onClick={() => setSelectedCategory('new')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
              selectedCategory === 'new'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>New</span>
          </button>
          <button
            onClick={() => setSelectedCategory('top_paid')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
              selectedCategory === 'top_paid'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-rose-400" />
            <span>Top Unlocks</span>
          </button>
        </div>

        {/* Genre Filter Bar */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
          {genres.map((g) => {
            const isActive = selectedGenre === g;
            return (
              <button
                key={g}
                onClick={() => setSelectedGenre(g)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-slate-800 text-cyan-300 border border-cyan-500/50 shadow-sm'
                    : 'bg-slate-900/80 hover:bg-slate-800 text-slate-400 border border-slate-800'
                }`}
              >
                {g}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------- MAIN MOVIE DISCOVERY SHELVES ---------------- */}
      <section className="space-y-8">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-5">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="aspect-[2/3] rounded-lg bg-slate-900/60 animate-pulse border border-slate-800" />)}
          </div>
        ) : movies.length === 0 ? (
          <div className="py-12 text-center bg-[#0d121d] rounded-xl border border-slate-800">
            <p className="text-sm text-slate-400">No movies found matching your selection.</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg sm:text-2xl font-bold text-white">{searchQuery ? `Search Results for "${searchQuery}"` : 'Trending Now'}</h2>
                <span className="text-xs text-slate-400 shrink-0">₦100 per movie</span>
              </div>
              <div className="flex gap-3 sm:gap-5 overflow-x-auto pb-3 snap-x snap-mandatory">
                {movies.map((movie) => <div key={movie.id} className="w-[42vw] sm:w-[27vw] md:w-[21vw] lg:w-[16vw] max-w-[240px] shrink-0 snap-start"><MovieCard movie={movie} onSelectMovie={onSelectMovie} onSelectCreator={onSelectCreator} /></div>)}
              </div>
            </div>
            {!searchQuery && genres.filter(g => g !== 'All').map((genre) => {
              const matching = movies.filter((movie) => {
                const value = `${movie.genre || ''} ${movie.title || ''} ${movie.synopsis || ''}`.toLowerCase();
                const key = genre.toLowerCase();
                if (key === 'series') return Boolean(movie.is_bundle_only || /series|episode|season/.test(value));
                if (key === 'action') return /action|crime|adventure/.test(value);
                if (key === 'drama') return /drama|historical|epic/.test(value);
                if (key === 'comedy') return /comedy|funny|comedic/.test(value);
                if (key === 'romance') return /romance|romantic|love/.test(value);
                if (key === 'thriller') return /thriller|suspense|crime/.test(value);
                if (key === 'horror') return /horror|scary|supernatural/.test(value);
                if (key === 'documentary') return /documentary|documentaries|real story/.test(value);
                return value.includes(key);
              });
              if (!matching.length) return null;
              return <div key={genre} className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-white">{genre}</h2>
                <div className="flex gap-3 sm:gap-5 overflow-x-auto pb-3 snap-x snap-mandatory">
                  {matching.map((movie) => <div key={movie.id} className="w-[42vw] sm:w-[27vw] md:w-[21vw] lg:w-[16vw] max-w-[240px] shrink-0 snap-start"><MovieCard movie={movie} onSelectMovie={onSelectMovie} onSelectCreator={onSelectCreator} /></div>)}
                </div>
              </div>;
            })}
          </>
        )}
      </section>

      {/* ---------------- FEATURED CREATORS & STUDIOS ---------------- */}
      {creators.length > 0 && !searchQuery && (
        <section className="space-y-4 pt-4 border-t border-slate-800/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-cyan-400" />
              <h2 className="text-lg sm:text-xl font-bold font-display text-white">
                Featured Filmmakers & Creator Channels
              </h2>
            </div>
            
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {creators.map((c) => (
              <div
                key={c.id}
                onClick={() => onSelectCreator(c.id)}
                className="p-5 bg-gradient-to-r from-slate-900/90 to-[#0e1422] border border-slate-800 hover:border-cyan-500/50 rounded-3xl flex items-center justify-between gap-4 cursor-pointer transition-all hover:shadow-lg hover:shadow-cyan-950/20 group"
              >
                <div className="flex items-center gap-3.5">
                  <img
                    src={c.channel_avatar_url || '/visplay-symbol.png'}
                    alt={c.channel_name}
                    className="w-12 h-12 rounded-2xl object-cover border border-slate-700 group-hover:border-cyan-400 transition-colors"
                  />
                  <div>
                    <h4 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                      {c.channel_name}
                    </h4>
                    <p className="text-xs text-slate-400 line-clamp-1">{c.content_type}</p>
                    <span className="text-[10px] text-cyan-400 font-medium">
                      {(c as any).movies_count || 1} Published Titles
                    </span>
                  </div>
                </div>

                <div className="w-8 h-8 rounded-full bg-slate-800 group-hover:bg-cyan-500 group-hover:text-white flex items-center justify-center text-slate-400 transition-all">
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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

    </div>
  );
};
