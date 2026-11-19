import { useEffect, useMemo, useState } from 'react';
import { AvatarMap, supabase } from '@/lib/supabase';
import {
  ArrowLeft, Bell, Check, Clock, Crown, Star, Swords, Target, TrendingUp, Trophy, Zap, Shield,
} from 'lucide-react';

const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);

type RivalClan = {
  id: string; clan_name: string; display_name: string | null; description: string | null;
  logo_url: string | null; is_tracking: boolean; threat_level: string;
  last_known_points: number | null; last_known_rank: number | null; last_updated_at: string | null; created_at: string;
};

type RivalSnapshot = { clan_name: string; battle_points: number | null; clan_rank: number | null; captured_at: string };

type ClanGoal = {
  id: string; title: string; description: string | null; goal_category: string;
  target_points: number | null; target_rank: number | null; current_value: number;
  start_date: string | null; deadline: string | null; owner_label: string | null;
  reward_description: string | null; status: string; created_at: string;
};

type Mission = {
  id: string; title: string; description: string | null; requirement_type: string;
  requirement_value: number | null; start_date: string; end_date: string | null;
  reward_text: string | null; status: string;
};

type MemberMission = { mission_id: string; roblox_user_id: number; username: string | null; progress: number; completed_at: string | null };

type RivalAlert = { id: string; alert_type: string; title: string; detail: string | null; rival_clan: string | null; created_at: string };

type ScanStateLite = { battle_id: string | null; battle_name: string | null; nanz_battle_points: number | null; official_battle_place: number | null; rank_within_scanned_clans: number | null; member_count: number | null; battle_start_time: string | null; battle_finish_time: string | null; points_per_hour: number | null; last_successful_scan_at: string | null; is_stale: boolean };

function freshnessLabel(updatedAt: string | null): { label: string; tone: 'fresh' | 'ok' | 'stale' } {
  if (!updatedAt) return { label: 'Never synced', tone: 'stale' };
  const minutes = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60_000);
  if (minutes < 5) return { label: `${minutes < 1 ? '<1' : minutes}m ago`, tone: 'fresh' };
  if (minutes < 60) return { label: `${minutes}m ago`, tone: 'ok' };
  return { label: `${Math.floor(minutes / 60)}h ago`, tone: 'stale' };
}

// ============================================================
// Section switcher
// ============================================================

export function RivalIntelligence({ scanState, initialView = 'overview' }: { scanState: ScanStateLite | null; initialView?: 'overview' | 'goals' }) {
  const [view, setView] = useState<'overview' | 'goals'>(initialView);
  return view === 'overview'
    ? <RivalOverview scanState={scanState} onOpenGoals={() => setView('goals')} />
    : <ClanGoalsMissions scanState={scanState} onBack={() => setView('overview')} />;
}

// ============================================================
// Rival Overview + comparison + simulator
// ============================================================

