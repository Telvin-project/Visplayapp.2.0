import React, { useState, useEffect } from 'react';
import { Livestream, Premiere } from '../types';
import { Radio, Calendar, Users, Clock, Play, Bell, Send, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface LivePremieresPageProps {
  onSelectMovie: (id: string) => void;
}

export const LivePremieresPage: React.FC<LivePremieresPageProps> = ({ onSelectMovie }) => {
  const { user, openAuthModal } = useAuth();
  const [livestreams, setLivestreams] = useState<Livestream[]>([]);
  const [premieres, setPremieres] = useState<Premiere[]>([]);
  const [activeStream, setActiveStream] = useState<Livestream | null>(null);
  const [liveChatMessages, setLiveChatMessages] = useState<Array<{ id: string; user: string; text: string; time: string }>>([
    { id: '1', user: 'Lateef M.', text: 'The stunts in Lagos Syndicate were unbelievable! Greeting from Ikeja', time: '12:02' },
    { id: '2', user: 'Amina K.', text: 'Kunle how long did post-production take?', time: '12:04' },
    { id: '3', user: 'Visibyl Admin', text: 'Welcome everyone to the official VisPlay Creator Q&A!', time: '12:05' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [reminderSet, setReminderSet] = useState<string | null>(null);

  useEffect(() => {
    fetchLiveAndPremieres();
  }, []);

  const fetchLiveAndPremieres = async () => {
    try {
      const [lRes, pRes] = await Promise.all([
        fetch('/api/livestreams'),
        fetch('/api/premieres'),
      ]);
      if (lRes.ok) {
        const lData = await lRes.json();
        setLivestreams(lData.livestreams || []);
        if (lData.livestreams && lData.livestreams.length > 0) {
          setActiveStream(lData.livestreams[0]);
        }
      }
      if (pRes.ok) {
        const pData = await pRes.json();
        setPremieres(pData.premieres || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuthModal('login');
      return;
    }
    if (!chatInput.trim()) return;

    setLiveChatMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        user: user.full_name,
        text: chatInput.trim(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setChatInput('');
  };

  const handleSetReminder = (title: string) => {
    setReminderSet(title);
    setTimeout(() => setReminderSet(null), 3000);
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Title */}
      <div className="rounded-3xl bg-gradient-to-r from-rose-950/40 via-[#0e1424] to-cyan-950/30 border border-rose-900/40 p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
        <div className="space-y-2 text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start gap-2 text-rose-400 text-xs font-semibold">
            <Radio className="w-4 h-4 animate-pulse" />
            <span className="uppercase tracking-wider">Interactive Nollywood Stage</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold font-display text-white">
            Creator Livestreams & Premieres
          </h1>
          <p className="text-xs text-slate-300 max-w-xl">
            Watch live director commentary, interactive Q&A sessions, and countdown to upcoming Nollywood world premieres.
          </p>
        </div>
      </div>

      {/* Main Active Livestream with Real-Time Live Chat */}
      {activeStream && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="relative aspect-video rounded-3xl overflow-hidden bg-black border border-slate-800 shadow-2xl">
              <video
                src={activeStream.stream_url}
                controls
                autoPlay
                muted
                playsInline
                className="w-full h-full object-contain"
              />
              <div className="absolute top-4 left-4 flex items-center gap-2">
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-600 text-white text-[10px] font-bold uppercase tracking-wider animate-pulse shadow-md">
                  <Radio className="w-3 h-3" />
                  LIVE
                </span>
                <span className="px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-white text-[10px] font-mono border border-white/20">
                  {activeStream.viewer_count} Viewers
                </span>
              </div>
            </div>

            <div className="bg-[#0d121d] border border-slate-800 rounded-3xl p-6 space-y-2">
              <h2 className="text-lg font-bold text-white">{activeStream.title}</h2>
              <p className="text-xs text-cyan-400 font-medium">Hosted by {activeStream.creator_name}</p>
              <p className="text-xs text-slate-300">{activeStream.description}</p>
            </div>
          </div>

          {/* Live Chat Box */}
          <div className="bg-[#0d121d] border border-slate-800 rounded-3xl p-5 flex flex-col h-[480px] justify-between">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-cyan-400" />
                <span>Live Audience Chat</span>
              </h3>
              <span className="text-[10px] text-slate-500 font-mono">Real-time</span>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto custom-scrollbar py-3 space-y-2.5 text-xs">
              {liveChatMessages.map((msg) => (
                <div key={msg.id} className="p-2 bg-slate-900/60 rounded-xl border border-slate-800/60">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                    <span className="font-semibold text-cyan-300">{msg.user}</span>
                    <span>{msg.time}</span>
                  </div>
                  <p className="text-slate-200">{msg.text}</p>
                </div>
              ))}
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendChat} className="pt-3 border-t border-slate-800 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={user ? 'Send message...' : 'Sign in to chat...'}
                disabled={!user}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                disabled={!user || !chatInput.trim()}
                className="p-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl transition-colors disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Upcoming Premieres */}
      <div className="space-y-4 pt-6 border-t border-slate-800">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Calendar className="w-5 h-5 text-cyan-400" />
          <span>Scheduled World Premieres</span>
        </h3>

        {reminderSet && (
          <div className="p-3 bg-emerald-950/80 border border-emerald-700 rounded-2xl text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Reminder set for "{reminderSet}"!</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {premieres.map((prem) => (
            <div
              key={prem.id}
              className="p-5 bg-[#0d121d] border border-slate-800 rounded-2xl flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3.5">
                <img
                  src={prem.movie_poster || '/posters/abuja_cipher.jpg'}
                  alt={prem.movie_title}
                  className="w-14 aspect-[3/4] object-cover rounded-xl border border-slate-700"
                />
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-cyan-300 bg-cyan-950 px-2 py-0.5 rounded uppercase">
                    Upcoming Premiere
                  </span>
                  <h4 className="text-sm font-bold text-white">{prem.movie_title}</h4>
                  <p className="text-xs text-slate-400">{prem.creator_name}</p>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Countdown: {new Date(prem.scheduled_for).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <button
                onClick={() => handleSetReminder(prem.movie_title)}
                className="py-2 px-3.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>Notify Me</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
