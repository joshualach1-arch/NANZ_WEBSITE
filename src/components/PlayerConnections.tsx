import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Check, Link2, Pencil, Search, Trash2, UserPlus } from 'lucide-react';

type ConnectionRow = {
  roblox_user_id: number;
  roblox_username: string | null;
  discord_user_id: string;
  discord_username: string | null;
  discord_in_server: boolean;
  created_at: string;
  updated_at: string;
};

type ClanMemberOption = { user_id: number; username: string | null };

type RunFn = (label: string, fn: () => PromiseLike<unknown>) => Promise<void>;

export function PlayerConnectionsSection({ passkey, members, run }: { passkey: string; members: ClanMemberOption[]; run: RunFn }) {
  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ robloxUserId: string; robloxUsername: string; discordUserId: string; discordUsername: string } | null>(null);

  const load = async () => {
    const { data, error } = await supabase.rpc('staff_player_connection_list', { p_passkey: passkey });
    if (!error) setRows((data ?? []) as unknown as ConnectionRow[]);
  };
  useEffect(() => { void load(); }, [passkey]);

  const memberOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = members.filter((m) => m.username);
    if (!query) return list.slice(0, 40);
    return list.filter((m) => (m.username ?? '').toLowerCase().includes(query)).slice(0, 40);
  }, [members, search]);

  const selectedMember = (userId: string) => members.find((m) => String(m.user_id) === userId) ?? null;

  const remove = (row: ConnectionRow) => {
    void run(`Remove connection ${row.roblox_username ?? row.roblox_user_id}`, async () => {
      await supabase.rpc('staff_player_connection_delete', { p_passkey: passkey, p_roblox_user_id: row.roblox_user_id });
      await load();
    });
  };

  return <div className="sa-section">
    <div className="sa-section-head"><Link2 size={16} /><b>Player Connections</b><small>Link clan members to their Discord accounts · Discord user ID is the identity, username is display-only</small></div>

    <div className="sa-conn-search">
      <Search size={14} />
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clan members by Roblox username..." />
    </div>

    {editing === null && <button className="btn-pill active sa-conn-add" onClick={() => setEditing({ robloxUserId: '', robloxUsername: '', discordUserId: '', discordUsername: '' })}><UserPlus size={13} /> Add Connection</button>}

    {editing !== null && <div className="sa-conn-editor">
      <div className="sa-form-row">
        <select
          value={editing.robloxUserId}
          onChange={(e) => {
            const member = selectedMember(e.target.value);
            setEditing((current) => current && { ...current, robloxUserId: e.target.value, robloxUsername: member?.username ?? current.robloxUsername });
          }}
        >
          <option value="">{editing.robloxUserId ? `${editing.robloxUsername || editing.robloxUserId} (locked)` : 'Choose clan member...'}</option>
          {memberOptions.map((m) => <option key={m.user_id} value={m.user_id}>{m.username ?? `User ${m.user_id}`}</option>)}
        </select>
      </div>
      {editing.robloxUserId && <div className="sa-conn-note">Roblox User ID <b>{editing.robloxUserId}</b>{editing.robloxUsername ? ` · ${editing.robloxUsername}` : ''}</div>}
      <div className="sa-form-row">
        <input
          value={editing.discordUserId}
          onChange={(e) => setEditing((current) => current && { ...current, discordUserId: e.target.value.replace(/[^0-9]/g, '') })}
          inputMode="numeric"
          placeholder="Discord User ID (snowflake, 17-20 digits)"
        />
        <input
          value={editing.discordUsername}
          onChange={(e) => setEditing((current) => current && { ...current, discordUsername: e.target.value })}
          placeholder="Discord username (display only)"
        />
      </div>
      <div className="sa-form-row">
        <button className="btn-pill active" disabled={!editing.robloxUserId || editing.discordUserId.length < 17} onClick={() => {
          void run(`Save connection for ${editing.robloxUsername || editing.robloxUserId}`, async () => {
            await supabase.rpc('staff_player_connection_upsert', {
              p_passkey: passkey,
              p_roblox_user_id: Number(editing.robloxUserId),
              p_roblox_username: editing.robloxUsername || null,
              p_discord_user_id: editing.discordUserId,
              p_discord_username: editing.discordUsername.trim() || null,
            });
            await load();
          });
          setEditing(null);
        }}><Check size={13} /> Save Connection</button>
        <button className="btn-pill" onClick={() => setEditing(null)}>Cancel</button>
      </div>
    </div>}

    <div className="sa-conn-table-head">
      <span>Roblox</span><span>User ID</span><span>Discord</span><span>Discord ID</span><span>Status</span><span>Updated</span><span />
    </div>
    {rows.length === 0
      ? <div className="sa-conn-empty">No connections yet. Add one to enable the Discord button on player profiles.</div>
      : rows.map((row) => <div key={row.roblox_user_id} className="sa-conn-row">
          <span className="sa-conn-name"><b>{row.roblox_username ?? `User ${row.roblox_user_id}`}</b></span>
          <span className="sa-conn-mono">{row.roblox_user_id}</span>
          <span><b>{row.discord_username ?? '—'}</b></span>
          <span className="sa-conn-mono">{row.discord_user_id}</span>
          <span><small className={row.discord_in_server ? 'sa-conn-badge ok' : 'sa-conn-badge'}>{row.discord_in_server ? 'Discord Member' : 'Linked'}</small></span>
          <span><small>{new Date(row.updated_at).toLocaleString()}</small></span>
          <span className="sa-conn-actions">
            <button className="btn-pill" aria-label="Edit connection" onClick={() => setEditing({ robloxUserId: String(row.roblox_user_id), robloxUsername: row.roblox_username ?? '', discordUserId: row.discord_user_id, discordUsername: row.discord_username ?? '' })}><Pencil size={13} /></button>
            <button className="btn-pill danger" aria-label="Remove connection" onClick={() => remove(row)}><Trash2 size={13} /></button>
          </span>
        </div>)}
  </div>;
}
