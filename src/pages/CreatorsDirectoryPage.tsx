import React, { useState, useEffect } from 'react';
import { CreatorProfile } from '../types';
import { Users, ShieldCheck, Film, ArrowRight } from 'lucide-react';

interface CreatorsDirectoryPageProps {
  onSelectCreator: (id: string) => void;
  onOpenApply: () => void;
}

export const CreatorsDirectoryPage: React.FC<CreatorsDirectoryPageProps> = ({
  onSelectCreator,
  onOpenApply,
}) => {
  const [creators, setCreators] = useState<CreatorProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCreators();
  }, []);

  const fetchCreators = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/creator-applications');
      if (res.ok) {
        const data = await res.json();
        // Show approved creators
        setCreators(data.applications.filter((a: CreatorProfile) => a.status === 'approved'));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 pb-16">
      <div className="rounded-3xl bg-gradient-to-r from-[#0d121d] via-[#101726] to-[#0f1220] border border-slate-800 p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-2xl">
        <div className="space-y-2 text-center sm:text-left">
          <div className="flex items-center justify-center sm:justify-start gap-2 text-cyan-400 text-xs font-semibold">
            <Users className="w-4 h-4" />
            <span className="uppercase tracking-wider">African Filmmaker Directory</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold font-display text-white">
            Nollywood & African Creators
          </h1>
          <p className="text-xs text-slate-300 max-w-xl">
            Explore authentic creator studios distributing independent films directly to African audiences on VisPlay with 85% creator revenue share.
          </p>
        </div>

        <button
          onClick={onOpenApply}
          className="py-3 px-5 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 text-white shadow-lg shrink-0"
        >
          Join as Creator (Apply Now)
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {creators.map((c) => (
            <div
              key={c.id}
              onClick={() => onSelectCreator(c.id)}
              className="group p-5 bg-[#0d121d] hover:bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-3xl transition-all cursor-pointer flex flex-col justify-between space-y-4 shadow-lg"
            >
              <div className="flex items-center gap-3.5">
                <img
                  src={c.channel_avatar_url || '/visplay-symbol.png'}
                  alt={c.channel_name}
                  className="w-14 h-14 rounded-2xl object-cover border border-slate-700 group-hover:border-cyan-400 transition-colors"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                      {c.channel_name}
                    </h3>
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                  </div>
                  <p className="text-xs text-cyan-400 font-medium">{c.content_type}</p>
                </div>
              </div>

              {c.description && (
                <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                  {c.description}
                </p>
              )}

              <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-300">
                <span className="text-[11px] text-emerald-400 font-medium">85% Creator Share</span>
                <span className="flex items-center gap-1 text-cyan-400 group-hover:translate-x-1 transition-transform font-semibold">
                  <span>Visit Channel</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
