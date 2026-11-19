import { useEffect, useMemo, useState } from 'react';
import { AvatarMap, DailyMemberSnapshot, supabase } from '@/lib/supabase';
import {
  ArrowLeft, ArrowRight, BarChart3, Calendar, ChevronRight, Crosshair, Crown,
  Diamond, Flame, Gem, Globe2, Medal, Search, Shield, Star, Swords, Target,
  TrendingUp, Trophy, Users, Zap,
} from 'lucide-react';

export type PlayerEntry = {
  roblox_user_id: number;
  username: string | null;
  display_name: string | null;
  battle_points: number;
  rank: number | null;
  avatar_url: string | null;
  achievement_count: number;
  reputation: number;
  reputation_level: string;
  is_active: boolean;
};

const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);
const avatarColors = ['#ff375f', '#0a84ff', '#ff9f0a', '#bf5af2', '#64d2ff'];

function playerInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function PlayerAvatar({ entry, avatars, size }: { entry: { username: string | null; roblox_user_id: number; avatar_url?: string | null }; avatars: AvatarMap; size: number }) {
  const name = entry.username ?? `Roblox user ${entry.roblox_user_id}`;
  const avatarUrl = entry.avatar_url ?? avatars[name.toLowerCase()]?.avatar_url ?? null;
  const fontSize = Math.max(10, Math.floor(size * 0.36));
  if (avatarUrl) return <img src={avatarUrl} alt={name} style={{ width: size, height: size }} className="player-avatar-img" />;
  const color = avatarColors[entry.roblox_user_id % avatarColors.length];
  return <span className="player-avatar-fallback" style={{ width: size, height: size, fontSize, background: `linear-gradient(145deg, ${color}, #1c1c1e 80%)` }}>{playerInitials(name)}</span>;
}

const tierColors: Record<string, string> = {
  common: '#8e8e93', rare: '#0a84ff', epic: '#bf5af2', legendary: '#ffd60a', mythic: '#ff375f',
};

const categoryLabels: Record<string, string> = {
  battle: 'Battle Performance', consistency: 'Consistency', contribution: 'Contribution', community: 'Community', special: 'Special',
};

export function PlayerUniverse({ avatars, onNavigate, deepLink }: { avatars: AvatarMap; onNavigate: (section: string) => void; deepLink?: string | null }) {
  const [view, setView] = useState<'directory' | 'profile' | 'compare' | 'achievements' | 'awards'>('directory');
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerEntry | null>(null);

  useEffect(() => {
    if (!deepLink) return;
    const match = deepLink.match(/^players\/([^:]+):(\d+)$/);
    if (!match) return;
    const [, username, userId] = match;
    setSelectedPlayer({
      roblox_user_id: Number(userId),
      username,
      display_name: null,
      battle_points: 0,
      rank: null,
      avatar_url: avatars[username.toLowerCase()]?.avatar_url ?? null,
      achievement_count: 0,
      reputation: 0,
      reputation_level: '',
      is_active: true,
    });
    setView('profile');
  }, [deepLink, avatars]);

  if (view === 'profile' && selectedPlayer) {
    return <PlayerProfile entry={selectedPlayer} avatars={avatars} onBack={() => setView('directory')} onNavigate={onNavigate} />;
  }
  if (view === 'compare') {
    return <PlayerCompare avatars={avatars} onBack={() => setView('directory')} onOpenProfile={(entry) => { setSelectedPlayer(entry); setView('profile'); }} />;
  }
  if (view === 'achievements') {
    return <AchievementGallery avatars={avatars} onBack={() => setView('directory')} onOpenProfile={(entry) => { setSelectedPlayer(entry); setView('profile'); }} />;
  }
  if (view === 'awards') {
    return <AwardsGallery avatars={avatars} onBack={() => setView('directory')} onOpenProfile={(entry) => { setSelectedPlayer(entry); setView('profile'); }} />;
  }
  return <PlayerDirectory avatars={avatars} onOpenProfile={(entry) => { setSelectedPlayer(entry); setView('profile'); }} onCompare={() => setView('compare')} onAchievements={() => setView('achievements')} onAwards={() => setView('awards')} />;
}

// ============================================================================
// Player Directory
// ============================================================================

