export interface User {
  id: string;
  email: string;
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
  creator_id: string;
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
  price_ngn: number;
  free_preview_seconds: number;
  created_at: string;
  is_purchased?: boolean;
  likes_count?: number;
  is_liked?: boolean;
}

export interface EpisodeBundle {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  poster_url: string;
  price_ngn: number;
  episodes_count: number;
  status: 'approved' | 'pending';
  created_at: string;
  episodes?: Movie[];
  is_purchased?: boolean;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  amount_ngn: number;
  type: 'deposit' | 'purchase' | 'earning' | 'payout';
  status: 'successful' | 'pending' | 'failed';
  reference: string;
  payment_method: 'paystack' | 'flutterwave' | 'wallet';
  description: string;
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
  channel_name?: string;
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
  dislikes_count?: number;
  liked_by?: string[];
  disliked_by?: string[];
  created_at: string;
  updated_at?: string;
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
