import { useEffect, useMemo, useState } from 'react';
import { AvatarMap, supabase } from '@/lib/supabase';
import {
  ArrowLeft, Award, BarChart3, Calendar, Check, ChevronRight, Clock, Crown, Flame,
  Globe2, Medal, Star, Swords, Target, TrendingUp, Trophy, Users, Zap,
} from 'lucide-react';

const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);
const avatarColors = ['#ff375f', '#0a84ff', '#ff9f0a', '#bf5af2', '#64d2ff'];

function PlayerAvatarSmall({ userId, username, avatarUrl, avatars, size }: { userId: number; username: string | null; avatarUrl?: string | null; avatars: AvatarMap; size: number }) {
  const name = username ?? `User ${userId}`;
  const url = avatarUrl ?? avatars[name.toLowerCase()]?.avatar_url ?? null;
  if (url) return <img src={url} alt={name} style={{ width: size, height: size }} className="player-avatar-img" />;
  const color = avatarColors[userId % avatarColors.length];
  return <span className="player-avatar-fallback" style={{ width: size, height: size, fontSize: Math.max(10, Math.floor(size * 0.36)), background: `linear-gradient(145deg, ${color}, #1c1c1e 80%)` }}>{name.slice(0, 2).toUpperCase()}</span>;
}

// ============================================================
// Hall of Fame
// ============================================================

type HofEntry = {
  id: string; entry_type: string; roblox_user_id: number | null; username: string | null;
  title: string; detail: string | null; stat_label: string | null; stat_value: number | null;
  battle_id: string | null; period_label: string | null; coverage_label: string | null; recognition_date: string;
};

const hofSections: { type: string; kicker: string; title: string; accent: string; description: string; icon: JSX.Element }[] = [
  { type: 'all_time_legend', kicker: 'Legends of the clan', title: 'All-Time', accent: 'Legends', description: 'Historically strongest tracked contributors across all recorded battles.', icon: <Crown size={24} /> },
  { type: 'battle_legend', kicker: 'Outstanding performances', title: 'Battle', accent: 'Legends', description: 'Best single-battle performances recorded by the live sync.', icon: <Swords size={24} /> },
  { type: 'top_contributor', kicker: 'Verified records', title: 'Top', accent: 'Contributors', description: 'Highest verified contribution records in tracked history.', icon: <Trophy size={24} /> },
  { type: 'most_consistent', kicker: 'Relentless activity', title: 'Most', accent: 'Consistent', description: 'Members with the strongest documented daily activity history.', icon: <Flame size={24} /> },
  { type: 'special_recognition', kicker: 'Management honors', title: 'Special', accent: 'Recognition', description: 'Honorary distinctions awarded by NANZ management.', icon: <Award size={24} /> },
];

