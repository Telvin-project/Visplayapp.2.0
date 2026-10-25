import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import {
  loadDatabase,
  saveDatabase,
  initializeDatabase,
  User,
  CreatorProfile,
  Movie,
  EpisodeBundle,
  WalletTransaction,
  Purchase,
  CreatorLedger,
  CreatorPayout,
  Comment,
  Like,
  Follow,
  ViewingEvent,
  Livestream,
  Premiere,
  Reward,
  AdCampaign,
  AuditLog,
  Notification,
  SUPER_ADMIN_EMAILS,
} from './server/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'visplay-super-secure-jwt-secret-nollywood-2026';
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

// Ensure upload folders exist
const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
const videosDir = path.join(uploadsDir, 'videos');
const postersDir = path.join(uploadsDir, 'posters');
const avatarsDir = path.join(uploadsDir, 'avatars');

[uploadsDir, videosDir, postersDir, avatarsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure Multer for persistent disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, videosDir);
    } else if (file.fieldname === 'avatar') {
      cb(null, avatarsDir);
    } else {
      cb(null, postersDir);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype.startsWith('video/') ? '.mp4' : '.jpg');
    const safeName = `${Date.now()}-${uuidv4().substring(0, 8)}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB limit
});

// Movie media is uploaded directly to Supabase Storage so videos and posters
// survive Render redeploys. The service-role key is server-only.
const movieMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB per file
});

const MEDIA_BUCKET = 'visplay-media';
let mediaBucketReady: Promise<void> | null = null;

function getMediaStorageClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Persistent media storage is not configured on the server.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function ensureMediaBucket() {
  if (!mediaBucketReady) {
    mediaBucketReady = (async () => {
      const client = getMediaStorageClient();
      const { error } = await client.storage.createBucket(MEDIA_BUCKET, {
        public: true,
        fileSizeLimit: 250 * 1024 * 1024,
      });
      if (error && !/already exists/i.test(error.message)) {
        throw new Error('Unable to prepare permanent media storage: ' + error.message);
      }
    })().catch(error => {
      mediaBucketReady = null;
      throw error;
    });
  }
  await mediaBucketReady;
}

async function storeMovieMedia(file: Express.Multer.File, folder: 'videos' | 'posters') {
  await ensureMediaBucket();
  const client = getMediaStorageClient();
  const extension = path.extname(file.originalname) || (folder === 'videos' ? '.mp4' : '.jpg');
  const objectPath = `${folder}/${Date.now()}-${uuidv4()} `.trim() + extension;
  const { error } = await client.storage.from(MEDIA_BUCKET).upload(objectPath, file.buffer, {
    contentType: file.mimetype || (folder === 'videos' ? 'video/mp4' : 'image/jpeg'),
    upsert: false,
    cacheControl: '31536000',
  });
  if (error) throw new Error('Media upload failed: ' + error.message);
  return client.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

// Best-effort migration for legacy uploads: if an old file still exists on the
// Render instance, copy it into durable storage the first time its movie is opened.
async function migrateLegacyMediaUrl(url?: string | null): Promise<string | undefined> {
  if (!url || !url.startsWith('/uploads/')) return url || undefined;
  const relativePath = url.slice('/uploads/'.length);
  const safeParts = relativePath.split('/').filter(part => part && part !== '.' && part !== '..');
  if (safeParts.length < 2) return url;
  const localPath = path.join(uploadsDir, ...safeParts);
  if (!fs.existsSync(localPath)) return url;
  try {
    await ensureMediaBucket();
    const client = getMediaStorageClient();
    const folder = safeParts[0] === 'videos' ? 'videos' : 'posters';
    const fileBuffer = fs.readFileSync(localPath);
    const objectPath = `${folder}/migrated-${path.basename(localPath)}`;
    const { error } = await client.storage.from(MEDIA_BUCKET).upload(objectPath, fileBuffer, {
      contentType: folder === 'videos' ? 'video/mp4' : 'image/jpeg',
      upsert: true,
      cacheControl: '31536000',
    });
    if (error) {
      console.error('Legacy media migration failed:', error.message);
      return url;
    }
    return client.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath).data.publicUrl;
  } catch (error) {
    console.error('Legacy media migration failed:', error);
    return url;
  }
}

export interface AuthenticatedRequest extends Request {
  user?: User;
}

// Authentication Middleware
function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.visplay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    req.user = undefined;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const db = loadDatabase();
    const user = db.users.find(u => u.id === decoded.userId);
    if (user) {
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
  const profile = db.creator_profiles.find(cp => cp.user_id === req.user!.id && cp.status === 'approved');
  if (req.user.role !== 'admin' && !profile) {
    res.status(403).json({ error: 'Approved creator account required.' });
    return;
  }
  next();
}

async function startServer() {
  await initializeDatabase();
  const app = express();

  app.use(express.json());
  app.use(cookieParser());
  app.use(authenticateToken);

  // Serve static assets from public folder
  app.use(express.static(path.join(process.cwd(), 'public')));

  // -------------------------------------------------------------
  // AUTH ROUTES
  // -------------------------------------------------------------

  app.post('/api/auth/register', async (req: Request, res: Response) => {
    const { email, password, full_name, phone } = req.body;
    if (!email || !password || !full_name) {
      res.status(400).json({ error: 'Email, password, and full name are required.' });
      return;
    }

    const db = loadDatabase();
    const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      res.status(409).json({ error: 'An account with this email address already exists.' });
      return;
    }

    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);
    const newUser: User = {
      id: `usr_${uuidv4().substring(0, 8)}`,
      email: email.toLowerCase().trim(),
      password_hash,
      full_name: full_name.trim(),
      avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(full_name)}`,
      role: 'viewer',
      wallet_balance: 0,
      phone: phone?.trim(),
      created_at: new Date().toISOString(),
    };

    db.users.push(newUser);
    await saveDatabase(db);

    const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('visplay_token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const { password_hash: _, ...safeUser } = newUser;
    res.status(201).json({ user: safeUser, token });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const db = loadDatabase();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('visplay_token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const { password_hash: _, ...safeUser } = user;
    res.json({ user: safeUser, token });
  });

  // Supabase Auth Synchronization (Google OAuth & Supabase session sync)
  app.post('/api/auth/supabase-sync', async (req: Request, res: Response) => {
    const { email, full_name, avatar_url } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email is required for Supabase authentication synchronization.' });
      return;
    }

    const cleanEmail = email.toLowerCase().trim();
    const db = loadDatabase();
    let user = db.users.find(u => u.email.toLowerCase() === cleanEmail);
    const isSuperAdmin = SUPER_ADMIN_EMAILS.some(e => e.toLowerCase() === cleanEmail);

    if (!user) {
      // Create new user profile for this Supabase/Google authenticated user
      const role = isSuperAdmin ? 'admin' : 'viewer';

      user = {
        id: `usr_${uuidv4().substring(0, 8)}`,
        email: cleanEmail,
        password_hash: '', // Handled via Supabase OAuth
        full_name: full_name?.trim() || cleanEmail.split('@')[0],
        avatar_url: avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanEmail)}`,
        role: role,
        wallet_balance: 0, // Live accounts always start with zero wallet balance.
        phone: '',
        created_at: new Date().toISOString(),
      };
      db.users.push(user);
    } else {
      // Existing user: ensure super admin role cannot be lost or tampered with
      if (isSuperAdmin) {
        user.role = 'admin';
      }
      if (full_name && !user.full_name) user.full_name = full_name.trim();
      if (avatar_url && (!user.avatar_url || user.avatar_url.includes('dicebear'))) {
        user.avatar_url = avatar_url;
      }
    }

    // Keep creator access attached to the same email if the internal user ID changes.
    let creatorProfile = db.creator_profiles.find(cp => cp.user_id === user!.id) || null;
    if (!creatorProfile) {
      creatorProfile = db.creator_profiles.find(cp => {
        const owner = db.users.find(candidate => candidate.id === cp.user_id);
        return owner?.email?.toLowerCase() === cleanEmail;
      }) || null;
      if (creatorProfile) creatorProfile.user_id = user!.id;
    }
    if (creatorProfile?.status === 'approved' && user.role !== 'admin') {
      user.role = 'creator';
    }

    await saveDatabase(db);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('visplay_token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const { password_hash: _, ...safeUser } = user;
    res.json({ user: safeUser, creator_profile: creatorProfile || null, token });
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

    // Recover approved creator access by email if an internal user ID changed.
    let creatorProfile = db.creator_profiles.find(cp => cp.user_id === freshUser.id) || null;
    if (!creatorProfile) {
      creatorProfile = db.creator_profiles.find(cp => {
        const owner = db.users.find(candidate => candidate.id === cp.user_id);
        return owner?.email?.toLowerCase() === freshUser.email.toLowerCase();
      }) || null;
      if (creatorProfile) creatorProfile.user_id = freshUser.id;
    }
    if (creatorProfile?.status === 'approved' && freshUser.role !== 'admin') {
      freshUser.role = 'creator';
    }
    await saveDatabase(db);
    const { password_hash: _, ...safeUser } = freshUser;
    res.json({ user: safeUser, creator_profile: creatorProfile });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    res.clearCookie('visplay_token');
    res.json({ success: true, message: 'Logged out successfully.' });
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
    const { password_hash: _, ...safeUser } = db.users[userIndex];
    res.json({ user: safeUser, message: 'Profile updated successfully.' });
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

  app.get('/api/creators/my-channel', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const currentUser = db.users.find(u => u.id === req.user!.id);
    // OAuth sync can recreate the internal user ID while the creator profile
    // remains attached to the same email. Resolve that relationship here too.
    const profile = db.creator_profiles.find(cp => cp.user_id === req.user!.id)
      || db.creator_profiles.find(cp => {
        const owner = db.users.find(u => u.id === cp.user_id);
        return Boolean(currentUser?.email && owner?.email?.toLowerCase() === currentUser.email.toLowerCase());
      });
    if (!profile) {
      res.json({ creator_profile: null, stats: null });
      return;
    }

    if (profile.user_id !== req.user!.id) {
      profile.user_id = req.user!.id;
      await saveDatabase(db);
    }

    if (profile.status === 'approved' && currentUser && currentUser.role !== 'admin') {
      currentUser.role = 'creator';
      await saveDatabase(db);
    }

    const movies = db.movies.filter(m => m.creator_id === profile.id);
    const ledger = db.ledger.filter(l => l.creator_id === profile.id);
    const payouts = db.payouts.filter(p => p.creator_id === profile.id);
    const follows = db.follows.filter(f => f.creator_user_id === profile.id);

    const totalViews = movies.reduce((sum, m) => sum + m.views_count, 0);
    const totalPaidUnlocks = movies.reduce((sum, m) => sum + m.paid_unlocks_count, 0);
    const totalEarnings = ledger.reduce((sum, l) => sum + l.creator_share_ngn, 0);
    const totalPaidOut = payouts.filter(p => p.status === 'paid').reduce((sum, p) => sum + p.net_payout_ngn, 0);
    const pendingBalance = totalEarnings - totalPaidOut;

    res.json({
      creator_profile: profile,
      movies,
      stats: {
        total_movies: movies.length,
        total_views: totalViews,
        total_paid_unlocks: totalPaidUnlocks,
        total_earnings_ngn: totalEarnings,
        total_paid_out_ngn: totalPaidOut,
        pending_payout_ngn: Math.max(0, pendingBalance),
        followers_count: follows.length,
      },
      payouts,
      ledger: ledger.slice(-20).reverse(),
    });
  });

  // Public directory of approved creators
  app.get('/api/creators', (req: Request, res: Response) => {
    const db = loadDatabase();
    const approved = db.creator_profiles.filter(cp => cp.status === 'approved');
    const creatorsWithStats = approved.map(cp => {
      const moviesCount = db.movies.filter(m => m.creator_id === cp.id && m.status === 'published').length;
      const followersCount = db.follows.filter(f => f.creator_user_id === cp.id).length;
      return {
        ...cp,
        movies_count: moviesCount,
        followers_count: followersCount,
      };
    });
    res.json({ creators: creatorsWithStats });
  });

  app.get('/api/creators/channel/:id', (req: Request, res: Response) => {
    const db = loadDatabase();
    const profile = db.creator_profiles.find(cp => cp.id === req.params.id);
    if (!profile) {
      res.status(404).json({ error: 'Creator channel not found.' });
      return;
    }

    const movies = db.movies.filter(m => m.creator_id === profile.id && m.status === 'published');
    const followersCount = db.follows.filter(f => f.creator_user_id === profile.id).length;
    res.json({ creator: profile, movies, followers_count: followersCount });
  });

  app.post('/api/creators/follow/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const targetCreatorId = req.params.id;
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
    let movies = db.movies.filter(m => m.status === 'published');

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

    // Check user purchases if logged in
    const userPurchases = req.user
      ? db.purchases.filter(p => p.user_id === req.user!.id).map(p => p.item_id)
      : [];

    const enhanced = movies.map(m => ({
      ...m,
      is_purchased: userPurchases.includes(m.id) || (m.bundle_id && userPurchases.includes(m.bundle_id)),
    }));

    res.json({ movies: enhanced, total: enhanced.length });
  });

  // Public Dynamic Featured Movie (controlled from Super Admin)
  app.get('/api/movies/featured', (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    let movie: Movie | undefined;
    if (db.featured_movie_id) {
      movie = db.movies.find(m => m.id === db.featured_movie_id && m.status === 'published');
    }
    // Fallback if not configured or removed
    if (!movie) {
      movie = db.movies.find(m => m.id === 'mov_lagos_syndicate') || db.movies.find(m => m.status === 'published' && !m.is_bundle_only);
    }

    if (!movie) {
      res.status(404).json({ error: 'No published movies available for hero feature.' });
      return;
    }

    const creator = db.creator_profiles.find(cp => cp.id === movie!.creator_id);
    const isPurchased = req.user
      ? db.purchases.some(p => p.user_id === req.user!.id && (p.item_id === movie!.id || (movie!.bundle_id && p.item_id === movie!.bundle_id))) ||
        req.user.role === 'admin'
      : false;

    res.json({
      movie: {
        ...movie,
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
    const published = db.movies.filter(m => m.status === 'published' && !m.is_bundle_only);
    const userPurchases = req.user ? db.purchases.filter(p => p.user_id === req.user!.id).map(p => p.item_id) : [];

    const enhance = (list: Movie[]) =>
      list.map(m => ({
        ...m,
        is_purchased: userPurchases.includes(m.id) || (m.bundle_id && userPurchases.includes(m.bundle_id)),
      }));

    // Continue Watching from viewing events if user is authenticated
    let continueWatching: Movie[] = [];
    if (req.user) {
      const userEvents = db.viewing_events
        .filter(e => e.user_id === req.user!.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const recentMovieIds = Array.from(new Set(userEvents.map(e => e.movie_id)));
      continueWatching = enhance(db.movies.filter(m => recentMovieIds.includes(m.id)).slice(0, 8));
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
      episodes: db.movies.filter(m => m.bundle_id === b.id),
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

    // Preserve legacy uploads where possible, and persist the migrated URLs.
    const oldVideoUrl = movie.video_url;
    const oldPosterUrl = movie.poster_url;
    const [videoUrl, posterUrl] = await Promise.all([
      migrateLegacyMediaUrl(movie.video_url),
      migrateLegacyMediaUrl(movie.poster_url),
    ]);
    if (videoUrl && videoUrl !== oldVideoUrl) movie.video_url = videoUrl;
    if (posterUrl && posterUrl !== oldPosterUrl) {
      movie.poster_url = posterUrl;
      if (movie.backdrop_url === oldPosterUrl || !movie.backdrop_url) movie.backdrop_url = posterUrl;
    }
    if (movie.video_url !== oldVideoUrl || movie.poster_url !== oldPosterUrl) {
      await saveDatabase(db);
    }

    const creator = db.creator_profiles.find(cp => cp.id === movie.creator_id);
    const likesCount = db.likes.filter(l => l.movie_id === movie.id).length;
    const isLiked = req.user ? db.likes.some(l => l.movie_id === movie.id && l.user_id === req.user!.id) : false;
    
    // Check if user purchased movie or bundle containing movie
    const isPurchased = req.user
      ? db.purchases.some(p =>
          p.user_id === req.user!.id &&
          (p.item_id === movie.id || (movie.bundle_id && p.item_id === movie.bundle_id))
        ) ||
        (creator && creator.user_id === req.user.id) ||
        req.user.role === 'admin'
      : false;

    const isFollowing = req.user && creator
      ? db.follows.some(f => f.follower_user_id === req.user!.id && f.creator_user_id === creator.id)
      : false;

    // Related creator movies
    const related = db.movies.filter(m => m.creator_id === movie.creator_id && m.id !== movie.id && m.status === 'published').slice(0, 4);

    res.json({
      movie: {
        ...movie,
        is_purchased: isPurchased,
        likes_count: likesCount,
        is_liked: isLiked,
      },
      creator,
      is_following: isFollowing,
      related,
    });
  });

  app.get('/api/bundles', (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const userPurchases = req.user ? db.purchases.filter(p => p.user_id === req.user!.id).map(p => p.item_id) : [];

    const bundles = db.bundles.map(b => {
      const episodes = db.movies.filter(m => m.bundle_id === b.id);
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
    const episodes = db.movies.filter(m => m.bundle_id === bundle.id);
    const creator = db.creator_profiles.find(cp => cp.id === bundle.creator_id);
    const isPurchased = req.user ? db.purchases.some(p => p.user_id === req.user!.id && p.item_id === bundle.id) : false;

    res.json({ bundle: { ...bundle, episodes, is_purchased: isPurchased }, creator });
  });

  // Create a short-lived direct-to-Supabase upload URL so large videos do not
  // have to pass through the Render server and its request timeout.
  app.post('/api/movies/upload-url', requireCreator, async (req: AuthenticatedRequest, res: Response) => {
    const { folder, filename, contentType, size } = req.body || {};
    if (folder !== 'videos' && folder !== 'posters') {
      res.status(400).json({ error: 'Invalid upload type.' });
      return;
    }
    const maxSize = folder === 'videos' ? 250 * 1024 * 1024 : 15 * 1024 * 1024;
    if (!Number.isFinite(Number(size)) || Number(size) <= 0 || Number(size) > maxSize) {
      res.status(400).json({ error: folder === 'videos' ? 'Video must be 250MB or smaller.' : 'Poster must be 15MB or smaller.' });
      return;
    }
    try {
      await ensureMediaBucket();
      const client = getMediaStorageClient();
      const safeExtension = path.extname(String(filename || '')).toLowerCase().replace(/[^.a-z0-9]/g, '') || (folder === 'videos' ? '.mp4' : '.jpg');
      const objectPath = `${folder}/${req.user!.id}/${Date.now()}-${uuidv4()}${safeExtension}`;
      const { data, error } = await client.storage.from(MEDIA_BUCKET).createSignedUploadUrl(objectPath);
      if (error || !data) throw error || new Error('Could not create a signed upload URL.');
      res.json({
        uploadUrl: data.signedUrl,
        token: data.token,
        path: data.path || objectPath,
        publicUrl: client.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath).data.publicUrl,
      });
    } catch (error) {
      console.error('Could not prepare direct media upload:', error);
      res.status(503).json({ error: 'Persistent storage is not ready for uploads. Please try again shortly.' });
    }
  });

  // Movie Upload (Creators Only)
  app.post(
    '/api/movies/upload',
    requireCreator,
    movieMediaUpload.fields([
      { name: 'video', maxCount: 1 },
      { name: 'poster', maxCount: 1 },
    ]),
    async (req: AuthenticatedRequest, res: Response) => {
      const { title, synopsis, genre, release_year, rights_confirmed } = req.body;
      if (!title || !synopsis || !genre) {
        res.status(400).json({ error: 'Title, synopsis, and genre are required.' });
        return;
      }
      if (rights_confirmed !== 'true' && rights_confirmed !== true) {
        res.status(400).json({ error: 'You must confirm movie distribution ownership/rights.' });
        return;
      }

      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const videoFile = files?.video?.[0];
      const posterFile = files?.poster?.[0];
      const submittedVideoUrl = typeof req.body.video_url === 'string' ? req.body.video_url : '';
      const submittedPosterUrl = typeof req.body.poster_url === 'string' ? req.body.poster_url : '';
      const publicMediaPrefix = `${(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\\/$/, '')}/storage/v1/object/public/${MEDIA_BUCKET}/`;
      if (submittedVideoUrl && !submittedVideoUrl.startsWith(publicMediaPrefix)) {
        res.status(400).json({ error: 'Invalid video storage URL.' });
        return;
      }
      if (submittedPosterUrl && !submittedPosterUrl.startsWith(publicMediaPrefix)) {
        res.status(400).json({ error: 'Invalid poster storage URL.' });
        return;
      }

      const db = loadDatabase();
      const creatorProfile = db.creator_profiles.find(cp => cp.user_id === req.user!.id);
      if (!creatorProfile && req.user!.role !== 'admin') {
        res.status(403).json({ error: 'Creator channel profile not found.' });
        return;
      }

      const creatorId = creatorProfile ? creatorProfile.id : 'creator_01';
      const creatorName = creatorProfile ? creatorProfile.channel_name : req.user!.full_name;
      const creatorAvatar = creatorProfile ? creatorProfile.channel_avatar_url : req.user!.avatar_url;

      let videoUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4';
      let posterUrl = '/posters/lagos_heist.jpg';

      try {
        if (submittedVideoUrl) videoUrl = submittedVideoUrl;
        else if (videoFile) videoUrl = await storeMovieMedia(videoFile, 'videos');
        if (submittedPosterUrl) posterUrl = submittedPosterUrl;
        else if (posterFile) posterUrl = await storeMovieMedia(posterFile, 'posters');
      } catch (storageError) {
        console.error('Permanent movie media upload failed:', storageError);
        res.status(503).json({
          error: 'The video or poster could not be saved permanently. Please try again later.',
        });
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
        views_count: 0,
        paid_unlocks_count: 0,
        price_ngn: 100, // fixed ₦100
        free_preview_seconds: 300, // fixed 5 mins
        created_at: new Date().toISOString(),
      };

      db.movies.push(newMovie);

      // Notification
      db.notifications.push({
        id: `notif_${uuidv4().substring(0, 8)}`,
        user_id: req.user!.id,
        title: 'Movie Submitted for Moderation',
        message: `"${title}" has entered the VisPlay moderation queue. You will be notified once reviewed.`,
        is_read: false,
        created_at: new Date().toISOString(),
      });

      await saveDatabase(db);
      res.status(201).json({ movie: newMovie, message: 'Movie submitted successfully for review.' });
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

    await saveDatabase(db);
    const totalLikes = db.likes.filter(l => l.movie_id === movieId).length;
    res.json({ is_liked: isLiked, likes_count: totalLikes });
  });

  // Comments
  app.get('/api/movies/:id/comments', (req: Request, res: Response) => {
    const db = loadDatabase();
    const comments = db.comments
      .filter(c => c.movie_id === req.params.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ comments });
  });

  app.post('/api/movies/:id/comments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { comment_text, parent_id } = req.body;
    if (!comment_text || !comment_text.trim()) {
      res.status(400).json({ error: 'Comment text cannot be empty.' });
      return;
    }

    const db = loadDatabase();
    const newComment: Comment = {
      id: `com_${uuidv4().substring(0, 8)}`,
      movie_id: req.params.id,
      user_id: req.user!.id,
      user_name: req.user!.full_name,
      user_avatar: req.user!.avatar_url,
      parent_id: parent_id || null,
      comment_text: comment_text.trim(),
      likes_count: 0,
      created_at: new Date().toISOString(),
    };

    db.comments.push(newComment);
    await saveDatabase(db);
    res.status(201).json({ comment: newComment });
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

  app.get('/api/media/stream/:id', (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const movie = db.movies.find(m => m.id === req.params.id);
    if (!movie) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }

    const isPurchased = req.user
      ? db.purchases.some(
          p =>
            p.user_id === req.user!.id &&
            (p.item_id === movie.id || (movie.bundle_id && p.item_id === movie.bundle_id))
        ) ||
        req.user.role === 'admin' ||
        db.creator_profiles.some(cp => cp.id === movie.creator_id && cp.user_id === req.user!.id)
      : false;

    // Check query token or header
    res.json({
      video_url: movie.video_url,
      is_purchased: isPurchased,
      free_preview_seconds: movie.free_preview_seconds || 300, // 5 mins
      movie_id: movie.id,
      title: movie.title,
    });
  });

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
      if (reached_5_min) event.reached_5_min = true;
      if (completed) event.completed = true;
    }

    await saveDatabase(db);
    res.json({ success: true, views_count: movie.views_count });
  });

  // -------------------------------------------------------------
  // MANDATORY PRICING & REAL PAYMENTS (PAYSTACK / WALLET)
  // ₦100 Movie | ₦700 10-Episode Bundle | 85% Creator / 15% Platform Split
  // -------------------------------------------------------------

  // Initialize wallet deposit with Paystack. Secret keys stay on the server.
  app.post('/api/wallet/deposit/initialize', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const amount = Number(req.body?.amount_ngn);
    if (!Number.isSafeInteger(amount) || amount < 100) {
      res.status(400).json({ error: 'Minimum deposit amount is ₦100.' });
      return;
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      res.status(503).json({ error: 'Paystack is not configured yet. Add PAYSTACK_SECRET_KEY to the backend environment.' });
      return;
    }

    const reference = `VIS_DEP_${Date.now()}_${uuidv4().substring(0, 8).toUpperCase()}`;
    const callbackUrl = process.env.PAYSTACK_CALLBACK_URL || 'https://visplayapp20.vercel.app/';
    try {
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: req.user!.email,
          amount: amount * 100,
          currency: 'NGN',
          reference,
          callback_url: callbackUrl,
          metadata: { user_id: req.user!.id, purpose: 'wallet_deposit' },
        }),
      });
      const result = await response.json() as any;
      if (!response.ok || !result.status || !result.data?.authorization_url) {
        console.error('Paystack initialization failed:', result?.message || response.status);
        res.status(502).json({ error: 'Paystack could not start checkout. Please try again.' });
        return;
      }

      const db = loadDatabase();
      const pendingTx: WalletTransaction = {
        id: `tx_${uuidv4().substring(0, 8)}`,
        user_id: req.user!.id,
        amount_ngn: amount,
        type: 'deposit',
        status: 'pending',
        reference,
        payment_method: 'paystack',
        description: `Wallet Funding (₦${amount.toLocaleString()})`,
        metadata: { paystack_access_code: result.data.access_code },
        created_at: new Date().toISOString(),
      };
      db.transactions.push(pendingTx);
      await saveDatabase(db);
      res.json({ reference, authorization_url: result.data.authorization_url });
    } catch (error) {
      console.error('Paystack initialization error:', error);
      res.status(502).json({ error: 'Unable to connect to Paystack. Please try again.' });
    }
  });

  // Verify against Paystack's server API; never trust a client-supplied reference alone.
  app.post('/api/wallet/deposit/verify', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const reference = String(req.body?.reference || '').trim();
    if (!reference) {
      res.status(400).json({ error: 'Transaction reference is required.' });
      return;
    }
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      res.status(503).json({ error: 'Paystack is not configured on the backend.' });
      return;
    }

    const db = loadDatabase();
    const tx = db.transactions.find(t => t.reference === reference && t.user_id === req.user!.id && t.type === 'deposit');
    if (!tx) {
      res.status(404).json({ error: 'Transaction record not found.' });
      return;
    }
    if (tx.status === 'successful') {
      const currentUser = db.users.find(u => u.id === req.user!.id);
      res.json({ success: true, already_verified: true, wallet_balance: currentUser?.wallet_balance || 0 });
      return;
    }

    try {
      const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      const result = await response.json() as any;
      const payment = result?.data;
      if (!response.ok || !result?.status || payment?.status !== 'success') {
        res.status(402).json({ error: 'Paystack has not confirmed a successful payment yet.' });
        return;
      }
      if (payment.reference !== tx.reference || payment.currency !== 'NGN' || Number(payment.amount) !== tx.amount_ngn * 100 ||
          (payment.metadata?.user_id && payment.metadata.user_id !== req.user!.id)) {
        res.status(400).json({ error: 'Payment details do not match this wallet deposit.' });
        return;
      }

      // Re-check transaction state before crediting to prevent duplicate credits.
      const latestTx = db.transactions.find(t => t.reference === reference && t.user_id === req.user!.id);
      if (!latestTx || latestTx.status === 'successful') {
        const currentUser = db.users.find(u => u.id === req.user!.id);
        res.json({ success: true, already_verified: true, wallet_balance: currentUser?.wallet_balance || 0 });
        return;
      }
      latestTx.status = 'successful';
      const user = db.users.find(u => u.id === req.user!.id);
      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }
      user.wallet_balance = (user.wallet_balance || 0) + latestTx.amount_ngn;
      db.notifications.push({
        id: `notif_${uuidv4().substring(0, 8)}`,
        user_id: user.id,
        title: 'Wallet Funded Successfully',
        message: `₦${latestTx.amount_ngn.toLocaleString()} has been credited to your VisPlay wallet.`,
        is_read: false,
        created_at: new Date().toISOString(),
      });
      await saveDatabase(db);
      res.json({ success: true, wallet_balance: user.wallet_balance, transaction: latestTx });
    } catch (error) {
      console.error('Paystack verification error:', error);
      res.status(502).json({ error: 'Could not verify payment with Paystack. Please retry shortly.' });
    }
  });

  // Purchase Individual Movie (₦100)
  app.post('/api/purchases/buy-movie', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { movie_id } = req.body;
    const db = loadDatabase();
    const movie = db.movies.find(m => m.id === movie_id);
    if (!movie) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }

    // Check if already purchased
    const alreadyPurchased = db.purchases.some(
      p => p.user_id === req.user!.id && (p.item_id === movie.id || (movie.bundle_id && p.item_id === movie.bundle_id))
    );
    if (alreadyPurchased) {
      res.json({ success: true, message: 'You have already purchased this movie.', already_owned: true });
      return;
    }

    const price = movie.price_ngn || 100; // Fixed ₦100
    const user = db.users.find(u => u.id === req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (user.wallet_balance < price) {
      res.status(402).json({
        error: 'Insufficient wallet balance.',
        required_ngn: price,
        current_balance: user.wallet_balance,
        shortfall_ngn: price - user.wallet_balance,
      });
      return;
    }

    // Server-side deduction
    user.wallet_balance -= price;
    const ref = `VIS_PUR_MOV_${Date.now()}_${uuidv4().substring(0, 6).toUpperCase()}`;

    // Record wallet transaction
    const tx: WalletTransaction = {
      id: `tx_${uuidv4().substring(0, 8)}`,
      user_id: user.id,
      amount_ngn: price,
      type: 'purchase',
      status: 'successful',
      reference: ref,
      payment_method: 'wallet',
      description: `Unlocked Movie: "${movie.title}"`,
      metadata: { movie_id: movie.id, title: movie.title },
      created_at: new Date().toISOString(),
    };
    db.transactions.push(tx);

    // Record Purchase
    const purchase: Purchase = {
      id: `pur_${uuidv4().substring(0, 8)}`,
      user_id: user.id,
      item_type: 'movie',
      item_id: movie.id,
      amount_ngn: price,
      reference: ref,
      created_at: new Date().toISOString(),
    };
    db.purchases.push(purchase);

    // Revenue Split: 85% Creator, 15% VisPlay Platform
    const creatorShare = Math.round(price * 0.85); // ₦85
    const platformFee = price - creatorShare;     // ₦15

    const ledgerEntry: CreatorLedger = {
      id: `led_${uuidv4().substring(0, 8)}`,
      creator_id: movie.creator_id,
      purchase_id: purchase.id,
      movie_id: movie.id,
      gross_amount_ngn: price,
      creator_share_ngn: creatorShare,
      platform_fee_ngn: platformFee,
      status: 'accrued',
      created_at: new Date().toISOString(),
    };
    db.ledger.push(ledgerEntry);

    // Update movie stats
    movie.paid_unlocks_count = (movie.paid_unlocks_count || 0) + 1;

    // Update viewing event conversion if present
    const viewing = db.viewing_events.find(v => v.user_id === user.id && v.movie_id === movie.id);
    if (viewing) {
      viewing.converted_to_purchase = true;
    }

    // Notification for viewer
    db.notifications.push({
      id: `notif_${uuidv4().substring(0, 8)}`,
      user_id: user.id,
      title: 'Movie Unlocked!',
      message: `"${movie.title}" is now unlocked for unlimited streaming. Remaining balance: ₦${user.wallet_balance.toLocaleString()}.`,
      link: `/watch/${movie.id}`,
      is_read: false,
      created_at: new Date().toISOString(),
    });

    await saveDatabase(db);
    res.json({
      success: true,
      message: `Unlocked "${movie.title}" for ₦${price}. Enjoy the full movie!`,
      wallet_balance: user.wallet_balance,
      purchase,
      ledger: ledgerEntry,
    });
  });

  // Purchase 10-Episode Bundle (₦700 Total)
  app.post('/api/purchases/buy-bundle', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { bundle_id } = req.body;
    const db = loadDatabase();
    const bundle = db.bundles.find(b => b.id === bundle_id);
    if (!bundle) {
      res.status(404).json({ error: 'Bundle not found.' });
      return;
    }

    // Check if already purchased
    const alreadyPurchased = db.purchases.some(p => p.user_id === req.user!.id && p.item_id === bundle.id);
    if (alreadyPurchased) {
      res.json({ success: true, message: 'You already own this 10-episode bundle.', already_owned: true });
      return;
    }

    const price = bundle.price_ngn || 700; // Fixed ₦700 for all 10 episodes
    const user = db.users.find(u => u.id === req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (user.wallet_balance < price) {
      res.status(402).json({
        error: 'Insufficient wallet balance for 10-episode bundle.',
        required_ngn: price,
        current_balance: user.wallet_balance,
        shortfall_ngn: price - user.wallet_balance,
      });
      return;
    }

    user.wallet_balance -= price;
    const ref = `VIS_PUR_BUN_${Date.now()}_${uuidv4().substring(0, 6).toUpperCase()}`;

    // Wallet transaction
    const tx: WalletTransaction = {
      id: `tx_${uuidv4().substring(0, 8)}`,
      user_id: user.id,
      amount_ngn: price,
      type: 'purchase',
      status: 'successful',
      reference: ref,
      payment_method: 'wallet',
      description: `Unlocked 10-Episode Bundle: "${bundle.title}"`,
      metadata: { bundle_id: bundle.id, episodes_count: bundle.episodes_count },
      created_at: new Date().toISOString(),
    };
    db.transactions.push(tx);

    // Purchase record
    const purchase: Purchase = {
      id: `pur_${uuidv4().substring(0, 8)}`,
      user_id: user.id,
      item_type: 'bundle',
      item_id: bundle.id,
      amount_ngn: price,
      reference: ref,
      created_at: new Date().toISOString(),
    };
    db.purchases.push(purchase);

    // Revenue Split: 85% Creator (₦595), 15% VisPlay (₦105)
    const creatorShare = Math.round(price * 0.85); // ₦595
    const platformFee = price - creatorShare;     // ₦105

    const ledgerEntry: CreatorLedger = {
      id: `led_${uuidv4().substring(0, 8)}`,
      creator_id: bundle.creator_id,
      purchase_id: purchase.id,
      bundle_id: bundle.id,
      gross_amount_ngn: price,
      creator_share_ngn: creatorShare,
      platform_fee_ngn: platformFee,
      status: 'accrued',
      created_at: new Date().toISOString(),
    };
    db.ledger.push(ledgerEntry);

    // Unlock all 10 episodes
    const episodes = db.movies.filter(m => m.bundle_id === bundle.id);
    episodes.forEach(ep => {
      ep.paid_unlocks_count = (ep.paid_unlocks_count || 0) + 1;
    });

    // Notification
    db.notifications.push({
      id: `notif_${uuidv4().substring(0, 8)}`,
      user_id: user.id,
      title: '10-Episode Bundle Unlocked!',
      message: `All 10 episodes of "${bundle.title}" are now unlocked for unlimited viewing! Remaining balance: ₦${user.wallet_balance.toLocaleString()}.`,
      link: `/bundle/${bundle.id}`,
      is_read: false,
      created_at: new Date().toISOString(),
    });

    await saveDatabase(db);
    res.json({
      success: true,
      message: `Unlocked all 10 episodes of "${bundle.title}" for ₦${price}!`,
      wallet_balance: user.wallet_balance,
      purchase,
      ledger: ledgerEntry,
    });
  });

  // User Dashboard: Transactions & Purchased Movies
  app.get('/api/user/library', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const purchases = db.purchases.filter(p => p.user_id === req.user!.id);
    const movieIds = purchases.filter(p => p.item_type === 'movie').map(p => p.item_id);
    const bundleIds = purchases.filter(p => p.item_type === 'bundle').map(p => p.item_id);

    // Include movies purchased individually + movies in purchased bundles
    const movies = db.movies.filter(m => movieIds.includes(m.id) || (m.bundle_id && bundleIds.includes(m.bundle_id)));
    const bundles = db.bundles.filter(b => bundleIds.includes(b.id));
    const transactions = db.transactions.filter(t => t.user_id === req.user!.id).reverse();
    const followedCreators = db.follows
      .filter(f => f.follower_user_id === req.user!.id)
      .map(f => db.creator_profiles.find(cp => cp.id === f.creator_user_id))
      .filter(Boolean);

    res.json({
      movies,
      bundles,
      transactions,
      followed_creators: followedCreators,
      wallet_balance: req.user!.wallet_balance,
    });
  });

  // -------------------------------------------------------------
  // SUPER ADMIN DASHBOARD ROUTES
  // -------------------------------------------------------------

  app.get('/api/admin/metrics', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const totalUsers = db.users.length;
    const totalCreators = db.creator_profiles.filter(cp => cp.status === 'approved').length;
    const pendingApplications = db.creator_profiles.filter(cp => cp.status === 'pending').length;
    const totalMovies = db.movies.length;
    const pendingMovies = db.movies.filter(m => m.status === 'pending').length;
    const publishedMovies = db.movies.filter(m => m.status === 'published').length;

    const totalViews = db.movies.reduce((sum, m) => sum + (m.views_count || 0), 0);
    const totalPaidUnlocks = db.movies.reduce((sum, m) => sum + (m.paid_unlocks_count || 0), 0);

    const grossSales = db.ledger.reduce((sum, l) => sum + l.gross_amount_ngn, 0);
    const totalCreatorShare = db.ledger.reduce((sum, l) => sum + l.creator_share_ngn, 0); // 85%
    const totalPlatformRevenue = db.ledger.reduce((sum, l) => sum + l.platform_fee_ngn, 0); // 15%

    const totalWalletDeposits = db.transactions
      .filter(t => t.type === 'deposit' && t.status === 'successful')
      .reduce((sum, t) => sum + t.amount_ngn, 0);

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
        total_paid_unlocks: totalPaidUnlocks,
        gross_sales_ngn: grossSales,
        creator_share_ngn: totalCreatorShare,
        platform_revenue_ngn: totalPlatformRevenue,
        wallet_deposits_ngn: totalWalletDeposits,
      },
      viewing_stats: viewingStats,
    });
  });

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
  app.get('/api/admin/movies', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const moviesWithFinancials = db.movies.map(m => {
      const moviePurchases = db.purchases.filter(p => p.item_id === m.id);
      const grossSales = moviePurchases.length * m.price_ngn;
      const creatorShare = Math.round(grossSales * 0.85);
      const platformFee = grossSales - creatorShare;
      const events = db.viewing_events.filter(e => e.movie_id === m.id);

      return {
        ...m,
        milestones_5min: events.filter(e => e.reached_5_min).length,
        completed_watches: events.filter(e => e.completed).length,
        gross_sales_ngn: grossSales,
        creator_share_ngn: creatorShare,
        platform_fee_ngn: platformFee,
      };
    }).reverse();

    res.json({ movies: moviesWithFinancials });
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

    await saveDatabase(db);
    res.json({ success: true, movie, message: `Movie status set to ${movie.status}.` });
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

    // Remove uploaded files from persistent storage when they are Supabase Storage URLs.
    // Older /uploads files may already be missing from Render's temporary filesystem.
    try {
      const client = getMediaStorageClient();
      const objectPaths = [movie.video_url, movie.poster_url, movie.backdrop_url]
        .filter((url): url is string => typeof url === 'string' && url.includes('/storage/v1/object/public/' + MEDIA_BUCKET + '/'))
        .map(url => decodeURIComponent(url.split('/storage/v1/object/public/' + MEDIA_BUCKET + '/')[1].split('?')[0]))
        .filter(Boolean);
      const uniquePaths = [...new Set(objectPaths)];
      if (uniquePaths.length) {
        const { error } = await client.storage.from(MEDIA_BUCKET).remove(uniquePaths);
        if (error) console.error('Could not remove one or more movie media objects:', error.message);
      }
    } catch (storageError) {
      // Deletion from the catalogue must still be possible if storage cleanup is unavailable.
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
  app.get('/api/admin/users', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const users = db.users.map(({ password_hash: _, ...u }) => u);
    res.json({ users });
  });

  // Admin All Financial Transactions
  app.get('/api/admin/transactions', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const transactions = db.transactions.map(t => {
      const user = db.users.find(u => u.id === t.user_id);
      return {
        ...t,
        user_name: user?.full_name || 'Unknown',
        user_email: user?.email || '',
      };
    }).reverse();

    res.json({ transactions, ledger: db.ledger.slice(-50).reverse() });
  });

  // Admin Audit Logs
  app.get('/api/admin/audit-logs', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    res.json({ audit_logs: db.audit_logs.slice(-100).reverse() });
  });

  // Admin Creator Monthly Payouts
  app.get('/api/admin/payouts', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const payouts = db.payouts.map(p => {
      const creator = db.creator_profiles.find(cp => cp.id === p.creator_id);
      return {
        ...p,
        channel_name: creator?.channel_name || 'Channel',
      };
    }).reverse();

    res.json({ payouts });
  });

  app.post('/api/admin/payouts/process', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { creator_id, month_period } = req.body;
    const db = loadDatabase();
    const creator = db.creator_profiles.find(cp => cp.id === creator_id);
    if (!creator) {
      res.status(404).json({ error: 'Creator not found.' });
      return;
    }

    const accruedLedger = db.ledger.filter(l => l.creator_id === creator_id && l.status === 'accrued');
    if (accruedLedger.length === 0) {
      res.status(400).json({ error: 'No accrued earnings to disburse for this creator.' });
      return;
    }

    const grossTotal = accruedLedger.reduce((sum, l) => sum + l.gross_amount_ngn, 0);
    const platformFee = accruedLedger.reduce((sum, l) => sum + l.platform_fee_ngn, 0);
    const netPayout = accruedLedger.reduce((sum, l) => sum + l.creator_share_ngn, 0);

    const payout: CreatorPayout = {
      id: `pay_${uuidv4().substring(0, 8)}`,
      creator_id,
      month_period: month_period || 'Current Month',
      total_earnings_ngn: grossTotal,
      platform_fee_ngn: platformFee,
      net_payout_ngn: netPayout,
      status: 'paid',
      bank_name: 'Zenith Bank PLC',
      account_number: '2081234567',
      account_name: creator.channel_name,
      paid_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    db.payouts.push(payout);
    accruedLedger.forEach(l => {
      l.status = 'paid';
      l.payout_id = payout.id;
    });

    db.audit_logs.push({
      id: `aud_${uuidv4().substring(0, 8)}`,
      admin_id: req.user!.id,
      admin_name: req.user!.full_name,
      action: 'PROCESS_CREATOR_PAYOUT',
      target_type: 'payout',
      target_id: payout.id,
      details: `Processed ₦${netPayout.toLocaleString()} net payout (85% of ₦${grossTotal.toLocaleString()}) to ${creator.channel_name}.`,
      created_at: new Date().toISOString(),
    });

    await saveDatabase(db);
    res.json({ success: true, payout, message: `Disbursed ₦${netPayout.toLocaleString()} to ${creator.channel_name}.` });
  });

  // -------------------------------------------------------------
  // LIVESTREAMS, PREMIERES, REWARDS & ADS
  // -------------------------------------------------------------

  app.get('/api/livestreams', (req: Request, res: Response) => {
    const db = loadDatabase();
    res.json({ livestreams: db.livestreams });
  });

  app.post('/api/livestreams', requireCreator, async (req: AuthenticatedRequest, res: Response) => {
    const { title, description, scheduled_at, stream_url } = req.body;
    if (!title) {
      res.status(400).json({ error: 'Livestream title is required.' });
      return;
    }

    const db = loadDatabase();
    const creator = db.creator_profiles.find(cp => cp.user_id === req.user!.id);
    const newStream: Livestream = {
      id: `live_${uuidv4().substring(0, 8)}`,
      creator_id: creator ? creator.id : 'creator_01',
      creator_name: creator ? creator.channel_name : req.user!.full_name,
      creator_avatar: creator ? creator.channel_avatar_url : req.user!.avatar_url,
      title: title.trim(),
      description: description ? description.trim() : '',
      scheduled_at: scheduled_at || new Date().toISOString(),
      status: 'live',
      stream_url: stream_url || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      viewer_count: 1,
      created_at: new Date().toISOString(),
    };

    db.livestreams.unshift(newStream);
    await saveDatabase(db);
    res.status(201).json({ livestream: newStream });
  });

  app.get('/api/premieres', (req: Request, res: Response) => {
    const db = loadDatabase();
    res.json({ premieres: db.premieres });
  });

  app.get('/api/rewards', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = loadDatabase();
    const rewards = db.rewards.filter(r => r.user_id === req.user!.id);
    const totalPoints = rewards.reduce((sum, r) => sum + r.points, 0);
    const totalNairaEarned = rewards.reduce((sum, r) => sum + r.naira_equivalent, 0);

    res.json({ rewards, total_points: totalPoints, total_naira_equivalent: totalNairaEarned });
  });

  app.post('/api/rewards/claim', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { reward_type, points, reason } = req.body;
    const pts = parseInt(points, 10) || 100;
    const naira = Math.floor(pts / 5); // 100 pts = ₦20 coins

    const db = loadDatabase();
    const user = db.users.find(u => u.id === req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const newReward: Reward = {
      id: `rew_${uuidv4().substring(0, 8)}`,
      user_id: user.id,
      reward_type: reward_type || 'watch_bonus',
      points: pts,
      naira_equivalent: naira,
      reason: reason || 'Nollywood Watch Time Streak Bonus',
      created_at: new Date().toISOString(),
    };
    db.rewards.push(newReward);

    // Credit coins directly to wallet
    user.wallet_balance += naira;

    db.transactions.push({
      id: `tx_${uuidv4().substring(0, 8)}`,
      user_id: user.id,
      amount_ngn: naira,
      type: 'earning',
      status: 'successful',
      reference: `VIS_REW_${Date.now()}`,
      payment_method: 'wallet',
      description: `Claimed Reward Coins: ${newReward.reason}`,
      created_at: new Date().toISOString(),
    });

    await saveDatabase(db);
    res.json({ success: true, reward: newReward, wallet_balance: user.wallet_balance });
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
