import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  X,
  Lock,
  Mail,
  User as UserIcon,
  Phone,
  ShieldCheck,
  Sparkles,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export const AuthModal: React.FC = () => {
  const {
    authModalOpen,
    authModalMode,
    closeAuthModal,
    openAuthModal,
    login,
    loginWithGoogle,
    register,
    authLoading,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  if (!authModalOpen) return null;

  const submitting = localSubmitting || authLoading;

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    const res = await loginWithGoogle();
    if (!res.success) {
      setError(res.error || 'Google sign-in could not be completed.');
    }
    setGoogleLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLocalSubmitting(true);

    if (authModalMode === 'login') {
      const res = await login(email, password);
      if (!res.success) {
        setError(res.error || 'Failed to sign in. Please verify your email and password.');
      }
    } else {
      if (!fullName.trim()) {
        setError('Please enter your full name.');
        setLocalSubmitting(false);
        return;
      }
      const res = await register(email, password, fullName, phone);
      if (!res.success) {
        setError(res.error || 'Registration failed. Try again.');
      }
    }
    setLocalSubmitting(false);
  };

  const handleQuickDemoLogin = async (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError(null);
    setLocalSubmitting(true);
    const res = await login(demoEmail, demoPass);
    if (!res.success) {
      setError(res.error || 'Quick login failed');
    }
    setLocalSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
      <div className="relative w-full max-w-md my-8 bg-[#0d121d] border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-slate-100">
        {/* Close Button */}
        <button
          onClick={closeAuthModal}
          className="absolute top-5 right-5 w-9 h-9 rounded-full bg-slate-800/80 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Brand header */}
        <div className="text-center mb-6">
          <img src="/visplay-logo.png" alt="VisPlay" className="h-10 mx-auto mb-2 object-contain" />
          <p className="text-xs text-slate-400 font-medium">Great Movies. Small Coins. Big Entertainment.</p>
        </div>

        {/* GOOGLE SIGN-IN BUTTON */}
        <div className="mb-5">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading || submitting}
            className="w-full py-2.5 px-4 bg-white hover:bg-slate-100 text-slate-900 rounded-xl font-semibold text-xs sm:text-sm flex items-center justify-center gap-3 shadow-md hover:shadow-lg transition-all active:scale-[0.99] disabled:opacity-60"
          >
            {googleLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
            ) : (
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
            )}
            <span>{googleLoading ? 'Connecting to Google OAuth...' : 'Continue with Google'}</span>
          </button>
        </div>

        {/* Divider */}
        <div className="relative flex items-center justify-center mb-5">
          <div className="border-t border-slate-800 w-full" />
          <span className="bg-[#0d121d] px-3 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
            Or with email
          </span>
          <div className="border-t border-slate-800 w-full" />
        </div>

        {/* Tab switch */}
        <div className="flex p-1 bg-slate-900/80 rounded-xl mb-5 border border-slate-800">
          <button
            type="button"
            onClick={() => { setError(null); openAuthModal('login'); }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              authModalMode === 'login'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setError(null); openAuthModal('register'); }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              authModalMode === 'register'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {authModalMode === 'register' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Full Name</label>
                <div className="relative">
                  <UserIcon className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Ngozi Adeyemi"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Nigerian Phone (Optional)</label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+234 800 000 0000"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 py-3 px-4 rounded-xl font-semibold text-sm bg-gradient-to-r from-cyan-500 via-blue-600 to-fuchsia-600 hover:from-cyan-400 hover:to-fuchsia-500 text-white shadow-lg shadow-cyan-500/20 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing...</span>
              </>
            ) : authModalMode === 'login' ? (
              'Sign In to VisPlay'
            ) : (
              'Join VisPlay & Start Watching'
            )}
          </button>
        </form>

        {/* Quick Demo Accounts for Seamless Testing */}
        <div className="mt-6 pt-5 border-t border-slate-800/80">
          <p className="text-[11px] font-medium text-slate-400 text-center mb-2.5 flex items-center justify-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Instant Role Testing (One-Click)</span>
          </p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleQuickDemoLogin('viewer@visplay.ng', 'viewer123')}
              className="py-1.5 px-2 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 rounded-lg text-[11px] font-medium text-cyan-300 hover:border-cyan-500/50 transition-all text-center disabled:opacity-50"
            >
              👤 Viewer
              <span className="block text-[9px] text-slate-400">₦1,500 coins</span>
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleQuickDemoLogin('kunle@nollywood.ng', 'creator123')}
              className="py-1.5 px-2 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 rounded-lg text-[11px] font-medium text-fuchsia-300 hover:border-fuchsia-500/50 transition-all text-center disabled:opacity-50"
            >
              🎬 Creator
              <span className="block text-[9px] text-slate-400">Studio & Movies</span>
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleQuickDemoLogin('talk2visibyl@gmail.com', 'admin123')}
              className="py-1.5 px-2 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 rounded-lg text-[11px] font-medium text-amber-300 hover:border-amber-500/50 transition-all text-center disabled:opacity-50"
            >
              🛡️ Super Admin
              <span className="block text-[9px] text-slate-400">Full Control</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
