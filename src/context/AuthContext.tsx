import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, CreatorProfile } from '../types';

interface AuthContextType {
  user: User | null;
  creatorProfile: CreatorProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, fullName: string, phone?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateProfile: (data: { full_name?: string; phone?: string; avatar_url?: string }) => Promise<{ success: boolean; error?: string }>;
  refreshUser: () => Promise<void>;
  
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

  // Modals state
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [depositModalCallback, setDepositModalCallback] = useState<(() => void) | undefined>(undefined);
  const [creatorApplyModalOpen, setCreatorApplyModalOpen] = useState(false);

  const refreshUser = async () => {
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
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (email: string, password: string) => {
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
    }
  };

  const register = async (email: string, password: string, fullName: string, phone?: string) => {
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
      setUser(data.user);
      await refreshUser();
      setAuthModalOpen(false);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error', err);
    } finally {
      setUser(null);
      setCreatorProfile(null);
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
        login,
        register,
        logout,
        updateProfile,
        refreshUser,
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
