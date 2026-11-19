import { useState } from 'react';
import { CheckCircle2, ExternalLink, Link2, Loader2, Unplug, UserRound } from 'lucide-react';
import { readStoredToken, rpcCall, vaultCall, formatDate, type RobloxAccount } from './vaultApi';

type LookupResult = {
  roblox_user_id: number;
  roblox_username: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_url: string;
};

export function RobloxConnectionCard({ account, isAdmin }: { account: RobloxAccount; isAdmin: boolean }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const connected = account.connection_status === 'connected' && (account.roblox_username || account.roblox_user_id);

  const connect = async () => {
    const name = username.trim();
    if (name.length < 3) { setMessage({ ok: false, text: 'Enter a Roblox username (3+ characters).' }); return; }
    setBusy(true);
    setMessage(null);
    try {
      // resolve the username through the server proxy (official Roblox endpoints)
      const lookup = await vaultCall('roblox-lookup', { username: name }) as unknown as LookupResult;
      await rpcCall(isAdmin ? 'vault_roblox_admin' : 'vault_roblox_manage', readStoredToken() ?? '', {
        p_action: 'set',
        ...(isAdmin ? { p_collector_no: account.collector_no } : {}),
        p_roblox_username: lookup.roblox_username,
        p_roblox_user_id: lookup.roblox_user_id,
        p_display_name: lookup.display_name,
        p_avatar_url: lookup.avatar_url,
        p_profile_url: lookup.profile_url,
      });
      setUsername('');
      setMessage({ ok: true, text: `Connected to ${lookup.display_name ?? lookup.roblox_username}.` });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message ?? 'Could not connect the account.' });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect this Roblox account? The inventory connection is removed with it.')) return;
    setBusy(true);
    setMessage(null);
    try {
      await rpcCall(isAdmin ? 'vault_roblox_admin' : 'vault_roblox_manage', readStoredToken() ?? '', {
        p_action: 'disconnect',
        ...(isAdmin ? { p_collector_no: account.collector_no } : {}),
      });
      setMessage({ ok: true, text: 'Roblox account disconnected.' });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message ?? 'Could not disconnect.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vault-card">
      <div className="vault-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="vault-row" style={{ gap: 12, alignItems: 'center' }}>
          <div className="vault-roblox-avatar">
            {account.avatar_url
              ? <img src={account.avatar_url} alt={account.roblox_username ?? 'Roblox avatar'} />
              : <UserRound size={22} />}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {account.display_name || account.roblox_username || 'No Roblox account connected'}
            </div>
            <div className="vault-note" style={{ marginTop: 2 }}>
              {connected
                ? `@${account.roblox_username ?? '?'}${account.roblox_user_id ? ` · ID ${account.roblox_user_id}` : ''}`
                : 'Connect a Roblox account to enable inventory sync.'}
            </div>
          </div>
        </div>
        {connected
          ? <span className="vault-pill vault-pill-green"><CheckCircle2 size={11} /> Connected</span>
          : <span className="vault-pill vault-pill-gray">Not connected</span>}
      </div>

      {connected && (
        <div className="vault-row" style={{ gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          {account.profile_url && (
            <a className="vault-note" href={account.profile_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Profile <ExternalLink size={11} />
            </a>
          )}
          <span className="vault-note">Connected {formatDate(account.connected_at)}</span>
          <span className="vault-note">Last sync {formatDate(account.last_synced_at)}</span>
        </div>
      )}

      {!connected && (
        <div className="vault-row" style={{ marginTop: 12 }}>
          <input
            className="vault-input"
            placeholder="Roblox username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            style={{ maxWidth: 240 }}
          />
          <button
            className="vault-btn vault-btn-gold vault-btn-sm"
            disabled={busy || username.trim().length < 3}
            onClick={() => void connect()}
          >
            {busy ? <Loader2 size={13} className="vault-spin" /> : <Link2 size={13} />} Connect
          </button>
        </div>
      )}

      {connected && (
        <div className="vault-row" style={{ marginTop: 12 }}>
          <button className="vault-btn vault-btn-sm" disabled={busy} onClick={() => void disconnect()}>
            <Unplug size={13} /> Disconnect
          </button>
        </div>
      )}

      {message && (
        <div className={message.ok ? 'vault-success' : 'vault-error'} style={{ marginTop: 10 }}>{message.text}</div>
      )}
    </div>
  );
}
