/**
 * Operator-only cleanup of abandoned uploads (DRY RUN by default).
 *   npm run media:cleanup
 *   MEDIA_CLEANUP_APPROVED=yes npm run media:cleanup -- --apply
 *
 * Configure a PRIVATE staging-prefix lifecycle and multipart-abort rule in R2
 * as a second line of defense. Do not run during a media-upload migration.
 */
import 'dotenv/config';
import { S3Client, AbortMultipartUploadCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { initializeDatabase, loadDatabase } from '../server/db.js';
import { UploadSessionStore } from '../server/upload-sessions.js';
import { finalAssetKey, isStagingKey } from '../server/upload-security.js';
import { publicAssetUrl } from '../server/upload-operations.js';

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && process.env.MEDIA_CLEANUP_APPROVED !== 'yes') {
    throw new Error('Set MEDIA_CLEANUP_APPROVED=yes only after an operator reviews the dry-run inventory.');
  }
  const account = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const privateBucket = process.env.R2_PRIVATE_VIDEO_BUCKET?.trim();
  const publicBucket = process.env.R2_BUCKET_NAME || 'visplay-media';
  if (!account || !accessKeyId || !secretAccessKey || !privateBucket || privateBucket === publicBucket) {
    throw new Error('Valid separate R2 buckets and server-only credentials are required.');
  }
  const client = new S3Client({ region: 'auto', endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey } });
  await initializeDatabase();
  const db = loadDatabase();
  const store = new UploadSessionStore();
  // A two-hour grace period after the six-hour session expiry prevents a
  // just-expired upload from racing a late request in another API instance.
  const sessions = await store.listExpired(new Date(Date.now() - 2 * 60 * 60 * 1000), 100);
  let cleaned = 0;
  let protectedReferences = 0;
  for (const session of sessions) {
    if (!isStagingKey(session.staging_key, session.user_id, session.id, session.kind)) {
      console.error('Skipped malformed upload key:', session.id);
      continue;
    }
    const finalKey = finalAssetKey(session.user_id, session.id, session.kind);
    if (session.final_key && session.final_key !== finalKey) {
      console.error('Skipped unexpected final key:', session.id);
      continue;
    }
    const finalReference = session.kind === 'video' ? `private://${finalKey}` : publicAssetUrl(finalKey);
    const isReferenced = db.movies.some(m => [m.video_url, m.poster_url, m.backdrop_url].includes(finalReference)) ||
      db.creator_profiles.some(c => [c.channel_avatar_url, c.channel_banner_url].includes(finalReference)) ||
      db.bundles.some(b => b.poster_url === finalReference);
    if (isReferenced) {
      protectedReferences++;
      console.log(`PRESERVE ${session.id}: an application record references this asset; reconcile session status manually.`);
      continue;
    }
    console.log(`${apply ? 'REMOVE' : 'WOULD REMOVE'} ${session.id}: ${session.kind} ${session.status} (${session.expected_size} bytes)`);
    if (!apply) continue;
    if (session.status !== 'aborted') {
      try {
        await store.transition(session.id, session.user_id, session.status, 'aborted');
      } catch {
        console.warn(`SKIP ${session.id}: session status changed while cleanup was running.`);
        continue;
      }
    }
    if (session.upload_id) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: privateBucket,
        Key: session.staging_key, UploadId: session.upload_id })).catch(() => undefined);
    }
    // Delete only mathematically derived, owner-scoped object keys.
    await client.send(new DeleteObjectCommand({ Bucket: privateBucket, Key: session.staging_key }));
    await client.send(new DeleteObjectCommand({ Bucket: session.kind === 'video' ? privateBucket : publicBucket, Key: finalKey }));
    cleaned++;
  }
  console.log(JSON.stringify({ examined: sessions.length, deleted: cleaned, referenced_assets_preserved: protectedReferences, dry_run: !apply }));
}

main().catch(error => {
  console.error('Media cleanup stopped:', error?.message || error);
  process.exitCode = 1;
});
