import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { S3Client, CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  PART_BYTES, MAX_VIDEO_BYTES, MAX_IMAGE_BYTES, hasMp4FileType, parseUploadSpec, sanitizeImage,
  verifyMultipartParts,
} from '../server/upload-security.ts';
import { UploadSessionStore } from '../server/upload-sessions.ts';
import { finalizeUpload, prepareUpload } from '../server/upload-operations.ts';
import { scanMediaFile } from '../scripts/media-malware-scan.ts';

const BUCKETS = { privateBucket: 'private-test-bucket', publicBucket: 'public-test-bucket' };
process.env.R2_PUBLIC_BASE_URL ||= 'https://assets.example.invalid';
const signClient = new S3Client({ region: 'auto', endpoint: 'https://example.invalid',
  credentials: { accessKeyId: 'dummy-test', secretAccessKey: 'dummy-test' } });

function imageRequest(size, overrides = {}) {
  return { folder: 'posters', usage: 'poster', filename: 'poster.png', contentType: 'image/png', size, ...overrides };
}
function videoRequest(size, overrides = {}) {
  return { folder: 'videos', filename: 'movie.mp4', contentType: 'video/mp4', size, ...overrides };
}
function mp4Bytes() {
  const input = Buffer.alloc(40);
  input.writeUInt32BE(24, 0);
  input.write('ftypisom', 4, 'ascii');
  input.write('iso2mp41', 16, 'ascii');
  return input;
}

function fakeR2() {
  const objects = new Map();
  const calls = [];
  return {
    objects, calls,
    async send(command) {
      calls.push(command);
      const input = command.input;
      const ref = `${input.Bucket}/${input.Key}`;
      if (command instanceof HeadObjectCommand) {
        const found = objects.get(ref);
        if (!found) throw new Error('NoSuchKey');
        return { ContentLength: found.data.length, ContentType: found.contentType, ETag: found.etag };
      }
      if (command instanceof GetObjectCommand) {
        const found = objects.get(ref);
        if (!found || (input.IfMatch && input.IfMatch !== found.etag)) throw new Error('PreconditionFailed');
        const data = input.Range ? found.data.subarray(0, 4096) : found.data;
        return { Body: { transformToByteArray: async () => data } };
      }
      if (command instanceof PutObjectCommand) {
        objects.set(ref, { data: Buffer.from(input.Body), contentType: input.ContentType, etag: '"99999999999999999999999999999999"' });
        return {};
      }
      if (command instanceof CopyObjectCommand) {
        const raw = decodeURIComponent(input.CopySource).split('/').slice(1).join('/');
        const found = objects.get(`${input.Bucket}/${raw}`);
        if (!found || found.etag !== input.CopySourceIfMatch) throw new Error('PreconditionFailed');
        objects.set(ref, { ...found, contentType: input.ContentType });
        return {};
      }
      if (command instanceof DeleteObjectCommand) { objects.delete(ref); return {}; }
      throw new Error(`Unexpected ${command.constructor.name}`);
    },
  };
}

test('rejects spoofed file types, huge files, forged sizes and unknown image usage', () => {
  for (const invalid of [
    imageRequest(1, { filename: 'attack.svg', contentType: 'image/svg+xml' }),
    imageRequest(1, { filename: 'poster.jpg', contentType: 'image/png' }),
    imageRequest(MAX_IMAGE_BYTES + 1),
    imageRequest('1024'),
    imageRequest(100, { usage: 'elevate-admin' }),
    videoRequest(MAX_VIDEO_BYTES + 1),
    videoRequest(2, { filename: 'fake.mov' }),
    videoRequest(Number.POSITIVE_INFINITY),
  ]) assert.throws(() => parseUploadSpec(invalid));
  const good = parseUploadSpec(videoRequest(MAX_VIDEO_BYTES));
  assert.equal(good.partCount, Math.ceil(MAX_VIDEO_BYTES / PART_BYTES));
});

test('accepts MP4 box header but rejects renamed non-video bytes', () => {
  assert.ok(hasMp4FileType(mp4Bytes()));
  assert.equal(hasMp4FileType(Buffer.from('%PDF-suspicious')), false);
  assert.equal(hasMp4FileType(Buffer.from('PK\x03\x04 fake.zip')), false);
});

test('image sanitizer enforces JPEG conversion and strips metadata', async () => {
  const valid = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#f00' } })
    .png().toBuffer();
  const converted = await sanitizeImage(valid);
  const metadata = await sharp(converted).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 256);
  assert.equal(metadata.exif, undefined);
  await assert.rejects(sanitizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')));
  await assert.rejects(sanitizeImage(Buffer.alloc(MAX_IMAGE_BYTES + 1)));
});

