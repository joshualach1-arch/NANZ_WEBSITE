import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Plus, RefreshCw, ScanLine, X, Sparkles, Clock3 } from 'lucide-react';
import {
  fetchScannerData, formatDate, readStoredToken, vaultCall,
  variantLabelWide, type CatalogPet, type InventoryItem, type InventorySnapshot, type ScannerData,
} from './vaultApi';

const signedShort: Record<string, string> = { verified: 'Verified', unverified: 'Unverified', not_signed: 'Not signed', manual_review: 'Needs review' };

type ScanDelta = { added: InventoryItem[]; updated: InventoryItem[]; removed: InventoryItem[]; counts: { added: number; updated: number; removed: number; parsed: number; signed: number } };

export function InventoryScannerTab({ onRefresh, isOwner, catalog = [], onSignPet, modal = false, onClose, refreshKey = 0 }: {
  onRefresh: () => Promise<void>; isOwner: boolean; catalog?: CatalogPet[];
  onSignPet?: (item: InventoryItem) => void; modal?: boolean; onClose?: () => void; refreshKey?: number;
}) {
  const [data, setData] = useState<ScannerData | null>(null);
  void isOwner;
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [delta, setDelta] = useState<ScanDelta | null>(null);
  const [tickerIndex, setTickerIndex] = useState(0);

  const load = useCallback(async () => {
    const token = readStoredToken();
    if (!token) return null;
    try { const scanner = await fetchScannerData(token); setData(scanner); setError(null); return scanner; }
    catch { setError('Scanner data could not be loaded.'); return null; }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (refreshKey > 0) void load(); }, [refreshKey, load]);
  useEffect(() => {
    if (!syncing) return;
    const timer = window.setInterval(() => setTickerIndex((v) => v + 1), 1150);
    return () => window.clearInterval(timer);
  }, [syncing]);

  const runSync = async () => {
    if (syncing) return;
    setSyncing(true); setSyncError(null); setDelta(null); setTickerIndex(0);
    try {
      const before = data ?? await load();
      const beforeMap = new Map((before?.items ?? []).filter((item) => item.present).map((item) => [item.inventory_uid, item]));
      const result = await vaultCall('biggames-sync', {});
      const after = await fetchScannerData(readStoredToken() ?? '');
      setData(after);
      const afterMap = new Map(after.items.filter((item) => item.present).map((item) => [item.inventory_uid, item]));
      const added = [...afterMap.values()].filter((item) => !beforeMap.has(item.inventory_uid));
      const removed = [...beforeMap.values()].filter((item) => !afterMap.has(item.inventory_uid));
      const updated = [...afterMap.values()].filter((item) => {
        const old = beforeMap.get(item.inventory_uid);
        return old && (old.pet_name !== item.pet_name || old.variant !== item.variant || old.quantity !== item.quantity || old.signer_id !== item.signer_id || old.signed_status !== item.signed_status);
      });
      setDelta({ added, updated, removed, counts: {
        added: Number(result.added ?? added.length), updated: Number(result.updated ?? updated.length),
        removed: Number(result.removed ?? removed.length), parsed: Number(result.parsed_pets ?? after.items.filter((item) => item.present).length),
        signed: Number(result.signed_found ?? after.items.filter((item) => item.present && item.signed_status !== 'not_signed').length),
      }});
      await onRefresh();
    } catch (err) { setSyncError(err instanceof Error ? err.message : 'Inventory scan failed. Your previous collection remains unchanged.'); }
    finally { setSyncing(false); }
  };

  const scanWords = useMemo(() => {
    const names = catalog.filter((pet) => pet.image_url).map((pet) => pet.display_name || pet.pet_name);
    return names.length ? names : ['Huge pets', 'Exclusive pets', 'Titanic pets', 'Signed pets'];
  }, [catalog]);
  const present = (data?.items ?? []).filter((item) => item.present);
  const renderItem = (item: InventoryItem, status: 'added' | 'updated' | 'removed') => {
    const pet = catalog.find((entry) => entry.id === item.pet_id) ?? catalog.find((entry) => entry.pet_name.trim().toLowerCase() === item.pet_name.trim().toLowerCase());
    const canAdd = status !== 'removed' && Boolean(pet?.id) && Boolean(onSignPet);
    return <div className="vault-scan-result-item" key={`${status}-${item.inventory_uid}`}>
      <div className="vault-scan-result-art">{pet?.image_url ? <img src={pet.image_url} alt={item.pet_name} /> : <Sparkles size={27} />}</div>
      <div className="vault-scan-result-copy"><strong>{pet?.display_name || item.pet_name}</strong><span>{item.category || 'Pet'} · {variantLabelWide[item.variant] || item.variant}{item.quantity > 1 ? ` · ×${item.quantity}` : ''}</span><small>{item.signer_name ? `Signed by ${item.signer_name}` : signedShort[item.signed_status] || item.signed_status}</small></div>
      <span className={`vault-scan-status is-${status}`}>{status === 'added' ? 'ADDED' : status === 'updated' ? 'UPDATED' : 'LOST'}</span>
      {canAdd && <button className="vault-btn vault-btn-gold vault-btn-sm" onClick={() => onSignPet?.({ ...item, pet_id: pet!.id })}><Plus size={13} /> Add signature</button>}
    </div>;
  };

  if (error) return <div className="vault-empty"><div className="vault-empty-title">Scanner unavailable</div><div>{error}</div></div>;
  if (!data) return <div className="vault-loading"><div className="vault-spinner" /></div>;

  const lastSnapshot: InventorySnapshot | null = data.snapshots[0] ?? null;
  const content = <div className={`vault-scan-modal-content${modal ? ' is-modal' : ''}`}>
    {modal && <div className="vault-scan-modal-head"><div><span className="vault-kicker">NANZO · LIVE INVENTORY SCANNER</span><h2>Scan Roblox Inventory</h2><p>Sync your Roblox pets and review every change before adding signatures.</p></div><button className="vault-btn vault-btn-sm" onClick={onClose} aria-label="Close scan results"><X size={16} /></button></div>}
    {!modal && <div className="vault-section-head"><div><span className="vault-kicker">Inventory scanner</span><h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>{present.length} items tracked</h3></div></div>}
    {!delta && <div className="vault-scan-launch"><div className="vault-scan-orb"><ScanLine size={34} /></div><div><strong>Ready to scan your Roblox inventory?</strong><span>We'll compare it with your last scan and show every addition, update and lost pet.</span></div><button className="vault-btn vault-btn-gold" onClick={() => void runSync()} disabled={syncing}><RefreshCw size={15} className={syncing ? 'vault-spin' : ''} /> {syncing ? 'Scanning…' : 'Scan Roblox Inventory'}</button></div>}
    {syncing && <div className="vault-scan-live"><div className="vault-scan-live-visual"><div className="vault-scan-beam" /><div className="vault-scan-ring scan-ring-one" /><div className="vault-scan-ring scan-ring-two" /><ScanLine size={38} /></div><div className="vault-scan-live-copy"><span className="vault-kicker">LIVE SCAN IN PROGRESS</span><strong>Scanning {scanWords[tickerIndex % scanWords.length]}…</strong><small>Reading inventory · Comparing pets · Checking signatures</small></div><div className="vault-scan-live-dots"><i /><i /><i /></div></div>}
    {syncError && <div className="vault-error"><AlertTriangle size={14} /> {syncError}</div>}
    {delta && <>
      <div className="vault-scan-success"><span><Check size={15} /> SCAN COMPLETED SUCCESSFULLY</span><strong>{delta.counts.parsed.toLocaleString()} pets scanned</strong></div>
      <div className="vault-scan-summary"><div><strong>{delta.counts.added}</strong><span>Added</span></div><div><strong>{delta.counts.updated}</strong><span>Updated</span></div><div><strong>{delta.counts.removed}</strong><span>Lost</span></div><div><strong>{delta.counts.signed}</strong><span>Signed found</span></div></div>
      <div className="vault-scan-results-heading"><div><span className="vault-kicker">SCAN REPORT</span><h3>What we found</h3></div><span>{delta.added.length + delta.updated.length + delta.removed.length} changes detected</span></div>
      {delta.added.length + delta.updated.length + delta.removed.length === 0 ? <div className="vault-empty"><div className="vault-empty-title">Your inventory is up to date</div><div>No additions, updates or lost pets since the previous scan.</div></div> : <div className="vault-scan-results-list">
        {delta.added.map((item) => renderItem(item, 'added'))}{delta.updated.map((item) => renderItem(item, 'updated'))}{delta.removed.map((item) => renderItem(item, 'removed'))}
      </div>}
    </>}
    <div className="vault-scan-footer"><span><Clock3 size={13} /> Last scan: {lastSnapshot ? formatDate(lastSnapshot.started_at) : 'Never'}</span><button className="vault-btn" onClick={() => void runSync()} disabled={syncing}><RefreshCw size={14} className={syncing ? 'vault-spin' : ''} /> Scan again</button></div>
  </div>;
  return modal ? <div className="vault-scan-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !syncing) onClose?.(); }}><section className="vault-scan-modal" role="dialog" aria-modal="true" aria-label="Scan Roblox inventory">{content}</section></div> : content;
}