function PlayerDirectory({ avatars, onOpenProfile, onCompare, onAchievements, onAwards }: {
  avatars: AvatarMap;
  onOpenProfile: (entry: PlayerEntry) => void;
  onCompare: () => void;
  onAchievements: () => void;
  onAwards: () => void;
}) {
  const [players, setPlayers] = useState<PlayerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'points' | 'reputation' | 'achievements'>('points');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const pageSize = 12;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: state } = await supabase.from('nanz_battle_scan_state').select('battle_id').eq('id', true).maybeSingle();
      const battleId = state?.battle_id as string | undefined;
      if (!battleId) { setLoading(false); return; }
      const { data: memberRows } = await supabase.from('nanz_battle_member_rankings').select('user_id, username, display_name, battle_points, rank').eq('battle_id', battleId).order('battle_points', { ascending: false });
      const { data: memberProfiles } = await supabase.from('nanz_members').select('roblox_user_id, clan_role, clan_status, avatar_url');
      const { data: repTotals } = await supabase.from('nanz_member_reputation_totals').select('roblox_user_id, total_reputation, reputation_level');
      const { data: achCounts } = await supabase.from('nanz_member_achievements').select('member_id');

      const profileMap = new Map((memberProfiles ?? []).map((m: Record<string, unknown>) => [Number(m.roblox_user_id), m]));
      const repMap = new Map((repTotals ?? []).map((r: Record<string, unknown>) => [Number(r.roblox_user_id), r]));
      const memberIds = new Set((achCounts ?? []).map((a: Record<string, unknown>) => String(a.member_id)));

      const entries: PlayerEntry[] = (memberRows ?? []).map((row: Record<string, unknown>) => {
        const uid = Number(row.user_id);
        const profile = profileMap.get(uid) as Record<string, unknown> | undefined;
        const rep = repMap.get(uid) as Record<string, unknown> | undefined;
        return {
          roblox_user_id: uid,
          username: row.username as string | null,
          display_name: row.display_name as string | null,
          battle_points: Number(row.battle_points),
          rank: row.rank as number | null,
          avatar_url: (profile?.avatar_url as string | null) ?? avatars[(row.username as string ?? '').toLowerCase()]?.avatar_url ?? null,
          achievement_count: 0,
          reputation: rep ? Number(rep.total_reputation) : 0,
          reputation_level: rep ? String(rep.reputation_level) : 'Rookie',
          is_active: Number(row.battle_points) > 0,
        };
      });
      setPlayers(entries);
      setLoading(false);
    })();
  }, [avatars]);

  const filtered = useMemo(() => {
    let list = players;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => (p.username ?? '').toLowerCase().includes(q) || String(p.roblox_user_id).includes(q));
    }
    if (roleFilter !== 'all') {
      list = list.filter((p) => roleFilter === 'active' ? p.is_active : !p.is_active);
    }
    list = [...list].sort((a, b) => {
      if (sortBy === 'points') return b.battle_points - a.battle_points;
      if (sortBy === 'reputation') return b.reputation - a.reputation;
      return b.achievement_count - a.achievement_count;
    });
    return list;
  }, [players, search, sortBy, roleFilter]);

  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(filtered.length / pageSize);

  return <div className="page-inner">
    <div className="pu-header-row">
      <div>
        <span className="kicker">Explore every member</span>
        <h2>Player <span className="accent-text">Universe</span></h2>
      </div>
      <div className="pu-nav-buttons">
        <button className="btn-pill" onClick={onCompare}><Crosshair size={15} /> Compare</button>
        <button className="btn-pill" onClick={onAchievements}><Medal size={15} /> Achievements</button>
        <button className="btn-pill" onClick={onAwards}><Trophy size={15} /> Awards</button>
      </div>
    </div>

    <div className="pu-controls">
      <div className="search-box"><Search size={17} /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search username or Roblox ID..." /></div>
      <div className="pu-filter-group">
        <button className={`btn-pill ${sortBy === 'points' ? 'active' : ''}`} onClick={() => setSortBy('points')}>Battle Points</button>
        <button className={`btn-pill ${sortBy === 'reputation' ? 'active' : ''}`} onClick={() => setSortBy('reputation')}>Reputation</button>
        <button className={`btn-pill ${sortBy === 'achievements' ? 'active' : ''}`} onClick={() => setSortBy('achievements')}>Achievements</button>
      </div>
      <div className="pu-filter-group">
        <button className={`btn-pill ${roleFilter === 'all' ? 'active' : ''}`} onClick={() => { setRoleFilter('all'); setPage(0); }}>All</button>
        <button className={`btn-pill ${roleFilter === 'active' ? 'active' : ''}`} onClick={() => { setRoleFilter('active'); setPage(0); }}>Active</button>
        <button className={`btn-pill ${roleFilter === 'inactive' ? 'active' : ''}`} onClick={() => { setRoleFilter('inactive'); setPage(0); }}>Roster</button>
      </div>
    </div>

    {loading ? <div className="empty-state">Loading members...</div> : paged.length === 0 ? <div className="empty-state">No members found matching your filters.</div> : <>
      <div className="pu-player-grid">
        {paged.map((player) => <button key={player.roblox_user_id} className="pu-player-card" onClick={() => onOpenProfile(player)}>
          <div className="pu-player-avatar"><PlayerAvatar entry={player} avatars={avatars} size={56} /></div>
          <div className="pu-player-info"><b>{player.username ?? `Roblox user ${player.roblox_user_id}`}</b><small>{player.display_name ?? player.username}</small></div>
          <div className="pu-player-stats">
            <span><Swords size={13} /> {fmt(player.battle_points)}</span>
            <span><Star size={13} /> {player.reputation_level}</span>
          </div>
          <div className="pu-player-rank">#{player.rank ?? '—'}</div>
        </button>)}
      </div>
      {totalPages > 1 && <div className="pu-pagination">
        <button className="btn-pill" disabled={page === 0} onClick={() => setPage(page - 1)}><ArrowLeft size={14} /> Prev</button>
        <span>Page {page + 1} of {totalPages}</span>
        <button className="btn-pill" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next <ArrowRight size={14} /></button>
      </div>}
    </>}
  </div>;
}

