import { useCallback, useEffect, useMemo, useState } from 'react';
import { Tag } from 'lucide-react';
import { Clock, TrendingDown, TrendingUp } from 'lucide-react';
import {
  VaultApiError,
  correctAcquisition,
  fetchAcquisitions,
  formatDate,
  formatValue,
  readStoredToken,
  variantLabelWide,
  acquisitionTypeLabels,
  verificationLabels,
  vaultCall,
  type AcquisitionHistoryEntry,
} from './vaultApi';
import { Modal } from './SignedVaultApp';

const typePillTone: Record<string, string> = {
  unconfirmed: 'vault-pill-gold',
  manual_addition: 'vault-pill-blue',
  booth_purchase: 'vault-pill-green',
  trade: 'vault-pill-blue',
  sync: 'vault-pill-gray',
};

const verifyPillTone: Record<string, string> = {
  verified: 'vault-pill-green',
  community_verified: 'vault-pill-green',
  unverified: 'vault-pill-gold',
  needs_review: 'vault-pill-red',
};

export function AcquisitionsPage({ isOwner, myCollectorNo, onRefresh }: {
  isOwner: boolean;
  myCollectorNo: number;
  onRefresh: () => Promise<void>;
}) {
  const [entries, setEntries] = useState<AcquisitionHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<number>(myCollectorNo);
  const [category, setCategory] = useState('all');
  const [signer, setSigner] = useState('all');
  const [type, setType] = useState('trade');
  const [verification, setVerification] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [editing, setEditing] = useState<AcquisitionHistoryEntry | null>(null);
  const [detail, setDetail] = useState<AcquisitionHistoryEntry | null>(null);
  const [layout, setLayout] = useState<'timeline' | 'table'>('timeline');
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const load = useCallback(async (scope: number) => {
    const token = readStoredToken();
    if (!token) return;
    try {
      const list = await fetchAcquisitions(token, scope === myCollectorNo ? null : scope);
      setEntries(list);
      setError(null);
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Trade history could not be loaded.');
      setEntries([]);
    }
  }, [myCollectorNo]);

  useEffect(() => { void load(view); }, [load, view]);

  const importHistory = async () => {
    setSyncingHistory(true);
    setSyncMessage(null);
    setError(null);
    try {
      const result = await vaultCall('biggames-history-sync', { collector_no: view });
      setSyncMessage('Scanned ' + Number(result.trades_scanned ?? 0) + ' trades and ' + Number(result.booth_transactions_scanned ?? 0) + ' booth transactions. Found ' + Number(result.pet_acquisitions_found ?? 0) + ' pet entries; imported ' + Number(result.newly_imported ?? 0) + ' new entries. Exact prices are shown only when BIG Games provides them.');
      await load(view);
      await onRefresh();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Trade history import failed. Check that BIG Games trades:read and booth:read scopes are enabled, then reconnect.');
    } finally {
      setSyncingHistory(false);
    }
  };

  const filtered = useMemo(() => {
    if (!entries) return [];
    let list = entries.filter((entry) => {
      if (category !== 'all' && (entry.pet_category ?? 'other') !== category) return false;
      if (signer !== 'all' && (entry.signer_id ?? 'none') !== signer) return false;
      const entryType = entry.acquisition_type ?? 'unconfirmed';
      if (type === 'trade' && entryType !== 'trade') return false;
      if (type !== 'all' && type !== 'trade' && entryType !== type) return false;
      if (verification !== 'all' && (entry.verification_status ?? 'unverified') !== verification) return false;
      const date = entry.acquired_at ?? entry.created_at.slice(0, 10);
      if (from && date < from) return false;
      if (to && date > to) return false;
      return true;
    });
    if (sort === 'oldest') list = [...list].reverse();
    if (sort === 'highest') list = [...list].sort((a, b) => Number(b.purchase_price ?? 0) - Number(a.purchase_price ?? 0));
    if (sort === 'lowest') list = [...list].sort((a, b) => Number(a.purchase_price ?? 0) - Number(b.purchase_price ?? 0));
    return list;
  }, [entries, category, signer, type, verification, from, to, sort]);

  const categories = useMemo(
    () => [...new Set((entries ?? []).map((entry) => entry.pet_category ?? 'other'))].sort(),
    [entries]
  );
  const signersList = useMemo(
    () => [...new Map((entries ?? []).filter((entry) => entry.signer_id).map((entry) => [entry.signer_id!, entry.signer_name!])).entries()],
    [entries]
  );

  const total = filtered.reduce((sum, entry) => sum + Number(entry.purchase_price ?? 0), 0);

  // Honest origin labeling: only confirmed sources may be called "confirmed".
  const typeOrigin = (entry: AcquisitionHistoryEntry): { label: string; tone: string } => {
    const type = entry.acquisition_type ?? 'unconfirmed';
    if (type === 'unconfirmed') return { label: 'Unconfirmed', tone: 'vault-pill-gray' };
    if (type === 'sync') return { label: 'Auto-detected (inventory scan)', tone: 'vault-pill-blue' };
    if (entry.verification_status === 'verified' || entry.verification_status === 'community_verified') {
      return { label: `Confirmed purchase — ${acquisitionTypeLabels[type] ?? type}`, tone: 'vault-pill-green' };
    }
    return { label: `Recorded — ${acquisitionTypeLabels[type] ?? type}`, tone: 'vault-pill-gold' };
  };

  return (
    <div>
      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Trade history</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>{filtered.length} entries</h3>
        </div>
        <div className="vault-row">
          <div className="vault-tabs">
            <button className={`vault-tab${layout === 'timeline' ? ' active' : ''}`} onClick={() => setLayout('timeline')}>
              <Clock size={12} /> Timeline
            </button>
            <button className={`vault-tab${layout === 'table' ? ' active' : ''}`} onClick={() => setLayout('table')}>
              <Tag size={12} /> Table
            </button>
          </div>
          {isOwner && (
            <div className="vault-tabs">
              <button className={`vault-tab${view === myCollectorNo ? ' active' : ''}`} onClick={() => setView(myCollectorNo)}>Mine</button>
              <button className={`vault-tab${view === (myCollectorNo === 1 ? 2 : 1) ? ' active' : ''}`} onClick={() => setView(myCollectorNo === 1 ? 2 : 1)}>Collector 2</button>
            </div>
          )}
          <button className="vault-btn vault-btn-gold vault-btn-sm" disabled={syncingHistory} onClick={() => void importHistory()}><Clock size={12} /> {syncingHistory ? "Importing…" : "Import past trades"}</button>
          <span className="vault-pill vault-pill-gold"><Tag size={11} /> Total {formatValue(total)}</span>
        </div>
      </div>

      <div className="vault-card" style={{ marginBottom: 16 }}>
        <div className="vault-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <div className="vault-field">
            <span className="vault-label">From</span>
            <input className="vault-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="vault-field">
            <span className="vault-label">To</span>
            <input className="vault-input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className="vault-field">
            <span className="vault-label">Category</span>
            <select className="vault-select" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All</option>
              {categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          </div>
          <div className="vault-field">
            <span className="vault-label">Signer</span>
            <select className="vault-select" value={signer} onChange={(event) => setSigner(event.target.value)}>
              <option value="all">All</option>
              <option value="none">Unknown</option>
              {signersList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          <div className="vault-field">
            <span className="vault-label">Type</span>
            <select className="vault-select" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="trade">Trades only</option>
              <option value="all">All acquisition records</option>
              {Object.entries(acquisitionTypeLabels).filter(([key]) => key !== 'trade').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <div className="vault-field">
            <span className="vault-label">Verification</span>
            <select className="vault-select" value={verification} onChange={(event) => setVerification(event.target.value)}>
              <option value="all">All</option>
              <option value="verified">Verified</option>
              <option value="community_verified">Community verified</option>
              <option value="unverified">Unverified</option>
              <option value="needs_review">Needs review</option>
            </select>
          </div>
          <div className="vault-field">
            <span className="vault-label">Sort</span>
            <select className="vault-select" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="highest">Highest price</option>
              <option value="lowest">Lowest price</option>
            </select>
          </div>
        </div>
      </div>

      {syncMessage && <div className="vault-success" style={{ marginBottom: 12 }}>{syncMessage}</div>}
      {error && <div className="vault-error" style={{ marginBottom: 12 }}>{error}</div>}
      {!entries ? (
        <div className="vault-loading"><div className="vault-spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="vault-empty">
          <div className="vault-empty-title">No trade history imported yet</div>
          <div>Import your available BIG Games trade and booth history. Older entries appear only if they are still included in the save snapshot.</div>
        </div>
      ) : layout === 'timeline' ? (
        <div className="vault-timeline">
          {filtered.map((entry) => {
            const origin = typeOrigin(entry);
            const current = Number(entry.current_value ?? 0);
            const atAcq = Number(entry.signature_value_at_acquisition ?? 0) + Number(entry.purchase_price ?? 0);
            const delta = current > 0 && atAcq > 0 ? current - atAcq : null;
            return (
              <div key={entry.id} className="vault-timeline-row">
                <div className="vault-timeline-dot" />
                {entry.pet_image
                  ? <img className="vault-timeline-img" src={entry.pet_image} alt={entry.pet_name} loading="lazy" />
                  : <div className="vault-timeline-img vault-timeline-img-fallback"><Tag size={16} /></div>}
                <button className="vault-timeline-main" onClick={() => setDetail(entry)}>
                  <div className="vault-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{entry.pet_name}</span>
                    <span className="vault-note">{entry.signer_name ?? 'Unknown signer'} · {variantLabelWide[entry.variant] ?? entry.variant}</span>
                  </div>
                  <div className="vault-row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    <span className={`vault-pill ${origin.tone}`}>{origin.label}</span>
                    <span className={`vault-pill ${verifyPillTone[entry.verification_status ?? 'unverified'] ?? 'vault-pill-gray'}`}>
                      {verificationLabels[entry.verification_status ?? 'unverified']}
                    </span>
                    <span className="vault-note">
                      {formatDate(entry.acquired_at ?? entry.created_at)}
                      {entry.collector_no !== myCollectorNo ? ` · collector ${entry.collector_no}` : ''}
                    </span>
                  </div>
                </button>
                <div className="vault-timeline-aside">
                  <div className="vault-num" style={{ fontWeight: 700 }}>
                    {entry.purchase_price != null ? formatValue(entry.purchase_price, entry.currency === 'USD' ? '$' : '') : <span className="vault-note">Price not available</span>}
                  </div>
                  <div className="vault-note">Current value {formatValue(entry.current_value)}</div>
                  {delta !== null && (
                    <div className={`vault-note ${delta >= 0 ? 'vault-delta-up' : 'vault-delta-down'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {delta >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                      {delta >= 0 ? '+' : ''}{formatValue(delta)} since acquisition
                    </div>
                  )}
                </div>
                <button className="vault-btn vault-btn-sm" onClick={() => setEditing(entry)}>Correct</button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="vault-table-wrap">
          <table className="vault-table">
            <thead>
              <tr><th>Date</th><th>Pet</th><th>Signer</th><th>Variant</th><th>Price</th><th>Type</th><th>Verification</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.acquired_at ?? entry.created_at)}</td>
                  <td style={{ color: 'var(--text)', fontWeight: 600 }}>{entry.pet_name}</td>
                  <td>{entry.signer_name ?? 'Unknown Signer – Needs Review'}</td>
                  <td>{variantLabelWide[entry.variant] ?? entry.variant}</td>
                  <td className="vault-num">
                    {entry.purchase_price != null ? formatValue(entry.purchase_price) : <span className="vault-note">Not available</span>}
                  </td>
                  <td>
                    <span className={`vault-pill ${typePillTone[entry.acquisition_type ?? 'unconfirmed'] ?? 'vault-pill-gray'}`}>
                      {acquisitionTypeLabels[entry.acquisition_type ?? 'unconfirmed'] ?? entry.acquisition_type}
                    </span>
                  </td>
                  <td>
                    <span className={`vault-pill ${verifyPillTone[entry.verification_status ?? 'unverified'] ?? 'vault-pill-gray'}`}>
                      {(entry.verification_status ?? 'unverified').replace('_', ' ')}
                    </span>
                  </td>
                  <td>
                    <button className="vault-btn vault-btn-sm" onClick={() => setEditing(entry)}>Correct</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <AcquisitionDetailModal
          entry={detail}
          onClose={() => setDetail(null)}
        />
      )}

      {editing && (
        <CorrectionModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load(view);
            await onRefresh();
          }}
        />
      )}
    </div>
  );
}

function CorrectionModal({ entry, onClose, onSaved }: {
  entry: AcquisitionHistoryEntry;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [price, setPrice] = useState(entry.purchase_price != null ? String(entry.purchase_price) : '');
  const [currency, setCurrency] = useState(entry.currency ?? 'USD');
  const [type, setType] = useState(entry.acquisition_type ?? 'unconfirmed');
  const [date, setDate] = useState(entry.acquired_at ?? '');
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = readStoredToken() ?? '';
      await correctAcquisition(token, entry.id, {
        purchase_price: price.trim() ? Number(price) : null,
        currency: currency || null,
        acquisition_type: type,
        acquired_at: date || null,
        notes: notes.trim() ? notes.trim() : null,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not save the correction.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Correct — ${entry.pet_name}`} onClose={onClose}>
      <p className="vault-note" style={{ marginBottom: 12 }}>
        Every change is logged with who changed it and what was changed. Fields left empty keep their current value.
      </p>
      <div className="vault-form-grid">
        <div className="vault-field">
          <span className="vault-label">Purchase price</span>
          <input className="vault-input" type="number" min="0" step="any" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Not available" />
        </div>
        <div className="vault-field">
          <span className="vault-label">Currency</span>
          <select className="vault-select" value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="ROBUX">Robux</option>
          </select>
        </div>
        <div className="vault-field">
          <span className="vault-label">Acquisition type</span>
          <select className="vault-select" value={type} onChange={(event) => setType(event.target.value)}>
            {Object.entries(acquisitionTypeLabels).filter(([key]) => key !== 'sync').map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div className="vault-field">
          <span className="vault-label">Acquired on</span>
          <input className="vault-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
      </div>
      <div className="vault-field" style={{ marginTop: 10 }}>
        <span className="vault-label">Notes</span>
        <textarea className="vault-input" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      {error && <div className="vault-error" style={{ marginTop: 10 }}>{error}</div>}
      <div className="vault-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="vault-btn" onClick={onClose}>Cancel</button>
        <button className="vault-btn vault-btn-gold" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save correction'}</button>
      </div>
    </Modal>
  );
}

function AcquisitionDetailModal({ entry, onClose }: { entry: AcquisitionHistoryEntry; onClose: () => void }) {
  const origin = ((): string => {
    const type = entry.acquisition_type ?? 'unconfirmed';
    if (type === 'unconfirmed') return 'Unconfirmed — no evidence recorded yet. This entry is NOT a confirmed purchase.';
    if (type === 'sync') return 'Auto-detected from an inventory scan.';
    if (entry.verification_status === 'verified' || entry.verification_status === 'community_verified') {
      return `Confirmed purchase (${acquisitionTypeLabels[type] ?? type}).`;
    }
    return `Recorded as ${acquisitionTypeLabels[type] ?? type} — pending confirmation.`;
  })();

  return (
    <Modal title={entry.pet_name} onClose={onClose}>
      <p className="vault-note" style={{ marginBottom: 12 }}>{origin}</p>
      <div className="vault-form-grid">
        <div className="vault-field"><span className="vault-label">Collector</span><div>Collector {entry.collector_no}</div></div>
        <div className="vault-field"><span className="vault-label">Signer</span><div>{entry.signer_name ?? 'Unknown signer — needs review'}</div></div>
        <div className="vault-field"><span className="vault-label">Variant</span><div>{variantLabelWide[entry.variant] ?? entry.variant}</div></div>
        <div className="vault-field"><span className="vault-label">Category</span><div>{entry.pet_category ?? '—'}</div></div>
        <div className="vault-field"><span className="vault-label">Acquired</span><div>{formatDate(entry.acquired_at ?? entry.created_at)}</div></div>
        <div className="vault-field"><span className="vault-label">Price</span><div>{entry.purchase_price != null ? `${formatValue(entry.purchase_price)} ${entry.currency}` : 'Not available'}</div></div>
        <div className="vault-field"><span className="vault-label">Value at acquisition</span><div>{entry.signature_value_at_acquisition != null ? formatValue(entry.signature_value_at_acquisition) : 'Not recorded'}</div></div>
        <div className="vault-field"><span className="vault-label">Current value</span><div>{entry.current_value != null ? formatValue(entry.current_value) : 'Not recorded'}</div></div>
        <div className="vault-field"><span className="vault-label">Source</span><div>{entry.source}</div></div>
        <div className="vault-field"><span className="vault-label">Verification</span><div>{verificationLabels[entry.verification_status ?? 'unverified']}</div></div>
      </div>
      {entry.updated_by && (
        <p className="vault-note" style={{ marginTop: 10 }}>
          Last corrected by {entry.updated_by} on {formatDate(entry.updated_at)}.
        </p>
      )}
      {entry.notes && <p className="vault-note" style={{ marginTop: 10 }}>{entry.notes}</p>}
      <div className="vault-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="vault-btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
