import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { S3Client, GetObjectCommand, HeadObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import cookieParser from 'cookie-parser';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  loadDatabase,
  saveDatabase,
  initializeDatabase,
  refreshDatabase,
  AppStateConflictError,
  User,
  CreatorProfile,
  Movie,
  EpisodeBundle,
  Purchase,
  CreatorPayout,
  Comment,
  Like,
  Follow,
  ViewingEvent,
  Livestream,
  Premiere,
  AdCampaign,
  AuditLog,
  Notification,
  SafetyReport,
  SafetyAppeal,
  deleteSupabaseAuthUserById,
  verifySupabaseAccessToken,
} from './server/db.js';
import { resolveVerifiedIdentity } from './server/identity.js';
import { authorizeMovieStream, ownsFullMovie, privateVideoKey, toClientMovie } from './server/media-access.js';
import { UploadSessionStore, uploadErrorStatus } from './server/upload-sessions.js';
import { parseUploadSpec, MAX_VIDEO_BYTES, PART_BYTES } from './server/upload-security.js';
import { abortUpload, completeMultipart, finalizeUpload, prepareUpload, publicAssetUrl, signUploadPart } from './server/upload-operations.js';
import { getFinanceStore, financeErrorResponse } from './server/financial.js';
import { initializePaystack, verifyPaystackCharge, verifyPaystackSignature, PaystackGatewayError, PaystackNotConfirmedError } from './server/paystack.js';
import { protectAsyncRoutes } from './server/http-safety.js';
import { assertRuntimeConfig } from './server/ops-config.js';
import {
  SafetyInputError, parseReportInput, limitedText, targetOwner, blockedCreatorIds,
  blockingUserIds, publiclyVisibleMovie, pendingRightsComplaint,
  normalizeSafetyCollections, parseRightsAttestation,
  CONTENT_RATINGS, validatePublicComment,
} from './server/trust-safety.js';

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'visplay-super-secure-jwt-secret-nollywood-2026');
if (!JWT_SECRET) {
  throw new Error('Missing JWT_SECRET; refusing to start with an insecure production signing key.');
}
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

// The API accepts only movie metadata, NEVER multipart file bodies. Files are
// uploaded to private R2 staging and validated before promotion.
const movieMediaUpload = multer({ limits: { fields: 12, fieldSize: 8 * 1024, parts: 12 } });
const MEDIA_BUCKET = process.env.R2_BUCKET_NAME || 'visplay-media';
function privateVideoBucket(): string {
  const name = process.env.R2_PRIVATE_VIDEO_BUCKET?.trim();
  if (!name || name === MEDIA_BUCKET) {
    throw new Error('A separate, non-public R2_PRIVATE_VIDEO_BUCKET is required for premium video.');
  }
  return name;
}
function isR2Configured() {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_PUBLIC_BASE_URL);
}
function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) throw new Error('Cloudflare R2 credentials are missing from the server environment.');
  return new S3Client({ region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
}
const uploadSessions = new UploadSessionStore();

export interface AuthenticatedRequest extends Request {
  user?: User;
  financialPurchases?: Purchase[];
}

function guardedFinancialRead(handler: (req: AuthenticatedRequest, res: Response) => Promise<void>) {
  return (req: AuthenticatedRequest, res: Response) => {
    void handler(req, res).catch(error => {
      console.error('Financial read failed:', error instanceof Error ? error.name : 'error');
      if (!res.headersSent) res.status(503).json({ error: 'Financial records are temporarily unavailable.' });
    });
  };
}

// Authentication Middleware
function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.visplay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    req.user = undefined;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId?: string; authId?: string };
    const db = loadDatabase();
    const user = db.users.find(u => u.id === decoded.userId);
    // Tokens minted by the insecure legacy login lack authId and are rejected.
    // An unbound legacy account cannot be accessed until ownership is verified
    // and its Supabase Auth ID is set by the controlled migration procedure.
    if (user?.supabase_auth_id && decoded.authId === user.supabase_auth_id) {
      req.user = user;
    }
  } catch (err) {
    // Invalid or expired token
    req.user = undefined;
  }
  next();
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required. Please login.' });
    return;
  }
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Access denied. Super Admin privileges required.' });
    return;
  }
  next();
}

function requireCreator(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const db = loadDatabase();
  const profile = db.creator_profiles.find(cp => cp.user_id === req.user!.id && cp.status === 'approved' && !cp.safety_restricted);
  if (req.user.role !== 'admin' && !profile) {
    res.status(403).json({ error: 'Approved creator account required.' });
    return;
  }
  next();
}

