import { useEffect, useState } from 'react';
import { Bot, Check, CircleAlert, HeartPulse, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type DiscordConfigPrivate = {
  invite_url: string | null;
  guild_id: string | null;
  server_name: string | null;
  server_icon_url: string | null;
  recruitment_category_id: string | null;
  bot_endpoint: string | null;
  has_bot_api_key: boolean;
  notify_channel_ids: Record<string, string> | null;
  bot_health_status: string | null;
  bot_last_health_check_at: string | null;
  bot_health_detail: string | null;
};

type ChannelRow = { id: string; channel_id: string | null; display_name: string; category: string; description: string | null; display_order: number; is_public: boolean; channel_url: string | null };
type RuleRow = { id: string; title: string; description: string; category: string; display_order: number; is_enabled: boolean; is_placeholder: boolean };
type AnnouncementRow = { id: string; title: string; body: string; author_label: string | null; pinned: boolean; is_enabled: boolean };

type DeliveryApp = {
  id: string;
  reference_code: string | null;
  roblox_username: string;
  status: string;
  created_at: string;
  discord_delivery_status: string;
  discord_delivery_error: string | null;
  discord_delivery_attempts: number;
};

type IntegrationHealth = {
  last_ticket_created_at: string | null;
  last_ticket_reference: string | null;
  recent_errors: { event_type: string; detail: string | null; created_at: string; reference_code: string | null; roblox_username: string | null }[] | null;
};

export function DiscordAdmin({ passkey }: { passkey: string }) {
  const [cfg, setCfg] = useState<DiscordConfigPrivate | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [failedApps, setFailedApps] = useState<DeliveryApp[]>([]);
  const [pendingApps, setPendingApps] = useState<DeliveryApp[]>([]);
  const [integration, setIntegration] = useState<IntegrationHealth | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // editable config form state
  const [inviteUrl, setInviteUrl] = useState('');
  const [guildId, setGuildId] = useState('');
  const [serverName, setServerName] = useState('');
  const [serverIcon, setServerIcon] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [botEndpoint, setBotEndpoint] = useState('');
  const [botApiKey, setBotApiKey] = useState('');
  const [notifyJson, setNotifyJson] = useState('');
  const [cfgLoaded, setCfgLoaded] = useState(false);

  // new-entry form state
  const [newChannel, setNewChannel] = useState({ channel_id: '', display_name: '', category: 'general', description: '', is_public: true, channel_url: '' });
  const [newRule, setNewRule] = useState({ title: '', description: '', category: 'conduct' });
  const [newAnnouncement, setNewAnnouncement] = useState({ title: '', body: '', author_label: '', pinned: false });

  const run = async (label: string, fn: () => PromiseLike<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fn() as { error?: { message?: string } | null } | null;
      if (res?.error) throw new Error(res.error.message);
      setMessage({ ok: true, text: `${label} — done.` });
      await loadAll();
    } catch (e) {
      setMessage({ ok: false, text: `${label} failed — ${e instanceof Error ? e.message : 'unknown error'}` });
    } finally {
      setBusy(false);
    }
  };

  const rpc = (fnName: string, args: Record<string, unknown>) => supabase.rpc(fnName, { p_passkey: passkey, ...args });

  const loadAll = async () => {
    const [cfgRes, chanRes, ruleRes, annRes, appRes, healthRes] = await Promise.all([
      rpc('staff_discord_config_read', {}),
      supabase.rpc('staff_discord_channel_list', { p_passkey: passkey }),
      supabase.rpc('staff_discord_rule_list', { p_passkey: passkey }),
      supabase.rpc('staff_discord_announcement_list', { p_passkey: passkey }),
      supabase.rpc('staff_discord_delivery_overview', { p_passkey: passkey }),
      supabase.rpc('staff_discord_integration_health', { p_passkey: passkey }),
    ]);
    const cfgData = cfgRes.data as DiscordConfigPrivate | null;
    setCfg(cfgData);
    if (cfgData && !cfgLoaded) {
      setInviteUrl(cfgData.invite_url ?? '');
      setGuildId(cfgData.guild_id ?? '');
      setServerName(cfgData.server_name ?? '');
      setServerIcon(cfgData.server_icon_url ?? '');
      setCategoryId(cfgData.recruitment_category_id ?? '');
      setBotEndpoint(cfgData.bot_endpoint ?? '');
      setNotifyJson(cfgData.notify_channel_ids ? JSON.stringify(cfgData.notify_channel_ids, null, 2) : '{}');
      setCfgLoaded(true);
    }
    setChannels((chanRes.data ?? []) as unknown as ChannelRow[]);
    setRules((ruleRes.data ?? []) as unknown as RuleRow[]);
    setAnnouncements((annRes.data ?? []) as unknown as AnnouncementRow[]);
    const apps = ((appRes.data ?? []) as unknown as { failed: DeliveryApp[]; pending: DeliveryApp[] }) ?? { failed: [], pending: [] };
    setFailedApps(apps.failed ?? []);
    setPendingApps(apps.pending ?? []);
    setIntegration((healthRes.data ?? null) as unknown as IntegrationHealth | null);
  };

  const loadIntegrationHealth = async () => {
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nanz-discord-bridge`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'integration_health', passkey }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && typeof data === 'object' && !('error' in (data as object))) setIntegration(data as unknown as IntegrationHealth);
      else setIntegration(null);
    } catch {
      setIntegration(null);
    }
  };

  useEffect(() => { void loadAll(); void loadIntegrationHealth(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const saveConfig = () => {
    let notify: Record<string, string> | null = null;
    try {
      notify = JSON.parse(notifyJson) as Record<string, string>;
      if (typeof notify !== 'object' || notify === null || Array.isArray(notify)) throw new Error('not an object');
    } catch {
      setMessage({ ok: false, text: 'Notification channels must be valid JSON like {"recruitment": "1234567890"}' });
      return;
    }
    void run('Save Discord configuration', () => rpc('staff_discord_config_write', {
      p_invite_url: inviteUrl,
      p_guild_id: guildId,
      p_server_name: serverName,
      p_server_icon_url: serverIcon,
      p_recruitment_category_id: categoryId,
      p_bot_endpoint: botEndpoint,
      p_bot_api_key: botApiKey,
      p_notify_channel_ids: notify,
    }));
  };

  const checkHealth = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nanz-discord-bridge`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'health' }),
      });
      const data = await res.json();
      setMessage(data.connected
        ? { ok: true, text: 'NANZ CORE is reachable and responding.' }
        : { ok: false, text: `Bot not reachable: ${data.reason ?? data.detail ?? 'no response'}` });
      await loadAll();
    } catch {
      setMessage({ ok: false, text: 'Health check request failed.' });
    } finally {
      setBusy(false);
    }
  };

  const retry = (appId: string, label: string) => void run(`Retry delivery ${label}`, () => rpc('staff_discord_retry', { p_application_id: appId }).then(() => new Promise<void>((resolve) => {
    void (async () => {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nanz-discord-bridge`;
      await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'retry', applicationId: appId }),
      }).catch(() => undefined);
      resolve();
    })();
  })));

  return <div className="glass-card da-panel">
    <div className="card-header"><div><span className="card-label">Discord integration</span><h3>NANZ CORE Bridge</h3></div><Bot size={20} /></div>
    {message && <div className={message.ok ? 'sa-status ok' : 'sa-status err'}>{message.text}</div>}

    <div className="da-section">
      <div className="sa-section-head"><HeartPulse size={16} /><b>Integration health</b></div>
      <div className="da-health-row">
        <div className={`da-health-pill ${cfg?.bot_health_status === 'connected' ? 'ok' : cfg?.bot_health_status ? 'err' : 'idle'}`}>
          {cfg?.bot_health_status === 'connected' ? 'CONNECTED' : cfg?.bot_health_status ? 'NOT CONNECTED' : 'NEVER CHECKED'}
        </div>
        <small>{cfg?.bot_last_health_check_at ? `Last check ${new Date(cfg.bot_last_health_check_at).toLocaleString()} · ${cfg.bot_health_detail ?? ''}` : 'Run a health check to verify the bot connection.'}</small>
        <button className="btn-pill" onClick={() => void checkHealth()} disabled={busy}><RefreshCw size={13} /> Run health check</button>
      </div>
      <div className="da-health-stats">
        <span>Failed deliveries: <b>{failedApps.length}</b></span>
        <span>Pending applications: <b>{pendingApps.length}</b></span>
        <span>Bot API key saved: <b>{cfg?.has_bot_api_key ? 'Yes' : 'No'}</b></span>
        <span>Last ticket created: <b>{integration?.last_ticket_created_at ? `${new Date(integration.last_ticket_created_at).toLocaleString()}${integration.last_ticket_reference ? ` (${integration.last_ticket_reference})` : ''}` : 'Never'}</b></span>
      </div>
      {integration?.recent_errors && integration.recent_errors.length > 0 && <div className="da-error-list">
        {integration.recent_errors.map((err, index) => <div key={index} className="da-error-row">
          <b>{err.reference_code ?? err.roblox_username ?? 'Unknown application'} · {new Date(err.created_at).toLocaleString()}</b>
          <small>{err.detail ?? 'No detail recorded'}</small>
        </div>)}
      </div>}
    </div>

    <div className="da-section">
      <div className="sa-section-head"><Bot size={16} /><b>Connection & invite</b><small>Secrets are stored server-side and never displayed</small></div>
      <div className="sa-form-row">
        <input value={inviteUrl} onChange={(e) => setInviteUrl(e.target.value)} placeholder="Discord invite URL (https://discord.gg/...)" />
        <input value={guildId} onChange={(e) => setGuildId(e.target.value)} inputMode="numeric" placeholder="Guild (server) ID" />
      </div>
      <div className="sa-form-row">
        <input value={serverName} onChange={(e) => setServerName(e.target.value)} placeholder="Server display name" />
        <input value={serverIcon} onChange={(e) => setServerIcon(e.target.value)} placeholder="Server icon URL (optional)" />
      </div>
      <div className="sa-form-row">
        <input value={categoryId} onChange={(e) => setCategoryId(e.target.value)} inputMode="numeric" placeholder="Recruitment category ID" />
        <input value={botEndpoint} onChange={(e) => setBotEndpoint(e.target.value)} placeholder="NANZ CORE endpoint (https://...)" />
        <input value={botApiKey} onChange={(e) => setBotApiKey(e.target.value)} type="password" placeholder={cfg?.has_bot_api_key ? 'API key saved — enter to replace' : 'Bot API key'} />
      </div>
      <div className="sa-form-row">
        <textarea className="da-textarea" value={notifyJson} onChange={(e) => setNotifyJson(e.target.value)} rows={3} placeholder='{"recruitment": "channel-id", "battle_updates": "channel-id"}' />
        <button className="btn-pill active" onClick={saveConfig} disabled={busy}><Save size={13} /> Save config</button>
      </div>
    </div>

    <div className="da-section">
      <div className="sa-section-head"><RefreshCw size={16} /><b>Delivery queue</b><small>Failed applications can be retried — no duplicates are created</small></div>
      {[...failedApps, ...pendingApps].length === 0
        ? <p className="da-empty">No failed or pending deliveries. Every application reached NANZ CORE.</p>
        : [...failedApps, ...pendingApps].map((app) => <div key={app.id} className="sa-managed-row">
            <span><b>{app.reference_code ?? app.roblox_username}</b><small>{app.discord_delivery_status}{app.discord_delivery_error ? ` · ${app.discord_delivery_error}` : ''} · {app.discord_delivery_attempts} attempt(s)</small></span>
            <button className="btn-pill" onClick={() => retry(app.id, app.reference_code ?? app.roblox_username)} disabled={busy}><RefreshCw size={13} /> Retry</button>
          </div>)}
    </div>

    <div className="da-section">
      <div className="sa-section-head"><Plus size={16} /><b>Public channels</b><small>Only entries marked public appear on the community page</small></div>
      <div className="sa-form-row">
        <input value={newChannel.channel_id} onChange={(e) => setNewChannel({ ...newChannel, channel_id: e.target.value })} inputMode="numeric" placeholder="Channel ID (real snowflake)" />
        <input value={newChannel.display_name} onChange={(e) => setNewChannel({ ...newChannel, display_name: e.target.value })} placeholder="Display name" />
        <select value={newChannel.category} onChange={(e) => setNewChannel({ ...newChannel, category: e.target.value })}>
          <option value="general">General</option><option value="competitive">Competitive</option><option value="support">Support</option><option value="community">Community</option>
        </select>
      </div>
      <div className="sa-form-row">
        <input value={newChannel.description} onChange={(e) => setNewChannel({ ...newChannel, description: e.target.value })} placeholder="Description (optional)" />
        <input value={newChannel.channel_url} onChange={(e) => setNewChannel({ ...newChannel, channel_url: e.target.value })} placeholder="Channel URL (optional)" />
        <label className="da-check"><input type="checkbox" checked={newChannel.is_public} onChange={(e) => setNewChannel({ ...newChannel, is_public: e.target.checked })} /> Public</label>
        <button className="btn-pill active" disabled={busy || !newChannel.display_name} onClick={() => void run('Add channel', () => rpc('staff_discord_channel_manage', {
          p_action: 'add',
          p_channel_id: newChannel.channel_id || null,
          p_display_name: newChannel.display_name,
          p_category: newChannel.category,
          p_description: newChannel.description || null,
          p_is_public: newChannel.is_public,
          p_channel_url: newChannel.channel_url || null,
        })).then(() => setNewChannel({ channel_id: '', display_name: '', category: 'general', description: '', is_public: true, channel_url: '' }))}><Check size={13} /> Add</button>
      </div>
      {channels.map((ch) => <div key={ch.id} className="sa-managed-row">
        <span><b>{ch.display_name}</b><small>{ch.category} · {ch.is_public ? 'Public' : 'Private'}{ch.channel_id ? ` · ID ${ch.channel_id}` : ' · no ID yet'}</small></span>
        <div className="sa-row-actions">
          <button className="btn-pill" onClick={() => void run(ch.is_public ? `Hide ${ch.display_name}` : `Publish ${ch.display_name}`, () => rpc('staff_discord_channel_manage', { p_action: 'update', p_channel_entry_id: ch.id, p_is_public: !ch.is_public }))}>{ch.is_public ? 'Hide' : 'Publish'}</button>
          <button className="btn-pill danger" onClick={() => void run(`Delete ${ch.display_name}`, () => rpc('staff_discord_channel_manage', { p_action: 'delete', p_channel_entry_id: ch.id }))}><Trash2 size={13} /></button>
        </div>
      </div>)}
    </div>

    <div className="da-section">
      <div className="sa-section-head"><CircleAlert size={16} /><b>Server rules</b><small>Placeholder rules never appear on the public page</small></div>
      <div className="sa-form-row">
        <input value={newRule.title} onChange={(e) => setNewRule({ ...newRule, title: e.target.value })} placeholder="Rule title" />
        <select value={newRule.category} onChange={(e) => setNewRule({ ...newRule, category: e.target.value })}>
          <option value="conduct">Conduct</option><option value="competitive">Competitive</option><option value="recruitment">Recruitment</option><option value="community">Community</option><option value="support">Support</option>
        </select>
      </div>
      <div className="sa-form-row">
        <input value={newRule.description} onChange={(e) => setNewRule({ ...newRule, description: e.target.value })} placeholder="Rule description" />
        <button className="btn-pill active" disabled={busy || !newRule.title || !newRule.description} onClick={() => void run('Add rule', () => rpc('staff_discord_rule_manage', {
          p_action: 'add', p_title: newRule.title, p_description: newRule.description, p_category: newRule.category,
        })).then(() => setNewRule({ title: '', description: '', category: 'conduct' }))}><Check size={13} /> Add</button>
      </div>
      {rules.map((rule) => <div key={rule.id} className="sa-managed-row">
        <span><b>{rule.title}</b><small>{rule.category} · {rule.is_enabled ? 'Enabled' : 'Hidden'}</small></span>
        <div className="sa-row-actions">
          <button className="btn-pill" onClick={() => void run(rule.is_enabled ? `Hide ${rule.title}` : `Enable ${rule.title}`, () => rpc('staff_discord_rule_manage', { p_action: 'toggle', p_rule_id: rule.id, p_is_enabled: !rule.is_enabled }))}>{rule.is_enabled ? 'Hide' : 'Enable'}</button>
          <button className="btn-pill danger" onClick={() => void run(`Delete ${rule.title}`, () => rpc('staff_discord_rule_manage', { p_action: 'delete', p_rule_id: rule.id }))}><Trash2 size={13} /></button>
        </div>
      </div>)}
    </div>

    <div className="da-section">
      <div className="sa-section-head"><Plus size={16} /><b>Announcements</b><small>Shown on the community page</small></div>
      <div className="sa-form-row">
        <input value={newAnnouncement.title} onChange={(e) => setNewAnnouncement({ ...newAnnouncement, title: e.target.value })} placeholder="Title" />
        <input value={newAnnouncement.author_label} onChange={(e) => setNewAnnouncement({ ...newAnnouncement, author_label: e.target.value })} placeholder="Author (optional)" />
        <label className="da-check"><input type="checkbox" checked={newAnnouncement.pinned} onChange={(e) => setNewAnnouncement({ ...newAnnouncement, pinned: e.target.checked })} /> Pin</label>
      </div>
      <div className="sa-form-row">
        <input value={newAnnouncement.body} onChange={(e) => setNewAnnouncement({ ...newAnnouncement, body: e.target.value })} placeholder="Announcement text" />
        <button className="btn-pill active" disabled={busy || !newAnnouncement.title || !newAnnouncement.body} onClick={() => void run('Add announcement', () => rpc('staff_discord_announcement_manage', {
          p_action: 'add', p_title: newAnnouncement.title, p_body: newAnnouncement.body, p_author_label: newAnnouncement.author_label || null, p_pinned: newAnnouncement.pinned,
        })).then(() => setNewAnnouncement({ title: '', body: '', author_label: '', pinned: false }))}><Check size={13} /> Add</button>
      </div>
      {announcements.map((a) => <div key={a.id} className="sa-managed-row">
        <span><b>{a.title}</b><small>{a.pinned ? 'Pinned · ' : ''}{a.is_enabled ? 'Visible' : 'Hidden'}</small></span>
        <div className="sa-row-actions">
          <button className="btn-pill" onClick={() => void run('Toggle announcement', () => rpc('staff_discord_announcement_manage', { p_action: 'toggle', p_announcement_id: a.id, p_pinned: !a.is_enabled }))}>{a.is_enabled ? 'Hide' : 'Show'}</button>
          <button className="btn-pill danger" onClick={() => void run('Delete announcement', () => rpc('staff_discord_announcement_manage', { p_action: 'delete', p_announcement_id: a.id }))}><Trash2 size={13} /></button>
        </div>
      </div>)}
    </div>
  </div>;
}
