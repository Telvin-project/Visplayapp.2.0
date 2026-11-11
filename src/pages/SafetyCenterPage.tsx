import React, { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, Ban, Scale, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type SafetyReportView = { id: string; target_type: string; target_id: string; reason: string; description: string; status: string; created_at: string };
type SafetyBlockView = { id: string; user_id: string; display_name: string; created_at: string };
type SafetyAppealView = { id: string; report_id: string; status: string; created_at: string };
type SafetyContact = { support_email: string | null; copyright_email: string | null; privacy_email: string | null; employer_legal_approval_required: boolean };

export const SafetyCenterPage: React.FC = () => {
  const { user, openAuthModal } = useAuth();
  const [reports, setReports] = useState<SafetyReportView[]>([]);
  const [blocks, setBlocks] = useState<SafetyBlockView[]>([]);
  const [appeals, setAppeals] = useState<SafetyAppealView[]>([]);
  const [contacts, setContacts] = useState<SafetyContact | null>(null);
  const [appealFor, setAppealFor] = useState('');
  const [appealText, setAppealText] = useState('');
  const [message, setMessage] = useState('');

  const refresh = async () => {
    try {
      const config = await fetch('/api/safety/config');
      if (config.ok) setContacts(await config.json());
      if (!user) { setReports([]); setBlocks([]); setAppeals([]); return; }
      const responses = await Promise.all([
        fetch('/api/safety/my-reports'), fetch('/api/safety/blocks'), fetch('/api/safety/my-appeals'),
      ]);
      if (responses[0].ok) setReports((await responses[0].json()).reports || []);
      if (responses[1].ok) setBlocks((await responses[1].json()).blocks || []);
      if (responses[2].ok) setAppeals((await responses[2].json()).appeals || []);
    } catch { setMessage('Could not load safety records. Please try again later.'); }
  };
  useEffect(() => { void refresh(); }, [user?.id]);

  const unblock = async (id: string) => {
    try {
      const response = await fetch(`/api/safety/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Unblock unsuccessful.');
      setMessage('Account unblocked.');
      void refresh();
    } catch { setMessage('Could not unblock this account.'); }
  };

  const appeal = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await fetch('/api/safety/appeals', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_id: appealFor, statement: appealText }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return void setMessage(data.error || 'Appeal could not be filed.');
    setMessage(`Appeal submitted: ${data.appeal_id}`);
    setAppealFor(''); setAppealText('');
    void refresh();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-7 pb-16 text-slate-200">
      <header className="rounded-2xl border border-cyan-800/50 bg-slate-900 p-6"><h1 className="flex items-center gap-3 text-2xl font-bold text-white"><ShieldCheck className="h-7 w-7 text-cyan-400" /> VisPlay Safety Center</h1><p className="mt-2 text-sm text-slate-400">Report unsafe content and accounts, manage blocks, see your report statuses, and ask for a human appeal.</p></header>
      {message && <p role="status" className="rounded-lg border border-cyan-900 bg-cyan-950/40 p-3 text-sm text-cyan-200">{message}</p>}
      <section className="rounded-2xl border border-slate-800 bg-[#101625] p-5 space-y-3"><h2 className="flex items-center gap-2 font-bold text-white"><AlertTriangle className="h-5 w-5 text-amber-400" /> How to report</h2><p className="text-sm text-slate-300">Open a film, creator channel or comment and choose “Report”. Select a reason and describe what happened. Urgent threats, exploitation and copyright notices must also be escalated to the responsible human team.</p><p className="text-xs text-amber-300">Platform policy and contact details require final employer/legal approval before public launch. Do not submit personal documents or passwords in reports.</p></section>
      <section className="rounded-2xl border border-slate-800 bg-[#101625] p-5 space-y-3"><h2 className="flex items-center gap-2 font-bold text-white"><Mail className="h-5 w-5 text-cyan-400" /> Human assistance and rights notices</h2>
        {([['General support', contacts?.support_email], ['Copyright / takedown notices', contacts?.copyright_email], ['Privacy / data rights', contacts?.privacy_email]] as const).map(([label, email]) => <div key={label} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 py-2 text-sm"><span>{label}</span>{email ? <a className="break-all text-cyan-300 underline" href={`mailto:${email}`}>{email}</a> : <span className="text-amber-300">Employer must supply verified contact</span>}</div>)}
      </section>
      {!user ? <section className="rounded-2xl border border-slate-800 p-6 text-sm">Sign in to view your reports or blocked accounts. <button onClick={() => openAuthModal('login')} className="ml-2 font-semibold text-cyan-300 underline">Sign in</button></section> : <>
        <section className="rounded-2xl border border-slate-800 bg-[#101625] p-5 space-y-3"><h2 className="flex items-center gap-2 font-bold text-white"><ShieldCheck className="h-5 w-5" /> My safety reports ({reports.length})</h2>
          {reports.length ? reports.map(report => <div key={report.id} className="rounded-lg border border-slate-800 p-3 text-xs"><p className="font-semibold text-white">{report.target_type}: {report.target_id} · {report.reason}</p><p className="mt-1 text-slate-400">{report.id} · {new Date(report.created_at).toLocaleString()} · Status: <span className="text-cyan-300">{report.status}</span></p><p className="mt-2 text-slate-300">{report.description}</p>{['actioned', 'dismissed'].includes(report.status) && <button onClick={() => { setAppealFor(report.id); setMessage('Enter your appeal below.'); }} className="mt-2 font-semibold text-cyan-300 underline">Appeal this decision</button>}</div>) : <p className="text-sm text-slate-500">No reports yet.</p>}
        </section>
        <section className="rounded-2xl border border-slate-800 bg-[#101625] p-5 space-y-3"><h2 className="flex items-center gap-2 font-bold text-white"><Ban className="h-5 w-5" /> Blocked accounts ({blocks.length})</h2>
          {blocks.length ? blocks.map(block => <div key={block.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 p-3 text-sm"><span>{block.display_name}</span><button onClick={() => unblock(block.user_id)} className="rounded-lg border border-slate-600 px-3 py-1 text-xs text-cyan-300">Unblock</button></div>) : <p className="text-sm text-slate-500">No blocked accounts.</p>}
        </section>
        <section className="rounded-2xl border border-slate-800 bg-[#101625] p-5 space-y-3"><h2 className="flex items-center gap-2 font-bold text-white"><Scale className="h-5 w-5" /> Appeal a moderation decision</h2><p className="text-xs text-slate-400">If an appeal is accepted, a separate safety restoration review may still be required; removed content is not automatically restored.</p><form onSubmit={appeal} className="space-y-3"><label className="block text-xs">Case reference<input value={appealFor} onChange={event => setAppealFor(event.target.value)} placeholder="saf_..." required className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm" /></label><label className="block text-xs">Why should the decision be reconsidered?<textarea value={appealText} onChange={event => setAppealText(event.target.value)} required minLength={15} maxLength={1200} rows={3} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm" /></label><button type="submit" className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950">Submit appeal</button></form><h3 className="pt-2 text-sm font-semibold">My appeals</h3>{appeals.length ? appeals.map(item => <p key={item.id} className="text-xs text-slate-300">{item.id} · Report {item.report_id} · {item.status}</p>) : <p className="text-xs text-slate-500">No appeals yet.</p>}</section>
      </>}
    </div>
  );
};
