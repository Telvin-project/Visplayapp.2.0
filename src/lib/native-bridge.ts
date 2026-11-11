import { isNativeReaderEmbed } from './distribution';

export type NativeReaderMessage =
  | { type: 'OPEN_PREVIEW'; movieId: string; title: string }
  | { type: 'SAVE_FILM'; movieId: string; title: string };

/** Only public movie identifiers/titles travel to the native shell. Never credentials or signed media URLs. */
export function sendNativeReaderMessage(message: NativeReaderMessage): void {
  if (!isNativeReaderEmbed() || !/^[A-Za-z0-9_-]{1,120}$/.test(message.movieId)) return;
  const bridge = (window as Window & { ReactNativeWebView?: { postMessage(payload: string): void } }).ReactNativeWebView;
  if (!bridge) return;
  if (message.type === 'OPEN_PREVIEW') {
    // Do not leave the embedded HTML player audible behind the native preview.
    document.querySelectorAll('video').forEach(video => video.pause());
  }
  bridge.postMessage(JSON.stringify({ type: message.type, movieId: message.movieId, title: message.title.slice(0, 100) }));
}
