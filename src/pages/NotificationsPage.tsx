import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bell, CheckCheck, Film } from 'lucide-react';

interface NotificationsPageProps {
  onSelectMovie: (id: string) => void;
  onBack: () => void;
}

interface AppNotification {
  id: string;
  title: string;
  message: string;
  link?: string;
  is_read: boolean;
  created_at: string;
}

export const NotificationsPage: React.FC<NotificationsPageProps> = ({ onSelectMovie, onBack }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/notifications');
        if (response.ok) {
          const data = await response.json();
          if (active) setNotifications(data.notifications || []);
          await fetch('/api/notifications/read-all', { method: 'POST' });
          if (active) setNotifications(current => current.map(item => ({ ...item, is_read: true })));
        }
      } catch (error) {
        console.error('Could not load notifications', error);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, []);

  const openNotification = (item: AppNotification) => {
    if (!item.link) return;
    try {
      const url = new URL(item.link, window.location.origin);
      const movieId = url.searchParams.get('watch') || url.pathname.match(/^\/watch\/([^/]+)/)?.[1];
      if (movieId) { onSelectMovie(decodeURIComponent(movieId)); return; }
    } catch { /* Ignore malformed notification links. */ }
    if (item.link.includes('watch=')) {
      const movieId = item.link.split('watch=')[1]?.split('&')[0];
      if (movieId) onSelectMovie(decodeURIComponent(movieId));
    }
  };

  return (
    <section className="w-full max-w-3xl mx-auto px-0 sm:px-2 pb-8">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="w-10 h-10 shrink-0 rounded-xl border border-slate-800 bg-slate-900 flex items-center justify-center text-slate-300" aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Notifications</h1>
          <p className="text-xs text-slate-400 mt-1">Updates from creators and activity on your VisPlay account.</p>
        </div>
      </div>
      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-[#0d121d] p-8 text-center text-sm text-slate-400">Loading notifications…</div>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-[#0d121d] p-8 text-center">
          <Bell className="w-8 h-8 text-cyan-400 mx-auto mb-3" />
          <h2 className="text-sm font-semibold text-white">You're all caught up</h2>
          <p className="text-xs text-slate-400 mt-1">New updates will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map(item => (
            <article key={item.id} className={`rounded-2xl border p-4 sm:p-5 break-words overflow-hidden ${item.is_read ? 'border-slate-800 bg-[#0d121d]' : 'border-cyan-900/70 bg-cyan-950/25'}`}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 shrink-0 rounded-xl bg-slate-900 flex items-center justify-center text-cyan-300">
                  <Film className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-white">{item.title}</h2>
                  <p className="text-sm text-slate-300 mt-1 whitespace-pre-wrap">{item.message}</p>
                  <p className="text-[11px] text-slate-500 mt-2">{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</p>
                  {item.link && <button onClick={() => openNotification(item)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/25">Watch movie <Film className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
