import { useMemo, useState } from 'react';
import {
  ArrowLeft, BadgeCheck, Check, ChevronRight, ExternalLink, Layers3, Pencil, Plus, Search, ShieldAlert, Trash2, UserRound, Box, X, Youtube,
} from 'lucide-react';
import {
  VaultApiError, formatDate, formatValue, readStoredToken, rpcCall, importCosmicSigners,
  signerRoleLabels, verificationLabels, vaultCall,
  type Signer, type SignerRole, type VaultData, type Variant, variantLabel,
} from './vaultApi';
import { Modal, StatCard } from './SignedVaultApp';

const roleOptions = Object.keys(signerRoleLabels) as SignerRole[];

const verificationTone: Record<string, string> = {
  verified: 'vault-pill-green',
  community_verified: 'vault-pill-blue',
  needs_review: 'vault-pill-gold',
  unverified: 'vault-pill-gray',
};

const signabilityTone: Record<string, string> = {
  signable: 'vault-pill-green',
  not_signable: 'vault-pill-red',
  needs_review: 'vault-pill-gold',
  unknown: 'vault-pill-gray',
};

/* ── signer gallery: /signed-vault/signers ───────────────────────── */

export function SignerGallery({ data, onOpenSigner, onRefresh, isOwner, selectedSignerId = null }: {
  data: VaultData;
  onOpenSigner: (signerId: string) => void;
  onRefresh: () => Promise<void>;
  isOwner: boolean;
  selectedSignerId?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [verification, setVerification] = useState('all');
  const [ownership, setOwnership] = useState<'all' | 'owned' | 'missing'>('all');
  const [sort, setSort] = useState<'name' | 'signatures'>('name');
  const [editor, setEditor] = useState<'new' | Signer | null>(null);
  const [importingCosmic, setImportingCosmic] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const exportSignatureChecklist = (format: 'html' | 'csv') => {
    const ownedKeys = new Set(data.pets
      .filter((pet) => pet.signer_id && pet.signed_status !== 'not_signed')
      .map((pet) => `${pet.signer_id}|${pet.pet_id}|${pet.variant}`));
    const rows = data.signatures.map((record) => {
      const pet = data.catalog.find((entry) => entry.id === record.pet_id);
      const owned = ownedKeys.has(`${record.signer_id}|${record.pet_id}|${record.variant}`);
      const signer = data.signers.find((entry) => entry.id === record.signer_id);
      return {
        signer: signer?.display_name || signer?.signer_name || 'Unknown signer',
        username: signer?.roblox_username || '',
        pet: pet?.display_name || pet?.pet_name || 'Unknown pet',
        variant: variantLabel[record.variant] || record.variant,
        signature: record.signature_name || signer?.display_name || signer?.signer_name || '',
        status: owned ? 'OWNED' : 'MISSING',
        value: record.signature_value == null ? '' : String(record.signature_value),
      };
    }).sort((a, b) => a.signer.localeCompare(b.signer) || a.pet.localeCompare(b.pet));
    const ownedCount = rows.filter((row) => row.status === 'OWNED').length;
    const missingCount = rows.length - ownedCount;
    const stamp = new Date().toISOString().slice(0, 10);
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char] || char));
    if (format === 'csv') {
      const quote = (value: string) => '"' + value.replace(/"/g, '""') + '"';
      const csv = [['Signer','Roblox Username','Pet','Variant','Signature','Ownership','Signature Value'], ...rows.map((row) => [row.signer,row.username,row.pet,row.variant,row.signature,row.status,row.value])]
        .map((line) => line.map((value) => quote(String(value))).join(',')).join('\r\n');
      const blob = new Blob(['\\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `NANZO-Signature-Checklist-${stamp}.csv`; link.click(); URL.revokeObjectURL(url);
      return;
    }
    const body = rows.map((row) => `<tr><td>${escapeHtml(row.signer)}<small>@${escapeHtml(row.username)}</small></td><td>${escapeHtml(row.pet)}</td><td>${escapeHtml(row.variant)}</td><td>${escapeHtml(row.signature)}</td><td class="${row.status === 'OWNED' ? 'owned' : 'missing'}">${row.status}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>NANZO Signature Checklist</title><style>
      *{box-sizing:border-box}body{margin:0;padding:48px;background:#080b16;color:#f4f6ff;font:14px Inter,Arial,sans-serif}
      main{max-width:1200px;margin:auto}.eyebrow{color:#f34aa0;letter-spacing:3px;font-weight:800;font-size:11px}
      h1{font-size:38px;margin:10px 0}p{color:#9da9c1}.stats{display:flex;gap:12px;margin:28px 0}.stat{background:#141a2b;border:1px solid #293149;border-radius:14px;padding:18px 24px;min-width:180px}.stat b{display:block;font-size:26px}.stat span{color:#9da9c1;font-size:12px}
      table{width:100%;border-collapse:collapse;background:#101625;border:1px solid #293149;border-radius:14px;overflow:hidden}th,td{text-align:left;padding:14px;border-bottom:1px solid #252d40}th{color:#a9b7d1;font-size:10px;letter-spacing:1px}small{display:block;color:#8996b0;margin-top:4px}.owned{color:#5ee0b0;font-weight:800}.missing{color:#ff75a9;font-weight:800}
      @media print{body{background:white;color:#111;padding:20px}table,.stat{background:white;color:#111}.stats{break-inside:avoid}}
    </style></head><body><main><div class="eyebrow">NANZO SIGNED VAULT</div><h1>Signature Ownership Checklist</h1><p>Exported ${stamp} · Known signature records and collection ownership</p><div class="stats"><div class="stat"><b>${rows.length}</b><span>Known signatures</span></div><div class="stat"><b class="owned">${ownedCount}</b><span>Collected</span></div><div class="stat"><b class="missing">${missingCount}</b><span>Missing</span></div></div><table><thead><tr><th>SIGNER</th><th>PET</th><th>VARIANT</th><th>SIGNATURE</th><th>STATUS</th></tr></thead><tbody>${body}</tbody></table></main></body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `NANZO-Signature-Checklist-${stamp}.html`; link.click(); URL.revokeObjectURL(url);
  };


  // The signer gallery reflects signatures that are actually in either
  // collector's current collection, not the lifetime Cosmic signature catalog.
  const ownedSignedPets = useMemo(() => {
    const allPets = [...data.pets, ...(data.is_owner ? (data.other_pets ?? []) : [])];
    const seen = new Set<string>();
    return allPets.filter((pet) => {
      if (!pet.signer_id || pet.signed_status === 'not_signed') return false;
      const key = pet.id || `${pet.signer_id}|${pet.pet_id}|${pet.variant}|${pet.inventory_uid ?? pet.instance_id ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data.pets, data.other_pets, data.is_owner]);

  const ownedSignatureCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pet of ownedSignedPets) {
      counts.set(pet.signer_id!, (counts.get(pet.signer_id!) ?? 0) + 1);
    }
    return counts;
  }, [ownedSignedPets]);

  const ownedSignerIds = useMemo(() => new Set(ownedSignatureCounts.keys()), [ownedSignatureCounts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.signers
      .filter((signer) => {
        if (q && !(signer.signer_name.toLowerCase().includes(q)
          || (signer.roblox_username ?? '').toLowerCase().includes(q)
          || (signer.display_name ?? '').toLowerCase().includes(q))) return false;
        if (category !== 'all' && !(signer.roles ?? []).includes(category as SignerRole)) return false;
        if (verification !== 'all' && signer.verification_status !== verification) return false;
        if (ownership === 'owned' && !ownedSignerIds.has(signer.id)) return false;
        if (ownership === 'missing' && ownedSignerIds.has(signer.id)) return false;
        return true;
      })
      .sort((a, b) => {
        const ownedOrder = Number(ownedSignerIds.has(b.id)) - Number(ownedSignerIds.has(a.id));
        if (ownedOrder !== 0) return ownedOrder;
        return sort === 'name'
          ? a.signer_name.localeCompare(b.signer_name)
          : (ownedSignatureCounts.get(b.id) ?? 0) - (ownedSignatureCounts.get(a.id) ?? 0);
      });
  }, [data.signers, query, category, verification, ownership, sort, ownedSignerIds, ownedSignatureCounts]);

  const ownedSignerCount = data.signers.filter((entry) => ownedSignerIds.has(entry.id)).length;
  const missingSignerCount = Math.max(0, data.signers.length - ownedSignerCount);

  return (
    <div className="vault-signer-page">
      <div className="vault-signers-hero">
        <div>
          <span className="vault-signers-eyebrow">SIGNED VAULT</span>
          <h2>Signers</h2>
          <p>Your signed pets, signer records and trade history in one place.</p>
        </div>
        <div className="vault-signers-hero-mark" aria-hidden="true" />
      </div>
      <div className="vault-signers-toolbar">
        <div className="vault-signers-stats">
          <div className="vault-signers-stat"><UserRound size={31} /><div><strong>{data.signers.length.toLocaleString('en-US')}</strong><span>Total Signers</span></div></div>
          <div className="vault-signers-stat"><Layers3 size={32} /><div><strong>{ownedSignerCount}</strong><span>In Your Collection</span></div></div>
          <div className="vault-signers-stat"><Box size={31} /><div><strong>{missingSignerCount}</strong><span>Not Collected Yet</span></div></div>
        </div>
        <div className="vault-signers-actions">
          <button className="vault-btn vault-btn-sm" onClick={() => exportSignatureChecklist('html')}>↓ Export Checklist</button>
          <button className="vault-btn vault-btn-sm" onClick={() => exportSignatureChecklist('csv')}>↓ Export CSV</button>
          {isOwner && <>
          <button className="vault-btn vault-btn-sm vault-signers-import" disabled={importingCosmic} onClick={() => {
              setImportingCosmic(true); setImportError(null); setImportSummary(null);
              void importCosmicSigners()
                .then(async (result) => {
                  setImportSummary(`Cosmic Values refreshed · ${Number(result.updated ?? 0)} existing signer records updated · ${Number(result.skipped ?? 0)} unmatched source rows skipped. Signer records and identities were not changed.`);
                  await onRefresh();
                })
                .catch((err) => setImportError(err instanceof Error ? err.message : 'Signer import failed.'))
                .finally(() => setImportingCosmic(false));
            }}>{importingCosmic ? 'Importing…' : '↓  Update Cosmic Values'}</button>
            <button className="vault-btn vault-btn-gold vault-btn-sm vault-signers-add" onClick={() => setEditor('new')}><Plus size={17} /> Add Signer</button>
          </>}
        </div>
      </div>
      {importSummary && <div className="vault-success" style={{ marginBottom: 12 }}>{importSummary}</div>}
      {importError && <div className="vault-error" style={{ marginBottom: 12 }}>{importError}</div>}
      <div className="vault-signers-filter-panel">
        <div className="vault-signers-search"><Search size={18} /><input placeholder="Search name, @username or display name..." value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search signers" /></div>
        <select className="vault-select" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="all">All Categories</option>{roleOptions.map((role) => <option key={role} value={role}>{signerRoleLabels[role]}</option>)}
        </select>
        <select className="vault-select" value={ownership} onChange={(event) => setOwnership(event.target.value as 'all' | 'owned' | 'missing')}>
          <option value="all">All Signers</option><option value="owned">I have signatures ({ownedSignerCount})</option><option value="missing">I don't have signatures ({missingSignerCount})</option>
        </select>
        <select className="vault-select" value={verification} onChange={(event) => setVerification(event.target.value)}>
          <option value="all">Any Verification</option>{Object.entries(verificationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select className="vault-select" value={sort} onChange={(event) => setSort(event.target.value as 'name' | 'signatures')}>
          <option value="name">Sort: A–Z</option><option value="signatures">Sort: Records</option>
        </select>
      </div>
      {filtered.length === 0 ? (
        <div className="vault-empty"><div className="vault-empty-title">No signers match</div><div>Adjust the search or filters.</div></div>
      ) : (
        <div className="vault-signer-grid">
          {filtered.map((signer) => {
            const isOwned = ownedSignerIds.has(signer.id);
            return (
            <button key={signer.id} className={`vault-signer-card${isOwned ? ' is-owned-signer' : ''}`} onClick={() => onOpenSigner(signer.id)}>
              <div className="vault-signer-card-top">
                <div className="vault-signer-card-identity">
                  <div className="vault-signer-avatar">{signer.avatar_url ? <img src={signer.avatar_url} alt={signer.signer_name} loading="lazy" /> : signer.signer_name.slice(0, 2).toUpperCase()}</div>
                  <div className="vault-signer-card-names">
                    <div className={`vault-signer-name${isOwned ? ' vault-owned-signer-name' : ''}`}>{signer.display_name || signer.signer_name}</div>
                    <div className="vault-note">@{signer.roblox_username || signer.signer_name}</div>
                    <div className="vault-signer-card-badges">
                      <span className={`vault-ownership-badge ${ownedSignerIds.has(signer.id) ? 'is-owned' : 'is-missing'}`}><span className="vault-ownership-dot" />{ownedSignerIds.has(signer.id) ? 'OWNED' : 'MISSING'}</span>
                      {!isOwned && <span className={`vault-verification-badge ${verificationTone[signer.verification_status ?? 'unverified']}`}>{verificationLabels[signer.verification_status ?? 'unverified']}</span>}
                    </div>
                  </div>
                </div>
                <span className="vault-signer-open"><ChevronRight size={19} /></span>
              </div>
              <div className="vault-signer-metrics">
                <div><small>EXCLUSIVE</small><strong>{signer.cosmic_exclusive_value != null ? formatValue(signer.cosmic_exclusive_value, '') : signer.cosmic_exclusive_status === 'soon' ? 'SOON' : signer.cosmic_exclusive_status === 'na' ? 'N/A' : '—'}</strong></div>
                <div><small>HUGE</small><strong>{signer.cosmic_huge_value != null ? formatValue(signer.cosmic_huge_value, '') : signer.cosmic_huge_status === 'soon' ? 'SOON' : signer.cosmic_huge_status === 'na' ? 'N/A' : '—'}</strong></div>
                <div><small>TITANIC</small><strong>{signer.cosmic_titanic_value != null ? formatValue(signer.cosmic_titanic_value, '') : signer.cosmic_titanic_status === 'soon' ? 'SOON' : signer.cosmic_titanic_status === 'na' ? 'N/A' : '—'}</strong></div>
                <div><small>DEMAND</small><strong>{signer.cosmic_demand != null ? `${signer.cosmic_demand}/10` : signer.cosmic_demand_status === 'na' ? 'N/A' : '—'}</strong></div>
              </div>
              <div className="vault-signer-card-footer"><span>{ownedSignatureCounts.get(signer.id) ?? 0} owned signatures</span><span>{(signer.roles ?? []).slice(0, 2).map((role) => signerRoleLabels[role]).join(' · ') || 'Community signer'}</span></div>
            </button>
          )})}
        </div>
      )}
      {editor && <SignerEditor data={data} signer={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={onRefresh} />}
      {selectedSignerId && <SignerDetailPage data={data} signerId={selectedSignerId} onBack={() => onOpenSigner('')} />}
    </div>
  );
}

/* ── signer detail page: /signed-vault/signers/:id ───────────────── */

export function SignerDetailPage({ data, signerId, onBack }: {
  data: VaultData;
  signerId: string;
  onBack: () => void;
}) {
  const signer = data.signers.find((entry) => entry.id === signerId);
  const [editOpen, setEditOpen] = useState(false);
  if (!signer) return (
    <div className="vault-signer-modal-backdrop" onMouseDown={onBack}>
      <section className="vault-signer-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <button className="vault-signer-modal-close" onClick={onBack} aria-label="Close"><X size={19} /></button>
        <div className="vault-empty"><div className="vault-empty-title">Signer not found</div></div>
      </section>
    </div>
  );
  const allSignerPets = [...data.pets, ...(data.is_owner ? (data.other_pets ?? []) : [])];
  const seenSignerPetIds = new Set<string>();
  const ownedSignerPets = allSignerPets.filter((pet) => {
    if (pet.signer_id !== signer.id || pet.signed_status === 'not_signed') return false;
    const key = pet.id || `${pet.signer_id}|${pet.pet_id}|${pet.variant}|${pet.inventory_uid ?? pet.instance_id ?? ''}`;
    if (seenSignerPetIds.has(key)) return false;
    seenSignerPetIds.add(key);
    return true;
  });
  const signatures = data.signatures.filter((record) => record.signer_id === signer.id
    && ownedSignerPets.some((pet) => pet.pet_id === record.pet_id && pet.variant === record.variant));
  const ownerPets = data.is_owner ? (data.other_pets ?? []).filter((pet) => pet.signer_id === signer.id && pet.signed_status !== 'not_signed') : [];
  const myPets = data.pets.filter((pet) => pet.signer_id === signer.id && pet.signed_status !== 'not_signed');
  const hasOwnedPets = ownedSignerPets.length > 0;
  const totalValue = myPets.reduce((sum, pet) => {
    const catalogPet = data.catalog.find((entry) => entry.id === pet.pet_id);
    const category = String(catalogPet?.category ?? pet.pet_category ?? '').toLowerCase();
    const isTitanic = Boolean(catalogPet?.is_titanic) || category.includes('titanic');
    const isHuge = Boolean(catalogPet?.is_huge) || category.includes('huge');
    const isExclusive = Boolean(catalogPet?.is_exclusive) || category.includes('exclusive');
    const cosmicValue = isTitanic ? signer.cosmic_titanic_value
      : isHuge ? signer.cosmic_huge_value
      : isExclusive ? signer.cosmic_exclusive_value : null;
    const signature = signatures.find((record) => record.pet_id === pet.pet_id && record.variant === pet.variant);
    const value = cosmicValue != null ? Number(cosmicValue)
      : signature && (signature.verification_status === 'verified' || signature.verification_status === 'community_verified')
        ? Number(signature.signature_value ?? pet.cosmic_value ?? 0)
        : Number(pet.cosmic_value ?? 0);
    return sum + value;
  }, 0);
  const verified = signer.verification_status === 'verified' || signer.verification_status === 'community_verified';
  return (
    <div className="vault-signer-modal-backdrop" onMouseDown={onBack}>
      <section className="vault-signer-modal vault-signer-modal-refined" role="dialog" aria-modal="true" aria-label={signer.signer_name + ' signer profile'} onMouseDown={(event) => event.stopPropagation()}>
        <button className="vault-signer-modal-close" onClick={onBack} aria-label="Close signer details"><X size={19} /></button>
        <div className="vault-signer-modal-scroll">
          <div className="vault-profile-hero vault-profile-hero-refined">
            <div className="vault-profile-identity">
              <div className="vault-profile-avatar">{signer.avatar_url ? <img src={signer.avatar_url} alt={signer.signer_name} /> : signer.signer_name.slice(0, 2).toUpperCase()}</div>
              <div className="vault-profile-main">
                <h2 className={hasOwnedPets ? 'vault-owned-signer-name' : undefined}>{signer.display_name || signer.signer_name}</h2>
                <p>@{signer.roblox_username || signer.signer_name}</p>
                <div className="vault-profile-badges">
                  {(signer.roles ?? []).map((role) => <span key={role} className={'vault-profile-role role-' + role}>{signerRoleLabels[role]}</span>)}
                  {!hasOwnedPets && <span className={'vault-profile-role vault-profile-verification' + (verified ? ' is-verified' : '')}><BadgeCheck size={12} /> {verificationLabels[signer.verification_status ?? 'unverified']}</span>}
                </div>
                <div className="vault-profile-links">
                  {signer.profile_url && <a href={signer.profile_url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Roblox profile</a>}
                  {signer.youtube_channel_url && <a href={signer.youtube_channel_url} target="_blank" rel="noreferrer"><Youtube size={13} /> {signer.youtube_channel_name || 'YouTube'}</a>}
                  {data.is_owner && <button onClick={() => setEditOpen(true)}><Pencil size={13} /> Edit profile</button>}
                </div>
              </div>
            </div>
          </div>

          <div className="vault-profile-stat-grid vault-profile-stat-grid-refined">
            <div className="vault-profile-stat vault-profile-stat-featured"><span>VERIFIED SIGNATURE VALUE</span><strong>{totalValue > 0 ? formatValue(totalValue) : '—'}</strong></div>
            <div className="vault-profile-stat"><span>COSMIC EXCLUSIVE</span><strong>{signer.cosmic_exclusive_value != null ? formatValue(signer.cosmic_exclusive_value, '') : signer.cosmic_exclusive_status === 'soon' ? 'SOON' : signer.cosmic_exclusive_status === 'na' ? 'N/A' : '—'}</strong></div>
            <div className="vault-profile-stat"><span>COSMIC HUGE</span><strong>{signer.cosmic_huge_value != null ? formatValue(signer.cosmic_huge_value, '') : signer.cosmic_huge_status === 'soon' ? 'SOON' : signer.cosmic_huge_status === 'na' ? 'N/A' : '—'}</strong></div>
            <div className="vault-profile-stat"><span>COSMIC TITANIC</span><strong>{signer.cosmic_titanic_value != null ? formatValue(signer.cosmic_titanic_value, '') : signer.cosmic_titanic_status === 'soon' ? 'SOON' : signer.cosmic_titanic_status === 'na' ? 'N/A' : '—'}</strong></div>
            <div className="vault-profile-stat"><span>COSMIC DEMAND</span><strong>{signer.cosmic_demand != null ? signer.cosmic_demand + '/10' : signer.cosmic_demand_status === 'na' ? 'N/A' : '—'}</strong></div>
            <div className="vault-profile-stat"><span>IN YOUR COLLECTION</span><strong>{myPets.length}</strong></div>
            {data.is_owner && <div className="vault-profile-stat"><span>IN COLLECTOR 2 VAULT</span><strong>{ownerPets.length}</strong></div>}
          </div>

          <section className="vault-known-signatures">
            <div className="vault-known-signatures-kicker">CURRENT COLLECTION</div>
            <h3>OWNED SIGNATURES</h3>
            <div className="vault-known-signatures-underline" aria-hidden="true" />
            <div className="vault-table-wrap vault-known-signatures-table">
              <table className="vault-table">
                <thead><tr><th>Pet</th><th>Variant</th><th>Signature</th><th>Signature Value</th></tr></thead>
                <tbody>{ownedSignerPets.map((ownedPet) => {
                  const record = signatures.find((entry) => entry.pet_id === ownedPet.pet_id && entry.variant === ownedPet.variant);
                  const catalogPet = data.catalog.find((entry) => entry.id === ownedPet.pet_id);
                  return <tr key={ownedPet.id}>
                    <td style={{ fontWeight: 750, color: 'var(--text)' }}>{catalogPet?.display_name || catalogPet?.pet_name || ownedPet.pet_name || 'Unknown pet'}</td>
                    <td>{variantLabel[ownedPet.variant]}</td>
                    <td><span className="vault-signature-name-rainbow">{record?.signature_name || ownedPet.signer_name || signer.display_name || signer.signer_name}</span></td>
                    <td className="vault-num" style={{ color: 'var(--gold)', fontWeight: 800 }}>{record?.signature_value != null ? formatValue(record.signature_value) : ownedPet.cosmic_value != null ? formatValue(ownedPet.cosmic_value) : '—'}</td>
                  </tr>;
                })}{ownedSignerPets.length === 0 && <tr><td colSpan={4} className="vault-known-signatures-empty">No signed pets from this signer are currently in either collection.</td></tr>}</tbody>
              </table>
            </div>
          </section>
        </div>
        {data.is_owner && editOpen && <SignerEditor data={data} signer={signer} onClose={() => setEditOpen(false)} onSaved={async () => setEditOpen(false)} />}
      </section>
    </div>
  );
}

/* ── signer editor (owner) ───────────────────────────────────────── */

function SignerEditor({ data, signer, onClose, onSaved }: {
  data: VaultData;
  signer: Signer | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = Boolean(signer);
  const [name, setName] = useState(signer?.signer_name ?? '');
  const [robloxName, setRobloxName] = useState(signer?.roblox_username ?? '');
  const [displayName, setDisplayName] = useState(signer?.display_name ?? '');
  const [roles, setRoles] = useState<SignerRole[]>(signer?.roles ?? []);
  const [ytId, setYtId] = useState(signer?.youtube_channel_id ?? '');
  const [ytName, setYtName] = useState(signer?.youtube_channel_name ?? '');
  const [ytUrl, setYtUrl] = useState(signer?.youtube_channel_url ?? '');
  const [ytSubs, setYtSubs] = useState(signer?.youtube_subscribers ? String(signer.youtube_subscribers) : '');
  const [status, setStatus] = useState(signer?.verification_status ?? 'unverified');
  const [notes, setNotes] = useState(signer?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleRole = (role: SignerRole) => {
    setRoles((current) => current.includes(role) ? current.filter((entry) => entry !== role) : [...current, role]);
  };

  const save = async () => {
    if (name.trim().length < 2) { setError('Signer name is required.'); return; }
    setBusy(true);
    setError(null);
    try {
      // Resolve the Roblox account first so we only store verified profiles
      let resolved: Record<string, unknown> = {};
      const roblox = robloxName.trim();
      if (roblox.length >= 3 && (!isEdit || roblox !== signer?.roblox_username)) {
        const lookup = await vaultCall('roblox-lookup', { username: roblox });
        resolved = {
          p_roblox_username: lookup.roblox_username,
          p_roblox_user_id: lookup.roblox_user_id,
          p_display_name: lookup.display_name,
          p_avatar_url: lookup.avatar_url,
          p_profile_url: lookup.profile_url,
        };
      } else if (isEdit) {
        resolved = {
          p_roblox_username: roblox || null,
          p_roblox_user_id: signer?.roblox_user_id ?? null,
          p_display_name: displayName.trim() || null,
          p_avatar_url: signer?.avatar_url ?? null,
          p_profile_url: signer?.profile_url ?? null,
        };
      }

      await rpcCall('vault_signer_manage_v2', readStoredToken() ?? '', {
        p_action: isEdit ? 'update' : 'add',
        ...(isEdit ? { p_signer_id: signer?.id } : {}),
        p_signer_name: name.trim(),
        ...resolved,
        p_roles: roles,
        p_is_developer: roles.includes('big_games_developer'),
        p_is_partner: roles.includes('big_games_partner'),
        p_is_creator: roles.includes('community_creator') || roles.includes('content_creator'),
        p_youtube_channel_id: ytId.trim() || null,
        p_youtube_channel_name: ytName.trim() || null,
        p_youtube_channel_url: ytUrl.trim() || null,
        p_youtube_subscribers: ytSubs.trim() ? Number(ytSubs) : null,
        p_verification_status: status,
        p_notes: notes.trim() || null,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not save the signer.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!signer) return;
    if (!window.confirm(`Delete ${signer.signer_name}? Signature records are removed with the profile.`)) return;
    setBusy(true);
    try {
      await rpcCall('vault_signer_manage_v2', readStoredToken() ?? '', { p_action: 'delete', p_signer_id: signer.id });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not delete.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isEdit ? `Edit — ${signer?.signer_name}` : 'Add signer'} onClose={onClose}>
      <div className="vault-form-grid">
        <div className="vault-field">
          <span className="vault-label">Signer name</span>
          <input className="vault-input" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="vault-field">
          <span className="vault-label">Roblox username</span>
          <input className="vault-input" value={robloxName} onChange={(event) => setRobloxName(event.target.value)} placeholder="resolved via Roblox API" />
        </div>
        <div className="vault-field">
          <span className="vault-label">Display name (optional)</span>
          <input className="vault-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </div>
        <div className="vault-field">
          <span className="vault-label">Verification status</span>
          <select className="vault-select" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            {Object.entries(verificationLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="vault-field" style={{ marginTop: 12 }}>
        <span className="vault-label">Roles</span>
        <div className="vault-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {roleOptions.map((role) => (
            <button
              key={role}
              className={`vault-btn vault-btn-sm${roles.includes(role) ? ' vault-btn-gold' : ''}`}
              onClick={() => toggleRole(role)}
            >
              {roles.includes(role) ? <Check size={11} /> : <Plus size={11} />} {signerRoleLabels[role]}
            </button>
          ))}
        </div>
      </div>

      <div className="vault-divider" />
      <span className="vault-label"><Youtube size={12} /> YouTube (only manually verified channels)</span>
      <div className="vault-form-grid" style={{ marginTop: 8 }}>
        <div className="vault-field">
          <span className="vault-label">Channel ID</span>
          <input className="vault-input" value={ytId} onChange={(event) => setYtId(event.target.value)} placeholder="UC…" />
        </div>
        <div className="vault-field">
          <span className="vault-label">Channel name</span>
          <input className="vault-input" value={ytName} onChange={(event) => setYtName(event.target.value)} />
        </div>
        <div className="vault-field">
          <span className="vault-label">Channel URL</span>
          <input className="vault-input" value={ytUrl} onChange={(event) => setYtUrl(event.target.value)} placeholder="https://youtube.com/@…" />
        </div>
        <div className="vault-field">
          <span className="vault-label">Subscribers</span>
          <input className="vault-input" type="number" min="0" value={ytSubs} onChange={(event) => setYtSubs(event.target.value)} />
        </div>
      </div>

      <div className="vault-field" style={{ marginTop: 12 }}>
        <span className="vault-label">Notes</span>
        <textarea className="vault-textarea" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      {error && <div className="vault-error" style={{ marginTop: 10 }}>{error}</div>}
      <div className="vault-row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
        <button className="vault-btn" onClick={onClose}>Cancel</button>
        <button className="vault-btn vault-btn-gold" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save signer'}
        </button>
      </div>

      {isEdit && (
        <>
          <div className="vault-divider" />
          <span className="vault-label" style={{ color: 'var(--red)' }}>Danger zone</span>
          <p className="vault-note">Signer records are kept separate by Roblox account. Merging is disabled to protect alternate and legacy accounts.</p>
          <div className="vault-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <span className="vault-spacer" />
            <button className="vault-btn vault-btn-sm vault-btn-danger" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={12} /> Delete signer
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export { verificationTone, signabilityTone };
