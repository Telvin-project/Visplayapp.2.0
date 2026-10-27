import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  avatar_url: string;
  role: 'viewer' | 'creator' | 'admin';
  wallet_balance: number;
  phone?: string;
  created_at: string;
}

export interface CreatorProfile {
  id: string;
  user_id: string;
  channel_name: string;
  content_type: string;
  description: string;
  channel_banner_url: string;
  channel_avatar_url: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  reviewed_at?: string;
  review_notes?: string;
}

export interface Movie {
  id: string;
  creator_id: string; // references CreatorProfile.id
  creator_name?: string;
  creator_avatar?: string;
  title: string;
  synopsis: string;
  genre: string;
  release_year: number;
  duration_seconds: number;
  poster_url: string;
  backdrop_url: string;
  video_url: string;
  is_bundle_only: boolean;
  bundle_id?: string;
  episode_number?: number;
  status: 'pending' | 'approved' | 'rejected' | 'published';
  views_count: number;
  paid_unlocks_count: number;
  price_ngn: number; // Always 100
  free_preview_seconds: number; // Always 300 (5 mins)
  created_at: string;
}

export interface EpisodeBundle {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  poster_url: string;
  price_ngn: number; // Always 700
  episodes_count: number; // 10
  status: 'approved' | 'pending';
  created_at: string;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  amount_ngn: number;
  type: 'deposit' | 'purchase' | 'earning' | 'payout';
  status: 'successful' | 'pending' | 'failed';
  reference: string;
  payment_method: 'paystack' | 'flutterwave' | 'wallet';
  description: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface Purchase {
  id: string;
  user_id: string;
  item_type: 'movie' | 'bundle';
  item_id: string;
  amount_ngn: number;
  reference: string;
  created_at: string;
}

export interface CreatorLedger {
  id: string;
  creator_id: string;
  purchase_id: string;
  movie_id?: string;
  bundle_id?: string;
  gross_amount_ngn: number;
  creator_share_ngn: number; // 85%
  platform_fee_ngn: number; // 15%
  status: 'accrued' | 'paid';
  payout_id?: string;
  created_at: string;
}

export interface CreatorPayout {
  id: string;
  creator_id: string;
  month_period: string;
  total_earnings_ngn: number;
  platform_fee_ngn: number;
  net_payout_ngn: number;
  status: 'pending' | 'processed' | 'paid';
  bank_name: string;
  account_number: string;
  account_name: string;
  paid_at?: string;
  created_at: string;
}

export interface Comment {
  id: string;
  movie_id: string;
  user_id: string;
  user_name: string;
  user_avatar: string;
  parent_id?: string | null;
  comment_text: string;
  likes_count: number;
  created_at: string;
  updated_at?: string;
}

export interface Like {
  id: string;
  movie_id: string;
  user_id: string;
  created_at: string;
}

export interface Follow {
  id: string;
  follower_user_id: string;
  creator_user_id: string; // creator profile id or user id
  created_at: string;
}

export interface ViewingEvent {
  id: string;
  user_id?: string | null;
  movie_id: string;
  session_id: string;
  duration_watched_seconds: number;
  last_position_seconds?: number;
  reached_5_min: boolean;
  completed: boolean;
  converted_to_purchase: boolean;
  ip_hash: string;
  created_at: string;
}

export interface Livestream {
  id: string;
  creator_id: string;
  creator_name: string;
  creator_avatar: string;
  title: string;
  description: string;
  scheduled_at: string;
  status: 'scheduled' | 'live' | 'ended';
  stream_url: string;
  viewer_count: number;
  created_at: string;
}

export interface Premiere {
  id: string;
  movie_id: string;
  movie_title: string;
  movie_poster: string;
  creator_name: string;
  scheduled_for: string;
  is_active: boolean;
  created_at: string;
}

export interface Reward {
  id: string;
  user_id: string;
  reward_type: string;
  points: number;
  naira_equivalent: number;
  reason: string;
  created_at: string;
}

export interface AdCampaign {
  id: string;
  business_name: string;
  title: string;
  media_url: string;
  click_url: string;
  target_genre?: string;
  impressions: number;
  clicks: number;
  status: 'active' | 'paused';
  created_at: string;
}

export interface AuditLog {
  id: string;
  admin_id: string;
  admin_name: string;
  action: string;
  target_type: string;
  target_id: string;
  details: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  link?: string;
  is_read: boolean;
  created_at: string;
}

export interface DatabaseSchema {
  users: User[];
  creator_profiles: CreatorProfile[];
  movies: Movie[];
  bundles: EpisodeBundle[];
  transactions: WalletTransaction[];
  purchases: Purchase[];
  ledger: CreatorLedger[];
  payouts: CreatorPayout[];
  comments: Comment[];
  likes: Like[];
  follows: Follow[];
  viewing_events: ViewingEvent[];
  livestreams: Livestream[];
  premieres: Premiere[];
  rewards: Reward[];
  ads: AdCampaign[];
  audit_logs: AuditLog[];
  notifications: Notification[];
  featured_movie_id?: string | null;
  featured_movie_backdrop?: string | null;
  demo_balances_cleared?: boolean;
}

const DB_FILE = path.join(process.cwd(), 'data', 'visplay_db.json');
const SUPABASE_TABLE = 'visplay_app_state';

let dbCache: DatabaseSchema | null = null;
let supabaseClient: ReturnType<typeof createClient> | null = null;
let persistenceQueue: Promise<void> = Promise.resolve();

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  supabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

/**
 * Remove the matching Supabase Auth identity using the server-only service-role client.
 * Returns false when the email has no Supabase Auth identity (e.g. a local-password account).
 */
export async function deleteSupabaseAuthUserByEmail(email: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Supabase admin access is not configured; account deletion cannot be completed safely.');
    }
    return false;
  }

  const targetEmail = email.trim().toLowerCase();
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('Could not verify the Supabase account for deletion: ' + error.message);
    const match = data.users.find(user => user.email?.toLowerCase() === targetEmail);
    if (match) {
      const { error: deleteError } = await client.auth.admin.deleteUser(match.id);
      if (deleteError) throw new Error('Could not delete the Supabase sign-in identity: ' + deleteError.message);
      return true;
    }
    if (data.users.length < 1000) return false;
  }
  throw new Error('Could not safely locate the Supabase account for deletion.');
}

