import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseReaderConfig, isAllowedReaderNavigation, parseNativeMessage,
  addSavedFilm, parseSavedFilms, publicPreviewUrl, parseReaderDeepLink, SAVED_FILM_LIMIT,
} from '../security/navigation.mjs';

test('configuration requires a configured HTTPS reader, not a root/URL with credentials', () => {
  assert.deepEqual(parseReaderConfig('https://staging.visplay.test/reader'), {origin: 'https://staging.visplay.test', readerUrl: 'https://staging.visplay.test/reader?embed=1'});
  for (const invalid of [undefined, '', 'http://visplay.test/reader', 'https://visplay.test/', 'https://me:secret@visplay.test/reader', 'https://visplay.test/reader?token=abc', 'https://visplay.test/reader#secret', 'https://localhost/reader', 'https://example.example/reader', 'https://visplay.test:8443/reader']) {
    assert.equal(parseReaderConfig(invalid), null, String(invalid));
  }
});

test('reader locks document navigation to an exact origin, path and strict query allowlist', () => {
  const origin = 'https://staging.visplay.test';
  for (const url of [
    `${origin}/reader`,
    `${origin}/reader?embed=1`,
    `${origin}/reader?watch=mov_001&embed=1`,
    `${origin}/reader?code=short-one_time.OAuthCode&embed=1`,
    `${origin}/reader?account-deletion=1`,
  ]) assert.equal(isAllowedReaderNavigation(url, origin), true, url);
  for (const url of [
    `${origin}/`, `${origin}/reader/`, `${origin}/checkout`, `${origin}/api/media/stream/1?mode=full`,
    `${origin}/reader?reference=payment_reference`, `${origin}/reader?embed=0`,
    `${origin}/reader?access_token=steal-me`, `${origin}/reader?watch=../admin`,
    `${origin}/reader#access_token=abc`, `https://staging.visplay.test.attacker.example/reader`,
    `https://visplay.test/reader`, 'https://paystack.com/', 'javascript:alert(1)', 'file:///etc/passwd',
    'intent://reader', 'about:blank', 'data:text/html,hello', `${origin}/reader?x=%0a`,
  ]) assert.equal(isAllowedReaderNavigation(url, origin), false, url);
});

test('only public identity with exact schema travels across the WebView bridge', () => {
  const good = JSON.stringify({type:'SAVE_FILM',movieId:'mov_001',title:'The Test Film'});
  assert.deepEqual(parseNativeMessage(good), {type:'SAVE_FILM',movieId:'mov_001',title:'The Test Film'});
  assert.deepEqual(parseNativeMessage(JSON.stringify({type:'OPEN_PREVIEW',movieId:'x-1',title:' Preview '})), {type:'OPEN_PREVIEW',movieId:'x-1',title:'Preview'});
  for (const value of [
    '{}', '{broken', JSON.stringify({type:'PAY',movieId:'x',title:'A'}),
    JSON.stringify({type:'SAVE_FILM',movieId:'x',title:'A',token:'secret'}),
    JSON.stringify({type:'SAVE_FILM',movieId:'../admin',title:'A'}),
    JSON.stringify({type:'SAVE_FILM',movieId:'x',title:'a\ncredential'}),
    JSON.stringify({type:'OPEN_PREVIEW',movieId:'x',title:'A',videoUrl:'https://evil.example/video.mp4'}),
    JSON.stringify({type:'SAVE_FILM',movieId:'x',title:'A'.repeat(101)}),
  ]) assert.equal(parseNativeMessage(value), null);
});

test('saved public metadata is bounded, deduplicated and never includes secrets', () => {
  const films = Array.from({length:9}, (_, index) => ({movieId:`mov_${index}`,title:`Test ${index}`}));
  const result = films.reduce(addSavedFilm, []);
  assert.equal(result.length, SAVED_FILM_LIMIT);
  assert.equal(addSavedFilm(result, films[8]).length, SAVED_FILM_LIMIT);
  assert.deepEqual(parseSavedFilms(JSON.stringify([{movieId:'ok',title:'Saved',secret:'DROP'},{movieId:'ok',title:'Duplicate'}])), [{movieId:'ok',title:'Saved'}]);
  assert.deepEqual(parseSavedFilms('{broken'), []);
  assert.deepEqual(parseSavedFilms('x'.repeat(2049)), []);
});

test('native playback is restricted to public short previews, never full mode or arbitrary media URLs', () => {
  assert.equal(publicPreviewUrl('https://staging.visplay.test','mov_001'), 'https://staging.visplay.test/api/media/stream/mov_001?mode=preview');
  assert.equal(publicPreviewUrl('https://staging.visplay.test', '../admin'), null);
  assert.equal(publicPreviewUrl('http://staging.visplay.test', 'movie'), null);
  assert.equal(publicPreviewUrl('https://user:pass@staging.visplay.test', 'movie'), null);
  assert.equal(publicPreviewUrl('https://staging.visplay.test/reader', 'movie'), null);
});

test('deep links are navigation-only with no token, payment or arbitrary external URL', () => {
  assert.deepEqual(parseReaderDeepLink('visplayreader://watch/mov_001'), {type:'watch',movieId:'mov_001'});
  assert.deepEqual(parseReaderDeepLink('visplayreader://saved'), {type:'saved'});
  assert.deepEqual(parseReaderDeepLink('visplayreader://settings'), {type:'settings'});
  for (const value of [
    'https://staging.visplay.test/reader', 'visplayreader://payment',
    'visplayreader://watch/../admin', 'visplayreader://watch/mov_001?code=secret',
    'visplayreader://watch/mov_001#token', 'visplayreader://admin',
    'visplayreader://saved/path', 'visplayreader://watch/',
    'javascript:alert(1)',
  ]) assert.equal(parseReaderDeepLink(value), null, value);
});
