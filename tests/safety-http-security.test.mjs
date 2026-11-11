import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('guest cannot create safety cases, list private reports, block users, or access moderator queue', { timeout: 24000 }, async () => {
  const port = 36500 + (process.pid % 12000);
  const root = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port),
      VISPLAY_SUPPORT_EMAIL: '', VISPLAY_COPYRIGHT_EMAIL: '', VISPLAY_PRIVACY_EMAIL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Startup failed: ${output.slice(-500)}`)), 14000);
      const onData = chunk => {
        output += chunk.toString();
        if (output.includes('VisPlay server running')) { clearTimeout(timer); resolve(); }
      };
      server.stdout.on('data', onData);
      server.stderr.on('data', onData);
      server.on('error', reject);
      server.on('exit', code => reject(new Error(`Exit ${code}: ${output.slice(-300)}`)));
    });

    const config = await fetch(root + '/api/safety/config');
    assert.equal(config.status, 200);
    const response = await config.json();
    assert.equal(response.support_email, null);
    assert.equal(response.copyright_email, null);
    assert.equal(response.privacy_email, null);
    assert.equal(response.employer_legal_approval_required, true);

    for (const route of ['/api/safety/reports', '/api/safety/blocks/user_123', '/api/safety/appeals']) {
      const attempt = await fetch(root + route, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: 'movie', target_id: 'mov_one', reason: 'other', description: 'Forged guest report' }) });
      assert.equal(attempt.status, 401, `${route} must require a verified account`);
    }
    for (const route of ['/api/safety/my-reports', '/api/safety/blocks', '/api/safety/my-appeals']) {
      assert.equal((await fetch(root + route)).status, 401);
    }
    for (const route of ['/api/admin/safety/reports']) {
      assert.equal((await fetch(root + route)).status, 403);
    }
    for (const route of ['/api/admin/safety/reports/saf_123/review', '/api/admin/safety/appeals/apl_123/review',
      '/api/admin/safety/appeals/apl_123/restore', '/api/admin/movies/mov_123/rights-review',
      '/api/admin/movies/mov_123/content-rating']) {
      assert.equal((await fetch(root + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    }
    assert.equal((await fetch(root + '/api/safety/blocks/user_123', { method: 'DELETE' })).status, 401);
  } finally { server.kill('SIGTERM'); }
});
