import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  Gem,
  Search,
  SlidersHorizontal,
  ChevronDown,
  Lock,
  LogOut,
  Plus,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Tag,
  TrendingUp,
  Layers,
  ChartNoAxesColumnIncreasing,
  Coins,
  Target,
  Settings as SettingsIcon,
  UserRoundX,
  X,
} from 'lucide-react';
import {
  VaultApiError,
  fetchActivityFeed,
  fetchStats,
  fetchSnapshots,
  fetchValueHistory,
  fetchData,
  fetchCosmicPetImportProgress,
  fetchChecklist,
  formatDate,
  formatValue,
  importCosmicPetValues,
  login,
  logout,
  readStoredToken,
  rpcCall,
  storeToken,
  vaultCall,
  type ActivityEvent,
  type CatalogPet,
  type ChecklistEntry,
  type ChecklistStatus,
  type Signer,
  type VaultData,
  type VaultPet,
  type CostSnapshot,
  type SignatureRecord,
  type ValueHistoryPoint,
  type VaultStats,
  type Variant,
  type VerificationRequest,
  variantLabel,
  variantLabelWide,
  verificationLabels,
  signedStatusLabels,
  signerRoleLabels,
} from './vaultApi';
import { BigGamesConnect, OAuthCallback } from './BigGamesConnect';
import { InventoryScannerTab } from './InventoryScannerTab';
import { AcquisitionsPage } from './AcquisitionsPage';
import { TradeCalculator } from './TradeCalculator';
import { RobloxConnectionCard } from './RobloxConnect';
import { SignerGallery, signabilityTone } from './SignerDirectory';
import { signabilityLabels } from './vaultApi';
import './vault.css';

type VaultTab =
  | 'overview'
  | 'collection'
  | 'scanner'
  | 'missing'
  | 'signers'
  | 'acquisitions'
  | 'trade-calculator'
  | 'values'
  | 'verification'
  | 'settings';

const vaultTabs: { id: VaultTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'collection', label: 'My Collection' },
  { id: 'scanner', label: 'Inventory Scanner' },
  { id: 'missing', label: 'Missing Pets' },
  { id: 'signers', label: 'Signers' },
  { id: 'acquisitions', label: 'Trade History' },
  { id: 'trade-calculator', label: 'Trade Calculator' },
  { id: 'values', label: 'Cosmic Value Tracker' },
  { id: 'verification', label: 'Verification' },
  { id: 'settings', label: 'Settings' },
];

type Phase = 'loading' | 'locked' | 'denied' | 'setup' | 'ready';

function useVaultSession() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<VaultData | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      let needsSetup = false;
      try {
        const status = await vaultCall('status');
        needsSetup = Boolean(status.setup_required);
        if (!cancelled) setSetupRequired(needsSetup);
      } catch {
        needsSetup = false;
        if (!cancelled) setSetupRequired(false);
      }
      const stored = readStoredToken();
      if (stored) {
        try {
          const session = await vaultCall('session', { token: stored });
          if (session.status === 'ok' && !cancelled) {
            const vaultData = await fetchData(stored);
            if (!cancelled) {
              setToken(stored);
              setData(vaultData);
              setPhase('ready');
            }
            return;
          }
        } catch {
          storeToken(null);
        }
      }
      if (!cancelled) setPhase(needsSetup ? 'setup' : 'locked');
    };
    void boot();
    return () => { cancelled = true; };
  }, []);

  const signIn = useCallback(async (passkey: string) => {
    const result = await login(passkey);
    // Only persist a session after the protected vault payload loaded successfully.
    // This prevents a half-authenticated state if the data request fails.
    const vaultData = await fetchData(result.token);
    storeToken(result.token);
    setToken(result.token);
    setData(vaultData);
    setPhase('ready');
  }, []);

  const signOut = useCallback(async () => {
    if (token) await logout(token);
    storeToken(null);
    setToken(null);
    setData(null);
    setPhase('locked');
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const vaultData = await fetchData(token);
      setData(vaultData);
    } catch (error) {
      if (error instanceof VaultApiError && error.status === 401) {
        storeToken(null);
        setToken(null);
        setData(null);
        setPhase('locked');
      }
    }
  }, [token]);

  return { phase, setPhase, token, data, setupRequired, signIn, signOut, refresh };
}

/* ── lock screen ─────────────────────────────────────────────────── */

function LockScreen({ onSubmit, title, subtitle }: {
  onSubmit: (passkey: string) => Promise<void>;
  title: string;
  subtitle: string;
}) {
  const [passkey, setPasskey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(passkey);
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Access denied. Check the passkey.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vault-lock-wrap">
      <div className="vault-lock-card">
        <div className="vault-lock-icon"><Lock size={30} /></div>
        <h1 className="vault-lock-title">{title}</h1>
        <p className="vault-lock-sub">{subtitle}</p>
        <form
          className="vault-lock-form"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          <input
            className="vault-input"
            type="password"
            placeholder="Vault passkey"
            value={passkey}
            onChange={(event) => setPasskey(event.target.value)}
            autoFocus
            autoComplete="current-password"
          />
          <button className="vault-btn vault-btn-gold" type="submit" disabled={busy || passkey.trim().length < 6}>
            {busy ? 'Unlocking…' : 'Unlock vault'}
          </button>
          {error && <div className="vault-lock-error">{error}</div>}
        </form>
        <p className="vault-note" style={{ marginTop: 18, fontSize: 11.5 }}>
          Access is restricted to the two authorized NANZO collectors. Sessions expire after 7 days.
        </p>
      </div>
    </div>
  );
}

function DeniedScreen() {
  return (
    <div className="vault-denied">
      <div>
        <div className="vault-denied-icon"><UserRoundX size={34} /></div>
        <h1 className="vault-lock-title">Access denied</h1>
        <p className="vault-lock-sub">This vault is limited to two authorized collectors.</p>
        <a className="vault-btn" href="/" style={{ marginTop: 18 }}>
          <ArrowLeft size={15} /> Back to NANZO
        </a>
      </div>
    </div>
  );
}

/* ── shared UI bits ──────────────────────────────────────────────── */

export function StatCard({ label, value, hint, gold, icon }: { label: string; value: string; hint?: string; gold?: boolean; icon?: React.ReactNode }) {
  return (
    <div className={`vault-card vault-overview-stat-card${gold ? ' vault-card-gold' : ''}`}>
      {icon && <div className="vault-overview-stat-icon">{icon}</div>}
      <div className="vault-overview-stat-copy">
        <div className="vault-stat-label">{label}</div>
        <div className="vault-stat-value">{value}</div>
        {hint && <div className="vault-stat-hint">{hint}</div>}
      </div>
    </div>
  );
}

