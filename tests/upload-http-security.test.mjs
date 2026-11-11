import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('upload signing, completion and creator image updates require verified identity', { timeout: 20000 }, async () => {
  const port = 35000 + (process.pid % 18000);
  const root = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), R2_PRIVATE_VIDEO_BUCKET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Server startup failed: ${output.slice(-400)}`)), 12000);
      const onData = chunk => {
        output += chunk.toString();
        if (output.includes('VisPlay server running')) { clearTimeout(timer); resolve(); }
      };
      server.stdout.on('data', onData);
      server.stderr.on('data', onData);
      server.on('error', reject);
      server.on('exit', code => reject(new Error(`Server exited ${code}: ${output.slice(-400)}`)));
    });

    const routes = [
      '/api/movies/upload-url', '/api/movies/multipart/init', '/api/movies/multipart/part-url',
      '/api/movies/multipart/complete', '/api/movies/multipart/abort', '/api/movies/uploads/complete',
      '/api/movies/upload',
    ];
    for (const route of routes) {
      const response = await fetch(root + route, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: 'posters', filename: 'safe.png', contentType: 'image/png', size: 100 }) });
      assert.equal(response.status, 401, `${route} should fail before signing or uploading any bytes`);
      const data = await response.json();
      assert.equal(data.uploadUrl, undefined);
    }
    const channel = await fetch(root + '/api/creators/my-channel/media', { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'avatar', image_upload_id: 'forged' }) });
    assert.equal(channel.status, 401);
    assert.equal((await fetch(root + '/uploads/videos/original.mp4')).status, 404);
    assert.equal((await fetch(root + '/uploads/posters/user-controlled.svg')).status, 404);
    assert.equal((await fetch(root + '/videos/original.mp4')).status, 404);
    const malformed = await fetch(root + '/api/movies/upload-url', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{malformed' });
    assert.equal(malformed.status, 400);
    assert.match((await malformed.json()).error, /Malformed JSON/);
  } finally {
    server.kill('SIGTERM');
  }
});
