import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Coins,
  Search,
  Bell,
  User as UserIcon,
  Film,
  ShieldAlert,
  LogOut,
  FolderLock,
  Plus,
  Home,
  Tv,
  Compass,
  Video,
  Menu,
  X,
  Radio,
  CheckCircle2,
} from 'lucide-react';

interface NavbarProps {
  currentView: string;
  setCurrentView: (view: string) => void;
  onSearchChange?: (q: string) => void;
  searchQuery?: string;
  onSelectMovieId?: (id: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  setCurrentView,
  onSearchChange,
  searchQuery = '',
  onSelectMovieId,
}) => {
  const { user, creatorProfile, logout, openAuthModal, openDepositModal, openCreatorApplyModal } = useAuth();
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    if (!user) { setNotifications([]); return; }
    let alive = true;
    const loadNotifications = async () => {
      try {
        const response = await fetch('/api/notifications');
        if (response.ok) {
          const data = await response.json();
          if (alive) setNotifications(data.notifications || []);
        }
      } catch { /* Notifications can retry on the next poll. */ }
    };
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 15000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [user?.id]);

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const openNotifications = () => {
    setCurrentView('notifications');
    setMobileMenuOpen(false);
    setUserDropdownOpen(false);
  };

  return (
    <>
      {/* Desktop & Mobile Header Bar */}
      <header className="sticky top-0 z-40 w-full bg-[#07090e]/95 backdrop-blur-md border-b border-slate-800/80 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          
          {/* Zone 1: Brand Wordmark & Logo */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => {
                setCurrentView('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex items-center gap-2 text-left focus:outline-none group"
            >
              <img
                src="/visplay-logo.png"
                alt="VisPlay"
                className="h-9 sm:h-10 w-auto object-contain transition-transform group-hover:scale-105"
              />
            </button>
          </div>

          {/* Zone 2: Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
            <button
              onClick={() => setCurrentView('home')}
              className={`whitespace-nowrap transition-colors ${
                currentView === 'home' ? 'text-cyan-400 font-semibold' : 'hover:text-white'
              }`}
            >
              Browse Movies
            </button>
            <button
              onClick={() => setCurrentView('bundles')}
              className={`whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                currentView === 'bundles' ? 'text-fuchsia-400 font-semibold' : 'hover:text-white'
              }`}
            >
              <span>10-Episode Bundles</span>
              <span className="text-[10px] text-fuchsia-300 font-mono bg-fuchsia-950/60 border border-fuchsia-800/80 rounded px-1.5 py-0.5">
                ₦700
              </span>
            </button>
            <button
              onClick={() => setCurrentView('live')}
              className={`whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                currentView === 'live' ? 'text-rose-400 font-semibold' : 'hover:text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
              <span>Live & Premieres</span>
            </button>
            <button
              onClick={() => setCurrentView('creators')}
              className={`whitespace-nowrap transition-colors ${
                currentView === 'creators' ? 'text-cyan-400 font-semibold' : 'hover:text-white'
              }`}
            >
              Creators
            </button>

            {/* Admin Quick Link if Super Admin */}
            {user?.role === 'admin' && (
              <button
                onClick={() => setCurrentView('admin')}
                className={`whitespace-nowrap transition-colors flex items-center gap-1 text-amber-400 hover:text-amber-300 font-semibold ${
                  currentView === 'admin' ? 'underline decoration-amber-400 underline-offset-4' : ''
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Super Admin</span>
              </button>
            )}
          </nav>

          {/* Zone 3: Actions & User Controls */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Search Toggle / Input */}
            <div className="relative">
              {showSearchInput ? (
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 w-44 sm:w-60 transition-all">
                  <Search className="w-4 h-4 text-slate-400 shrink-0 mr-2" />
                  <input
                    type="text"
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => onSearchChange?.(e.target.value)}
                    placeholder="Search movies, creators..."
                    className="w-full bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      setShowSearchInput(false);
                      onSearchChange?.('');
                    }}
                    className="text-slate-400 hover:text-white ml-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowSearchInput(true)}
                  className="w-9 h-9 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors"
                  title="Search movies"
                >
                  <Search className="w-4 h-4" />
                </button>
              )}
            </div>

            {user && (
              <div className="relative">
                <button onClick={openNotifications} className="relative w-9 h-9 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-slate-300" title="Notifications" aria-label="Notifications">
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && <span className="absolute -right-1 -top-1 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                </button>

              </div>
            )}

            {/* User Wallet Pill */}
            {user && (
              <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-xl p-1 pr-2 gap-1.5">
                <button
                  onClick={() => openDepositModal()}
                  className="w-7 h-7 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 flex items-center justify-center transition-colors"
                  title="Fund Wallet"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <div className="text-right">
                  <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-semibold leading-none">
                    Wallet
                  </span>
                  <span className="text-xs font-bold text-cyan-300 font-mono leading-tight">
                    ₦{user.wallet_balance.toLocaleString()}
                  </span>
                </div>
              </div>
            )}

            {/* Auth Buttons / Profile Menu */}
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="flex items-center gap-2 p-1 rounded-xl hover:bg-slate-800/60 transition-colors focus:outline-none"
                >
                  <img
                    src={user.avatar_url || '/visplay-symbol.png'}
                    alt={user.full_name}
                    className="w-9 h-9 rounded-xl object-cover border border-slate-700"
                  />
                  <div className="hidden lg:block text-left text-xs">
                    <span className="font-semibold text-white block max-w-[120px] truncate">{user.full_name}</span>
                    <span className="text-[10px] text-slate-400 capitalize">{user.role}</span>
                  </div>
                </button>

                {/* Dropdown Menu */}
                {userDropdownOpen && (
                  <div
                    className="absolute right-0 mt-2 w-56 bg-[#0d121d] border border-slate-800 rounded-2xl shadow-2xl py-2 z-50 text-xs text-slate-300"
                    onClick={() => setUserDropdownOpen(false)}
                  >
                    <div className="px-4 py-2 border-b border-slate-800">
                      <p className="font-semibold text-white truncate">{user.full_name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
                    </div>

                    <button
                      onClick={() => setCurrentView('library')}
                      className="w-full px-4 py-2 text-left hover:bg-slate-800/80 flex items-center gap-2 text-slate-200 transition-colors"
                    >
                      <FolderLock className="w-4 h-4 text-cyan-400" />
                      <span>My Library & Purchases</span>
                    </button>

                    <button
                      onClick={() => openDepositModal()}
                      className="w-full px-4 py-2 text-left hover:bg-slate-800/80 flex items-center gap-2 text-slate-200 transition-colors"
                    >
                      <Coins className="w-4 h-4 text-emerald-400" />
                      <span>Deposit Coins (Paystack)</span>
                    </button>

                    {/* Creator Studio / Creator Apply */}
                    {creatorProfile?.status === 'approved' || user.role === 'creator' || user.role === 'admin' ? (
                      <button
                        onClick={() => setCurrentView('studio')}
                        className="w-full px-4 py-2 text-left hover:bg-slate-800/80 flex items-center gap-2 text-fuchsia-300 transition-colors"
                      >
                        <Film className="w-4 h-4 text-fuchsia-400" />
                        <span>Creator Studio</span>
                      </button>
                    ) : (
                      <button
                        onClick={openCreatorApplyModal}
                        className="w-full px-4 py-2 text-left hover:bg-slate-800/80 flex items-center gap-2 text-fuchsia-300 transition-colors"
                      >
                        <Video className="w-4 h-4 text-fuchsia-400" />
                        <span>Apply as Creator (85% Split)</span>
                      </button>
                    )}

                    {/* Admin Portal */}
                    {user.role === 'admin' && (
                      <button
                        onClick={() => setCurrentView('admin')}
                        className="w-full px-4 py-2 text-left hover:bg-slate-800/80 flex items-center gap-2 text-amber-300 transition-colors"
                      >
                        <ShieldAlert className="w-4 h-4 text-amber-400" />
                        <span>Super Admin Portal</span>
                      </button>
                    )}

                    <button
                      onClick={() => setCurrentView('profile')}
                      className="w-full px-4 py-2 text-left hover:bg-slate-800/80 flex items-center gap-2 text-slate-200 transition-colors"
                    >
                      <UserIcon className="w-4 h-4 text-slate-400" />
                      <span>Account Settings</span>
                    </button>

                    <div className="border-t border-slate-800 my-1"></div>

                    <button
                      onClick={() => logout()}
                      className="w-full px-4 py-2 text-left hover:bg-rose-950/40 text-rose-400 flex items-center gap-2 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openAuthModal('login')}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                >
                  Sign In
                </button>
                <button
                  onClick={() => openAuthModal('register')}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-md shadow-cyan-500/20 active:scale-95 transition-all"
                >
                  Join Free
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar (Natural Thumb Reach Zone) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#07090e]/95 backdrop-blur-md border-t border-slate-800/80 px-2 py-2">
        <div className="grid grid-cols-5 items-center justify-around text-center">
          <button
            onClick={() => setCurrentView('home')}
            className={`flex flex-col items-center py-1 transition-colors ${
              currentView === 'home' ? 'text-cyan-400 font-semibold' : 'text-slate-400'
            }`}
          >
            <Home className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Home</span>
          </button>

          <button
            onClick={() => setCurrentView('bundles')}
            className={`flex flex-col items-center py-1 transition-colors ${
              currentView === 'bundles' ? 'text-fuchsia-400 font-semibold' : 'text-slate-400'
            }`}
          >
            <Tv className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Bundles</span>
          </button>

          <button
            onClick={() => {
              if (creatorProfile?.status === 'approved' || user?.role === 'creator' || user?.role === 'admin') {
                setCurrentView('studio');
              } else {
                openCreatorApplyModal();
              }
            }}
            className={`flex flex-col items-center py-1 transition-colors ${
              currentView === 'studio' ? 'text-cyan-400 font-semibold' : 'text-slate-400'
            }`}
          >
            <Video className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Studio</span>
          </button>

          <button
            onClick={() => {
              if (user) {
                openDepositModal();
              } else {
                openAuthModal('login');
              }
            }}
            className="flex flex-col items-center py-1 text-slate-400 hover:text-cyan-300"
          >
            <Coins className="w-5 h-5 mb-0.5 text-cyan-400" />
            <span className="text-[10px]">Wallet</span>
          </button>

          <button
            onClick={() => {
              if (user) {
                setCurrentView('library');
              } else {
                openAuthModal('login');
              }
            }}
            className={`flex flex-col items-center py-1 transition-colors ${
              currentView === 'library' ? 'text-cyan-400 font-semibold' : 'text-slate-400'
            }`}
          >
            <FolderLock className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Library</span>
          </button>
        </div>
      </nav>
    </>
  );
};
