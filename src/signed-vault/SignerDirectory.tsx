import { useMemo, useState } from 'react';
import {
  ArrowLeft, BadgeCheck, Check, ExternalLink, Pencil, Plus, Search, ShieldAlert, Trash2, X, Youtube,
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

export function SignerGallery({ data, onOpenSigner, onRefresh, isOwner }: {
  data: VaultData;
  onOpenSigner: (signerId: string) => void;
  onRefresh: () => Promise<void>;
  isOwner: boolean;
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

  const ownedSignerIds = useMemo(() => new Set(
    data.pets.filter((pet) => pet.signer_id && pet.signed_status !== 'not_signed').map((pet) => pet.signer_id as string)
  ), [data.pets]);

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
      .sort((a, b) => sort === 'name'
        ? a.signer_name.localeCompare(b.signer_name)
        : b.signature_count - a.signature_count);
  }, [data.signers, query, category, verification, ownership, sort]);

  const ownedSignerCount = data.signers.filter((entry) => ownedSignerIds.has(entry.id)).length;
  const missingSignerCount = Math.max(0, data.signers.length - ownedSignerCount);

  return (
    <div className="vault-signer-page">
      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Shared registry</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>{data.signers.length.toLocaleString('en-US')} signer records</h3>
          <div className="vault-note">Each Roblox account is a separate record, even when display names match.</div>
          <div className="vault-signer-counts">
            <div><small>In your collection</small><strong>{ownedSignerCount}</strong></div>
            <div><small>Not collected yet</small><strong>{missingSignerCount}</strong></div>
            <div><small>Total signer accounts</small><strong>{data.signers.length}</strong></div>
          </div>
        </div>
        {isOwner && (
          <div className="vault-row" style={{ gap: 8 }}>
            <button
              className="vault-btn vault-btn-sm"
              disabled={importingCosmic}
              onClick={() => {
                setImportingCosmic(true);
                setImportError(null);
                setImportSummary(null);
                void importCosmicSigners()
                  .then(async (result) => {
                    setImportSummary(
                      `Cosmic Values import ${result.source_complete === false ? 'incomplete' : 'complete'} · ${Number(result.unique_signers ?? 0)} distinct Roblox accounts${result.expected_signers != null ? ` / ${Number(result.expected_signers)} published` : ''} from ${Number(result.source_rows ?? 0)} source rows · ${Number(result.added ?? 0)} added · ${Number(result.updated ?? 0)} updated · ${Number(result.skipped ?? 0)} skipped. Same display names remain separate when the Roblox accounts differ.`
                    );
                    await onRefresh();
                  })
                  .catch((err) => setImportError(err instanceof Error ? err.message : 'Signer import failed.'))
                  .finally(() => setImportingCosmic(false));
              }}
            >
              {importingCosmic ? 'Importing…' : 'Import Cosmic Values'}
            </button>
            <button className="vault-btn vault-btn-gold vault-btn-sm" onClick={() => setEditor('new')}>
              <Plus size={13} /> Add signer
            </button>
          </div>
        )}
      </div>

      {importSummary && <div className="vault-success" style={{ marginBottom: 12 }}>{importSummary}</div>}
      {importError && <div className="vault-error" style={{ marginBottom: 12 }}>{importError}</div>}
      <div className="vault-card" style={{ marginBottom: 16 }}>
        <div className="vault-row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text4)' }} />
            <input
              className="vault-input" style={{ paddingLeft: 30 }}
              placeholder="Search name, @username, display name…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select className="vault-select" style={{ maxWidth: 190 }} value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {roleOptions.map((role) => (
              <option key={role} value={role}>{signerRoleLabels[role]}</option>
            ))}
          </select>
          <select className="vault-select" style={{ maxWidth: 180 }} value={ownership} onChange={(event) => setOwnership(event.target.value as 'all' | 'owned' | 'missing')}>
            <option value="all">All signers</option>
            <option value="owned">I have signatures ({ownedSignerCount})</option>
            <option value="missing">I don't have signatures ({missingSignerCount})</option>
          </select>
          <select className="vault-select" style={{ maxWidth: 180 }} value={verification} onChange={(event) => setVerification(event.target.value)}>
            <option value="all">Any verification</option>
            {Object.entries(verificationLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <select className="vault-select" style={{ maxWidth: 150 }} value={sort} onChange={(event) => setSort(event.target.value as 'name' | 'signatures')}>
            <option value="name">Sort: A–Z</option>
            <option value="signatures">Sort: records</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="vault-empty">
          <div className="vault-empty-title">No signers match</div>
          <div>Adjust the search or filters.</div>
        </div>
      ) : (
        <div className="vault-signer-grid">
          {filtered.map((signer) => (
            <button
              key={signer.id}
              className="vault-signer-card"
              style={{ border: 'none' }}
              onClick={() => onOpenSigner(signer.id)}
            >
              <div className="vault-signer-card-top">
            <div className="vault-signer-card-identity">
              <div className="vault-signer-avatar">
                {signer.avatar_url ? <img src={signer.avatar_url} alt={signer.signer_name} loading="lazy" /> : signer.signer_name.slice(0, 2).toUpperCase()}
              </div>
              <div className="vault-signer-card-names">
                <div className={`vault-signer-name${ownedSignerIds.has(signer.id) ? ' vault-signer-name-rainbow' : ''}`}>{signer.display_name || signer.signer_name}</div>
                <div className="vault-note">@{signer.roblox_username || signer.signer_name}{signer.roblox_user_id ? ` · ${signer.roblox_user_id}` : ''}</div>
              </div>
            </div>
            <div className="vault-signer-card-status">
              <span className={`vault-ownership-badge ${ownedSignerIds.has(signer.id) ? 'is-owned' : 'is-missing'}`}>
                <span className="vault-ownership-dot" />{ownedSignerIds.has(signer.id) ? 'OWNED' : 'MISSING'}
              </span>
              <span className={`vault-verification-badge ${verificationTone[signer.verification_status ?? 'unverified']}`}>{verificationLabels[signer.verification_status ?? 'unverified']}</span>
            </div>
          </div>
          <div className="vault-signer-metrics">
            <div><small>EXCLUSIVE</small><strong>{signer.cosmic_exclusive_value != null ? formatValue(signer.cosmic_exclusive_value, '') : '—'}</strong></div>
            <div><small>HUGE</small><strong>{signer.cosmic_huge_value != null ? formatValue(signer.cosmic_huge_value, '') : '—'}</strong></div>
            <div><small>TITANIC</small><strong>{signer.cosmic_titanic_value != null ? formatValue(signer.cosmic_titanic_value, '') : '—'}</strong></div>
            <div><small>DEMAND</small><strong>{signer.cosmic_demand != null ? `${signer.cosmic_demand}/10` : '—'}</strong></div>
          </div>
          <div className="vault-signer-card-footer">
            <span>{signer.signature_count} signatures</span>
            <span>{(signer.roles ?? []).slice(0, 2).map((role) => signerRoleLabels[role]).join(' · ') || 'Community signer'}</span>
          </div>
            </button>
          ))}
        </div>
      )}

      {editor && (
        <SignerEditor
          data={data}
          signer={editor === 'new' ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={onRefresh}
        />
      )}
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

  if (!signer) {
    return (
      <div className="vault-empty">
        <div className="vault-empty-title">Signer not found</div>
        <button className="vault-btn vault-btn-sm" style={{ marginTop: 10 }} onClick={onBack}>
          <ArrowLeft size={13} /> Back to the gallery
        </button>
      </div>
    );
  }

  const signatures = data.signatures.filter((record) => record.signer_id === signer.id);
  const ownerPets = data.is_owner ? (data.other_pets ?? []).filter((pet) => pet.signer_id === signer.id) : [];
  const myPets = data.pets.filter((pet) => pet.signer_id === signer.id);
  const totalValue = signatures.reduce((sum, record) => sum + (record.verification_status === 'verified' || record.verification_status === 'community_verified' ? Number(record.signature_value ?? 0) : 0), 0);

  return (
    <div>
      <div className="vault-section-head">
        <button className="vault-btn vault-btn-sm" onClick={onBack}><ArrowLeft size={13} /> Gallery</button>
        {data.is_owner && (
          <button className="vault-btn vault-btn-sm" onClick={() => setEditOpen(true)}>
            <Pencil size={13} /> Edit profile
          </button>
        )}
      </div>

      <div className="vault-card" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="vault-signer-avatar" style={{ width: 64, height: 64, borderRadius: 16 }}>
          {signer.avatar_url
            ? <img src={signer.avatar_url} alt={signer.signer_name} />
            : signer.signer_name.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{signer.display_name || signer.signer_name}</h2>
          <div className="vault-note" style={{ marginTop: 2 }}>
            {signer.roblox_username ? `@${signer.roblox_username}` : 'No Roblox account on record'}
            {signer.roblox_user_id ? ` · ID ${signer.roblox_user_id}` : ''}
          </div>
          <div className="vault-row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {(signer.roles ?? []).map((role) => (
              <span key={role} className="vault-pill vault-pill-gold">{signerRoleLabels[role]}</span>
            ))}
            <span className={`vault-pill ${verificationTone[signer.verification_status ?? 'unverified']}`}>
              {verificationLabels[signer.verification_status ?? 'unverified']}
            </span>
          </div>
          <div className="vault-row" style={{ gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
            {signer.profile_url && (
              <a className="vault-note" href={signer.profile_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                Roblox profile <ExternalLink size={11} />
              </a>
            )}
            {signer.youtube_channel_url && (
              <a className="vault-note" href={signer.youtube_channel_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', color: 'var(--red)' }}>
                <Youtube size={12} /> {signer.youtube_channel_name || 'YouTube'}
                {signer.youtube_subscribers ? ` · ${signer.youtube_subscribers.toLocaleString('en-US')} subs` : ''}
              </a>
            )}
          </div>
          {signer.notes && <p className="vault-note" style={{ marginTop: 10 }}>{signer.notes}</p>}
        </div>
      </div>

      <div className="vault-signer-metric-grid" style={{ marginTop: 18 }}>
        <div className="vault-signer-metric-feature"><span>VERIFIED SIGNATURE VALUE</span><strong>{totalValue > 0 ? formatValue(totalValue) : '—'}</strong></div>
        <div className="vault-signer-metric"><span>COSMIC EXCLUSIVE</span><strong>{signer.cosmic_exclusive_value != null ? formatValue(signer.cosmic_exclusive_value, '') : '—'}</strong></div>
        <div className="vault-signer-metric"><span>COSMIC HUGE</span><strong>{signer.cosmic_huge_value != null ? formatValue(signer.cosmic_huge_value, '') : '—'}</strong></div>
        <div className="vault-signer-metric"><span>COSMIC TITANIC</span><strong>{signer.cosmic_titanic_value != null ? formatValue(signer.cosmic_titanic_value, '') : '—'}</strong></div>
        <div className="vault-signer-metric"><span>COSMIC DEMAND</span><strong>{signer.cosmic_demand != null ? `${signer.cosmic_demand}/10` : '—'}</strong></div>
        <div className="vault-signer-metric"><span>IN YOUR COLLECTION</span><strong>{myPets.length}</strong></div>
        {data.is_owner && <div className="vault-signer-metric"><span>IN COLLECTOR 2 VAULT</span><strong>{ownerPets.length}</strong></div>}
      </div>

      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Signature records</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>Known signatures</h3>
        </div>
      </div>
      <div className="vault-table-wrap">
        <table className="vault-table">
          <thead>
            <tr><th>Pet</th><th>Variant</th><th>Signature</th><th>Signature value</th></tr>
          </thead>
          <tbody>
            {signatures.map((record) => {
              const pet = data.catalog.find((entry) => entry.id === record.pet_id);
              return (
                <tr key={record.id}>
                  <td style={{ fontWeight: 600, color: 'var(--text)' }}>{pet?.pet_name ?? 'Unknown pet'}</td>
                  <td>{variantLabel[record.variant]}</td>
                  <td><span className="vault-signature-name-rainbow">{record.signature_name || signer.display_name || signer.signer_name}</span></td>
                  <td className="vault-num" style={{ color: 'var(--gold)', fontWeight: 700 }}>
                    {record.signature_value != null ? formatValue(record.signature_value) : '—'}
                  </td>

                </tr>
              );
            })}
            {signatures.length === 0 && (
              <tr><td colSpan={4} style={{ color: 'var(--text4)' }}>No signature records for this signer yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data.is_owner && editOpen && (
        <SignerEditor data={data} signer={signer} onClose={() => setEditOpen(false)} onSaved={async () => { setEditOpen(false); }} />
      )}
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
        p_roles: JSON.stringify(roles),
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
