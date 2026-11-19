import { useMemo, useState } from 'react';
import {
  ArrowLeft, BadgeCheck, Check, ExternalLink, Merge, Pencil, Plus, Search, ShieldAlert, Trash2, X, Youtube,
} from 'lucide-react';
import {
  VaultApiError, formatDate, formatValue, readStoredToken, rpcCall,
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
  const [minSignatures, setMinSignatures] = useState(0);
  const [sort, setSort] = useState<'name' | 'signatures'>('name');
  const [editor, setEditor] = useState<'new' | Signer | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.signers
      .filter((signer) => {
        if (q && !(signer.signer_name.toLowerCase().includes(q)
          || (signer.roblox_username ?? '').toLowerCase().includes(q)
          || (signer.display_name ?? '').toLowerCase().includes(q))) return false;
        if (category !== 'all' && !(signer.roles ?? []).includes(category as SignerRole)) return false;
        if (verification !== 'all' && signer.verification_status !== verification) return false;
        if (signer.signature_count < minSignatures) return false;
        return true;
      })
      .sort((a, b) => sort === 'name'
        ? a.signer_name.localeCompare(b.signer_name)
        : b.signature_count - a.signature_count);
  }, [data.signers, query, category, verification, minSignatures, sort]);

  return (
    <div>
      <div className="vault-section-head">
        <div>
          <span className="vault-kicker">Shared registry</span>
          <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>{data.signers.length} known signers</h3>
        </div>
        {isOwner && (
          <button className="vault-btn vault-btn-gold vault-btn-sm" onClick={() => setEditor('new')}>
            <Plus size={13} /> Add signer
          </button>
        )}
      </div>

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
          <select className="vault-select" style={{ maxWidth: 180 }} value={verification} onChange={(event) => setVerification(event.target.value)}>
            <option value="all">Any verification</option>
            {Object.entries(verificationLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <select className="vault-select" style={{ maxWidth: 150 }} value={minSignatures} onChange={(event) => setMinSignatures(Number(event.target.value))}>
            <option value={0}>Any records</option>
            <option value={1}>1+ records</option>
            <option value={3}>3+ records</option>
            <option value={5}>5+ records</option>
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
            <button key={signer.id} className="vault-signer-card" style={{ border: 'none' }} onClick={() => onOpenSigner(signer.id)}>
              <div className="vault-signer-avatar">
                {signer.avatar_url
                  ? <img src={signer.avatar_url} alt={signer.signer_name} loading="lazy" />
                  : signer.signer_name.slice(0, 2).toUpperCase()}
              </div>
              <div className="vault-signer-name">{signer.display_name || signer.signer_name}</div>
              {signer.roblox_username && signer.roblox_username !== signer.signer_name && (
                <div className="vault-note" style={{ marginTop: 2 }}>@{signer.roblox_username}</div>
              )}
              <div className="vault-row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
                {(signer.roles ?? []).slice(0, 3).map((role) => (
                  <span key={role} className="vault-pill vault-pill-gray">{signerRoleLabels[role]}</span>
                ))}
              </div>
              <div className="vault-note" style={{ marginTop: 6 }}>{signer.signature_count} signatures</div>
              <span className={`vault-pill ${verificationTone[signer.verification_status ?? 'unverified']}`} style={{ marginTop: 6 }}>
                {signer.verification_status === 'verified' && <BadgeCheck size={11} />}
                {verificationLabels[signer.verification_status ?? 'unverified']}
              </span>
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
  const ownerPets = data.is_owner
    ? [...(data.other_pets ?? []), ...[]].filter((pet) => pet.signer_id === signer.id)
    : [];
  const myPets = data.pets.filter((pet) => pet.signer_id === signer.id);
  const totalValue = signatures.reduce((sum, record) => sum + Number(record.signature_value ?? 0), 0);

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

      <div className="vault-stat-grid" style={{ marginTop: 16 }}>
        <StatCard label="Known signatures" value={String(signatures.length)} />
        <StatCard label="Total signature value" value={totalValue > 0 ? formatValue(totalValue) : '—'} gold />
        <StatCard label="In your collection" value={String(myPets.length)} />
        {data.is_owner && <StatCard label="In collector 2 vault" value={String(ownerPets.length)} />}
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
            <tr><th>Pet</th><th>Variant</th><th>Signature</th><th>Value</th><th>Status</th><th>Source</th></tr>
          </thead>
          <tbody>
            {signatures.map((record) => {
              const pet = data.catalog.find((entry) => entry.id === record.pet_id);
              return (
                <tr key={record.id}>
                  <td style={{ fontWeight: 600, color: 'var(--text)' }}>{pet?.pet_name ?? 'Unknown pet'}</td>
                  <td>{variantLabel[record.variant]}</td>
                  <td>{record.signature_name ?? '—'}</td>
                  <td className="vault-num" style={{ color: 'var(--gold)', fontWeight: 700 }}>
                    {record.signature_value != null ? formatValue(record.signature_value) : '—'}
                  </td>
                  <td>
                    <span className={`vault-pill ${verificationTone[record.verification_status ?? 'unverified']}`}>
                      {verificationLabels[record.verification_status ?? 'unverified']}
                    </span>
                  </td>
                  <td><span className="vault-pill vault-pill-gray">{record.source ?? 'manual'}</span></td>
                </tr>
              );
            })}
            {signatures.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--text4)' }}>No signature records for this signer yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="vault-note" style={{ marginTop: 10, fontSize: 11.5 }}>
        Signature values come from manual imports (Cosmic Values has no official API). Unverified records are not confirmed valuations.
      </p>

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
  const [mergeInto, setMergeInto] = useState('');
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

  const merge = async () => {
    if (!signer || !mergeInto) return;
    if (!window.confirm(`Merge ${signer.signer_name} into the selected signer? All records move over and the duplicate is removed.`)) return;
    setBusy(true);
    setError(null);
    try {
      await rpcCall('vault_signer_manage_v2', readStoredToken() ?? '', {
        p_action: 'merge',
        p_signer_id: signer.id,
        p_merge_target_id: mergeInto,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof VaultApiError ? err.message : 'Could not merge.');
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
          <div className="vault-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <select className="vault-select" style={{ maxWidth: 240 }} value={mergeInto} onChange={(event) => setMergeInto(event.target.value)}>
              <option value="">Merge into…</option>
              {data.signers.filter((entry) => entry.id !== signer?.id).map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.signer_name}</option>
              ))}
            </select>
            <button className="vault-btn vault-btn-sm" disabled={busy || !mergeInto} onClick={() => void merge()}>
              <Merge size={12} /> Merge
            </button>
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
