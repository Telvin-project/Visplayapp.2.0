import React, { useState } from 'react';
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

      {/* Main Viewport Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-20 md:pb-12">
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

        {currentView === 'studio' && (
          <CreatorStudioPage onSelectMovie={handleSelectMovie} />
        )}

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

          <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-400">
            <span>₦100 Movie Rate</span>
            <span>·</span>
            <span>₦700 10-Episode Series</span>
            <span>·</span>
            <span className="text-cyan-400">85% Filmmaker Share</span>
            <span>·</span>
            <span>Monthly Payouts</span>
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
