import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SafetyInputError, parseReportInput, limitedText, targetOwner, blockedCreatorIds,
  blockingUserIds, publiclyVisibleMovie, pendingRightsComplaint,
  normalizeSafetyCollections, parseRightsAttestation,
  CONTENT_RATINGS, validatePublicComment,
} from '../server/trust-safety.ts';
import { toClientMovie } from '../server/media-access.ts';

const owner = { id: 'owner', role: 'creator', full_name: 'Creator' };
const viewer = { id: 'viewer', role: 'viewer', full_name: 'Viewer' };
const film = {
  id: 'mov_one', creator_id: 'channel_one', title: 'A Movie', status: 'published',
  video_url: 'private://videos/owner/12345678-1234-4234-8234-123456789abc.mp4',
  preview_private_key: 'previews/owner/12345678-1234-4234-8234-123456789abc.mp4',
  rights_attestation: { rights_holder: 'Private Corporation', basis: 'licensed', evidence_reference: 'contract-11' },
  rights_review: { evidence_reference: 'private-contract-11', review_notes: 'Private legal notes' },
};
const fixture = () => ({
  users: [owner, viewer],
  creator_profiles: [{ id: 'channel_one', user_id: 'owner', status: 'approved' }],
  movies: [structuredClone(film)],
  comments: [{ id: 'com_one', user_id: 'viewer', movie_id: 'mov_one', comment_text: 'Hello' }],
  safety_reports: [], safety_blocks: [], safety_appeals: [],
});

test('reports accept only known target types, reasons and a limited explanation', () => {
  const correct = parseReportInput({ target_type: 'movie', target_id: 'mov_one', reason: 'copyright', description: 'I am the rightful owner.' });
  assert.equal(correct.target_type, 'movie');
  assert.equal(correct.reason, 'copyright');
  for (const incorrect of [
    { target_type: 'wallet', target_id: 'mov_one', reason: 'copyright', description: 'Exceeds expected type' },
    { target_type: 'movie', target_id: 'mov_one', reason: 'transfer_money', description: 'Exceeds expected type' },
    { target_type: 'movie', target_id: '../private', reason: 'copyright', description: 'Exceeds expected type' },
    { target_type: 'movie', target_id: 'mov_one', reason: 'copyright', description: 'short' },
    { target_type: 'movie', target_id: 'mov_one', reason: 'copyright', description: 'A'.repeat(1201) },
  ]) assert.throws(() => parseReportInput(incorrect), SafetyInputError);
});

test('report and review text rejects control characters and nonstrings', () => {
  assert.equal(limitedText(' legal rights review ', 80, 'Reason'), 'legal rights review');
  assert.throws(() => limitedText('bad\u0000control', 80, 'Reason'), SafetyInputError);
  assert.throws(() => limitedText(['not text'], 80, 'Reason'), SafetyInputError);
});

test('report target owner is derived from server records, never caller claims', () => {
  const db = fixture();
  assert.equal(targetOwner(db, 'movie', 'mov_one')?.id, 'owner');
  assert.equal(targetOwner(db, 'creator', 'channel_one')?.id, 'owner');
  assert.equal(targetOwner(db, 'comment', 'com_one')?.id, 'viewer');
  assert.equal(targetOwner(db, 'user', 'viewer')?.id, 'viewer');
  assert.equal(targetOwner(db, 'movie', 'mov_fake'), undefined);
});

test('blocked creator and commenting owner are excluded in both directions', () => {
  const db = fixture();
  db.safety_blocks.push({ id: 'blk_1', blocker_user_id: 'viewer', blocked_user_id: 'owner' });
  assert.deepEqual([...blockingUserIds(db, 'viewer')], ['owner']);
  assert.deepEqual([...blockingUserIds(db, 'owner')], ['viewer']);
  assert.deepEqual([...blockedCreatorIds(db, 'viewer')], ['channel_one']);
  assert.deepEqual([...blockedCreatorIds(db, 'unrelated')], []);
});

test('movie safety holds prevent discovery, and pending copyright reports prevent release', () => {
  const db = fixture();
  assert.equal(publiclyVisibleMovie(db.movies[0]), true);
  db.movies[0].safety_hold = true;
  assert.equal(publiclyVisibleMovie(db.movies[0]), false);
  db.movies[0].safety_hold = false;
  db.safety_reports.push({ id: 'case', target_type: 'movie', target_id: 'mov_one', reason: 'copyright', status: 'open' });
  assert.equal(pendingRightsComplaint(db, 'mov_one'), true);
  db.safety_reports[0].status = 'dismissed';
  assert.equal(pendingRightsComplaint(db, 'mov_one'), false);
});

test('legacy database gets only new empty moderation collections without losing prior records', () => {
  const db = fixture();
  delete db.safety_reports;
  delete db.safety_blocks;
  delete db.safety_appeals;
  normalizeSafetyCollections(db);
  assert.equal(db.movies.length, 1);
  assert.deepEqual(db.safety_reports, []);
  assert.deepEqual(db.safety_blocks, []);
  assert.deepEqual(db.safety_appeals, []);
});

test('new creator submission needs both terms acceptance and a defensible rights declaration', () => {
  const valid = { rights_confirmed: 'true', content_policy_accepted: 'true', rights_basis: 'licensed',
    rights_holder: 'Legal Distribution Company', rights_evidence_reference: 'Licence 12B' };
  const attestation = parseRightsAttestation(valid, 'creator_1');
  assert.equal(attestation.actor_user_id, 'creator_1');
  assert.equal(attestation.basis, 'licensed');
  assert.equal(attestation.policy_version, '2026-11-11');
  for (const invalid of [
    { ...valid, rights_confirmed: false },
    { ...valid, content_policy_accepted: false },
    { ...valid, rights_basis: 'stolen' },
    { ...valid, rights_holder: 'A' },
    { ...valid, rights_evidence_reference: 'https://secret.example.org' },
    { ...valid, rights_evidence_reference: 'password:1234' },
  ]) assert.throws(() => parseRightsAttestation(invalid, 'creator_1'), SafetyInputError);
});

test('public movie JSON strips private media keys, contracts and reviewer notes', () => {
  const external = toClientMovie(film);
  assert.equal(external.video_url, '/api/media/stream/mov_one');
  assert.equal('preview_private_key' in external, false);
  assert.equal('rights_attestation' in external, false);
  assert.equal('rights_review' in external, false);
  assert.doesNotMatch(JSON.stringify(external), /Private Corporation|private-contract-11|contract-11/);
});

test('comments require explicit rule acceptance and block external links or credential requests', () => {
  assert.equal(validatePublicComment(' I liked the ending. ', true), 'I liked the ending.');
  for (const [comment, accepted] of [
    ['A normal comment without accepted rules', false],
    ['Look at https://example.com', true],
    ['Visit wa.me/1234567', true],
    ['Send your OTP to my inbox', true],
    ['  ', true],
    ['x'.repeat(2001), true],
  ]) assert.throws(() => validatePublicComment(comment, accepted), SafetyInputError);
});

test('content ratings are explicit and adult content cannot silently be classified as general', () => {
  assert.deepEqual(CONTENT_RATINGS, ['GENERAL', 'PARENTAL_GUIDANCE', 'TEEN', 'ADULT']);
  assert.equal(CONTENT_RATINGS.includes('ADULT'), true);
  assert.equal(CONTENT_RATINGS.includes('UNKNOWN'), false);
});
