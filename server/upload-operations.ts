import { v4 as uuidv4 } from 'uuid';
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CopyObjectCommand, CreateMultipartUploadCommand,
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListPartsCommand, PutObjectCommand, UploadPartCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DIRECT_BYTES, PART_BYTES, finalAssetKey, hasMp4FileType, isStagingKey,
  sanitizeImage, verifyMultipartParts, type UploadSpec,
} from './upload-security.js';
import { UploadSessionStore, type UploadSession } from './upload-sessions.js';

/** Strictly isolated from financial database writes. No direct public upload URL. */
export function publicAssetUrl(key: string): string {
  const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, '');
  if (!base) throw new Error('R2 public asset domain is unavailable.');
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export interface R2UploadBuckets { privateBucket: string; publicBucket: string }

function expectedLength(session: UploadSession, partNumber: number): number {
  const start = (partNumber - 1) * PART_BYTES;
  return Math.min(PART_BYTES, session.expected_size - start);
}

export async function prepareUpload(client: S3Client, store: UploadSessionStore, buckets: R2UploadBuckets, userId: string, spec: UploadSpec) {
  const id = uuidv4();
  const key = `staging/${userId}/${id}/${spec.kind === 'video' ? 'master.mp4' : 'source'}`;
  let uploadId: string | null = null;
  if (spec.multipart) {
    const created = await client.send(new CreateMultipartUploadCommand({
      Bucket: buckets.privateBucket, Key: key, ContentType: spec.contentType, CacheControl: 'private, no-store',
    }));
    if (!created.UploadId) throw new Error('Storage could not create a multipart upload.');
    uploadId = created.UploadId;
  }
  let session: UploadSession;
  try {
    session = await store.create({ id, user_id: userId, kind: spec.kind, usage: spec.usage,
      content_type: spec.contentType, expected_size: spec.size, staging_key: key, upload_id: uploadId });
  } catch (error) {
    if (uploadId) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: buckets.privateBucket, Key: key, UploadId: uploadId })).catch(() => undefined);
    }
    throw error;
  }
  if (uploadId) return { sessionId: id, multipart: true, partCount: spec.partCount, partBytes: PART_BYTES, expiresAt: session.expires_at };

  const command = new PutObjectCommand({
    Bucket: buckets.privateBucket, Key: key, ContentType: spec.contentType, ContentLength: spec.size,
    CacheControl: 'private, no-store',
  });
  // R2 recommends signing the content type; also attempt to bind Content-Length.
  // HEAD verification still enforces exact size, because presigned URLs are reusable.
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 180,
    signableHeaders: new Set(['content-type', 'content-length']) });
  return { sessionId: id, multipart: false, uploadUrl, expiresAt: session.expires_at };
}

export async function signUploadPart(client: S3Client, store: UploadSessionStore, buckets: R2UploadBuckets,
  userId: string, sessionId: string, number: number) {
  const session = await store.assertActive(sessionId, userId, 'created');
  if (!session.upload_id || session.kind !== 'video' || !isStagingKey(session.staging_key, userId, session.id, 'video') ||
    !Number.isInteger(number) || number < 1 || number > Math.ceil(session.expected_size / PART_BYTES)) {
    throw new Error('Invalid upload part.');
  }
  const uploadUrl = await getSignedUrl(client, new UploadPartCommand({ Bucket: buckets.privateBucket,
    Key: session.staging_key, UploadId: session.upload_id, PartNumber: number, ContentLength: expectedLength(session, number),
  }), { expiresIn: 180, signableHeaders: new Set(['content-length']) });
  return { uploadUrl, partBytes: expectedLength(session, number) };
}

export async function completeMultipart(client: S3Client, store: UploadSessionStore, buckets: R2UploadBuckets,
  userId: string, sessionId: string, submitted: unknown) {
  const session = await store.assertActive(sessionId, userId, 'created');
  if (!session.upload_id || session.kind !== 'video' || session.expected_size <= DIRECT_BYTES ||
    !isStagingKey(session.staging_key, userId, session.id, session.kind) || !Array.isArray(submitted)) {
    throw new Error('Invalid multipart upload session.');
  }
  const listing = await client.send(new ListPartsCommand({ Bucket: buckets.privateBucket,
    Key: session.staging_key, UploadId: session.upload_id, MaxParts: 1000 }));
  if (listing.IsTruncated) throw new Error('Upload contains unexpected extra parts.');
  const parts = verifyMultipartParts(session.expected_size, listing.Parts || [], submitted);
  await client.send(new CompleteMultipartUploadCommand({ Bucket: buckets.privateBucket,
    Key: session.staging_key, UploadId: session.upload_id, MultipartUpload: { Parts: parts } }));
  return await finalizeUpload(client, store, buckets, userId, sessionId);
}

