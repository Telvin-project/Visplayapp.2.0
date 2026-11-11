// This pure module is shared by the native app and its standalone Node policy tests.
// Do not accept arbitrary movie/video URLs, payment links, auth tokens, or injected JS.
export const MOVIE_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
export const SAVED_FILM_LIMIT = 6;
const MAX_TITLE_LENGTH = 80;
const READABLE_TITLE = /^[^\u0000-\u001F\u007F]*$/;

export function parseReaderConfig(configuredUrl) {
  if (typeof configuredUrl !== 'string' || !configuredUrl.trim()) return null;
  try {
    const candidate = new URL(configuredUrl);
    if (
      candidate.protocol !== 'https:' ||
      candidate.username || candidate.password ||
      candidate.port ||
      !candidate.hostname ||
      candidate.hostname === 'localhost' ||
      candidate.hostname.endsWith('.localhost') ||
      candidate.hostname.endsWith('.example') ||
      candidate.pathname !== '/reader' ||
      candidate.search || candidate.hash
    ) return null;

    return {
      origin: candidate.origin,
      readerUrl: `${candidate.origin}/reader?embed=1`,
    };
  } catch {
    return null;
  }
}

/** Only same-origin /reader document navigations. APIs/media loads are subresources, not top-level pages. */
export function isAllowedReaderNavigation(url, trustedOrigin) {
  if (typeof url !== 'string' || typeof trustedOrigin !== 'string') return false;
  try {
    const candidate = new URL(url);
    if (candidate.origin !== trustedOrigin || candidate.pathname !== '/reader' || candidate.hash) return false;
    for (const [key, value] of candidate.searchParams.entries()) {
      if (key === 'embed' && value === '1') continue;
      if (key === 'watch' && MOVIE_ID_PATTERN.test(value)) continue;
      if (key === 'account-deletion' && value === '1') continue;
      // Supabase email verification may use a short-lived, single-use authorization code.
      // Never forward this code to native JS, logs, another origin, or device storage.
      if (key === 'code' && /^[A-Za-z0-9._-]{1,2048}$/.test(value)) continue;
      if ((key === 'error' || key === 'error_code' || key === 'error_description') && value.length <= 512) continue;
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Bridge messages contain public film identity only, never a URL, session, or server entitlement. */
export function parseNativeMessage(payload) {
  if (typeof payload !== 'string' || payload.length > 420) return null;
  try {
    const data = JSON.parse(payload);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (!['OPEN_PREVIEW', 'SAVE_FILM'].includes(data.type)) return null;
    if (Object.keys(data).sort().join(',') !== 'movieId,title,type') return null;
    if (typeof data.movieId !== 'string' || !MOVIE_ID_PATTERN.test(data.movieId)) return null;
    if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 100 || !READABLE_TITLE.test(data.title)) return null;
    return { type: data.type, movieId: data.movieId, title: data.title.trim().slice(0, MAX_TITLE_LENGTH) };
  } catch {
    return null;
  }
}

export function sanitizeSavedFilm(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.movieId !== 'string' || !MOVIE_ID_PATTERN.test(raw.movieId)) return null;
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > MAX_TITLE_LENGTH || !READABLE_TITLE.test(raw.title)) return null;
  return { movieId: raw.movieId, title: raw.title.trim() };
}

export function parseSavedFilms(payload) {
  if (typeof payload !== 'string' || payload.length > 2048) return [];
  try {
    const data = JSON.parse(payload);
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    return data.slice(0, SAVED_FILM_LIMIT).map(sanitizeSavedFilm).filter(item => {
      if (!item || seen.has(item.movieId)) return false;
      seen.add(item.movieId);
      return true;
    });
  } catch {
    return [];
  }
}

export function addSavedFilm(existing, item) {
  const safe = sanitizeSavedFilm(item);
  if (!safe) return Array.isArray(existing) ? existing : [];
  return [safe, ...existing.filter(old => old.movieId !== safe.movieId)].slice(0, SAVED_FILM_LIMIT);
}

/** Native preview intentionally never includes full movie mode, signed URLs or user session data. */
export function publicPreviewUrl(origin, movieId) {
  if (typeof origin !== 'string' || !MOVIE_ID_PATTERN.test(movieId)) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return `${origin}/api/media/stream/${encodeURIComponent(movieId)}?mode=preview`;
  } catch {
    return null;
  }
}

/** Deep links are navigation requests only. They cannot carry auth tokens or unlock a film. */
export function parseReaderDeepLink(raw) {
  if (typeof raw !== 'string' || raw.length > 240) return null;
  // Check the *original* spelling before URL normalization can collapse /../ paths.
  if (!/^visplayreader:\/\/(?:watch\/[A-Za-z0-9_-]{1,120}|saved\/?|settings\/?)$/.test(raw)) return null;
  try {
    const link = new URL(raw);
    if (link.protocol !== 'visplayreader:' || link.search || link.hash || link.username || link.password) return null;
    if (link.hostname === 'watch') {
      const id = link.pathname.slice(1);
      return MOVIE_ID_PATTERN.test(id) ? { type: 'watch', movieId: id } : null;
    }
    if (link.hostname === 'saved' && (link.pathname === '/' || link.pathname === '')) return { type: 'saved' };
    if (link.hostname === 'settings' && (link.pathname === '/' || link.pathname === '')) return { type: 'settings' };
    return null;
  } catch {
    return null;
  }
}