// ============================================================================
// Player Profile
// ============================================================================

function PlayerProfile({ entry, avatars, onBack, onNavigate }: {
  entry: PlayerEntry;
  avatars: AvatarMap;
  onBack: () => void;
  onNavigate: (section: string) => void;
}) {
  const [dailySnapshots, setDailySnapshots] = useState<DailyMemberSnapshot[]>([]);
  const [achievements, setAchievements] = useState<Record<string, unknown>[]>([]);
  const [awards, setAwards] = useState<Record<string, unknown>[]>([]);
  const [allAchievementDefs, setAllAchievementDefs] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const name = entry.username ?? `Roblox user ${entry.roblox_user_id}`;

  useEffect(() => {
    (async () => {
      const { data: state } = await supabase.from('nanz_battle_scan_state').select('battle_id').eq('id', true).maybeSingle();
      const battleId = state?.battle_id as string | undefined;
      const { data: memberRecord } = await supabase.from('nanz_members').select('id, joined_clan_at').eq('roblox_user_id', entry.roblox_user_id).maybeSingle();
      const memberId = memberRecord?.id as string | undefined;
      if (battleId) {
        const { data: snaps } = await supabase.from('nanz_daily_member_snapshots').select('battle_id, user_id, username, battle_points, snapshot_date, captured_at').eq('battle_id', battleId).eq('user_id', entry.roblox_user_id).order('snapshot_date', { ascending: true });
        setDailySnapshots((snaps ?? []) as DailyMemberSnapshot[]);
      }
      const { data: defs } = await supabase.from('nanz_achievement_definitions').select('*').eq('is_active', true).order('category, reputation_points', { ascending: true });
      setAllAchievementDefs(defs ?? []);
      if (memberId) {
        const { data: achs } = await supabase.from('nanz_member_achievements').select('*, achievement:nanz_achievement_definitions(*)').eq('member_id', memberId).order('awarded_at', { ascending: false });
        setAchievements(achs ?? []);
        const { data: wins } = await supabase.from('nanz_award_winners').select('*, award:nanz_award_definitions(*)').eq('member_id', memberId).order('awarded_at', { ascending: false });
        setAwards(wins ?? []);
      }
      setLoading(false);
    })();
  }, [entry.roblox_user_id]);

  const earnedSlugs = new Set(achievements.map((a) => (a.achievement as Record<string, unknown>)?.slug as string));
  const dailyContributions = dailySnapshots.length >= 2 ? dailySnapshots.map((s, i) => i === 0 ? 0 : s.battle_points - dailySnapshots[i - 1].battle_points).filter((d) => d > 0) : [];
  const avgDaily = dailyContributions.length > 0 ? Math.round(dailyContributions.reduce((a, b) => a + b, 0) / dailyContributions.length) : null;
  const bestDaily = dailyContributions.length > 0 ? Math.max(...dailyContributions) : null;
  const streak = (() => { let s = 0; for (let i = dailySnapshots.length - 1; i >= 0; i--) { if (dailySnapshots[i].battle_points > 0) s++; else break; } return s; })();

  return <div className="page-inner">
    <button className="text-link" onClick={onBack}><ArrowLeft size={16} /> Back to Player Universe</button>

    <div className="pu-profile-header">
      <div className="pu-profile-avatar-large"><PlayerAvatar entry={entry} avatars={avatars} size={120} /></div>
      <div className="pu-profile-meta">
        <span className="kicker">NANZ Member</span>
        <h1>{name}</h1>
        <p>{entry.display_name ?? entry.username} · {entry.is_active ? 'Active contributor' : 'Roster member'}</p>
        <div className="pu-profile-badges">
          <span className="pill pill-pink">#{entry.rank ?? '—'} Clan Rank</span>
          <span className="pill pill-gold">{entry.reputation_level}</span>
          <span className="pill pill-blue">{entry.reputation} REP</span>
          <a className="pu-roblox-link" href={`https://www.roblox.com/users/${entry.roblox_user_id}/profile`} target="_blank" rel="noopener noreferrer"><Globe2 size={13} /> Roblox Profile</a>
        </div>
      </div>
    </div>

    <div className="pu-stats-grid">
      <StatTile icon={<Swords size={20} />} label="Battle Points" value={fmt(entry.battle_points)} meta="Current battle" />
      <StatTile icon={<TrendingUp size={20} />} label="Clan Rank" value={`#${entry.rank ?? '—'}`} meta="Current contribution" />
      <StatTile icon={<Flame size={20} />} label="Day Streak" value={String(streak)} meta={streak > 0 ? 'Consecutive active days' : 'No streak yet'} />
      <StatTile icon={<BarChart3 size={20} />} label="Avg Daily" value={avgDaily !== null ? fmt(avgDaily) : '—'} meta="Daily contribution average" />
      <StatTile icon={<Zap size={20} />} label="Best Day" value={bestDaily !== null ? fmt(bestDaily) : '—'} meta="Highest single-day gain" />
      <StatTile icon={<Star size={20} />} label="Reputation" value={String(entry.reputation)} meta={entry.reputation_level} />
    </div>

    <div className="pu-section-grid">
      <div className="glass-card pu-chart-card">
        <div className="card-header"><div><span className="card-label">Performance</span><h3>Contribution History</h3></div></div>
        {dailySnapshots.length >= 2 ? <ContributionChart snapshots={dailySnapshots} /> : <div className="chart-placeholder">Daily snapshots are being collected. Chart will appear after 2+ days of data.</div>}
      </div>

      <div className="glass-card pu-achievements-card">
        <div className="card-header"><div><span className="card-label">Achievements</span><h3>{achievements.length} Unlocked</h3></div></div>
        {loading ? <div className="empty-state">Loading...</div> : <div className="pu-achievement-mini-list">
          {allAchievementDefs.slice(0, 12).map((def) => {
            const slug = def.slug as string;
            const earned = earnedSlugs.has(slug);
            const tier = def.tier as string;
            return <div key={slug} className={`pu-achievement-mini ${earned ? 'earned' : 'locked'}`}>
              <span className="pu-ach-icon" style={{ borderColor: tierColors[tier] ?? '#8e8e93' }}>{earned ? <Trophy size={14} /> : <Shield size={14} />}</span>
              <span className="pu-ach-name">{def.name as string}</span>
              {earned && <span className="pu-ach-tier" style={{ color: tierColors[tier] }}>{tier}</span>}
            </div>;
          })}
        </div>}
      </div>
    </div>

    {awards.length > 0 && <div className="glass-card pu-awards-card">
      <div className="card-header"><div><span className="card-label">Recognition</span><h3>Awards ({awards.length})</h3></div></div>
      <div className="pu-awards-list">
        {awards.map((win) => {
          const award = win.award as Record<string, unknown>;
          return <div key={win.id as string} className="pu-award-item">
            <span className="pu-award-icon"><Trophy size={18} /></span>
            <div><b>{award?.name as string ?? 'Award'}</b><small>{win.notes as string ?? ''}</small></div>
            <span className="pu-award-date">{new Date(win.awarded_at as string).toLocaleDateString()}</span>
          </div>;
        })}
      </div>
    </div>}

    <div className="pu-history-section">
      <span className="card-label">Battle Participation</span>
      <h3>Tracked History</h3>
      {dailySnapshots.length > 0 ? <div className="pu-history-table">
        <div className="pu-history-header"><span>Date</span><span>Battle Points</span><span>Daily Gain</span></div>
        {dailySnapshots.map((snap, i) => {
          const gain = i > 0 ? snap.battle_points - dailySnapshots[i - 1].battle_points : 0;
          return <div key={snap.snapshot_date} className="pu-history-row">
            <span>{snap.snapshot_date}</span>
            <span>{fmt(snap.battle_points)}</span>
            <span className={gain > 0 ? 'gain' : ''}>{gain > 0 ? `+${fmt(gain)}` : '—'}</span>
          </div>;
        })}
      </div> : <div className="empty-state">No historical snapshots recorded yet for this member.</div>}
    </div>
  </div>;
}