/**
 * Verify a Supabase access token against Supabase Auth before trusting any client identity claims.
 * Uses the server-only service-role client; never expose this credential to the browser.
 */
export async function verifySupabaseAccessToken(accessToken: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase server authentication is not configured.');
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) throw new Error('Supabase access token is invalid or expired.');
  if (!data.user.email || !data.user.email_confirmed_at) {
    throw new Error('A verified email address is required for Google sign-in.');
  }
  return data.user;
}

/** Load the complete application state before accepting requests. */
export async function initializeDatabase(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY; refusing to start without persistent storage.');
    }
    if (fs.existsSync(DB_FILE)) {
      dbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as DatabaseSchema;
    } else {
      dbCache = getInitialSeed();
      saveLocalDatabase(dbCache);
    }
    return;
  }

  const { data: row, error } = await client.from(SUPABASE_TABLE).select('data').eq('id', 'main').maybeSingle();
  if (error) throw new Error('Unable to load VisPlay state from Supabase: ' + error.message);

  if (row?.data) {
    const state = row.data as DatabaseSchema;
    if (!state.users || !state.creator_profiles || !state.movies || !state.transactions) {
      throw new Error('Supabase VisPlay state has an unexpected format; refusing to overwrite it.');
    }
    dbCache = state;
    return;
  }

  // First migration: preserve an existing local database exactly as found.
  // In production, never replace missing data with demo seed data.
  if (fs.existsSync(DB_FILE)) {
    try {
      dbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as DatabaseSchema;
    } catch {
      throw new Error('The existing local VisPlay database could not be read. Refusing to seed over it.');
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('Supabase storage is empty and no local database snapshot exists. Refusing to create demo data in production.');
  } else {
    dbCache = getInitialSeed();
  }

  if (!dbCache) throw new Error('VisPlay database state was not initialized.');
  const { error: writeError } = await client.from(SUPABASE_TABLE).upsert({
    id: 'main', data: dbCache, updated_at: new Date().toISOString(),
  });
  if (writeError) throw new Error('Unable to migrate the existing VisPlay database to Supabase: ' + writeError.message);
}