export function HallOfFame({ avatars, onOpenProfile }: { avatars: AvatarMap; onOpenProfile: (username: string, userId: number) => void }) {
  const [computed, setComputed] = useState<HofEntry[]>([]);
  const [manual, setManual] = useState<HofEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [coverage, setCoverage] = useState<{ days: number; from: string | null; to: string | null } | null>(null);

  useEffect(() => {
    (async () => {
      // All-time tracked contribution from member rankings history
      const { data: memberRows } = await supabase.from('nanz_battle_member_rankings').select('user_id, username, battle_points, battle_id, captured_at').order('battle_points', { ascending: false }).limit(500);
      const rows = (memberRows ?? []) as { user_id: number; username: string | null; battle_points: number; battle_id: string; captured_at: string }[];
      const byUser = new Map<number, { username: string | null; total: number; bestBattle: number; battles: Set<string>; first: string | null; last: string | null }>();
      for (const row of rows) {
        const entry = byUser.get(row.user_id) ?? { username: row.username, total: 0, bestBattle: 0, battles: new Set<string>(), first: row.captured_at, last: row.captured_at };
        entry.total += row.battle_points;
        if (row.battle_points > entry.bestBattle) entry.bestBattle = row.battle_points;
        entry.battles.add(row.battle_id);
        if (row.captured_at < (entry.first ?? row.captured_at)) entry.first = row.captured_at;
        if (row.captured_at > (entry.last ?? row.captured_at)) entry.last = row.captured_at;
        byUser.set(row.user_id, entry);
      }
      const all = [...byUser.entries()].sort((a, b) => b[1].total - a[1].total);
      const top = all.slice(0, 5);
      const dayMap = new Map<string, { user_id: number; username: string | null; gain: number }>();
      const { data: dailyRows } = await supabase.from('nanz_daily_member_snapshots').select('user_id, username, battle_points, snapshot_date').order('user_id, snapshot_date', { ascending: true });
      const daily = (dailyRows ?? []) as { user_id: number; username: string | null; battle_points: number; snapshot_date: string }[];
      const perUserDaily = new Map<number, { username: string | null; points: { date: string; points: number }[] }>();
      for (const d of daily) {
        const e = perUserDaily.get(d.user_id) ?? { username: d.username, points: [] };
        e.points.push({ date: d.snapshot_date, points: d.battle_points });
        perUserDaily.set(d.user_id, e);
      }
      let bestDayGain = 0; let bestDayUser = 0; let bestDayName: string | null = null;
      for (const [userId, e] of perUserDaily) {
        for (let i = 1; i < e.points.length; i++) {
          const gain = e.points[i].points - e.points[i - 1].points;
          if (gain > bestDayGain) { bestDayGain = gain; bestDayUser = userId; bestDayName = e.username; }
        }
      }
      // Consistency: contributing days ratio
      let bestConsistencyScore = -1; let bestConsistencyUser = 0; let bestConsistencyName: string | null = null; let bestConsistencyRatio = 0;
      for (const [userId, e] of perUserDaily) {
        if (e.points.length < 3) continue;
        const active = e.points.filter((p) => p.points > 0).length;
        const ratio = active / e.points.length;
        if (ratio > bestConsistencyScore) { bestConsistencyScore = ratio; bestConsistencyUser = userId; bestConsistencyName = e.username; bestConsistencyRatio = ratio; }
      }
      const coverageDays = daily.length ? new Set(daily.map((d) => d.snapshot_date)).size : 0;
      const dates = daily.map((d) => d.snapshot_date).sort();
      setCoverage({ days: coverageDays, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null });

      const computedEntries: HofEntry[] = [];
      top.forEach(([userId, e], i) => computedEntries.push({
        id: `atl-${userId}`, entry_type: 'all_time_legend', roblox_user_id: userId, username: e.username,
        title: `#${i + 1} All-Time Tracked Contributor`, detail: `${fmt(e.total)} battle points across ${e.battles.size} tracked battle${e.battles.size > 1 ? 's' : ''}`,
        stat_label: 'All-time tracked points', stat_value: e.total, battle_id: null, period_label: `Tracked since ${e.first ? new Date(e.first).toLocaleDateString() : 'start'}`,
        coverage_label: `Tracking coverage: ${coverageDays} day${coverageDays === 1 ? '' : 's'} of recorded snapshots — all-time totals reflect recorded history only.`,
        recognition_date: new Date().toISOString().slice(0, 10),
      }));
      if (bestDayGain > 0) computedEntries.push({
        id: `bd-${bestDayUser}`, entry_type: 'battle_legend', roblox_user_id: bestDayUser, username: bestDayName,
        title: 'Best Single-Day Surge', detail: `Gained ${fmt(bestDayGain)} points in a single day`,
        stat_label: 'Best daily gain', stat_value: bestDayGain, battle_id: null, period_label: 'Daily record',
        coverage_label: 'Calculated from recorded daily snapshots only.',
        recognition_date: new Date().toISOString().slice(0, 10),
      });
      if (top[0]) computedEntries.push({
        id: `tc-${top[0][0]}`, entry_type: 'top_contributor', roblox_user_id: top[0][0], username: top[0][1].username,
        title: 'Highest Verified Contribution', detail: `${fmt(top[0][1].bestBattle)} points in the strongest tracked battle`,
        stat_label: 'Best single-battle total', stat_value: top[0][1].bestBattle, battle_id: null, period_label: 'Battle record',
        coverage_label: 'Highest recorded single-battle contribution.',
        recognition_date: new Date().toISOString().slice(0, 10),
      });
      if (bestConsistencyUser > 0) computedEntries.push({
        id: `mc-${bestConsistencyUser}`, entry_type: 'most_consistent', roblox_user_id: bestConsistencyUser, username: bestConsistencyName,
        title: 'Most Consistent Contributor', detail: `Active on ${Math.round(bestConsistencyRatio * 100)}% of recorded days`,
        stat_label: 'Consistency rate', stat_value: Math.round(bestConsistencyRatio * 100), battle_id: null, period_label: `${coverageDays} tracked days`,
        coverage_label: 'Based on daily snapshot history only — not a lifetime claim.',
        recognition_date: new Date().toISOString().slice(0, 10),
      });
      setComputed(computedEntries);
      void bestDayUser;

      const { data: manualRows } = await supabase.from('nanz_hall_of_fame').select('*').order('recognition_date', { ascending: false });
      setManual((manualRows ?? []) as HofEntry[]);
      setLoading(false);
    })();
  }, []);

  const renderEntry = (entry: HofEntry, index: number) => <div key={entry.id} className="hof-card" onClick={() => entry.roblox_user_id && entry.username && onOpenProfile(entry.username, entry.roblox_user_id)}>
    <div className="hof-card-glow" />
    <div className="hof-rank">{index === 0 ? <Crown size={22} /> : <Medal size={20} />}</div>
    <div className="hof-avatar"><PlayerAvatarSmall userId={entry.roblox_user_id ?? 0} username={entry.username} avatars={avatars} size={64} /></div>
    <b className="hof-name">{entry.username ?? 'NANZ Member'}</b>
    <span className="hof-title">{entry.title}</span>
    {entry.detail && <small className="hof-detail">{entry.detail}</small>}
    {entry.stat_value !== null && <strong className="hof-stat">{fmt(entry.stat_value)}<small> {entry.stat_label ?? ''}</small></strong>}
    <span className="hof-coverage">{entry.coverage_label}</span>
    <small className="hof-date">{entry.period_label ?? entry.recognition_date}</small>
  </div>;

  return <div className="page-inner">
    <div className="hof-hero">
      <div className="hof-hero-glow" />
      <span className="kicker">NANZ Elite · Circle of Honor</span>
      <h1>Hall of <span className="accent-text">Fame</span></h1>
      <p>The greatest contributors in tracked NANZ history. Every statistic is computed from verified battle data and clearly labeled with its coverage period — no fabricated records.</p>
      {coverage && coverage.from && <div className="hof-coverage-banner"><Calendar size={14} /> Recorded history: {coverage.days} day{coverage.days === 1 ? '' : 's'} of snapshots ({new Date(coverage.from).toLocaleDateString()} – {new Date(coverage.to ?? coverage.from).toLocaleDateString()})</div>}
    </div>

    {loading ? <div className="empty-state">Computing hall of fame from tracked data...</div> : hofSections.map((section) => {
      const entries = [...computed.filter((e) => e.entry_type === section.type), ...manual.filter((e) => e.entry_type === section.type)];
      if (entries.length === 0) return <div key={section.type} className="hof-section">
        <div className="section-header"><div><span className="kicker">{section.kicker}</span><h2>{section.title} <span className="accent-text">{section.accent}</span></h2></div></div>
        <div className="empty-state">No entries in this category yet — data will appear as tracked history accumulates{section.type === 'special_recognition' ? ', or when management awards honorary recognition' : ''}.</div>
      </div>;
      return <div key={section.type} className="hof-section">
        <div className="section-header"><div><span className="kicker">{section.kicker}</span><h2>{section.title} <span className="accent-text">{section.accent}</span></h2></div><span className="trailing-label">{section.description}</span></div>
        <div className={`hof-grid ${section.type === 'all_time_legend' ? 'hof-grid-hero' : ''}`}>{entries.map((e, i) => renderEntry(e, section.type === 'all_time_legend' ? i : 0))}</div>
      </div>;
    })}
  </div>;
}