// ============================================================================
// Player Comparison
// ============================================================================

function PlayerCompare({ avatars, onBack, onOpenProfile }: {
  avatars: AvatarMap;
  onBack: () => void;
  onOpenProfile: (entry: PlayerEntry) => void;
}) {
  const [players, setPlayers] = useState<PlayerEntry[]>([]);
  const [playerA, setPlayerA] = useState<PlayerEntry | null>(null);
  const [playerB, setPlayerB] = useState<PlayerEntry | null>(null);

  useEffect(() => {
    (async () => {
      const { data: state } = await supabase.from('nanz_battle_scan_state').select('battle_id').eq('id', true).maybeSingle();
      const battleId = state?.battle_id as string | undefined;
      if (!battleId) return;
      const { data: memberRows } = await supabase.from('nanz_battle_member_rankings').select('user_id, username, display_name, battle_points, rank').eq('battle_id', battleId).order('battle_points', { ascending: false });
      const { data: repTotals } = await supabase.from('nanz_member_reputation_totals').select('roblox_user_id, total_reputation, reputation_level');
      const repMap = new Map((repTotals ?? []).map((r: Record<string, unknown>) => [Number(r.roblox_user_id), r]));
      const entries: PlayerEntry[] = (memberRows ?? []).map((row: Record<string, unknown>) => {
        const uid = Number(row.user_id);
        const rep = repMap.get(uid) as Record<string, unknown> | undefined;
        return {
          roblox_user_id: uid, username: row.username as string | null, display_name: row.display_name as string | null,
          battle_points: Number(row.battle_points), rank: row.rank as number | null, avatar_url: avatars[(row.username as string ?? '').toLowerCase()]?.avatar_url ?? null,
          achievement_count: 0, reputation: rep ? Number(rep.total_reputation) : 0, reputation_level: rep ? String(rep.reputation_level) : 'Rookie', is_active: Number(row.battle_points) > 0,
        };
      });
      setPlayers(entries);
    })();
  }, [avatars]);

  return <div className="page-inner">
    <button className="text-link" onClick={onBack}><ArrowLeft size={16} /> Back to Player Universe</button>
    <span className="kicker">Side by side</span>
    <h2>Player <span className="accent-text">Comparison</span></h2>

    <div className="pu-compare-selectors">
      <PlayerSelect players={players} selected={playerA} onSelect={setPlayerA} label="Player A" />
      <span className="pu-compare-vs">VS</span>
      <PlayerSelect players={players} selected={playerB} onSelect={setPlayerB} label="Player B" />
    </div>

    {playerA && playerB ? <ComparisonTable a={playerA} b={playerB} onOpenProfile={onOpenProfile} /> : <div className="empty-state">Select two players to compare their stats.</div>}
  </div>;
}

