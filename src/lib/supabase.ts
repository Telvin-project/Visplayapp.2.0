import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseCredentials(): { url: string; anonKey: string } {
  const envUrl = (import.meta.env.VITE_SUPABASE_URL as string) || '';
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

  const localUrl = typeof window !== 'undefined' ? localStorage.getItem('visplay_supabase_url') || '' : '';
  const localKey = typeof window !== 'undefined' ? localStorage.getItem('visplay_supabase_anon_key') || '' : '';

  const url = (envUrl && !envUrl.includes('your-project-ref') && envUrl.startsWith('https://')) ? envUrl : localUrl;
  const anonKey = (envKey && !envKey.includes('your-supabase-anon-key')) ? envKey : localKey;

  return { url: url.trim(), anonKey: anonKey.trim() };
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getSupabaseCredentials();
  return Boolean(
    url &&
    anonKey &&
    url.startsWith('https://') &&
    !url.includes('placeholder') &&
    !url.includes('your-project-ref')
  );
}

let activeClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (activeClient) return activeClient;
  const { url, anonKey } = getSupabaseCredentials();
  if (isSupabaseConfigured()) {
    try {
      activeClient = createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        },
      });
    } catch (err) {
      console.warn('Failed to initialize Supabase client:', err);
      activeClient = null;
    }
  }
  return activeClient;
}

// Default exported client instance
export const supabase = getSupabaseClient();

export function setCustomSupabaseCredentials(url: string, anonKey: string): boolean {
  if (typeof window !== 'undefined') {
    const cleanUrl = url.trim();
    const cleanKey = anonKey.trim();
    if (cleanUrl && cleanKey && cleanUrl.startsWith('https://')) {
      localStorage.setItem('visplay_supabase_url', cleanUrl);
      localStorage.setItem('visplay_supabase_anon_key', cleanKey);
      activeClient = null; // force re-initialization
      getSupabaseClient();
      return true;
    }
  }
  return false;
}

export function clearCustomSupabaseCredentials(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('visplay_supabase_url');
    localStorage.removeItem('visplay_supabase_anon_key');
    activeClient = null;
  }
}

export async function signInWithGoogle() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      'Supabase credentials not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }

  const redirectTo = window.location.origin;
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) throw error;
  return data;
}

export async function signOutSupabase() {
  const client = getSupabaseClient();
  if (client) {
    try {
      await client.auth.signOut();
    } catch (e) {
      console.warn('Error signing out of Supabase:', e);
    }
  }
}
