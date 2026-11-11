import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { User, CreatorProfile } from '../types';
import {
  getSupabaseClient,
  isSupabaseConfigured,
  signInWithGoogle,
  signOutSupabase,
  setCustomSupabaseCredentials,
  clearCustomSupabaseCredentials,
  getSupabaseCredentials,
} from '../lib/supabase';
import { safeHomePath } from '../lib/distribution';

interface AuthContextType {
  user: User | null;
  creatorProfile: CreatorProfile | null;
  loading: boolean;
  authLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, fullName: string, phone?: string) => Promise<{ success: boolean; error?: string; verification_required?: boolean }>;
  logout: () => Promise<void>;
  updateProfile: (data: { full_name?: string; phone?: string; avatar_url?: string }) => Promise<{ success: boolean; error?: string }>;
  refreshUser: () => Promise<void>;
  
  // Supabase Status & Config
  isSupabaseActive: boolean;
  configureSupabase: (url: string, key: string) => boolean;
  resetSupabaseConfig: () => void;
  supabaseConfig: { url: string; anonKey: string };

  // UI Modal controllers
  authModalOpen: boolean;
  authModalMode: 'login' | 'register';
  openAuthModal: (mode?: 'login' | 'register') => void;
  closeAuthModal: () => void;
  
  depositModalOpen: boolean;
  depositModalCallback?: () => void;
  openDepositModal: (onSuccessCallback?: () => void) => void;
  closeDepositModal: () => void;

  creatorApplyModalOpen: boolean;
  openCreatorApplyModal: () => void;
  closeCreatorApplyModal: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const registrationInProgress = useRef(false);
  const [isSupabaseActive, setIsSupabaseActive] = useState(isSupabaseConfigured());
  const [supabaseConfig, setSupabaseConfig] = useState(getSupabaseCredentials());

  // Modals state
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [depositModalCallback, setDepositModalCallback] = useState<(() => void) | undefined>(undefined);
  const [creatorApplyModalOpen, setCreatorApplyModalOpen] = useState(false);

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        // If OAuth has already established a client session, don't let a slower
        // unauthenticated /auth/me response overwrite the synchronized account.
        const supabaseClient = getSupabaseClient();
        const { data: sessionData } = supabaseClient
          ? await supabaseClient.auth.getSession()
          : { data: { session: null } };
        if (data.user) {
          setUser(data.user);
          setCreatorProfile(data.creator_profile || null);
        } else if (!sessionData.session?.user) {
          setUser(null);
          setCreatorProfile(null);
        }
      } else {
        // A transient API/proxy response must not erase an already restored session.
        // Only an explicit successful /auth/me response with no user clears it below.
        console.warn('Auth session check returned a non-success response:', res.status);
      }
    } catch (err) {
      console.error('Failed to fetch auth/me', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncSupabaseSession = useCallback(async (supabaseUser: any, accessToken: string): Promise<{ success: boolean; error?: string }> => {
    if (!supabaseUser?.email || !supabaseUser.email_confirmed_at || !accessToken) {
      return { success: false, error: 'Please verify your email address before signing in.' };
    }
    try {
      setAuthLoading(true);
      const res = await fetch('/api/auth/supabase-sync', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The server verifies this token with Supabase Auth before trusting the identity.
          access_token: accessToken,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setCreatorProfile(data.creator_profile || null);

        // Clean up oauth hash fragments from URL
        if (window.location.hash && (window.location.hash.includes('access_token') || window.location.hash.includes('error'))) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        setAuthModalOpen(false);
        return { success: true };
      }
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || 'Could not finish securing your VisPlay session.' };
    } catch (err) {
      console.error('Error synchronizing Supabase session with backend:', err);
      return { success: false, error: 'Unable to connect to VisPlay. Please try again.' };
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch of current server session
    refreshUser();

    // Initialize Supabase Auth listener if configured
    const client = getSupabaseClient();
    if (client) {
      client.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          syncSupabaseSession(session.user, session.access_token);
        }
      });

      const { data: { subscription } } = client.auth.onAuthStateChange(async (event, session) => {
        // When a provider is misconfigured to sign users in during sign-up,
        // never auto-create a VisPlay account from that registration event.
        if (registrationInProgress.current) return;
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && session?.user) {
          await syncSupabaseSession(session.user, session.access_token);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setCreatorProfile(null);
        }
      });

      return () => {
        subscription.unsubscribe();
      };
    }
  }, [refreshUser, syncSupabaseSession]);

  const loginWithGoogle = async () => {
    setAuthLoading(true);
    try {
      if (!isSupabaseConfigured()) {
        setAuthLoading(false);
        return {
          success: false,
          error: 'Google sign-in is temporarily unavailable because authentication is not configured. Please contact support.',
        };
      }

      await signInWithGoogle();
      // Supabase OAuth initiates browser navigation to Google
      return { success: true };
    } catch (err: any) {
      setAuthLoading(false);
      return {
        success: false,
        error: err?.message || 'Google sign-in failed. Please verify your Supabase project settings.',
      };
    }
  };

  const login = async (email: string, password: string) => {
    setAuthLoading(true);
    try {
      const client = getSupabaseClient();
      if (!client) return { success: false, error: 'Verified sign-in is not configured. Please contact support.' };

      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) return { success: false, error: error.message || 'Invalid email or password.' };

      if (!data.user?.email_confirmed_at || !data.session?.access_token) {
        await client.auth.signOut();
        return { success: false, error: 'Please verify your email using the link we sent before signing in.' };
      }

      const synced = await syncSupabaseSession(data.user, data.session.access_token);
      if (!synced.success) await client.auth.signOut();
      return synced;
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    } finally {
      setAuthLoading(false);
    }
  };

  const register = async (email: string, password: string, fullName: string, phone?: string) => {
    setAuthLoading(true);
    registrationInProgress.current = true;
    try {
      const client = getSupabaseClient();
      if (!client) return { success: false, error: 'Verified registration is not configured. Please contact support.' };
      if (password.length < 12) return { success: false, error: 'Use a password of at least 12 characters.' };
      if (!fullName.trim() || fullName.trim().length > 120) {
        return { success: false, error: 'Enter your full name (up to 120 characters).' };
      }

      const { data, error } = await client.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: window.location.origin + safeHomePath(),
          data: { full_name: fullName.trim(), phone: phone?.trim() || '' },
        },
      });
      if (error) return { success: false, error: error.message || 'Registration could not be completed.' };

      // A Supabase session here means email confirmation is disabled. Reject it
      // and require operators to enable Confirm email in Supabase Auth settings.
      if (data.session) {
        await client.auth.signOut();
        return { success: false, error: 'Email verification is not enabled. Please contact VisPlay support.' };
      }

      // Do not create a VisPlay session, wallet or viewer account until the
      // email link has been verified and /api/auth/supabase-sync succeeds.
      return { success: true, verification_required: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    } finally {
      registrationInProgress.current = false;
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    setAuthLoading(true);
    try {
      await signOutSupabase();
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error', err);
    } finally {
      setUser(null);
      setCreatorProfile(null);
      setAuthLoading(false);
    }
  };

  const updateProfile = async (data: { full_name?: string; phone?: string; avatar_url?: string }) => {
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) {
        return { success: false, error: result.error || 'Failed to update profile' };
      }
      setUser(result.user);
      await refreshUser();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  };

  const configureSupabase = (url: string, key: string) => {
    const success = setCustomSupabaseCredentials(url, key);
    if (success) {
      setIsSupabaseActive(true);
      setSupabaseConfig({ url, anonKey: key });
    }
    return success;
  };

  const resetSupabaseConfig = () => {
    clearCustomSupabaseCredentials();
    setIsSupabaseActive(isSupabaseConfigured());
    setSupabaseConfig(getSupabaseCredentials());
  };

  const openAuthModal = (mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const closeAuthModal = () => setAuthModalOpen(false);

  const openDepositModal = (onSuccessCallback?: () => void) => {
    setDepositModalCallback(() => onSuccessCallback);
    setDepositModalOpen(true);
  };

  const closeDepositModal = () => {
    setDepositModalOpen(false);
    if (depositModalCallback) {
      depositModalCallback();
      setDepositModalCallback(undefined);
    }
  };

  const openCreatorApplyModal = () => setCreatorApplyModalOpen(true);
  const closeCreatorApplyModal = () => setCreatorApplyModalOpen(false);

  return (
    <AuthContext.Provider
      value={{
        user,
        creatorProfile,
        loading,
        authLoading,
        login,
        loginWithGoogle,
        register,
        logout,
        updateProfile,
        refreshUser,
        isSupabaseActive,
        configureSupabase,
        resetSupabaseConfig,
        supabaseConfig,
        authModalOpen,
        authModalMode,
        openAuthModal,
        closeAuthModal,
        depositModalOpen,
        depositModalCallback,
        openDepositModal,
        closeDepositModal,
        creatorApplyModalOpen,
        openCreatorApplyModal,
        closeCreatorApplyModal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
