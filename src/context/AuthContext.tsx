import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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

interface AuthContextType {
  user: User | null;
  creatorProfile: CreatorProfile | null;
  loading: boolean;
  authLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, fullName: string, phone?: string) => Promise<{ success: boolean; error?: string }>;
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
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user || null);
        setCreatorProfile(data.creator_profile || null);
      } else {
        setUser(null);
        setCreatorProfile(null);
      }
    } catch (err) {
      console.error('Failed to fetch auth/me', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncSupabaseSession = useCallback(async (supabaseUser: any) => {
    if (!supabaseUser?.email) return;
    try {
      setAuthLoading(true);
      const res = await fetch('/api/auth/supabase-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: supabaseUser.email,
          full_name:
            supabaseUser.user_metadata?.full_name ||
            supabaseUser.user_metadata?.name ||
            supabaseUser.email.split('@')[0],
          avatar_url:
            supabaseUser.user_metadata?.avatar_url ||
            supabaseUser.user_metadata?.picture ||
            '',
          supabase_id: supabaseUser.id,
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
      }
    } catch (err) {
      console.error('Error synchronizing Supabase session with backend:', err);
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
          syncSupabaseSession(session.user);
        }
      });

      const { data: { subscription } } = client.auth.onAuthStateChange(async (event, session) => {
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && session?.user) {
          await syncSupabaseSession(session.user);
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
          error: 'Supabase credentials not configured. Please enter your Supabase URL & Anon Key below, or use demo one-click login.',
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
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Login failed' };
      }
      setUser(data.user);
      await refreshUser();
      setAuthModalOpen(false);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    } finally {
      setAuthLoading(false);
    }
  };

  const register = async (email: string, password: string, fullName: string, phone?: string) => {
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name: fullName, phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Registration failed' };
      }

      // If Supabase is configured, also register on Supabase Auth in background
      const client = getSupabaseClient();
      if (client) {
        try {
          await client.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: fullName, phone },
            },
          });
        } catch (supabaseErr) {
          console.warn('Optional Supabase signup sync note:', supabaseErr);
        }
      }

      setUser(data.user);
      await refreshUser();
      setAuthModalOpen(false);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    } finally {
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