// ============================================================
// Battle Archive
// ============================================================

type ArchiveRow = {
  id: string; battle_id: string; battle_name: string; start_time: string | null; finish_time: string | null;
  nanz_final_points: number | null; nanz_final_rank: number | null; nanz_official_place: number | null;
  total_contributors: number | null; archive_status: string; coverage_note: string | null;
  member_count: number | null; avg_contribution: number | null; top_contribution: number | null; top_contributor_name: string | null;
  archived_at: string;
};

type ArchiveMember = { archive_id: string; user_id: number; username: string | null; display_name: string | null; battle_points: number; rank: number | null };

export function BattleArchive({ avatars, onOpenProfile }: { avatars: AvatarMap; onOpenProfile: (username: string, userId: number) => void }) {
  const [archives, setArchives] = useState<ArchiveRow[]>([]);
  const [selected, setSelected] = useState<ArchiveRow | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await supabase.from('nanz_battle_archive').select('*').order('archived_at', { ascending: false });
    setArchives((data ?? []) as ArchiveRow[]);
    setLoading(false);
  };
  useEffect(() => { void load(); const t = window.setInterval(load, 60_000); return () => window.clearInterval(t); }, []);

  if (selected) return <BattleReport archive={selected} avatars={avatars} onBack={() => setSelected(null)} onOpenProfile={onOpenProfile} />;

  return <div className="page-inner">
    <div className="pu-header-row">
      <div><span className="kicker">Never lost. Never rewritten.</span><h2>Battle <span className="accent-text">Archive</span></h2></div>
      <span className="pill pill-gray">{archives.length} battle{archives.length === 1 ? '' : 's'} recorded</span>
    </div>
    {loading ? <div className="empty-state">Loading archive...</div> : <>
      {archives.length >= 2 && <div className="ba-compare-bar">
        <span className="card-label">Select two battles to compare</span>
        <div className="ba-compare-chips">
          {archives.slice(0, 6).map((a) => <button key={a.id} className={`btn-pill ${compareIds.includes(a.id) ? 'active' : ''}`} onClick={() => setCompareIds((ids) => ids.includes(a.id) ? ids.filter((i) => i !== a.id) : [...ids.slice(-1), a.id])}>{a.battle_name}</button>)}
        </div>
        {compareIds.length === 2 && <BattleCompare archives={archives.filter((a) => compareIds.includes(a.id))} />}
      </div>}
      <div className="ba-grid">
        {archives.map((archive) => <button key={archive.id} className={`ba-card ${archive.archive_status === 'complete' ? 'ba-complete' : 'ba-partial'}`} onClick={() => setSelected(archive)}>
          <div className="ba-card-top">
            <span className={`pill ${archive.archive_status === 'complete' ? 'pill-blue' : 'pill-gray'}`}>{archive.archive_status === 'complete' ? 'Complete archive' : 'Partial archive'}</span>
            <small>{archive.start_time ? new Date(archive.start_time).toLocaleDateString() : '—'} → {archive.finish_time ? new Date(archive.finish_time).toLocaleDateString() : 'in progress'}</small>
          </div>
          <h3>{archive.battle_name}</h3>
          <div className="ba-card-stats">
            <div><span>Final points</span><b>{archive.nanz_final_points !== null ? fmt(archive.nanz_final_points) : '—'}</b></div>
            <div><span>Global place</span><b>{archive.nanz_official_place ? `#${archive.nanz_official_place}` : '—'}</b></div>
            <div><span>Contributors</span><b>{archive.total_contributors ?? '—'}</b></div>
            <div><span>Top member</span><b>{archive.top_contributor_name ?? '—'}</b></div>
          </div>
          <div className="ba-coverage"><Check size={12} /> {archive.coverage_note ?? 'Coverage information pending'}</div>
        </button>)}
      </div>
    </>}
  </div>;
}

