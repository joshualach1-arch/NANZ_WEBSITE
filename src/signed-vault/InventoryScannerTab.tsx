import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, RefreshCw, X } from 'lucide-react';
import {
  dismissNotification,
  fetchScannerData,
  formatDate,
  formatValue,
  readStoredToken,
  vaultCall,
  variantLabelWide,
  type InventoryItem,
  type InventorySnapshot,
  type ScannerData,
  type VaultNotification,
} from './vaultApi';

const signedTone: Record<string, string> = {
  verified: 'vault-pill-green',
  unverified: 'vault-pill-gold',
  not_signed: 'vault-pill-gray',
  manual_review: 'vault-pill-red',
};

const signedShort: Record<string, string> = {
  verified: 'Verified',
  unverified: 'Unverified',
  not_signed: 'Not signed',
  manual_review: 'Needs review',
};

function SyncStatusPill({ status }: { status: InventorySnapshot['status'] }) {
  const tone = status === 'complete' ? 'vault-pill-green' : status === 'failed' ? 'vault-pill-red' : status === 'running' ? 'vault-pill-gold' : 'vault-pill-gray';
  return <span className={`vault-pill ${tone}`}>{status}</span>;
}

export function InventoryScannerTab({ onRefresh, isOwner }: { onRefresh: () => Promise<void>; isOwner: boolean }) {
  const [data, setData] = useState<ScannerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = readStoredToken();
    if (!token) return;
    try {
      const scanner = await fetchScannerData(token);
      setData(scanner);
      setError(null);
    } catch {
      setError('Scanner data could not be loaded.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runSync = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncMessage(null);
    try {
      const result = await vaultCall('biggames-sync', {});
      setSyncMessage(
        `Scan complete: ${result.parsed_pets ?? 0} pets parsed · ${result.signed_found ?? 0} signed · ` +
        `${result.added ?? 0} added · ${result.updated ?? 0} updated · ${result.removed ?? 0} removed · ` +
        `${result.acquisitions ?? 0} acquisitions detected · ${result.verified_notifications ?? 0} verified notifications.`
      );
      await load();
      await onRefresh();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Inventory scan failed. Previous data is untouched.');
    } finally {
      setSyncing(false);
    }
  };

  if (error) {
    return (
      <div className="vault-empty">
        <div className="vault-empty-title">Scanner unavailable</div>
        <div>{error}</div>
      </div>
    );
  }
  if (!data) return <div className="vault-loading"><div className="vault-spinner" /></div>;

  const trackedCategories = new Set(['huge', 'huge pet', 'exclusive', 'exclusive pet', 'titanic', 'titanic pet', 'gargantuan', 'gargantuan pet', 'gigantuan', 'gigantuan pet']);
  const present = data.items.filter((item) =>
    item.present && trackedCategories.has(String(item.category ?? '').trim().toLowerCase())
  );
  const needsReview = present.filter((item) => item.signed_status === 'manual_review' || item.signed_status === 'unverified');
  const verified = present.filter((item) => item.signed_status === 'verified');
  const plain = present.filter((item) => item.signed_status === 'not_signed');
  const lastSnapshot = data.snapshots[0] ?? null;

  return (
    <div>
      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Inventory scanner</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>{present.length} items tracked</h3>
        </div>
        <button className="vault-btn vault-btn-gold" onClick={() => void runSync()} disabled={syncing}>
          <RefreshCw size={15} className={syncing ? 'vault-spin' : ''} /> {syncing ? 'Scanning…' : 'Scan inventory'}
        </button>
      </div>
      {syncMessage && <div className="vault-success" style={{ marginBottom: 12 }}>{syncMessage}</div>}
      {syncError && (
        <div className="vault-error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          {syncError} Your previously collected data is unchanged.
        </div>
      )}

      <div className="vault-stat-grid">
        <div className="vault-card vault-card-gold">
          <div className="vault-stat-label">Verified signed</div>
          <div className="vault-stat-value">{verified.length}</div>
          <div className="vault-stat-hint">signer confirmed</div>
        </div>
        <div className="vault-card">
          <div className="vault-stat-label">Needs review</div>
          <div className="vault-stat-value">{needsReview.length}</div>
          <div className="vault-stat-hint">signed, signer unknown</div>
        </div>
        <div className="vault-card">
          <div className="vault-stat-label">Not signed</div>
          <div className="vault-stat-value">{plain.length}</div>
          <div className="vault-stat-hint">confirmed by the source</div>
        </div>
        <div className="vault-card">
          <div className="vault-stat-label">Last scan</div>
          <div className="vault-stat-value" style={{ fontSize: 20 }}>
            {lastSnapshot ? formatDate(lastSnapshot.started_at) : '—'}
          </div>
          <div className="vault-stat-hint">{lastSnapshot?.status ?? 'no scans yet'}</div>
        </div>
      </div>

      {data.notifications.filter((entry) => !entry.dismissed_at).length > 0 && (
        <>
          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Acquisition alerts</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>New verified signed pets</h3>
            </div>
          </div>
          <div className="vault-grid">
            {data.notifications.filter((entry) => !entry.dismissed_at).map((entry) => (
              <NotificationCard key={entry.id} notification={entry} onDismissed={load} />
            ))}
          </div>
        </>
      )}

      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Tracked inventory</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>All scanned items</h3>
        </div>
      </div>
      {present.length === 0 ? (
        <div className="vault-empty">
          <div className="vault-empty-title">Nothing scanned yet</div>
          <div>Connect the BIG Games account and run a scan to track inventory automatically.</div>
        </div>
      ) : (
        <div className="vault-table-wrap">
          <table className="vault-table">
            <thead>
              <tr><th>Pet</th><th>Category</th><th>Variant</th><th>Qty</th><th>Signer</th><th>Status</th><th>Value</th><th>First seen</th></tr>
            </thead>
            <tbody>
              {present.map((item) => <ItemRow key={item.id} item={item} />)}
            </tbody>
          </table>
        </div>
      )}

      {data.snapshots.length > 0 && (
        <>
          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Sync protocol</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Recent scans</h3>
            </div>
          </div>
          <div className="vault-card">
            {data.snapshots.map((snapshot) => (
              <div key={snapshot.id} className="vault-row" style={{ padding: '6px 0', flexWrap: 'wrap' }}>
                <SyncStatusPill status={snapshot.status} />
                <span className="vault-note">{snapshot.completed_at ? new Date(snapshot.completed_at).toLocaleString() : '…'}</span>
                {snapshot.status === 'complete' ? (
                  <span className="vault-note">
                    {snapshot.pet_count} pets · +{snapshot.added} added · −{snapshot.removed} removed · {snapshot.changed} changed · {snapshot.acquisitions_detected} acquisitions
                  </span>
                ) : (
                  <span className="vault-note">{snapshot.error_code ?? 'error'}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: InventoryItem }) {
  return (
    <tr>
      <td style={{ color: 'var(--text)', fontWeight: 600 }}>
        {item.pet_name}
        {item.stack_key && <span className="vault-note" style={{ marginLeft: 6 }}>stack</span>}
      </td>
      <td>{item.category ?? '—'}</td>
      <td>{variantLabelWide[item.variant] ?? item.variant}</td>
      <td className="vault-num">{item.quantity > 1 ? `×${item.quantity}` : '1'}</td>
      <td>
        {item.signer_name ?? (
          item.signed_status === 'not_signed' ? '—' : 'Unknown Signer – Needs Review'
        )}
      </td>
      <td>
        <span className={`vault-pill ${signedTone[item.signed_status] ?? 'vault-pill-gray'}`}>
          {signedShort[item.signed_status] ?? item.signed_status}
        </span>
      </td>
      <td className="vault-num">{formatValue(item.cosmic_value)}</td>
      <td>{formatDate(item.first_seen_at)}</td>
    </tr>
  );
}

function NotificationCard({ notification, onDismissed }: { notification: VaultNotification; onDismissed: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const dismiss = async () => {
    setBusy(true);
    try {
      const token = readStoredToken();
      if (token) await dismissNotification(token, notification.id);
      await onDismissed();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="vault-card vault-card-gold" style={{ padding: 16 }}>
      <div className="vault-row" style={{ alignItems: 'flex-start' }}>
        <Check size={18} style={{ color: 'var(--gold)', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5 }}>{notification.title}</div>
          {notification.body_lines.map((line, index) => (
            <div key={index} className="vault-note">{line}</div>
          ))}
        </div>
        <button className="vault-btn vault-btn-sm" onClick={() => void dismiss()} disabled={busy}>
          <X size={12} /> Dismiss
        </button>
      </div>
    </div>
  );
}
