import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Award, Bell, Check, Flag, KeyRound, Save, Swords, Trash2, Trophy } from 'lucide-react';
import { PlayerConnectionsSection } from '@/components/PlayerConnections';

type StaffAction = { ok: string | null; err: string | null };

const goalCategories = ['contribution', 'rank', 'daily_activity', 'weekly'];
const missionTypes = ['daily_points', 'streak', 'total_points', 'rank_improvement', 'manual'];

export function StaffAdmin() {
  const [passkey, setPasskey] = useState<string>(() => sessionStorage.getItem('nanz_staff_key') ?? '');
  const [verified, setVerified] = useState<boolean>(() => sessionStorage.getItem('nanz_staff_verified') === '1');
  const [status, setStatus] = useState<StaffAction>({ ok: null, err: null });
  const [resetting, setResetting] = useState(false);
  const [ownerSecret, setOwnerSecret] = useState('');
  const [members, setMembers] = useState<{ user_id: number; username: string | null }[]>([]);
  const [awards, setAwards] = useState<{ slug: string; name: string }[]>([]);
  const [rivals, setRivals] = useState<{ id: string; clan_name: string; is_tracking: boolean }[]>([]);
  const [goals, setGoals] = useState<{ id: string; title: string; status: string }[]>([]);
  const [missions, setMissions] = useState<{ id: string; title: string; status: string }[]>([]);
  const [config, setConfig] = useState<{ threshold_points: number; surge_percent: number; rank_milestones: number[] } | null>(null);

  const loadLists = async () => {
    const [{ data: state }, { data: awardRows }, { data: rivalRows }, { data: goalRows }, { data: missionRows }, { data: cfg }] = await Promise.all([
      supabase.from('nanz_battle_scan_state').select('battle_id').eq('id', true).maybeSingle(),
      supabase.from('nanz_award_definitions').select('slug, name').eq('is_active', true),
      supabase.from('nanz_rival_clans').select('id, clan_name, is_tracking').order('created_at'),
      supabase.from('nanz_clan_goals').select('id, title, status').order('created_at', { ascending: false }),
      supabase.from('nanz_missions').select('id, title, status').order('created_at', { ascending: false }),
      supabase.from('nanz_rival_alert_config').select('threshold_points, surge_percent, rank_milestones').eq('id', true).maybeSingle(),
    ]);
    setAwards((awardRows ?? []) as { slug: string; name: string }[]);
    setRivals((rivalRows ?? []) as { id: string; clan_name: string; is_tracking: boolean }[]);
    setGoals((goalRows ?? []) as { id: string; title: string; status: string }[]);
    setMissions((missionRows ?? []) as { id: string; title: string; status: string }[]);
    setConfig(cfg as { threshold_points: number; surge_percent: number; rank_milestones: number[] } | null);
    const battleId = state?.battle_id as string | undefined;
    if (battleId) {
      const { data } = await supabase.from('nanz_battle_member_rankings').select('user_id, username').eq('battle_id', battleId).order('battle_points', { ascending: false });
      setMembers((data ?? []) as { user_id: number; username: string | null }[]);
    }
  };
  useEffect(() => { void loadLists(); }, []);

  const verify = async () => {
    const { data, error } = await supabase.rpc('staff_verify', { p_passkey: passkey });
    if (error || !data) { setStatus({ ok: null, err: 'Passkey rejected.' }); setVerified(false); sessionStorage.removeItem('nanz_staff_verified'); return; }
    setVerified(true);
    sessionStorage.setItem('nanz_staff_verified', '1');
    sessionStorage.setItem('nanz_staff_key', passkey);
    setStatus({ ok: 'Staff access verified.', err: null });
  };

  const resetPasskey = async () => {
    if (passkey.trim().length < 20) { setStatus({ ok: null, err: 'Choose a management passkey with at least 20 characters.' }); return; }
    if (ownerSecret.trim().length < 20) { setStatus({ ok: null, err: 'Enter the owner secret NANZ_STAFF_PASSKEY (at least 20 characters).' }); return; }
    setResetting(true);
    setStatus({ ok: null, err: null });
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nanz-discord-bridge`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'staff_passkey_set', secret: ownerSecret.trim(), passkey: passkey.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      sessionStorage.setItem('nanz_staff_verified', '1');
      sessionStorage.setItem('nanz_staff_key', passkey.trim());
      setVerified(true);
      setStatus({ ok: 'Management passkey updated. Staff controls unlocked.', err: null });
      setOwnerSecret('');
      setPasskey('');
    } catch (e) {
      setStatus({ ok: null, err: e instanceof Error ? e.message : 'Passkey reset failed' });
    } finally {
      setResetting(false);
    }
  };

  const run = async (label: string, fn: () => PromiseLike<unknown>) => {
    setStatus({ ok: null, err: null });
    try {
      const res = await fn() as { error?: { message?: string } | null; data?: unknown } | null;
      if (res?.error) throw new Error(res.error.message);
      setStatus({ ok: `${label} — done.`, err: null });
      await loadLists();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Action failed';
      setStatus({ ok: null, err: `${label} failed — ${message}` });
    }
  };

  if (!verified) {
    return <div className="glass-card sa-gate">
      <div className="card-header"><div><span className="card-label">Staff access</span><h3>Management Passkey</h3></div><KeyRound size={20} /></div>
      <p className="sa-note">Staff actions are enforced server-side. Enter the management passkey to unlock rival, goal, mission, Hall of Fame, award and Discord controls.</p>
      <div className="sa-gate-row">
        <input type="password" value={passkey} onChange={(e) => setPasskey(e.target.value)} placeholder="Staff passkey" />
        <button className="btn-primary" onClick={() => void verify()}>Unlock</button>
      </div>
      {status.err && <small className="form-error">{status.err}</small>}
      <div className="sa-gate-reset">
        <p>First-time setup or lost passkey? Paste the owner secret <b>NANZ_STAFF_PASSKEY</b> from Bolt (database icon → Secrets) and choose a new management passkey:</p>
        <div className="sa-gate-row">
          <input type="password" value={ownerSecret} onChange={(e) => setOwnerSecret(e.target.value)} placeholder="Owner secret (NANZ_STAFF_PASSKEY)" />
        </div>
        <div className="sa-gate-row">
          <input type="password" value={passkey} onChange={(e) => setPasskey(e.target.value)} placeholder="New management passkey (min. 20 characters)" />
          <button className="btn-pill active" onClick={() => void resetPasskey()} disabled={resetting}>{resetting ? 'Setting...' : 'Set passkey'}</button>
        </div>
      </div>
    </div>;
  }

  return <div className="glass-card sa-panel">
    <div className="card-header"><div><span className="card-label">Staff management</span><h3>Management Controls</h3></div><button className="btn-pill" onClick={() => { sessionStorage.removeItem('nanz_staff_verified'); setVerified(false); }}>Lock panel</button></div>
    {(status.ok || status.err) && <div className={status.err ? 'sa-status err' : 'sa-status ok'}>{status.err ?? status.ok}</div>}

    <RivalsSection passkey={passkey} rivals={rivals} run={run} />
    <GoalsSection passkey={passkey} goals={goals} run={run} />
    <MissionsSection passkey={passkey} missions={missions} members={members} run={run} />
    <HofSection passkey={passkey} run={run} />
    <AlertConfigSection passkey={passkey} config={config} run={run} />
    <ManualAwardSection passkey={passkey} awards={awards} members={members} run={run} />
    <PlayerConnectionsSection passkey={passkey} members={members} run={run} />
  </div>;
}

type RunFn = (label: string, fn: () => PromiseLike<unknown>) => Promise<void>;

function RivalsSection({ passkey, rivals, run }: { passkey: string; rivals: { id: string; clan_name: string; is_tracking: boolean }[]; run: RunFn }) {
  const [clanName, setClanName] = useState('');
  const [displayName, setDisplayName] = useState('');
  return <div className="sa-section">
    <div className="sa-section-head"><Swords size={16} /><b>Rival Clans</b><small>Only clans verified in the live ranking can be tracked</small></div>
    <div className="sa-form-row">
      <input value={clanName} onChange={(e) => setClanName(e.target.value)} placeholder="Clan name as shown in battle ranking (e.g. VORTEX)" />
      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name (optional)" />
      <button className="btn-pill active" onClick={() => void run(`Add rival ${clanName}`, () => supabase.rpc('staff_manage_rival', { p_passkey: passkey, p_action: 'add', p_clan_name: clanName.trim(), p_display_name: displayName.trim() || null, p_tracking: true }))}>Add rival</button>
    </div>
    {rivals.map((rival) => <div key={rival.id} className="sa-managed-row">
      <span><b>{rival.clan_name}</b><small>{rival.is_tracking ? 'Tracking' : 'Paused'}</small></span>
      <div className="sa-row-actions">
        <button className="btn-pill" onClick={() => void run(rival.is_tracking ? `Pause ${rival.clan_name}` : `Resume ${rival.clan_name}`, () => supabase.rpc('staff_manage_rival', { p_passkey: passkey, p_action: 'update', p_clan_name: rival.clan_name, p_tracking: !rival.is_tracking }))}>{rival.is_tracking ? 'Pause' : 'Resume'}</button>
        <button className="btn-pill danger" onClick={() => void run(`Delete ${rival.clan_name}`, () => supabase.rpc('staff_manage_rival', { p_passkey: passkey, p_action: 'delete', p_clan_name: rival.clan_name }))}><Trash2 size={13} /></button>
      </div>
    </div>)}
  </div>;
}

function GoalsSection({ passkey, goals, run }: { passkey: string; goals: { id: string; title: string; status: string }[]; run: RunFn }) {
  const [title, setTitle] = useState('');
  const [targetPoints, setTargetPoints] = useState('');
  const [targetRank, setTargetRank] = useState('');
  const [deadline, setDeadline] = useState('');
  const [category, setCategory] = useState('contribution');
  const pts = targetPoints ? Number(targetPoints.replace(/[^0-9]/g, '')) : null;
  const rk = targetRank ? Number(targetRank.replace(/[^0-9]/g, '')) : null;
  return <div className="sa-section">
    <div className="sa-section-head"><Flag size={16} /><b>Clan Goals</b><small>Progress updates automatically after each sync</small></div>
    <div className="sa-form-row">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Goal title" />
      <select value={category} onChange={(e) => setCategory(e.target.value)}>{goalCategories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
    </div>
    <div className="sa-form-row">
      <input value={targetPoints} onChange={(e) => setTargetPoints(e.target.value)} inputMode="numeric" placeholder="Target points (e.g. 200000)" />
      <input value={targetRank} onChange={(e) => setTargetRank(e.target.value)} inputMode="numeric" placeholder="Or target rank (e.g. 150)" />
      <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      <button className="btn-pill active" onClick={() => void run(`Create goal ${title}`, () => supabase.rpc('staff_manage_goal', { p_passkey: passkey, p_action: 'create', p_title: title.trim(), p_category: category, p_target_points: pts, p_target_rank: rk, p_deadline: deadline ? new Date(deadline).toISOString() : null }))}>Create</button>
    </div>
    {goals.map((goal) => <div key={goal.id} className="sa-managed-row">
      <span><b>{goal.title}</b><small>{goal.status}</small></span>
      <div className="sa-row-actions">
        {goal.status === 'active' && <button className="btn-pill" onClick={() => void run('Pause goal', () => supabase.rpc('staff_manage_goal', { p_passkey: passkey, p_action: 'pause', p_goal_id: goal.id }))}>Pause</button>}
        {goal.status === 'paused' && <button className="btn-pill" onClick={() => void run('Resume goal', () => supabase.rpc('staff_manage_goal', { p_passkey: passkey, p_action: 'resume', p_goal_id: goal.id }))}>Resume</button>}
        <button className="btn-pill" onClick={() => void run('Complete goal', () => supabase.rpc('staff_manage_goal', { p_passkey: passkey, p_action: 'complete', p_goal_id: goal.id }))}>Complete</button>
        <button className="btn-pill" onClick={() => void run('Archive goal', () => supabase.rpc('staff_manage_goal', { p_passkey: passkey, p_action: 'archive', p_goal_id: goal.id }))}>Archive</button>
      </div>
    </div>)}
  </div>;
}

function MissionsSection({ passkey, missions, members, run }: { passkey: string; missions: { id: string; title: string; status: string }[]; members: { user_id: number; username: string | null }[]; run: RunFn }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('daily_points');
  const [value, setValue] = useState('');
  const [reward, setReward] = useState('');
  const [assignUser, setAssignUser] = useState('');
  const reqValue = value ? Number(value.replace(/[^0-9]/g, '')) : null;
  const activeMissions = missions.filter((m) => m.status === 'active');
  return <div className="sa-section">
    <div className="sa-section-head"><Trophy size={16} /><b>Missions</b><small>Auto-tracked missions update from daily snapshots</small></div>
    <div className="sa-form-row">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mission title" />
      <select value={type} onChange={(e) => setType(e.target.value)}>{missionTypes.map((t) => <option key={t} value={t}>{t}</option>)}</select>
      <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" placeholder="Requirement value" />
      <input value={reward} onChange={(e) => setReward(e.target.value)} placeholder="Reward (optional)" />
      <button className="btn-pill active" onClick={() => void run(`Create mission ${title}`, () => supabase.rpc('staff_manage_mission', { p_passkey: passkey, p_action: 'create', p_title: title.trim(), p_requirement_type: type, p_requirement_value: reqValue, p_reward: reward.trim() || null }))}>Create</button>
    </div>
    {activeMissions.length > 0 && <div className="sa-form-row">
      <select value={assignUser} onChange={(e) => setAssignUser(e.target.value)}><option value="">Assign member to mission...</option>{activeMissions.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
      <select onChange={(e) => { const userId = Number(e.target.value); if (!userId || !assignUser) return; void run('Assign mission', () => supabase.rpc('staff_manage_mission', { p_passkey: passkey, p_action: 'assign', p_mission_id: assignUser, p_user_id: userId })); }} defaultValue="">
        <option value="">Choose member...</option>
        {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.username ?? `User ${m.user_id}`}</option>)}
      </select>
    </div>}
    {missions.map((mission) => <div key={mission.id} className="sa-managed-row">
      <span><b>{mission.title}</b><small>{mission.status}</small></span>
      <div className="sa-row-actions">
        {mission.status === 'active' && <button className="btn-pill" onClick={() => void run('Pause mission', () => supabase.rpc('staff_manage_mission', { p_passkey: passkey, p_action: 'pause', p_mission_id: mission.id }))}>Pause</button>}
        {mission.status === 'paused' && <button className="btn-pill" onClick={() => void run('Resume mission', () => supabase.rpc('staff_manage_mission', { p_passkey: passkey, p_action: 'resume', p_mission_id: mission.id }))}>Resume</button>}
        <button className="btn-pill" onClick={() => void run('Complete mission', () => supabase.rpc('staff_manage_mission', { p_passkey: passkey, p_action: 'complete', p_mission_id: mission.id }))}>Complete</button>
        <button className="btn-pill" onClick={() => void run('Archive mission', () => supabase.rpc('staff_manage_mission', { p_passkey: passkey, p_action: 'archive', p_mission_id: mission.id }))}>Archive</button>
      </div>
    </div>)}
  </div>;
}

function HofSection({ passkey, run }: { passkey: string; run: RunFn }) {
  const [userId, setUserId] = useState('');
  const [username, setUsername] = useState('');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  return <div className="sa-section">
    <div className="sa-section-head"><Award size={16} /><b>Hall of Fame</b><small>Manual honorary special-recognition entries only</small></div>
    <div className="sa-form-row">
      <input value={userId} onChange={(e) => setUserId(e.target.value)} inputMode="numeric" placeholder="Roblox user ID" />
      <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Recognition title" />
      <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Detail (optional)" />
      <button className="btn-pill active" onClick={() => void run('Add recognition', async () => { await supabase.rpc('staff_manage_hof', { p_passkey: passkey, p_action: 'add', p_user_id: userId ? Number(userId) : null, p_username: username.trim() || null, p_title: title.trim(), p_entry_type: 'special_recognition' }); })}>Add</button>
    </div>
    {userId && <button className="btn-pill danger" onClick={() => void run('Remove recognition', () => supabase.rpc('staff_manage_hof', { p_passkey: passkey, p_action: 'remove', p_user_id: Number(userId), p_entry_type: 'special_recognition' }))}><Trash2 size={13} /> Remove by user ID</button>}
  </div>;
}

function AlertConfigSection({ passkey, config, run }: { passkey: string; config: { threshold_points: number; surge_percent: number; rank_milestones: number[] } | null; run: RunFn }) {
  const [threshold, setThreshold] = useState('');
  const [surge, setSurge] = useState('');
  const [milestones, setMilestones] = useState('');
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (config && !initialized) {
      setThreshold(String(config.threshold_points));
      setSurge(String(config.surge_percent));
      setMilestones((config.rank_milestones ?? []).join(', '));
      setInitialized(true);
    }
  }, [config, initialized]);
  const milestoneList = milestones.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return <div className="sa-section">
    <div className="sa-section-head"><Bell size={16} /><b>Rival Alert Thresholds</b><small>Applies to the next intelligence run</small></div>
    <div className="sa-form-row">
      <input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="numeric" placeholder="Gap threshold points" />
      <input value={surge} onChange={(e) => setSurge(e.target.value)} inputMode="numeric" placeholder="Surge percent" />
      <input value={milestones} onChange={(e) => setMilestones(e.target.value)} placeholder="Rank milestones (e.g. 250, 200, 150)" />
      <button className="btn-pill active" onClick={() => void run('Save alert config', async () => { await supabase.rpc('staff_manage_alert_config', { p_passkey: passkey, p_threshold_points: Number(threshold) || null, p_surge_percent: Number(surge) || null, p_milestones: milestoneList.length > 0 ? milestoneList : null }); })}><Save size={13} /> Save</button>
    </div>
  </div>;
}

function ManualAwardSection({ passkey, awards, members, run }: { passkey: string; awards: { slug: string; name: string }[]; members: { user_id: number; username: string | null }[]; run: RunFn }) {
  const [slug, setSlug] = useState('');
  const [userId, setUserId] = useState('');
  const [notes, setNotes] = useState('');
  return <div className="sa-section">
    <div className="sa-section-head"><Award size={16} /><b>Manual Awards</b><small>Award a verified member any active award</small></div>
    <div className="sa-form-row">
      <select value={slug} onChange={(e) => setSlug(e.target.value)}><option value="">Choose award...</option>{awards.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}</select>
      <select value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Choose member...</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.username ?? `User ${m.user_id}`}</option>)}</select>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
      <button className="btn-pill active" disabled={!slug || !userId} onClick={() => void run('Award member', async () => { await supabase.rpc('staff_manual_award', { p_passkey: passkey, p_award_slug: slug, p_roblox_user_id: Number(userId), p_notes: notes.trim() || null }); })}><Check size={13} /> Award</button>
    </div>
  </div>;
}