async function startServer() {
  assertRuntimeConfig(process.env);
  await initializeDatabase();
  // No production money or paid access until the normalized ledger has been
  // migrated, reconciled, independently approved and made available.
  if (isProd && (process.env.VISPLAY_DEPLOYMENT_STAGE || 'production') === 'production') {
    await getFinanceStore().assertReady();
  }
  const app = express();
  protectAsyncRoutes(app);

  // Infrastructure liveness must not depend on credentials, JSON state,
  // Paystack or R2; readiness is a separate, stricter check below.
  app.get('/_health/live', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store').json({ status: 'alive' });
  });
  app.get('/_health/ready', async (_req: Request, res: Response) => {
    try {
      await refreshDatabase();
      await getFinanceStore().assertReady();
      res.set('Cache-Control', 'no-store').json({ status: 'ready' });
    } catch {
      res.set('Cache-Control', 'no-store').status(503).json({ status: 'not_ready' });
    }
  });

  // Paystack signs the ORIGINAL bytes, not JSON.stringify(parsedData). This
  // route must run before express.json and must never trust a callback alone.
  app.post('/api/paystack/webhook', express.raw({ type: 'application/json', limit: '128kb' }), async (req: Request, res: Response) => {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return void res.status(503).end();
    if (!verifyPaystackSignature(req.body, req.header('x-paystack-signature'), secret)) {
      return void res.status(401).end();
    }
    let event: any;
    try { event = JSON.parse((req.body as Buffer).toString('utf8')); }
    catch { return void res.status(400).end(); }
    if (event?.event !== 'charge.success') return void res.status(200).end();
    const reference = event?.data?.reference;
    if (typeof reference !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(reference)) return void res.status(400).end();
    try {
      const verified = await verifyPaystackCharge(reference);
      const settled = await getFinanceStore().settlePaystack(verified);
      if (settled.refund_required) console.warn('Duplicate paid movie charge requires refund:', createHash('sha256').update(reference).digest('hex').slice(0, 16));
      res.status(200).end();
    } catch (error) {
      // A 5xx allows provider retry after network/DB outages; never ACK before
      // durable settlement. Operational logs should monitor repeated failures.
      console.error('Paystack webhook settlement deferred:', error instanceof Error ? error.name : 'error');
      res.status(503).end();
    }
  });

  app.use(express.json());
  app.use(cookieParser());
  // In production, refresh the versioned state before identity, entitlement
  // and rights checks. CAS on mutations prevents stale writers from clobbering
  // a newer document; normalized records remain a required launch gate.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (!isProd) return void next();
    void refreshDatabase().then(() => next()).catch(() => {
      res.status(503).json({ error: 'Account state is temporarily unavailable.' });
    });
  });
  app.use(authenticateToken);

  // Cookie-authorized writes must originate from the approved web origin.
  // SameSite alone is not a complete defense against same-site subdomains.
  app.use('/api', (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!isProd || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.cookies?.visplay_token) {
      return void next();
    }
    const allowed = (process.env.TRUSTED_WEB_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    const origin = req.header('origin');
    if (!origin || !allowed.includes(origin)) {
      return void res.status(403).json({ error: 'Untrusted request origin.' });
    }
    next();
  });

  // The old JSON wallet_balance is no longer an accounting input or an API
  // output. Read the canonical balance from Postgres for authenticated calls.
  app.use('/api', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return void next();
    // Reporting, blocking and human review must remain accessible even during
    // financial maintenance. These routes never use wallet balances or purchase
    // entitlements; identity validation above still applies in full.
    if (/^\/api\/(?:safety\/|admin\/safety\/)/.test(req.originalUrl) ||
      /^\/api\/admin\/movies\/[A-Za-z0-9_-]+\/(?:rights-review|content-rating)(?:\?|$)/.test(req.originalUrl)) return void next();
    try {
      const [balance, purchases] = await Promise.all([
        getFinanceStore().getBalance(req.user.id), getFinanceStore().purchases(req.user.id),
      ]);
      req.user = { ...req.user, wallet_balance: balance };
      req.financialPurchases = purchases;
      next();
    } catch { res.status(503).json({ error: 'Account financial state is unavailable. Please retry later.' }); }
  });

  // Legacy local video URLs must not bypass the paid streaming gate.
  app.use(['/uploads', '/videos'], (_req: Request, res: Response) => {
    res.status(404).end();
  });

  // Serve static assets from public folder
  app.use(express.static(path.join(process.cwd(), 'public')));

  // -------------------------------------------------------------
  // SECTION G: USER SAFETY, MODERATION, RIGHTS AND APPEALS
  // -------------------------------------------------------------
  // Contact addresses are deliberately not invented. Employer must publish
  // and approve the real support, privacy and copyright contact information.
  app.get('/api/safety/config', (_req: Request, res: Response) => {
    const publicEmail = (name: string) => {
      const value = (process.env[name] || '').trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
    };
    res.json({
      support_email: publicEmail('VISPLAY_SUPPORT_EMAIL'),
      copyright_email: publicEmail('VISPLAY_COPYRIGHT_EMAIL'),
      privacy_email: publicEmail('VISPLAY_PRIVACY_EMAIL'),
      creator_policy_version: '2026-11-11',
      employer_legal_approval_required: true,
    });
  });

  app.post('/api/safety/reports', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const input = parseReportInput(req.body);
      const db = normalizeSafetyCollections(loadDatabase());
      const target = targetOwner(db, input.target_type, input.target_id);
      if (!target) return void res.status(404).json({ error: 'Report target not found.' });
      if (input.target_type === 'comment' && db.comments.find(comment => comment.id === input.target_id)?.moderation_hidden) {
        return void res.status(404).json({ error: 'This comment is no longer public.' });
      }
      if (target.id === req.user!.id) return void res.status(400).json({ error: 'You cannot report your own content or account.' });
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recent = db.safety_reports!.filter(report => report.reporter_user_id === req.user!.id && Date.parse(report.created_at) > oneDayAgo);
      if (recent.length >= 10) return void res.status(429).json({ error: 'Daily report limit reached. Please contact support for an emergency.' });
      if (recent.some(report => report.target_type === input.target_type && report.target_id === input.target_id)) {
        return void res.status(409).json({ error: 'You have already reported this item in the last 24 hours.' });
      }
      const record: SafetyReport = {
        id: `saf_${uuidv4()}`, reporter_user_id: req.user!.id,
        ...input, status: 'open', created_at: new Date().toISOString(),
      };
      db.safety_reports!.push(record);
      await saveDatabase(db);
      res.status(201).json({ report_id: record.id, status: record.status, message: 'Report submitted for human review.' });
    } catch (error) {
      if (error instanceof SafetyInputError) return void res.status(error.status).json({ error: error.message });
      console.error('Safety report persistence failed:', error instanceof Error ? error.name : 'error');
      res.status(503).json({ error: 'Unable to save the report right now; please try again.' });
    }
  });

  app.get('/api/safety/my-reports', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const reports = (db.safety_reports || []).filter(report => report.reporter_user_id === req.user!.id)
      .map(({ id, target_type, target_id, reason, description, status, created_at, reviewed_at }) =>
        ({ id, target_type, target_id, reason, description, status, created_at, reviewed_at }));
    res.json({ reports });
  });

  app.get('/api/safety/blocks', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const blocks = (db.safety_blocks || []).filter(block => block.blocker_user_id === req.user!.id).map(block => ({
      id: block.id,
      user_id: block.blocked_user_id,
      display_name: db.users.find(user => user.id === block.blocked_user_id)?.full_name || 'User',
      created_at: block.created_at,
    }));
    res.json({ blocks });
  });

  app.post('/api/safety/blocks/:userId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const db = normalizeSafetyCollections(loadDatabase());
    const target = db.users.find(user => user.id === req.params.userId);
    if (!target) return void res.status(404).json({ error: 'User not found.' });
    if (target.id === req.user!.id) return void res.status(400).json({ error: 'You cannot block yourself.' });
    if (!db.safety_blocks!.some(block => block.blocker_user_id === req.user!.id && block.blocked_user_id === target.id)) {
      db.safety_blocks!.push({ id: `blk_${uuidv4()}`, blocker_user_id: req.user!.id, blocked_user_id: target.id, created_at: new Date().toISOString() });
      // Following a blocked creator is unsafe and confusing; remove only the
      // social relation, not purchases, wallets, creator payouts or content.
      const profiles = new Set(db.creator_profiles.filter(profile => profile.user_id === target.id).map(profile => profile.id));
      db.follows = db.follows.filter(follow => !(follow.follower_user_id === req.user!.id && profiles.has(follow.creator_user_id)));
      await saveDatabase(db);
    }
    res.json({ blocked: true });
  });

  app.delete('/api/safety/blocks/:userId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const db = normalizeSafetyCollections(loadDatabase());
    db.safety_blocks = db.safety_blocks!.filter(block => !(block.blocker_user_id === req.user!.id && block.blocked_user_id === req.params.userId));
    await saveDatabase(db);
    res.json({ blocked: false });
  });

  app.post('/api/safety/appeals', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const reportId = limitedText(req.body?.report_id, 120, 'Report ID');
      const statement = limitedText(req.body?.statement, 1200, 'Appeal explanation', 15);
      const db = normalizeSafetyCollections(loadDatabase());
      const report = db.safety_reports!.find(item => item.id === reportId);
      if (!report || !['actioned', 'dismissed'].includes(report.status)) {
        return void res.status(404).json({ error: 'A reviewed report is required for appeal.' });
      }
      const owner = targetOwner(db, report.target_type, report.target_id);
      if (report.reporter_user_id !== req.user!.id && owner?.id !== req.user!.id) {
        return void res.status(403).json({ error: 'You are not a party to this report.' });
      }
      if (db.safety_appeals!.some(item => item.report_id === reportId && item.appellant_user_id === req.user!.id)) {
        return void res.status(409).json({ error: 'An appeal for this decision already exists.' });
      }
      const appeal: SafetyAppeal = {
        id: `apl_${uuidv4()}`, report_id: reportId,
        appellant_user_id: req.user!.id, statement, status: 'open', created_at: new Date().toISOString(),
      };
      db.safety_appeals!.push(appeal);
      await saveDatabase(db);
      res.status(201).json({ appeal_id: appeal.id, status: 'open' });
    } catch (error) {
      if (error instanceof SafetyInputError) return void res.status(error.status).json({ error: error.message });
      res.status(503).json({ error: 'Could not save appeal; please retry.' });
    }
  });

  app.get('/api/safety/my-appeals', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const appeals = (db.safety_appeals || []).filter(appeal => appeal.appellant_user_id === req.user!.id)
      .map(({ id, report_id, statement, status, created_at, reviewed_at }) => ({ id, report_id, statement, status, created_at, reviewed_at }));
    res.json({ appeals });
  });

  app.get('/api/admin/safety/reports', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    res.json({
      reports: [...(db.safety_reports || [])].reverse(),
      appeals: [...(db.safety_appeals || [])].reverse(),
    });
  });

  app.post('/api/admin/safety/reports/:id/review', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const status = req.body?.status;
      const enforcement = req.body?.enforcement_action || 'none';
      if (!['reviewing', 'actioned', 'dismissed'].includes(status) ||
        !['none', 'hide_comment', 'hold_movie', 'restrict_creator', 'restrict_user'].includes(enforcement)) {
        throw new SafetyInputError('Select a supported review outcome and enforcement action.');
      }
      const note = limitedText(req.body?.decision_note, 1000, 'Review reason', 12);
      const db = normalizeSafetyCollections(loadDatabase());
      const report = db.safety_reports!.find(item => item.id === req.params.id);
      if (!report) return void res.status(404).json({ error: 'Report not found.' });
      if (report.reporter_user_id === req.user!.id) return void res.status(403).json({ error: 'A different reviewer must handle your own report.' });
      if (report.status === 'actioned' || report.status === 'dismissed') return void res.status(409).json({ error: 'Decision is final; use the appeal process for a re-review.' });
      if (status !== 'actioned' && enforcement !== 'none') throw new SafetyInputError('Enforcement requires the actioned decision.');
      if (status === 'actioned' && enforcement === 'none') throw new SafetyInputError('An actioned report requires an explicit safety action.');
      const expectedTarget = { hide_comment: 'comment', hold_movie: 'movie', restrict_creator: 'creator', restrict_user: 'user' } as const;
      if (enforcement !== 'none' && expectedTarget[enforcement as keyof typeof expectedTarget] !== report.target_type) {
        throw new SafetyInputError('Enforcement action does not match the report target.');
      }
      if (enforcement === 'hide_comment') {
        const comment = db.comments.find(item => item.id === report.target_id);
        if (!comment) return void res.status(404).json({ error: 'Comment no longer exists.' });
        comment.moderation_hidden = true;
      }
      if (enforcement === 'hold_movie') {
        const movie = db.movies.find(item => item.id === report.target_id);
        if (!movie) return void res.status(404).json({ error: 'Movie no longer exists.' });
        movie.safety_hold = true;
      }
      if (enforcement === 'restrict_creator') {
        const creator = db.creator_profiles.find(item => item.id === report.target_id);
        if (!creator) return void res.status(404).json({ error: 'Creator no longer exists.' });
        creator.safety_restricted = true;
      }
      if (enforcement === 'restrict_user') {
        const user = db.users.find(item => item.id === report.target_id);
        if (!user) return void res.status(404).json({ error: 'User no longer exists.' });
        if (user.role === 'admin') return void res.status(403).json({ error: 'Admin status cannot be changed through an ordinary safety report.' });
        user.safety_restricted = true;
      }
      const now = new Date().toISOString();
      report.status = status;
      report.reviewed_at = now;
      report.reviewer_user_id = req.user!.id;
      report.decision_note = note;
      report.enforcement_action = enforcement;
      db.audit_logs.push({
        id: `aud_${uuidv4()}`, admin_id: req.user!.id, admin_name: req.user!.full_name,
        action: `SAFETY_${status.toUpperCase()}`, target_type: report.target_type,
        target_id: report.target_id, details: `Case ${report.id}; enforcement ${enforcement}; reason: ${note}`, created_at: now,
      });
      const ownerId = targetOwner(db, report.target_type, report.target_id)?.id;
      for (const id of new Set([report.reporter_user_id, ownerId].filter((id): id is string => Boolean(id)))) {
        db.notifications.push({ id: `notif_${uuidv4()}`, user_id: id,
          title: 'Safety report updated', message: `Report ${report.id} is now ${status}. Open the Safety Center for details.`,
          is_read: false, created_at: now });
      }
      await saveDatabase(db);
      res.json({ success: true, status, enforcement_action: enforcement });
    } catch (error) {
      if (error instanceof SafetyInputError) return void res.status(error.status).json({ error: error.message });
      console.error('Safety review failed:', error instanceof Error ? error.name : 'error');
      res.status(503).json({ error: 'Safety review could not be saved.' });
    }
  });

  app.post('/api/admin/safety/appeals/:id/review', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const outcome = req.body?.outcome;
      if (outcome !== 'upheld' && outcome !== 'rejected') throw new SafetyInputError('Choose upheld or rejected.');
      const note = limitedText(req.body?.decision_note, 1000, 'Appeal decision reason', 12);
      const db = normalizeSafetyCollections(loadDatabase());
      const appeal = db.safety_appeals!.find(item => item.id === req.params.id);
      if (!appeal) return void res.status(404).json({ error: 'Appeal not found.' });
      if (appeal.appellant_user_id === req.user!.id) return void res.status(403).json({ error: 'A different reviewer must decide your appeal.' });
      if (appeal.status === 'upheld' || appeal.status === 'rejected') return void res.status(409).json({ error: 'Appeal already decided.' });
      appeal.status = outcome;
      appeal.decision_note = note;
      appeal.reviewed_at = new Date().toISOString();
      appeal.reviewer_user_id = req.user!.id;
      db.audit_logs.push({ id: `aud_${uuidv4()}`, admin_id: req.user!.id, admin_name: req.user!.full_name,
        action: `SAFETY_APPEAL_${outcome.toUpperCase()}`, target_type: 'safety_appeal', target_id: appeal.id,
        details: note, created_at: appeal.reviewed_at });
      db.notifications.push({ id: `notif_${uuidv4()}`, user_id: appeal.appellant_user_id,
        title: 'Safety appeal decision', message: `Appeal ${appeal.id} is ${outcome}. Any enforcement remains in place pending separate restoration review.`,
        is_read: false, created_at: appeal.reviewed_at });
      await saveDatabase(db);
      res.json({ success: true, outcome, restoration_required: outcome === 'upheld' });
    } catch (error) {
      if (error instanceof SafetyInputError) return void res.status(error.status).json({ error: error.message });
      res.status(503).json({ error: 'Appeal decision could not be saved.' });
    }
  });

  // Accepted appeals require a separate, explicitly logged restoration.
  app.post('/api/admin/safety/appeals/:id/restore', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const note = limitedText(req.body?.restoration_note, 1000, 'Restoration explanation', 20);
      const db = normalizeSafetyCollections(loadDatabase());
      const appeal = db.safety_appeals!.find(item => item.id === req.params.id);
      if (!appeal || appeal.status !== 'upheld') return void res.status(409).json({ error: 'An upheld appeal is required for restoration.' });
      if (appeal.restored_at) return void res.status(409).json({ error: 'This appeal has already been restored.' });
      const report = db.safety_reports!.find(item => item.id === appeal.report_id);
      if (!report || report.status !== 'actioned' || !report.enforcement_action || report.enforcement_action === 'none') {
        return void res.status(409).json({ error: 'No active enforcement decision to restore.' });
      }
      if (db.safety_reports!.some(other => other.id !== report.id && other.target_type === report.target_type && other.target_id === report.target_id && other.status === 'actioned' && other.enforcement_action === report.enforcement_action && !db.safety_appeals!.some(previous => previous.report_id === other.id && previous.restored_at))) {
        return void res.status(409).json({ error: 'Another active enforcement case prevents restoration.' });
      }
      if (report.enforcement_action === 'hold_movie') {
        const movie = db.movies.find(item => item.id === report.target_id);
        if (!movie) return void res.status(404).json({ error: 'Film is missing.' });
        if (pendingRightsComplaint(db, movie.id)) return void res.status(409).json({ error: 'An unresolved copyright case prevents restoration.' });
        if (report.reason === 'copyright' && (!movie.rights_review || Date.parse(movie.rights_review.reviewed_at) <= Date.parse(report.created_at))) {
          return void res.status(409).json({ error: 'Record a fresh independent rights review after the complaint before restoring the film.' });
        }
        movie.safety_hold = false;
      } else if (report.enforcement_action === 'hide_comment') {
        const comment = db.comments.find(item => item.id === report.target_id);
        if (!comment) return void res.status(404).json({ error: 'Comment is missing.' });
        comment.moderation_hidden = false;
      } else if (report.enforcement_action === 'restrict_creator') {
        const creator = db.creator_profiles.find(item => item.id === report.target_id);
        if (!creator) return void res.status(404).json({ error: 'Creator is missing.' });
        creator.safety_restricted = false;
      } else if (report.enforcement_action === 'restrict_user') {
        const user = db.users.find(item => item.id === report.target_id);
        if (!user) return void res.status(404).json({ error: 'User is missing.' });
        user.safety_restricted = false;
      }
      const now = new Date().toISOString();
      appeal.restored_at = now;
      appeal.restoration_reviewer_user_id = req.user!.id;
      db.audit_logs.push({ id: `aud_${uuidv4()}`, admin_id: req.user!.id, admin_name: req.user!.full_name,
        action: 'SAFETY_RESTORE_AFTER_APPEAL', target_type: report.target_type, target_id: report.target_id,
        details: `Appeal ${appeal.id}; decision ${report.id}; operator rationale: ${note}`, created_at: now });
      db.notifications.push({ id: `notif_${uuidv4()}`, user_id: appeal.appellant_user_id,
        title: 'Safety appeal restoration completed', message: `Appeal ${appeal.id} has been restored following human review.`,
        is_read: false, created_at: now });
      await saveDatabase(db);
      res.json({ restored: true, restored_at: now });
    } catch (error) {
      if (error instanceof SafetyInputError) return void res.status(error.status).json({ error: error.message });
      res.status(503).json({ error: 'Restoration failed; no changes were confirmed.' });
    }
  });

  // -------------------------------------------------------------
  // AUTH ROUTES
  // -------------------------------------------------------------

  // The former endpoint allowed an attacker to create an account for any email
  // without proving control of it, then retain password access after the real
  // owner used Google sign-in. Registration now goes through Supabase Auth and
  // only a verified identity may be synchronized into VisPlay.
  app.post('/api/auth/register', (_req: Request, res: Response) => {
    res.status(410).json({
      error: 'Unverified registration is disabled. Use the verified email sign-up flow.',
    });
  });

  // Legacy password hashes include seeded demonstration credentials and cannot
  // prove email ownership. Do not accept them while existing accounts migrate
  // to verified Supabase identities. This also blocks every omitted demo login.
  app.post('/api/auth/login', (_req: Request, res: Response) => {
    res.status(410).json({
      error: 'Legacy password login is disabled. Sign in with your verified VisPlay account.',
    });
  });

  // Supabase Auth Synchronization (Google OAuth & Supabase session sync)
  app.post('/api/auth/supabase-sync', async (req: Request, res: Response) => {
    const accessToken = typeof req.body?.access_token === 'string' ? req.body.access_token : '';
    if (!accessToken) {
      res.status(401).json({ error: 'A valid Supabase session is required.' });
      return;
    }

    let verifiedSupabaseUser;
    try {
      verifiedSupabaseUser = await verifySupabaseAccessToken(accessToken);
    } catch (verificationError) {
      console.warn('Rejected unverified Supabase identity synchronization.');
      res.status(401).json({ error: 'Your verified sign-in session could not be validated. Please sign in again.' });
      return;
    }

    // Derive identity and profile fields only from the verified Supabase user, never from request claims.
    const cleanEmail = verifiedSupabaseUser.email!.toLowerCase().trim();
    const metadata = verifiedSupabaseUser.user_metadata || {};
    const full_name = String(metadata.full_name || metadata.name || cleanEmail.split('@')[0]);
    const avatar_url = String(metadata.avatar_url || metadata.picture || '');
    const db = loadDatabase();
    // Supabase's stable user ID, not a potentially pre-claimed email address,
    // determines which internal account the caller may access.
    const identity = resolveVerifiedIdentity(db.users, verifiedSupabaseUser.id, cleanEmail);
    if (identity.status === 'email-change') {
      res.status(409).json({ error: 'Your account email has changed. Contact support for a verified email migration.' });
      return;
    }
    if (identity.status === 'conflict') {
      res.status(409).json({ error: 'An identity conflict was detected. Contact VisPlay support.' });
      return;
    }
    if (identity.status === 'migration-required') {
      res.status(409).json({
        error: 'This email belongs to an existing VisPlay account. Contact support to verify ownership and migrate it securely.',
      });
      return;
    }
    let user = identity.status === 'existing' ? identity.account : undefined;

    if (!user) {
      // Create new user profile for this Supabase/Google authenticated user
      user = {
        id: `usr_${uuidv4().substring(0, 8)}`,
        email: cleanEmail,
        password_hash: '',
        supabase_auth_id: verifiedSupabaseUser.id,
        full_name: full_name?.trim() || cleanEmail.split('@')[0],
        avatar_url: avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanEmail)}`,
        role: 'viewer',
        wallet_balance: 0, // Live accounts always start with zero wallet balance.
        phone: '',
        created_at: new Date().toISOString(),
      };
      db.users.push(user);
    } else {
      // The identity is already bound by its verified provider ID.
      if (user.password_hash) user.password_hash = '';
      if (full_name && !user.full_name) user.full_name = full_name.trim();
      if (avatar_url && (!user.avatar_url || user.avatar_url.includes('dicebear'))) {
        user.avatar_url = avatar_url;
      }
    }

    const creatorProfile = db.creator_profiles.find(cp => cp.user_id === user!.id) || null;

    await saveDatabase(db);

    const token = jwt.sign({ userId: user.id, authId: user.supabase_auth_id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('visplay_token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const { password_hash: _, supabase_auth_id: _authId, ...profileUser } = user;
    // The session token is available only through the HttpOnly cookie.
    res.json({ user: { ...profileUser, wallet_balance: await getFinanceStore().getBalance(user.id) }, creator_profile: creatorProfile || null });
  });

  app.get('/api/auth/me', async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.json({ user: null });
      return;
    }
    const db = loadDatabase();
    const freshUser = db.users.find(u => u.id === req.user!.id);
    if (!freshUser) {
      res.json({ user: null });
      return;
    }

    const creatorProfile = db.creator_profiles.find(cp => cp.user_id === freshUser.id) || null;
    const { password_hash: _, supabase_auth_id: _authId, ...safeUser } = freshUser;
    res.json({ user: { ...safeUser, wallet_balance: req.user.wallet_balance }, creator_profile: creatorProfile });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    res.clearCookie('visplay_token', { path: '/', secure: isProd, sameSite: 'lax' });
    res.json({ success: true, message: 'Logged out successfully.' });
  });

  // Account deletion: remove the user's account and personal/user-generated data.
  // Financial records needed for accounting are retained only with the user identity anonymized.
  app.delete('/api/auth/account', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const userIndex = db.users.findIndex(u => u.id === req.user!.id);
    if (userIndex === -1) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }

    const user = db.users[userIndex];
    if (user.role === 'admin' && db.users.filter(u => u.role === 'admin').length <= 1) {
      res.status(409).json({ error: 'The last administrator account cannot be deleted. Assign another administrator first.' });
      return;
    }

    const creatorProfile = db.creator_profiles.find(cp => cp.user_id === user.id);
    const creatorId = creatorProfile?.id;
    const ownedMovies = creatorId ? db.movies.filter(movie => movie.creator_id === creatorId) : [];
    const ownedMovieIds = new Set(ownedMovies.map(movie => movie.id));
    const ownedBundles = creatorId ? db.bundles.filter(bundle => bundle.creator_id === creatorId) : [];
    const ownedBundleIds = new Set(ownedBundles.map(bundle => bundle.id));

    // Refuse accidental forfeiture of funds or removal of previously sold
    // movies. Settlement/rights transfer must be reviewed before deletion.
    try {
      if (req.user!.wallet_balance !== 0) {
        return void res.status(409).json({ error: 'Please settle or refund your remaining wallet balance before deleting your account.' });
      }
      if (creatorId) {
        const [earnings, payouts] = await Promise.all([
          getFinanceStore().creatorLedger(creatorId), getFinanceStore().creatorPayouts(creatorId),
        ]);
        if (earnings.some(e => e.status !== 'paid') || payouts.some(p => p.status !== 'paid') || earnings.length > 0) {
          return void res.status(409).json({ error: 'Your channel has financial obligations or sold content. Contact support to settle earnings and transfer existing viewer access before deletion.' });
        }
      }
    } catch (error) {
      const mapped = financeErrorResponse(error);
      return void res.status(mapped.status).json({ error: mapped.message });
    }

    const anonymizedUserId = `deleted_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    // Delete the external Auth identity first. If this fails, do not partially delete app data.
    try {
      await deleteSupabaseAuthUserById(user.supabase_auth_id || '');
    } catch (authDeleteError) {
      console.error('Account deletion could not remove Supabase Auth identity:', authDeleteError);
      res.status(503).json({ error: 'We could not securely finish deleting your sign-in account. No app data was deleted. Please try again later.' });
      return;
    }

    try {
      await getFinanceStore().anonymize(user.id, anonymizedUserId, creatorId);
    } catch (error) {
      console.error('Deleted Auth account requires financial anonymization recovery:', error);
      return void res.status(503).json({ error: 'Your sign-in was removed, but financial retention processing needs support intervention. Please contact VisPlay support.' });
    }

    // Remove creator-owned media from object storage where the public URLs map to this bucket.
    try {
      const publicBase = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, '');
      const mediaUrls = [
        ...ownedMovies.flatMap(movie => [movie.video_url, movie.poster_url, movie.backdrop_url]),
        ...ownedBundles.map(bundle => bundle.poster_url),
      ];
      const objectKeys = mediaUrls
        .filter((url): url is string => Boolean(publicBase && typeof url === 'string' && url.startsWith(publicBase + '/')))
        .map(url => decodeURIComponent(url.slice(publicBase!.length + 1).split('?')[0]))
        .filter(Boolean);
      const uniqueKeys = [...new Set(objectKeys)];
      if (uniqueKeys.length && isR2Configured()) {
        await getR2Client().send(new DeleteObjectsCommand({ Bucket: MEDIA_BUCKET, Delete: { Objects: uniqueKeys.map(Key => ({ Key })) } }));
      }
      const privateKeys = [...new Set(ownedMovies.flatMap(movie => [privateVideoKey(movie.video_url), movie.preview_private_key])
        .filter((key): key is string => Boolean(key)))];
      if (privateKeys.length) {
        await getR2Client().send(new DeleteObjectsCommand({
          Bucket: privateVideoBucket(), Delete: { Objects: privateKeys.map(Key => ({ Key })) },
        }));
      }
    } catch (storageError) {
      // Continue deletion to respect the user's request; log cleanup for operator follow-up.
      console.error('Account deletion media cleanup failed:', storageError);
    }

    // Delete comments made by the account and replies that depend on those comments.
    const removedCommentIds = new Set(db.comments
      .filter(comment => comment.user_id === user.id || ownedMovieIds.has(comment.movie_id))
      .map(comment => comment.id));
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const comment of db.comments) {
        if (comment.parent_id && removedCommentIds.has(comment.parent_id) && !removedCommentIds.has(comment.id)) {
          removedCommentIds.add(comment.id);
          expanded = true;
        }
      }
    }
    db.comments = db.comments.filter(comment => !removedCommentIds.has(comment.id));
    db.likes = db.likes.filter(like => like.user_id !== user.id && !ownedMovieIds.has(like.movie_id));
    db.follows = db.follows.filter(follow =>
      follow.follower_user_id !== user.id &&
      follow.creator_user_id !== user.id &&
      (!creatorId || follow.creator_user_id !== creatorId)
    );
    db.notifications = db.notifications.filter(notification => notification.user_id !== user.id);
    db.viewing_events = db.viewing_events.filter(event =>
      event.user_id !== user.id && !ownedMovieIds.has(event.movie_id)
    );
    db.rewards = db.rewards.filter(reward => reward.user_id !== user.id);
    db.livestreams = db.livestreams.filter(stream => !creatorId || stream.creator_id !== creatorId);
    db.premieres = db.premieres.filter(premiere => !ownedMovieIds.has(premiere.movie_id));
    db.movies = db.movies.filter(movie => !ownedMovieIds.has(movie.id));
    db.bundles = db.bundles.filter(bundle => !ownedBundleIds.has(bundle.id));
    db.creator_profiles = db.creator_profiles.filter(profile => profile.user_id !== user.id && (!creatorId || profile.id !== creatorId));

    if (db.featured_movie_id && ownedMovieIds.has(db.featured_movie_id)) {
      db.featured_movie_id = null;
      db.featured_movie_backdrop = null;
    }

    // Preserve financial/audit evidence without retaining a direct link to the deleted account.
    db.transactions.forEach(tx => {
      if (tx.user_id === user.id) tx.user_id = anonymizedUserId;
    });
    db.purchases.forEach(purchase => {
      if (purchase.user_id === user.id) purchase.user_id = anonymizedUserId;
    });
    db.payouts.forEach(payout => {
      if (creatorId && payout.creator_id === creatorId) {
        payout.account_name = 'Deleted account';
        payout.account_number = '';
        payout.bank_name = '';
      }
    });
    db.audit_logs.forEach(log => {
      if (log.admin_id === user.id) {
        log.admin_id = anonymizedUserId;
        log.admin_name = 'Deleted account';
      }
    });

    // Remove profile and account records only after dependent data has been handled.
    db.users.splice(userIndex, 1);
    try {
      await saveDatabase(db);
    } catch (saveError) {
      console.error('Failed to persist account deletion:', saveError);
      res.status(500).json({ error: 'Your sign-in identity was removed, but we could not finish saving the account deletion. Please contact VisPlay support.' });
      return;
    }

    res.clearCookie('visplay_token', { path: '/', secure: isProd, sameSite: 'lax' });
    res.json({ success: true, message: 'Your VisPlay account and associated personal data have been deleted.' });
  });

  app.put('/api/auth/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { full_name, phone, avatar_url } = req.body;
    const db = loadDatabase();
    const userIndex = db.users.findIndex(u => u.id === req.user!.id);
    if (userIndex === -1) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (full_name) db.users[userIndex].full_name = full_name.trim();
    if (phone) db.users[userIndex].phone = phone.trim();
    if (avatar_url) db.users[userIndex].avatar_url = avatar_url;

    // Update avatar in creator profiles or comments if user updated it
    const creatorIndex = db.creator_profiles.findIndex(cp => cp.user_id === req.user!.id);
    if (creatorIndex !== -1 && avatar_url) {
      db.creator_profiles[creatorIndex].channel_avatar_url = avatar_url;
    }

    await saveDatabase(db);
    const { password_hash: _, supabase_auth_id: _authId, ...safeUser } = db.users[userIndex];
    res.json({ user: { ...safeUser, wallet_balance: req.user!.wallet_balance }, message: 'Profile updated successfully.' });
  });

  // -------------------------------------------------------------
  // CREATOR APPLICATION & CHANNEL MANAGEMENT
  // -------------------------------------------------------------

  app.post('/api/creators/apply', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { channel_name, content_type, description, channel_banner_url, channel_avatar_url } = req.body;
    if (!channel_name || !content_type) {
      res.status(400).json({ error: 'Channel name and content type are required.' });
      return;
    }

    const db = loadDatabase();
    // Match by the authenticated account's email as a fallback if an OAuth sync ever changes the internal user ID.
    const currentUser = db.users.find(u => u.id === req.user!.id);
    const existing = db.creator_profiles.find(cp => cp.user_id === req.user!.id)
      || db.creator_profiles.find(cp => {
        const owner = db.users.find(u => u.id === cp.user_id);
        return Boolean(currentUser?.email && owner?.email?.toLowerCase() === currentUser.email.toLowerCase());
      });
    if (existing && existing.user_id !== req.user!.id) existing.user_id = req.user!.id;
    if (existing && existing.status === 'pending') {
      res.status(400).json({ error: 'You already have a pending creator application undergoing review.' });
      return;
    }
    if (existing && existing.status === 'approved') {
      res.status(400).json({ error: 'Your creator application is already approved and active.' });
      return;
    }

    const newApplication: CreatorProfile = {
      id: existing ? existing.id : `creator_${uuidv4().substring(0, 8)}`,
      user_id: req.user!.id,
      channel_name: channel_name.trim(),
      content_type: content_type.trim(),
      description: description ? description.trim() : '',
      channel_banner_url: channel_banner_url || '/posters/lagos_heist.jpg',
      channel_avatar_url: channel_avatar_url || req.user!.avatar_url,
      status: 'pending',
      submitted_at: new Date().toISOString(),
    };

    if (existing) {
      const idx = db.creator_profiles.findIndex(cp => cp.id === existing.id);
      db.creator_profiles[idx] = newApplication;
    } else {
      db.creator_profiles.push(newApplication);
    }

    // Add notification for user
    db.notifications.push({
      id: `notif_${uuidv4().substring(0, 8)}`,
      user_id: req.user!.id,
      title: 'Creator Application Submitted',
      message: `Your application for "${channel_name}" has been received. VisPlay Super Admin review typically completes within 24 hours.`,
      is_read: false,
      created_at: new Date().toISOString(),
    });

    await saveDatabase(db);
    res.status(201).json({ creator_profile: newApplication, message: 'Application submitted successfully.' });
  });

  app.get('/api/creators/my-channel', requireAuth, guardedFinancialRead(async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const profile = db.creator_profiles.find(cp => cp.user_id === req.user!.id);
    if (!profile) {
      res.json({ creator_profile: null, stats: null });
      return;
    }

    const movies = db.movies.filter(m => m.creator_id === profile.id);
    const [ledger, payouts, creatorSummary] = await Promise.all([
      getFinanceStore().creatorLedger(profile.id), getFinanceStore().creatorPayouts(profile.id),
      getFinanceStore().creatorSummary(profile.id),
    ]);
    const follows = db.follows.filter(f => f.creator_user_id === profile.id);

    const totalViews = movies.reduce((sum, m) => sum + m.views_count, 0);

    res.json({
      creator_profile: profile,
      movies: movies.map(toClientMovie),
      stats: {
        total_movies: movies.length,
        total_views: totalViews,
        total_paid_unlocks: creatorSummary.total_paid_unlocks,
        total_earnings_ngn: creatorSummary.total_earnings_ngn,
        total_paid_out_ngn: creatorSummary.total_paid_out_ngn,
        pending_payout_ngn: creatorSummary.pending_payout_ngn,
        followers_count: follows.length,
      },
      payouts,
      ledger: ledger.slice(0, 20),
    });
  }));

  app.patch('/api/creators/my-channel/media', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    // Channel ownership is by immutable account ID, never by matching emails.
    const profile = db.creator_profiles.find(cp => cp.user_id === req.user!.id);
    if (!profile || profile.status !== 'approved') return void res.status(404).json({ error: 'Approved creator channel not found.' });
    const { image_upload_id, kind } = req.body || {};
    if (kind !== 'avatar' && kind !== 'banner') return void res.status(400).json({ error: 'Specify avatar or banner.' });
    let imageSessionId: string | null = null;
    let saved = false;
    try {
      const session = await uploadSessions.assertActive(String(image_upload_id || ''), req.user!.id, 'ready');
      if (session.kind !== 'image' || session.usage !== kind || !session.final_key) {
        return void res.status(403).json({ error: 'This verified image cannot be used for that purpose.' });
      }
      await uploadSessions.transition(session.id, req.user!.id, 'ready', 'attaching');
      imageSessionId = session.id;
      const url = publicAssetUrl(session.final_key);
      if (kind === 'avatar') profile.channel_avatar_url = url;
      else profile.channel_banner_url = url;
      await saveDatabase(db);
      saved = true;
      await uploadSessions.transition(session.id, req.user!.id, 'attaching', 'consumed')
        .catch(error => console.error('Channel image uploaded but session consumption requires reconciliation:', error));
      res.json({ success: true, creator_profile: profile });
    } catch (error) {
      if (imageSessionId && !saved) {
        await uploadSessions.transition(imageSessionId, req.user!.id, 'attaching', 'ready').catch(() => undefined);
      }
      console.error('Channel image attachment failed:', error);
      res.status(uploadErrorStatus(error)).json({ error: 'A verified, unused image upload is required.' });
    }
  });

  // Public directory of approved creators
  app.get('/api/creators', (req: Request, res: Response) => {
    const db = loadDatabase();
    const blocked = blockedCreatorIds(db, (req as AuthenticatedRequest).user?.id);
    const approved = db.creator_profiles.filter(cp => cp.status === 'approved' && !cp.safety_restricted && !blocked.has(cp.id));
    const creatorsWithStats = approved.map(cp => {
      const moviesCount = db.movies.filter(m => m.creator_id === cp.id && publiclyVisibleMovie(m)).length;
      const followersCount = db.follows.filter(f => f.creator_user_id === cp.id).length;
      return {
        ...cp,
        movies_count: moviesCount,
        followers_count: followersCount,
      };
    });
    res.json({ creators: creatorsWithStats });
  });

  app.get('/api/creators/channel/:id', (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const profile = db.creator_profiles.find(cp => cp.id === req.params.id);
    if (!profile || profile.status !== 'approved' || profile.safety_restricted || blockedCreatorIds(db, req.user?.id).has(profile.id)) {
      res.status(404).json({ error: 'Creator channel not found.' });
      return;
    }

    const movies = db.movies.filter(m => m.creator_id === profile.id && publiclyVisibleMovie(m));
    const followersCount = db.follows.filter(f => f.creator_user_id === profile.id).length;
    res.json({ creator: profile, movies: movies.map(toClientMovie), followers_count: followersCount });
  });

  app.post('/api/creators/follow/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (req.user!.safety_restricted) return void res.status(403).json({ error: 'Social participation is temporarily restricted. Contact the Safety Center.' });
    const db = loadDatabase();
    const targetCreatorId = req.params.id;
    const target = db.creator_profiles.find(profile => profile.id === targetCreatorId && profile.status === 'approved' && !profile.safety_restricted);
    if (!target) return void res.status(404).json({ error: 'Creator unavailable.' });
    if (blockingUserIds(db, req.user!.id).has(target.user_id)) return void res.status(403).json({ error: 'This account is blocked.' });
    const existingIndex = db.follows.findIndex(
      f => f.follower_user_id === req.user!.id && f.creator_user_id === targetCreatorId
    );

    let isFollowing = false;
    if (existingIndex !== -1) {
      db.follows.splice(existingIndex, 1);
      isFollowing = false;
    } else {
      db.follows.push({
        id: `fol_${uuidv4().substring(0, 8)}`,
        follower_user_id: req.user!.id,
        creator_user_id: targetCreatorId,
        created_at: new Date().toISOString(),
      });
      isFollowing = true;
    }

    const targetProfile = db.creator_profiles.find((profile: any) => profile.id === targetCreatorId);
    const creatorOwnerId = targetProfile?.user_id;
    if (isFollowing && creatorOwnerId && creatorOwnerId !== req.user!.id) {
      db.notifications.push({
        id: `notif_${uuidv4().substring(0, 8)}`,
        user_id: creatorOwnerId,
        title: 'New follower',
        message: `${req.user!.full_name || 'Someone'} started following your creator channel.`,
        is_read: false,
        created_at: new Date().toISOString(),
      });
    }

    await saveDatabase(db);
    const totalFollowers = db.follows.filter(f => f.creator_user_id === targetCreatorId).length;
    res.json({ is_following: isFollowing, followers_count: totalFollowers });
  });

  // -------------------------------------------------------------
  // MOVIES & DISCOVERY ROUTES
  // -------------------------------------------------------------

  app.get('/api/movies', (req: AuthenticatedRequest, res: Response) => {
    const { genre, search, category, creator_id } = req.query;
    const db = loadDatabase();
    const blocked = blockedCreatorIds(db, req.user?.id);
    let movies = db.movies.filter(m => publiclyVisibleMovie(m) && !blocked.has(m.creator_id));

    if (creator_id) {
      movies = movies.filter(m => m.creator_id === creator_id);
    }
    if (genre && genre !== 'All') {
      movies = movies.filter(m => m.genre.toLowerCase().includes((genre as string).toLowerCase()));
    }
    if (search) {
      const q = (search as string).toLowerCase().trim();
      movies = movies.filter(m =>
        m.title.toLowerCase().includes(q) ||
        m.synopsis.toLowerCase().includes(q) ||
        (m.creator_name && m.creator_name.toLowerCase().includes(q))
      );
    }

    if (category === 'trending') {
      movies = [...movies].sort((a, b) => b.views_count - a.views_count);
    } else if (category === 'new') {
      movies = [...movies].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (category === 'top_paid') {
      movies = [...movies].sort((a, b) => b.paid_unlocks_count - a.paid_unlocks_count);
    }

    // Prioritize films from creators the signed-in viewer follows.
    if (req.user) {
      const followedCreatorIds = new Set(db.follows
        .filter(f => f.follower_user_id === req.user!.id)
        .map(f => f.creator_user_id));
      movies = [...movies].sort((a, b) => {
        const aFollowed = followedCreatorIds.has(a.creator_id) ? 1 : 0;
        const bFollowed = followedCreatorIds.has(b.creator_id) ? 1 : 0;
        return bFollowed - aFollowed;
      });
    }
    const enhanced = movies.map(m => ({
      ...toClientMovie(m),
      is_purchased: ownsFullMovie(m, req.user, req.financialPurchases || [], db.creator_profiles),
    }));

    res.json({ movies: enhanced, total: enhanced.length });
  });

  // Public Dynamic Featured Movie (controlled from Super Admin)
  app.get('/api/movies/featured', (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    let movie: Movie | undefined;
    if (db.featured_movie_id) {
      movie = db.movies.find(m => m.id === db.featured_movie_id && publiclyVisibleMovie(m) && !blockedCreatorIds(db, req.user?.id).has(m.creator_id));
    }
    // Fallback if not configured or removed
    if (!movie) {
      movie = db.movies.find(m => m.id === 'mov_lagos_syndicate' && publiclyVisibleMovie(m) && !blockedCreatorIds(db, req.user?.id).has(m.creator_id)) || db.movies.find(m => publiclyVisibleMovie(m) && !m.is_bundle_only && !blockedCreatorIds(db, req.user?.id).has(m.creator_id));
    }

    if (!movie) {
      res.status(404).json({ error: 'No published movies available for hero feature.' });
      return;
    }

    const creator = db.creator_profiles.find(cp => cp.id === movie!.creator_id);
    const isPurchased = ownsFullMovie(movie, req.user, req.financialPurchases || [], db.creator_profiles);

    res.json({
      movie: {
        ...toClientMovie(movie),
        is_purchased: isPurchased,
      },
      creator: creator || null,
      custom_backdrop: db.featured_movie_backdrop || null,
      is_custom_selected: Boolean(db.featured_movie_id),
    });
  });

  // Super Admin: Set Featured Spotlight Movie for Homepage
  app.post('/api/admin/featured-movie', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { movie_id, custom_backdrop } = req.body;
    const db = loadDatabase();

    if (!movie_id) {
      db.featured_movie_id = undefined;
      db.featured_movie_backdrop = undefined;
      await saveDatabase(db);
      res.json({ success: true, message: 'Featured spotlight reset to automatic' });
      return;
    }

    const movie = db.movies.find(m => m.id === movie_id);
    if (!movie) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }

    db.featured_movie_id = movie.id;
    if (custom_backdrop !== undefined) {
      db.featured_movie_backdrop = custom_backdrop || undefined;
    }
    await saveDatabase(db);

    // Audit log
    db.audit_logs.push({
      id: `aud_${uuidv4().substring(0, 8)}`,
      admin_id: req.user!.id,
      admin_name: req.user!.full_name,
      action: 'UPDATE_FEATURED_HERO_MOVIE',
      target_type: 'movie',
      target_id: movie.id,
      details: `Featured spotlight updated to: "${movie.title}"`,
      ip_address: req.ip || '127.0.0.1',
      created_at: new Date().toISOString(),
    });
    await saveDatabase(db);

    res.json({ success: true, message: `Featured hero movie set to "${movie.title}"`, featured_movie_id: movie.id });
  });

  // Curated Horizontal Categories
  app.get('/api/movies/categories', (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const excluded = blockedCreatorIds(db, req.user?.id);
    const published = db.movies.filter(m => publiclyVisibleMovie(m) && !m.is_bundle_only && !excluded.has(m.creator_id));
    const userPurchases = (req.financialPurchases || []).map(p => p.item_id);

    const enhance = (list: Movie[]) =>
      list.map(m => ({
        ...toClientMovie(m),
        is_purchased: ownsFullMovie(m, req.user, req.financialPurchases || [], db.creator_profiles),
      }));

    // Continue Watching from viewing events if user is authenticated
    let continueWatching: Movie[] = [];
    if (req.user) {
      const userEvents = db.viewing_events
        .filter(e => e.user_id === req.user!.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const recentMovieIds = Array.from(new Set(userEvents.map(e => e.movie_id)));
      continueWatching = enhance(db.movies.filter(m => recentMovieIds.includes(m.id) && publiclyVisibleMovie(m) && !excluded.has(m.creator_id)).slice(0, 8));
    }

    const trending = enhance([...published].sort((a, b) => b.views_count - a.views_count));
    const popular = enhance([...published].sort((a, b) => b.paid_unlocks_count - a.paid_unlocks_count));
    const latest = enhance([...published].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));

    const nollywood = enhance(published.filter(m => m.genre.includes('Action') || m.genre.includes('Historical') || m.genre.includes('Comedy')));
    const comedy = enhance(published.filter(m => m.genre.toLowerCase().includes('comedy')));
    const action = enhance(published.filter(m => m.genre.toLowerCase().includes('action')));
    const romance = enhance(published.filter(m => m.genre.toLowerCase().includes('romance')));
    const drama = enhance(published.filter(m => m.genre.toLowerCase().includes('drama')));
    const thriller = enhance(published.filter(m => m.genre.toLowerCase().includes('thriller') || m.genre.toLowerCase().includes('sci-fi')));
    const horror = enhance(published.filter(m => m.genre.toLowerCase().includes('horror')));
    const adventure = enhance(published.filter(m => m.genre.toLowerCase().includes('adventure') || m.genre.toLowerCase().includes('family')));

    // 10-episode series bundles
    const bundles = db.bundles.map(b => ({
      ...b,
      episodes: db.movies.filter(m => m.bundle_id === b.id && publiclyVisibleMovie(m)).map(toClientMovie),
      is_purchased: userPurchases.includes(b.id),
    }));

    res.json({
      continue_watching: continueWatching,
      trending,
      popular,
      latest,
      nollywood,
      action,
      romance,
      drama,
      comedy,
      thriller,
      horror,
      adventure,
      series: bundles,
    });
  });

  app.get('/api/movies/:id', async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const movie = db.movies.find(m => m.id === req.params.id);
    if (!movie) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }
    if (movie.safety_hold || (blockedCreatorIds(db, req.user?.id).has(movie.creator_id) && !ownsFullMovie(movie, req.user, req.financialPurchases || [], db.creator_profiles))) {
      res.status(404).json({ error: 'Movie unavailable.' });
      return;
    }
    if (movie.status !== 'published' && !ownsFullMovie(movie, req.user, req.financialPurchases || [], db.creator_profiles)) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }

    const creator = db.creator_profiles.find(cp => cp.id === movie.creator_id);
    const likesCount = db.likes.filter(l => l.movie_id === movie.id).length;
    const isLiked = req.user ? db.likes.some(l => l.movie_id === movie.id && l.user_id === req.user!.id) : false;
    
    // Check if user purchased movie or bundle containing movie
    const isPurchased = ownsFullMovie(movie, req.user, req.financialPurchases || [], db.creator_profiles);

    const isFollowing = req.user && creator
      ? db.follows.some(f => f.follower_user_id === req.user!.id && f.creator_user_id === creator.id)
      : false;

    // Related creator movies
    const related = db.movies.filter(m => m.creator_id === movie.creator_id && m.id !== movie.id && publiclyVisibleMovie(m)).slice(0, 4);

    res.json({
      movie: {
        ...toClientMovie(movie),
        is_purchased: isPurchased,
        likes_count: likesCount,
        is_liked: isLiked,
      },
      creator,
      is_following: isFollowing,
      related: related.map(toClientMovie),
    });
  });

  app.get('/api/bundles', (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const userPurchases = (req.financialPurchases || []).map(p => p.item_id);

    const bundles = db.bundles.map(b => {
      const episodes = db.movies.filter(m => m.bundle_id === b.id && publiclyVisibleMovie(m)).map(toClientMovie);
      const isPurchased = userPurchases.includes(b.id);
      return {
        ...b,
        episodes,
        is_purchased: isPurchased,
      };
    });

    res.json({ bundles });
  });

  app.get('/api/bundles/:id', (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const bundle = db.bundles.find(b => b.id === req.params.id);
    if (!bundle) {
      res.status(404).json({ error: 'Bundle not found.' });
      return;
    }
    const episodes = db.movies.filter(m => m.bundle_id === bundle.id && publiclyVisibleMovie(m)).map(toClientMovie);
    const creator = db.creator_profiles.find(cp => cp.id === bundle.creator_id);
    const isPurchased = (req.financialPurchases || []).some(p => p.item_type === 'bundle' && p.item_id === bundle.id);

    res.json({ bundle: { ...bundle, episodes, is_purchased: isPurchased }, creator });
  });

  const buckets = () => ({ privateBucket: privateVideoBucket(), publicBucket: MEDIA_BUCKET });
  // Temporary rate limit per process; the DB upload-quota RPC is the cross-pod
  // control. Add a Cloudflare WAF/edge rule for source-IP distributed abuse.
  const uploadRequests = new Map<string, { count: number; reset: number }>();
  const limitUploadRequests = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userKey = req.user?.id || req.ip || 'unknown';
    const now = Date.now();
    if (uploadRequests.size > 5000) for (const [key, slot] of uploadRequests) if (slot.reset < now) uploadRequests.delete(key);
    const slot = uploadRequests.get(userKey);
    if (!slot || slot.reset < now) uploadRequests.set(userKey, { count: 1, reset: now + 60_000 });
    else if (++slot.count > 140) return void res.status(429).json({ error: 'Too many upload requests. Please wait a moment.' });
    next();
  };

  app.post('/api/movies/upload-url', requireCreator, limitUploadRequests, async (req: AuthenticatedRequest, res: Response) => {
    let spec;
    try {
      spec = parseUploadSpec(req.body);
      if (spec.multipart) return void res.status(400).json({ error: 'Use the multipart uploader for video files larger than 16 MB.' });
    } catch (error) { return void res.status(400).json({ error: (error as Error).message }); }
    try {
      res.json(await prepareUpload(getR2Client(), uploadSessions, buckets(), req.user!.id, spec));
    } catch (error) {
      console.error('Media upload reservation failed:', error);
      res.status(uploadErrorStatus(error)).json({ error: 'Could not reserve an upload. Check your upload quota and try later.' });
    }
  });

  app.post('/api/movies/multipart/init', requireCreator, limitUploadRequests, async (req: AuthenticatedRequest, res: Response) => {
    let spec;
    try {
      spec = parseUploadSpec(req.body);
      if (!spec.multipart) return void res.status(400).json({ error: 'Use a single upload for this file.' });
    } catch (error) { return void res.status(400).json({ error: (error as Error).message }); }
    try {
      res.json(await prepareUpload(getR2Client(), uploadSessions, buckets(), req.user!.id, spec));
    } catch (error) {
      console.error('Multipart upload reservation failed:', error);
      res.status(uploadErrorStatus(error)).json({ error: 'Could not reserve a video upload. Check your quota and try later.' });
    }
  });

  app.post('/api/movies/multipart/part-url', requireCreator, limitUploadRequests, async (req: AuthenticatedRequest, res: Response) => {
    try {
      res.json(await signUploadPart(getR2Client(), uploadSessions, buckets(), req.user!.id,
        String(req.body?.sessionId || ''), req.body?.partNumber));
    } catch (error) { res.status(uploadErrorStatus(error)).json({ error: 'Upload part is not authorized or has expired.' }); }
  });

  app.post('/api/movies/multipart/complete', requireCreator, limitUploadRequests, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await completeMultipart(getR2Client(), uploadSessions, buckets(), req.user!.id,
        String(req.body?.sessionId || ''), req.body?.parts);
      res.json(result);
    } catch (error) {
      console.error('Multipart completion or validation failed:', error);
      res.status(uploadErrorStatus(error)).json({ error: 'Could not securely verify the uploaded parts. Please check your file and retry.' });
    }
  });

  app.post('/api/movies/uploads/complete', requireCreator, limitUploadRequests, async (req: AuthenticatedRequest, res: Response) => {
    try {
      res.json(await finalizeUpload(getR2Client(), uploadSessions, buckets(), req.user!.id,
        String(req.body?.sessionId || '')));
    } catch (error) {
      console.error('Direct-upload file validation failed:', error);
      res.status(uploadErrorStatus(error)).json({ error: 'Upload failed file verification. Check the file type and size before retrying.' });
    }
  });

  app.post('/api/movies/multipart/abort', requireCreator, limitUploadRequests, async (req: AuthenticatedRequest, res: Response) => {
    try {
      await abortUpload(getR2Client(), uploadSessions, buckets(), req.user!.id, String(req.body?.sessionId || ''));
      res.json({ ok: true });
    } catch (error) { res.status(uploadErrorStatus(error)).json({ error: 'Could not cancel the upload. Please contact support if it persists.' }); }
  });

  // Movie Upload (Creators Only)
  app.post(
    '/api/movies/upload',
    requireCreator,
    movieMediaUpload.none(),
    async (req: AuthenticatedRequest, res: Response) => {
      const { title, synopsis, genre, release_year } = req.body;
      if (!title || !synopsis || !genre) {
        res.status(400).json({ error: 'Title, synopsis, and genre are required.' });
        return;
      }
      let rightsAttestation;
      try { rightsAttestation = parseRightsAttestation(req.body, req.user!.id); }
      catch (error) { return void res.status(400).json({ error: error instanceof Error ? error.message : 'Rights declaration required.' }); }
      const contentRating = req.body?.content_rating;
      if (!CONTENT_RATINGS.includes(contentRating)) return void res.status(400).json({ error: 'A valid content/age rating is required.' });

      let videoSession;
      let posterSession;
      try {
        videoSession = await uploadSessions.assertActive(String(req.body.video_upload_id || ''), req.user!.id, 'ready');
        if (videoSession.kind !== 'video' || videoSession.usage !== 'movie' || !videoSession.final_key) {
          return void res.status(403).json({ error: 'This upload cannot be used as a movie master.' });
        }
        if (req.body.poster_upload_id) {
          posterSession = await uploadSessions.assertActive(String(req.body.poster_upload_id), req.user!.id, 'ready');
          if (posterSession.kind !== 'image' || posterSession.usage !== 'poster' || !posterSession.final_key) {
            return void res.status(403).json({ error: 'This upload cannot be used as a movie poster.' });
          }
        }
      } catch (error) { return void res.status(uploadErrorStatus(error)).json({ error: 'Submit verified upload session IDs for your movie and poster.' }); }
      const videoUrl = `private://${videoSession.final_key}`;

      const db = loadDatabase();
      if (db.movies.some(existing => existing.video_url === videoUrl)) {
        res.status(409).json({ error: 'This video has already been submitted.' });
        return;
      }
      const creatorProfile = db.creator_profiles.find(cp => cp.user_id === req.user!.id);
      if (!creatorProfile && req.user!.role !== 'admin') {
        res.status(403).json({ error: 'Creator channel profile not found.' });
        return;
      }

      const creatorId = creatorProfile ? creatorProfile.id : 'creator_01';
      const creatorName = creatorProfile ? creatorProfile.channel_name : req.user!.full_name;
      const creatorAvatar = creatorProfile ? creatorProfile.channel_avatar_url : req.user!.avatar_url;

      let posterUrl = '/posters/lagos_heist.jpg';

      try {
        const object = await getR2Client().send(new HeadObjectCommand({ Bucket: privateVideoBucket(), Key: videoSession.final_key }));
        if (object.ContentLength !== videoSession.expected_size || object.ContentLength > MAX_VIDEO_BYTES || object.ContentType?.split(';')[0] !== 'video/mp4') {
          res.status(415).json({ error: 'Verified movie master is missing or has changed.' });
          return;
        }
        if (posterSession) posterUrl = publicAssetUrl(posterSession.final_key!);
      } catch (storageError) {
        console.error('Permanent movie media upload failed:', storageError);
        res.status(503).json({ error: 'Verified media is temporarily unavailable. Please retry.' });
        return;
      }

      const newMovie: Movie = {
        id: `mov_${uuidv4().substring(0, 8)}`,
        creator_id: creatorId,
        creator_name: creatorName,
        creator_avatar: creatorAvatar,
        title: title.trim(),
        synopsis: synopsis.trim(),
        genre: genre.trim(),
        release_year: release_year ? parseInt(release_year, 10) : new Date().getFullYear(),
        duration_seconds: 3600, // standard runtime estimation
        poster_url: posterUrl,
        backdrop_url: posterUrl,
        video_url: videoUrl,
        is_bundle_only: false,
        status: 'pending', // enters moderation queue
        rights_attestation: rightsAttestation,
        content_rating: contentRating,
        views_count: 0,
        paid_unlocks_count: 0,
        price_ngn: 100, // fixed ₦100
        free_preview_seconds: 300, // fixed 5 mins
        created_at: new Date().toISOString(),
      };

      const reservedSessionIds: string[] = [];
      try {
        // Claim verified media by compare-and-swap before inserting the movie.
        // Concurrent requests cannot use a single upload to create two titles.
        await uploadSessions.transition(videoSession.id, req.user!.id, 'ready', 'attaching');
        reservedSessionIds.push(videoSession.id);
        if (posterSession) {
          await uploadSessions.transition(posterSession.id, req.user!.id, 'ready', 'attaching');
          reservedSessionIds.push(posterSession.id);
        }
        db.movies.push(newMovie);
        db.notifications.push({
          id: `notif_${uuidv4().substring(0, 8)}`,
          user_id: req.user!.id,
          title: 'Movie Submitted for Moderation',
          message: `"${title}" has entered the VisPlay moderation queue. You will be notified once reviewed.`,
          is_read: false,
          created_at: new Date().toISOString(),
        });
        await saveDatabase(db);
      } catch (error) {
        for (const id of reservedSessionIds) {
          await uploadSessions.transition(id, req.user!.id, 'attaching', 'ready').catch(() => undefined);
        }
        console.error('Movie creation or upload claim failed:', error);
        return void res.status(503).json({ error: 'Could not safely complete movie submission. Please check the library before retrying.' });
      }
      for (const id of reservedSessionIds) {
        await uploadSessions.transition(id, req.user!.id, 'attaching', 'consumed')
          .catch(error => console.error('Movie saved but media session needs reconciliation:', error));
      }
      res.status(201).json({ movie: toClientMovie(newMovie), message: 'Movie submitted successfully for review.' });
    }
  );

  // Likes
  app.post('/api/movies/:id/like', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const movieId = req.params.id;
    const db = loadDatabase();
    const existingIndex = db.likes.findIndex(l => l.movie_id === movieId && l.user_id === req.user!.id);

    let isLiked = false;
    if (existingIndex !== -1) {
      db.likes.splice(existingIndex, 1);
      isLiked = false;
    } else {
      db.likes.push({
        id: `like_${uuidv4().substring(0, 8)}`,
        movie_id: movieId,
        user_id: req.user!.id,
        created_at: new Date().toISOString(),
      });
      isLiked = true;
    }

    const movie = db.movies.find((item: any) => item.id === movieId);
    const creatorProfile = movie ? db.creator_profiles.find((profile: any) => profile.id === movie.creator_id) : null;
    const creatorOwnerId = (creatorProfile as any)?.user_id || (creatorProfile as any)?.owner_user_id;
    if (isLiked && creatorOwnerId && creatorOwnerId !== req.user!.id) {
      db.notifications.push({
        id: `notif_${uuidv4().substring(0, 8)}`,
        user_id: creatorOwnerId,
        title: 'Someone liked your movie',
        message: `${req.user!.full_name || 'Someone'} liked "${movie?.title || 'your movie'}".`,
        link: `/?watch=${encodeURIComponent(movieId)}`,
        is_read: false,
        created_at: new Date().toISOString(),
      });
    }

    await saveDatabase(db);
    const totalLikes = db.likes.filter(l => l.movie_id === movieId).length;
    res.json({ is_liked: isLiked, likes_count: totalLikes });
  });

  // Comments
  app.get('/api/movies/:id/comments', (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    if (!db.movies.some(movie => movie.id === req.params.id && publiclyVisibleMovie(movie))) return void res.status(404).json({ error: 'Movie unavailable.' });
    const excluded = blockingUserIds(db, req.user?.id);
    const comments = db.comments
      .filter(c => c.movie_id === req.params.id && !c.moderation_hidden && !excluded.has(c.user_id))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ comments });
  });

  app.post('/api/movies/:id/comments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (req.user!.safety_restricted) return void res.status(403).json({ error: 'Commenting is temporarily restricted. Contact the Safety Center.' });
    const { parent_id } = req.body;
    let commentText: string;
    try { commentText = validatePublicComment(req.body?.comment_text, req.body?.content_policy_accepted); }
    catch (error) { return void res.status(400).json({ error: error instanceof Error ? error.message : 'Comment rejected.' }); }

    const db = loadDatabase();
    const priorComments = db.comments.filter(comment => comment.user_id === req.user!.id && Date.parse(comment.created_at) > Date.now() - 24 * 60 * 60 * 1000);
    if (priorComments.length >= 30) return void res.status(429).json({ error: 'Daily comment limit reached.' });
    if (priorComments.some(comment => comment.movie_id === req.params.id && comment.comment_text.toLowerCase() === commentText.toLowerCase() && Date.parse(comment.created_at) > Date.now() - 5 * 60 * 1000)) {
      return void res.status(409).json({ error: 'Please do not post a duplicate comment.' });
    }
    const movieForComment = db.movies.find(movie => movie.id === req.params.id && publiclyVisibleMovie(movie));
    if (!movieForComment) return void res.status(404).json({ error: 'Movie unavailable for comments.' });
    const ownerProfile = db.creator_profiles.find(profile => profile.id === movieForComment.creator_id);
    if (ownerProfile && blockingUserIds(db, req.user!.id).has(ownerProfile.user_id)) return void res.status(403).json({ error: 'This account is blocked.' });
    if (parent_id && !db.comments.some(comment => comment.id === parent_id && comment.movie_id === req.params.id && !comment.moderation_hidden && !blockingUserIds(db, req.user!.id).has(comment.user_id))) {
      return void res.status(400).json({ error: 'Reply target is unavailable.' });
    }
    const newComment: Comment = {
      id: `com_${uuidv4().substring(0, 8)}`,
      movie_id: req.params.id,
      user_id: req.user!.id,
      user_name: req.user!.full_name,
      user_avatar: req.user!.avatar_url,
      parent_id: parent_id || null,
      comment_text: commentText,
      content_rules_accepted_version: '2026-11-11',
      likes_count: 0,
      created_at: new Date().toISOString(),
    };

    db.comments.push(newComment);

    const movie = db.movies.find((item: any) => item.id === req.params.id);
    const creatorProfile = movie ? db.creator_profiles.find((profile: any) => profile.id === movie.creator_id) : null;
    const creatorOwnerId = (creatorProfile as any)?.user_id || (creatorProfile as any)?.owner_user_id;
    const notifyTargets = new Set<string>();
    if (creatorOwnerId && creatorOwnerId !== req.user!.id) notifyTargets.add(creatorOwnerId);
    if (parent_id) {
      const parentComment = db.comments.find((item: any) => item.id === parent_id);
      if (parentComment?.user_id && parentComment.user_id !== req.user!.id) notifyTargets.add(parentComment.user_id);
    }
    notifyTargets.forEach(user_id => {
      db.notifications.push({
        id: `notif_${uuidv4().substring(0, 8)}`,
        user_id,
        title: parent_id ? 'New reply to your comment' : 'New comment on your movie',
        message: parent_id ? `${req.user!.full_name || 'Someone'} replied to a comment.` : `${req.user!.full_name || 'Someone'} commented on "${movie?.title || 'your movie'}".`,
        link: `/?watch=${encodeURIComponent(req.params.id)}`,
        is_read: false,
        created_at: new Date().toISOString(),
      });
    });

    await saveDatabase(db);
    res.status(201).json({ comment: newComment });
  });

  app.post('/api/movies/:id/comments/:commentId/reaction', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (req.user!.safety_restricted) return void res.status(403).json({ error: 'Social participation is temporarily restricted.' });
    const reaction = req.body?.reaction;
    if (reaction !== 'like' && reaction !== 'dislike') return void res.status(400).json({ error: 'Choose like or dislike.' });
    const db = loadDatabase();
    const comment = db.comments.find(c => c.id === req.params.commentId && c.movie_id === req.params.id);
    if (!comment || comment.moderation_hidden || blockingUserIds(db, req.user!.id).has(comment.user_id)) return void res.status(404).json({ error: 'Comment not found.' });
    const extended = comment as Comment & { liked_by?: string[]; disliked_by?: string[]; dislikes_count?: number };
    extended.liked_by ||= [];
    extended.disliked_by ||= [];
    extended.dislikes_count ||= 0;
    const previousLikes = Number(comment.likes_count) || 0;
    const previousDislikes = Number(extended.dislikes_count) || 0;
    const hadLike = extended.liked_by.includes(req.user!.id);
    const hadDislike = extended.disliked_by.includes(req.user!.id);
    const wasSelected = reaction === 'like' ? hadLike : hadDislike;
    extended.liked_by = extended.liked_by.filter(id => id !== req.user!.id);
    extended.disliked_by = extended.disliked_by.filter(id => id !== req.user!.id);
    if (!wasSelected) {
      if (reaction === 'like') extended.liked_by.push(req.user!.id);
      else extended.disliked_by.push(req.user!.id);
    }
    comment.likes_count = Math.max(0, previousLikes + (reaction === 'like' ? (wasSelected ? -1 : 1) : (hadLike ? -1 : 0)));
    extended.dislikes_count = Math.max(0, previousDislikes + (reaction === 'dislike' ? (wasSelected ? -1 : 1) : (hadDislike ? -1 : 0)));
    if (reaction === 'like' && !wasSelected && comment.user_id !== req.user!.id) {
      db.notifications.push({
        id: `notif_${uuidv4().substring(0, 8)}`,
        user_id: comment.user_id,
        title: 'Someone liked your comment',
        message: `${req.user!.full_name || 'Someone'} liked your comment.`,
        link: `/?watch=${encodeURIComponent(req.params.id)}`,
        is_read: false,
        created_at: new Date().toISOString(),
      });
    }
    await saveDatabase(db);
    res.json({
      likes_count: comment.likes_count,
      dislikes_count: extended.dislikes_count,
      liked_by: extended.liked_by,
      disliked_by: extended.disliked_by,
    });
  });

  app.delete('/api/movies/:id/comments/:commentId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const commentIndex = db.comments.findIndex(c => c.id === req.params.commentId);
    if (commentIndex === -1) {
      res.status(404).json({ error: 'Comment not found.' });
      return;
    }

    const comment = db.comments[commentIndex];
    if (comment.user_id !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'You are not authorized to delete this comment.' });
      return;
    }

    db.comments.splice(commentIndex, 1);
    await saveDatabase(db);
    res.json({ success: true, message: 'Comment deleted.' });
  });

  // -------------------------------------------------------------
  // SECURE STREAMING & VIEWING ANALYTICS
  // -------------------------------------------------------------

  const handleMovieStream = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const db = loadDatabase();
    const movie = db.movies.find(m => m.id === req.params.id);
    if (!movie || movie.safety_hold) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }

    const mode = req.query.mode === 'full' ? 'full' : req.query.mode === 'preview' ? 'preview' : null;
    if (!mode) {
      res.status(400).json({ error: 'Choose preview or full playback mode.' });
      return;
    }
    const decision = authorizeMovieStream(movie, req.user, req.financialPurchases || [], db.creator_profiles, mode);
    if (decision.status === 'not-found') return void res.status(404).json({ error: 'Movie not found.' });
    if (decision.status === 'forbidden') return void res.status(403).json({ error: 'Purchase this movie or bundle to view the full film.' });
    if (decision.status === 'not-ready') return void res.status(423).json({ error: 'Secure media is not ready. Please try again after processing.' });

    // The source bucket must be private with neither custom-domain nor r2.dev
    // public access. An app check cannot revoke previously shared public URLs;
    // operators must copy legacy objects and disable the old access path.
    const range = req.headers.range;
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) {
      res.status(416).json({ error: 'Invalid or multi-part byte range.' });
      return;
    }

    try {
      const bucket = privateVideoBucket();
      const client = getR2Client();
      res.setHeader('Cache-Control', 'private, no-store, no-cache, max-age=0');
      res.setHeader('Vary', 'Cookie, Authorization');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      if (req.method === 'HEAD') {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: decision.key }));
        if (head.ContentLength !== undefined) res.setHeader('Content-Length', String(head.ContentLength));
        res.status(200).end();
        return;
      }

      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: decision.key, Range: range }));
      if (range && !object.ContentRange) throw new Error('Storage ignored a requested byte range.');
      if (object.ContentRange) res.setHeader('Content-Range', object.ContentRange);
      if (object.ContentLength !== undefined) res.setHeader('Content-Length', String(object.ContentLength));
      const body = object.Body as unknown as Readable | undefined;
      if (!body || typeof body.pipe !== 'function') throw new Error('Storage returned no readable video body.');

      body.on('error', error => {
        console.error('Private video transfer failed:', error);
        if (!res.headersSent) res.status(502).end();
        else res.destroy(error);
      });
      res.on('close', () => body.destroy());
      res.status(object.ContentRange ? 206 : 200);
      body.pipe(res);
    } catch (error: any) {
      if (res.headersSent) return;
      if (error?.name === 'InvalidRange' || error?.$metadata?.httpStatusCode === 416) {
        res.status(416).json({ error: 'Requested video byte range is unavailable.' });
      } else {
        console.error('Secure movie stream failed:', error);
        res.status(503).json({ error: 'Secure playback is temporarily unavailable.' });
      }
    }
  };

  app.head('/api/media/stream/:id', handleMovieStream);
  app.get('/api/media/stream/:id', handleMovieStream);

  // Track viewing events (Deduplicated, logs milestones & preview pause)
  app.post('/api/movies/:id/track-view', async (req: AuthenticatedRequest, res: Response) => {
    const { session_id, duration_watched_seconds, reached_5_min, completed } = req.body;
    const movieId = req.params.id;
    const db = loadDatabase();
    const movie = db.movies.find(m => m.id === movieId);
    if (!movie) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }

    const ip = req.ip || '127.0.0.1';
    const now = new Date().toISOString();

    let event = db.viewing_events.find(e => e.session_id === session_id && e.movie_id === movieId);
    if (!event) {
      // Increment view count on start
      movie.views_count = (movie.views_count || 0) + 1;
      event = {
        id: `view_${uuidv4().substring(0, 8)}`,
        user_id: req.user ? req.user.id : null,
        movie_id: movieId,
        session_id: session_id || uuidv4(),
        duration_watched_seconds: Math.floor(duration_watched_seconds || 0),
        last_position_seconds: Math.max(0, Math.floor(Number(req.body?.last_position_seconds ?? duration_watched_seconds) || 0)),
        reached_5_min: !!reached_5_min,
        completed: !!completed,
        converted_to_purchase: false,
        ip_hash: ip,
        created_at: now,
      };
      db.viewing_events.push(event);
    } else {
      // Update duration and milestones
      event.duration_watched_seconds = Math.max(event.duration_watched_seconds, Math.floor(duration_watched_seconds || 0));
      event.last_position_seconds = Math.max(0, Math.floor(Number(req.body?.last_position_seconds ?? duration_watched_seconds) || 0));
      if (req.user) event.user_id = req.user.id;
      event.created_at = now;
      if (reached_5_min) event.reached_5_min = true;
      if (completed) event.completed = true;
    }

    await saveDatabase(db);
    res.json({ success: true, views_count: movie.views_count });
  });

  // -------------------------------------------------------------
  // MANDATORY PRICING & REAL PAYMENTS (PAYSTACK / WALLET)
  // Authoritative amounts and entitlements live in PostgreSQL finance tables.
  // 100 NGN movie / 700 NGN 10-episode bundle / creator 85%, platform 15%.
  // -------------------------------------------------------------

  function reportFinanceError(res: Response, error: unknown): void {
    if (error instanceof PaystackNotConfirmedError) {
      res.status(402).json({ error: 'Paystack has not confirmed this payment. Please try again later.' });
    } else if (error instanceof PaystackGatewayError) {
      res.status(502).json({ error: error.message });
    } else {
      const mapped = financeErrorResponse(error);
      res.status(mapped.status).json({ error: mapped.message });
    }
  }

  async function reportWalletPurchaseError(res: Response, error: unknown, userId: string, requiredNgn: number): Promise<void> {
    const mapped = financeErrorResponse(error);
    if (mapped.status !== 402) return void reportFinanceError(res, error);
    try {
      const balance = await getFinanceStore().getBalance(userId);
      res.status(402).json({ error: mapped.message, required_ngn: requiredNgn,
                             current_balance: balance, shortfall_ngn: Math.max(0, requiredNgn - balance) });
    } catch { reportFinanceError(res, error); }
  }

  function cleanReference(value: unknown, prefix: string): string | null {
    return typeof value === 'string' && value.startsWith(prefix) &&
      /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : null;
  }

  // Intent is committed BEFORE redirecting to Paystack. Any confirmation later
  // (browser retry or signed provider webhook) settles the SAME reference once.
  app.post('/api/wallet/deposit/initialize', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const amount = Number(req.body?.amount_ngn);
    if (!Number.isSafeInteger(amount) || amount < 100 || amount > 1000000) {
      return void res.status(400).json({ error: 'Deposit must be a whole-naira amount between ₦100 and ₦1,000,000.' });
    }
    const reference = 'VIS_DEP_' + Date.now() + '_' + uuidv4().replace(/-/g, '');
    try {
      await getFinanceStore().createIntent({ userId: req.user!.id, reference, kind: 'wallet_deposit', amount });
      const authorizationUrl = await initializePaystack({
        email: req.user!.email, reference, amountNgn: amount, userId: req.user!.id, purpose: 'wallet_deposit',
      });
      res.json({ reference, authorization_url: authorizationUrl });
    } catch (error) { reportFinanceError(res, error); }
  });

  app.post('/api/wallet/deposit/verify', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const reference = cleanReference(req.body?.reference, 'VIS_DEP_');
    if (!reference) return void res.status(400).json({ error: 'Valid deposit reference required.' });
    try {
      const finance = getFinanceStore();
      const tx = await finance.getIntent(reference, req.user!.id);
      if (!tx || tx.type !== 'deposit' || tx.payment_method !== 'paystack') {
        return void res.status(404).json({ error: 'Deposit was not initialized by this account.' });
      }
      if (tx.status === 'successful') {
        return void res.json({ success: true, already_verified: true, wallet_balance: await finance.getBalance(req.user!.id) });
      }
      const verified = await verifyPaystackCharge(reference);
      const result = await finance.settlePaystack(verified);
      res.json({ success: true, already_verified: result.already_verified === true,
                 wallet_balance: await finance.getBalance(req.user!.id) });
    } catch (error) { reportFinanceError(res, error); }
  });

  app.post('/api/purchases/movie/initialize', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const movie = db.movies.find(m => m.id === req.body?.movie_id && publiclyVisibleMovie(m) && !m.is_bundle_only);
    if (!movie) return void res.status(404).json({ error: 'Published individual movie not found.' });
    const owned = ownsFullMovie(movie, req.user, req.financialPurchases || [], db.creator_profiles);
    if (owned) return void res.json({ already_owned: true, movie_id: movie.id });
    const reference = 'VIS_MOV_' + Date.now() + '_' + uuidv4().replace(/-/g, '');
    try {
      await getFinanceStore().createIntent({
        userId: req.user!.id, reference, kind: 'movie_purchase', amount: 100,
        itemId: movie.id, creatorId: movie.creator_id, bundleId: movie.bundle_id,
      });
      const authorizationUrl = await initializePaystack({
        email: req.user!.email, reference, amountNgn: 100, userId: req.user!.id,
        purpose: 'movie_purchase', movieId: movie.id, title: movie.title,
      });
      res.json({ reference, authorization_url: authorizationUrl, movie_id: movie.id });
    } catch (error) { reportFinanceError(res, error); }
  });

  app.post('/api/purchases/movie/verify', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const reference = cleanReference(req.body?.reference, 'VIS_MOV_');
    if (!reference) return void res.status(400).json({ error: 'Valid movie payment reference required.' });
    try {
      const finance = getFinanceStore();
      const tx = await finance.getIntent(reference, req.user!.id);
      if (!tx || tx.type !== 'purchase' || tx.payment_method !== 'paystack' || tx.metadata?.purpose !== 'movie_purchase') {
        return void res.status(404).json({ error: 'Movie payment was not initialized by this account.' });
      }
      if (tx.status === 'refund_required') {
        return void res.status(409).json({ error: 'A duplicate payment requires a refund. Our support team must resolve this charge.' });
      }
      if (tx.status === 'successful') {
        const purchase = (await finance.purchases(req.user!.id)).find(p => p.reference === reference);
        return void res.json({ success: true, already_verified: true, movie_id: tx.metadata?.movie_id, purchase });
      }
      const verified = await verifyPaystackCharge(reference);
      const result = await finance.settlePaystack(verified);
      if (result.refund_required) return void res.status(409).json({
        error: 'Payment succeeded but content was already owned. A refund review has been opened; do not pay again.',
      });
      res.json({ success: true, movie_id: tx.metadata?.movie_id, purchase: result.purchase, ledger: result.ledger });
    } catch (error) { reportFinanceError(res, error); }
  });

  // This path is retained for the existing website; the future mobile release
  // must have store-compliant payment functionality separately reviewed.
  app.post('/api/purchases/buy-movie', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const movie = db.movies.find(m => m.id === req.body?.movie_id && publiclyVisibleMovie(m) && !m.is_bundle_only);
    if (!movie) return void res.status(404).json({ error: 'Published individual movie not found.' });
    try {
      const result = await getFinanceStore().buyWallet({
        userId: req.user!.id, itemType: 'movie', itemId: movie.id,
        creatorId: movie.creator_id, bundleId: movie.bundle_id,
        amount: 100, reference: 'VIS_PUR_MOV_' + Date.now() + '_' + uuidv4().replace(/-/g, ''),
      });
      res.json({ success: true, already_owned: Boolean(result.already_owned),
                 wallet_balance: result.wallet_balance, purchase: result.purchase, ledger: result.ledger });
    } catch (error) { await reportWalletPurchaseError(res, error, req.user!.id, 100); }
  });

  app.post('/api/purchases/buy-bundle', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const bundle = db.bundles.find(b => b.id === req.body?.bundle_id && b.status === 'approved');
    if (!bundle) return void res.status(404).json({ error: 'Approved bundle not found.' });
    const episodes = db.movies.filter(m => m.bundle_id === bundle.id && publiclyVisibleMovie(m));
    if (bundle.episodes_count !== 10 || episodes.length !== 10) {
      return void res.status(409).json({ error: 'The complete ten-episode bundle is not published.' });
    }
    try {
      const result = await getFinanceStore().buyWallet({
        userId: req.user!.id, itemType: 'bundle', itemId: bundle.id, creatorId: bundle.creator_id,
        amount: 700, reference: 'VIS_PUR_BUN_' + Date.now() + '_' + uuidv4().replace(/-/g, ''),
      });
      res.json({ success: true, already_owned: Boolean(result.already_owned),
                 wallet_balance: result.wallet_balance, purchase: result.purchase, ledger: result.ledger });
    } catch (error) { await reportWalletPurchaseError(res, error, req.user!.id, 700); }
  });

  // User Dashboard: Transactions & Purchased Movies
  app.get('/api/user/library', requireAuth, guardedFinancialRead(async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const purchases = req.financialPurchases || [];
    const movieIds = purchases.filter(p => p.item_type === 'movie').map(p => p.item_id);
    const bundleIds = purchases.filter(p => p.item_type === 'bundle').map(p => p.item_id);

    // Include movies purchased individually + movies in purchased bundles
    const movies = db.movies.filter(m => movieIds.includes(m.id) || (m.bundle_id && bundleIds.includes(m.bundle_id))).map(toClientMovie);
    const bundles = db.bundles.filter(b => bundleIds.includes(b.id));
    const userEvents = db.viewing_events
      .filter(e => e.user_id === req.user!.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const latestEventByMovie = new Map<string, typeof userEvents[number]>();
    for (const event of userEvents) {
      if (!latestEventByMovie.has(event.movie_id)) latestEventByMovie.set(event.movie_id, event);
    }
    const watchHistory = Array.from(latestEventByMovie.values())
      .map(event => {
        const movie = db.movies.find(m => m.id === event.movie_id);
        return movie ? { ...toClientMovie(movie), last_position_seconds: event.last_position_seconds ?? event.duration_watched_seconds ?? 0, last_watched_at: event.created_at, is_purchased: movieIds.includes(movie.id) || Boolean(movie.bundle_id && bundleIds.includes(movie.bundle_id)) } : null;
      })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime());
    const transactions = await getFinanceStore().transactions(req.user!.id);
    const followedCreators = db.follows
      .filter(f => f.follower_user_id === req.user!.id)
      .map(f => db.creator_profiles.find(cp => cp.id === f.creator_user_id))
      .filter(Boolean);

    res.json({
      movies,
      bundles,
      watch_history: watchHistory,
      transactions,
      followed_creators: followedCreators,
      wallet_balance: req.user!.wallet_balance,
    });
  }));

  // -------------------------------------------------------------
  // SUPER ADMIN DASHBOARD ROUTES
  // -------------------------------------------------------------

  app.get('/api/admin/metrics', requireAdmin, guardedFinancialRead(async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const financeMetrics = await getFinanceStore().adminMetrics();
    const totalUsers = db.users.length;
    const totalCreators = db.creator_profiles.filter(cp => cp.status === 'approved').length;
    const pendingApplications = db.creator_profiles.filter(cp => cp.status === 'pending').length;
    const totalMovies = db.movies.length;
    const pendingMovies = db.movies.filter(m => m.status === 'pending').length;
    const publishedMovies = db.movies.filter(m => m.status === 'published').length;

    const totalViews = db.movies.reduce((sum, m) => sum + (m.views_count || 0), 0);

    const viewingStats = {
      total_sessions: db.viewing_events.length,
      reached_5_min: db.viewing_events.filter(e => e.reached_5_min).length,
      completed_watches: db.viewing_events.filter(e => e.completed).length,
      converted_to_purchases: db.viewing_events.filter(e => e.converted_to_purchase).length,
    };

    res.json({
      metrics: {
        total_users: totalUsers,
        total_creators: totalCreators,
        pending_applications: pendingApplications,
        total_movies: totalMovies,
        pending_movies: pendingMovies,
        published_movies: publishedMovies,
        total_views: totalViews,
        total_paid_unlocks: financeMetrics.total_paid_unlocks,
        gross_sales_ngn: financeMetrics.gross_sales_ngn,
        creator_share_ngn: financeMetrics.creator_share_ngn,
        platform_revenue_ngn: financeMetrics.platform_revenue_ngn,
        wallet_deposits_ngn: financeMetrics.wallet_deposits_ngn,
      },
      viewing_stats: viewingStats,
    });
  }));

  // Admin Creator Applications
  app.get('/api/admin/creator-applications', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const applications = db.creator_profiles.map(cp => {
      const user = db.users.find(u => u.id === cp.user_id);
      return {
        ...cp,
        user_name: user?.full_name || 'Unknown',
        user_email: user?.email || '',
        user_avatar: user?.avatar_url || '',
        user_phone: user?.phone || '',
      };
    }).reverse();

    res.json({ applications });
  });

  app.post('/api/admin/creator-applications/:id/review', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { action, notes } = req.body; // action: 'approve' | 'reject'
    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ error: 'Action must be approve or reject.' });
      return;
    }

    const db = loadDatabase();
    const profile = db.creator_profiles.find(cp => cp.id === req.params.id);
    if (!profile) {
      res.status(404).json({ error: 'Creator application not found.' });
      return;
    }

    const now = new Date().toISOString();
    profile.status = action === 'approve' ? 'approved' : 'rejected';
    profile.reviewed_at = now;
    profile.review_notes = notes || (action === 'approve' ? 'Approved by VisPlay Super Admin.' : 'Application declined.');

    const user = db.users.find(u => u.id === profile.user_id);
    if (user && action === 'approve') {
      user.role = 'creator';
    }

    // Log admin action
    db.audit_logs.push({
      id: `aud_${uuidv4().substring(0, 8)}`,
      admin_id: req.user!.id,
      admin_name: req.user!.full_name,
      action: action === 'approve' ? 'APPROVE_CREATOR' : 'REJECT_CREATOR',
      target_type: 'creator_profile',
      target_id: profile.id,
      details: `${action.toUpperCase()} creator channel "${profile.channel_name}". Notes: ${profile.review_notes}`,
      created_at: now,
    });

    // Notify user
    if (user) {
      db.notifications.push({
        id: `notif_${uuidv4().substring(0, 8)}`,
        user_id: user.id,
        title: action === 'approve' ? 'Creator Application Approved!' : 'Creator Application Update',
        message:
          action === 'approve'
            ? `Congratulations! Your channel "${profile.channel_name}" is now approved. VisPlay Creator Studio is unlocked.`
            : `Your application for "${profile.channel_name}" was declined. Reason: ${notes || 'Did not meet content requirements.'}`,
        link: action === 'approve' ? '/creator/studio' : '/dashboard',
        is_read: false,
        created_at: now,
      });
    }

    await saveDatabase(db);
    res.json({ success: true, creator_profile: profile, message: `Application ${action}d successfully.` });
  });

  // Admin All Movies Table (With Views, Milestones, Sales, 85/15 split)
  app.get('/api/admin/movies', requireAdmin, guardedFinancialRead(async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const salesByMovie = await getFinanceStore().movieSales();
    const moviesWithFinancials = db.movies.map(m => {
      const totals = salesByMovie[m.id];
      const grossSales = totals?.gross_sales_ngn || 0;
      const creatorShare = totals?.creator_share_ngn || 0;
      const platformFee = totals?.platform_fee_ngn || 0;
      const events = db.viewing_events.filter(e => e.movie_id === m.id);

      return {
        ...toClientMovie(m),
        private_master_linked: Boolean(privateVideoKey(m.video_url)),
        private_preview_linked: Boolean(m.preview_private_key),
        rights_reviewed: Boolean(m.rights_review),
        rights_declared: Boolean(m.rights_attestation),
        content_rating_reviewed: Boolean(m.content_rating_reviewed_at),
        safety_hold: Boolean(m.safety_hold),
        milestones_5min: events.filter(e => e.reached_5_min).length,
        completed_watches: events.filter(e => e.completed).length,
        gross_sales_ngn: grossSales,
        creator_share_ngn: creatorShare,
        platform_fee_ngn: platformFee,
      };
    }).reverse();

    res.json({ movies: moviesWithFinancials });
  }));

  // An operator first copies a legacy public video to private R2 (without
  // deleting its source), then binds the verified new key to the movie here.
  app.post('/api/admin/movies/:id/attach-private-master', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const movie = db.movies.find(m => m.id === req.params.id);
    if (!movie) return void res.status(404).json({ error: 'Movie not found.' });
    const owner = db.creator_profiles.find(profile => profile.id === movie.creator_id);
    if (!owner) return void res.status(409).json({ error: 'Movie has no verified creator account owner.' });

    const reference = typeof req.body?.private_video_url === 'string' ? req.body.private_video_url : '';
    const key = privateVideoKey(reference);
    if (!key || !key.startsWith(`videos/${owner.user_id}/`)) {
      return void res.status(400).json({ error: 'Master must have a private key scoped to this creator.' });
    }
    if (db.movies.some(other => other.id !== movie.id && other.video_url === reference)) {
      return void res.status(409).json({ error: 'Another movie already references this master object.' });
    }

    try {
      const object = await getR2Client().send(new HeadObjectCommand({ Bucket: privateVideoBucket(), Key: key }));
      if (!object.ContentLength || object.ContentLength > 500 * 1024 * 1024 || object.ContentType?.split(';')[0] !== 'video/mp4') {
        return void res.status(409).json({ error: 'Private video failed file size or MP4 metadata validation.' });
      }
      movie.video_url = reference;
      // A new master requires a new preview. Never attach the old preview to
      // a different full video, even when the movie ID stays the same.
      movie.preview_private_key = undefined;
      db.audit_logs.push({
        id: `aud_${uuidv4().substring(0, 8)}`,
        admin_id: req.user!.id, admin_name: req.user!.full_name,
        action: 'ATTACH_PRIVATE_MOVIE_MASTER', target_type: 'movie', target_id: movie.id,
        details: 'Verified and attached a private movie master; preview reset for regeneration.',
        created_at: new Date().toISOString(),
      });
      await saveDatabase(db);
      res.json({ success: true, movie_id: movie.id, master_ready: true, preview_ready: false });
    } catch (error) {
      console.error('Private master attachment failed:', error);
      res.status(503).json({ error: 'Could not verify the private video master.' });
    }
  });

  // A dedicated preview-generation worker uploads a verified <=300s MP4 to a
  // private object key with movieid metadata. An administrator attaches that
  // asset only after validating the exact movie/key relationship.
  app.post('/api/admin/movies/:id/attach-preview', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const movie = db.movies.find(m => m.id === req.params.id);
    if (!movie) return void res.status(404).json({ error: 'Movie not found.' });

    const previewKey = typeof req.body?.preview_private_key === 'string' ? req.body.preview_private_key : '';
    if (!/^previews\/[A-Za-z0-9_-]+\/[a-f0-9-]{32,}\.mp4$/i.test(previewKey) || !previewKey.startsWith(`previews/${movie.id}/`)) {
      return void res.status(400).json({ error: 'Invalid private preview key for this movie.' });
    }

    try {
      const head = await getR2Client().send(new HeadObjectCommand({ Bucket: privateVideoBucket(), Key: previewKey }));
      if (!head.ContentLength || head.ContentLength > 250 * 1024 * 1024 || head.ContentType?.split(';')[0] !== 'video/mp4' || head.Metadata?.movieid !== movie.id) {
        return void res.status(409).json({ error: 'Preview file failed ownership/type/size validation.' });
      }
      movie.preview_private_key = previewKey;
      db.audit_logs.push({
        id: `aud_${uuidv4().substring(0, 8)}`,
        admin_id: req.user!.id,
        admin_name: req.user!.full_name,
        action: 'ATTACH_SECURE_MOVIE_PREVIEW',
        target_type: 'movie', target_id: movie.id,
        details: 'Verified and attached a private preview asset.',
        created_at: new Date().toISOString(),
      });
      await saveDatabase(db);
      res.json({ success: true, movie_id: movie.id, preview_ready: true });
    } catch (error) {
      console.error('Private preview attachment failed:', error);
      res.status(503).json({ error: 'Could not validate the private preview object.' });
    }
  });

  // A human reviewer must classify audience suitability. Adult-rated videos
  // are blocked until a separate age-assurance program exists (Section I).
  app.post('/api/admin/movies/:id/content-rating', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = loadDatabase();
      const movie = db.movies.find(item => item.id === req.params.id);
      if (!movie) return void res.status(404).json({ error: 'Movie not found.' });
      if (movie.status === 'published' && !movie.safety_hold) return void res.status(409).json({ error: 'Published film content classification needs a separately approved re-review.' });
      if (!CONTENT_RATINGS.includes(req.body?.content_rating)) throw new SafetyInputError('Select a valid audience content rating.');
      const notes = limitedText(req.body?.review_notes, 1000, 'Content review notes', 20);
      movie.content_rating = req.body.content_rating;
      movie.content_rating_reviewed_at = new Date().toISOString();
      db.audit_logs.push({ id: `aud_${uuidv4()}`, admin_id: req.user!.id, admin_name: req.user!.full_name,
        action: 'VERIFY_CONTENT_RATING', target_type: 'movie', target_id: movie.id,
        details: `Content rating: ${movie.content_rating}; review evidence: ${notes}`, created_at: movie.content_rating_reviewed_at });
      await saveDatabase(db);
      res.json({ success: true, content_rating: movie.content_rating });
    } catch (error) {
      if (error instanceof SafetyInputError) return void res.status(error.status).json({ error: error.message });
      res.status(503).json({ error: 'Content rating could not be saved.' });
    }
  });

  // Human rights clearance is separate from the creator's declaration.
  // The employer must verify source licences/contracts OFFLINE before submitting.
  app.post('/api/admin/movies/:id/rights-review', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = loadDatabase();
      const movie = db.movies.find(item => item.id === req.params.id);
      if (!movie) return void res.status(404).json({ error: 'Movie not found.' });
      const rightsCreator = db.creator_profiles.find(profile => profile.id === movie.creator_id);
      if (rightsCreator?.user_id === req.user!.id) return void res.status(403).json({ error: 'Your own film needs a different independent rights reviewer.' });
      if (movie.status === 'published' && !movie.safety_hold) return void res.status(409).json({ error: 'Published movies may be re-reviewed only while under an active safety hold.' });
      if (pendingRightsComplaint(db, movie.id)) return void res.status(409).json({ error: 'Unresolved copyright complaint requires specialist review.' });
      const basis = req.body?.verification_basis;
      if (!['original', 'licence', 'written_authorization', 'other'].includes(basis)) throw new SafetyInputError('Choose the source of the checked rights documents.');
      const reference = limitedText(req.body?.evidence_reference, 200, 'Document or contract reference', 5);
      const notes = limitedText(req.body?.review_notes, 1000, 'Human rights review notes', 20);
      movie.rights_review = { reviewed_at: new Date().toISOString(), reviewer_user_id: req.user!.id,
        verification_basis: basis, evidence_reference: reference, review_notes: notes };
      db.audit_logs.push({ id: `aud_${uuidv4()}`, admin_id: req.user!.id, admin_name: req.user!.full_name,
        action: 'VERIFY_MOVIE_RIGHTS', target_type: 'movie', target_id: movie.id,
        details: `Rights reviewed from ${basis}; document reference: ${reference}; notes: ${notes}`, created_at: movie.rights_review.reviewed_at });
      await saveDatabase(db);
      res.json({ success: true, rights_reviewed_at: movie.rights_review.reviewed_at });
    } catch (error) {
      if (error instanceof SafetyInputError) return void res.status(error.status).json({ error: error.message });
      res.status(503).json({ error: 'Rights review could not be saved.' });
    }
  });

  // Admin Movie Moderation
  app.post('/api/admin/movies/:id/review', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { action, notes } = req.body; // action: 'approve' | 'reject' | 'publish'
    const db = loadDatabase();
    const movie = db.movies.find(m => m.id === req.params.id);
    if (!movie) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }

    if (action !== 'approve' && action !== 'publish' && action !== 'reject') {
      res.status(400).json({ error: 'Invalid moderation action.' });
      return;
    }

    if (action === 'approve' || action === 'publish') {
      if (!movie.content_rating || !movie.content_rating_reviewed_at) {
        return void res.status(409).json({ error: 'A human-reviewed content/age rating is required before publication.' });
      }
      if (movie.content_rating === 'ADULT') {
        return void res.status(409).json({ error: 'Adult-rated films require age assurance and territory approval before publication.' });
      }
      const creatorProfile = db.creator_profiles.find(profile => profile.id === movie.creator_id);
      if (movie.safety_hold || creatorProfile?.safety_restricted || pendingRightsComplaint(db, movie.id)) {
        return void res.status(409).json({ error: 'An unresolved safety or rights hold prevents publication.' });
      }
      if (!movie.rights_review) {
        return void res.status(409).json({ error: 'Independent rights review must be recorded before publication.' });
      }
      if (!movie.rights_attestation && !movie.rights_review.evidence_reference) {
        return void res.status(409).json({ error: 'Legacy movie requires verified original rights evidence.' });
      }
      const fullKey = privateVideoKey(movie.video_url);
      const previewKey = movie.preview_private_key;
      if (!fullKey || !previewKey || !/^previews\/[A-Za-z0-9_-]+\/[a-f0-9-]{32,}\.mp4$/i.test(previewKey)) {
        res.status(409).json({ error: 'Private master video and verified five-minute preview are required before publication.' });
        return;
      }
      try {
        const bucket = privateVideoBucket();
        const [master, preview] = await Promise.all([
          getR2Client().send(new HeadObjectCommand({ Bucket: bucket, Key: fullKey })),
          getR2Client().send(new HeadObjectCommand({ Bucket: bucket, Key: previewKey })),
        ]);
        if (!master.ContentLength || !preview.ContentLength || preview.Metadata?.movieid !== movie.id) {
          res.status(409).json({ error: 'Secure media verification failed; the movie was not published.' });
          return;
        }
      } catch (error) {
        console.error('Failed to verify private media for publication:', error);
        res.status(503).json({ error: 'Private storage is temporarily unavailable. The movie was not published.' });
        return;
      }
    }

    const wasPublished = movie.status === 'published';
    movie.status = action === 'approve' || action === 'publish' ? 'published' : 'rejected';

    const creator = db.creator_profiles.find(cp => cp.id === movie.creator_id);
    const creatorUser = creator ? db.users.find(u => u.id === creator.user_id) : null;

    db.audit_logs.push({
      id: `aud_${uuidv4().substring(0, 8)}`,
      admin_id: req.user!.id,
      admin_name: req.user!.full_name,
      action: `MOVIE_${action.toUpperCase()}`,
      target_type: 'movie',
      target_id: movie.id,
      details: `Movie "${movie.title}" set to ${movie.status}. Notes: ${notes || 'None'}`,
      created_at: new Date().toISOString(),
    });

    if (creatorUser) {
      db.notifications.push({
        id: `notif_${uuidv4().substring(0, 8)}`,
        user_id: creatorUser.id,
        title: action === 'approve' || action === 'publish' ? 'Movie Published!' : 'Movie Moderation Update',
        message:
          action === 'approve' || action === 'publish'
            ? `Your film "${movie.title}" is now published and live on the VisPlay public discovery stream!`
            : `Your film "${movie.title}" was not approved. Feedback: ${notes || 'Please verify metadata and rights.'}`,
        link: `/watch/${movie.id}`,
        is_read: false,
        created_at: new Date().toISOString(),
      });
    }

    // Notify every follower when a creator's film becomes public, including a direct movie link.
    if (movie.status === 'published' && !wasPublished && creator) {
      const followerIds = [...new Set(db.follows.filter(f => f.creator_user_id === creator.id).map(f => f.follower_user_id))];
      for (const followerId of followerIds) {
        if (followerId === creator.user_id) continue;
        db.notifications.push({
          id: `notif_${uuidv4().substring(0, 8)}`,
          user_id: followerId,
          title: `${creator.channel_name} posted a new movie`,
          message: `Now available: "${movie.title}". Tap to watch the 5-minute preview.`,
          link: `/?watch=${encodeURIComponent(movie.id)}`,
          is_read: false,
          created_at: new Date().toISOString(),
        });
      }
    }

    await saveDatabase(db);
    res.json({ success: true, movie: toClientMovie(movie), message: `Movie status set to ${movie.status}.` });
  });

  // Delete a movie: creators may remove only their own movies; super admins may remove any movie.
  app.delete('/api/movies/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const movieIndex = db.movies.findIndex(m => m.id === req.params.id);
    if (movieIndex === -1) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }

    const movie = db.movies[movieIndex];
    const moderationReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const isAdmin = req.user!.role === 'admin';
    const creator = db.creator_profiles.find(cp => cp.id === movie.creator_id);
    const isOwner = Boolean(creator && creator.user_id === req.user!.id);

    if (!isAdmin && !isOwner) {
      res.status(403).json({ error: 'You can only delete movies uploaded to your own creator channel.' });
      return;
    }

    // Purchased access and creator earnings are durable obligations. A rights
    // dispute may unpublish a movie, but cannot silently destroy paid content.
    try {
      const finance = getFinanceStore();
      const sold = await finance.hasPurchasedItem('movie', movie.id) ||
        Boolean(movie.bundle_id && await finance.hasPurchasedItem('bundle', movie.bundle_id));
      if (sold) return void res.status(409).json({ error: 'This movie has paid viewers. Unpublish it and arrange a reviewed refund or rights-transfer plan before permanent deletion.' });
    } catch (error) {
      const mapped = financeErrorResponse(error);
      return void res.status(mapped.status).json({ error: mapped.message });
    }

    // Remove this movie's R2 objects when possible; catalogue deletion still works if cleanup fails.
    try {
      const publicBase = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, '');
      const objectKeys = [movie.video_url, movie.poster_url, movie.backdrop_url]
        .filter((url): url is string => Boolean(publicBase && typeof url === 'string' && url.startsWith(publicBase + '/')))
        .map(url => decodeURIComponent(url.slice(publicBase!.length + 1).split('?')[0]))
        .filter(Boolean);
      const uniqueKeys = [...new Set(objectKeys)];
      if (uniqueKeys.length && isR2Configured()) {
        await getR2Client().send(new DeleteObjectsCommand({ Bucket: MEDIA_BUCKET, Delete: { Objects: uniqueKeys.map(Key => ({ Key })) } }));
      }
      const privateKeys = [privateVideoKey(movie.video_url), movie.preview_private_key].filter((key): key is string => Boolean(key));
      if (privateKeys.length) {
        await getR2Client().send(new DeleteObjectsCommand({
          Bucket: privateVideoBucket(), Delete: { Objects: privateKeys.map(Key => ({ Key })) },
        }));
      }
    } catch (storageError) {
      console.error('Movie media cleanup failed:', storageError);
    }

    db.movies.splice(movieIndex, 1);
    if (db.featured_movie_id === movie.id) {
      db.featured_movie_id = null;
      db.featured_movie_backdrop = null;
    }

    if (isAdmin) {
      db.audit_logs.push({
        id: `aud_${uuidv4().substring(0, 8)}`,
        admin_id: req.user!.id,
        admin_name: req.user!.full_name,
        action: 'DELETE_MOVIE',
        target_type: 'movie',
        target_id: movie.id,
        details: `Removed movie "${movie.title}" from VisPlay for policy or moderation reasons.${moderationReason ? ` Reason: ${moderationReason}` : ''}`,
        created_at: new Date().toISOString(),
      });
      const owner = creator ? db.users.find(u => u.id === creator.user_id) : null;
      if (owner) {
        db.notifications.push({
          id: `notif_${uuidv4().substring(0, 8)}`,
          user_id: owner.id,
          title: 'Movie Removed by VisPlay',
          message: `Your movie "${movie.title}" was removed by the Super Admin for moderation reasons.${moderationReason ? ` Reason: ${moderationReason}` : ''}`,
          is_read: false,
          created_at: new Date().toISOString(),
        });
      }
    }

    // Keep historical purchases, transactions, and creator ledger entries for accounting.
    await saveDatabase(db);
    res.json({ success: true, deleted_movie_id: movie.id, message: 'Movie removed successfully.' });
  });

  // Admin Users List
  app.get('/api/admin/users', requireAdmin, guardedFinancialRead(async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const balances = await getFinanceStore().getBalances(db.users.map(user => user.id));
    const users = db.users.map(({ password_hash: _, supabase_auth_id: _authId, ...u }) => ({
      ...u, wallet_balance: balances.get(u.id) || 0,
    }));
    res.json({ users });
  }));

  // Admin All Financial Transactions
  app.get('/api/admin/transactions', requireAdmin, guardedFinancialRead(async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const [allTransactions, ledger, refundCases] = await Promise.all([
      getFinanceStore().adminTransactions(), getFinanceStore().adminLedger(), getFinanceStore().refundCases(),
    ]);
    const transactions = allTransactions.map(t => {
      const user = db.users.find(u => u.id === t.user_id);
      return {
        ...t,
        user_name: user?.full_name || 'Unknown',
        user_email: user?.email || '',
      };
    });

    res.json({ transactions, ledger: ledger.slice(0, 50), refund_cases: refundCases.filter(refund => refund.status !== 'refunded') });
  }));

  // Admin Audit Logs
  app.get('/api/admin/audit-logs', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    res.json({ audit_logs: db.audit_logs.slice(-100).reverse() });
  });

  // Admin Creator Monthly Payouts
  app.get('/api/admin/payouts', requireAdmin, guardedFinancialRead(async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const payouts = (await getFinanceStore().adminPayouts()).map(p => {
      const creator = db.creator_profiles.find(cp => cp.id === p.creator_id);
      return {
        ...p,
        channel_name: creator?.channel_name || 'Channel',
      };
    });

    res.json({ payouts });
  }));

  // This endpoint records a pending payout request only. It never claims a bank transfer happened.
  app.post('/api/admin/payouts/process', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { creator_id, month_period } = req.body;
    const db = loadDatabase();
    const creator = db.creator_profiles.find(cp => cp.id === creator_id && cp.status === 'approved');
    if (!creator) {
      res.status(404).json({ error: 'Approved creator not found.' });
      return;
    }

    let payout: CreatorPayout;
    try {
      payout = await getFinanceStore().reservePayout(creator_id, typeof month_period === 'string' && month_period.trim()
        ? month_period.trim() : new Date().toLocaleDateString('en-NG', { month: 'long', year: 'numeric' }), req.user!.id);
    } catch (error) {
      const mapped = financeErrorResponse(error);
      return void res.status(mapped.status).json({ error: mapped.message });
    }
    db.audit_logs.push({
      id: `aud_${uuidv4().substring(0, 8)}`,
      admin_id: req.user!.id,
      admin_name: req.user!.full_name,
      action: 'CREATE_PENDING_PAYOUT_REQUEST',
      target_type: 'payout',
      target_id: payout.id,
      details: `Reserved accrued earnings for payout ${payout.id}. No bank transfer was made.`,
      created_at: new Date().toISOString(),
    });

    try { await saveDatabase(db); } catch (error) { console.warn('Pending payout audit-log mirroring failed:', error); }
    res.status(201).json({ success: true, payout, message: `Payout request recorded as pending for ${creator.channel_name}. No bank transfer was sent.` });
  });

  // -------------------------------------------------------------
  // LIVESTREAMS, PREMIERES, REWARDS & ADS
  // -------------------------------------------------------------

  // Legacy creator live streams were arbitrary, unreviewed external URLs.
  // Preserve the old records privately for migration, but do NOT expose them
  // or accept new live content before H provisions an approved moderation-
  // capable live ingestion/relay system and human escalation staff.
  app.get('/api/livestreams', (_req: Request, res: Response) => {
    res.json({ livestreams: [], live_streaming_available: false });
  });
  app.post('/api/livestreams', requireCreator, (_req: AuthenticatedRequest, res: Response) => {
    res.status(503).json({ error: 'Live creator streaming is paused pending monitored ingestion and safety review.' });
  });

  app.get('/api/premieres', (req: Request, res: Response) => {
    const db = loadDatabase();
    const publicIds = new Set(db.movies.filter(publiclyVisibleMovie).map(movie => movie.id));
    res.json({ premieres: db.premieres.filter(premiere => publicIds.has(premiere.movie_id)) });
  });

  // Wallet reward claims are intentionally disabled. Rewards previously credited
  // unearned coins and could be repeatedly claimed to bypass movie payments.
  app.all('/api/rewards', (_req: Request, res: Response) => {
    res.status(410).json({ error: 'Wallet rewards are disabled.' });
  });
  app.all('/api/rewards/*', (_req: Request, res: Response) => {
    res.status(410).json({ error: 'Wallet rewards are disabled.' });
  });

  app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const notifications = db.notifications.filter(n => n.user_id === req.user!.id).reverse();
    res.json({ notifications });
  });

  app.post('/api/notifications/read-all', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    db.notifications.filter(n => n.user_id === req.user!.id).forEach(n => {
      n.is_read = true;
    });
    await saveDatabase(db);
    res.json({ success: true });
  });

  app.get('/api/ads', (req: Request, res: Response) => {
    const db = loadDatabase();
    res.json({ ads: db.ads.filter(a => a.status === 'active') });
  });

  // Reject unexpected file bodies and malformed upload forms with a small
  // public error. Do not return middleware internals or stack traces to users.
  app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/')) return next(error);
    if (res.headersSent) return next(error);
    if (error instanceof AppStateConflictError) {
      return void res.status(409).json({ error: 'Someone updated this item at the same time. Refresh and try again.' });
    }
    const uploadFormError = error instanceof multer.MulterError;
    const badJson = error instanceof SyntaxError && 'body' in error;
    console.warn('VisPlay API request rejected by middleware:', uploadFormError ? error.code : error.name);
    res.status(uploadFormError || badJson ? 400 : 500).json({
      error: uploadFormError ? 'Unexpected file body or oversized form fields. Upload media privately first.' :
        badJson ? 'Malformed JSON request.' : 'The request could not be processed safely.',
    });
  });

  // -------------------------------------------------------------
  // VITE DEV MIDDLEWARE / STATIC PRODUCTION SERVING
  // -------------------------------------------------------------

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎬 VisPlay server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start VisPlay server:', err);
});
