import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Unplug, XCircle } from 'lucide-react';
import { readStoredToken, rpcCall, vaultCall } from './vaultApi';

type SyncStatus = {
  connected: boolean;
  expires_at: string | null;
  roblox_user_id: number | null;
  scope: string | null;
};

type SyncResult = {
  scanned_items: number;
  signed_found: number;
  added: number;
  updated: number;
  removed: number;
};

export function BigGamesConnect({ onSynced }: { onSynced: () => Promise<void> }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await rpcCall('vault_oauth_status', readStoredToken() ?? '', {});
      const row = Array.isArray(result.result) ? result.result[0] : result.result;
      if (row) {
        setStatus({
          connected: Boolean(row.out_connected),
          expires_at: (row.out_expires_at as string) ?? null,
          roblox_user_id: (row.out_roblox_user_id as number) ?? null,
          scope: (row.out_scope as string) ?? null,
        });
      }
    } catch {
      setError('Could not load connection status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await vaultCall('biggames-oauth-start', {});
      const url = String(result.authorize_url ?? '');
      if (url) window.location.href = url;
      else setError('OAuth is not configured yet.');
    } catch (err) {
      setError(String((err as Error).message ?? 'Could not start the connection.'));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await rpcCall('vault_oauth_disconnect', readStoredToken() ?? '', {});
      setSyncResult(null);
      await load();
    } catch (err) {
      setError(String((err as Error).message ?? 'Could not disconnect.'));
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setError(null);
    setSyncResult(null);
    try {
      const result = await vaultCall('biggames-sync', {});
      if (result.status === 'ok') {
        setSyncResult(result as unknown as SyncResult);
        await onSynced();
      } else {
        setError('Sync failed. Try again.');
      }
    } catch (err) {
      const message = (err as Error).message ?? 'Sync failed.';
      setError(
        message.includes('not_connected') ? 'Connect your BIG Games account first.'
        : message.includes('expired') ? 'Your BIG Games connection expired. Reconnect it.'
        : message.includes('rate_limited') ? 'Rate limited by BIG Games. Try again in a minute.'
        : 'Sync failed. Try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="vault-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Loader2 size={14} className="vault-spin" /> Loading connection…</div>;
  }

  return (
    <div className="vault-card">
      <div className="vault-row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>BIG Games inventory sync</div>
          <div className="vault-note" style={{ marginTop: 4 }}>
            Connect your Roblox account via BIG Games. The scanner reads only signed pets from your inventory.
          </div>
        </div>
        {status?.connected
          ? <span className="vault-pill vault-pill-green"><CheckCircle2 size={11} /> Connected</span>
          : <span className="vault-pill vault-pill-gray">Not connected</span>}
      </div>

      {status?.connected && (
        <div className="vault-note" style={{ marginTop: 10 }}>
          {status.roblox_user_id ? `Roblox account: ${status.roblox_user_id} · ` : ''}
          Token {status.expires_at ? `valid until ${new Date(status.expires_at).toLocaleDateString()}` : 'active'}
          {status.scope ? ` · scope: ${status.scope}` : ''}
        </div>
      )}

      <div className="vault-row" style={{ marginTop: 14 }}>
        {status?.connected ? (
          <>
            <button className="vault-btn vault-btn-gold vault-btn-sm" disabled={busy} onClick={() => void sync()}>
              <RefreshCw size={13} /> {busy ? 'Scanning…' : 'Scan inventory now'}
            </button>
            <button className="vault-btn vault-btn-sm" disabled={busy} onClick={() => void disconnect()}>
              <Unplug size={13} /> Disconnect
            </button>
          </>
        ) : (
          <button className="vault-btn vault-btn-gold" disabled={busy} onClick={() => void connect()}>
            Connect BIG Games account
          </button>
        )}
      </div>

      {syncResult && (
        <div className="vault-success" style={{ marginTop: 12 }}>
          Scan complete: {syncResult.signed_found} signed pets found · {syncResult.added} added · {syncResult.removed} removed.
        </div>
      )}
      {error && <div className="vault-error" style={{ marginTop: 12 }}>{error}</div>}
      <p className="vault-note" style={{ marginTop: 12, fontSize: 11.5 }}>
        Access tokens live 30 days without refresh per BIG Games policy. Reconnect when the connection expires.
      </p>
    </div>
  );
}

export function OAuthCallback() {
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauthState = params.get('state');
    const error = params.get('error');

    const run = async () => {
      if (error) {
        setState('error');
        setDetail('Authorization was declined or failed on the BIG Games side.');
        return;
      }
      if (!code || !oauthState) {
        setState('error');
        setDetail('The callback URL is incomplete.');
        return;
      }
      try {
        const result = await vaultCall('biggames-oauth-callback', { code, state: oauthState });
        if (result.status === 'ok') {
          setState('ok');
          window.setTimeout(() => { window.location.href = '/signed-vault'; }, 1200);
        } else {
          setState('error');
          setDetail('The token exchange failed.');
        }
      } catch (err) {
        setState('error');
        setDetail(String((err as Error).message ?? 'Token exchange failed.'));
      }
    };
    void run();
  }, []);

  return (
    <div className="vault-lock-wrap">
      <div className="vault-lock-card">
        {state === 'working' && (
          <>
            <Loader2 size={30} style={{ margin: '0 auto 14px', color: 'var(--gold)' }} className="vault-spin" />
            <h1 className="vault-lock-title">Connecting…</h1>
            <p className="vault-lock-sub">Exchanging your BIG Games authorization. One moment.</p>
          </>
        )}
        {state === 'ok' && (
          <>
            <CheckCircle2 size={34} style={{ margin: '0 auto 14px', color: 'var(--green)' }} />
            <h1 className="vault-lock-title">Connected</h1>
            <p className="vault-lock-sub">Returning to the vault…</p>
          </>
        )}
        {state === 'error' && (
          <>
            <XCircle size={34} style={{ margin: '0 auto 14px', color: 'var(--red)' }} />
            <h1 className="vault-lock-title">Connection failed</h1>
            <p className="vault-lock-sub">{detail}</p>
            <a className="vault-btn" href="/signed-vault" style={{ marginTop: 16 }}>Back to the vault</a>
          </>
        )}
      </div>
    </div>
  );
}
