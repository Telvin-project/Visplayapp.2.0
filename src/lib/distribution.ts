/** Dedicated presentation channel for the future React Native reader shell. */
export const MOBILE_READER_ROUTE = '/reader';

export function isMobileReaderPath(pathname: string): boolean {
  return pathname === MOBILE_READER_ROUTE || pathname === `${MOBILE_READER_ROUTE}/`;
}

export function isMobileReader(): boolean {
  return typeof window !== 'undefined' && isMobileReaderPath(window.location.pathname);
}

/** Presentation hint only. Native must still enforce the exact reader origin/path. */
export function isNativeReaderEmbed(): boolean {
  return isMobileReader() && new URLSearchParams(window.location.search).get('embed') === '1';
}

export function safeHomePath(): string {
  return isMobileReader() ? MOBILE_READER_ROUTE : '/';
}
