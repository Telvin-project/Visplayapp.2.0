import type { DatabaseSchema, SafetyReason, SafetyTarget, User } from './db.js';

export const SAFETY_POLICY_VERSION = '2026-11-11' as const;
export const CONTENT_RATINGS = ['GENERAL', 'PARENTAL_GUIDANCE', 'TEEN', 'ADULT'] as const;
const REPORT_REASONS = new Set<SafetyReason>([
  'spam', 'harassment', 'hate', 'sexual_content', 'violence', 'copyright', 'privacy', 'other',
]);
const TARGET_TYPES = new Set<SafetyTarget>(['movie', 'comment', 'creator', 'user']);

export class SafetyInputError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function limitedText(value: unknown, max: number, label: string, minimum = 1): string {
  if (typeof value !== 'string') throw new SafetyInputError(`${label} is required.`);
  const text = value.trim();
  if (text.length < minimum || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new SafetyInputError(`${label} must contain ${minimum}-${max} safe characters.`);
  }
  return text;
}

export function parseReportInput(body: unknown): {
  target_type: SafetyTarget; target_id: string; reason: SafetyReason; description: string;
} {
  if (!body || typeof body !== 'object') throw new SafetyInputError('A report is required.');
  const candidate = body as Record<string, unknown>;
  if (!TARGET_TYPES.has(candidate.target_type as SafetyTarget)) throw new SafetyInputError('Invalid report target.');
  if (!REPORT_REASONS.has(candidate.reason as SafetyReason)) throw new SafetyInputError('Select a valid report reason.');
  const targetId = limitedText(candidate.target_id, 120, 'Target ID');
  if (!/^[A-Za-z0-9_-]+$/.test(targetId)) throw new SafetyInputError('Invalid target ID.');
  const description = limitedText(candidate.description, 1200, 'Explanation', 10);
  return {
    target_type: candidate.target_type as SafetyTarget,
    target_id: targetId, reason: candidate.reason as SafetyReason, description,
  };
}

/** Never trust a client-supplied owner ID. Resolve reported ownership from durable server records. */
export function targetOwner(db: DatabaseSchema, type: SafetyTarget, id: string): User | undefined {
  if (type === 'user') return db.users.find(user => user.id === id);
  if (type === 'comment') {
    const comment = db.comments.find(item => item.id === id);
    return comment ? db.users.find(user => user.id === comment.user_id) : undefined;
  }
  const creator = type === 'creator'
    ? db.creator_profiles.find(item => item.id === id)
    : db.creator_profiles.find(item => item.id === db.movies.find(movie => movie.id === id)?.creator_id);
  return creator ? db.users.find(user => user.id === creator.user_id) : undefined;
}

export function blockingUserIds(db: DatabaseSchema, viewerId?: string): Set<string> {
  if (!viewerId) return new Set();
  return new Set((db.safety_blocks || [])
    .filter(block => block.blocker_user_id === viewerId || block.blocked_user_id === viewerId)
    .map(block => block.blocker_user_id === viewerId ? block.blocked_user_id : block.blocker_user_id));
}

export function blockedCreatorIds(db: DatabaseSchema, viewerId?: string): Set<string> {
  const excluded = blockingUserIds(db, viewerId);
  return new Set(db.creator_profiles.filter(profile => excluded.has(profile.user_id)).map(profile => profile.id));
}

export function publiclyVisibleMovie(movie: {status: string; safety_hold?: boolean}): boolean {
  return movie.status === 'published' && !movie.safety_hold;
}

export function pendingRightsComplaint(db: DatabaseSchema, movieId: string): boolean {
  return (db.safety_reports || []).some(report => report.target_type === 'movie'
    && report.target_id === movieId && report.reason === 'copyright'
    && (report.status === 'open' || report.status === 'reviewing'));
}

export function normalizeSafetyCollections(db: DatabaseSchema) {
  db.safety_reports ||= [];
  db.safety_blocks ||= [];
  db.safety_appeals ||= [];
  return db;
}

export function parseRightsAttestation(body: Record<string, unknown>, userId: string) {
  if ((body.rights_confirmed !== true && body.rights_confirmed !== 'true') ||
    (body.content_policy_accepted !== true && body.content_policy_accepted !== 'true')) {
    throw new SafetyInputError('Confirm your distribution rights and accept the VisPlay creator safety rules.');
  }
  if (!['original', 'licensed', 'authorized'].includes(String(body.rights_basis))) {
    throw new SafetyInputError('Select the legal basis for distributing this movie.');
  }
  const rightsHolder = limitedText(body.rights_holder, 200, 'Rights holder', 2);
  const evidenceReference = body.rights_evidence_reference === undefined || body.rights_evidence_reference === ''
    ? undefined : limitedText(body.rights_evidence_reference, 300, 'Rights evidence reference');
  if (evidenceReference && /https?:\/\/|password|secret|token/i.test(evidenceReference)) {
    throw new SafetyInputError('Use a private contract/reference number, never a URL, credential or secret.');
  }
  return {
    declared_at: new Date().toISOString(), actor_user_id: userId,
    basis: body.rights_basis as 'original' | 'licensed' | 'authorized',
    rights_holder: rightsHolder, evidence_reference: evidenceReference,
    policy_version: SAFETY_POLICY_VERSION,
  };
}

/** High-precision spam/link guard; this is not a substitute for human moderation. */
export function validatePublicComment(text: unknown, accepted: unknown): string {
  if (accepted !== true && accepted !== 'true') {
    throw new SafetyInputError('Accept the community rules before posting a comment.');
  }
  const normalized = limitedText(text, 2000, 'Comment');
  if (/(?:https?:\/\/|www\.|\b(?:t\.me|bit\.ly|wa\.me)\/)/i.test(normalized) ||
    /\b(?:contact me on whatsapp|send me your password|send your otp)\b/i.test(normalized)) {
    throw new SafetyInputError('Links or requests for private credentials are not allowed in comments.');
  }
  return normalized;
}