function PlayerSelect({ players, selected, onSelect, label }: { players: PlayerEntry[]; selected: PlayerEntry | null; onSelect: (entry: PlayerEntry) => void; label: string }) {
  return <div className="pu-select-group">
    <span className="card-label">{label}</span>
    <select className="pu-select" value={selected?.roblox_user_id ?? ''} onChange={(e) => { const p = players.find((x) => x.roblox_user_id === Number(e.target.value)); if (p) onSelect(p); }}>
      <option value="">Choose player...</option>
      {players.map((p) => <option key={p.roblox_user_id} value={p.roblox_user_id}>{p.username ?? `User ${p.roblox_user_id}`}</option>)}
    </select>
  </div>;
}

function ComparisonTable({ a, b, onOpenProfile }: { a: PlayerEntry; b: PlayerEntry; onOpenProfile: (entry: PlayerEntry) => void }) {
  const rows: { label: string; aVal: string; bVal: string; aNum: number; bNum: number; higherBetter: boolean }[] = [
    { label: 'Battle Points', aVal: fmt(a.battle_points), bVal: fmt(b.battle_points), aNum: a.battle_points, bNum: b.battle_points, higherBetter: true },
    { label: 'Clan Rank', aVal: `#${a.rank ?? '—'}`, bVal: `#${b.rank ?? '—'}`, aNum: a.rank ?? 0, bNum: b.rank ?? 0, higherBetter: false },
    { label: 'Reputation', aVal: String(a.reputation), bVal: String(b.reputation), aNum: a.reputation, bNum: b.reputation, higherBetter: true },
    { label: 'Rep Level', aVal: a.reputation_level, bVal: b.reputation_level, aNum: a.reputation, bNum: b.reputation, higherBetter: true },
  ];
  return <div className="glass-card pu-compare-table">
    <div className="pu-compare-header">
      <button className="pu-compare-name" onClick={() => onOpenProfile(a)}>{a.username ?? `User ${a.roblox_user_id}`}</button>
      <span className="pu-compare-divider" />
      <button className="pu-compare-name" onClick={() => onOpenProfile(b)}>{b.username ?? `User ${b.roblox_user_id}`}</button>
    </div>
    {rows.map((row) => {
      const aWins = row.higherBetter ? row.aNum > row.bNum : row.aNum < row.bNum;
      const bWins = row.higherBetter ? row.bNum > row.aNum : row.bNum < row.aNum;
      return <div key={row.label} className="pu-compare-row">
        <span className={`pu-compare-val ${aWins ? 'winner' : ''}`}>{row.aVal}</span>
        <span className="pu-compare-label">{row.label}</span>
        <span className={`pu-compare-val ${bWins ? 'winner' : ''}`}>{row.bVal}</span>
      </div>;
    })}
  </div>;
}

