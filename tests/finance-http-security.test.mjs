import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('public cannot forge a Paystack webhook or operate paid endpoints without authentication', { timeout: 20000 }, async () => {
  const port = 46000 + (process.pid % 10000);
  const root = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), PAYSTACK_SECRET_KEY: 'sk_test_for_http_tests' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Startup timed out: ' + output.slice(-250))), 12000);
      const onData = chunk => {
        output += chunk.toString();
        if (output.includes('VisPlay server running')) { clearTimeout(timer); resolve(); }
      };
      server.stdout.on('data', onData);
      server.stderr.on('data', onData);
      server.on('error', reject);
      server.on('exit', code => reject(new Error('Server exited: ' + code + ' ' + output.slice(-250))));
    });
    const webhook = await fetch(root + '/api/paystack/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'a'.repeat(128) },
      body: JSON.stringify({ event: 'charge.success', data: { reference: 'VIS_DEP_FAKE' } }),
    });
    assert.equal(webhook.status, 401);
    for (const route of ['/api/wallet/deposit/initialize', '/api/wallet/deposit/verify',
      '/api/purchases/movie/initialize', '/api/purchases/movie/verify',
      '/api/purchases/buy-movie', '/api/purchases/buy-bundle']) {
      const result = await fetch(root + route, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(result.status, 401, route + ' must require a verified account');
    }
    const preview = await fetch(root + '/api/media/stream/mov_lagos_syndicate?mode=full');
    assert.equal(preview.status, 403);
  } finally { server.kill('SIGTERM'); }
});
