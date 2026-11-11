import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import jwt from 'jsonwebtoken';

test('the running Express API fails closed for legacy authentication', { timeout: 20000 }, async () => {
  const port = 31000 + (process.pid % 21000);
  const root = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let startupLog = '';

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server start timeout: ${startupLog.slice(-500)}`)), 12000);
      const gotOutput = chunk => {
        startupLog += chunk.toString();
        if (startupLog.includes('VisPlay server running')) {
          clearTimeout(timer);
          resolve();
        }
      };
      server.stdout.on('data', gotOutput);
      server.stderr.on('data', gotOutput);
      server.on('error', err => { clearTimeout(timer); reject(err); });
      server.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${startupLog.slice(-600)}`)); });
    });

    const post = async (route, body) => {
      const res = await fetch(root + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.status;
    };

    assert.equal(await post('/api/auth/register', { email: 'target@example.com', password: 'some-password' }), 410);
    assert.equal(await post('/api/auth/login', { email: 'viewer@visplay.ng', password: 'viewer123' }), 410);
    assert.equal(await post('/api/auth/supabase-sync', {}), 401);

    const legacyToken = jwt.sign({ userId: 'user_admin_01' }, 'visplay-super-secure-jwt-secret-nollywood-2026');
    const headers = { Authorization: `Bearer ${legacyToken}` };
    const protectedResponse = await fetch(root + '/api/user/library', { headers });
    assert.equal(protectedResponse.status, 401);
    const meResponse = await fetch(root + '/api/auth/me', { headers });
    assert.equal((await meResponse.json()).user, null);
  } finally {
    server.kill('SIGTERM');
  }
});