function PetCard({ pet, onOpen }: { pet: VaultPet; onOpen: (pet: VaultPet) => void }) {
  const isSigned = Boolean(pet.signer_id && pet.signed_status !== 'not_signed');
  const variantClass = String(pet.variant || 'normal').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return (
    <button className={`vault-pet-card vault-pet-card-refined${isSigned ? ' vault-pet-card-signed' : ''}`} onClick={() => onOpen(pet)} style={{ textAlign: 'left', padding: 0 }}>
      <div className="vault-pet-media vault-collection-variant-media">
        <span className={`vault-variant-swatch variant-${variantClass}`}>
          {pet.pet_image ? <img src={pet.pet_image} alt={pet.pet_name} loading="lazy" /> : <Sparkles size={40} />}
          {['shiny', 'golden_shiny', 'rainbow_shiny'].includes(pet.variant) && <i className="vault-shine-sweep" aria-hidden="true" />}
        </span>
      </div>
      <div className="vault-pet-body">
        <div className="vault-pet-name">{pet.nickname || pet.pet_name}</div>
        <div className="vault-pet-card-footer">
          {isSigned
            ? <span className="vault-signed-by">
                <Pencil className="vault-signed-by-pen" size={12} strokeWidth={2.7} aria-hidden="true" />
                <span className="vault-signed-by-label">SIGNED BY</span>
                <span className="vault-signer-name-aura">{pet.signer_name || 'UNKNOWN SIGNER'}</span>
              </span>
            : <span className="vault-status-unassigned">NOT SIGNED</span>}
        </div>
      </div>
    </button>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="vault-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`vault-modal${wide ? ' vault-modal-wide' : ''}`}>
        <div className="vault-modal-head">
          <span className="vault-modal-title">{title}</span>
          <button className="vault-btn vault-btn-sm" onClick={onClose}><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── form modal for adding a pet to the collection ───────────────── */

function AddPetModal({ data, onClose, onSubmit, presetPetId }: {
  data: VaultData;
  onClose: () => void;
  onSubmit: (params: Record<string, unknown>) => Promise<void>;
  presetPetId?: string | null;
}) {
  const [petId, setPetId] = useState(presetPetId ?? '');
  const [signerId, setSignerId] = useState('');
  const [variant, setVariant] = useState<Variant>('normal');
  const [nickname, setNickname] = useState('');
  const [acquiredAt, setAcquiredAt] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedPet = data.catalog.find((pet) => pet.id === petId) ?? null;
  const variants: Variant[] = ['normal', 'golden', 'rainbow', 'shiny', 'golden_shiny', 'rainbow_shiny'];
  const submit = async () => {
    if (!petId) { setError('Choose a pet from the catalog.'); return; }
    setBusy(true); setError(null);
    try {
      await rpcCall('vault_collection_manage', readStoredToken() ?? '', { p_action: 'add', p_pet_id: petId, p_signer_id: signerId || null, p_variant: variant, p_nickname: nickname.trim() || null, p_acquired_at: acquiredAt || null, p_purchase_price: price.trim() ? Number(price) : null, p_notes: notes.trim() || null });
      await onSubmit({}); onClose();
    } catch (err) { setError(err instanceof VaultApiError ? err.message : 'Could not add the pet.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={presetPetId ? 'Choose pet variant' : 'Add pet to collection'} onClose={onClose}>
      <div className="vault-variant-modal">
        {presetPetId && selectedPet && <div className="vault-variant-preview">
          <div className={'vault-variant-art variant-' + variant.replace('_', '-')}>
            {selectedPet.image_url ? <img src={selectedPet.image_url} alt={selectedPet.pet_name} /> : <Sparkles size={44} />}
            {['shiny','golden_shiny','rainbow_shiny'].includes(variant) && <span className="vault-shine-sweep" />}
          </div>
          <div><span className="vault-kicker">{selectedPet.category}</span><h3>{selectedPet.display_name || selectedPet.pet_name}</h3><p>Select the exact variant you own. Only that variant will be added.</p></div>
        </div>}
        {!presetPetId && <div className="vault-field"><span className="vault-label">Pet (catalog)</span><select className="vault-select" value={petId} onChange={(event) => setPetId(event.target.value)}><option value="">Select pet…</option>{data.catalog.map((pet) => <option key={pet.id} value={pet.id}>{pet.pet_name}</option>)}</select></div>}
        <div className="vault-field"><span className="vault-label">Choose variant</span><div className="vault-variant-grid">
          {variants.map((value) => <button type="button" key={value} className={'vault-variant-option' + (variant === value ? ' active' : '')} onClick={() => setVariant(value)}>
            <span className={'vault-variant-swatch variant-' + value.replace('_', '-')}>{selectedPet?.image_url ? <img src={selectedPet.image_url} alt="" /> : <Sparkles size={24} />}{['shiny','golden_shiny','rainbow_shiny'].includes(value) && <i className="vault-shine-sweep" />}</span>
            <b>{variantLabelWide[value] ?? value}</b>{variant === value && <span className="vault-variant-check">Selected</span>}
          </button>)}
        </div></div>
        <div className="vault-form-grid">
          <div className="vault-field"><span className="vault-label">Signer</span><select className="vault-select" value={signerId} onChange={(event) => setSignerId(event.target.value)}><option value="">Unknown / none</option>{data.signers.map((signer) => <option key={signer.id} value={signer.id}>{signer.signer_name}</option>)}</select></div>
          <div className="vault-field"><span className="vault-label">Acquired on</span><input className="vault-input" type="date" value={acquiredAt} onChange={(event) => setAcquiredAt(event.target.value)} /></div>
          <div className="vault-field"><span className="vault-label">Purchase price (USD)</span><input className="vault-input" type="number" min="0" step="0.01" placeholder="Optional" value={price} onChange={(event) => setPrice(event.target.value)} /></div>
          <div className="vault-field"><span className="vault-label">Nickname</span><input className="vault-input" placeholder="Optional" value={nickname} onChange={(event) => setNickname(event.target.value)} /></div>
        </div>
        <div className="vault-field" style={{ marginTop: 12 }}><span className="vault-label">Notes</span><textarea className="vault-textarea" rows={2} placeholder="Provenance, condition, trade partner…" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
        {error && <div className="vault-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
        <div className="vault-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}><button className="vault-btn" onClick={onClose}>Cancel</button><button className="vault-btn vault-btn-gold" onClick={() => void submit()} disabled={busy || !petId}>{busy ? 'Adding…' : 'Add selected variant'}</button></div>
      </div>
    </Modal>
  );
}

/* ── overview (Part 2: premium dashboard) ────────────────────────── */

const CATEGORY_KEYS = ['huge', 'exclusive', 'titanic', 'gargantuan'] as const;
type CategoryKey = (typeof CATEGORY_KEYS)[number];

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  huge: 'Huge',
  exclusive: 'Exclusive',
  titanic: 'Titanic',
  gargantuan: 'Gargantuan',
};

function petCategory(pet: VaultPet): CategoryKey | null {
  const category = String(pet.pet_category ?? '').trim().toLowerCase();
  if (category.startsWith('huge')) return 'huge';
  if (category.startsWith('exclusive')) return 'exclusive';
  if (category.startsWith('titanic')) return 'titanic';
  if (category.startsWith('gargantuan') || category.startsWith('gigantuan')) return 'gargantuan';
  return null;
}

function isTrackedCategory(value: string | null | undefined): boolean {
  const category = String(value ?? '').trim().toLowerCase();
  return category.startsWith('huge') || category.startsWith('exclusive')
    || category.startsWith('titanic') || category.startsWith('gargantuan')
    || category.startsWith('gigantuan');
}

function eventLabel(event: ActivityEvent): { title: string; meta: string } {
  const detail = event.detail ?? {};
  switch (event.event) {
    case 'login': return { title: 'Signed in', meta: `${event.actor} · collector ${event.collector_no ?? '—'}` };
    case 'collection_add': return { title: 'Pet added to collection', meta: String(detail.pet_name ?? '') };
    case 'collection_remove': return { title: 'Pet removed from collection', meta: String(detail.pet_name ?? '') };
    case 'signature_verify': return { title: 'Signature verified', meta: String(detail.signature_name ?? '') };
    case 'signature_value_set': return { title: 'Signature value updated', meta: String(detail.signature_id ?? '') };
    case 'signature_add': return { title: 'Signature record added', meta: String(detail.signature_name ?? '') };
    case 'signer_add_v2': return { title: 'Signer added', meta: String(detail.signer_name ?? '') };
    case 'signer_merge': return { title: 'Signers merged', meta: String(detail.merge_target_id ?? '') };
    case 'value_set': return { title: 'Cosmic value updated', meta: String(detail.pet_name ?? detail.pet_id ?? '') };
    case 'acquisition_correct': return { title: 'Acquisition corrected', meta: String(detail.acquisition_id ?? '') };
    case 'catalog_import': return { title: 'Catalog import', meta: `${detail.added ?? 0} added · ${detail.updated ?? 0} updated` };
    case 'inventory_sync': return { title: 'Inventory sync', meta: `${detail.added ?? 0} added · ${detail.removed ?? 0} removed` };
    case 'inventory_sync_failed': return { title: 'Inventory sync failed', meta: String(detail.error_code ?? '') };
    case 'verify_request': return { title: 'Verification requested', meta: String(detail.pet_name ?? '') };
    case 'verify_review': return { title: `Verification ${String(detail.status ?? '')}`, meta: String(detail.pet_name ?? '') };
    case 'settings_update': return { title: 'Settings updated', meta: event.actor };
    case 'collector_update': return { title: 'Collector profile updated', meta: `collector ${detail.collector_no ?? ''}` };
    case 'passkey_change': return { title: 'Passkey changed', meta: event.actor };
    case 'value_snapshot': return { title: 'Value snapshot recorded', meta: formatValue(Number(detail.total_value ?? 0)) };
    default: return { title: event.event.replace(/_/g, ' '), meta: `${event.actor} · collector ${event.collector_no ?? '—'}` };
  }
}

function getOwnedSignatureValue(data: VaultData, pet: VaultPet): number {
  if (!pet.signer_id || pet.signed_status === 'not_signed') return 0;
  const catalogPet = data.catalog.find((entry) => entry.id === pet.pet_id);
  const signer = data.signers.find((entry) => entry.id === pet.signer_id);
  const category = String(catalogPet?.category ?? pet.pet_category ?? '').toLowerCase();
  const isTitanic = Boolean(catalogPet?.is_titanic) || category.includes('titanic');
  const isHuge = Boolean(catalogPet?.is_huge) || category.includes('huge');
  const isExclusive = Boolean(catalogPet?.is_exclusive) || category.includes('exclusive');
  const cosmicSignerValue = isTitanic ? signer?.cosmic_titanic_value
    : isHuge ? signer?.cosmic_huge_value
    : isExclusive ? signer?.cosmic_exclusive_value : null;
  const signature = data.signatures.find(
    (entry) => entry.pet_id === pet.pet_id && entry.signer_id === pet.signer_id && entry.variant === pet.variant
  );
  // Prefer a pet/variant-specific signature value; otherwise use the signer's Cosmic category value.
  const value = signature?.signature_value ?? cosmicSignerValue;
  return value == null ? 0 : Math.max(0, Number(value) || 0);
}

function getOwnedPetValue(data: VaultData, pet: VaultPet): number {
  return Number(pet.cosmic_value ?? 0) + getOwnedSignatureValue(data, pet);
}

function computeStats(data: VaultData, pets: VaultPet[]) {
  const totalValue = pets.reduce((sum, pet) => sum + getOwnedPetValue(data, pet), 0);

  const spent = pets.reduce((sum, pet) => sum + Number(pet.purchase_price ?? 0), 0);
  const signablePetCount = data.catalog.filter((pet) => pet.signability === 'signable').length;
  const ownedCatalogPetCount = new Set(pets.map((pet) => pet.pet_id)).size;
  const missing = Math.max(0, signablePetCount - ownedCatalogPetCount);

  return { totalValue, spent, missing };
}

function OverviewTab({ data, onNavigate }: { data: VaultData; onNavigate: (tab: VaultTab) => void }) {
  const token = readStoredToken() ?? '';
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await fetchStats(token);
        if (!cancelled) setStats(result);
      } catch {
        if (!cancelled) setFeedError('Stats unavailable right now.');
      }
      try {
        const feed = await fetchActivityFeed(token, null, 12);
        if (!cancelled) setEvents(feed);
      } catch {
        if (!cancelled) setFeedError('Activity feed unavailable right now.');
      }
    };
    void load();
    const interval = window.setInterval(load, 180_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [token]);

  const verifiedPets = useMemo(
    () => data.pets.filter((pet) => pet.verification_status === 'verified' || pet.verification_status === 'community_verified'),
    [data.pets]
  );
  const unverifiedPets = useMemo(
    () => data.pets.filter((pet) =>
      pet.signed_status !== 'not_signed' &&
      pet.verification_status !== 'verified' && pet.verification_status !== 'community_verified'),
    [data.pets]
  );

  // Owned signed pets use the matching signer's Cosmic Huge/Exclusive/Titanic value.
  const petValueTotal = useMemo(
    () => data.pets.reduce((sum, pet) => sum + Number(pet.cosmic_value ?? 0), 0),
    [data.pets]
  );
  const signatureValueTotal = useMemo(
    () => data.pets.reduce((sum, pet) => sum + getOwnedSignatureValue(data, pet), 0),
    [data.pets, data.signatures, data.signers, data.catalog]
  );
  const totalValue = petValueTotal + signatureValueTotal;

  const spent = useMemo(
    () => data.pets.reduce((sum, pet) => sum + Number(pet.purchase_price ?? 0), 0),
    [data.pets]
  );
  const profit = totalValue - spent;
  const pctReturn = spent > 0 ? (profit / spent) * 100 : null;

  const otherStats = data.other_pets ? computeStats({ ...data, pets: data.other_pets }, data.other_pets) : null;

  const recentPets = useMemo(
    () => [...data.pets]
      .sort((a, b) => (b.acquired_at ?? b.created_at).localeCompare(a.acquired_at ?? a.created_at))
      .slice(0, 6),
    [data.pets]
  );

  const recentAcquisitions = useMemo(() => data.acquisitions.slice(0, 5), [data.acquisitions]);

  const roblox = (data.roblox_accounts ?? []).find((account) => account.is_self)
    ?? (data.roblox_accounts ?? [])[0];

  return (
    <div className="vault-overview-page">
      <div className="vault-stat-grid vault-overview-primary-stats">
        <StatCard icon={<Layers size={38} strokeWidth={2.6} />} label="Collection size" value={String(data.pets.length)} hint={`${verifiedPets.length} verified · ${unverifiedPets.length} unverified`} />
        <StatCard icon={<ChartNoAxesColumnIncreasing size={38} strokeWidth={2.6} />} label="Collection value" value={formatValue(totalValue)} hint={`Pets ${formatValue(petValueTotal)} + Signatures ${formatValue(signatureValueTotal)}`} />
        <StatCard icon={<Coins size={38} strokeWidth={2.6} />} label="Invested" value={formatValue(spent)} hint="total purchase price" />
        <StatCard icon={<TrendingUp size={38} strokeWidth={2.6} />} label={profit >= 0 ? 'Profit' : 'Loss'} value={`${profit >= 0 ? '+' : ''}${formatValue(profit)}`} hint={pctReturn !== null ? `${pctReturn >= 0 ? '+' : ''}${pctReturn.toFixed(1)}% return` : 'no purchases recorded yet'} />
      </div>


      <div className="vault-section-head vault-overview-connection-head" style={{ marginTop: 22 }}>
        <div>
          <span className="vault-kicker">Collection</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Connection &amp; health</h3>
        </div>
        <button className="vault-btn vault-btn-sm vault-overview-settings" onClick={() => onNavigate('settings')}><SettingsIcon size={17} /> Settings</button>
      </div>
      <div className="vault-card vault-overview-connection-shell">
        <div className="vault-collection-summary">
          <div className="vault-summary-identity">
            {roblox?.avatar_url
              ? <img className="vault-summary-avatar" src={roblox.avatar_url} alt={roblox.roblox_username ?? 'collector'} />
              : <div className="vault-summary-avatar vault-summary-avatar-fallback">?</div>}
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {roblox?.display_name ?? roblox?.roblox_username ?? `Collector ${data.me}`}
              </div>
              <div className="vault-note">
                {roblox?.roblox_username
                  ? `Roblox: @${roblox.roblox_username} · ${roblox.connection_status === 'connected' ? 'Connected' : 'Not connected'}`
                  : 'No Roblox account connected yet'}
              </div>
              {roblox?.last_synced_at && (
                <div className="vault-note">Last inventory sync: {formatDate(roblox.last_synced_at)}</div>
              )}
            </div>
          </div>
          <div className="vault-summary-counts">
            <div><strong>{verifiedPets.length}</strong><span> verified</span></div>
            <div><strong>{unverifiedPets.length}</strong><span> unverified</span></div>
            <div><strong>{stats?.progress?.total_signable != null
              ? Math.max(0, stats.progress.total_signable - stats.progress.collected_verified - stats.progress.collected_unverified)
              : '—'}</strong><span> missing</span></div>
          </div>
        </div>
      </div>



      <section className="vault-overview-latest">
        <div className="vault-section-head vault-overview-section-head">
          <div>
            <span className="vault-kicker">Recently acquired</span>
            <h3>Latest additions</h3>
          </div>
          <button className="vault-btn vault-btn-sm" onClick={() => onNavigate('collection')}>View all</button>
        </div>
      {recentPets.length === 0 ? (
        <div className="vault-empty">
          <div className="vault-empty-title">No pets yet</div>
          <div>Add your first signed pet from My Collection.</div>
        </div>
      ) : (
        <div className="vault-pet-grid">
          {recentPets.map((pet) => (
            <PetCard key={pet.id} pet={pet} onOpen={() => onNavigate('collection')} />
          ))}
        </div>
      )}
      </section>

      {recentAcquisitions.length > 0 && (
        <section className="vault-overview-trades">
          <div className="vault-section-head vault-overview-section-head">
            <div>
              <span className="vault-kicker">Recent acquisitions</span>
              <h3>Purchases &amp; trades</h3>
            </div>
            <button className="vault-btn vault-btn-sm" onClick={() => onNavigate('acquisitions')}>Full history</button>
          </div>
          <div className="vault-table-wrap">
            <table className="vault-table">
              <thead>
                <tr><th>Pet</th><th>Signer</th><th>Price</th><th>Current value</th><th>Date</th><th>Status</th></tr>
              </thead>
              <tbody>
                {recentAcquisitions.map((entry) => {
                  const verified = entry.verification_status === 'verified' || entry.verification_status === 'community_verified';
                  return (
                    <tr key={entry.id}>
                      <td style={{ fontWeight: 600 }}>{entry.pet_name}</td>
                      <td>{entry.signer_name ?? '—'}</td>
                      <td className="vault-num">{formatValue(entry.purchase_price, `${entry.currency === 'USD' ? '' : ' '}`)}</td>
                      <td className="vault-num" style={{ color: 'var(--gold)', fontWeight: 700 }}>{formatValue(entry.current_value)}</td>
                      <td>{formatDate(entry.acquired_at ?? entry.created_at)}</td>
                      <td>
                        <span className={`vault-pill ${verified ? 'vault-pill-green' : 'vault-pill-gold'}`}>
                          {verified ? 'Verified' : verificationLabels[entry.verification_status ?? 'unverified']}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Recent activity</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>What happened in the vault</h3>
        </div>
        <button className="vault-btn vault-btn-sm" onClick={() => onNavigate('acquisitions')}>Acquisition history</button>
      </div>
      {feedError ? (
        <div className="vault-empty">
          <div className="vault-empty-title">Activity unavailable</div>
          <div>{feedError}</div>
        </div>
      ) : events.length === 0 ? (
        <div className="vault-empty">
          <div className="vault-empty-title">No activity yet</div>
          <div>Sign-ins, syncs and value updates will appear here.</div>
        </div>
      ) : (
        <div className="vault-activity-list">
          {events.slice(0, 8).map((event, index) => {
            const label = eventLabel(event);
            return (
              <div key={`${event.at}-${index}`} className="vault-activity-row">
                <span className={`vault-dot ${event.kind === 'notification' ? 'vault-dot-gold' : event.kind === 'value_snapshot' ? 'vault-dot-blue' : ''}`} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{label.title}</div>
                  {label.meta && <div className="vault-note">{label.meta}</div>}
                </div>
                <span className="vault-note" style={{ whiteSpace: 'nowrap' }}>{formatDate(event.at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── collection (Part 3: premium grid) ───────────────────────────── */

type CollectionSort =
  | 'value_high' | 'value_low' | 'signature_high'
  | 'newest' | 'oldest' | 'alpha'
  | 'gain' | 'loss';

const VARIANT_FILTERS = ['normal', 'golden', 'rainbow', 'shiny', 'golden_shiny', 'rainbow_shiny', 'other'] as const;

function petSignatureValue(pet: VaultPet, signatures: SignatureRecord[]): number {
  const record = signatures.find(
    (sig) => sig.pet_id === pet.pet_id && sig.signer_id === pet.signer_id && sig.variant === pet.variant
  );
  if (!record) return 0;
  return record.verification_status === 'verified' || record.verification_status === 'community_verified'
    ? Number(record.signature_value ?? 0)
    : 0;
}

function CollectionTab({ data, onRefresh, isOwner }: { data: VaultData; onRefresh: () => Promise<void>; isOwner: boolean }) {
  const [view, setView] = useState<number>(data.me);
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<VaultPet | null>(null);
  const [busy, setBusy] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [importingCosmicPets, setImportingCosmicPets] = useState(false);
  const [cosmicPetImportMessage, setCosmicPetImportMessage] = useState<string | null>(null);
  const [cosmicPetImportError, setCosmicPetImportError] = useState<string | null>(null);
  const [cosmicPetImportProgress, setCosmicPetImportProgress] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!importingCosmicPets) return;
    let active = true;
    const poll = async () => {
      try {
        const progress = await fetchCosmicPetImportProgress();
        if (active) setCosmicPetImportProgress(progress);
      } catch (error) {
        if (active) setCosmicPetImportError(error instanceof Error ? error.message : 'Could not read import progress.');
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [importingCosmicPets]);
  const [collectionMode, setCollectionMode] = useState<'owned' | 'missing'>('owned');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [missingCategoryFilter, setMissingCategoryFilter] = useState('all');
  const [petSearch, setPetSearch] = useState('');
  const [presetPetId, setPresetPetId] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [variantFilter, setVariantFilter] = useState('all');
  const [signerFilter, setSignerFilter] = useState('all');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [acquiredFrom, setAcquiredFrom] = useState('');
  const [acquiredTo, setAcquiredTo] = useState('');
  const [verificationFilter, setVerificationFilter] = useState('all');
  const [sort, setSort] = useState<CollectionSort>('value_high');

  const pets = (view === data.me ? data.pets : (data.other_pets ?? []))
    .filter((pet) => isTrackedCategory(pet.pet_category));

  const run = async (params: Record<string, unknown>) => {
    setBusy(true);
    try {
      await rpcCall('vault_collection_manage', readStoredToken() ?? '', params);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (pet: VaultPet) => {
    if (!window.confirm(`Remove ${pet.nickname || pet.pet_name} from this collection?`)) return;
    await run({ p_action: 'delete', p_pet_entry_id: pet.id, p_collector_no: view !== data.me ? view : null });
    setDetail(null);
  };

  const categories = useMemo(() => ['Huge', 'Exclusive', 'Titanic', 'Gargantuan'], []);
  const ownedPetIds = useMemo(() => new Set(pets.map((pet) => pet.pet_id)), [pets]);
  const missingCatalog = useMemo(() => data.catalog.filter((pet) => {
    const category = String(pet.category ?? '').trim().toLowerCase();
    const supported = ['huge', 'exclusive', 'titanic', 'gargantuan'].some((name) => category.includes(name))
      || pet.is_huge === true || pet.is_exclusive === true || pet.is_titanic === true || pet.is_gargantuan === true;
    if (!supported || ownedPetIds.has(pet.id)) return false;
    if (missingCategoryFilter !== 'all') {
      const flagMatch = missingCategoryFilter === 'huge' ? pet.is_huge === true
        : missingCategoryFilter === 'exclusive' ? pet.is_exclusive === true
        : missingCategoryFilter === 'titanic' ? pet.is_titanic === true
        : missingCategoryFilter === 'gargantuan' ? pet.is_gargantuan === true
        : false;
      if (!category.includes(missingCategoryFilter) && !flagMatch) return false;
    }
    const q = catalogSearch.trim().toLowerCase();
    return !q || pet.pet_name.toLowerCase().includes(q) || String(pet.display_name ?? '').toLowerCase().includes(q);
  }).sort((x, y) => x.pet_name.localeCompare(y.pet_name)), [data.catalog, ownedPetIds, catalogSearch, missingCategoryFilter]);
  const signersList = useMemo(
    () => [...new Map(pets.filter((pet) => pet.signer_id).map((pet) => [pet.signer_id!, pet.signer_name!])).entries()],
    [pets]
  );

  const filtered = useMemo(() => {
    let list = pets.filter((pet) => {
      if (categoryFilter !== 'all' && petCategory(pet) !== categoryFilter) return false;
      const q = petSearch.trim().toLowerCase();
      if (q && !pet.pet_name.toLowerCase().includes(q) && !(pet.nickname ?? '').toLowerCase().includes(q) && !(pet.signer_name ?? '').toLowerCase().includes(q)) return false;
      if (variantFilter !== 'all' && pet.variant !== variantFilter) return false;
      if (signerFilter !== 'all' && (pet.signer_id ?? 'none') !== signerFilter) return false;
      const value = petSignatureValue(pet, data.signatures) + Number(pet.cosmic_value ?? 0);
      if (minValue && value < Number(minValue)) return false;
      if (maxValue && value > Number(maxValue)) return false;
      const date = pet.acquired_at ?? pet.created_at.slice(0, 10);
      if (acquiredFrom && date < acquiredFrom) return false;
      if (acquiredTo && date > acquiredTo) return false;
      if (verificationFilter === 'verified' && pet.verification_status !== 'verified' && pet.verification_status !== 'community_verified') return false;
      if (verificationFilter === 'unverified' && (pet.verification_status === 'verified' || pet.verification_status === 'community_verified')) return false;
      if (verificationFilter === 'not_signed' && pet.signed_status !== 'not_signed') return false;
      return true;
    });
    if (sort === 'value_high') list = [...list].sort((a, b) => (petSignatureValue(b, data.signatures) + Number(b.cosmic_value ?? 0)) - (petSignatureValue(a, data.signatures) + Number(a.cosmic_value ?? 0)));
    if (sort === 'value_low') list = [...list].sort((a, b) => (petSignatureValue(a, data.signatures) + Number(a.cosmic_value ?? 0)) - (petSignatureValue(b, data.signatures) + Number(b.cosmic_value ?? 0)));
    if (sort === 'signature_high') list = [...list].sort((a, b) => petSignatureValue(b, data.signatures) - petSignatureValue(a, data.signatures));
    if (sort === 'newest') list = [...list].sort((a, b) => (b.acquired_at ?? '').localeCompare(a.acquired_at ?? ''));
    if (sort === 'oldest') list = [...list].sort((a, b) => (a.acquired_at ?? '').localeCompare(b.acquired_at ?? ''));
    if (sort === 'alpha') list = [...list].sort((a, b) => (a.nickname || a.pet_name).localeCompare(b.nickname || b.pet_name));
    return list;
  },  [pets, data.signatures, categoryFilter, petSearch, variantFilter, signerFilter, minValue, maxValue, acquiredFrom, acquiredTo, verificationFilter, sort]);

  return (
    <div className="vault-collection-page">
      <section className="vault-collection-hero">
        <div className="vault-collection-hero-copy">
          <span className="vault-kicker">SIGNED VAULT</span>
          <h1 className="vault-title">My Collection</h1>
          <p className="vault-subtitle">Your signed pets, signer records and trade history in one place.</p>
        </div>
      </section>
      {cosmicPetImportMessage && <div className="vault-success" style={{ marginBottom: 12 }}>{cosmicPetImportMessage}</div>}
      {cosmicPetImportError && <div className="vault-error" role="alert" style={{ marginBottom: 12, whiteSpace: "pre-wrap" }}><strong>Cosmic Values import failed</strong><br />{cosmicPetImportError}</div>}
      {importingCosmicPets && (() => {
        const p = cosmicPetImportProgress ?? {};
        const total = Math.max(1, Number(p.category_total ?? 4));
        const done = Math.min(total, Number(p.category_index ?? 0));
        const percent = Math.round((done / total) * 100);
        return <div className="vault-card" role="status" aria-live="polite" style={{ marginBottom: 12, padding: 14 }}>
          <div className="vault-row" style={{ justifyContent: "space-between", gap: 8 }}><strong>Cosmic Values import</strong><strong>{percent}%</strong></div>
          <div style={{ height: 9, background: "rgba(148,163,184,.2)", borderRadius: 99, overflow: "hidden", margin: "10px 0" }}><div style={{ height: "100%", width: percent + "%", background: "linear-gradient(90deg,#ec4899,#8b5cf6)", transition: "width .25s ease" }} /></div>
          <div style={{ fontSize: 12, opacity: .85 }}>{String(p.message ?? "Connecting to Cosmic Values…")}{p.category ? " · Page " + Number(p.page ?? 0) : ""}{" · "}{done}/{total} categories completed{" · "}{Number(p.source_rows ?? 0).toLocaleString()} rows collected</div>
          {p.error && <div className="vault-error" style={{ marginTop: 8 }}>{String(p.error)}</div>}
        </div>;
      })()}
      {showScanner && <div style={{ marginBottom: 18 }}><InventoryScannerTab onRefresh={onRefresh} isOwner={isOwner} /></div>}
      <div className="vault-section-head">
        <div className="vault-row">
          <span className="vault-kicker">Collection</span>
          {isOwner && (
            <div className="vault-tabs">
              <button className={`vault-tab${view === data.me ? ' active' : ''}`} onClick={() => setView(data.me)}>Mine</button>
              <button className={`vault-tab${view === 2 ? ' active' : ''}`} onClick={() => setView(2)}>Collector 2</button>
            </div>
          )}
          <span className="vault-pill vault-pill-gray">{filtered.length} of {pets.length} pets</span>
        </div>
        <div className="vault-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {isOwner && <button className="vault-btn vault-btn-sm" disabled={importingCosmicPets} onClick={() => {
            setImportingCosmicPets(true); setCosmicPetImportMessage(null); setCosmicPetImportError(null); setCosmicPetImportProgress(null);
            void (async () => {
              const categories = ['Huges', 'Exclusives', 'Titanics', 'Gargantuans'];
              let totalRows = 0;
              let totalPages = 0;
              for (const category of categories) {
                for (let page = 1; page <= 200; page++) {
                  const result = await importCosmicPetValues(category, page);
                  totalRows += Number(result.source_rows ?? 0);
                  totalPages += 1;
                  if (!result.has_more) break;
                  if (page === 200) throw new Error('Cosmic import safety limit reached for ' + category + ' (200 pages).');
                }
              }
              setCosmicPetImportMessage('Cosmic Values updated · ' + totalRows.toLocaleString() + ' source rows processed across ' + totalPages + ' short requests. Pet catalog and collection records were not changed.');
              await onRefresh();
            })()
              .catch((err) => setCosmicPetImportError(err instanceof Error ? err.message : String(err ?? 'Cosmic pet value import failed.')))
              .finally(() => setImportingCosmicPets(false));
          }}>{importingCosmicPets ? 'Importing Cosmic Values…' : '↓ Update Cosmic Pet Values'}</button>}
          <button className="vault-btn vault-btn-sm" onClick={() => setShowScanner((value) => !value)}>
            {showScanner ? 'Hide scanner' : 'Scan Roblox inventory'}
          </button>
          <button className="vault-btn vault-btn-gold" onClick={() => setAddOpen(true)} disabled={busy}>
            <Plus size={15} /> Add pet
          </button>
        </div>
      </div>

      <div className="vault-collection-switch">
        <button className={`vault-tab${collectionMode === 'owned' ? ' active' : ''}`} onClick={() => setCollectionMode('owned')}><span>MY SIGNED COLLECTION</span><b>{pets.filter((pet) => pet.signer_id && pet.signed_status !== 'not_signed').length}</b></button>
        <button className={`vault-tab${collectionMode === 'missing' ? ' active' : ''}`} onClick={() => setCollectionMode('missing')}><span>MISSING PETS</span><b>{missingCatalog.length}</b></button>
      </div>
      {collectionMode === 'owned' && <div className="vault-row" style={{ gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
        {['all', ...categories.map((entry) => entry.toLowerCase())].map((entry) => (
          <button key={entry} className={`vault-tab${categoryFilter === entry ? ' active' : ''}`} onClick={() => setCategoryFilter(entry)}>
            {entry === 'all' ? 'All pets' : entry.charAt(0).toUpperCase() + entry.slice(1)}
          </button>
        ))}
      </div>}
      {collectionMode === 'missing' && <div className="vault-missing-intro">
        <span className="vault-kicker">PET COLLECTION GOAL</span>
        <strong>Pets you haven't collected yet</strong>
        <small>Browse missing Huge, Exclusive, Titanic and Gargantuan pets. Select one to add it to your collection.</small>
      </div>}
      {collectionMode === 'missing' && <div className="vault-row" style={{ gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
        {['all', 'huge', 'exclusive', 'titanic', 'gargantuan'].map((entry) => (
          <button key={entry} className={`vault-tab${missingCategoryFilter === entry ? ' active' : ''}`} onClick={() => setMissingCategoryFilter(entry)}>
            {entry === 'all' ? 'All categories' : entry.charAt(0).toUpperCase() + entry.slice(1)}
          </button>
        ))}
      </div>}
      <div className="vault-card vault-collection-search-panel">
        <div className="vault-collection-search">
          <Search size={19} aria-hidden="true" />
          <input className="vault-input" aria-label={collectionMode === 'missing' ? 'Find a missing pet' : 'Search your collection'} placeholder={collectionMode === 'missing' ? 'Search catalog…' : 'Search pet, nickname or signer…'} value={collectionMode === 'missing' ? catalogSearch : petSearch} onChange={(event) => collectionMode === 'missing' ? setCatalogSearch(event.target.value) : setPetSearch(event.target.value)} />
        </div>
        <details className="vault-advanced-filters vault-collection-advanced">
          <summary><SlidersHorizontal size={16} /> Advanced filters and sorting <ChevronDown size={15} /></summary>
          <div className="vault-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginTop: 12 }}>
          <div className="vault-field">
            <span className="vault-label">Variant</span>
            <select className="vault-select" value={variantFilter} onChange={(event) => setVariantFilter(event.target.value)}>
              <option value="all">All</option>
              {VARIANT_FILTERS.map((entry) => <option key={entry} value={entry}>{variantLabelWide[entry] ?? entry}</option>)}
            </select>
          </div>
          <div className="vault-field">
            <span className="vault-label">Signer</span>
            <select className="vault-select" value={signerFilter} onChange={(event) => setSignerFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="none">Unknown signer</option>
              {signersList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          <div className="vault-field">
            <span className="vault-label">Value from</span>
            <input className="vault-input" type="number" min="0" placeholder="Min" value={minValue} onChange={(event) => setMinValue(event.target.value)} />
          </div>
          <div className="vault-field">
            <span className="vault-label">Value to</span>
            <input className="vault-input" type="number" min="0" placeholder="Max" value={maxValue} onChange={(event) => setMaxValue(event.target.value)} />
          </div>
          <div className="vault-field">
            <span className="vault-label">Acquired from</span>
            <input className="vault-input" type="date" value={acquiredFrom} onChange={(event) => setAcquiredFrom(event.target.value)} />
          </div>
          <div className="vault-field">
            <span className="vault-label">Acquired to</span>
            <input className="vault-input" type="date" value={acquiredTo} onChange={(event) => setAcquiredTo(event.target.value)} />
          </div>
          <div className="vault-field">
            <span className="vault-label">Verification</span>
            <select className="vault-select" value={verificationFilter} onChange={(event) => setVerificationFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="verified">Verified only</option>
              <option value="unverified">Unverified only</option>
              <option value="not_signed">Not signed</option>
            </select>
          </div>
          <div className="vault-field">
            <span className="vault-label">Sort</span>
            <select className="vault-select" value={sort} onChange={(event) => setSort(event.target.value as CollectionSort)}>
              <option value="value_high">Highest value</option>
              <option value="value_low">Lowest value</option>
              <option value="signature_high">Highest signature value</option>
              <option value="newest">Newest acquisition</option>
              <option value="oldest">Oldest acquisition</option>
              <option value="alpha">Alphabetical</option>
            </select>
          </div>
          </div>
        </details>
      </div>

      {collectionMode === 'missing' ? (
        missingCatalog.length === 0 ? <div className="vault-empty"><div className="vault-empty-title">No missing pets found</div><div>Your tracked catalog is fully collected for these filters.</div></div> :
        <div className="vault-pet-grid">{missingCatalog.map((pet) => <button key={pet.id} className="vault-pet-card vault-missing-pet-card" onClick={() => { setPresetPetId(pet.id); setAddOpen(true); }} style={{ textAlign: 'left', padding: 0 }}><div className="vault-pet-media">{pet.image_url ? <img src={pet.image_url} alt={pet.pet_name} loading="lazy" /> : <Sparkles size={36} />}</div><div className="vault-pet-body"><div className="vault-pet-name">{pet.display_name || pet.pet_name}</div><div className="vault-pet-meta"><span>{pet.category}</span><span className="vault-pill vault-pill-blue">Choose variant +</span></div><div className="vault-pet-value">{formatValue(pet.cosmic_value)}</div></div></button>)}</div>
      ) : pets.length === 0 ? (
        <div className="vault-empty">
          <div className="vault-empty-title">Empty collection</div>
          <div>Add a signed pet to start tracking this collection.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="vault-empty">
          <div className="vault-empty-title">No pets match</div>
          <div>Adjust the filters to see more.</div>
        </div>
      ) : (
        <div className="vault-pet-grid">
          {filtered.map((pet) => <PetCard key={pet.id} pet={pet} onOpen={setDetail} />)}
        </div>
      )}

      {addOpen && (
        <AddPetModal
          data={data}
          presetPetId={presetPetId}
          onClose={() => { setAddOpen(false); setPresetPetId(null); }}
          onSubmit={async () => {
            await onRefresh();
            setCollectionMode('owned');
            setPresetPetId(null);
          }}
        />
      )}

      {detail && (
        <PetDetailModal
          pet={detail}
          data={data}
          busy={busy}
          onRemove={() => void remove(detail)}
          onClose={() => setDetail(null)}
          onSaved={async () => {
            setDetail(null);
            await onRefresh();
          }}
        />
      )}
    </div>
  );
}

/* ── pet detail (Part 3: full info, history, authorized corrections) ─ */

function PetDetailModal({ pet, data, busy, onRemove, onClose, onSaved }: {
  pet: VaultPet;
  data: VaultData;
  busy: boolean;
  onRemove: () => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const token = readStoredToken() ?? '';
  const signer = data.signers.find((entry) => entry.id === pet.signer_id) ?? null;
  const signature = data.signatures.find(
    (sig) => sig.pet_id === pet.pet_id && sig.signer_id === pet.signer_id && sig.variant === pet.variant
  ) ?? null;
  const isVerified = pet.verification_status === 'verified' || pet.verification_status === 'community_verified';
  const catalogPet = data.catalog.find((entry) => entry.id === pet.pet_id);
  const petCategory = String(catalogPet?.category ?? pet.pet_category ?? '').toLowerCase();
  const isTitanic = Boolean(catalogPet?.is_titanic) || petCategory.includes('titanic');
  const isHuge = Boolean(catalogPet?.is_huge) || petCategory.includes('huge');
  const isExclusive = Boolean(catalogPet?.is_exclusive) || petCategory.includes('exclusive');
  const cosmicSignerValue = isTitanic ? signer?.cosmic_titanic_value
    : isHuge ? signer?.cosmic_huge_value
    : isExclusive ? signer?.cosmic_exclusive_value : null;
  const signatureValue = pet.signer_id && pet.signed_status !== 'not_signed'
    ? Number(signature?.signature_value ?? cosmicSignerValue ?? 0)
    : 0;
  const combined = Number(pet.cosmic_value ?? 0) + signatureValue;

  const [editOpen, setEditOpen] = useState(false);
  const [signerPickerOpen, setSignerPickerOpen] = useState(false);
  const [signerSearch, setSignerSearch] = useState('');
  const [selectedSignerId, setSelectedSignerId] = useState(pet.signer_id ?? '');
  const [assignBusy, setAssignBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = data.is_owner || data.me === 2;
  const filteredSignerOptions = data.signers.filter((entry) => {
    const q = signerSearch.trim().toLowerCase();
    return Boolean(entry.roblox_username) && (!q || [entry.signer_name, entry.display_name, entry.roblox_username, String(entry.roblox_user_id ?? '')].some((value) => String(value ?? '').toLowerCase().includes(q)));
  });
  const assignSigner = async () => {
    const selected = data.signers.find((entry) => entry.id === selectedSignerId);
    if (!selected?.roblox_username) {
      setError('This signer has no Roblox username. Add the account details before assigning it.');
      return;
    }
    setAssignBusy(true);
    setError(null);
    try {
      await rpcCall('vault_unknown_signer_assign', token, {
        p_pet_entry_id: pet.id,
        p_roblox_username: selected.roblox_username,
        p_variant: pet.variant,
        p_notes: 'Signer assigned from the pet detail picker',
      });
      setSignerPickerOpen(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not assign this signer.');
    } finally {
      setAssignBusy(false);
    }
  };
  // vault_collection_manage 'update' overwrites signer_id unconditionally —
  // the editor always sends the current signer so an unchanged signer survives.
  const scopeCollectorNo = data.is_owner ? pet.collector_no ?? data.me : null;

  const cosmicSource = data.catalog.find((entry) => entry.id === pet.pet_id)?.value_source ?? 'manual';
  const displayedSignerName = signer ? (signer.display_name || signer.signer_name) : 'No signer assigned';
  const displayedSignatureName = signature?.signature_name || signer?.display_name || signer?.signer_name || 'Signature name unavailable';
  const signerRoleTone = (role: string) => role === 'big_games_partner' ? 'partner' : role === 'big_games_developer' ? 'developer' : role === 'content_creator' || role === 'youtuber' || role === 'streamer' ? 'creator' : 'other';

  return (
    <Modal title={pet.nickname || pet.pet_name} onClose={onClose} wide>
      <div className="vault-detail-premium-head">
        <div className="vault-detail-premium-avatar">
          {pet.pet_image ? <img src={pet.pet_image} alt={pet.pet_name} /> : <Sparkles size={36} />}
        </div>
        <div className="vault-detail-premium-identity">
          <h2>{pet.pet_name}</h2>
          <div className="vault-detail-category-line">
            <span>{pet.pet_category}</span>
            <span className="vault-detail-dot">•</span>
            <span className={pet.variant === 'rainbow' ? 'vault-detail-rainbow-text' : ''}>{variantLabelWide[pet.variant] ?? pet.variant}</span>
            {pet.quantity && pet.quantity > 1 ? <span>· ×{pet.quantity}</span> : null}
          </div>
          <div className="vault-detail-statuses">
            <span className={`vault-detail-status ${pet.signed_status === 'not_signed' ? 'is-muted' : isVerified ? 'is-verified' : 'is-review'}`}>
              {pet.signed_status === 'not_signed' ? 'NOT SIGNED' : pet.signed_status === 'manual_review' ? 'NEEDS REVIEW' : verificationLabels[pet.verification_status ?? 'needs_review'].toUpperCase()}
            </span>
            <span className="vault-detail-status is-muted">{signedStatusLabels[pet.signed_status ?? 'manual_review'].toUpperCase()}</span>
          </div>
        </div>
      </div>

      <div className="vault-stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 14 }}>
        <StatCard label="Pet value" value={formatValue(pet.cosmic_value)} hint={`source: ${cosmicSource}`} />
        <StatCard label="Signature value" value={signatureValue > 0 ? formatValue(signatureValue) : '—'} hint={signature?.signature_value != null ? 'Pet-specific signature value' : 'Assigned signer Cosmic value'} />
        <StatCard label="Combined value" value={formatValue(combined)} gold hint="Pet value + signature value" />
      </div>

      <div className="vault-divider" />
      <section className="vault-detail-premium-signer">
        <div className="vault-detail-premium-signer-top">
          <div className="vault-detail-premium-signer-avatar"><UserRoundX size={25} /></div>
          <div className="vault-detail-premium-signer-identity">
            <span className="vault-detail-section-label">SIGNER</span>
            <strong className={signer ? 'vault-signer-name-rainbow' : ''}>{displayedSignerName}</strong>
            {signer?.roblox_username && <small>@{signer.roblox_username}{signer.roblox_user_id ? ` · ${signer.roblox_user_id}` : ''}</small>}
          </div>
          {data.is_owner && <button className="vault-detail-change-signer" onClick={() => { setSelectedSignerId(pet.signer_id ?? ''); setSignerSearch(''); setSignerPickerOpen(true); }}>
            <ArrowLeft size={15} /> {signer ? 'Change signer' : 'Make signed'}
          </button>}
        </div>
        <div className="vault-detail-premium-roles">
          <span className="vault-detail-section-label">SIGNER ROLES</span>
          <div className="vault-detail-role-list">
            {signer?.roles?.length ? signer.roles.map((role) => (
              <span key={role} className={`vault-detail-role-chip is-${signerRoleTone(role)}`}>
                {role === 'big_games_partner' ? '♛' : role === 'big_games_developer' ? '</>' : role === 'content_creator' || role === 'youtuber' || role === 'streamer' ? '▧' : '✦'}
                {signerRoleLabels[role]}
              </span>
            )) : <span className="vault-detail-no-roles">—</span>}
          </div>
        </div>
        <div className="vault-detail-premium-signature">
          <span className="vault-detail-section-label">SIGNATURE NAME</span>
          <div className="vault-detail-signature-name-row">
            <strong className="vault-detail-signature-rainbow">{displayedSignatureName}</strong>
            <Pencil size={16} />
          </div>
        </div>
      </section>

      {signerPickerOpen && (
        <Modal title={pet.signer_id ? 'Change pet signer' : 'Make this pet signed'} onClose={() => !assignBusy && setSignerPickerOpen(false)}>
          <p className="vault-note" style={{ marginBottom: 12 }}>Search the signer directory, select the exact Roblox account, then save. Accounts with matching display names remain separate.</p>
          <div className="vault-field">
            <span className="vault-label">Search signer</span>
            <input className="vault-input" autoFocus value={signerSearch} onChange={(event) => setSignerSearch(event.target.value)} placeholder="Name, @username or Roblox ID…" />
          </div>
          <div className="vault-signer-picker-list">
            {filteredSignerOptions.map((entry) => (
              <button type="button" key={entry.id} className={`vault-signer-picker-option${selectedSignerId === entry.id ? ' is-selected' : ''}`} onClick={() => setSelectedSignerId(entry.id)}>
                <span className="vault-signer-picker-avatar">{entry.avatar_url ? <img src={entry.avatar_url} alt="" /> : (entry.display_name || entry.signer_name).slice(0, 2).toUpperCase()}</span>
                <span className="vault-signer-picker-copy"><strong>{entry.display_name || entry.signer_name}</strong><small>@{entry.roblox_username}{entry.roblox_user_id ? ` · ID ${entry.roblox_user_id}` : ''}</small></span>
                <span className={`vault-signer-picker-radio${selectedSignerId === entry.id ? ' is-selected' : ''}`}>{selectedSignerId === entry.id ? '✓' : ''}</span>
              </button>
            ))}
            {filteredSignerOptions.length === 0 && <div className="vault-note" style={{ padding: 16 }}>No matching signer accounts found.</div>}
          </div>
          {error && <div className="vault-error" style={{ marginTop: 10 }}>{error}</div>}
          <div className="vault-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="vault-btn" disabled={assignBusy} onClick={() => setSignerPickerOpen(false)}>Cancel</button>
            <button className="vault-btn vault-btn-gold" disabled={assignBusy || !selectedSignerId} onClick={() => void assignSigner()}>{assignBusy ? 'Saving…' : 'Save signer'}</button>
          </div>
        </Modal>
      )}

      {pet.notes && <p className="vault-note" style={{ marginTop: 12 }}>{pet.notes}</p>}

      {error && <div className="vault-error" style={{ marginTop: 10 }}>{error}</div>}

      {signature && !isVerified && canEdit && (
        <div className="vault-verify-action">
          <div><strong>Signature not verified yet</strong><small>One click confirms this signature as verified.</small></div>
          <button className="vault-btn vault-btn-verify" disabled={busy} onClick={async () => {
            setError(null);
            try {
              await rpcCall('vault_signature_manage', token, {
                p_action: 'verify',
                p_signature_id: signature.id,
                p_pet_id: pet.pet_id,
                p_signer_id: signature.signer_id,
                p_variant: signature.variant,
                p_signature_value: signature.signature_value == null ? null : Number(signature.signature_value),
                p_verification_status: 'verified'
              });
              await onSaved();
            } catch (err) {
              setError(err instanceof VaultApiError ? err.message : 'Could not verify this signature.');
            }
          }}>
            <BadgeCheck size={15} /> Mark as verified
          </button>
        </div>
      )}
      <div className="vault-row" style={{ marginTop: 18, justifyContent: 'space-between' }}>
        <button className="vault-btn vault-btn-danger" disabled={busy} onClick={onRemove}>Remove</button>
        <div className="vault-row" style={{ gap: 8 }}>
          {canEdit && <button className="vault-btn" onClick={() => setEditOpen(true)}>Correct details</button>}
          <button className="vault-btn vault-btn-gold" onClick={onClose}>Close</button>
        </div>
      </div>

      {editOpen && (
        <PetEditModal
          pet={pet}
          data={data}
          scopeCollectorNo={scopeCollectorNo}
          onClose={() => setEditOpen(false)}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

/* ── missing pets (Part 8: checklist-driven) ───────────────────── */

function MissingTab({ data }: { data: VaultData }) {
  const token = readStoredToken() ?? '';
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [checklist, setChecklist] = useState<ChecklistEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | ChecklistStatus>('missing');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [signerFilter, setSignerFilter] = useState('all');
  const [valueFilter, setValueFilter] = useState('all');
  const [sort, setSort] = useState('highest');

  const load = useCallback(async () => {
    try {
      const list = await fetchChecklist(token);
      setChecklist(list);
      setError(null);
    } catch {
      setError('Checklist could not be loaded.');
    }
    try {
      const result = await fetchStats(token);
      setStats(result);
    } catch {
      setStats(null);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    if (!checklist) return [];
    return checklist.filter((entry) =>
      entry.is_huge || entry.is_exclusive || entry.is_titanic || entry.is_gargantuan
      || ['huge', 'exclusive', 'titanic', 'gargantuan', 'gigantuan'].includes(String(entry.category).toLowerCase())
    ).map((entry): ChecklistEntry & { status: ChecklistStatus } => ({
      ...entry,
      status: entry.owned_verified
        ? 'COLLECTED'
        : entry.owned_any
          ? 'UNVERIFIED'
          : entry.signability === 'not_signable'
            ? 'NOT_AVAILABLE'
            : Date.now() - new Date(entry.created_at).getTime() < 14 * 24 * 3600 * 1000
              ? 'RECENTLY_ADDED'
              : 'MISSING',
    }));
  }, [checklist]);

  const filtered = useMemo(() => {
    let list = rows.filter((entry) => {
      if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false;
      if (signerFilter === 'with' && entry.known_signers === 0) return false;
      if (signerFilter === 'without' && entry.known_signers > 0) return false;
      const value = Number(entry.cosmic_value ?? 0);
      if (valueFilter === 'high' && value < 1_000_000) return false;
      if (valueFilter === 'mid' && (value < 100_000 || value >= 1_000_000)) return false;
      if (valueFilter === 'low' && (value >= 100_000 || entry.cosmic_value == null)) return false;
      if (valueFilter === 'unknown' && entry.cosmic_value != null) return false;
      return true;
    });
    if (sort === 'highest') list = [...list].sort((a, b) => Number(b.cosmic_value ?? 0) - Number(a.cosmic_value ?? 0));
    if (sort === 'lowest') list = [...list].sort((a, b) => Number(a.cosmic_value ?? 0) - Number(b.cosmic_value ?? 0));
    if (sort === 'alpha') list = [...list].sort((a, b) => a.pet_name.localeCompare(b.pet_name));
    if (sort === 'category') list = [...list].sort((a, b) => a.category.localeCompare(b.category) || a.pet_name.localeCompare(b.pet_name));
    if (sort === 'recent') list = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return list;
  }, [rows, statusFilter, categoryFilter, signerFilter, valueFilter, sort]);

  const categories = useMemo(() => [...new Set((checklist ?? []).map((entry) => entry.category))].sort(), [checklist]);
  const statusCount = (status: ChecklistStatus) => rows.filter((entry) => entry.status === status).length;

  if (error) return <div className="vault-error">{error}</div>;
  if (!checklist) return <div className="vault-loading"><div className="vault-spinner" /></div>;

  return (
    <div>
      <div className="vault-stat-grid">
        <div className="vault-card vault-card-gold">
          <div className="vault-stat-label">Collected (verified)</div>
          <div className="vault-stat-value">{statusCount('COLLECTED')}</div>
        </div>
        <div className="vault-card">
          <div className="vault-stat-label">Owned, unverified</div>
          <div className="vault-stat-value">{statusCount('UNVERIFIED')}</div>
        </div>
        <div className="vault-card">
          <div className="vault-stat-label">Missing</div>
          <div className="vault-stat-value">{statusCount('MISSING')}</div>
        </div>
        <div className="vault-card">
          <div className="vault-stat-label">Not signable</div>
          <div className="vault-stat-value">{statusCount('NOT_AVAILABLE')}</div>
        </div>
      </div>

      {stats?.progress && (
        <div className="vault-card vault-progress-card">
          <div className="vault-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div>
              <div className="vault-stat-label">Collection completion</div>
              <div className="vault-progress-big">
                {stats.progress.total_signable > 0
                  ? `${Math.round((stats.progress.collected_verified / stats.progress.total_signable) * 100)}%`
                  : '—'}
              </div>
            </div>
            <div className="vault-progress-facts">
              <div><strong>{stats.progress.total_signable}</strong><span> signable pets in catalog</span></div>
              <div><strong>{stats.progress.collected_verified}</strong><span> collected (verified)</span></div>
              <div><strong>{stats.progress.collected_unverified}</strong><span> owned, not yet verified</span></div>
              <div>
                <strong>{Math.max(0, stats.progress.total_signable - stats.progress.collected_verified - stats.progress.collected_unverified)}</strong>
                <span> missing</span>
              </div>
              {(stats.progress.signable_unknown > 0 || stats.progress.signable_unconfirmed > 0) && (
                <div className="vault-note" style={{ width: '100%' }}>
                  Excluded from the denominator: {stats.progress.signable_unknown} with unknown signability
                  {stats.progress.signable_unconfirmed > 0 ? `, ${stats.progress.signable_unconfirmed} not independently confirmed` : ''}.
                  Completion = verified collected ÷ confirmed signable.
                </div>
              )}
            </div>
          </div>
          {stats.progress.total_signable > 0 && (
            <div className="vault-progress-bar">
              <div
                className="vault-progress-fill"
                style={{ width: `${Math.min(100, Math.round((stats.progress.collected_verified / stats.progress.total_signable) * 100))}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="vault-card" style={{ marginBottom: 16 }}>
        <div className="vault-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <div className="vault-field">
            <span className="vault-label">Status</span>
            <select className="vault-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ChecklistStatus)}>
              <option value="all">All</option>
              <option value="missing">Missing</option>
              <option value="unverified">Owned – unverified</option>
              <option value="collected">Collected (verified)</option>
              <option value="not_available">Not signable</option>
              <option value="recently_added">Recently added to catalog</option>
            </select>
          </div>
          <div className="vault-field">
            <span className="vault-label">Category</span>
            <select className="vault-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">All</option>
              {categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          </div>
          <div className="vault-field">
            <span className="vault-label">Known signers</span>
            <select className="vault-select" value={signerFilter} onChange={(event) => setSignerFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="with">With known signers</option>
              <option value="without">Without known signers</option>
            </select>
          </div>
          <div className="vault-field">
            <span className="vault-label">Cosmic value</span>
            <select className="vault-select" value={valueFilter} onChange={(event) => setValueFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="high">1M+</option>
              <option value="mid">100K – 1M</option>
              <option value="low">Under 100K</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <div className="vault-field">
            <span className="vault-label">Sort</span>
            <select className="vault-select" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="highest">Highest value</option>
              <option value="lowest">Lowest value</option>
              <option value="alpha">Alphabetical</option>
              <option value="category">Category</option>
              <option value="recent">Recently added</option>
            </select>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="vault-empty">
          <div className="vault-empty-title">Nothing in this view</div>
          <div>Try another status filter.</div>
        </div>
      ) : (
        <div className="vault-grid">
          {filtered.map((entry) => (
            <div key={entry.pet_id} className="vault-card vault-row">
              <Gem size={18} style={{ color: 'var(--gold)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{entry.pet_name}</div>
                <div className="vault-note">
                  {entry.category} · signers: {entry.known_signers} · signature value {formatValue(entry.best_signature_value)} · pet value {formatValue(entry.cosmic_value)}
                </div>
              </div>
              <span className={`vault-pill ${
                entry.status === 'COLLECTED' ? 'vault-pill-green'
                : entry.status === 'UNVERIFIED' ? 'vault-pill-gold'
                : entry.status === 'NOT_AVAILABLE' ? 'vault-pill-gray'
                : entry.status === 'RECENTLY_ADDED' ? 'vault-pill-blue'
                : 'vault-pill-red'
              }`}>
                {entry.status === 'COLLECTED' ? 'Collected'
                  : entry.status === 'UNVERIFIED' ? 'Owned – unverified'
                  : entry.status === 'NOT_AVAILABLE' ? 'Not signable'
                  : entry.status === 'RECENTLY_ADDED' ? 'Recently added'
                  : 'Missing'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── signer database ─────────────────────────────────────────────── */

function SignerDetail({ signer, data, onClose }: { signer: Signer; data: VaultData; onClose: () => void }) {
  const records = data.signatures.filter((record) => record.signer_id === signer.id);
  return (
    <Modal title={signer.signer_name} onClose={onClose}>
      <div className="vault-stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <StatCard label="Signature records" value={String(records.length)} />
        <StatCard label="In your collection" value={String(data.pets.filter((pet) => pet.signer_id === signer.id).length)} />
      </div>
      {signer.notes && <p className="vault-note" style={{ marginTop: 14 }}>{signer.notes}</p>}
      <div className="vault-divider" />
      <span className="vault-label">Signed pets on record</span>
      <div className="vault-grid" style={{ marginTop: 10 }}>
        {records.map((record) => {
          const pet = data.catalog.find((entry) => entry.id === record.pet_id);
          return (
            <div key={record.id} className="vault-card vault-row" style={{ padding: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{pet?.pet_name ?? 'Unknown pet'}</span>
              <span className="vault-spacer" />
              <span className={`vault-pill ${record.variant === 'golden' ? 'vault-pill-gold' : record.variant === 'rainbow' ? 'vault-pill-blue' : record.variant === 'shiny' ? 'vault-pill-red' : 'vault-pill-gray'}`}>
                {variantLabel[record.variant]}
              </span>
            </div>
          );
        })}
        {records.length === 0 && <div className="vault-note">No signature records yet.</div>}
      </div>
    </Modal>
  );
}

function SignersTab({ data }: { data: VaultData }) {
  const [selected, setSelected] = useState<Signer | null>(null);
  const exportSignatures = (format: 'html' | 'csv' = 'html') => {
    const catalogById = new Map(data.catalog.map((pet) => [pet.id, pet]));
    const ownedKeys = new Set(data.pets.filter((pet) => pet.signer_id).map((pet) => `${pet.signer_id}:${pet.pet_id}`));
    const rows = data.signatures.map((record) => {
      const signer = data.signers.find((entry) => entry.id === record.signer_id);
      const pet = catalogById.get(record.pet_id);
      const owned = ownedKeys.has(`${record.signer_id}:${record.pet_id}`);
      return { signer: signer?.signer_name ?? 'Unknown signer', pet: pet?.pet_name ?? record.signature_name ?? 'Unknown signature', variant: variantLabelWide[record.variant] ?? record.variant, status: owned ? 'OWNED' : 'MISSING', verification: record.verification_status ?? 'unverified', value: record.signature_value == null ? '' : String(record.signature_value) };
    }).sort((a,b) => a.signer.localeCompare(b.signer) || a.pet.localeCompare(b.pet) || a.variant.localeCompare(b.variant));
    const ownedCount = rows.filter((row) => row.status === 'OWNED').length;
    const missingCount = rows.length - ownedCount;
    const stamp = new Date().toISOString().slice(0,10);
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char] ?? char));
    if (format === 'csv') {
      const csv = [['Signer','Signature / Pet','Variant','Collection status','Verification','Signature value'], ...rows.map((row) => [row.signer,row.pet,row.variant,row.status,row.verification,row.value])].map((line) => line.map((cell) => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\r\n');
      const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href=url; link.download=`NANZ-Signature-Checklist-${stamp}.csv`; link.click(); URL.revokeObjectURL(url); return;
    }
    const grouped = data.signers.map((signer) => ({ signer, entries: rows.filter((row) => row.signer === signer.signer_name) })).filter((group) => group.entries.length);
    const content = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NANZ Signature Registry</title><style>*{box-sizing:border-box}body{margin:0;background:#080d19;color:#edf3ff;font:14px Inter,Arial,sans-serif;padding:42px 22px}.wrap{max-width:1050px;margin:auto}.hero{padding:34px;border:1px solid #293750;border-radius:22px;background:radial-gradient(ellipse at 85% 0,#263f75 0,transparent 48%),linear-gradient(135deg,#141f35,#0d1424)}.brand{color:#8caeff;font-size:11px;font-weight:900;letter-spacing:.24em}.hero h1{font-size:34px;margin:12px 0 8px}.muted{color:#9aabc6}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0 28px}.stat{padding:18px;border:1px solid #25334b;border-radius:15px;background:#111b2d}.stat b{display:block;font-size:27px}.stat span{font-size:10px;letter-spacing:.12em;color:#91a2bf}.group{margin:22px 0}.group h2{font-size:17px;margin:0 0 10px}.count{color:#8fa6ce;font-size:12px;margin-left:8px}.table{width:100%;border-collapse:collapse;background:#10192a;border:1px solid #25334b;border-radius:13px;overflow:hidden}.table th,.table td{text-align:left;padding:12px 14px;border-bottom:1px solid #202d43}.table th{font-size:10px;letter-spacing:.12em;color:#91a2bf;background:#162238}.table td{font-size:13px}.pill{display:inline-block;padding:5px 9px;border-radius:20px;font-size:10px;font-weight:900;letter-spacing:.06em}.owned{color:#73e2b2;background:#143a32}.missing{color:#ffca78;background:#47351c}.foot{margin-top:30px;color:#687b9b;font-size:11px;text-align:center}@media(max-width:650px){body{padding:18px 10px}.hero{padding:23px}.hero h1{font-size:26px}.stats{gap:7px}.stat{padding:12px}.stat b{font-size:21px}.table th,.table td{padding:9px 7px;font-size:11px}}</style></head><body><main class="wrap"><header class="hero"><div class="brand">NANZ · SIGNED VAULT</div><h1>Signature Collection</h1><div class="muted">Your personal ownership checklist · Generated ${stamp}</div></header><section class="stats"><div class="stat"><b>${rows.length}</b><span>KNOWN SIGNATURES</span></div><div class="stat"><b style="color:#73e2b2">${ownedCount}</b><span>COLLECTED</span></div><div class="stat"><b style="color:#ffca78">${missingCount}</b><span>STILL MISSING</span></div></section>${grouped.map(({signer,entries})=>`<section class="group"><h2>${escape(signer.signer_name)} <span class="count">${entries.filter(e=>e.status==='OWNED').length}/${entries.length} collected</span></h2><table class="table"><thead><tr><th>SIGNATURE / PET</th><th>VARIANT</th><th>STATUS</th><th>VERIFICATION</th></tr></thead><tbody>${entries.map(row=>`<tr><td>${escape(row.pet)}</td><td>${escape(row.variant)}</td><td><span class="pill ${row.status==='OWNED'?'owned':'missing'}">${row.status}</span></td><td>${escape(row.verification.replaceAll('_',' '))}</td></tr>`).join('')}</tbody></table></section>`).join('')}<footer class="foot">NANZ SIGNED VAULT · PRIVATE COLLECTION REPORT</footer></main></body></html>`;
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href=url; link.download=`NANZ-Signature-Checklist-${stamp}.html`; link.click(); URL.revokeObjectURL(url);
  };
  const ownedCount = data.signatures.filter((record) => data.pets.some((pet) => pet.signer_id === record.signer_id && pet.pet_id === record.pet_id)).length;
  return (
    <div>
      <div className="vault-section-head">
        <div><span className="vault-kicker">Shared registry</span><h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>{data.signers.length} known signers</h3><div className="vault-note" style={{marginTop:5}}>{ownedCount} of {data.signatures.length} known signatures collected</div></div>
        <div className="vault-row" style={{gap:8,flexWrap:'wrap'}}><button className="vault-btn" onClick={() => exportSignatures('csv')}>Export CSV</button><button className="vault-btn vault-btn-gold" onClick={() => exportSignatures('html')}><Layers size={16}/> Export checklist</button></div>
      </div>
      {data.signers.length === 0 ? <div className="vault-empty"><div className="vault-empty-title">No signers yet</div><div>The owner can add signers in Settings.</div></div> : <div className="vault-signer-grid">{data.signers.map((signer) => <button key={signer.id} className="vault-signer-card" onClick={() => setSelected(signer)} style={{ border: 'none' }}><div className="vault-signer-avatar">{signer.avatar_url ? <img src={signer.avatar_url} alt={signer.signer_name} loading="lazy" /> : signer.signer_name.slice(0, 2).toUpperCase()}</div><div className="vault-signer-name">{signer.signer_name}</div><div className="vault-note" style={{ marginTop: 4 }}>{signer.signature_count} records</div></button>)}</div>}
      {selected && <SignerDetail signer={selected} data={data} onClose={() => setSelected(null)} />}
    </div>
  );
}
/* ── cosmic value tracker ────────────────────────────────────────── */

function ValuesTab({ data, onRefresh, isOwner }: { data: VaultData; onRefresh: () => Promise<void>; isOwner: boolean }) {
  const token = readStoredToken() ?? '';
  const [editPet, setEditPet] = useState<CatalogPet | null>(null);
  const [value, setValue] = useState('');
  const [demand, setDemand] = useState('');
  const [inGameValue, setInGameValue] = useState('');
  const [inGameSource, setInGameSource] = useState('manual_in_game_check');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [snapshots, setSnapshots] = useState<CostSnapshot[] | null>(null);
  const [historyPetId, setHistoryPetId] = useState('');
  const [history, setHistory] = useState<ValueHistoryPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchSnapshots(token);
        if (!cancelled) setSnapshots(list);
      } catch {
        if (!cancelled) setSnapshots([]);
      }
    })();
    return () => { cancelled = true; };
  }, [token, data.value_snapshots.length]);

  useEffect(() => {
    if (!historyPetId) { setHistory(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const points = await fetchValueHistory(token, historyPetId);
        if (!cancelled) setHistory(points);
      } catch {
        if (!cancelled) setHistory([]);
      }
    })();
    return () => { cancelled = true; };
  }, [token, historyPetId]);

  const open = (pet: CatalogPet) => {
    setEditPet(pet);
    setValue(pet.cosmic_value != null ? String(pet.cosmic_value) : '');
    setDemand(pet.demand != null ? String(pet.demand) : '');
    setInGameValue(pet.in_game_value != null ? String(pet.in_game_value) : '');
    setInGameSource(pet.in_game_value_source ?? 'manual_in_game_check');
    setError(null);
  };

  const save = async () => {
    if (!editPet) return;
    setBusy(true);
    setError(null);
    try {
      await rpcCall('vault_values_manage', readStoredToken() ?? '', {
        p_action: 'set_pet_value',
        p_pet_id: editPet.id,
        p_pet_value: value.trim() ? Number(value) : null,
        p_calculation_method: 'manual',
      });
      await rpcCall('vault_cosmic_values_manage', readStoredToken() ?? '', {
        p_pet_id: editPet.id,
        p_in_game_value: inGameValue.trim() ? Number(inGameValue) : null,
        p_in_game_value_source: inGameSource.trim() || 'manual_in_game_check',
      });
      setEditPet(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not save the value.');
    } finally {
      setBusy(false);
    }
  };

  const recordSnapshot = async () => {
    setBusy(true);
    try {
      await rpcCall('vault_collection_manage', readStoredToken() ?? '', { p_action: 'snapshot' });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  // ── real stored data only ────────────────────────────────────────
  const snapList = snapshots ?? [];
  const total = data.pets.reduce((sum, pet) => sum + Number(pet.cosmic_value ?? 0), 0);
  // Cosmic values are gems. Cash/Robux acquisition prices are kept separate:
  // subtract only explicitly recorded gem-denominated costs.
  const gemSpent = data.acquisitions
    .filter((entry) => String(entry.currency ?? '').toLowerCase() === 'gems')
    .reduce((sum, entry) => sum + Number(entry.purchase_price ?? 0), 0);
  const cashSpent = data.acquisitions
    .filter((entry) => String(entry.currency ?? '').toLowerCase() !== 'gems' && entry.purchase_price != null)
    .reduce((sum, entry) => sum + Number(entry.purchase_price ?? 0), 0);
  const profit = total - gemSpent;
  const pctReturn = gemSpent > 0 ? (profit / gemSpent) * 100 : null;

  const firstSnap = snapList.length > 0 ? Number(snapList[0].total_value) : null;
  const lastSnap = snapList.length > 0 ? Number(snapList[snapList.length - 1].total_value) : null;
  const periodChange = firstSnap !== null && lastSnap !== null && firstSnap !== 0
    ? ((lastSnap - firstSnap) / firstSnap) * 100
    : null;

  return (
    <div>
      <div className="vault-stat-grid">
        <StatCard label="Portfolio value" value={formatValue(total)} hint="current cosmic values" gold />
        <StatCard label="Gem cost" value={formatValue(gemSpent, '')} hint="only gem-denominated purchases" />
        <StatCard
          label={profit >= 0 ? 'Unrealized profit' : 'Unrealized loss'}
          value={`${profit >= 0 ? '+' : ''}${formatValue(profit)}`}
          hint={pctReturn !== null ? `${pctReturn >= 0 ? '+' : ''}${pctReturn.toFixed(1)}% return on gem cost` : (cashSpent > 0 ? 'cash purchases excluded from gem profit' : 'no gem purchases recorded yet')}
        />
        <StatCard
          label="Change over snapshots"
          value={periodChange !== null ? `${periodChange >= 0 ? '+' : ''}${periodChange.toFixed(1)}%` : '—'}
          hint={snapList.length >= 2 ? `${snapList.length} stored snapshots` : 'needs 2+ snapshots'}
        />
      </div>

      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">History</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>Real recorded snapshots</h3>
        </div>
        <button className="vault-btn vault-btn-sm vault-btn-gold" disabled={busy} onClick={() => void recordSnapshot()}>
          Record snapshot
        </button>
      </div>
      <p className="vault-note" style={{ marginBottom: 12 }}>
        Charts use only stored snapshots and value-history rows. Nothing is estimated; if there is not enough history yet the charts stay empty.
      </p>

      {snapList.length < 2 ? (
        <div className="vault-empty">
          <div className="vault-empty-title">Not enough history yet</div>
          <div>Record snapshots over time (or let inventory syncs trigger them) to see collection value, cost and profit curves.</div>
        </div>
      ) : (
        <div className="vault-chart-grid">
          <div className="vault-card">
            <div className="vault-stat-label">Collection value over time</div>
            <MiniChart
              points={snapList.map((snap) => ({ at: snap.captured_at, value: Number(snap.total_value) }))}
              color="var(--gold)"
            />
          </div>
          <div className="vault-card">
            <div className="vault-stat-label">Purchase cost over time</div>
            <MiniChart
              points={snapList.map((snap) => ({ at: snap.captured_at, value: Number(snap.purchase_cost ?? 0) }))}
              color="#6ea8ff"
            />
          </div>
          <div className="vault-card">
            <div className="vault-stat-label">Profit / loss over time</div>
            <MiniChart
              points={snapList.map((snap) => ({ at: snap.captured_at, value: Number(snap.total_value) - Number(snap.purchase_cost ?? 0) }))}
              color="#4ade80"
            />
          </div>
        </div>
      )}

      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Per pet</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Individual value development</h3>
        </div>
      </div>
      <div className="vault-row" style={{ marginBottom: 10, gap: 10 }}>
        <select className="vault-select" style={{ maxWidth: 320 }} value={historyPetId} onChange={(event) => setHistoryPetId(event.target.value)}>
          <option value="">Choose an owned pet…</option>
          {[...new Map(data.pets.map((pet) => [pet.pet_id, pet.pet_name])).entries()].map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        {history !== null && (
          <span className="vault-note">
            {history.length} stored change{history.length === 1 ? '' : 's'}
            {history.length > 0 && ` · source ${history[history.length - 1].source}`}
          </span>
        )}
      </div>
      {historyPetId && (history === null ? (
        <div className="vault-note">Loading history…</div>
      ) : history.length < 2 ? (
        <div className="vault-empty">
          <div className="vault-empty-title">Not enough history for this pet</div>
          <div>Value changes are recorded each time the owner updates a cosmic value.</div>
        </div>
      ) : (
        <div className="vault-card">
          <div className="vault-stat-label">Pet value + signature value (stored rows)</div>
          <MiniChart
            points={history.map((point) => ({ at: point.captured_at, value: Number(point.combined_value ?? (Number(point.pet_value ?? 0) + Number(point.signature_value ?? 0))) }))}
            color="var(--gold)"
          />
        </div>
      ))}

      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Value list</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>Cosmic values</h3>
        </div>
        {!isOwner && <span className="vault-note">Only the owner can edit values.</span>}
      </div>
      <div className="vault-table-wrap">
        <table className="vault-table">
          <thead>
            <tr><th>Pet</th><th>Owned</th><th>Cosmic value</th><th>Demand</th><th>In-game value</th><th>Source</th><th>Last update</th>{isOwner && <th />}</tr>
          </thead>
          <tbody>
            {data.catalog.map((pet) => {
              const ownedCount = data.pets.filter((entry) => entry.pet_id === pet.id).length;
              return (
                <tr key={pet.id}>
                  <td style={{ color: 'var(--text)', fontWeight: 600 }}>{pet.pet_name}</td>
                  <td className="vault-num">{ownedCount > 0 ? `×${ownedCount}` : '—'}</td>
                  <td className="vault-num" style={{ color: 'var(--gold)', fontWeight: 700 }}>{formatValue(pet.cosmic_value)}</td>
                  <td className="vault-num">{pet.demand != null ? `${pet.demand}/10` : '—'}</td>
                  <td className="vault-num" title={pet.in_game_value_source ?? 'Not recorded'}>
                    {pet.in_game_value != null ? formatValue(pet.in_game_value, '') : '—'}
                    {pet.in_game_value_timestamp && <div className="vault-note">{formatDate(pet.in_game_value_timestamp)}</div>}
                    {isOwner && (
                      <button
                        className="vault-btn vault-btn-sm"
                        style={{ marginTop: 5 }}
                        onClick={() => open(pet)}
                      >Update</button>
                    )}
                  </td>
                  <td><span className="vault-pill vault-pill-gray">{pet.value_source ?? 'manual'}</span></td>
                  <td><span className="vault-note">{snapList.length > 0 ? formatDate(snapList[snapList.length - 1].captured_at) : '—'}</span></td>
                  {isOwner && (
                    <td>
                      <button className="vault-btn vault-btn-sm" onClick={() => open(pet)}><Check size={13} /> Edit</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {data.catalog.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--text4)' }}>Catalog is empty.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editPet && (
        <Modal title={`Value — ${editPet.pet_name}`} onClose={() => setEditPet(null)}>
          <p className="vault-note" style={{ marginBottom: 10 }}>
            Cosmic Values has no official API — values are manual imports and are labeled unverified. Signature values are stored separately from pet values.
          </p>
          <div className="vault-form-grid">
            <div className="vault-field">
              <span className="vault-label">Cosmic value</span>
              <input className="vault-input" type="number" min="0" step="any" value={value} onChange={(event) => setValue(event.target.value)} placeholder="e.g. 250000" />
            </div>
            <div className="vault-field">
              <span className="vault-label">Demand (1–10)</span>
              <input className="vault-input" type="number" min="1" max="10" value={demand} onChange={(event) => setDemand(event.target.value)} placeholder="e.g. 7" />
            </div>
            <div className="vault-field">
              <span className="vault-label">Current in-game value (gems)</span>
              <input className="vault-input" type="number" min="0" value={inGameValue} onChange={(event) => setInGameValue(event.target.value)} placeholder="Optional — check in-game" />
            </div>
            <div className="vault-field">
              <span className="vault-label">In-game value source</span>
              <input className="vault-input" value={inGameSource} onChange={(event) => setInGameSource(event.target.value)} />
            </div>
          </div>
          {error && <div className="vault-error" style={{ marginTop: 10 }}>{error}</div>}
          <div className="vault-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="vault-btn" onClick={() => setEditPet(null)}>Cancel</button>
            <button className="vault-btn vault-btn-gold" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save value'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── inline SVG chart (real stored points only) ──────────────────── */

function MiniChart({ points, color }: { points: { at: string; value: number }[]; color: string }) {
  if (points.length < 2) {
    return <div className="vault-note" style={{ padding: '18px 0' }}>Not enough stored data points.</div>;
  }
  const width = 560;
  const height = 150;
  const pad = 6;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = points.map((point, index) => {
    const x = pad + (index / (points.length - 1)) * (width - pad * 2);
    const y = height - pad - ((point.value - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `M${coords.join(' L')} L${(width - pad).toFixed(1)},${height} L${pad},${height} Z`;
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="vault-chart" role="img" aria-label="Value history chart">
        <path d={area} fill={color} opacity="0.12" />
        <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle
          cx={(width - pad).toFixed(1)}
          cy={(height - pad - ((last.value - min) / span) * (height - pad * 2)).toFixed(1)}
          r="3.5" fill={color}
        />
      </svg>
      <div className="vault-row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
        <span className="vault-note">{formatDate(first.at)} · {formatValue(first.value)}</span>
        <span className="vault-note">{formatDate(last.at)} · {formatValue(last.value)}</span>
      </div>
    </div>
  );
}

/* ── verification ────────────────────────────────────────────────── */

function VerificationTab({ data, onRefresh }: { data: VaultData; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = readStoredToken() ?? '';

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await onRefresh();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Action failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const review = (request: VerificationRequest, status: 'verified' | 'rejected') =>
    run(async () => {
      await rpcCall('vault_collection_manage', token, {
        p_action: 'verify_review',
        p_request_id: request.id,
        p_request_status: status,
        p_collector_no: request.collector_no,
      });
    });

  const request = (pet: VaultPet) =>
    run(async () => {
      await rpcCall('vault_collection_manage', token, {
        p_action: 'verify_request',
        p_pet_id: pet.pet_id,
        p_signer_id: pet.signer_id,
        p_evidence_url: null,
      });
    });

  const [sigEditor, setSigEditor] = useState<SignatureRecord | null>(null);
  const [signabilityEditor, setSignabilityEditor] = useState<CatalogPet | null>(null);

  // ── work queues from REAL stored data (Part 8) ────────────────────
  const isVerifiedStatus = (status?: string) => status === 'verified' || status === 'community_verified';

  const unverifiedPets = data.pets.filter((pet) =>
    pet.signed_status !== 'not_signed' && !isVerifiedStatus(pet.verification_status));

  const unverifiedSignatures = data.signatures.filter((sig) => !isVerifiedStatus(sig.verification_status));

  const knownSignerIds = new Set(data.signers.map((signer) => signer.id));
  const unknownSignerPets = data.pets.filter((pet) =>
    pet.signed_status !== 'not_signed' && (!pet.signer_id || !knownSignerIds.has(pet.signer_id)));

  const signabilityReview = data.catalog.filter((pet) =>
    pet.signability === 'unknown' || pet.signability === 'needs_review');

  const pending = data.verification.filter((entry) => entry.status === 'pending');
  const decided = data.verification.filter((entry) => entry.status !== 'pending');
  const hasPendingFor = (petId: string) => pending.some((entry) => entry.pet_id === petId);

  const owner = data.is_owner;
  const queueCount = unverifiedPets.length + unknownSignerPets.length + signabilityReview.length + pending.length;

  return (
    <div>
      {error && <div className="vault-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Provenance</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>Verification center</h3>
        </div>
        <span className="vault-pill vault-pill-gold"><ShieldCheck size={11} /> {queueCount} items need attention</span>
      </div>
      <p className="vault-note" style={{ marginBottom: 14 }}>
        {owner
          ? 'You confirm or reject signatures, assign signers, correct classifications and confirm signability. Every change is written to the vault audit log.'
          : 'You can submit items for review. Confirmations and corrections are done by the owner — every decision is logged.'}
      </p>

      <div className="vault-stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <StatCard label="Unverified pets" value={String(unverifiedPets.length)} />
        <StatCard label="Unverified signature records" value={String(unverifiedSignatures.length)} />
        <StatCard label="Unknown signers" value={String(unknownSignerPets.length)} />
        <StatCard label="Signability to review" value={String(signabilityReview.length)} />
        <StatCard label="Open review requests" value={String(pending.length)} />
      </div>

      {/* ── queue 1: open review requests ── */}
      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Queue</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Review requests</h3>
        </div>
      </div>
      <div className="vault-grid">
        {pending.map((entry) => (
          <div key={entry.id} className="vault-card vault-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{entry.pet_name}</div>
              <div className="vault-note">Signer: {entry.signer_name ?? 'unknown'} · collector {entry.collector_no} · {formatDate(entry.created_at)}</div>
            </div>
            {owner ? (
              <div className="vault-row">
                <button className="vault-btn vault-btn-sm" disabled={busy} onClick={() => void review(entry, 'verified')}>
                  <Check size={13} /> Confirm signature
                </button>
                <button className="vault-btn vault-btn-sm vault-btn-danger" disabled={busy} onClick={() => void review(entry, 'rejected')}>
                  <X size={13} /> Reject
                </button>
              </div>
            ) : (
              <span className="vault-pill vault-pill-gray">Awaiting owner review</span>
            )}
          </div>
        ))}
        {pending.length === 0 && (
          <div className="vault-empty">
            <div className="vault-empty-title">No open requests</div>
            <div>Submit signed pets from your collection below.</div>
          </div>
        )}
      </div>

      {/* ── queue 2: unverified owned pets ── */}
      {unverifiedPets.length > 0 && (
        <>
          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Queue</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Unverified signed pets</h3>
            </div>
          </div>
          <div className="vault-grid">
            {unverifiedPets.map((pet) => (
              <div key={pet.id} className="vault-card vault-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{pet.nickname || pet.pet_name}</div>
                  <div className="vault-note">{pet.signer_name ?? 'Unknown signer'} · {variantLabelWide[pet.variant] ?? pet.variant}</div>
                </div>
                {owner ? (
                  <div className="vault-row" style={{ gap: 6 }}>
                    <button
                      className="vault-btn vault-btn-sm"
                      disabled={busy}
                      onClick={() => {
                        const sig = data.signatures.find(
                          (entry) => entry.pet_id === pet.pet_id && entry.signer_id === pet.signer_id && entry.variant === pet.variant
                        ) ?? null;
                        setSigEditor(sig ?? { id: '', pet_id: pet.pet_id, signer_id: pet.signer_id ?? '', variant: pet.variant, notes: null, signature_name: null, signature_value: null });
                      }}
                    >
                      Confirm signature
                    </button>
                    <button className="vault-btn vault-btn-sm" disabled={busy} onClick={() => void request(pet)}>
                      Mark for review
                    </button>
                  </div>
                ) : (
                  <button className="vault-btn vault-btn-sm" disabled={busy || hasPendingFor(pet.pet_id)} onClick={() => void request(pet)}>
                    {hasPendingFor(pet.pet_id) ? 'Pending' : 'Submit'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── queue 3: unknown signers ── */}
      {unknownSignerPets.length > 0 && (
        <UnknownSignerReview
          pets={unknownSignerPets}
          onSaved={onRefresh}
          owner={owner}
        />
      )}

      {/* ── queue 4: signability needing review ── */}
      {signabilityReview.length > 0 && (
        <>
          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Queue</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Signability requiring review</h3>
            </div>
            {!owner && <span className="vault-note">Only the owner can classify signability.</span>}
          </div>
          <div className="vault-grid">
            {signabilityReview.slice(0, 12).map((pet) => (
              <div key={pet.id} className="vault-card vault-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{pet.pet_name}</div>
                  <div className="vault-note">signability: {signabilityLabels[pet.signability ?? 'unknown']}{pet.signability_source ? ` · source: ${pet.signability_source}` : ''}</div>
                </div>
                {owner && (
                  <button className="vault-btn vault-btn-sm" disabled={busy} onClick={() => setSignabilityEditor(pet)}>
                    Confirm signability
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── queue 5: unverified signature records ── */}
      {unverifiedSignatures.length > 0 && (
        <>
          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Queue</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Unverified signature records</h3>
            </div>
          </div>
          <div className="vault-table-wrap">
            <table className="vault-table">
              <thead><tr><th>Pet</th><th>Signer</th><th>Signature</th><th>Value</th><th>Status</th>{owner && <th />}</tr></thead>
              <tbody>
                {unverifiedSignatures.slice(0, 12).map((sig) => {
                  const pet = data.catalog.find((entry) => entry.id === sig.pet_id);
                  const signer = data.signers.find((entry) => entry.id === sig.signer_id);
                  return (
                    <tr key={sig.id}>
                      <td style={{ fontWeight: 600 }}>{pet?.pet_name ?? 'Unknown pet'}</td>
                      <td>{signer?.signer_name ?? '—'}</td>
                      <td>{sig.signature_name ?? '—'}</td>
                      <td className="vault-num">{formatValue(sig.signature_value)}</td>
                      <td><span className="vault-pill vault-pill-gold">{verificationLabels[sig.verification_status ?? 'unverified']}</span></td>
                      {owner && (
                        <td>
                          <button className="vault-btn vault-btn-sm" disabled={busy} onClick={() => setSigEditor(sig)}>
                            Review
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── completed reviews ── */}
      {decided.length > 0 && (
        <>
          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Completed</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Reviewed requests</h3>
            </div>
          </div>
          <div className="vault-grid">
            {decided.map((entry) => (
              <div key={entry.id} className="vault-card vault-row">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{entry.pet_name}</div>
                  <div className="vault-note">{entry.signer_name ?? 'unknown'} · reviewed {formatDate(entry.reviewed_at)}</div>
                </div>
                <span className={`vault-pill ${entry.status === 'verified' ? 'vault-pill-green' : 'vault-pill-red'}`}>
                  {entry.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {sigEditor && (
        <SignatureReviewModal
          record={sigEditor}
          data={data}
          onClose={() => setSigEditor(null)}
          onSaved={async () => { setSigEditor(null); await onRefresh(); }}
        />
      )}

      {signabilityEditor && (
        <SignabilityConfirmModal
          pet={signabilityEditor}
          onClose={() => setSignabilityEditor(null)}
          onSaved={async () => { setSignabilityEditor(null); await onRefresh(); }}
        />
      )}
    </div>
  );
}

/* ── signature review modal (owner, audited) ─────────────────────── */

function SignatureReviewModal({ record, data, onClose, onSaved }: {
  record: SignatureRecord;
  data: VaultData;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isNew = record.id === '';
  const [status, setStatus] = useState<'verified' | 'community_verified' | 'unverified' | 'needs_review'>(
    (record.verification_status as 'verified' | 'community_verified' | 'unverified' | 'needs_review') ?? 'verified'
  );
  const [signerId, setSignerId] = useState(record.signer_id ?? '');
  const [value, setValue] = useState(record.signature_value != null ? String(record.signature_value) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pet = data.catalog.find((entry) => entry.id === record.pet_id);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await rpcCall('vault_signature_manage', readStoredToken() ?? '', {
        p_action: isNew ? 'add' : 'verify',
        ...(isNew ? {} : { p_signature_id: record.id }),
        p_pet_id: record.pet_id,
        ...(isNew || !record.signer_id ? { p_signer_id: signerId || null } : {}),
        p_variant: record.variant,
        ...(isNew ? { p_signature_name: record.signature_name } : {}),
        p_signature_value: value.trim() ? Number(value) : null,
        p_verification_status: status,
        p_source: isNew ? 'manual' : undefined,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not save the review.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? `New signature record — ${pet?.pet_name ?? 'pet'}` : `Review — ${pet?.pet_name ?? 'signature'}`} onClose={onClose}>
      <div className="vault-form-grid">
        <div className="vault-field">
          <span className="vault-label">Verification status</span>
          <select className="vault-select" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            {Object.entries(verificationLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        {(isNew || !record.signer_id) && (
          <div className="vault-field">
            <span className="vault-label">Assign signer</span>
            <select className="vault-select" value={signerId} onChange={(event) => setSignerId(event.target.value)}>
              <option value="">Select signer…</option>
              {data.signers.map((signer) => (
                <option key={signer.id} value={signer.id}>{signer.signer_name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="vault-field">
          <span className="vault-label">Signature value</span>
          <input className="vault-input" type="number" min="0" step="any" value={value} onChange={(event) => setValue(event.target.value)} placeholder="e.g. 150000" />
        </div>
      </div>
      {error && <div className="vault-error" style={{ marginTop: 10 }}>{error}</div>}
      <div className="vault-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="vault-btn" onClick={onClose}>Cancel</button>
        <button className="vault-btn vault-btn-gold" disabled={busy || (isNew && !signerId)} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save decision'}
        </button>
      </div>
    </Modal>
  );
}

/* ── signability confirm modal (owner, audited) ──────────────────── */

function SignabilityConfirmModal({ pet, onClose, onSaved }: {
  pet: CatalogPet;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState(pet.signability === 'unknown' ? 'signable' : pet.signability ?? 'signable');
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (source.trim().length < 3) { setError('A source is required (e.g. in-game screenshot, BIG Games update note).'); return; }
    setBusy(true);
    setError(null);
    try {
      await rpcCall('vault_signability_manage', readStoredToken() ?? '', {
        p_pet_id: pet.id,
        p_signability: value,
        p_source: source.trim(),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Signability — ${pet.pet_name}`} onClose={onClose}>
      <div className="vault-form-grid">
        <div className="vault-field">
          <span className="vault-label">Classification</span>
          <select className="vault-select" value={value} onChange={(event) => setValue(event.target.value)}>
            <option value="signable">Signable</option>
            <option value="not_signable">Not signable</option>
            <option value="unknown">Unknown</option>
            <option value="needs_review">Needs review</option>
          </select>
        </div>
        <div className="vault-field">
          <span className="vault-label">Source (required)</span>
          <input className="vault-input" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Where was this confirmed?" />
        </div>
      </div>
      {error && <div className="vault-error" style={{ marginTop: 10 }}>{error}</div>}
      <div className="vault-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="vault-btn" onClick={onClose}>Cancel</button>
        <button className="vault-btn vault-btn-gold" disabled={busy} onClick={() => void save()}>Save</button>
      </div>
    </Modal>
  );
}

/* ── settings ────────────────────────────────────────────────────── */


function UnknownSignerReview({ pets, onSaved, owner }: {
  pets: VaultPet[];
  onSaved: () => Promise<void>;
  owner: boolean;
}) {
  const [activePet, setActivePet] = useState<VaultPet | null>(null);
  const [username, setUsername] = useState('');
  const [variant, setVariant] = useState<Variant>('normal');
  const [signatureValue, setSignatureValue] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = (pet: VaultPet) => {
    setActivePet(pet);
    setUsername('');
    setVariant(pet.variant);
    setSignatureValue('');
    setNotes('');
    setMessage(null);
    setError(null);
  };

  const save = async () => {
    if (!activePet || !username.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await rpcCall('vault_unknown_signer_assign', readStoredToken() ?? '', {
        p_pet_entry_id: activePet.id,
        p_roblox_username: username.trim().replace(/^@/, ''),
        p_variant: variant,
        p_signature_value: signatureValue.trim() ? Number(signatureValue) : null,
        p_notes: notes.trim() || null,
      });
      await onSaved();
      setActivePet(null);
      setMessage('Signer assigned. The pet is marked Needs review until verified.');
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not assign this signer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Queue</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Pets with unknown signers</h3>
        </div>
        {!owner && <span className="vault-note">Only the owner can assign a signer.</span>}
      </div>
      {message && <div className="vault-success" style={{ marginBottom: 12 }}>{message}</div>}
      <div className="vault-grid">
        {pets.map((pet) => (
          <div key={pet.id} className="vault-card vault-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{pet.nickname || pet.pet_name}</div>
              <div className="vault-note">{variantLabelWide[pet.variant] ?? pet.variant} · {pet.pet_category}</div>
            </div>
            <span className="vault-pill vault-pill-red">No signer assigned</span>
            {owner && <button className="vault-btn vault-btn-sm" onClick={() => open(pet)}>I have a signature</button>}
          </div>
        ))}
      </div>
      {activePet && (
        <Modal title={`Assign signer — ${activePet.nickname || activePet.pet_name}`} onClose={() => setActivePet(null)}>
          <p className="vault-note" style={{ marginBottom: 12 }}>
            Enter the Roblox username shown on the signature. The assignment stays unverified until a separate review confirms it.
          </p>
          <div className="vault-field">
            <span className="vault-label">Roblox username</span>
            <input className="vault-input" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="@Username" />
          </div>
          <div className="vault-form-grid" style={{ marginTop: 10 }}>
            <div className="vault-field">
              <span className="vault-label">Variant</span>
              <select className="vault-select" value={variant} onChange={(event) => setVariant(event.target.value as Variant)}>
                {(['normal','golden','rainbow','shiny'] as Variant[]).map((v) => <option key={v} value={v}>{variantLabel[v]}</option>)}
              </select>
            </div>
            <div className="vault-field">
              <span className="vault-label">Signature value (optional)</span>
              <input className="vault-input" type="number" min="0" value={signatureValue} onChange={(event) => setSignatureValue(event.target.value)} placeholder="Gems" />
            </div>
          </div>
          <div className="vault-field" style={{ marginTop: 10 }}>
            <span className="vault-label">Evidence / notes</span>
            <textarea className="vault-textarea" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Screenshot link, proof, context…" />
          </div>
          {error && <div className="vault-error" style={{ marginTop: 10 }}>{error}</div>}
          <div className="vault-row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="vault-btn" onClick={() => setActivePet(null)}>Cancel</button>
            <button className="vault-btn vault-btn-gold" disabled={busy || username.trim().length < 3} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Assign & send to review'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function SettingsTab({ data, onRefresh, onSignOut }: { data: VaultData; onRefresh: () => Promise<void>; onSignOut: () => void }) {
  const [label1, setLabel1] = useState(data.collectors.find((c) => c.collector_no === 1)?.label ?? '');
  const [label2, setLabel2] = useState(data.collectors.find((c) => c.collector_no === 2)?.label ?? '');
  const [oldPasskey, setOldPasskey] = useState('');
  const [newPasskey, setNewPasskey] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const saveSettings = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await rpcCall('vault_settings_manage', readStoredToken() ?? '', {
        p_collector_no: 1,
        p_label: label1.trim() || null,
      });
      await rpcCall('vault_settings_manage', readStoredToken() ?? '', {
        p_collector_no: 2,
        p_label: label2.trim() || null,
      });
      setMessage({ ok: true, text: 'Collector labels updated.' });
      await onRefresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof VaultApiError ? err.message : 'Could not save settings.' });
    } finally {
      setBusy(false);
    }
  };

  const changePasskey = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await rpcCall('vault_passkey_change', readStoredToken() ?? '', {
        p_old_passkey: oldPasskey,
        p_new_passkey: newPasskey,
      });
      setOldPasskey('');
      setNewPasskey('');
      setMessage({ ok: true, text: 'Passkey changed. Use the new one next time.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof VaultApiError ? err.message : 'Could not change the passkey.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!data.is_owner && (
        <>
          <div className="vault-card" style={{ marginBottom: 16 }}>
            <div className="vault-stat-label">Your role</div>
            <div className="vault-note" style={{ marginTop: 6 }}>
              You manage your own collection. Catalog, signers, values and vault settings are owner-managed.
            </div>
          </div>

          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Accounts</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Your Roblox connection</h3>
            </div>
          </div>
          <RobloxConnectionCard
            account={(data.roblox_accounts ?? []).find((account) => account.is_self) ?? {
              collector_no: data.me,
              roblox_user_id: null,
              roblox_username: null,
              display_name: null,
              avatar_url: null,
              connection_status: 'disconnected',
              is_self: true,
            }}
            isAdmin={false}
          />

          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Integrations</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Data sources</h3>
            </div>
          </div>
          <DataSourcesPanel data={data} />
        </>
      )}

      {data.is_owner && (
        <>
          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Owner</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>Vault settings</h3>
            </div>
          </div>
          <div className="vault-card">
            <div className="vault-form-grid">
              <div className="vault-field">
                <span className="vault-label">Collector 1 label</span>
                <input className="vault-input" value={label1} onChange={(event) => setLabel1(event.target.value)} />
              </div>
              <div className="vault-field">
                <span className="vault-label">Collector 2 label</span>
                <input className="vault-input" value={label2} onChange={(event) => setLabel2(event.target.value)} />
              </div>
            </div>
            <div className="vault-row" style={{ marginTop: 14 }}>
              <button className="vault-btn vault-btn-gold" disabled={busy} onClick={() => void saveSettings()}>Save labels</button>
            </div>
          </div>

          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Accounts</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>Roblox connections</h3>
            </div>
          </div>
          <div className="vault-grid">
            {(data.roblox_accounts ?? []).length > 0 ? (
              (data.roblox_accounts ?? []).map((account) => (
                <RobloxConnectionCard key={account.collector_no} account={account} isAdmin />
              ))
            ) : (
              [1, 2].map((collectorNo) => (
                <RobloxConnectionCard
                  key={collectorNo}
                  account={{
                    collector_no: collectorNo,
                    roblox_user_id: null,
                    roblox_username: null,
                    display_name: null,
                    avatar_url: null,
                    connection_status: 'disconnected',
                    is_self: collectorNo === data.me,
                  }}
                  isAdmin
                />
              ))
            )}
          </div>

          <SyncHistory />

          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Integration</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>BIG Games connection</h3>
            </div>
          </div>
          <BigGamesConnect onSynced={onRefresh} />

          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Integrations</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Data sources &amp; freshness</h3>
            </div>
          </div>
          <DataSourcesPanel data={data} />

          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Signer database</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Shared signer registry</h3>
            </div>
          </div>
          <SignerAdmin data={data} onRefresh={onRefresh} />

          <div className="vault-section-head">
            <div>
              <span className="vault-kicker">Catalog</span>
              <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Master pet catalog</h3>
            </div>
          </div>
          <CatalogAdmin data={data} onRefresh={onRefresh} />
        </>
      )}

      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Security</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Change your passkey</h3>
        </div>
      </div>

      <div className="vault-card">
        <div className="vault-form-grid">
          <div className="vault-field">
            <span className="vault-label">Current passkey</span>
            <input className="vault-input" type="password" value={oldPasskey} onChange={(event) => setOldPasskey(event.target.value)} />
          </div>
          <div className="vault-field">
            <span className="vault-label">New passkey (min 10)</span>
            <input className="vault-input" type="password" value={newPasskey} onChange={(event) => setNewPasskey(event.target.value)} />
          </div>
        </div>
        <div className="vault-row" style={{ marginTop: 14 }}>
          <button className="vault-btn" disabled={busy || oldPasskey.length < 6 || newPasskey.length < 10} onClick={() => void changePasskey()}>
            Update passkey
          </button>
          <button className="vault-btn vault-btn-danger" onClick={onSignOut}><LogOut size={14} /> Lock vault now</button>
        </div>
        {message && (
          <div className={message.ok ? 'vault-success' : 'vault-error'} style={{ marginTop: 12 }}>{message.text}</div>
        )}
      </div>
    </div>
  );
}

/* ── data source status panel (Part 9) ───────────────────────────── */

function DataSourcesPanel({ data }: { data: VaultData }) {
  const accounts = data.roblox_accounts ?? [];
  const mine = accounts.find((account) => account.is_self) ?? accounts[0];
  const oauth = mine?.connection_status === 'connected';
  const lastSync = mine?.last_synced_at ?? null;
  const syncFresh = lastSync ? (Date.now() - new Date(lastSync).getTime()) < 24 * 3600 * 1000 : false;

  const cosmicCount = data.catalog.filter((entry) => entry.value_source != null).length;
  const signerCount = data.signers.length;
  const robloxAvatarOk = Boolean(mine?.avatar_url);

  const rows: { name: string; detail: string; ok: boolean | null }[] = [
    {
      name: 'BIG Games inventory',
      detail: oauth
        ? `Connected · last sync ${formatDate(lastSync)}${syncFresh ? '' : ' (over 24h ago)'}`
        : 'Not connected — connect under Roblox connections',
      ok: oauth,
    },
    {
      name: 'Cosmic Values',
      detail: cosmicCount > 0
        ? `Manual import mode — ${cosmicCount} catalog values on record (no official API exists)`
        : 'Manual import mode — no values imported yet',
      ok: cosmicCount > 0 ? true : null,
    },
    {
      name: 'Signer registry',
      detail: signerCount > 0 ? `${signerCount} signers curated by the owner` : 'Empty — owner adds signers',
      ok: signerCount > 0 ? true : null,
    },
    {
      name: 'Roblox avatar cache',
      detail: robloxAvatarOk ? 'Avatar resolved via Roblox' : 'No avatar cached yet',
      ok: robloxAvatarOk ? true : null,
    },
  ];

  return (
    <div className="vault-card">
      <div className="vault-stat-label" style={{ marginBottom: 10 }}>Data source status</div>
      <div className="vault-activity-list" style={{ marginTop: 0 }}>
        {rows.map((row) => (
          <div key={row.name} className="vault-activity-row">
            <span className={`vault-dot ${row.ok === true ? '' : row.ok === false ? 'vault-dot-red' : 'vault-dot-blue'}`} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{row.name}</div>
              <div className="vault-note">{row.detail}</div>
            </div>
            <span className={`vault-pill ${row.ok === true ? 'vault-pill-green' : row.ok === false ? 'vault-pill-red' : 'vault-pill-gray'}`}>
              {row.ok === true ? 'OK' : row.ok === false ? 'Action needed' : 'Manual'}
            </span>
          </div>
        ))}
      </div>
      <p className="vault-note" style={{ marginTop: 10, fontSize: 11.5 }}>
        Failed external requests never erase stored data — the vault keeps the last known inventory and values.
      </p>
    </div>
  );
}

function SyncHistory() {
  const [rows, setRows] = useState<SyncLogRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await rpcCall('vault_sync_log_get', readStoredToken() ?? '', {});
        const list = Array.isArray(result.result) ? result.result : [];
        if (!cancelled) { setRows(list as SyncLogRow[]); setLoaded(true); }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!loaded) return null;
  if (rows.length === 0) return null;

  return (
    <>
      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Sync protocol</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Recent inventory scans</h3>
        </div>
      </div>
      <div className="vault-card">
        {rows.map((row, index) => (
          <div key={index} className="vault-row" style={{ padding: '6px 0', flexWrap: 'wrap' }}>
            <span className={`vault-pill ${row.status === 'ok' ? 'vault-pill-green' : 'vault-pill-red'}`}>{row.status}</span>
            <span className="vault-note">{row.finished_at ? new Date(row.finished_at).toLocaleString() : '—'}</span>
            {row.status === 'ok' ? (
              <span className="vault-note">
                {row.signed_found ?? 0} signed found · {row.added ?? 0} added · {row.updated ?? 0} updated · {row.removed ?? 0} removed
                {row.scanned_items != null ? ` · ${row.scanned_items} items scanned` : ''}
              </span>
            ) : (
              <span className="vault-note">{row.error_code ?? 'error'}</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

type SyncLogRow = {
  status: string;
  source: string;
  scanned_items: number | null;
  signed_found: number | null;
  added: number | null;
  updated: number | null;
  removed: number | null;
  error_code: string | null;
  error_message: string | null;
  http_status: number | null;
  started_at: string;
  finished_at: string | null;
};

function SignerAdmin({ data, onRefresh }: { data: VaultData; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [roblox, setRoblox] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await rpcCall('vault_signer_manage', readStoredToken() ?? '', {
        p_action: 'add',
        p_signer_name: name.trim(),
        p_roblox_username: roblox.trim() || null,
      });
      setName('');
      setRoblox('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not add the signer.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (signer: Signer) => {
    if (!window.confirm(`Remove signer ${signer.signer_name}? Signature records and pet links are removed with it.`)) return;
    setBusy(true);
    try {
      await rpcCall('vault_signer_manage', readStoredToken() ?? '', { p_action: 'delete', p_signer_id: signer.id });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vault-card">
      <div className="vault-form-grid">
        <div className="vault-field">
          <span className="vault-label">Signer name</span>
          <input className="vault-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. xX_Signer" />
        </div>
        <div className="vault-field">
          <span className="vault-label">Roblox username (optional)</span>
          <input className="vault-input" value={roblox} onChange={(event) => setRoblox(event.target.value)} />
        </div>
      </div>
      <div className="vault-row" style={{ marginTop: 12 }}>
        <button className="vault-btn vault-btn-gold vault-btn-sm" disabled={busy || name.trim().length < 2} onClick={() => void add()}>
          <Plus size={13} /> Add signer
        </button>
        {error && <span className="vault-error">{error}</span>}
      </div>
      <div className="vault-divider" />
      <div className="vault-grid">
        {data.signers.map((signer) => (
          <div key={signer.id} className="vault-row" style={{ padding: '4px 0' }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{signer.signer_name}</span>
            <span className="vault-note">{signer.signature_count} records</span>
            <span className="vault-spacer" />
            <button className="vault-btn vault-btn-sm vault-btn-danger" disabled={busy} onClick={() => void remove(signer)}>
              <X size={12} /> Remove
            </button>
          </div>
        ))}
        {data.signers.length === 0 && <div className="vault-note">No signers registered yet.</div>}
      </div>
    </div>
  );
}

function CatalogAdmin({ data, onRefresh }: { data: VaultData; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Signed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [signabilityEdit, setSignabilityEdit] = useState<{ id: string; name: string } | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await rpcCall('vault_catalog_manage', readStoredToken() ?? '', {
        p_action: 'add',
        p_pet_name: name.trim(),
        p_category: category,
      });
      setName('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not add the pet.');
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    setError(null);
    setImportResult(null);
    try {
      const result = await vaultCall('catalog-import', {});
      setImportResult(`Import complete: ${result.added ?? 0} new, ${result.updated ?? 0} updated, ${result.skipped ?? 0} skipped.`);
      await onRefresh();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (pet: CatalogPet) => {
    if (!window.confirm(`Remove ${pet.pet_name} from the catalog? Owned entries are removed with it.`)) return;
    setBusy(true);
    try {
      await rpcCall('vault_catalog_manage', readStoredToken() ?? '', { p_action: 'delete', p_pet_id: pet.id });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const visible = data.catalog.filter((pet) => {
    if (filter === 'all') return true;
    if (filter === 'unclassified') return !pet.signability || pet.signability === 'unknown' || pet.signability === 'needs_review';
    return pet.signability === filter;
  });

  return (
    <div className="vault-card">
      <div className="vault-row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="vault-btn vault-btn-gold vault-btn-sm" disabled={busy} onClick={() => void runImport()}>
          <RefreshCw size={13} className={busy ? 'vault-spin' : ''} /> Import from BIG Games API
        </button>
        <span className="vault-note">
          Adds Huge / Exclusive / Titanic / Gargantuan pets as signability "unknown". Manual classifications are preserved.
        </span>
      </div>
      {importResult && <div className="vault-success" style={{ marginBottom: 10 }}>{importResult}</div>}

      <div className="vault-form-grid">
        <div className="vault-field">
          <span className="vault-label">Pet name</span>
          <input className="vault-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Huge Signed Dragon" />
        </div>
        <div className="vault-field">
          <span className="vault-label">Category</span>
          <select className="vault-select" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="Signed">Signed</option>
            <option value="Huge">Huge</option>
            <option value="Titanic">Titanic</option>
            <option value="Exclusive">Exclusive</option>
          </select>
        </div>
      </div>
      <div className="vault-row" style={{ marginTop: 12 }}>
        <button className="vault-btn vault-btn-gold vault-btn-sm" disabled={busy || name.trim().length < 2} onClick={() => void add()}>
          <Plus size={13} /> Add pet manually
        </button>
        {error && <span className="vault-error">{error}</span>}
      </div>

      <div className="vault-divider" />
      <div className="vault-row" style={{ marginBottom: 10 }}>
        <select className="vault-select" style={{ maxWidth: 200 }} value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All pets</option>
          <option value="unclassified">Unclassified only</option>
          <option value="signable">Signable</option>
          <option value="not_signable">Not signable</option>
          <option value="needs_review">Needs review</option>
        </select>
        <span className="vault-note">{visible.length} pets shown</span>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {visible.map((pet) => (
          <div key={pet.id} className="vault-row" style={{ padding: '5px 0', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{pet.pet_name}</span>
            <span className="vault-note">{pet.category}</span>
            <span className={`vault-pill ${signabilityTone[pet.signability ?? 'unknown']}`}>
              {signabilityLabels[pet.signability ?? 'unknown']}
            </span>
            <span className="vault-spacer" />
            <button
              className="vault-btn vault-btn-sm"
              onClick={() => setSignabilityEdit({ id: pet.id, name: pet.pet_name })}
            ><ShieldCheck size={12} /> Classify</button>
            <button className="vault-btn vault-btn-sm vault-btn-danger" disabled={busy} onClick={() => void remove(pet)}>
              <X size={12} />
            </button>
          </div>
        ))}
        {visible.length === 0 && <div className="vault-note">No pets in this view.</div>}
      </div>

      {signabilityEdit && (
        <SignabilityEditor
          pet={signabilityEdit}
          onClose={() => setSignabilityEdit(null)}
          onSaved={async () => { setSignabilityEdit(null); await onRefresh(); }}
        />
      )}
    </div>
  );
}

function SignabilityEditor({ pet, onClose, onSaved }: {
  pet: { id: string; name: string };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState('signable');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (source.trim().length < 3) { setError('A source is required (e.g. in-game screenshot, BIG Games update note).'); return; }
    setBusy(true);
    setError(null);
    try {
      await rpcCall('vault_signability_manage', readStoredToken() ?? '', {
        p_pet_id: pet.id,
        p_signability: value,
        p_source: source.trim(),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Signability — ${pet.name}`} onClose={onClose}>
      <div className="vault-form-grid">
        <div className="vault-field">
          <span className="vault-label">Classification</span>
          <select className="vault-select" value={value} onChange={(event) => setValue(event.target.value)}>
            <option value="signable">Signable</option>
            <option value="not_signable">Not signable</option>
            <option value="unknown">Unknown</option>
            <option value="needs_review">Needs review</option>
          </select>
        </div>
        <div className="vault-field">
          <span className="vault-label">Source (required)</span>
          <input className="vault-input" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Where was this confirmed?" />
        </div>
      </div>
      {error && <div className="vault-error" style={{ marginTop: 10 }}>{error}</div>}
      <div className="vault-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="vault-btn" onClick={onClose}>Cancel</button>
        <button className="vault-btn vault-btn-gold" disabled={busy} onClick={() => void save()}>Save</button>
      </div>
    </Modal>
  );
}

/* ── setup wizard (first run) ────────────────────────────────────── */

function SetupScreen({ onDone }: { onDone: () => void }) {
  const [ownerPasskey, setOwnerPasskey] = useState('');
  const [collector2Passkey, setCollector2Passkey] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (ownerPasskey !== confirm) { setError('Confirmation does not match.'); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await vaultCall('setup', {
        owner_passkey: ownerPasskey,
        collector2_passkey: collector2Passkey,
      });
      if (result.status === 'ok') onDone();
      else setError('Setup failed. Try again.');
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Setup failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vault-lock-wrap">
      <div className="vault-lock-card" style={{ maxWidth: 440 }}>
        <div className="vault-lock-icon"><Lock size={30} /></div>
        <h1 className="vault-lock-title">Set up the vault</h1>
        <p className="vault-lock-sub">
          First-time setup: choose the two collector passkeys. Keep them safe —
          they are the only way into the vault.
        </p>
        <form className="vault-lock-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <input className="vault-input" type="password" placeholder="Owner passkey (min 10 chars)" value={ownerPasskey} onChange={(event) => setOwnerPasskey(event.target.value)} />
          <input className="vault-input" type="password" placeholder="Collector 2 passkey (min 10 chars)" value={collector2Passkey} onChange={(event) => setCollector2Passkey(event.target.value)} />
          <input className="vault-input" type="password" placeholder="Confirm owner passkey" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          <button className="vault-btn vault-btn-gold" type="submit" disabled={busy || ownerPasskey.length < 10 || collector2Passkey.length < 10 || confirm.length < 10}>
            {busy ? 'Configuring…' : 'Configure vault'}
          </button>
          {error && <div className="vault-lock-error">{error}</div>}
        </form>
      </div>
    </div>
  );
}

/* ── url routing (Part 1) ────────────────────────────────────────── */

const VAULT_BASE = '/signed-vault';
const VALID_TABS: VaultTab[] = vaultTabs.map((entry) => entry.id);

type VaultRoute = { tab: VaultTab; signerId: string | null };

function parseVaultPath(pathname: string): VaultRoute {
  const rest = pathname.startsWith(VAULT_BASE)
    ? pathname.slice(VAULT_BASE.length).replace(/^\/+|\/+$/g, '')
    : '';
  if (!rest) return { tab: 'overview', signerId: null };
  const segments = rest.split('/');
  const head = segments[0];
  if (head === 'signers' && segments[1]) return { tab: 'signers', signerId: decodeURIComponent(segments[1]) };
  if ((VALID_TABS as string[]).includes(head)) return { tab: head as VaultTab, signerId: null };
  return { tab: 'overview', signerId: null };
}

function buildVaultPath(tab: VaultTab, signerId?: string | null): string {
  if (tab === 'signers' && signerId) return `${VAULT_BASE}/signers/${encodeURIComponent(signerId)}`;
  if (tab === 'overview') return VAULT_BASE;
  return `${VAULT_BASE}/${tab}`;
}

function useVaultRoute() {
  const [route, setRoute] = useState<VaultRoute>(() => parseVaultPath(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseVaultPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((tab: VaultTab, signerId?: string | null) => {
    const next = buildVaultPath(tab, signerId);
    if (window.location.pathname !== next) {
      window.history.pushState(null, '', next);
    }
    setRoute(parseVaultPath(next));
    window.scrollTo({ top: 0 });
  }, []);

  return { ...route, navigate };
}

/* ── shell ───────────────────────────────────────────────────────── */

export default function SignedVaultApp() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The BIG Games OAuth redirect lands on /signed-vault/callback (a GET
  // navigation from an external site) — it is handled before any session
  // UI so the exchange runs even with no active vault session.
  if (path === '/signed-vault/callback') {
    return (
      <div className="vault-app">
        <div className="bg-glow bg-glow-1 vault-bg-glow-1" />
        <OAuthCallback />
      </div>
    );
  }

  return (
    <VaultErrorBoundary>
      <VaultShell />
    </VaultErrorBoundary>
  );
}

class VaultErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'An unexpected interface error occurred.' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[NANZO Signed Vault] Render error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="vault-app">
          <div className="bg-glow bg-glow-1 vault-bg-glow-1" />
          <div className="vault-lock-wrap">
            <div className="vault-lock-card">
              <div className="vault-lock-icon"><ShieldCheck size={30} /></div>
              <h1 className="vault-lock-title">The vault could not be displayed</h1>
              <p className="vault-lock-sub">
                The page hit an interface error instead of showing a blank screen. Your collection data has not been changed.
              </p>
              <p className="vault-note" style={{ marginTop: 12, overflowWrap: 'anywhere' }}>
                {this.state.message}
              </p>
              <button className="vault-btn vault-btn-gold" style={{ marginTop: 18 }} onClick={() => window.location.reload()}>
                <RefreshCw size={14} /> Reload vault
              </button>
              <a className="vault-btn" href="/" style={{ marginTop: 10 }}>Back to NANZO</a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function VaultShell() {
  const session = useVaultSession();

  const route = useVaultRoute();
  const tab = route.tab;
  const navigate = route.navigate;

  const refresh = useCallback(async () => {
    await session.refresh();
  }, [session]);

  // Part 10: automatic frontend refresh every ~3 minutes, guarded so a
  // slow in-flight refresh is never duplicated.
  const refreshingRef = useRef(false);
  useEffect(() => {
    if (session.phase !== 'ready') return;
    const id = window.setInterval(() => {
      if (refreshingRef.current || document.hidden) return;
      refreshingRef.current = true;
      void refresh().finally(() => { refreshingRef.current = false; });
    }, 180_000);
    return () => window.clearInterval(id);
  }, [session.phase, refresh]);

  useEffect(() => {
    document.title = 'NANZO Signed Vault';
    return () => { document.title = 'NANZO — Elite Clan'; };
  }, []);

  if (session.phase === 'loading') {
    return (
      <div className="vault-app">
        <div className="bg-glow bg-glow-1 vault-bg-glow-1" />
        <div className="bg-glow bg-glow-2 vault-bg-glow-2" />
        <div className="vault-loading"><div className="vault-spinner" /></div>
      </div>
    );
  }

  if (session.phase === 'setup') {
    return (
      <div className="vault-app">
        <div className="bg-glow bg-glow-1 vault-bg-glow-1" />
        <div className="bg-glow bg-glow-2 vault-bg-glow-2" />
        <SetupScreen onDone={() => { session.setPhase('locked'); }} />
      </div>
    );
  }

  if (session.phase === 'locked') {
    return (
      <div className="vault-app">
        <div className="bg-glow bg-glow-1 vault-bg-glow-1" />
        <div className="bg-glow bg-glow-2 vault-bg-glow-2" />
        <div className="bg-glow bg-glow-3 vault-bg-glow-3" />
        <LockScreen
          title="NANZO Signed Vault"
          subtitle="Exclusive collector platform for Pet Simulator 99 signed pets. Enter your vault passkey."
          onSubmit={session.signIn}
        />
      </div>
    );
  }

  if (session.phase === 'denied' || !session.data) {
    return (
      <div className="vault-app">
        <div className="bg-glow bg-glow-1 vault-bg-glow-1" />
        <DeniedScreen />
      </div>
    );
  }

  const data = session.data;

  return (
    <div className="vault-app">
      <div className="bg-glow bg-glow-1 vault-bg-glow-1" />
      <div className="bg-glow bg-glow-2 vault-bg-glow-2" />
      <div className="bg-glow bg-glow-3 vault-bg-glow-3" />

      <header className="vault-nav">
        <div className="vault-nav-inner">
          <a className="vault-brand" href="/" title="Back to the main site">
            <span className="logo-mark vault-logo-mark"><img src="/image.png" alt="NANZ" /></span>
            <span className="vault-brand-text">
              <span className="vault-brand-title">NANZO</span>
              <span className="vault-brand-sub">SIGNED VAULT</span>
            </span>
          </a>
          <nav className="vault-tabs vault-header-tabs">
            {vaultTabs.filter((entry) => ['overview', 'collection', 'signers', 'acquisitions', 'trade-calculator'].includes(entry.id)).map((entry) => (
              <button key={entry.id} className={`vault-tab${tab === entry.id ? ' active' : ''}`} onClick={() => navigate(entry.id)}>{entry.label}</button>
            ))}
          </nav>
          <div className="vault-nav-right">
            <span className="vault-collector-chip">
              {data.is_owner ? 'Owner' : 'Collector 2'}
            </span>
            <button className="vault-exit" onClick={() => void session.signOut()} title="Lock vault">
              <LogOut size={15} />
            </button>
          </div>
        </div>
        
      </header>

      <main className={`vault-main${tab === 'overview' ? ' vault-overview-main' : ''}`}>
        {tab !== 'signers' && (
          <div className={tab === 'overview' ? 'vault-overview-hero' : undefined} style={{ marginBottom: 22 }}>
            <span className="vault-kicker">Signed Vault</span>
            <h1 className="vault-title">{vaultTabs.find((entry) => entry.id === tab)?.label ?? 'Overview'}</h1>
            <p className="vault-subtitle">
              {data.is_owner
                ? 'Your signed pets, signer records and trade history in one place.'
                : 'Your collection, signer records and trade history.'}
            </p>
          </div>
        )}

        {tab === 'overview' && <OverviewTab data={data} onNavigate={navigate} />}
        {tab === 'collection' && <CollectionTab data={data} onRefresh={refresh} isOwner={data.is_owner} />}
        {tab === 'scanner' && <InventoryScannerTab onRefresh={refresh} isOwner={data.is_owner} />}
        {tab === 'missing' && <MissingTab data={data} />}
        {tab === 'signers' && (
          <SignerGallery
            data={data}
            selectedSignerId={route.signerId}
            onOpenSigner={(id) => navigate('signers', id || undefined)}
            onRefresh={refresh}
            isOwner={data.is_owner}
          />
        )}
        {tab === 'acquisitions' && (
          <AcquisitionsPage isOwner={data.is_owner} myCollectorNo={data.me} onRefresh={refresh} />
        )}
        {tab === 'trade-calculator' && <TradeCalculator data={data} token={session.token} />}
        {tab === 'values' && <ValuesTab data={data} onRefresh={refresh} isOwner={data.is_owner} />}
        {tab === 'verification' && <VerificationTab data={data} onRefresh={refresh} />}
        {tab === 'settings' && <SettingsTab data={data} onRefresh={refresh} onSignOut={() => void session.signOut()} />}
      </main>
    </div>
  );
}

function PetEditModal({ pet, data, scopeCollectorNo, onClose, onSaved }: {
  pet: VaultPet;
  data: VaultData;
  scopeCollectorNo: number | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [signerId, setSignerId] = useState(pet.signer_id ?? '');
  const [variant, setVariant] = useState<Variant>(pet.variant);
  const [nickname, setNickname] = useState(pet.nickname ?? '');
  const [acquiredAt, setAcquiredAt] = useState(pet.acquired_at ?? '');
  const [price, setPrice] = useState(pet.purchase_price != null ? String(pet.purchase_price) : '');
  const [notes, setNotes] = useState(pet.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await rpcCall('vault_collection_manage', readStoredToken() ?? '', {
        p_action: 'update',
        p_pet_entry_id: pet.id,
        ...(scopeCollectorNo ? { p_collector_no: scopeCollectorNo } : {}),
        p_signer_id: signerId || null,
        p_variant: variant,
        p_nickname: nickname.trim() || null,
        p_acquired_at: acquiredAt || null,
        p_purchase_price: price.trim() ? Number(price) : null,
        p_notes: notes.trim() || null,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not save the correction.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Correct — ${pet.nickname || pet.pet_name}`} onClose={onClose}>
      <p className="vault-note" style={{ marginBottom: 12 }}>
        Manual corrections are recorded in the vault log with who changed what.
      </p>
      <div className="vault-form-grid">
        <div className="vault-field">
          <span className="vault-label">Signer</span>
          <select className="vault-select" value={signerId} onChange={(event) => setSignerId(event.target.value)}>
            <option value="">Unknown / none</option>
            {data.signers.map((signer) => (
              <option key={signer.id} value={signer.id}>{signer.signer_name}</option>
            ))}
          </select>
        </div>
        <div className="vault-field">
          <span className="vault-label">Variant</span>
          <select className="vault-select" value={variant} onChange={(event) => setVariant(event.target.value as Variant)}>
            {(['normal', 'golden', 'rainbow', 'shiny'] as Variant[]).map((value) => (
              <option key={value} value={value}>{variantLabel[value]}</option>
            ))}
          </select>
        </div>
        <div className="vault-field">
          <span className="vault-label">Acquired on</span>
          <input className="vault-input" type="date" value={acquiredAt} onChange={(event) => setAcquiredAt(event.target.value)} />
        </div>
        <div className="vault-field">
          <span className="vault-label">Purchase price</span>
          <input className="vault-input" type="number" min="0" step="any" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Unknown" />
        </div>
        <div className="vault-field">
          <span className="vault-label">Nickname</span>
          <input className="vault-input" value={nickname} onChange={(event) => setNickname(event.target.value)} />
        </div>
      </div>
      <div className="vault-field" style={{ marginTop: 12 }}>
        <span className="vault-label">Notes</span>
        <textarea className="vault-textarea" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      {error && <div className="vault-error" style={{ marginTop: 10 }}>{error}</div>}
      <div className="vault-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="vault-btn" onClick={onClose}>Cancel</button>
        <button className="vault-btn vault-btn-gold" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save correction'}</button>
      </div>
    </Modal>
  );
}