export function loadDatabase(): DatabaseSchema {
  if (!dbCache) throw new Error('VisPlay database has not been initialized. Await initializeDatabase() before serving requests.');
  return dbCache;
}

function saveLocalDatabase(data: DatabaseSchema): void {
  if (!fs.existsSync(path.dirname(DB_FILE))) fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tempPath = `${DB_FILE}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, DB_FILE);
}

export async function saveDatabase(data: DatabaseSchema): Promise<void> {
  dbCache = data;
  const client = getSupabaseClient();
  if (!client) {
    saveLocalDatabase(data);
    return;
  }
  const snapshot = JSON.parse(JSON.stringify(data)) as DatabaseSchema;
  persistenceQueue = persistenceQueue.then(async () => {
    const { error } = await client.from(SUPABASE_TABLE).upsert({
      id: 'main', data: snapshot, updated_at: new Date().toISOString(),
    });
    if (error) throw new Error('Unable to save VisPlay state to Supabase: ' + error.message);
  });
  await persistenceQueue;
}

export const SUPER_ADMIN_EMAILS = [
  'usitakatelvin@gmail.com',
  'talk2visibyl@gmail.com',
];

function getInitialSeed(): DatabaseSchema {
  const salt = bcrypt.genSaltSync(10);
  const adminPass = bcrypt.hashSync('admin123', salt);
  const creatorPass = bcrypt.hashSync('creator123', salt);
  const viewerPass = bcrypt.hashSync('viewer123', salt);

  const superAdminTelvin: User = {
    id: 'user_admin_telvin',
    email: 'usitakatelvin@gmail.com',
    password_hash: adminPass,
    full_name: 'Kelvin Usitaka',
    avatar_url: '/visplay-symbol.png',
    role: 'admin',
    wallet_balance: 0,
    phone: '+2348012345678',
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const adminUser: User = {
    id: 'user_admin_01',
    email: 'talk2visibyl@gmail.com',
    password_hash: adminPass,
    full_name: 'Visibyl Admin Superuser',
    avatar_url: '/visplay-symbol.png',
    role: 'admin',
    wallet_balance: 0,
    phone: '+2348012345678',
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const creatorUser1: User = {
    id: 'user_creator_01',
    email: 'kunle@nollywood.ng',
    password_hash: creatorPass,
    full_name: 'Kunle Afolayan',
    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    role: 'creator',
    wallet_balance: 0,
    phone: '+2348023456789',
    created_at: new Date('2026-01-10T00:00:00Z').toISOString(),
  };

  const creatorProfile1: CreatorProfile = {
    id: 'creator_01',
    user_id: creatorUser1.id,
    channel_name: 'Golden Effects Cinema',
    content_type: 'Action & Crime Thrillers',
    description: 'Premier Nollywood auteur delivering authentic Lagos stories, high-stakes action, and gripping cinematography.',
    channel_banner_url: '/posters/lagos_heist.jpg',
    channel_avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    status: 'approved',
    submitted_at: new Date('2026-01-10T00:00:00Z').toISOString(),
    reviewed_at: new Date('2026-01-11T00:00:00Z').toISOString(),
    review_notes: 'Verified renowned Nollywood filmmaker portfolio.',
  };

  const creatorUser2: User = {
    id: 'user_creator_02',
    email: 'nneka@cinematique.africa',
    password_hash: creatorPass,
    full_name: 'Nneka Adebayo',
    avatar_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    role: 'creator',
    wallet_balance: 0,
    phone: '+2348034567890',
    created_at: new Date('2026-01-15T00:00:00Z').toISOString(),
  };

  const creatorProfile2: CreatorProfile = {
    id: 'creator_02',
    user_id: creatorUser2.id,
    channel_name: 'Heritage Screenworks',
    content_type: 'Epic & Royal Historical Dramas',
    description: 'Exploring ancient African dynasties, cultural folklore, and royal sagas from Benin to Ile-Ife.',
    channel_banner_url: '/posters/royal_throne.jpg',
    channel_avatar_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    status: 'approved',
    submitted_at: new Date('2026-01-15T00:00:00Z').toISOString(),
    reviewed_at: new Date('2026-01-16T00:00:00Z').toISOString(),
    review_notes: 'Approved for historical production excellence.',
  };

  const creatorUser3: User = {
    id: 'user_creator_03',
    email: 'tope@lagoslove.tv',
    password_hash: creatorPass,
    full_name: 'Tope Agro',
    avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    role: 'creator',
    wallet_balance: 0,
    phone: '+2348045678901',
    created_at: new Date('2026-02-01T00:00:00Z').toISOString(),
  };

  const creatorProfile3: CreatorProfile = {
    id: 'creator_03',
    user_id: creatorUser3.id,
    channel_name: 'Lagos Island Studios',
    content_type: 'Romance & Contemporary Drama',
    description: 'Modern African romance, relationships, and urban coastal narratives set across Lagos, Accra, and London.',
    channel_banner_url: '/posters/sunset_elegushi.jpg',
    channel_avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    status: 'approved',
    submitted_at: new Date('2026-02-01T00:00:00Z').toISOString(),
    reviewed_at: new Date('2026-02-02T00:00:00Z').toISOString(),
    review_notes: 'Active creator profile.',
  };

  const viewerUser: User = {
    id: 'user_viewer_01',
    email: 'viewer@visplay.ng',
    password_hash: viewerPass,
    full_name: 'Chidi Okafor',
    avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    role: 'viewer',
    wallet_balance: 0, // ₦1,500 test balance
    phone: '+2348056789012',
    created_at: new Date('2026-02-10T00:00:00Z').toISOString(),
  };

  // Movies
  const movie1: Movie = {
    id: 'mov_lagos_syndicate',
    creator_id: creatorProfile1.id,
    creator_name: creatorProfile1.channel_name,
    creator_avatar: creatorProfile1.channel_avatar_url,
    title: 'Lagos Midnight Syndicate',
    synopsis: 'When a heist on the Lekki-Ikoyi corridor goes awry, an undercover detective must infiltrate an elite cartel controlling the dark economy of Lagos Island before midnight.',
    genre: 'Action & Crime',
    release_year: 2024,
    duration_seconds: 6420, // 1h 47m
    poster_url: '/posters/lagos_heist.jpg',
    backdrop_url: '/posters/lagos_heist.jpg',
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    is_bundle_only: false,
    status: 'published',
    views_count: 1420,
    paid_unlocks_count: 312,
    price_ngn: 100,
    free_preview_seconds: 300,
    created_at: new Date('2026-01-20T00:00:00Z').toISOString(),
  };

  const movie2: Movie = {
    id: 'mov_olori_crown',
    creator_id: creatorProfile2.id,
    creator_name: creatorProfile2.channel_name,
    creator_avatar: creatorProfile2.channel_avatar_url,
    title: 'Olori: Crown of Ancestors',
    synopsis: 'In the 16th century Benin Kingdom, Queen Regent Idia must defend the throne against palace conspirators, foreign invaders, and divine prophecies to preserve royal lineage.',
    genre: 'Historical & Epic',
    release_year: 2024,
    duration_seconds: 7140, // 1h 59m
    poster_url: '/posters/royal_throne.jpg',
    backdrop_url: '/posters/royal_throne.jpg',
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    is_bundle_only: false,
    status: 'published',
    views_count: 980,
    paid_unlocks_count: 245,
    price_ngn: 100,
    free_preview_seconds: 300,
    created_at: new Date('2026-01-25T00:00:00Z').toISOString(),
  };

  const movie3: Movie = {
    id: 'mov_sunset_elegushi',
    creator_id: creatorProfile3.id,
    creator_name: creatorProfile3.channel_name,
    creator_avatar: creatorProfile3.channel_avatar_url,
    title: 'Sunset at Elegushi',
    synopsis: 'Two strangers find their worlds colliding over a shared secret along the sands of Elegushi beach, testing the limits of love, loyalty, and ambition in vibrant modern Lagos.',
    genre: 'Romance & Drama',
    release_year: 2025,
    duration_seconds: 5880, // 1h 38m
    poster_url: '/posters/sunset_elegushi.jpg',
    backdrop_url: '/posters/sunset_elegushi.jpg',
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    is_bundle_only: false,
    status: 'published',
    views_count: 1840,
    paid_unlocks_count: 420,
    price_ngn: 100,
    free_preview_seconds: 300,
    created_at: new Date('2026-02-05T00:00:00Z').toISOString(),
  };

  const movie4: Movie = {
    id: 'mov_abuja_cipher',
    creator_id: creatorProfile1.id,
    creator_name: creatorProfile1.channel_name,
    creator_avatar: creatorProfile1.channel_avatar_url,
    title: 'The Abuja Cipher',
    synopsis: 'An intelligence analyst in the Federal Capital Territory uncovers an encrypted digital backdoor threatening the continent’s central financial switchboard.',
    genre: 'Sci-Fi & Thriller',
    release_year: 2025,
    duration_seconds: 6180, // 1h 43m
    poster_url: '/posters/abuja_cipher.jpg',
    backdrop_url: '/posters/abuja_cipher.jpg',
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    is_bundle_only: false,
    status: 'published',
    views_count: 730,
    paid_unlocks_count: 188,
    price_ngn: 100,
    free_preview_seconds: 300,
    created_at: new Date('2026-02-12T00:00:00Z').toISOString(),
  };

  const movie5: Movie = {
    id: 'mov_oga_landlord',
    creator_id: creatorProfile3.id,
    creator_name: creatorProfile3.channel_name,
    creator_avatar: creatorProfile3.channel_avatar_url,
    title: 'Oga Landlord in Lekki',
    synopsis: 'A cunning real estate mogul finds himself in hot water when he rents the same luxury Lekki penthouse to three eccentric Nigerian families on the same weekend.',
    genre: 'Comedy',
    release_year: 2025,
    duration_seconds: 5520, // 1h 32m
    poster_url: '/posters/sunset_elegushi.jpg',
    backdrop_url: '/posters/sunset_elegushi.jpg',
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    is_bundle_only: false,
    status: 'published',
    views_count: 2210,
    paid_unlocks_count: 512,
    price_ngn: 100,
    free_preview_seconds: 300,
    created_at: new Date('2026-02-14T00:00:00Z').toISOString(),
  };

  const movie6: Movie = {
    id: 'mov_whispers_shrine',
    creator_id: creatorProfile2.id,
    creator_name: creatorProfile2.channel_name,
    creator_avatar: creatorProfile2.channel_avatar_url,
    title: 'Whispers of the Ancient Shrine',
    synopsis: 'When an archaeological excavation unearths a sacred relic in Edo state, paranormal events grip a quiet university town as ancient spirits demand their stolen tribute.',
    genre: 'Horror',
    release_year: 2024,
    duration_seconds: 6120, // 1h 42m
    poster_url: '/posters/royal_throne.jpg',
    backdrop_url: '/posters/royal_throne.jpg',
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    is_bundle_only: false,
    status: 'published',
    views_count: 890,
    paid_unlocks_count: 175,
    price_ngn: 100,
    free_preview_seconds: 300,
    created_at: new Date('2026-01-28T00:00:00Z').toISOString(),
  };

  const movie7: Movie = {
    id: 'mov_river_echoes',
    creator_id: creatorProfile2.id,
    creator_name: creatorProfile2.channel_name,
    creator_avatar: creatorProfile2.channel_avatar_url,
    title: 'Echoes of the River Niger',
    synopsis: 'A heartfelt Nollywood family chronicle following three generations navigating cultural traditions, modern education, and oil rights across the Niger Delta.',
    genre: 'Drama',
    release_year: 2024,
    duration_seconds: 6720, // 1h 52m
    poster_url: '/posters/royal_throne.jpg',
    backdrop_url: '/posters/royal_throne.jpg',
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    is_bundle_only: false,
    status: 'published',
    views_count: 1150,
    paid_unlocks_count: 280,
    price_ngn: 100,
    free_preview_seconds: 300,
    created_at: new Date('2026-01-22T00:00:00Z').toISOString(),
  };

  const movie8: Movie = {
    id: 'mov_lost_hills',
    creator_id: creatorProfile1.id,
    creator_name: creatorProfile1.channel_name,
    creator_avatar: creatorProfile1.channel_avatar_url,
    title: 'Expedition: The Lost Hills of Obudu',
    synopsis: 'An ambitious wildlife biologist and her documentary team trek through the highlands of Cross River State to locate a legendary mountain sanctuary before poachers strike.',
    genre: 'Adventure',
    release_year: 2025,
    duration_seconds: 5940, // 1h 39m
    poster_url: '/posters/lagos_heist.jpg',
    backdrop_url: '/posters/lagos_heist.jpg',
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    is_bundle_only: false,
    status: 'published',
    views_count: 940,
    paid_unlocks_count: 195,
    price_ngn: 100,
    free_preview_seconds: 300,
    created_at: new Date('2026-02-18T00:00:00Z').toISOString(),
  };

  const movie9: Movie = {
    id: 'mov_accra_connection',
    creator_id: creatorProfile1.id,
    creator_name: creatorProfile1.channel_name,
    creator_avatar: creatorProfile1.channel_avatar_url,
    title: 'The Accra-Lagos Connection',
    synopsis: 'A high-octane cross-border thriller as Ghanaian customs and Nigerian narcotics police join forces to bust an international gold and tech smuggling syndicate.',
    genre: 'Action',
    release_year: 2025,
    duration_seconds: 6360, // 1h 46m
    poster_url: '/posters/abuja_cipher.jpg',
    backdrop_url: '/posters/abuja_cipher.jpg',
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    is_bundle_only: false,
    status: 'published',
    views_count: 1670,
    paid_unlocks_count: 388,
    price_ngn: 100,
    free_preview_seconds: 300,
    created_at: new Date('2026-02-08T00:00:00Z').toISOString(),
  };

  const movie10: Movie = {
    id: 'mov_hearts_zaria',
    creator_id: creatorProfile3.id,
    creator_name: creatorProfile3.channel_name,
    creator_avatar: creatorProfile3.channel_avatar_url,
    title: 'Hearts of Zaria',
    synopsis: 'An evocative romance between a modern fintech architect and a traditional textile artisan against the breathtaking ancient city gates of Northern Nigeria.',
    genre: 'Romance',
    release_year: 2024,
    duration_seconds: 6060, // 1h 41m
    poster_url: '/posters/sunset_elegushi.jpg',
    backdrop_url: '/posters/sunset_elegushi.jpg',
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    is_bundle_only: false,
    status: 'published',
    views_count: 1320,
    paid_unlocks_count: 290,
    price_ngn: 100,
    free_preview_seconds: 300,
    created_at: new Date('2026-01-30T00:00:00Z').toISOString(),
  };

  // 10-episode bundle
  const bundle1: EpisodeBundle = {
    id: 'bundle_lagos_underground',
    creator_id: creatorProfile1.id,
    title: 'Lagos Underground: The Complete 10-Episode Saga',
    description: 'The definitive 10-part serialized Nollywood thriller bundle following the rise and fall of the Balogun dock syndicate across Lagos State.',
    poster_url: '/posters/lagos_heist.jpg',
    price_ngn: 700, // ₦700 for all 10 episodes
    episodes_count: 10,
    status: 'approved',
    created_at: new Date('2026-02-01T00:00:00Z').toISOString(),
  };

  // 10 episodes linked to bundle
  const bundleEpisodes: Movie[] = [];
  for (let i = 1; i <= 10; i++) {
    bundleEpisodes.push({
      id: `ep_lagos_${i}`,
      creator_id: creatorProfile1.id,
      creator_name: creatorProfile1.channel_name,
      creator_avatar: creatorProfile1.channel_avatar_url,
      title: `Lagos Underground — Ep ${i}: ${['The Breach', 'Lekki Toll Stakeout', 'The Marina Drop', 'Betrayal on Third Mainland', 'Undercover at Eko', 'The Offshore Wire', 'Surulere Safehouse', 'The Police Commissioner', 'Crossfire at Apapa', 'Final Judgment'][i - 1]}`,
      synopsis: `Episode ${i} of the Lagos Underground saga. High stakes, intense confrontation and unraveling alliances.`,
      genre: 'Action & Crime',
      release_year: 2025,
      duration_seconds: 2400 + (i * 90), // ~45 mins each
      poster_url: '/posters/lagos_heist.jpg',
      backdrop_url: '/posters/lagos_heist.jpg',
      video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
      is_bundle_only: true,
      bundle_id: bundle1.id,
      episode_number: i,
      status: 'published',
      views_count: 320 - (i * 12),
      paid_unlocks_count: 85,
      price_ngn: 100,
      free_preview_seconds: 300,
      created_at: new Date('2026-02-02T00:00:00Z').toISOString(),
    });
  }

  // Sample Livestream
  const livestream1: Livestream = {
    id: 'live_01',
    creator_id: creatorProfile1.id,
    creator_name: creatorProfile1.channel_name,
    creator_avatar: creatorProfile1.channel_avatar_url,
    title: 'Live Q&A & BTS: Directing Lagos Midnight Syndicate',
    description: 'Join Kunle Afolayan live on set talking through camera rigs, stunts, and Nollywood distribution secrets.',
    scheduled_at: new Date(Date.now() + 3600000).toISOString(),
    status: 'live',
    stream_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    viewer_count: 480,
    created_at: new Date().toISOString(),
  };

  // Sample Premiere
  const premiere1: Premiere = {
    id: 'prem_01',
    movie_id: movie4.id,
    movie_title: movie4.title,
    movie_poster: movie4.poster_url,
    creator_name: movie4.creator_name || 'Golden Effects Cinema',
    scheduled_for: new Date(Date.now() + 86400000 * 2).toISOString(), // 2 days ahead
    is_active: true,
    created_at: new Date().toISOString(),
  };

  // Initial Ad Campaign
  const ad1: AdCampaign = {
    id: 'ad_01',
    business_name: 'Visibyl Cloud & Pay',
    title: 'Seamless Digital Entertainment for Africa',
    media_url: '/visplay-logo.png',
    click_url: 'https://visibyl.com',
    target_genre: 'All',
    impressions: 4820,
    clicks: 312,
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  // Sample Comments
  const comments: Comment[] = [
    {
      id: 'com_01',
      movie_id: movie1.id,
      user_id: viewerUser.id,
      user_name: viewerUser.full_name,
      user_avatar: viewerUser.avatar_url,
      comment_text: 'The cinematography on the Lekki Bridge scene at night is absolutely world-class Nollywood! Well worth the ₦100 coins.',
      likes_count: 24,
      created_at: new Date('2026-02-15T14:20:00Z').toISOString(),
    },
    {
      id: 'com_02',
      movie_id: movie1.id,
      user_id: creatorUser2.id,
      user_name: creatorUser2.full_name,
      user_avatar: creatorUser2.avatar_url,
      comment_text: 'Exceptional pacing and sound design Kunle! VisPlay is truly empowering African cinema.',
      likes_count: 18,
      created_at: new Date('2026-02-16T09:12:00Z').toISOString(),
    },
    {
      id: 'com_03',
      movie_id: movie2.id,
      user_id: viewerUser.id,
      user_name: viewerUser.full_name,
      user_avatar: viewerUser.avatar_url,
      comment_text: 'The historical costuming and coral beads are pure perfection. Long live the Queen Regent!',
      likes_count: 15,
      created_at: new Date('2026-02-17T11:45:00Z').toISOString(),
    }
  ];

  return {
    users: [superAdminTelvin, adminUser, creatorUser1, creatorUser2, creatorUser3, viewerUser],
    creator_profiles: [creatorProfile1, creatorProfile2, creatorProfile3],
    movies: [movie1, movie2, movie3, movie4, movie5, movie6, movie7, movie8, movie9, movie10, ...bundleEpisodes],
    bundles: [bundle1],
    transactions: [
      {
        id: 'tx_init_01',
        user_id: viewerUser.id,
        amount_ngn: 2000,
        type: 'deposit',
        status: 'successful',
        reference: 'VIS_DEP_SEED_01',
        payment_method: 'paystack',
        description: 'Wallet funding via Paystack checkout',
        created_at: new Date('2026-02-10T10:00:00Z').toISOString(),
      },
      {
        id: 'tx_pur_01',
        user_id: viewerUser.id,
        amount_ngn: 100,
        type: 'purchase',
        status: 'successful',
        reference: 'VIS_PUR_SEED_01',
        payment_method: 'wallet',
        description: 'Unlocked Lagos Midnight Syndicate (Full Movie)',
        created_at: new Date('2026-02-12T16:30:00Z').toISOString(),
      }
    ],
    purchases: [
      {
        id: 'pur_01',
        user_id: viewerUser.id,
        item_type: 'movie',
        item_id: movie1.id,
        amount_ngn: 100,
        reference: 'VIS_PUR_SEED_01',
        created_at: new Date('2026-02-12T16:30:00Z').toISOString(),
      }
    ],
    ledger: [
      {
        id: 'led_01',
        creator_id: creatorProfile1.id,
        purchase_id: 'pur_01',
        movie_id: movie1.id,
        gross_amount_ngn: 100,
        creator_share_ngn: 85, // 85% creator
        platform_fee_ngn: 15,  // 15% platform
        status: 'accrued',
        created_at: new Date('2026-02-12T16:30:00Z').toISOString(),
      }
    ],
    payouts: [
      {
        id: 'pay_01',
        creator_id: creatorProfile1.id,
        month_period: 'January 2026',
        total_earnings_ngn: 50000,
        platform_fee_ngn: 7500,
        net_payout_ngn: 42500,
        status: 'paid',
        bank_name: 'Zenith Bank',
        account_number: '2081234567',
        account_name: 'Kunle Afolayan Productions',
        paid_at: new Date('2026-02-01T00:00:00Z').toISOString(),
        created_at: new Date('2026-01-31T23:59:59Z').toISOString(),
      }
    ],
    comments,
    likes: [
      { id: 'like_01', movie_id: movie1.id, user_id: viewerUser.id, created_at: new Date().toISOString() },
      { id: 'like_02', movie_id: movie2.id, user_id: viewerUser.id, created_at: new Date().toISOString() }
    ],
    follows: [
      { id: 'fol_01', follower_user_id: viewerUser.id, creator_user_id: creatorProfile1.id, created_at: new Date().toISOString() }
    ],
    viewing_events: [
      {
        id: 'view_01',
        user_id: viewerUser.id,
        movie_id: movie1.id,
        session_id: 'sess_seed_01',
        duration_watched_seconds: 6420,
        reached_5_min: true,
        completed: true,
        converted_to_purchase: true,
        ip_hash: '127.0.0.1_hash',
        created_at: new Date('2026-02-12T16:00:00Z').toISOString(),
      }
    ],
    livestreams: [livestream1],
    premieres: [premiere1],
    rewards: [
      {
        id: 'rew_01',
        user_id: viewerUser.id,
        reward_type: 'streak',
        points: 250,
        naira_equivalent: 50,
        reason: '5-Day Movie Watching Streak Bonus',
        created_at: new Date('2026-02-14T08:00:00Z').toISOString(),
      }
    ],
    ads: [ad1],
    audit_logs: [
      {
        id: 'aud_01',
        admin_id: adminUser.id,
        admin_name: adminUser.full_name,
        action: 'APPROVE_CREATOR',
        target_type: 'creator_profile',
        target_id: creatorProfile1.id,
        details: 'Approved Golden Effects Cinema application with content type Action & Crime Thrillers',
        created_at: new Date('2026-01-11T00:00:00Z').toISOString(),
      }
    ],
    notifications: [
      {
        id: 'notif_01',
        user_id: viewerUser.id,
        title: 'New Release from Golden Effects Cinema',
        message: 'Lagos Midnight Syndicate is now streaming! Enjoy the first 5 minutes free or unlock for ₦100.',
        link: '/watch/mov_lagos_syndicate',
        is_read: false,
        created_at: new Date().toISOString(),
      }
    ],
    featured_movie_id: 'mov_lagos_syndicate',
    featured_movie_backdrop: null,
  };
}