export async function abortUpload(client: S3Client, store: UploadSessionStore, buckets: R2UploadBuckets,
  userId: string, sessionId: string): Promise<void> {
  const session = await store.get(sessionId, userId);
  if (session.status === 'aborted' || session.status === 'failed') return;
  if (session.status !== 'created') throw new Error('This upload has already been finalized.');
  await store.transition(session.id, userId, 'created', 'aborted');
  if (session.upload_id) {
    await client.send(new AbortMultipartUploadCommand({ Bucket: buckets.privateBucket,
      Key: session.staging_key, UploadId: session.upload_id })).catch(() => undefined);
  }
  await client.send(new DeleteObjectCommand({ Bucket: buckets.privateBucket, Key: session.staging_key })).catch(() => undefined);
}

/**
 * Prevent time-of-check/time-of-use swaps: GetObject IfMatch and CopySourceIfMatch
 * guarantee the bytes checked are the bytes promoted to the final key.
 */
export async function finalizeUpload(client: S3Client, store: UploadSessionStore, buckets: R2UploadBuckets,
  userId: string, sessionId: string) {
  const session = await store.assertActive(sessionId, userId, 'created');
  if (!isStagingKey(session.staging_key, userId, session.id, session.kind)) throw new Error('Invalid staging key.');
  const finalKey = finalAssetKey(userId, session.id, session.kind);
  const assetRef = session.kind === 'video' ? `private://${finalKey}` : publicAssetUrl(finalKey);
  await store.transition(session.id, userId, 'created', 'processing');
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: buckets.privateBucket, Key: session.staging_key }));
    if (head.ContentLength !== session.expected_size || head.ContentType?.split(';')[0] !== session.content_type || !head.ETag) {
      throw new Error('Storage object length, MIME type or checksum differs from the approved upload.');
    }
    if (session.kind === 'image') {
      const result = await client.send(new GetObjectCommand({ Bucket: buckets.privateBucket, Key: session.staging_key, IfMatch: head.ETag }));
      if (!result.Body) throw new Error('Uploaded image is missing.');
      const input = Buffer.from(await result.Body.transformToByteArray());
      if (input.length !== session.expected_size) throw new Error('Uploaded image length mismatch.');
      const converted = await sanitizeImage(input);
      await client.send(new PutObjectCommand({ Bucket: buckets.publicBucket, Key: finalKey, Body: converted,
        ContentLength: converted.length, ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable' }));
    } else {
      const response = await client.send(new GetObjectCommand({ Bucket: buckets.privateBucket, Key: session.staging_key,
        IfMatch: head.ETag, Range: 'bytes=0-4095' }));
      if (!response.Body) throw new Error('Uploaded video has no data.');
      const leading = Buffer.from(await response.Body.transformToByteArray());
      if (!hasMp4FileType(leading)) throw new Error('Uploaded video does not contain an MP4 file header.');
      const safeCopySource = encodeURIComponent(buckets.privateBucket) + '/' + session.staging_key.split('/').map(encodeURIComponent).join('/');
      await client.send(new CopyObjectCommand({ Bucket: buckets.privateBucket, Key: finalKey,
        CopySource: safeCopySource, CopySourceIfMatch: head.ETag,
        MetadataDirective: 'REPLACE', ContentType: 'video/mp4', CacheControl: 'private, no-store' }));
      const copied = await client.send(new HeadObjectCommand({ Bucket: buckets.privateBucket, Key: finalKey }));
      if (copied.ContentLength !== session.expected_size) throw new Error('Verified video size changed during copy.');
    }
    const completed = await store.transition(session.id, userId, 'processing', 'ready', { final_key: finalKey });
    // Failure to remove staging does not expose it publicly. A private R2 lifecycle
    // rule must expire all staging/* objects to clean up interrupted requests.
    await client.send(new DeleteObjectCommand({ Bucket: buckets.privateBucket, Key: session.staging_key }))
      .catch(error => console.warn('Private upload staging cleanup is pending:', error));
    return { sessionId: completed.id, assetRef };
  } catch (error) {
    // A retry must start a fresh session. Staging is never directly published.
    await store.transition(session.id, userId, 'processing', 'failed').catch(() => undefined);
    await client.send(new DeleteObjectCommand({ Bucket: session.kind === 'image' ? buckets.publicBucket : buckets.privateBucket, Key: finalKey }))
      .catch(() => undefined);
    throw error;
  }
}
