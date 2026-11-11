import React, { useEffect, useState } from 'react';

type SafetyCase = {
  id: string; reporter_user_id: string; target_type: string; target_id: string;
  reason: string; description: string; status: string; created_at: string;
  decision_note?: string; enforcement_action?: string;
};
type SafetyAppeal = { id: string; report_id: string; appellant_user_id: string; statement: string; status: string; restored_at?: string; created_at: string };

export const SafetyModerationQueue: React.FC = () => {
  const [reports, setReports] = useState<SafetyCase[]>([]);
  const [appeals, setAppeals] = useState<SafetyAppeal[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  const refresh = async () => {
    const response = await fetch('/api/admin/safety/reports');
    if (!response.ok) return void setFeedback('Unable to load safety reports. Check admin sign-in.');
    const data = await response.json();
    setReports(data.reports || []);
    setAppeals(data.appeals || []);
  };
  useEffect(() => { void refresh(); }, []);

  const reviewReport = async (report: SafetyCase, status: string) => {
    const note = (notes[report.id] || '').trim();
    if (note.length < 12) return void setFeedback('Write a clear review reason with at least 12 characters.');
    const action = status === 'actioned' ? (actions[report.id] || 'none') : 'none';
    setBusy(report.id);
    try {
      const response = await fetch(`/api/admin/safety/reports/${encodeURIComponent(report.id)}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, decision_note: note, enforcement_action: action }),
      });
      const data = await response.json().catch(() => ({}));
      setFeedback(response.ok ? `Case ${report.id} updated to ${status}.` : data.error || 'Review failed.');
      if (response.ok) void refresh();
    } catch { setFeedback('Could not contact moderation service.'); }
    finally { setBusy(null); }
  };

  const reviewAppeal = async (item: SafetyAppeal, outcome: string) => {
    const note = (notes[item.id] || '').trim();
    if (note.length < 12) return void setFeedback('Record the appeal decision reason first.');
    setBusy(item.id);
    try {
      const response = await fetch(`/api/admin/safety/appeals/${encodeURIComponent(item.id)}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome, decision_note: note }),
      });
      const data = await response.json().catch(() => ({}));
      setFeedback(response.ok ? `Appeal ${item.id}: ${outcome}. Restoration, if needed, is a separate operator action.` : data.error || 'Appeal review failed.');
      if (response.ok) void refresh();
    } catch { setFeedback('Could not contact moderation service.'); }
    finally { setBusy(null); }
  };

  const restoreAppeal = async (item: SafetyAppeal) => {
    const note = (notes[item.id] || '').trim();
    if (note.length < 20) return void setFeedback('Document your restoration safety review in at least 20 characters.');
    if (!window.confirm('Have you checked for other active cases and completed any new rights review required?')) return;
    setBusy(item.id);
    try {
      const response = await fetch(`/api/admin/safety/appeals/${encodeURIComponent(item.id)}/restore`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restoration_note: note }),
      });
      const data = await response.json().catch(() => ({}));
      setFeedback(response.ok ? `Appeal ${item.id}: item restored with audit record.` : data.error || 'Restoration blocked.');
      if (response.ok) void refresh();
    } catch { setFeedback('Could not contact the restoration service.'); }
    finally { setBusy(null); }
  };

  return <div className="space-y-5">
    <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-xs text-amber-200">
      Human review is mandatory. Do not publish private reporter details. Copyright and child-safety allegations require prompt specialist escalation; adjudication and legal obligations remain employer responsibilities.
    </div>
    {feedback && <p role="status" className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs text-cyan-200">{feedback}</p>}
    <h2 className="text-lg font-bold text-white">Safety reports ({reports.filter(item => item.status === 'open' || item.status === 'reviewing').length} pending)</h2>
    {reports.length === 0 && <p className="text-sm text-slate-400">No safety reports received.</p>}
    {reports.map(report => <article key={report.id} className="space-y-3 rounded-xl border border-slate-800 bg-[#0d121d] p-4 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-white">{report.target_type} · {report.reason} <span className="text-xs text-slate-400">({report.status})</span></h3><span className="text-xs text-slate-500">{new Date(report.created_at).toLocaleString()}</span></div>
      <p className="break-all text-xs text-slate-400">Case {report.id} · target {report.target_id}</p><p className="whitespace-pre-wrap break-words text-xs text-slate-200">{report.description}</p>
      {report.status === 'open' || report.status === 'reviewing' ? <>
        <label className="block text-xs text-slate-400">Case decision notes<textarea value={notes[report.id] || ''} onChange={event => setNotes(previous => ({ ...previous, [report.id]: event.target.value }))} maxLength={1000} rows={2} placeholder="Document actual evidence checked, policy basis and escalation." className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white" /></label>
        <label className="block text-xs text-slate-400">Enforcement action<select value={actions[report.id] || 'none'} onChange={event => setActions(previous => ({ ...previous, [report.id]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"><option value="none">None (investigate / dismiss)</option>{report.target_type === 'comment' && <option value="hide_comment">Hide reported comment</option>}{report.target_type === 'movie' && <option value="hold_movie">Hold reported film</option>}{report.target_type === 'creator' && <option value="restrict_creator">Restrict creator uploads</option>}{report.target_type === 'user' && <option value="restrict_user">Restrict user social activity</option>}</select></label>
        <div className="flex flex-wrap gap-2"><button disabled={busy === report.id} onClick={() => reviewReport(report, 'reviewing')} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200">Mark investigating</button><button disabled={busy === report.id} onClick={() => reviewReport(report, 'actioned')} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white">Take selected action</button><button disabled={busy === report.id} onClick={() => reviewReport(report, 'dismissed')} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white">Dismiss with reason</button></div>
      </> : <p className="text-xs text-slate-400">Decision: {report.enforcement_action || 'none'} — {report.decision_note || 'No notes recorded'}</p>}
    </article>)}
    <h2 className="pt-5 text-lg font-bold text-white">Appeals ({appeals.filter(item => item.status === 'open' || item.status === 'reviewing').length} pending)</h2>
    {appeals.length === 0 && <p className="text-sm text-slate-400">No appeals received.</p>}
    {appeals.map(item => <article key={item.id} className="rounded-xl border border-slate-800 bg-[#0d121d] p-4 text-xs space-y-3"><p className="font-semibold text-white">Appeal {item.id} · {item.status}{item.restored_at ? ' · Restored' : ''}</p><p className="break-all text-slate-400">Case: {item.report_id}</p><p className="whitespace-pre-wrap break-words text-slate-200">{item.statement}</p>{['open', 'reviewing', 'upheld'].includes(item.status) && !item.restored_at && <><textarea value={notes[item.id] || ''} onChange={event => setNotes(previous => ({ ...previous, [item.id]: event.target.value }))} placeholder={item.status === 'upheld' ? 'Describe restoration checks, new rights evidence and why restoration is safe.' : 'Give the appeal decision rationale.'} rows={2} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" /><div className="flex flex-wrap gap-2">{item.status === 'upheld' ? <button disabled={busy === item.id} onClick={() => restoreAppeal(item)} className="rounded-lg bg-emerald-700 px-3 py-2">Restore after separate review</button> : <><button disabled={busy === item.id} onClick={() => reviewAppeal(item, 'upheld')} className="rounded-lg bg-cyan-700 px-3 py-2">Uphold appeal</button><button disabled={busy === item.id} onClick={() => reviewAppeal(item, 'rejected')} className="rounded-lg bg-slate-700 px-3 py-2">Reject appeal</button></>}</div></>}</article>)}
  </div>;
};