function RivalOverview({ scanState, onOpenGoals }: { scanState: ScanStateLite | null; onOpenGoals: () => void }) {
  const [rivals, setRivals] = useState<RivalClan[]>([]);
  const [alerts, setAlerts] = useState<RivalAlert[]>([]);
  const [snapshots, setSnapshots] = useState<RivalSnapshot[]>([]);
  const [view, setView] = useState<'dashboard' | 'simulator'>('dashboard');
  const [alertConfig, setAlertConfig] = useState<{ threshold_points: number; surge_percent: number } | null>(null);
  const [nanzHistory, setNanzHistory] = useState<{ battle_points: number; captured_at: string }[]>([]);
  const [rankings, setRankings] = useState<{ clan_name: string; battle_points: number }[]>([]);

  const load = async () => {
    const [{ data: rivalRows }, { data: alertRows }, { data: snapRows }, { data: configRows }] = await Promise.all([
      supabase.from('nanz_rival_clans').select('*').order('last_known_points', { ascending: false, nullsFirst: false }),
      supabase.from('nanz_rival_alerts').select('id, alert_type, title, detail, rival_clan, created_at').order('created_at', { ascending: false }).limit(15),
      supabase.from('nanz_rival_snapshots').select('clan_name, battle_points, clan_rank, captured_at').order('captured_at', { ascending: false }).limit(600),
      supabase.from('nanz_rival_alert_config').select('threshold_points, surge_percent').eq('id', true).maybeSingle(),
    ]);
    setRivals((rivalRows ?? []) as RivalClan[]);
    setAlerts((alertRows ?? []) as RivalAlert[]);
    setSnapshots((snapRows ?? []) as RivalSnapshot[]);
    setAlertConfig(configRows as { threshold_points: number; surge_percent: number } | null);

    const { data: state } = await supabase.from('nanz_battle_scan_state').select('battle_id').eq('id', true).maybeSingle();
    const battleId = state?.battle_id as string | undefined;
    if (battleId) {
      const [{ data: snapHistory }, { data: rankRows }] = await Promise.all([
        supabase.from('nanz_battle_point_snapshots').select('battle_points, captured_at').eq('battle_id', battleId).eq('clan_name', 'NANZ').order('captured_at', { ascending: false }).limit(60),
        supabase.from('nanz_battle_rankings').select('clan_name, battle_points').eq('battle_id', battleId).eq('status', 'verified').order('battle_points', { ascending: false }).limit(1000),
      ]);
      setNanzHistory(((snapHistory ?? []) as { battle_points: number; captured_at: string }[]).reverse());
      setRankings(((rankRows ?? []) as { clan_name: string; battle_points: number | null }[]).filter((r) => r.battle_points !== null) as { clan_name: string; battle_points: number }[]);
    }
  };

  useEffect(() => { void load(); const t = window.setInterval(load, 60_000); return () => window.clearInterval(t); }, []);

  const nanzPoints = scanState?.nanz_battle_points ?? null;
  const nanzPlace = scanState?.official_battle_place ?? null;

  return <div className="page-inner">
    <div className="pu-header-row">
      <div><span className="kicker">Know your enemy</span><h2>Rival <span className="accent-text">Intelligence</span></h2></div>
      <div className="pu-nav-buttons">
        <button className="btn-pill" onClick={() => setView(view === 'dashboard' ? 'simulator' : 'dashboard')}>{view === 'dashboard' ? <><Target size={15} /> Rank Simulator</> : <><ArrowLeft size={15} /> Rival Dashboard</>}</button>
        <button className="btn-pill" onClick={onOpenGoals}><Star size={15} /> Clan Goals</button>
      </div>
    </div>

    {view === 'simulator'
      ? <RankSimulator verifiedRankings={rankings} nanzPlace={nanzPlace} nanzPoints={nanzPoints} />
      : <>
      {alerts.length > 0 && <div className="ri-alert-list">
        {alerts.slice(0, 4).map((alert) => <div key={alert.id} className={`ri-alert ri-alert-${alert.alert_type}`}>
          <Bell size={16} />
          <div><b>{alert.title}</b><small>{alert.detail}</small></div>
          <span className="ri-alert-time">{new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>)}
      </div>}

      <div className="ri-compare-hero">
        <div className="ri-hero-nanz">
          <span className="pill pill-pink">NANZ · Your clan</span>
          <b>{nanzPoints !== null ? fmt(nanzPoints) : '—'}</b>
          <small>#{nanzPlace ?? '—'} global · {scanState?.battle_name ?? 'battle'}</small>
        </div>
        <div className="ri-hero-rivals">
          {rivals.filter((r) => r.is_tracking).slice(0, 3).map((rival) => {
            const diff = nanzPoints !== null && rival.last_known_points !== null ? nanzPoints - rival.last_known_points : null;
            return <div key={rival.id} className="ri-hero-rival">
              <span className="ri-rival-name">{rival.display_name ?? rival.clan_name}</span>
              <b>{rival.last_known_points !== null ? fmt(rival.last_known_points) : '—'}</b>
              <small className={diff !== null && diff < 0 ? 'ri-behind' : diff !== null ? 'ri-ahead' : ''}>{diff !== null ? (diff >= 0 ? `+${fmt(diff)} ahead` : `${fmt(Math.abs(diff))} behind`) : 'No data yet'}</small>
            </div>;
          })}
          {rivals.filter((r) => r.is_tracking).length === 0 && <div className="empty-state">No rivals tracked yet. Management can add verified rival clans in the admin panel (#admin).</div>}
        </div>
      </div>

      {rivals.length > 0 && <div className="glass-card ri-table-card">
        <div className="card-header"><div><span className="card-label">Verified battle data</span><h3>Rival Dashboard</h3></div><span className="pill pill-gray">{rivals.filter((r) => r.is_tracking).length} tracked</span></div>
        <div className="ri-table">
          <div className="ri-table-header"><span>Clan</span><span>Battle Points</span><span>Rank</span><span>vs NANZ</span><span>Points/Hour</span><span>Updated</span></div>
          <div className="ri-table-row ri-nanz-row">
            <span><b className="ri-nanz-name">NANZ</b></span>
            <span>{nanzPoints !== null ? fmt(nanzPoints) : '—'}</span>
            <span>#{nanzPlace ?? '—'}</span>
            <span>—</span>
            <span>{scanState?.points_per_hour ? fmt(Math.round(scanState.points_per_hour)) : '—'}</span>
            <span>{freshnessLabel(scanState?.last_successful_scan_at ?? null).label}</span>
          </div>
          {rivals.map((rival) => {
            const diff = nanzPoints !== null && rival.last_known_points !== null ? nanzPoints - rival.last_known_points : null;
            const fresh = freshnessLabel(rival.last_updated_at);
            const pps = computeRivalPps(snapshots.filter((s) => s.clan_name === rival.clan_name));
            return <div key={rival.id} className="ri-table-row">
              <span><b>{rival.display_name ?? rival.clan_name}</b><small>{!rival.is_tracking ? 'Paused' : rival.threat_level}</small></span>
              <span>{rival.last_known_points !== null ? fmt(rival.last_known_points) : '—'}</span>
              <span>{rival.last_known_rank ? `#${rival.last_known_rank}` : '—'}</span>
              <span className={diff !== null && diff < 0 ? 'ri-behind' : diff !== null ? 'ri-ahead' : ''}>{diff !== null ? (diff >= 0 ? `+${fmt(diff)}` : `−${fmt(Math.abs(diff))}`) : '—'}</span>
              <span>{pps !== null ? fmt(pps) : '—'}</span>
              <span className={`ri-fresh-${fresh.tone}`}>{fresh.label}</span>
            </div>;
          })}
        </div>
      </div>}

      {rivals.length > 0 && <DevelopmentChart nanzHistory={nanzHistory} rivals={rivals.filter((r) => r.is_tracking).slice(0, 4)} snapshots={snapshots} />}

      {alertConfig && <div className="ri-config-note">
        <Shield size={16} />
        <span>Alerts: overtake detection · gap threshold {fmt(alertConfig.threshold_points)} pts · surge detection {alertConfig.surge_percent}% · generated only from verified scans every 60s.</span>
      </div>}
      </>}
  </div>;
}

function computeRivalPps(snaps: RivalSnapshot[]): number | null {
  if (snaps.length < 2) return null;
  const sorted = snaps.slice().reverse();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first.battle_points === null || last.battle_points === null) return null;
  const hours = (new Date(last.captured_at).getTime() - new Date(first.captured_at).getTime()) / 3_600_000;
  if (hours <= 0) return null;
  return Math.round((last.battle_points - first.battle_points) / hours);
}

function DevelopmentChart({ nanzHistory, rivals, snapshots }: { nanzHistory: { battle_points: number; captured_at: string }[]; rivals: RivalClan[]; snapshots: RivalSnapshot[] }) {
  if (nanzHistory.length < 2) return null;
  const width = 700;
  const height = 180;
  const allValues: number[] = [];
  for (const s of nanzHistory) allValues.push(s.battle_points);
  for (const rival of rivals) {
    for (const s of snapshots.filter((x) => x.clan_name === rival.clan_name && x.battle_points !== null)) allValues.push(s.battle_points!);
  }
  if (allValues.length < 2) return null;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const norm = (y: number) => height - 20 - ((y - min) / Math.max(1, max - min)) * (height - 40);

  const series: { name: string; color: string; points: string }[] = [];
  series.push({ name: 'NANZ', color: 'var(--pink)', points: nanzHistory.map((s, i) => `${(i / (nanzHistory.length - 1)) * width},${norm(s.battle_points)}`).join(' ') });

  const rivalColors = ['var(--blue)', 'var(--gold)', 'var(--green)', 'var(--cyan)'];
  rivals.forEach((rival, ri) => {
    const snaps = snapshots.filter((s) => s.clan_name === rival.clan_name && s.battle_points !== null).slice(0, 60).reverse();
    if (snaps.length < 2) return;
    series.push({ name: rival.display_name ?? rival.clan_name, color: rivalColors[ri % rivalColors.length], points: snaps.map((s, i) => `${(i / (snaps.length - 1)) * width},${norm(s.battle_points!)}`).join(' ') });
  });

  return <div className="glass-card ri-chart-card">
    <div className="card-header"><div><span className="card-label">Contribution development</span><h3>Historical Comparison</h3></div><div className="ri-legend">{series.map((s) => <span key={s.name} style={{ color: s.color }}>{s.name}</span>)}</div></div>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Rival points development">
      {series.map((s) => <polyline key={s.name} points={s.points} fill="none" stroke={s.color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />)}
    </svg>
  </div>;
}

function RankSimulator({ verifiedRankings, nanzPlace, nanzPoints }: { verifiedRankings: { clan_name: string; battle_points: number }[]; nanzPlace: number | null; nanzPoints: number | null }) {
  const [extra, setExtra] = useState('');
  const extraNum = Number(extra.replace(/[^0-9]/g, ''));
  const hasInput = extraNum > 0 && nanzPoints !== null;
  const hypothetical = hasInput ? nanzPoints + extraNum : null;

  const sorted = useMemo(() => [...verifiedRankings].sort((a, b) => b.battle_points - a.battle_points), [verifiedRankings]);
  const currentRankInList = sorted.findIndex((c) => c.battle_points <= (nanzPoints ?? -1)) + 1;
  const newRank = hypothetical !== null ? sorted.findIndex((c) => c.battle_points <= hypothetical) + 1 : 0;
  const overtaken = newRank > 0 && currentRankInList > 0 ? sorted.slice(newRank - 1, Math.max(newRank - 1, currentRankInList - 1)).map((c) => c.clan_name) : [];
  const nextTarget = newRank > 1 ? sorted[newRank - 2] : null;
  const pointsToNext = nextTarget && hypothetical !== null ? nextTarget.battle_points - hypothetical : null;

  return <div className="glass-card ri-simulator">
    <div className="card-header"><div><span className="card-label">Simulation · not live data</span><h3>Battle Rank Simulator</h3></div><span className="pill pill-gold">Estimated</span></div>
    <p className="ri-sim-note">Enter a hypothetical additional point total. The simulation uses the latest verified clan scores for the active battle ({sorted.length} clans scanned). This is an estimate — it never replaces the live ranking.</p>
    <div className="ri-sim-input-row">
      <div className="search-box"><Swords size={16} /><input value={extra} onChange={(e) => setExtra(e.target.value)} inputMode="numeric" placeholder="Additional battle points, e.g. 50000" /></div>
    </div>
    {hasInput ? <div className="ri-sim-results">
      <div className="ri-sim-grid">
        <div className="ri-sim-tile"><span>Current verified place</span><b>#{nanzPlace ?? (currentRankInList || '—')}</b></div>
        <div className="ri-sim-tile"><span>Hypothetical total</span><b>{fmt(hypothetical!)}</b><small>{fmt(nanzPoints!)} + {fmt(extraNum)}</small></div>
        <div className="ri-sim-tile ri-sim-new"><span>Estimated new place</span><b>#{newRank || '—'}</b></div>
        <div className="ri-sim-tile"><span>Points to next place</span><b>{pointsToNext !== null && pointsToNext > 0 ? fmt(pointsToNext) : 'Leader position'}</b></div>
      </div>
      {overtaken.length > 0 && <div className="ri-sim-overtake">
        <TrendingUp size={16} />
        <span>Would overtake {overtaken.length} clan{overtaken.length > 1 ? 's' : ''}: {overtaken.slice(0, 8).join(', ')}{overtaken.length > 8 ? ` +${overtaken.length - 8} more` : ''}</span>
      </div>}
    </div> : <div className="chart-placeholder">Enter a point amount to simulate a rank change.</div>}
  </div>;
}

// ============================================================
// Clan Goals & Missions
// ============================================================

function ClanGoalsMissions({ scanState, onBack }: { scanState: ScanStateLite | null; onBack: () => void }) {
  const [tab, setTab] = useState<'goals' | 'missions' | 'leaderboard'>('goals');
  const [goals, setGoals] = useState<ClanGoal[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [memberMissions, setMemberMissions] = useState<MemberMission[]>([]);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const [{ data: goalRows }, { data: missionRows }, { data: memberMissionRows }, { data: historyRows }] = await Promise.all([
        supabase.from('nanz_clan_goals').select('*').order('status', { ascending: true }).order('deadline', { ascending: true, nullsFirst: false }),
        supabase.from('nanz_missions').select('*').order('created_at', { ascending: false }),
        supabase.from('nanz_member_missions').select('mission_id, roblox_user_id, username, progress, completed_at'),
        supabase.from('nanz_clan_goal_history').select('*').order('created_at', { ascending: false }).limit(20),
      ]);
      setGoals((goalRows ?? []) as ClanGoal[]);
      setMissions((missionRows ?? []) as Mission[]);
      setMemberMissions((memberMissionRows ?? []) as MemberMission[]);
      setHistory((historyRows ?? []) as Record<string, unknown>[]);
    };
    void load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, []);

  const completedByUser = useMemo(() => {
    const map = new Map<number, { username: string | null; count: number }>();
    for (const mm of memberMissions) {
      if (!mm.completed_at) continue;
      const entry = map.get(mm.roblox_user_id) ?? { username: mm.username, count: 0 };
      entry.count += 1;
      map.set(mm.roblox_user_id, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
  }, [memberMissions]);

  const progressByUser = useMemo(() => {
    const map = new Map<number, { username: string | null; progress: number }>();
    const activeMissionIds = new Set(missions.filter((m) => m.status === 'active' && m.requirement_type !== 'manual').map((m) => m.id));
    for (const mm of memberMissions) {
      if (!activeMissionIds.has(mm.mission_id)) continue;
      const entry = map.get(mm.roblox_user_id) ?? { username: mm.username, progress: 0 };
      entry.progress += mm.progress;
      map.set(mm.roblox_user_id, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].progress - a[1].progress).slice(0, 10);
  }, [memberMissions, missions]);

  return <div className="page-inner">
    <button className="text-link" onClick={onBack}><ArrowLeft size={16} /> Back to Rival Intelligence</button>
    <div className="pu-header-row"><div><span className="kicker">Discipline · Performance · Community</span><h2 style={{ fontSize: 'clamp(28px,4vw,40px)', fontWeight: 800 }}>Clan <span className="accent-text">Goals & Missions</span></h2></div></div>

    <div className="pu-filter-group pu-filter-row">
      <button className={`btn-pill ${tab === 'goals' ? 'active' : ''}`} onClick={() => setTab('goals')}><Target size={14} /> Clan Goals</button>
      <button className={`btn-pill ${tab === 'missions' ? 'active' : ''}`} onClick={() => setTab('missions')}><Zap size={14} /> Missions</button>
      <button className={`btn-pill ${tab === 'leaderboard' ? 'active' : ''}`} onClick={() => setTab('leaderboard')}><Trophy size={14} /> Mission Leaderboard</button>
    </div>

    {tab === 'goals' && (goals.length === 0
      ? <div className="empty-state">No clan goals yet. Management creates shared objectives from the admin panel (#admin) — progress updates automatically after every synchronization.</div>
      : <div className="cg-goal-grid">
          {goals.map((goal) => {
            const isRank = goal.goal_category === 'rank';
            const target = isRank ? goal.target_rank : goal.target_points;
            const current = isRank ? (scanState?.official_battle_place ?? null) : goal.current_value;
            const pct = target !== null && current !== null && target > 0
              ? Math.min(100, Math.max(0, isRank ? Math.max(0, (1 - current / target)) * 100 : (current / target) * 100))
              : null;
            const remaining = target !== null && current !== null && !isRank ? Math.max(0, target - current) : null;
            const daysLeft = goal.deadline ? Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86_400_000) : null;
            return <article key={goal.id} className={`cg-goal-card ${goal.status !== 'active' ? 'cg-goal-inactive' : ''}`} onClick={() => setSelectedGoal(selectedGoal === goal.id ? null : goal.id)}>
              <div className="cg-goal-top">
                <span className={`pill ${goal.status === 'active' ? 'pill-blue' : 'pill-gray'}`}>{goal.status}</span>
                <span className="cg-goal-cat">{goal.goal_category}</span>
              </div>
              <h3>{goal.title}</h3>
              {goal.description && <p>{goal.description}</p>}
              {pct !== null && <>
                <div className="cg-progress-track"><span style={{ width: `${pct}%` }} /></div>
                <div className="cg-progress-row">
                  <span>{pct.toFixed(0)}% complete</span>
                  {remaining !== null && <span>{fmt(remaining)} pts remaining</span>}
                  {isRank && current !== null && <span>Now #{current} → Target #{goal.target_rank}</span>}
                </div>
              </>}
              <div className="cg-goal-meta">
                {daysLeft !== null && <span><Clock size={12} /> {daysLeft >= 0 ? `${daysLeft} days left` : 'Deadline passed'}</span>}
                {goal.owner_label && <span><Crown size={12} /> {goal.owner_label}</span>}
                {goal.reward_description && <span><Star size={12} /> {goal.reward_description}</span>}
              </div>
              {selectedGoal === goal.id && <div className="cg-goal-history">
                <span className="card-label">Goal history</span>
                {history.filter((h) => h.goal_id === goal.id).length === 0 ? <small>No recorded changes yet.</small> :
                  history.filter((h) => h.goal_id === goal.id).map((h) => <small key={String(h.id)}>{String(h.action)} · {new Date(String(h.created_at)).toLocaleString()}</small>)}
              </div>}
            </article>;
          })}
        </div>)}

    {tab === 'missions' && (missions.length === 0
      ? <div className="empty-state">No missions yet. Management creates and assigns missions from the admin panel (#admin).</div>
      : <div className="cg-mission-grid">
          {missions.map((mission) => {
            const assigned = memberMissions.filter((mm) => mm.mission_id === mission.id);
            const completedCount = assigned.filter((mm) => mm.completed_at).length;
            const reqLabel = mission.requirement_type === 'daily_points' ? `${fmt(mission.requirement_value ?? 0)} pts in one day`
              : mission.requirement_type === 'streak' ? `${mission.requirement_value}-day streak`
              : mission.requirement_type === 'total_points' ? `${fmt(mission.requirement_value ?? 0)} total points`
              : mission.requirement_type === 'rank_improvement' ? `Reach clan rank #${mission.requirement_value ?? '—'}`
              : 'Management verified';
            return <article key={mission.id} className={`cg-mission-card ${mission.status !== 'active' ? 'cg-goal-inactive' : ''}`}>
              <div className="cg-goal-top"><span className={`pill ${mission.status === 'active' ? 'pill-blue' : 'pill-gray'}`}>{mission.status}</span><span className="cg-goal-cat">{mission.requirement_type.replace(/_/g, ' ')}</span></div>
              <h3>{mission.title}</h3>
              {mission.description && <p>{mission.description}</p>}
              <div className="cg-mission-req"><Target size={13} /> {reqLabel}</div>
              <div className="cg-goal-meta">
                <span><Check size={12} /> {completedCount}/{assigned.length} completed</span>
                {mission.end_date && <span><Clock size={12} /> ends {new Date(mission.end_date).toLocaleDateString()}</span>}
                {mission.reward_text && <span><Star size={12} /> {mission.reward_text}</span>}
              </div>
              {assigned.length > 0 && <div className="cg-mission-members">
                {assigned.slice(0, 6).map((mm) => <span key={mm.roblox_user_id} className={mm.completed_at ? 'done' : ''}>{mm.username ?? `User ${mm.roblox_user_id}`}</span>)}
                {assigned.length > 6 && <span>+{assigned.length - 6}</span>}
              </div>}
            </article>;
          })}
        </div>)}

    {tab === 'leaderboard' && <div className="cg-leaderboard-grid">
      <div className="glass-card cg-lb-card">
        <div className="card-header"><div><span className="card-label">Most missions completed</span><h3>Completion</h3></div></div>
        {completedByUser.length === 0 ? <div className="empty-state">No mission completions recorded yet.</div> : completedByUser.map(([userId, entry], i) => <div key={userId} className="cg-lb-row">
          <span className="lb-rank">#{i + 1}</span><b>{entry.username ?? `User ${userId}`}</b><span className="cg-lb-value">{entry.count} missions</span>
        </div>)}
      </div>
      <div className="glass-card cg-lb-card">
        <div className="card-header"><div><span className="card-label">Current mission progress</span><h3>Active Progress</h3></div></div>
        {progressByUser.length === 0 ? <div className="empty-state">No active mission progress yet.</div> : progressByUser.map(([userId, entry], i) => <div key={userId} className="cg-lb-row">
          <span className="lb-rank">#{i + 1}</span><b>{entry.username ?? `User ${userId}`}</b><span className="cg-lb-value">{fmt(entry.progress)} pts</span>
        </div>)}
      </div>
      <div className="glass-card cg-lb-card">
        <div className="card-header"><div><span className="card-label">Highest goal contribution</span><h3>Clan Totals</h3></div></div>
        <div className="cg-lb-row"><span className="lb-rank">—</span><b>NANZ battle points</b><span className="cg-lb-value">{scanState?.nanz_battle_points ? fmt(scanState.nanz_battle_points) : '—'}</span></div>
        <div className="cg-lb-row"><span className="lb-rank">—</span><b>Points / hour</b><span className="cg-lb-value">{scanState?.points_per_hour ? fmt(Math.round(scanState.points_per_hour)) : '—'}</span></div>
        <div className="cg-lb-row"><span className="lb-rank">—</span><b>Members</b><span className="cg-lb-value">{fmt(scanState?.member_count ?? 0)}</span></div>
      </div>
    </div>}
  </div>;
}
