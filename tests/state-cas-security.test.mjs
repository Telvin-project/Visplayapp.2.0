import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeDatabase, loadDatabase, saveDatabase, AppStateConflictError } from '../server/db.ts';

test('isolated app-state revisions reject overlapping writers without erasing a prior successful write', async () => {
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'visplay-h-cas-'));
  try {
    process.chdir(dir);
    await initializeDatabase();
    const first = loadDatabase();
    const second = loadDatabase();
    first.featured_movie_id = 'first_committed';
    second.featured_movie_id = 'second_stale';
    await saveDatabase(first);
    await assert.rejects(saveDatabase(second), AppStateConflictError);
    assert.equal(loadDatabase().featured_movie_id, 'first_committed');
    const onDisk = JSON.parse(await readFile(path.join(dir, 'data/visplay_db.json'), 'utf8'));
    assert.equal(onDisk.featured_movie_id, 'first_committed');
    const third = loadDatabase();
    third.featured_movie_id = 'third_committed';
    await saveDatabase(third);
    assert.equal(loadDatabase().featured_movie_id, 'third_committed');
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test('one unsaved route snapshot cannot mutate the live cache by reference', async () => {
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'visplay-h-copy-'));
  try {
    process.chdir(dir);
    await initializeDatabase();
    const copy = loadDatabase();
    const initial = copy.users[0].role;
    copy.users[0].role = initial === 'admin' ? 'viewer' : 'admin';
    assert.equal(loadDatabase().users[0].role, initial);
    await assert.rejects(saveDatabase({ ...copy }), AppStateConflictError);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});
