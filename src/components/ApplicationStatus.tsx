import { useState } from 'react';
import { CheckCircle2, Clock, FileSearch, RefreshCw, Send, ShieldCheck, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type StatusResult = {
  found: boolean;
  application_id?: string;
  reference_code?: string;
  roblox_username?: string;
  submitted_at?: string;
  status?: string;
  updated_at?: string;
  next_steps?: string;
};

const statusMeta: Record<string, { label: string; tone: 'ok' | 'warn' | 'err' | 'idle' }> = {
  pending: { label: 'Pending', tone: 'idle' },
  under_review: { label: 'Under review', tone: 'warn' },
  more_info_required: { label: 'More information required', tone: 'warn' },
  accepted: { label: 'Accepted', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'err' },
  ticket_closed: { label: 'Ticket closed', tone: 'idle' },
  discord_delivery_failed: { label: 'Queued for staff processing', tone: 'warn' },
};

const statusIcons: Record<string, JSX.Element> = {
  pending: <Clock size={22} />,
  under_review: <FileSearch size={22} />,
  more_info_required: <FileSearch size={22} />,
  accepted: <CheckCircle2 size={22} />,
  rejected: <XCircle size={22} />,
  ticket_closed: <ShieldCheck size={22} />,
  discord_delivery_failed: <RefreshCw size={22} />,
};

export function ApplicationStatus() {
  const [reference, setReference] = useState('');
  const [result, setResult] = useState<StatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    setError(null);
    setResult(null);
    const ref = reference.trim().toUpperCase();
    if (!ref) { setError('Enter your application reference to check your status.'); return; }
    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('application_status_lookup', { p_reference: ref });
      if (rpcError) throw rpcError;
      const rows = (data ?? []) as StatusResult[];
      if (rows.length === 0) { setError('No application was found for that reference. Check the code and try again.'); return; }
      const row = rows[0];
      setResult({ ...row, found: true });
    } catch {
      setError('The status service is unavailable right now. Please try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  const meta = result?.status ? (statusMeta[result.status] ?? { label: result.status, tone: 'idle' as const }) : null;

  return <div className="page-inner status-page">
    <div className="section-header">
      <div>
        <span className="kicker">Application tracking</span>
        <h2>Application <span className="accent-text">status</span></h2>
      </div>
      <span className="trailing-label">Secure reference lookup</span>
    </div>

    <div className="glass-card status-lookup-card">
      <p className="status-intro">Enter the application reference you received when you submitted your application (looks like <b>NANZ-XXXXXX</b>) to see its current status. Only you and NANZ management can see your application details.</p>
      <div className="status-lookup-row">
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') void lookup(); }}
          placeholder="NANZ-XXXXXX"
          maxLength={16}
          spellCheck={false}
        />
        <button className="btn-primary" onClick={() => void lookup()} disabled={loading}>{loading ? 'Checking...' : 'Check status'} <Send size={15} /></button>
      </div>
      {error && <small className="form-error">{error}</small>}
    </div>

    {result?.found && meta && (
      <div className="glass-card status-result-card">
        <div className={`status-result-hero tone-${meta.tone}`}>
          {statusIcons[result.status ?? ''] ?? <Clock size={22} />}
          <div>
            <span className="status-ref-label">Application {result.reference_code}</span>
            <h3>{meta.label}</h3>
          </div>
        </div>
        <p className="status-next-steps">{result.next_steps}</p>
        <div className="status-meta-grid">
          <div><span>Roblox username</span><b>{result.roblox_username}</b></div>
          <div><span>Submitted</span><b>{result.submitted_at ? new Date(result.submitted_at).toLocaleString() : '—'}</b></div>
          <div><span>Last update</span><b>{result.updated_at ? new Date(result.updated_at).toLocaleString() : '—'}</b></div>
        </div>
        <p className="status-privacy-note"><ShieldCheck size={13} /> Staff notes and internal review details are never shown here.</p>
      </div>
    )}
  </div>;
}
