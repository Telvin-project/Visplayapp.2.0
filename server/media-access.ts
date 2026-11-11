import type { CreatorProfile, Movie, Purchase, User } from './db.js';

/** Only the application streaming route is ever sent to a browser. */
export function toClientMovie<T extends Movie>(movie: T): Omit<T, 'video_url' | 'preview_private_key' | 'rights_attestation' | 'rights_review'> & { video_url: string } {
  // Contract names, private evidence references, rights holders and reviewer notes
  // are admin-only; a public movie response must never expose them.
  const {
    video_url: _storageLocation, preview_private_key: _previewLocation,
    rights_attestation: _attestation, rights_review: _rightsReview, ...metadata
  } = movie;
  return { ...metadata, video_url: `/api/media/stream/${encodeURIComponent(movie.id)}` };
}

export function privateVideoKey(url: string): string | null {
  const key = url.startsWith('private://') ? url.slice('private://'.length) : '';
  return /^videos\/[A-Za-z0-9_-]+\/[a-f0-9-]{32,}\.mp4$/i.test(key) ? key : null;
}

export function ownsFullMovie(
  movie: Movie,
  viewer: User | undefined,
  purchases: readonly Purchase[],
  creators: readonly CreatorProfile[],
): boolean {
  if (!viewer) return false;
  if (viewer.role === 'admin') return true;
  if (creators.some(c => c.id === movie.creator_id && c.user_id === viewer.id && c.status === 'approved')) return true;
  return purchases.some(p => p.user_id === viewer.id && (p.item_id === movie.id || Boolean(movie.bundle_id && p.item_id === movie.bundle_id)));
}

export type StreamDecision =
  | { status: 'full'; key: string }
  | { status: 'preview'; key: string }
  | { status: 'forbidden' }
  | { status: 'not-found' }
  | { status: 'not-ready' };

export function authorizeMovieStream(
  movie: Movie,
  viewer: User | undefined,
  purchases: readonly Purchase[],
  creators: readonly CreatorProfile[],
  mode: 'full' | 'preview',
): StreamDecision {
  const ownerOrAdmin = Boolean(viewer && (viewer.role === 'admin' || creators.some(c =>
    c.id === movie.creator_id && c.user_id === viewer.id && c.status === 'approved')));
  if (movie.status !== 'published' && !ownerOrAdmin) return { status: 'not-found' };

  if (mode === 'full') {
    if (!ownsFullMovie(movie, viewer, purchases, creators)) return { status: 'forbidden' };
    const key = privateVideoKey(movie.video_url);
    return key ? { status: 'full', key } : { status: 'not-ready' };
  }

  if (!movie.preview_private_key || !/^previews\/[A-Za-z0-9_-]+\/[a-f0-9-]{32,}\.mp4$/i.test(movie.preview_private_key)) {
    return { status: 'not-ready' };
  }
  return { status: 'preview', key: movie.preview_private_key };
}
