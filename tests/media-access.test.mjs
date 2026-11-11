import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeMovieStream, ownsFullMovie, privateVideoKey, toClientMovie } from '../server/media-access.ts';

const movie = {
  id: 'mov_paid', creator_id: 'cp_1', status: 'published',
  video_url: 'private://videos/owner_1/11111111-1111-4111-8111-111111111111.mp4',
  preview_private_key: 'previews/mov_paid/22222222-2222-4222-8222-222222222222.mp4',
  bundle_id: 'bundle_1',
};
const owner = { id: 'owner_1', role: 'creator' };
const viewer = { id: 'viewer_1', role: 'viewer' };
const otherViewer = { id: 'viewer_2', role: 'viewer' };
const profiles = [{ id: 'cp_1', user_id: 'owner_1', status: 'approved' }];
const purchases = [{ user_id: 'viewer_1', item_id: 'mov_paid' }];

test('catalogue DTO contains no private or legacy storage location', () => {
  const dto = toClientMovie(movie);
  assert.equal(dto.video_url, '/api/media/stream/mov_paid');
  assert.equal(Object.hasOwn(dto, 'preview_private_key'), false);
  assert.equal(JSON.stringify(dto).includes('private://'), false);
});

test('private keys must use creator-scoped MP4 master paths', () => {
  assert.equal(privateVideoKey(movie.video_url), 'videos/owner_1/11111111-1111-4111-8111-111111111111.mp4');
  assert.equal(privateVideoKey('https://public.example/video.mp4'), null);
  assert.equal(privateVideoKey('private://videos/../../admin.mp4'), null);
});

test('anonymous user receives only the separate preview object', () => {
  assert.deepEqual(authorizeMovieStream(movie, undefined, purchases, profiles, 'preview'), {
    status: 'preview', key: movie.preview_private_key,
  });
  assert.deepEqual(authorizeMovieStream(movie, undefined, purchases, profiles, 'full'), { status: 'forbidden' });
});

test('changing the browser mode to full cannot bypass a purchase', () => {
  assert.deepEqual(authorizeMovieStream(movie, otherViewer, purchases, profiles, 'full'), { status: 'forbidden' });
  assert.equal(ownsFullMovie(movie, otherViewer, purchases, profiles), false);
});

test('an individual purchase grants that account full access only', () => {
  assert.deepEqual(authorizeMovieStream(movie, viewer, purchases, profiles, 'full'), {
    status: 'full', key: privateVideoKey(movie.video_url),
  });
});

test('purchasing a bundle grants only contained episodes to the purchaser', () => {
  const bundlePurchase = [{ user_id: viewer.id, item_id: 'bundle_1' }];
  assert.equal(authorizeMovieStream(movie, viewer, bundlePurchase, profiles, 'full').status, 'full');
  assert.equal(authorizeMovieStream(movie, otherViewer, bundlePurchase, profiles, 'full').status, 'forbidden');
});

test('verified creator owner and admin may review their own restricted videos', () => {
  assert.equal(authorizeMovieStream(movie, owner, [], profiles, 'full').status, 'full');
  assert.equal(authorizeMovieStream(movie, { id: 'admin_1', role: 'admin' }, [], profiles, 'full').status, 'full');
  assert.equal(authorizeMovieStream(movie, { id: 'fake_creator', role: 'creator' }, [], profiles, 'full').status, 'forbidden');
});

test('unpublished movies are unavailable to the public even with a forged purchase record', () => {
  const pending = { ...movie, status: 'pending' };
  assert.deepEqual(authorizeMovieStream(pending, viewer, purchases, profiles, 'full'), { status: 'not-found' });
  assert.deepEqual(authorizeMovieStream(pending, undefined, purchases, profiles, 'preview'), { status: 'not-found' });
});

test('a legacy public master or missing preview fails closed, without falling back to full media', () => {
  const legacy = { ...movie, video_url: 'https://public.example/full-movie.mp4', preview_private_key: undefined };
  assert.deepEqual(authorizeMovieStream(legacy, viewer, purchases, profiles, 'full'), { status: 'not-ready' });
  assert.deepEqual(authorizeMovieStream(legacy, undefined, purchases, profiles, 'preview'), { status: 'not-ready' });
});