test('image sanitizer rejects decompression bomb dimensions before decode', async () => {
  const huge = await sharp({ create: { width: 6500, height: 6500, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(sanitizeImage(huge), /oversized|pixels|limit/i);
});

test('multipart completion rejects part reordering, missing bytes, duplicate ETags and extra parts', () => {
  const size = 2 * PART_BYTES + 777;
  const parts = [1, 2, 3].map(i => ({ PartNumber: i, Size: i === 3 ? 777 : PART_BYTES, ETag: `"${String(i).repeat(32)}"` }));
  assert.equal(verifyMultipartParts(size, parts, parts).length, 3);
  assert.throws(() => verifyMultipartParts(size, parts, [parts[0], parts[0], parts[2]]));
  assert.throws(() => verifyMultipartParts(size, parts.map(p => ({ ...p, Size: p.Size - 1 })), parts));
  assert.throws(() => verifyMultipartParts(size, [...parts, { PartNumber: 4, Size: 1, ETag: '4'.repeat(32) }], parts));
  assert.throws(() => verifyMultipartParts(size, parts, parts.slice(0, 2)));
});

test('session enforces owner identity, anti-replay and only three concurrent uploads', async () => {
  const store = new UploadSessionStore();
  const owner = randomUUID();
  const ids = [];
  for (let index = 0; index < 3; index++) {
    const id = randomUUID(); ids.push(id);
    await store.create({ id, user_id: owner, kind: 'image', usage: 'poster', expected_size: 100, content_type: 'image/jpeg',
      staging_key: `staging/${owner}/${id}/source`, upload_id: null });
  }
  await assert.rejects(store.create({ id: randomUUID(), user_id: owner, kind: 'image', usage: 'poster', expected_size: 100,
    content_type: 'image/jpeg', staging_key: 'staging/no', upload_id: null }), /limit|pending/i);
  await assert.rejects(store.get(ids[0], randomUUID()), /not found/i);
  await store.transition(ids[0], owner, 'created', 'processing');
  await store.transition(ids[0], owner, 'processing', 'ready');
  await store.transition(ids[0], owner, 'ready', 'consumed');
  await assert.rejects(store.transition(ids[0], owner, 'ready', 'consumed'), /already changed/i);
});

test('two concurrent consumers cannot claim one upload twice', async () => {
  const store = new UploadSessionStore();
  const owner = randomUUID(); const id = randomUUID();
  await store.create({ id, user_id: owner, kind: 'video', usage: 'movie', expected_size: 80,
    content_type: 'video/mp4', staging_key: `staging/${owner}/${id}/master.mp4`, upload_id: null });
  await store.transition(id, owner, 'created', 'processing');
  await store.transition(id, owner, 'processing', 'ready');
  const attempts = await Promise.allSettled([
    store.transition(id, owner, 'ready', 'attaching'),
    store.transition(id, owner, 'ready', 'attaching'),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
});

test('daily session-count quota prevents abuse with many one-byte uploads', async () => {
  const store = new UploadSessionStore();
  const owner = randomUUID();
  for (let count = 0; count < 30; count++) {
    const id = randomUUID();
    await store.create({ id, user_id: owner, kind: 'image', usage: 'poster', expected_size: 1,
      content_type: 'image/png', staging_key: `staging/${owner}/${id}/source`, upload_id: null });
    await store.transition(id, owner, 'created', 'processing');
    await store.transition(id, owner, 'processing', 'ready');
  }
  await assert.rejects(store.create({ id: randomUUID(), user_id: owner, kind: 'image', usage: 'poster',
    expected_size: 1, content_type: 'image/png', staging_key: 'staging/no', upload_id: null }), /limit|pending/i);
});

test('single PUT signed URL binds both Content-Type and Content-Length', async () => {
  const store = new UploadSessionStore();
  const owner = randomUUID();
  const reservation = await prepareUpload(signClient, store, BUCKETS, owner, parseUploadSpec(imageRequest(4096)));
  const url = new URL(reservation.uploadUrl);
  assert.match(url.searchParams.get('X-Amz-SignedHeaders'), /content-length/);
  assert.match(url.searchParams.get('X-Amz-SignedHeaders'), /content-type/);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '180');
  assert.equal((await store.get(reservation.sessionId, owner)).expected_size, 4096);
});

test('valid image remains private during upload then becomes a sanitized public JPEG', async () => {
  const r2 = fakeR2();
  const store = new UploadSessionStore();
  const owner = randomUUID();
  const data = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'blue' } }).png().toBuffer();
  const id = randomUUID();
  const key = `staging/${owner}/${id}/source`;
  await store.create({ id, user_id: owner, kind: 'image', usage: 'poster', expected_size: data.length,
    content_type: 'image/png', staging_key: key, upload_id: null });
  r2.objects.set(`${BUCKETS.privateBucket}/${key}`, { data, contentType: 'image/png', etag: '"11111111111111111111111111111111"' });
  assert.equal([...r2.objects.keys()].some(k => k.startsWith(BUCKETS.publicBucket)), false);
  const result = await finalizeUpload(r2, store, BUCKETS, owner, id);
  assert.match(result.assetRef, /posters\/.+\.jpg/);
  assert.equal(r2.objects.has(`${BUCKETS.privateBucket}/${key}`), false);
  const published = [...r2.objects.entries()].find(([k]) => k.startsWith(BUCKETS.publicBucket));
  assert.ok(published);
  assert.equal((await sharp(published[1].data).metadata()).format, 'jpeg');
  assert.equal((await store.get(id, owner)).status, 'ready');
});

test('renamed non-MP4 video is never published and failed session cannot be reused', async () => {
  const r2 = fakeR2();
  const store = new UploadSessionStore();
  const owner = randomUUID(); const id = randomUUID();
  const key = `staging/${owner}/${id}/master.mp4`;
  const data = Buffer.alloc(128, 0x50);
  await store.create({ id, user_id: owner, kind: 'video', usage: 'movie', expected_size: data.length,
    content_type: 'video/mp4', staging_key: key, upload_id: null });
  r2.objects.set(`${BUCKETS.privateBucket}/${key}`, { data, contentType: 'video/mp4', etag: '"11111111111111111111111111111111"' });
  await assert.rejects(finalizeUpload(r2, store, BUCKETS, owner, id), /MP4 file header/);
  assert.equal((await store.get(id, owner)).status, 'failed');
  assert.equal([...r2.objects.keys()].some(k => k.includes('/videos/')), false);
});

test('validated MP4 object is promoted with conditional copy into the private bucket', async () => {
  const r2 = fakeR2();
  const store = new UploadSessionStore();
  const owner = randomUUID(); const id = randomUUID();
  const key = `staging/${owner}/${id}/master.mp4`;
  const data = mp4Bytes();
  await store.create({ id, user_id: owner, kind: 'video', usage: 'movie', expected_size: data.length,
    content_type: 'video/mp4', staging_key: key, upload_id: null });
  r2.objects.set(`${BUCKETS.privateBucket}/${key}`, { data, contentType: 'video/mp4', etag: '"11111111111111111111111111111111"' });
  const result = await finalizeUpload(r2, store, BUCKETS, owner, id);
  assert.equal(result.assetRef, `private://videos/${owner}/${id}.mp4`);
  assert.equal(r2.objects.has(`${BUCKETS.privateBucket}/videos/${owner}/${id}.mp4`), true);
  assert.equal([...r2.objects.keys()].some(k => k.startsWith(BUCKETS.publicBucket)), false);
  const copy = r2.calls.find(c => c instanceof CopyObjectCommand);
  assert.equal(copy.input.CopySourceIfMatch, '"11111111111111111111111111111111"');
});

test('object changed after HEAD is refused by the conditional copy and never linked', async () => {
  const r2 = fakeR2();
  const originalSend = r2.send.bind(r2);
  const store = new UploadSessionStore();
  const owner = randomUUID(); const id = randomUUID();
  const key = `staging/${owner}/${id}/master.mp4`;
  const data = mp4Bytes();
  await store.create({ id, user_id: owner, kind: 'video', usage: 'movie', expected_size: data.length,
    content_type: 'video/mp4', staging_key: key, upload_id: null });
  r2.objects.set(`${BUCKETS.privateBucket}/${key}`, { data, contentType: 'video/mp4', etag: '"11111111111111111111111111111111"' });
  r2.send = async command => {
    if (command instanceof CopyObjectCommand) {
      r2.objects.set(`${BUCKETS.privateBucket}/${key}`, { data, contentType: 'video/mp4', etag: '"22222222222222222222222222222222"' });
    }
    return originalSend(command);
  };
  await assert.rejects(finalizeUpload(r2, store, BUCKETS, owner, id), /PreconditionFailed/);
  assert.equal((await store.get(id, owner)).status, 'failed');
  assert.equal(r2.objects.has(`${BUCKETS.privateBucket}/videos/${owner}/${id}.mp4`), false);
});

test('production preview processing fails closed without a vetted malware scanner', async () => {
  const oldMode = process.env.NODE_ENV;
  const oldScanner = process.env.MEDIA_MALWARE_SCANNER;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.MEDIA_MALWARE_SCANNER;
    await assert.rejects(scanMediaFile('/tmp/nonexistent-movie.mp4'), /refusing to process an unscanned/i);
    process.env.MEDIA_MALWARE_SCANNER = 'insecure-shell-command';
    await assert.rejects(scanMediaFile('/tmp/nonexistent-movie.mp4'), /vetted clamscan/i);
  } finally {
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
    if (oldScanner === undefined) delete process.env.MEDIA_MALWARE_SCANNER; else process.env.MEDIA_MALWARE_SCANNER = oldScanner;
  }
});
