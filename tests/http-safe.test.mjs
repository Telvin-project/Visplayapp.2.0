import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { protectAsyncRoutes } from '../server/http-safety.ts';

test('Express 4 async failures reach the API error middleware', async () => {
  const app = express();
  protectAsyncRoutes(app);
  app.get('/api/fail', async () => { throw new Error('simulated database race'); });
  app.use((error, _req, res, _next) => res.status(409).json({ error: error.message }));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/fail`);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'simulated database race' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
