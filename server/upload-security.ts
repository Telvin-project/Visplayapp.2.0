import sharp from 'sharp';

/** All untrusted creator uploads first land in a PRIVATE R2 staging prefix. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 25_000_000;
export const MAX_PUBLIC_IMAGE_BYTES = 5 * 1024 * 1024;
export const PART_BYTES = 8 * 1024 * 1024;
export const DIRECT_BYTES = 16 * 1024 * 1024;
export const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
export const MAX_ACTIVE_UPLOADS = 3;
export const MAX_DAILY_UPLOAD_SESSIONS = 30;
export const MAX_DAILY_RESERVED_BYTES = 1024 * 1024 * 1024;

export type UploadKind = 'video' | 'image';
export type ImageUsage = 'poster' | 'avatar' | 'banner';
export type UploadUsage = 'movie' | ImageUsage;

export interface UploadSpec {
  kind: UploadKind;
  usage: UploadUsage;
  contentType: string;
  size: number;
  partCount: number;
  multipart: boolean;
}

const IMAGE_TYPES: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

/** No user-controlled filename is ever used in an R2 key. */
export function parseUploadSpec(input: unknown): UploadSpec {
  if (!input || typeof input !== 'object') throw new Error('Invalid upload request.');
  const body = input as Record<string, unknown>;
  if (body.folder !== 'videos' && body.folder !== 'posters') throw new Error('Only video and image uploads are supported.');
  const kind: UploadKind = body.folder === 'videos' ? 'video' : 'image';
  const size = body.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > (kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
    throw new Error(kind === 'video' ? 'Videos must be 500 MB or smaller.' : 'Images must be 10 MB or smaller.');
  }
  const contentType = body.contentType;
  const filename = body.filename;
  if (typeof contentType !== 'string' || typeof filename !== 'string' || filename.length < 3 || filename.length > 180) {
    throw new Error('A supported filename and exact MIME type are required.');
  }
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (kind === 'video' && (contentType !== 'video/mp4' || extension !== '.mp4')) {
    throw new Error('Only .mp4 video files are supported.');
  }
  if (kind === 'image' && !IMAGE_TYPES[contentType]?.includes(extension)) {
    throw new Error('Only matching JPEG, PNG and WebP images are supported.');
  }
  if (kind === 'image' && body.usage !== undefined && !['poster', 'avatar', 'banner'].includes(String(body.usage))) {
    throw new Error('Invalid image use.');
  }
  const usage: UploadUsage = kind === 'video' ? 'movie' : (body.usage || 'poster') as UploadUsage;
  const partCount = Math.ceil(size / PART_BYTES);
  return { kind, usage, size, contentType, partCount, multipart: kind === 'video' && size > DIRECT_BYTES };
}

export function isStagingKey(key: string, userId: string, sessionId: string, kind: UploadKind): boolean {
  return key === `staging/${userId}/${sessionId}/${kind === 'video' ? 'master.mp4' : 'source'}` &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(userId) && /^[0-9a-f-]{36}$/i.test(sessionId);
}

export function finalAssetKey(userId: string, sessionId: string, kind: UploadKind): string {
  return kind === 'video' ? `videos/${userId}/${sessionId}.mp4` : `posters/${userId}/${sessionId}.jpg`;
}

/** Reject common rename-a-ZIP-to-MP4 attacks before a file enters moderation. */
export function hasMp4FileType(buffer: Buffer): boolean {
  if (buffer.length < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
  const boxSize = buffer.readUInt32BE(0);
  if (boxSize < 16 || boxSize > 4096) return false;
  const major = buffer.toString('ascii', 8, 12);
  const brands = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ', 'MSNV']);
  return brands.has(major) || [...brands].some(brand => buffer.toString('ascii', 16, Math.min(buffer.length, boxSize)).includes(brand));
}

/** Resize and re-encode untrusted images; never publish the uploaded bytes. */
export async function sanitizeImage(input: Buffer): Promise<Buffer> {
  if (!input.length || input.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds the upload size limit.');
  const source = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error', animated: false });
  const info = await source.metadata();
  if (!['jpeg', 'png', 'webp'].includes(info.format || '') || !info.width || !info.height ||
      info.width < 1 || info.height < 1 || info.width > 8000 || info.height > 8000 ||
      (info.pages || 1) !== 1 || info.width * info.height > MAX_IMAGE_PIXELS) {
    throw new Error('Unsupported or oversized image. Upload a still JPEG, PNG or WebP file.');
  }
  // Metadata/EXIF is removed by default; resizing also protects downstream clients.
  const output = await source.rotate().resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 83, mozjpeg: true }).toBuffer();
  if (!output.length || output.length > MAX_PUBLIC_IMAGE_BYTES) {
    throw new Error('Image could not be converted within the safe output limit.');
  }
  return output;
}

export interface ObservedPart { PartNumber?: number; Size?: number; ETag?: string }

export function verifyMultipartParts(size: number, parts: ObservedPart[], submitted: ObservedPart[]): Array<{ PartNumber: number; ETag: string }> {
  const expectedCount = Math.ceil(size / PART_BYTES);
  if (expectedCount < 3 || expectedCount > Math.ceil(MAX_VIDEO_BYTES / PART_BYTES) || parts.length !== expectedCount || submitted.length !== expectedCount) {
    throw new Error('Incorrect number of uploaded parts.');
  }
  const indexedSubmitted = new Map<number, string>();
  for (const part of submitted) {
    if (!Number.isInteger(part.PartNumber) || typeof part.ETag !== 'string' || indexedSubmitted.has(part.PartNumber!)) {
      throw new Error('Duplicate or invalid uploaded part.');
    }
    indexedSubmitted.set(part.PartNumber!, part.ETag.replaceAll('"', '').toLowerCase());
  }
  const ordered = [...parts].sort((a, b) => (a.PartNumber || 0) - (b.PartNumber || 0));
  return ordered.map((part, index) => {
    const number = index + 1;
    const expectedBytes = index === expectedCount - 1 ? size - index * PART_BYTES : PART_BYTES;
    const etag = part.ETag?.replaceAll('"', '').toLowerCase();
    if (part.PartNumber !== number || part.Size !== expectedBytes || !etag || !/^[0-9a-f]{32}(?:-\d+)?$/.test(etag) || indexedSubmitted.get(number) !== etag) {
      throw new Error('Part size, order or storage checksum mismatch.');
    }
    return { PartNumber: number, ETag: part.ETag! };
  });
}