// ============================================================================
// Achievement Gallery
// ============================================================================

function AchievementGallery({ avatars, onBack, onOpenProfile }: { avatars: AvatarMap; onBack: () => void; onOpenProfile: (entry: PlayerEntry) => void }) {
  const [defs, setDefs] = useState<Record<string, unknown>[]>([]);
  const [earnedMap, setEarnedMap] = useState<Map<string, { awarded_at: string; member_id: string }>>(new Map());
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: allDefs } = await supabase.from('nanz_achievement_definitions').select('*').eq('is_active', true).order('category, reputation_points', { ascending: true });
      setDefs(allDefs ?? []);
      const { data: allEarned } = await supabase.from('nanz_member_achievements').select('achievement_id, awarded_at, member_id');
      const map = new Map<string, { awarded_at: string; member_id: string }>();
      for (const item of (allEarned ?? [])) map.set(String(item.achievement_id), { awarded_at: String(item.awarded_at), member_id: String(item.member_id) });
      setEarnedMap(map);
      setLoading(false);
    })();
  }, []);

  const filtered = categoryFilter === 'all' ? defs : defs.filter((d) => d.category === categoryFilter);
  const earnedCount = defs.filter((d) => earnedMap.has(d.id as string)).length;

  return <div className="page-inner">
    <button className="text-link" onClick={onBack}><ArrowLeft size={16} /> Back to Player Universe</button>
    <span className="kicker">Premium collectibles</span>
    <h2>Achievement <span className="accent-text">Gallery</span></h2>
    <p className="pu-subtitle">{earnedCount} of {defs.length} achievements unlocked across the clan</p>

    <div className="pu-filter-group pu-filter-row">
      <button className={`btn-pill ${categoryFilter === 'all' ? 'active' : ''}`} onClick={() => setCategoryFilter('all')}>All</button>
      <button className={`btn-pill ${categoryFilter === 'battle' ? 'active' : ''}`} onClick={() => setCategoryFilter('battle')}>Battle</button>
      <button className={`btn-pill ${categoryFilter === 'consistency' ? 'active' : ''}`} onClick={() => setCategoryFilter('consistency')}>Consistency</button>
      <button className={`btn-pill ${categoryFilter === 'contribution' ? 'active' : ''}`} onClick={() => setCategoryFilter('contribution')}>Contribution</button>
      <button className={`btn-pill ${categoryFilter === 'community' ? 'active' : ''}`} onClick={() => setCategoryFilter('community')}>Community</button>
      <button className={`btn-pill ${categoryFilter === 'special' ? 'active' : ''}`} onClick={() => setCategoryFilter('special')}>Special</button>
    </div>

    {loading ? <div className="empty-state">Loading achievements...</div> : <div className="pu-achievement-grid">
      {filtered.map((def) => {
        const id = def.id as string;
        const earned = earnedMap.get(id);
        const tier = def.tier as string;
        const isEarned = Boolean(earned);
        return <article key={id} className={`pu-achievement-card ${isEarned ? 'earned' : 'locked'} tier-${tier}`}>
          <div className="pu-ach-card-glow" style={{ background: `radial-gradient(circle at 50% 0%, ${tierColors[tier]}22, transparent 70%)` }} />
          <div className="pu-ach-card-icon" style={{ borderColor: tierColors[tier] }}>
            {isEarned ? <Trophy size={24} /> : <Shield size={24} />}
          </div>
          <span className="pu-ach-card-tier" style={{ color: tierColors[tier] }}>{tier.toUpperCase()}</span>
          <h3>{def.name as string}</h3>
          <p>{def.description as string}</p>
          <div className="pu-ach-card-footer">
            <span className="pu-ach-cat">{categoryLabels[def.category as string] ?? def.category as string}</span>
            {isEarned ? <span className="pu-ach-date">Unlocked {new Date(earned!.awarded_at).toLocaleDateString()}</span> : <span className="pu-ach-locked">Locked</span>}
          </div>
          <span className="pu-ach-rep">+{def.reputation_points as number} REP</span>
        </article>;
      })}
    </div>}
  </div>;
}

