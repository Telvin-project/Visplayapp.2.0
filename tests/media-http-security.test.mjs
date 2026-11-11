import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

function verifyNoMovieStorageLeak(payload) {
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      assert.notEqual(key, 'preview_private_key', 'Preview storage key leaked in an API payload');
      if (key === 'video_url') {
        assert.match(item, /^\/api\/media\/stream\/[A-Za-z0-9_%.-]+$/, 'Original movie URL leaked');
      } else {
        visit(item);
      }
    }
  };
  visit(payload);
}

test('public APIs never expose movie masters and cannot serve a free full film', { timeout: 20000 }, async () => {
  const port = 33000 + (process.pid % 21000);
  const root = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), R2_PRIVATE_VIDEO_BUCKET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Server timeout: ${output.slice(-400)}`)), 12000);
      const onData = chunk => {
        output += chunk.toString();
        if (output.includes('VisPlay server running')) {
          clearTimeout(timer);
          resolve();
        }
      };
      server.stdout.on('data', onData);
      server.stderr.on('data', onData);
      server.on('error', reject);
      server.on('exit', code => reject(new Error(`Server terminated ${code}: ${output.slice(-400)}`)));
    });

    for (const endpoint of ['/api/movies', '/api/movies/featured', '/api/movies/categories', '/api/bundles', '/api/movies/mov_lagos_syndicate']) {
      const response = await fetch(root + endpoint);
      assert.equal(response.status, 200, `${endpoint} must serve movie metadata`);
      verifyNoMovieStorageLeak(await response.json());
    }

    const unauthorized = await fetch(root + '/api/media/stream/mov_lagos_syndicate?mode=full');
    assert.equal(unauthorized.status, 403, 'Anonymous full playback must be forbidden');
    const noPreview = await fetch(root + '/api/media/stream/mov_lagos_syndicate?mode=preview');
    assert.equal(noPreview.status, 423, 'Legacy movie must not fall back to its public full URL');
    const invalidMode = await fetch(root + '/api/media/stream/mov_lagos_syndicate?mode=bad');
    assert.equal(invalidMode.status, 400);
  } finally {
    server.kill('SIGTERM');
  }
});