function BattleReport({ archive, avatars, onBack, onOpenProfile }: { archive: ArchiveRow; avatars: AvatarMap; onBack: () => void; onOpenProfile: (username: string, userId: number) => void }) {
  const [members, setMembers] = useState<ArchiveMember[]>([]);
  const [awardWinners, setAwardWinners] = useState<Record<string, unknown>[]>([]);
  const [snapshots, setSnapshots] = useState<{ battle_points: number; captured_at: string }[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: memberRows }, { data: awardRows }, { data: snapRows }] = await Promise.all([
        supabase.from('nanz_battle_archive_members').select('archive_id, user_id, username, display_name, battle_points, rank').eq('archive_id', archive.id).order('battle_points', { ascending: false }),
        supabase.from('nanz_award_winners').select('*, award:nanz_award_definitions(name, icon), member:nanz_members(roblox_username)').eq('battle_id', archive.battle_id),
        supabase.from('nanz_battle_point_snapshots').select('battle_points, captured_at').eq('battle_id', archive.battle_id).eq('clan_name', 'NANZ').order('captured_at', { ascending: true }).limit(400),
      ]);
      setMembers((memberRows ?? []) as ArchiveMember[]);
      setAwardWinners(awardRows ?? []);
      setSnapshots((snapRows ?? []) as { battle_points: number; captured_at: string }[]);
    })();
  }, [archive.id]);

  const hours = archive.start_time && archive.finish_time ? Math.max(1, Math.round((new Date(archive.finish_time).getTime() - new Date(archive.start_time).getTime()) / 3_600_000)) : null;
  const pps = hours && archive.nanz_final_points ? Math.round(archive.nanz_final_points / hours) : null;

  return <div className="page-inner">
    <button className="text-link" onClick={onBack}><ArrowLeft size={16} /> Back to Battle Archive</button>
    <div className="ba-report-hero">
      <div>
        <span className={`pill ${archive.archive_status === 'complete' ? 'pill-blue' : 'pill-gray'}`}>{archive.archive_status === 'complete' ? 'Complete archive' : 'Partial archive'}</span>
        <h1>{archive.battle_name}</h1>
        <p>Battle ID {archive.battle_id} · {archive.start_time ? new Date(archive.start_time).toLocaleString() : 'unknown start'} → {archive.finish_time ? new Date(archive.finish_time).toLocaleString() : 'finish not recorded'}</p>
      </div>
      <div className="ba-report-final">
        <div><span>Final points</span><b>{archive.nanz_final_points !== null ? fmt(archive.nanz_final_points) : 'Not recorded'}</b></div>
        <div><span>Final place</span><b>{archive.nanz_official_place ? `#${archive.nanz_official_place}` : 'Not verified'}</b></div>
      </div>
    </div>
    <div className="ba-coverage-note"><Check size={15} /> {archive.coverage_note ?? 'Coverage unknown'}</div>

    <div className="pu-stats-grid">
      <div className="pu-stat-tile"><div className="pu-stat-icon"><Swords size={20} /></div><span className="pu-stat-label">Total Points</span><strong className="pu-stat-value">{archive.nanz_final_points !== null ? fmt(archive.nanz_final_points) : '—'}</strong><small className="pu-stat-meta">{archive.nanz_final_points !== null ? 'Archived result' : 'No final snapshot'}</small></div>
      <div className="pu-stat-tile"><div className="pu-stat-icon"><Globe2 size={20} /></div><span className="pu-stat-label">Global Rank</span><strong className="pu-stat-value">{archive.nanz_official_place ? `#${archive.nanz_official_place}` : '—'}</strong><small className="pu-stat-meta">Official API place</small></div>
      <div className="pu-stat-tile"><div className="pu-stat-icon"><Users size={20} /></div><span className="pu-stat-label">Contributors</span><strong className="pu-stat-value">{archive.total_contributors ?? members.length}</strong><small className="pu-stat-meta">{archive.member_count ?? members.length} members</small></div>
      <div className="pu-stat-tile"><div className="pu-stat-icon"><BarChart3 size={20} /></div><span className="pu-stat-label">Avg Contribution</span><strong className="pu-stat-value">{archive.avg_contribution ? fmt(archive.avg_contribution) : '—'}</strong><small className="pu-stat-meta">Per tracked member</small></div>
      <div className="pu-stat-tile"><div className="pu-stat-icon"><Trophy size={20} /></div><span className="pu-stat-label">Top Contributor</span><strong className="pu-stat-value">{archive.top_contributor_name ?? '—'}</strong><small className="pu-stat-meta">{archive.top_contribution ? `${fmt(archive.top_contribution)} points` : ''}</small></div>
      <div className="pu-stat-tile"><div className="pu-stat-icon"><Clock size={20} /></div><span className="pu-stat-label">Points / Hour</span><strong className="pu-stat-value">{pps ? fmt(pps) : '—'}</strong><small className="pu-stat-meta">{hours ? `${hours}h battle window` : 'Needs both timestamps'}</small></div>
    </div>

    {snapshots.length >= 2 && <div className="glass-card pu-chart-card">
      <div className="card-header"><div><span className="card-label">Performance timeline</span><h3>Points Development</h3></div><span className="pill pill-gray">{snapshots.length} snapshots</span></div>
      <div className="pu-chart-wrap"><BattleTimelineChart snapshots={snapshots} /></div>
    </div>}

    {awardWinners.length > 0 && <div className="glass-card pu-awards-card">
      <div className="card-header"><div><span className="card-label">Recognition</span><h3>Award Winners</h3></div></div>
      <div className="pu-awards-list">{awardWinners.map((w) => {
        const award = w.award as Record<string, unknown> | null;
        const member = w.member as Record<string, unknown> | null;
        return <div key={String(w.id)} className="pu-award-item"><span className="pu-award-icon"><Trophy size={18} /></span><div><b>{String(award?.name ?? 'Award')}</b><small>{member ? String((member as { roblox_username?: string }).roblox_username ?? '') : ''}</small></div><span className="pu-award-date">{new Date(String(w.awarded_at)).toLocaleDateString()}</span></div>;
      })}</div>
    </div>}

    <div className="pu-history-section">
      <span className="card-label">Final member leaderboard</span>
      <h3>Contribution Results</h3>
      {members.length === 0 ? <div className="empty-state">No member results preserved for this battle.</div> : <div className="pu-history-table">
        <div className="pu-history-header"><span>Rank</span><span>Member</span><span>Battle Points</span></div>
        {members.slice(0, 50).map((m, i) => <div key={`${m.user_id}-${i}`} className="pu-history-row">
          <span>#{m.rank ?? i + 1}</span>
          <span className="ba-member-cell"><PlayerAvatarSmall userId={m.user_id} username={m.username} avatars={avatars} size={24} /> <b>{m.username ?? `User ${m.user_id}`}</b></span>
          <span>{fmt(m.battle_points)}</span>
        </div>)}
      </div>}
      {members.length > 50 && <p className="ba-table-note">Showing top 50 of {members.length} tracked contributors.</p>}
      <button className="text-link" onClick={() => { const top = members[0]; if (top?.username) onOpenProfile(top.username, top.user_id); }}>Open top contributor profile <ChevronRight size={14} /></button>
    </div>
  </div>;
}

