import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { AuthModal } from './components/AuthModal';
import { WalletDepositModal } from './components/WalletDepositModal';
import { CreatorApplicationModal } from './components/CreatorApplicationModal';

// Pages
import { HomePage } from './pages/HomePage';
import { WatchPage } from './pages/WatchPage';
import { BundlesPage } from './pages/BundlesPage';
import { CreatorStudioPage } from './pages/CreatorStudioPage';
import { SuperAdminDashboard } from './pages/SuperAdminDashboard';
import { UserDashboardPage } from './pages/UserDashboardPage';
import { CreatorChannelPage } from './pages/CreatorChannelPage';
import { CreatorsDirectoryPage } from './pages/CreatorsDirectoryPage';
import { LivePremieresPage } from './pages/LivePremieresPage';

const AppContent: React.FC = () => {
  const { user, openAuthModal, openCreatorApplyModal } = useAuth();
  const [currentView, setCurrentView] = useState<string>('home');
  const [selectedMovieId, setSelectedMovieId] = useState<string>('mov_lagos_syndicate');
  const [selectedCreatorId, setSelectedCreatorId] = useState<string>('creator_01');
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const skipHistoryPush = useRef(false);
  const [uploadStatus, setUploadStatus] = useState<{progress:number; active:boolean; error:boolean} | null>(null);

  // Open a shared movie directly when the app loads with ?watch=<movieId>.
  useEffect(() => {
    const sharedMovieId = new URLSearchParams(window.location.search).get('watch');
    if (sharedMovieId) {
      setSelectedMovieId(sharedMovieId);
      setCurrentView('watch');
    }
  }, []);

  // Search is only for discovery on Home. Leaving Home clears it for the next visit.
  useEffect(() => {
    if (currentView !== 'home' && searchQuery) setSearchQuery('');
  }, [currentView, searchQuery]);

  useEffect(() => {
    const handleUploadProgress = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail) setUploadStatus({ progress: Number(detail.progress) || 0, active: Boolean(detail.active), error: Boolean(detail.error) });
    };
    window.addEventListener('visplay-upload-progress', handleUploadProgress);
    return () => window.removeEventListener('visplay-upload-progress', handleUploadProgress);
  }, []);

  useEffect(() => {
    const handleMoviePaymentComplete = (event: Event) => {
      const movieId = (event as CustomEvent<{ movieId?: string }>).detail?.movieId;
      if (!movieId) return;
      setSelectedMovieId(movieId);
      setCurrentView('watch');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    window.addEventListener('visplay-movie-payment-complete', handleMoviePaymentComplete);
    return () => window.removeEventListener('visplay-movie-payment-complete', handleMoviePaymentComplete);
  }, []);

  // Keep in-app navigation in browser history so Back returns to the previous VisPlay page.
  useEffect(() => {
    const currentState = { visplay: true, currentView, selectedMovieId, selectedCreatorId, selectedBundleId };
    if (skipHistoryPush.current) {
      skipHistoryPush.current = false;
      window.history.replaceState(currentState, '', window.location.href);
    } else {
      window.history.pushState(currentState, '', window.location.href);
    }
  }, [currentView, selectedMovieId, selectedCreatorId, selectedBundleId]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (state?.visplay) {
        skipHistoryPush.current = true;
        setCurrentView(state.currentView || 'home');
        if (state.selectedMovieId) setSelectedMovieId(state.selectedMovieId);
        if (state.selectedCreatorId) setSelectedCreatorId(state.selectedCreatorId);
        setSelectedBundleId(state.selectedBundleId ?? null);
      } else {
        // The browser may return to a history entry created before the SPA mounted.
        // Add a fresh in-app entry instead of replacing the only safe entry, so the
        // next Back gesture does not immediately leave VisPlay and land on a 404.
        const homeState = {
          visplay: true,
          currentView: 'home',
          selectedMovieId,
          selectedCreatorId,
          selectedBundleId: null,
        };
        window.history.pushState(homeState, '', window.location.href);
        skipHistoryPush.current = true;
        setSelectedBundleId(null);
        setCurrentView('home');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [selectedMovieId, selectedCreatorId, selectedBundleId]);

  const handleSelectMovie = (id: string) => {
    setSelectedMovieId(id);
    setCurrentView('watch');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectCreator = (id: string) => {
    setSelectedCreatorId(id);
    setCurrentView('channel');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectBundle = (bundleId: string) => {
    setSelectedBundleId(bundleId);
    setCurrentView('bundles');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#06080d] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Universal Top Bar Navigation */}
      <Navbar
        currentView={currentView}
        setCurrentView={setCurrentView}
        onSearchChange={setSearchQuery}
        searchQuery={searchQuery}
        onSelectMovieId={handleSelectMovie}
      />

      {uploadStatus && (uploadStatus.active || uploadStatus.error || uploadStatus.progress === 100) && (
        <div className="sticky top-[76px] z-40 mx-3 sm:mx-5 mt-2 rounded-xl border border-cyan-500/30 bg-slate-950/95 p-3 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-white">{uploadStatus.error ? 'Upload interrupted' : uploadStatus.progress === 100 ? 'Upload complete' : 'Uploading movie — you can keep browsing VisPlay'}</span>
            <span className="font-mono text-cyan-300">{uploadStatus.progress}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-cyan-400 transition-[width] duration-200" style={{width: `${uploadStatus.progress}%`}} /></div>
        </div>
      )}

      {/* Main Viewport Container */}
      <main className="flex-1 w-full mx-auto px-3 sm:px-5 lg:px-8 pt-4 sm:pt-6 pb-20 md:pb-12">
        {currentView === 'home' && (
          <HomePage
            onSelectMovie={handleSelectMovie}
            onSelectCreator={handleSelectCreator}
            onSelectBundle={handleSelectBundle}
            searchQuery={searchQuery}
          />
        )}

        {currentView === 'watch' && (
          <WatchPage
            movieId={selectedMovieId}
            onBack={() => setCurrentView('home')}
            onSelectMovie={handleSelectMovie}
            onSelectCreator={handleSelectCreator}
          />
        )}

        {currentView === 'bundles' && (
          <BundlesPage
            onSelectMovie={handleSelectMovie}
            onSelectCreator={handleSelectCreator}
            selectedBundleId={selectedBundleId}
          />
        )}

        {currentView === 'live' && (
          <LivePremieresPage onSelectMovie={handleSelectMovie} />
        )}

        {currentView === 'creators' && (
          <CreatorsDirectoryPage
            onSelectCreator={handleSelectCreator}
            onOpenApply={openCreatorApplyModal}
          />
        )}

        {currentView === 'channel' && (
          <CreatorChannelPage
            creatorId={selectedCreatorId}
            onBack={() => setCurrentView('home')}
            onSelectMovie={handleSelectMovie}
          />
        )}

        <div className={currentView === 'studio' ? 'contents' : 'hidden'} aria-hidden={currentView !== 'studio'}>
          <CreatorStudioPage onSelectMovie={handleSelectMovie} />
        </div>

        {currentView === 'admin' && (
          <SuperAdminDashboard onSelectMovie={handleSelectMovie} />
        )}

        {(currentView === 'library' || currentView === 'profile') && (
          <UserDashboardPage
            onSelectMovie={handleSelectMovie}
            onSelectCreator={handleSelectCreator}
            onSelectBundle={handleSelectBundle}
          />
        )}
      </main>

      {/* Global Modals */}
      <AuthModal />
      <WalletDepositModal />
      <CreatorApplicationModal />

      {/* Quiet Cinematic Footer */}
      <footer className="border-t border-slate-800/80 bg-[#07090e] py-8 px-4 sm:px-6 lg:px-8 text-xs text-slate-400 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-center gap-3 text-center sm:text-left">
            <img src="/visplay-logo.png" alt="VisPlay" className="h-7 w-auto object-contain" />
            <span className="hidden sm:inline text-slate-600">|</span>
            <span className="text-slate-300 font-medium">Great Movies. Small Coins. Big Entertainment.</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-slate-400">
            <span>₦100 per movie</span>
            <span>·</span>
            <span>5-minute free preview</span>
            <span>·</span>
            <span>Visibyl Technologies</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
