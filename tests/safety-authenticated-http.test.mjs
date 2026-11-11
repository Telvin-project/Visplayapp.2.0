import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const testSecret = 'section-g-integration-fixture-only-long-random-enough-string';

test('isolated real HTTP flow: report -> admin action -> appeal -> separate restoration, with private account boundaries', { timeout: 25000 }, async () => {
  const disposable = fs.mkdtempSync(path.join(os.tmpdir(), 'visplay-safety-test-'));
  const port = 38000 + (process.pid % 10000);
  const root = `http://127.0.0.1:${port}`;
  const users = [
    { id: 'reporter', supabase_auth_id: 'verified-reporter-id', role: 'viewer', full_name: 'Viewer', wallet_balance: 0 },
    { id: 'owner', supabase_auth_id: 'verified-owner-id', role: 'creator', full_name: 'Film Creator', wallet_balance: 0 },
    { id: 'admin', supabase_auth_id: 'verified-admin-id', role: 'admin', full_name: 'Operator', wallet_balance: 0 },
  ];
  const data = {
    users,
    creator_profiles: [{ id: 'creator_channel', user_id: 'owner', status: 'approved', channel_name: 'Test Channel' }],
    movies: [{ id: 'mov_test', creator_id: 'creator_channel', status: 'published', title: 'Test Film', genre: 'Drama',
      synopsis: 'A safe fixture film', video_url: 'private://videos/owner/12345678-1234-4234-8234-123456789abc.mp4',
      poster_url: '/test.jpg', views_count: 0, paid_unlocks_count: 0 },
      { id: 'mov_draft', creator_id: 'creator_channel', status: 'pending', title: 'Draft Film', genre: 'Drama',
        synopsis: 'A second safe fixture', video_url: 'private://videos/owner/12345678-1234-4234-8234-123456789abd.mp4',
        poster_url: '/test.jpg', views_count: 0, paid_unlocks_count: 0 }],
    comments: [], follows: [], likes: [], transactions: [], purchases: [], ledger: [], payouts: [],
    viewing_events: [], livestreams: [], premieres: [], rewards: [], ads: [], audit_logs: [], notifications: [],
  };
  fs.mkdirSync(path.join(disposable, 'data'));
  fs.writeFileSync(path.join(disposable, 'data', 'visplay_db.json'), JSON.stringify(data));
  const server = spawn(process.execPath, ['--import', path.join(projectRoot, 'node_modules/tsx/dist/loader.mjs'), path.join(projectRoot, 'server.ts')], {
    cwd: disposable,
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), JWT_SECRET: testSecret,
      SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', VITE_SUPABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const token = name => jwt.sign({ userId: name, authId: `verified-${name}-id` }, testSecret, { expiresIn: '10m' });
  const request = async (url, name, method = 'GET', body) => {
    const response = await fetch(root + url, { method,
      headers: { Authorization: `Bearer ${token(name)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error(`Startup timeout: ${output.slice(-350)}`)), 15000);
      const onData = chunk => {
        output += chunk.toString();
        if (output.includes('VisPlay server running')) { clearTimeout(timeout); resolve(); }
      };
      server.stdout.on('data', onData); server.stderr.on('data', onData);
      server.on('error', reject); server.on('exit', code => reject(new Error(`Server stopped ${code}: ${output.slice(-350)}`)));
    });

    const reportBody = { target_type: 'creator', target_id: 'creator_channel', reason: 'harassment',
      description: 'Repeated insults and harassment in the channel comments.' };
    const posted = await request('/api/safety/reports', 'reporter', 'POST', reportBody);
    assert.equal(posted.status, 201);
    assert.match(posted.body.report_id, /^saf_/);
    assert.equal((await request('/api/safety/reports', 'reporter', 'POST', reportBody)).status, 409);
    assert.equal((await request('/api/admin/safety/reports', 'reporter')).status, 403);
    const myReports = await request('/api/safety/my-reports', 'reporter');
    assert.equal(myReports.body.reports.length, 1);
    assert.equal((await request('/api/safety/my-reports', 'owner')).body.reports.length, 0);

    assert.equal((await request('/api/safety/blocks/owner', 'reporter', 'POST')).status, 200);
    assert.equal((await request('/api/safety/blocks/owner', 'reporter', 'POST')).status, 200);
    assert.equal((await request('/api/safety/blocks/reporter', 'reporter', 'POST')).status, 400);
    assert.equal((await request('/api/safety/blocks', 'reporter')).body.blocks.length, 1);
    assert.equal((await request('/api/safety/blocks/owner', 'reporter', 'DELETE')).status, 200);
    assert.equal((await request('/api/safety/blocks', 'reporter')).body.blocks.length, 0);

    const rating = await request('/api/admin/movies/mov_draft/content-rating', 'admin', 'POST',
      { content_rating: 'TEEN', review_notes: 'Personally checked action scenes and mature thematic elements.' });
    assert.equal(rating.status, 200);
    const rights = await request('/api/admin/movies/mov_draft/rights-review', 'admin', 'POST',
      { verification_basis: 'licence', evidence_reference: 'DOC-2026-017',
        review_notes: 'Reviewed the signed distribution contract and verified the stated territory.' });
    assert.equal(rights.status, 200);
    assert.equal((await request('/api/admin/movies/mov_draft/rights-review', 'owner', 'POST',
      { verification_basis: 'original', evidence_reference: 'wrong', review_notes: 'Not an authorized admin reviewer.' })).status, 403);

    const adminQueue = await request('/api/admin/safety/reports', 'admin');
    assert.equal(adminQueue.status, 200);
    assert.equal(adminQueue.body.reports.length, 1);
    assert.equal((await request(`/api/admin/safety/reports/${posted.body.report_id}/review`, 'reporter', 'POST',
      { status: 'actioned', enforcement_action: 'restrict_creator', decision_note: 'I reviewed channel evidence.' })).status, 403);
    assert.equal((await request(`/api/admin/safety/reports/${posted.body.report_id}/review`, 'admin', 'POST',
      { status: 'actioned', enforcement_action: 'hold_movie', decision_note: 'A mismatched moderation target.' })).status, 400);
    const actioned = await request(`/api/admin/safety/reports/${posted.body.report_id}/review`, 'admin', 'POST',
      { status: 'actioned', enforcement_action: 'restrict_creator', decision_note: 'Reviewed cited bullying evidence and channel messages.' });
    assert.equal(actioned.status, 200);
    assert.equal((await fetch(root + '/api/creators/channel/creator_channel')).status, 404);

    const appealed = await request('/api/safety/appeals', 'owner', 'POST',
      { report_id: posted.body.report_id, statement: 'I believe these reports omit relevant context and request a re-review.' });
    assert.equal(appealed.status, 201);
    assert.equal((await request('/api/safety/appeals', 'owner', 'POST',
      { report_id: posted.body.report_id, statement: 'I believe these reports omit relevant context and request a re-review.' })).status, 409);
    const appealReview = await request(`/api/admin/safety/appeals/${appealed.body.appeal_id}/review`, 'admin', 'POST',
      { outcome: 'upheld', decision_note: 'We verified additional evidence and will restore the channel.' });
    assert.equal(appealReview.status, 200);
    assert.equal((await fetch(root + '/api/creators/channel/creator_channel')).status, 404);
    const restoration = await request(`/api/admin/safety/appeals/${appealed.body.appeal_id}/restore`, 'admin', 'POST',
      { restoration_note: 'Independent follow-up review found the restriction unnecessary.' });
    assert.equal(restoration.status, 200);
    assert.equal((await fetch(root + '/api/creators/channel/creator_channel')).status, 200);
    assert.equal((await request(`/api/admin/safety/appeals/${appealed.body.appeal_id}/restore`, 'admin', 'POST',
      { restoration_note: 'Try restoring an already restored channel again.' })).status, 409);

    const result = JSON.parse(fs.readFileSync(path.join(disposable, 'data', 'visplay_db.json'), 'utf8'));
    assert.equal(result.safety_reports[0].status, 'actioned');
    assert.ok(result.safety_appeals[0].restored_at);
    assert.equal(result.audit_logs.some(item => item.action === 'SAFETY_RESTORE_AFTER_APPEAL'), true);
    assert.equal(result.creator_profiles[0].safety_restricted, false);
    assert.equal(result.movies.find(movie => movie.id === 'mov_draft').content_rating, 'TEEN');
    assert.equal(result.movies.find(movie => movie.id === 'mov_draft').rights_review.evidence_reference, 'DOC-2026-017');
  } finally {
    server.kill('SIGTERM');
    fs.rmSync(disposable, { recursive: true, force: true });
  }
});
