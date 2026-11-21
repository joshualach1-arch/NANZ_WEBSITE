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
  fetchTradeGroups,
  updateTradeGroup,
  type VaultTradeGroup,
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
  const [groups, setGroups] = useState<VaultTradeGroup[]>([]);
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
  const [allocationGroup, setAllocationGroup] = useState<VaultTradeGroup | null>(null);
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const load = useCallback(async (scope: number) => {
    const token = readStoredToken();
    if (!token) return;
    try {
      const [list, tradeGroups] = await Promise.all([
        fetchAcquisitions(token, scope === myCollectorNo ? null : scope),
        fetchTradeGroups(token, scope === myCollectorNo ? null : scope),
      ]);
      const transactionKeyByAcquisition = new Map(tradeGroups.flatMap(group => group.items.map(item => [item.acquisition_id, group.external_transaction_key] as const)));
      setEntries(list.map(entry => ({ ...entry, external_transaction_key: transactionKeyByAcquisition.get(entry.id) ?? null })));
      setGroups(tradeGroups);
      setError(null);
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Trade history could not be loaded.');
      setEntries([]);
    }
  }, [myCollectorNo]);

  useEffect(() => { void load(view); }, [load, view]);

  const importHistory = async () => {
    setSyncingHistory(true); setSyncMessage(null); setError(null);
    try {
      const result = await vaultCall('biggames-history-sync', { collector_no: view });
      setSyncMessage(`Scanned ${Number(result.trades_scanned ?? 0)} trades and ${Number(result.booth_transactions_scanned ?? 0)} booth transactions. Found ${Number(result.pet_acquisitions_found ?? 0)} pet entries; imported ${Number(result.newly_imported ?? 0)} new entries. Existing manual price corrections are preserved.`);
      await load(view); await onRefresh();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Trade history import failed. Check BIG Games trades:read and booth:read scopes.');
    } finally { setSyncingHistory(false); }
  };

  const categories = useMemo(() => [...new Set((entries ?? []).map((e) => e.pet_category ?? 'other'))].sort(), [entries]);
  const signersList = useMemo(() => [...new Map((entries ?? []).filter((e) => e.signer_id).map((e) => [e.signer_id!, e.signer_name!])).entries()], [entries]);
  const groupByKey = useMemo(() => new Map(groups.map((g) => [g.external_transaction_key, g])), [groups]);

  const cards = useMemo(() => {
    if (!entries) return [];
    const matches = (entry: AcquisitionHistoryEntry) => {
      if (category !== 'all' && (entry.pet_category ?? 'other') !== category) return false;
      if (signer !== 'all' && (entry.signer_id ?? 'none') !== signer) return false;
      const entryType = entry.acquisition_type ?? 'unconfirmed';
      if (type === 'trade' && !['trade', 'booth_purchase'].includes(entryType)) return false;
      if (type !== 'all' && type !== 'trade' && entryType !== type) return false;
      if (verification !== 'all' && (entry.verification_status ?? 'unverified') !== verification) return false;
      const date = entry.acquired_at ?? entry.created_at.slice(0, 10);
      if (from && date < from) return false;
      if (to && date > to) return false;
      return true;
    };
    const buckets = new Map<string, AcquisitionHistoryEntry[]>();
    for (const entry of entries) {
      const key = entry.external_transaction_key || `single:${entry.id}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(entry);
    }
    const result = [...buckets.entries()].filter(([, items]) => items.some(matches)).map(([key, items]) => {
      const meta = groupByKey.get(key) ?? null;
      const ordered = [...items].sort((a,b) => a.pet_name.localeCompare(b.pet_name));
      const total = meta?.total_gems ?? (ordered.length === 1 ? ordered[0].purchase_price : null);
      const date = meta?.transaction_at ?? ordered[0].acquired_at ?? ordered[0].created_at;
      return { key, meta, items: ordered, total: total == null ? null : Number(total), date };
    });
    if (sort === 'oldest') result.sort((a,b) => new Date(a.date).getTime()-new Date(b.date).getTime());
    else if (sort === 'highest') result.sort((a,b) => (b.total ?? -1)-(a.total ?? -1));
    else if (sort === 'lowest') result.sort((a,b) => (a.total ?? Number.MAX_SAFE_INTEGER)-(b.total ?? Number.MAX_SAFE_INTEGER));
    else result.sort((a,b) => new Date(b.date).getTime()-new Date(a.date).getTime());
    return result;
  }, [entries, category, signer, type, verification, from, to, sort, groupByKey]);

  const total = cards.reduce((sum, card) => sum + (card.total ?? 0), 0);
  const totalPets = cards.reduce((sum, card) => sum + card.items.length, 0);

  return (
    <div className="vault-trade-history">
      <section className="vault-trade-hero">
        <div className="vault-trade-hero-copy">
          <span className="vault-kicker">NANZO SIGNED VAULT / TRANSACTIONS</span>
          <h2>Trade History</h2>
          <p>Your complete deal log. Every trade, every pet, every gem — all in one place.</p>
        </div>
        <div className="vault-trade-hero-stats">
          <div><span>TRANSACTIONS</span><strong>{cards.length}</strong></div>
          <div><span>PETS RECEIVED</span><strong>{totalPets}</strong></div>
          <div><span>RECORDED SPEND</span><strong>{formatValue(total, '')} <small>GEMS</small></strong></div>
        </div>
      </section>

      <div className="vault-trade-toolbar">
        <div className="vault-trade-toolbar-left">
          <div className="vault-trade-view-label"><span className="vault-trade-live-dot" /> TRANSACTION FEED <b>{cards.length} RECORDS</b></div>
          {isOwner && <div className="vault-trade-scope"><button className={view === myCollectorNo ? 'active' : ''} onClick={() => setView(myCollectorNo)}>Mine</button><button className={view !== myCollectorNo ? 'active' : ''} onClick={() => setView(myCollectorNo === 1 ? 2 : 1)}>Collector 2</button></div>}
        </div>
        <button className="vault-btn vault-btn-gold vault-btn-sm" disabled={syncingHistory} onClick={() => void importHistory()}><Clock size={13} /> {syncingHistory ? 'Syncing history…' : 'Import past trades'}</button>
      </div>

      <section className="vault-trade-filters">
        <div className="vault-trade-filter-heading"><div><span>REFINE HISTORY</span><small>Filter your transactions</small></div><button onClick={() => {setCategory('all');setSigner('all');setType('trade');setVerification('all');setFrom('');setTo('');setSort('newest');}}>Reset filters</button></div>
        <div className="vault-trade-filter-grid">
          <label>FROM<input className="vault-input" type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label>
          <label>TO<input className="vault-input" type="date" value={to} onChange={e=>setTo(e.target.value)} /></label>
          <label>CATEGORY<select className="vault-select" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All categories</option>{categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
          <label>SIGNER<select className="vault-select" value={signer} onChange={e=>setSigner(e.target.value)}><option value="all">All signers</option><option value="none">Unknown</option>{signersList.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
          <label>TYPE<select className="vault-select" value={type} onChange={e=>setType(e.target.value)}><option value="trade">Trades & booth</option><option value="all">All records</option>{Object.entries(acquisitionTypeLabels).filter(([k])=>k!=='trade').map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
          <label>SORT BY<select className="vault-select" value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="highest">Highest total</option><option value="lowest">Lowest total</option></select></label>
        </div>
      </section>

      {syncMessage && <div className="vault-success" style={{marginBottom:14}}>{syncMessage}</div>}
      {error && <div className="vault-error" style={{marginBottom:14}}>{error}</div>}
      {!entries ? <div className="vault-loading"><div className="vault-spinner" /></div> : cards.length === 0 ? (
        <div className="vault-trade-empty"><div className="vault-trade-empty-icon"><Tag size={25}/></div><h3>No transactions found</h3><p>Import your BIG Games history or change your filters to see more deals.</p><button className="vault-btn vault-btn-gold" onClick={()=>void importHistory()} disabled={syncingHistory}>Import trade history</button></div>
      ) : (
        <div className="vault-trade-feed">
          {cards.map((card,index) => {
            const group = card.meta;
            const given = group?.given_items ?? [];
            const allocationMap = new Map((group?.items ?? []).map(i=>[i.acquisition_id, i.allocated_gems]));
            const isTrade = group?.source === 'trade' || card.items.some(i=>i.acquisition_type==='trade');
            return <article className="vault-deal-card" key={card.key}>
              <div className="vault-deal-topline"><div className="vault-deal-index">{String(index+1).padStart(2,'0')}</div><div className="vault-deal-meta"><span className={`vault-deal-kind ${isTrade?'trade':'booth'}`}>{isTrade?'PLAYER TRADE':'BOOTH PURCHASE'}</span><span>{new Date(card.date).toLocaleString(undefined,{dateStyle:'medium',timeStyle:group?'short':undefined})}</span>{group?.counterparty && <span className="vault-deal-counterparty">WITH <b>{group.counterparty}</b></span>}</div><div className="vault-deal-total"><small>TRADE VALUE</small><strong>{card.total != null ? formatValue(card.total, '') : '—'} <em>GEMS</em></strong></div></div>
              <div className="vault-deal-window">
                <div className="vault-deal-side received"><div className="vault-deal-side-head"><span>YOU RECEIVED</span><b>{card.items.length} PET{card.items.length===1?'':'S'}</b></div><div className="vault-deal-pets">{card.items.map(entry=><div className="vault-deal-pet" key={entry.id}>
                  <div className="vault-deal-pet-image">{entry.pet_image?<img src={entry.pet_image} alt={entry.pet_name}/>:<Tag size={18}/>}</div><div className="vault-deal-pet-info"><strong>{entry.pet_name}</strong><span>{variantLabelWide[entry.variant]??entry.variant}{entry.signer_name?` · ${entry.signer_name}`:''}</span><small>{allocationMap.get(entry.id)!=null?`${formatValue(Number(allocationMap.get(entry.id)), '')} gems allocated`:'Individual cost not assigned'}</small></div><div className="vault-deal-pet-actions"><button onClick={()=>setDetail(entry)}>Details</button><button onClick={()=>setEditing(entry)}>Correct</button></div>
                </div>)}</div></div>
                <div className="vault-deal-exchange"><div className="vault-deal-exchange-icon">⇄</div><span>TRADE</span></div>
                <div className="vault-deal-side given"><div className="vault-deal-side-head"><span>YOU GAVE</span><b>{given.length} ITEM{given.length===1?'':'S'}</b></div><div className="vault-deal-given-list">{given.length ? given.map((raw,i)=>{const item=raw as Record<string,unknown>;const name=String(item.displayName??item.id??'Unknown item');const amount=Number(item.count??item.amount??1);const isDiamonds=/^diamonds?$/i.test(name);return <div className="vault-deal-given-item" key={`${name}-${i}`}><span className={`vault-deal-given-icon ${isDiamonds?'diamonds':''}`}>{isDiamonds?'💎':'📦'}</span><div><strong>{name}</strong><small>{Number.isFinite(amount)?formatValue(amount, ''):'1'} {isDiamonds?'GEMS':'ITEMS'}</small></div></div>}) : <div className="vault-deal-given-empty">No outgoing item details were provided by BIG Games for this transaction.</div>}</div></div>
              </div>
              {group?.id && <div className="vault-deal-footer"><span>{group.total_gems!=null?'TOTAL PRICE RECORDED':'PRICE NOT PROVIDED BY SOURCE'} · PER-PET VALUES CAN BE ASSIGNED BELOW</span><button onClick={()=>setAllocationGroup(group)}>Split purchase price <span>↗</span></button></div>}
            </article>;
          })}
        </div>
      )}
      {detail && <AcquisitionDetailModal entry={detail} onClose={()=>setDetail(null)}/>}
      {editing && <CorrectionModal entry={editing} onClose={()=>setEditing(null)} onSaved={async()=>{setEditing(null);await load(view);await onRefresh();}}/>}
      {allocationGroup && <TradeAllocationModal group={allocationGroup} onClose={()=>setAllocationGroup(null)} onSaved={async()=>{setAllocationGroup(null);await load(view);}}/>}
    </div>
  );
}

function TradeAllocationModal({group,onClose,onSaved}:{group:VaultTradeGroup;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [total,setTotal]=useState(group.total_gems==null?'':String(group.total_gems));
  const [prices,setPrices]=useState<Record<string,string>>(()=>Object.fromEntries(group.items.map(i=>[i.acquisition_id,i.allocated_gems==null?'':String(i.allocated_gems)])));
  const [error,setError]=useState<string|null>(null); const [busy,setBusy]=useState(false);
  const allocated=Object.values(prices).reduce((sum,v)=>sum+(v.trim()?Number(v):0),0);
  const totalNumber=total.trim()?Number(total):null;
  const save=async()=>{setBusy(true);setError(null);try{if(totalNumber!=null&&(!Number.isFinite(totalNumber)||totalNumber<0))throw new Error('Enter a valid total gem amount.');const allocations=Object.entries(prices).filter(([,v])=>v.trim()).map(([acquisition_id,v])=>({acquisition_id,allocated_gems:Number(v)}));if(allocations.some(a=>!Number.isFinite(a.allocated_gems)||a.allocated_gems<0))throw new Error('Every individual price must be a valid non-negative number.');if(totalNumber!=null&&allocated>totalNumber)throw new Error('Individual prices cannot add up to more than the total trade price.');await updateTradeGroup(readStoredToken()??'',group.id,totalNumber,allocations);await onSaved();}catch(e){setError(e instanceof Error?e.message:'Could not save prices.');}finally{setBusy(false);}};
  return <Modal title="Split trade purchase price" onClose={onClose}><p className="vault-note">Set the total Gems paid for this deal, then assign the amount paid for each pet. The transaction total stays separate from each pet's individual cost.</p><div className="vault-field" style={{margin:'16px 0'}}><span className="vault-label">TOTAL TRADE PRICE (GEMS)</span><input className="vault-input" type="number" min="0" value={total} onChange={e=>setTotal(e.target.value)} placeholder="e.g. 2000000000"/></div><div className="vault-allocation-list">{group.items.map(item=><label key={item.acquisition_id}><span>{item.pet_image?<img src={item.pet_image} alt=""/>:<Tag size={18}/>}<span><b>{item.pet_name}</b><small>{variantLabelWide[item.variant]??item.variant}</small></span></span><input className="vault-input" type="number" min="0" value={prices[item.acquisition_id]??''} onChange={e=>setPrices(old=>({...old,[item.acquisition_id]:e.target.value}))} placeholder="Individual Gems"/></label>)}</div><div className="vault-allocation-summary"><span>Assigned total</span><strong>{formatValue(allocated, '')} / {totalNumber==null?'—':formatValue(totalNumber, '')} Gems</strong></div>{error&&<div className="vault-error" style={{marginTop:10}}>{error}</div>}<div className="vault-row" style={{justifyContent:'flex-end',marginTop:16}}><button className="vault-btn" onClick={onClose}>Cancel</button><button className="vault-btn vault-btn-gold" disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save allocation'}</button></div></Modal>;
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
