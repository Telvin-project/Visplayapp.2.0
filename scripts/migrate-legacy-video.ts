/**
 * One-time, operator-run public-to-private R2 copy for a legacy movie.
 *
 * Usage:
 *   node --import tsx scripts/migrate-legacy-video.ts <movie-id>
 *
 * NEVER deletes the public source or updates the live database. The operator
 * verifies playback from private storage and then uses the admin attachment
 * endpoint. Remove the old public object / custom-domain cache only after
 * confirming the new master and preview are healthy.
 */
import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { initializeDatabase, loadDatabase } from '../server/db.js';
import { privateVideoKey } from '../server/media-access.js';

async function main() {
  const movieId = process.argv[2];
  if (!movieId || !/^[A-Za-z0-9_-]{3,80}$/.test(movieId)) {
    throw new Error('Usage: node --import tsx scripts/migrate-legacy-video.ts <movie-id>');
  }
  const publicBase = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, '') || '';
  const publicBucket = process.env.R2_BUCKET_NAME || 'visplay-media';
  const privateBucket = process.env.R2_PRIVATE_VIDEO_BUCKET?.trim();
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!publicBase.startsWith('https://') || !privateBucket || privateBucket === publicBucket || !accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Both public and separate private R2 buckets and server-only credentials must be configured.');
  }

  await initializeDatabase();
  const database = loadDatabase();
  const movie = database.movies.find(m => m.id === movieId);
  if (!movie) throw new Error('Unknown movie ID.');
  if (privateVideoKey(movie.video_url)) throw new Error('This movie already references a private master.');
  if (!movie.video_url.startsWith(`${publicBase}/`)) {
    throw new Error('Legacy source is outside the configured public R2 bucket. Upload this media through the private uploader instead.');
  }

  const sourceKey = decodeURIComponent(movie.video_url.slice(publicBase.length + 1).split('?')[0]);
  if (!sourceKey.startsWith('videos/') || sourceKey.includes('..')) throw new Error('Unexpected legacy movie object path.');
  const owner = database.creator_profiles.find(p => p.id === movie.creator_id);
  if (!owner) throw new Error('Movie has no creator account owner; resolve ownership first.');

  const client = new S3Client({
    region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const source = await client.send(new HeadObjectCommand({ Bucket: publicBucket, Key: sourceKey }));
  if (!source.ContentLength || source.ContentLength > 500 * 1024 * 1024 || source.ContentType?.split(';')[0] !== 'video/mp4') {
    throw new Error('Legacy object failed MP4/size validation; use an operator-managed transcode/migration job.');
  }

  const destinationKey = `videos/${owner.user_id}/${uuidv4()}.mp4`;
  const sourceReference = `${encodeURIComponent(publicBucket)}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`;
  await client.send(new CopyObjectCommand({
    Bucket: privateBucket, Key: destinationKey, CopySource: sourceReference,
    MetadataDirective: 'REPLACE', ContentType: 'video/mp4', CacheControl: 'private, no-store',
  }));

  const copied = await client.send(new HeadObjectCommand({ Bucket: privateBucket, Key: destinationKey }));
  if (copied.ContentLength !== source.ContentLength || copied.ContentType?.split(';')[0] !== 'video/mp4') {
    throw new Error('Private copy did not match the source object size/type; do not attach it.');
  }

  process.stdout.write(JSON.stringify({
    movie_id: movie.id,
    private_video_url: `private://${destinationKey}`,
    copied_bytes: copied.ContentLength,
    attach_endpoint: `/api/admin/movies/${movie.id}/attach-private-master`,
    next: 'Attach private master, run media:preview, attach preview, verify playback, then remove legacy public source/CDN access.',
  }, null, 2) + '\n');
}

main().catch(error => {
  console.error('Legacy R2 private video copy failed:', error?.message || error);
  process.exitCode = 1;
});
