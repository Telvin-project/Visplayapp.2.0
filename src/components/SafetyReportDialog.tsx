import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type ReportTarget = 'movie' | 'comment' | 'creator' | 'user';
const reasons = [
  ['spam', 'Spam or scam'], ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate or discrimination'], ['sexual_content', 'Sexual content'],
  ['violence', 'Graphic or violent content'], ['copyright', 'Copyright or distribution rights'],
  ['privacy', 'Privacy violation'], ['other', 'Something else'],
];

export const SafetyReportDialog: React.FC<{
  targetType: ReportTarget; targetId: string; targetLabel: string; onClose: () => void;
}> = ({ targetType, targetId, targetLabel, onClose }) => {
  const { user, openAuthModal } = useAuth();
  const [reason, setReason] = useState('harassment');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) { onClose(); openAuthModal('login'); return; }
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/safety/reports', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: targetType, target_id: targetId, reason, description }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Report could not be submitted.');
      setReceipt(data.report_id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Please try again.'); }
    finally { setPending(false); }
  };

  return (
    <div role="presentation" className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 px-4 py-8" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="visplay-report-title" className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#101625] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="visplay-report-title" className="flex items-center gap-2 text-lg font-bold text-white"><AlertTriangle className="h-5 w-5 text-amber-400" /> Report {targetType}</h2>
            <p className="mt-1 text-xs text-slate-400">{targetLabel}. Reviewed privately by VisPlay moderators.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close report dialog" className="rounded-lg p-2 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        {receipt ? (
          <div className="mt-5 space-y-3 text-sm"><p className="text-emerald-300">Report received for human review.</p><p className="break-all text-xs text-slate-400">Case reference: {receipt}</p><button onClick={onClose} className="rounded-lg bg-cyan-400 px-4 py-2 font-bold text-slate-950">Close</button></div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block text-xs font-medium text-slate-300">Reason
              <select value={reason} onChange={event => setReason(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-sm text-white">
                {reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-300">What happened? (10–1200 characters)
              <textarea required minLength={10} maxLength={1200} rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder="Describe the concern. Do not include passwords or private documents." className="mt-2 w-full resize-y rounded-lg border border-slate-600 bg-slate-900 p-3 text-sm text-white" />
            </label>
            {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancel</button><button type="submit" disabled={pending || description.trim().length < 10} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{pending ? 'Submitting…' : user ? 'Submit report' : 'Sign in to report'}</button></div>
          </form>
        )}
      </div>
    </div>
  );
};