// ============================================================================
// Awards Gallery
// ============================================================================

function AwardsGallery({ avatars, onBack, onOpenProfile }: { avatars: AvatarMap; onBack: () => void; onOpenProfile: (entry: PlayerEntry) => void }) {
  const [winners, setWinners] = useState<Record<string, unknown>[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: allWinners } = await supabase.from('nanz_award_winners').select('*, award:nanz_award_definitions(*), member:nanz_members(roblox_username, roblox_user_id, avatar_url)').order('awarded_at', { ascending: false });
      setWinners(allWinners ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = filter === 'all' ? winners : winners.filter((w) => {
    const award = w.award as Record<string, unknown>;
    const slug = award?.slug as string;
    if (filter === 'weekly') return slug === 'player_of_the_week';
    if (filter === 'monthly') return slug === 'player_of_the_month';
    if (filter === 'battle') return slug === 'battle_mvp' || slug === 'top_contributor';
    if (filter === 'special') return slug === 'clan_legend' || slug === 'community_champion' || slug === 'most_consistent_player' || slug === 'most_improved_player';
    return true;
  });

  return <div className="page-inner">
    <button className="text-link" onClick={onBack}><ArrowLeft size={16} /> Back to Player Universe</button>
    <span className="kicker">Official clan recognition</span>
    <h2>NANZ <span className="accent-text">Awards</span></h2>
    <p className="pu-subtitle">{winners.length} awards issued to NANZ members</p>

    <div className="pu-filter-group pu-filter-row">
      <button className={`btn-pill ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
      <button className={`btn-pill ${filter === 'weekly' ? 'active' : ''}`} onClick={() => setFilter('weekly')}>Weekly</button>
      <button className={`btn-pill ${filter === 'monthly' ? 'active' : ''}`} onClick={() => setFilter('monthly')}>Monthly</button>
      <button className={`btn-pill ${filter === 'battle' ? 'active' : ''}`} onClick={() => setFilter('battle')}>Battle</button>
      <button className={`btn-pill ${filter === 'special' ? 'active' : ''}`} onClick={() => setFilter('special')}>Special</button>
    </div>

    {loading ? <div className="empty-state">Loading awards...</div> : filtered.length === 0 ? <div className="empty-state">No awards have been issued yet in this category. Awards are calculated automatically from verified battle data.</div> : <div className="pu-awards-grid">
      {filtered.map((win) => {
        const award = win.award as Record<string, unknown>;
        const member = win.member as Record<string, unknown> | null;
        const tier = (award?.tier as string) ?? 'gold';
        const memberName = (member?.roblox_username as string) ?? 'Unknown member';
        const avatarUrl = (member?.avatar_url as string) ?? avatars[memberName.toLowerCase()]?.avatar_url ?? null;
        return <article key={win.id as string} className={`pu-award-card tier-${tier}`}>
          <div className="pu-award-card-glow" style={{ background: `radial-gradient(circle at 50% 0%, ${tierColors[tier] ?? '#ffd60a'}22, transparent 70%)` }} />
          <div className="pu-award-trophy"><Trophy size={32} /></div>
          <span className="pu-award-tier-label" style={{ color: tierColors[tier] ?? '#ffd60a' }}>{tier.toUpperCase()}</span>
          <h3>{award?.name as string ?? 'Award'}</h3>
          <div className="pu-award-winner">
            {avatarUrl ? <img src={avatarUrl} alt={memberName} className="player-avatar-img" style={{ width: 36, height: 36 }} /> : <span className="player-avatar-fallback" style={{ width: 36, height: 36, fontSize: 12, background: 'linear-gradient(145deg, var(--pink), #1c1c1e 80%)' }}>{memberName.slice(0, 2).toUpperCase()}</span>}
            <b>{memberName}</b>
          </div>
          <p className="pu-award-reason">{win.notes as string ?? ''}</p>
          <span className="pu-award-period">{win.period_label as string ?? ''}</span>
          <small>{new Date(win.awarded_at as string).toLocaleDateString()}</small>
        </article>;
      })}
    </div>}
  </div>;
}

// ============================================================================
// Shared Components
// ============================================================================

function StatTile({ icon, label, value, meta }: { icon: JSX.Element; label: string; value: string; meta: string }) {
  return <div className="pu-stat-tile"><div className="pu-stat-icon">{icon}</div><span className="pu-stat-label">{label}</span><strong className="pu-stat-value">{value}</strong><small className="pu-stat-meta">{meta}</small></div>;
}

function ContributionChart({ snapshots }: { snapshots: DailyMemberSnapshot[] }) {
  if (snapshots.length < 2) return <div className="chart-placeholder">Need at least 2 daily snapshots.</div>;
  const width = 600;
  const height = 160;
  const min = Math.min(...snapshots.map((s) => s.battle_points));
  const max = Math.max(...snapshots.map((s) => s.battle_points));
  const points = snapshots.map((s, i) => `${(i / (snapshots.length - 1)) * width},${height - ((s.battle_points - min) / Math.max(1, max - min)) * (height - 20) - 10}`).join(' ');
  return <div className="pu-chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Daily contribution history"><polyline points={points} fill="none" stroke="var(--pink)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg><div className="chart-tooltip-row"><span>{snapshots[0].snapshot_date}</span><strong>{fmt(snapshots[snapshots.length - 1].battle_points)} pts</strong><span>{snapshots.length} days tracked</span></div></div>;
}