function BattleTimelineChart({ snapshots }: { snapshots: { battle_points: number; captured_at: string }[] }) {
  const width = 680; const height = 190;
  const min = Math.min(...snapshots.map((s) => s.battle_points));
  const max = Math.max(...snapshots.map((s) => s.battle_points));
  const points = snapshots.map((s, i) => `${(i / (snapshots.length - 1)) * width},${height - ((s.battle_points - min) / Math.max(1, max - min)) * (height - 20) - 10}`).join(' ');
  return <><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Archived points development"><polyline points={points} fill="none" stroke="var(--gold)" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg>
    <div className="chart-tooltip-row"><span>{new Date(snapshots[0].captured_at).toLocaleString()}</span><strong>{fmt(snapshots[snapshots.length - 1].battle_points)} points</strong><span>{snapshots.length} snapshots preserved</span></div></>;
}

function BattleCompare({ archives }: { archives: ArchiveRow[] }) {
  if (archives.length !== 2) return null;
  const [a, b] = archives;
  const rows: { label: string; aVal: string; bVal: string; aNum: number | null; bNum: number | null; higherBetter: boolean }[] = [
    { label: 'Total points', aVal: a.nanz_final_points !== null ? fmt(a.nanz_final_points) : '—', bVal: b.nanz_final_points !== null ? fmt(b.nanz_final_points) : '—', aNum: a.nanz_final_points, bNum: b.nanz_final_points, higherBetter: true },
    { label: 'Final place (lower is better)', aVal: a.nanz_official_place ? `#${a.nanz_official_place}` : '—', bVal: b.nanz_official_place ? `#${b.nanz_official_place}` : '—', aNum: a.nanz_official_place, bNum: b.nanz_official_place, higherBetter: false },
    { label: 'Active contributors', aVal: String(a.total_contributors ?? '—'), bVal: String(b.total_contributors ?? '—'), aNum: a.total_contributors, bNum: b.total_contributors, higherBetter: true },
    { label: 'Avg contribution', aVal: a.avg_contribution ? fmt(a.avg_contribution) : '—', bVal: b.avg_contribution ? fmt(b.avg_contribution) : '—', aNum: a.avg_contribution, bNum: b.avg_contribution, higherBetter: true },
    { label: 'Top contributor', aVal: a.top_contribution ? fmt(a.top_contribution) : '—', bVal: b.top_contribution ? fmt(b.top_contribution) : '—', aNum: a.top_contribution, bNum: b.top_contribution, higherBetter: true },
  ];
  return <div className="glass-card pu-compare-table ba-compare-table">
    <div className="pu-compare-header"><span className="pu-compare-name">{a.battle_name}</span><span className="pu-compare-divider" /><span className="pu-compare-name">{b.battle_name}</span></div>
    {rows.map((row) => {
      const aWins = row.aNum !== null && row.bNum !== null && (row.higherBetter ? row.aNum > row.bNum : row.aNum < row.bNum);
      const bWins = row.aNum !== null && row.bNum !== null && (row.higherBetter ? row.bNum > row.aNum : row.bNum < row.aNum);
      return <div key={row.label} className="pu-compare-row">
        <span className={`pu-compare-val ${aWins ? 'winner' : ''}`}>{row.aVal}</span>
        <span className="pu-compare-label">{row.label}</span>
        <span className={`pu-compare-val ${bWins ? 'winner' : ''}`}>{row.bVal}</span>
      </div>;
    })}
  </div>;
}
