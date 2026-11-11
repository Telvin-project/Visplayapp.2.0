/**
 * Operator-run preview worker (one movie per invocation).
 *
 * Usage:
 *   node --import tsx scripts/generate-preview.ts <movie-id>
 *
 * Downloads a PRIVATE R2 master to bounded temporary disk space, validates
 * codecs, transcodes its first five minutes into a separate private MP4, and
 * prints an attach-preview manifest. It never modifies the live database.
 * Run behind a managed job queue in production, not in an HTTP request.
 */
import 'dotenv/config';
import { createReadStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { initializeDatabase, loadDatabase } from '../server/db.js';
import { privateVideoKey } from '../server/media-access.js';
import { scanMediaFile } from './media-malware-scan.js';

const MAX_MASTER_BYTES = 500 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 250 * 1024 * 1024;

function privateClient() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const keyId = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_PRIVATE_VIDEO_BUCKET?.trim();
  const publicBucket = process.env.R2_BUCKET_NAME || 'visplay-media';
  if (!accountId || !keyId || !secret || !bucket || bucket === publicBucket) {
    throw new Error('A separate, private R2 video bucket and server-only R2 credentials are required.');
  }
  return {
    bucket,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: keyId, secretAccessKey: secret },
    }),
  };
}

async function runTool(binary: 'ffmpeg' | 'ffprobe', args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timeoutMs = binary === 'ffprobe' ? 45_000 : 30 * 60 * 1000;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${binary} exceeded its processing timeout.`)); }, timeoutMs);
    child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-12_000); });
    child.stderr.on('data', chunk => { output = (output + chunk.toString()).slice(-12_000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`${binary} failed (exit ${code}): ${output}`));
    });
  });
}

async function probeMedia(filename: string): Promise<{ duration: number; videoCodec: string; audioCodecs: string[] }> {
  const output = await runTool('ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json',
    '-show_entries', 'format=duration:stream=codec_type,codec_name', filename,
  ]);
  const result = JSON.parse(output);
  const streams: Array<{ codec_type: string; codec_name: string }> = result.streams || [];
  return {
    duration: Number(result.format?.duration),
    videoCodec: streams.find(s => s.codec_type === 'video')?.codec_name || '',
    audioCodecs: streams.filter(s => s.codec_type === 'audio').map(s => s.codec_name),
  };
}

async function main() {
  const movieId = process.argv[2];
  if (!movieId || !/^[A-Za-z0-9_-]{3,80}$/.test(movieId)) {
    throw new Error('Usage: node --import tsx scripts/generate-preview.ts <movie-id>');
  }

  const { client, bucket } = privateClient();
  await initializeDatabase();
  const movie = loadDatabase().movies.find(m => m.id === movieId);
  if (!movie) throw new Error('Movie ID not found in the configured environment.');
  const masterKey = privateVideoKey(movie.video_url);
  if (!masterKey) throw new Error('Movie master is not yet migrated into private:// storage.');

  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: masterKey }));
  if (!head.ContentLength || head.ContentLength > MAX_MASTER_BYTES || head.ContentType?.split(';')[0] !== 'video/mp4') {
    throw new Error('Private master is missing, too large or not MP4.');
  }

  const workspace = await fs.mkdtemp(path.join(tmpdir(), 'visplay-preview-'));
  const sourcePath = path.join(workspace, 'master.mp4');
  const previewPath = path.join(workspace, 'preview.mp4');
  try {
    const downloaded = await client.send(new GetObjectCommand({ Bucket: bucket, Key: masterKey }));
    const body = downloaded.Body as unknown as Readable | undefined;
    if (!body || typeof body.pipe !== 'function') throw new Error('Master download has no readable stream.');
    await pipeline(body, (await import('node:fs')).createWriteStream(sourcePath, { flags: 'wx', mode: 0o600 }));
    const bytes = (await fs.stat(sourcePath)).size;
    if (bytes !== head.ContentLength) throw new Error('Master download length mismatch.');

    await scanMediaFile(sourcePath);

    const input = await probeMedia(sourcePath);
    if (!Number.isFinite(input.duration) || input.duration <= 0) throw new Error('Master has an invalid duration.');
    if (input.videoCodec !== 'h264' || input.audioCodecs.some(codec => codec !== 'aac')) {
      throw new Error('Master must contain H.264 video and AAC audio for reliable browser playback. Transcode the master first.');
    }

    // Transcoding creates a genuinely short independent asset. This is the
    // security boundary; JavaScript time limits on a full MP4 do not protect it.
    await runTool('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-i', sourcePath,
      '-t', '299.9', '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'scale=w=min(1280\\,iw):h=-2',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      previewPath,
    ]);
    const preview = await probeMedia(previewPath);
    const size = (await fs.stat(previewPath)).size;
    if (!Number.isFinite(preview.duration) || preview.duration <= 0 || preview.duration > 300 || !size || size > MAX_PREVIEW_BYTES) {
      throw new Error('Generated preview failed duration/size validation; no object was published.');
    }
    if (preview.videoCodec !== 'h264') throw new Error('Preview encoding validation failed.');

    const previewKey = `previews/${movie.id}/${uuidv4()}.mp4`;
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: previewKey, Body: createReadStream(previewPath),
      ContentLength: size, ContentType: 'video/mp4', CacheControl: 'private, no-store',
      Metadata: { movieid: movie.id, durationseconds: preview.duration.toFixed(2) },
    }));

    // Operator attaches this key through POST /api/admin/movies/:id/attach-preview
    // after reviewing the generated clip in a staging environment.
    process.stdout.write(JSON.stringify({
      movie_id: movie.id,
      preview_private_key: previewKey,
      preview_duration_seconds: Number(preview.duration.toFixed(2)),
      preview_bytes: size,
      attach_endpoint: `/api/admin/movies/${movie.id}/attach-preview`,
    }, null, 2) + '\n');
  } finally {
    // Only delete the uniquely generated temp directory, never user assets.
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error('Private preview generation failed:', error?.message || error);
  process.exitCode = 1;
});
