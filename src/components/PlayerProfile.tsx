import { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Calendar,
  Check,
  Copy,
  Crown,
  Flame,
  Gem,
  Hourglass,
  Info,
  Link2,
  MessageCircle,
  Shield,
  Swords,
  Target,
  Trophy,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { supabase, type AvatarMap, type NanzMember } from '@/lib/supabase';

type ProfileStats = {
  roblox_user_id: number;
  roblox_username: string | null;
  clan_role: string;
  clan_status: string;
  discord_user_id: string | null;
  discord_verified: boolean;
  joined_clan_at: string | null;
  current_battle_points: number | null;
  contribution_rank: number | null;
  total_recorded_points: number;
  contributing_days: number;
  archived_battles: number;
  highest_daily_points: number | null;
  avg_daily_points: number | null;
  last_active_date: string | null;
  best_archived_battle: number | null;
};

type DailyRow = { snapshot_date: string; battle_points: number; battle_id: string };
type ArchiveRow = { battle_points: number; archive: { battle_id: string; battle_name: string | null; finish_time: string | null; nanz_final_points: number | null; nanz_final_rank: number | null } | null };
type WinnerRow = { awarded_at: string; period_label: string | null; battle_id: string | null; award: { slug: string; name: string } | null };
type PayoutRow = { gems: number; reward_type: string; paid_at: string; battle_id: string | null; period_label: string | null };
type DiscordConnection = { discord_user_id: string; discord_username: string | null; discord_in_server: boolean; discord_checked_at: string | null };

export type ProfileMember = {
  name: string;
  user_id: number;
  points: number;
  rank: number;
  initials: string;
  color: string;
  avatarUrl?: string | null;
};

const ROLE_META: Record<string, { label: string; className: string }> = {
  owner: { label: 'CLAN OWNER', className: 'owner' },
  admin: { label: 'ADMIN', className: 'admin' },
  elite_member: { label: 'ELITE MEMBER', className: 'elite' },
  veteran: { label: 'VETERAN', className: 'veteran' },
  member: { label: 'MEMBER', className: 'member' },
  recruit: { label: 'RECRUIT', className: 'recruit' },
};

const DAILY_GOAL = 1000;

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function computeStreaks(dates: string[]): { current: number; longest: number } {
  if (dates.length === 0) return { current: 0, longest: 0 };
  const unique = Array.from(new Set(dates)).sort();
  const dayMs = 86_400_000;
  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    const diff = Math.round((new Date(unique[i]).getTime() - new Date(unique[i - 1]).getTime()) / dayMs);
    run = diff === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  const todayUtc = new Date().toISOString().slice(0, 10);
  const yesterdayUtc = new Date(Date.now() - dayMs).toISOString().slice(0, 10);
  const last = unique[unique.length - 1];
  const current = last === todayUtc || last === yesterdayUtc ? run : 0;
  return { current, longest };
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: JSX.Element; label: string; onClick: () => void }) {
  return (
    <button className={`pp-tab ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function StatTile({ icon, value, label, tone }: { icon: JSX.Element; value: string; label: string; tone?: string }) {
  return (
    <div className={`pp-stat ${tone ? `tone-${tone}` : ''}`}>
      <span className="pp-stat-icon">{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

export function PlayerProfileModal({ member, onClose, avatars }: {
  member: ProfileMember;
  onClose: () => void;
  avatars: AvatarMap;
}) {
  const [tab, setTab] = useState<'overview' | 'performance' | 'rewards' | 'info'>('overview');
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [memberRow, setMemberRow] = useState<NanzMember | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [archiveRows, setArchiveRows] = useState<ArchiveRow[]>([]);
  const [mvps, setMvps] = useState<WinnerRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'all'>('7d');
  const [copied, setCopied] = useState(false);
  const [chartRange, setChartRange] = useState<'24h' | '7d' | '30d' | 'all'>('7d');
  const [discordConn, setDiscordConn] = useState<DiscordConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    const userId = member.user_id;
    const load = async () => {
      const [statsRes, memberRes, dailyRes, archiveRes, winnersRes, payoutRes, connRes] = await Promise.all([
        supabase.from('nanz_player_profile_stats').select('*').eq('roblox_user_id', userId).maybeSingle(),
        supabase.from('nanz_members').select('*').eq('roblox_user_id', userId).maybeSingle(),
        supabase.from('nanz_daily_member_snapshots').select('snapshot_date, battle_points, battle_id').eq('user_id', userId).order('snapshot_date', { ascending: true }),
        supabase.from('nanz_battle_archive_members').select('battle_points, archive:archive_id(battle_id, battle_name, finish_time, nanz_final_points, nanz_final_rank)').eq('user_id', userId).order('battle_points', { ascending: false }),
        supabase.from('nanz_award_winners').select('awarded_at, period_label, battle_id, award:award_id(slug, name), member:member_id!inner(roblox_user_id)').eq('member.roblox_user_id', userId).order('awarded_at', { ascending: false }),
        supabase.from('nanz_reward_payouts').select('gems, reward_type, paid_at, battle_id, period_label').eq('roblox_user_id', userId).order('paid_at', { ascending: false }),
        supabase.rpc('player_discord_connection', { p_roblox_user_id: userId }),
      ]);
      if (cancelled) return;
      if (!statsRes.error && statsRes.data) setStats(statsRes.data as ProfileStats);
      if (!memberRes.error && memberRes.data) setMemberRow(memberRes.data as NanzMember);
      if (!dailyRes.error) setDaily((dailyRes.data ?? []) as DailyRow[]);
      if (!archiveRes.error) setArchiveRows((archiveRes.data ?? []) as unknown as ArchiveRow[]);
      if (!winnersRes.error) setMvps((winnersRes.data ?? []) as unknown as WinnerRow[]);
      if (!payoutRes.error) setPayouts((payoutRes.data ?? []) as PayoutRow[]);
      const connRows = (connRes.data ?? []) as unknown as DiscordConnection[];
      if (!connRes.error && connRows.length > 0) setDiscordConn(connRows[0]); else setDiscordConn(null);
    };
    void load();
    return () => { cancelled = true; };
  }, [member.user_id]);

  const ownerUserId = useMemo(async () => {
    const { data } = await supabase.from('nanz_clan_config').select('owner_user_id').eq('id', true).maybeSingle();
    return data?.owner_user_id ?? null;
  }, []);
  const [ownerId, setOwnerId] = useState<number | null>(null);
  useEffect(() => { void ownerUserId.then(setOwnerId); }, [ownerUserId]);
  const isOwner = ownerId === member.user_id || memberRow?.clan_role === 'owner';

  const roleMeta = ROLE_META[memberRow?.clan_role ?? (isOwner ? 'owner' : 'member')] ?? ROLE_META.member;
  const streaks = useMemo(() => computeStreaks(daily.filter((row) => row.battle_points > 0).map((row) => row.snapshot_date)), [daily]);

  const mvpCount = mvps.filter((row) => row.award?.slug === 'battle_mvp').length;
  const latestMvp = mvps.find((row) => row.award?.slug === 'battle_mvp') ?? null;

  const battleWins = archiveRows.filter((row) => row.archive && row.archive.finish_time).length;
  const bestBattle = archiveRows[0] ?? null;

  const totalGems = payouts.reduce((sum, row) => sum + row.gems, 0);
  const latestPayout = payouts[0] ?? null;

  const memberSince = memberRow?.joined_clan_at ?? null;

  const filteredDaily = useMemo(() => {
    const days: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, all: 36500 };
    const cutoff = new Date(Date.now() - days[range] * 86_400_000).toISOString().slice(0, 10);
    return daily.filter((row) => row.snapshot_date >= cutoff);
  }, [daily, range]);

  const chartData = useMemo(() => {
    const days: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, all: 36500 };
    const cutoff = new Date(Date.now() - days[chartRange] * 86_400_000).toISOString().slice(0, 10);
    return daily.filter((row) => row.snapshot_date >= cutoff);
  }, [daily, chartRange]);

  const chartPath = useMemo(() => {
    if (chartData.length < 2) return null;
    const width = 560;
    const height = 160;
    const values = chartData.map((row) => row.battle_points);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    const points = chartData.map((row, index) => {
      const x = (index / (chartData.length - 1)) * width;
      const y = height - 12 - ((row.battle_points - min) / span) * (height - 24);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { points: points.join(' '), width, height };
  }, [chartData]);

  const copyProfileLink = async () => {
    const url = `${window.location.origin}/player/${member.user_id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2400);
  };

  const discordLinked = Boolean(discordConn?.discord_user_id);

  const dailyToday = daily.length > 0 ? daily[daily.length - 1].battle_points : 0;
  const dailyPercent = Math.min(100, Math.round((dailyToday / DAILY_GOAL) * 100));
  const goalStatus = dailyPercent >= 100 ? 'On track' : dailyPercent >= 50 ? 'In progress' : 'Needs points';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pp-modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-x" onClick={onClose} aria-label="Close profile"><X size={18} /></button>

        <header className="pp-header">
          <div className="pp-avatar-wrap">
            <AvatarImage member={{ name: member.name, color: member.color, initials: member.initials }} avatars={avatars} className="pp-avatar" />
            {isOwner && <Crown size={30} className="pp-owner-crown" />}
            <span className={discordLinked ? 'pp-presence on' : 'pp-presence'} />
          </div>
          <div className="pp-identity">
            <div className="pp-verified"><Shield size={13} /> Verified Member</div>
            <h2>{member.name} <span className="pp-verified-check"><Check size={15} /></span></h2>
            <p className="pp-role-line">{roleMeta.label} · NANZ</p>
            <div className="pp-badges">
              <span className={`pp-role-badge ${roleMeta.className}`}><Crown size={12} /> {roleMeta.label}</span>
              <span className="pp-role-badge member"><Users size={12} /> Clan Member</span>
              {stats?.contribution_rank != null && <span className="pp-role-badge elite"><Trophy size={12} /> Season #{stats.contribution_rank}</span>}
            </div>
          </div>
          <div className="pp-rank-medal">
            <b>#{member.rank}</b>
            <span>Current Rank</span>
          </div>
        </header>

        <div className="pp-actions">
          <a className="pp-action primary" href={`https://www.roblox.com/users/${member.user_id}/profile`} target="_blank" rel="noreferrer"><UserPlus size={16} /> Add Friend</a>
          {discordLinked
            ? <a className="pp-action" href={`https://discord.com/users/${discordConn?.discord_user_id}`} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Message on Discord</a>
            : <span className="pp-action disabled"><MessageCircle size={16} /> Discord not linked</span>}
          <button className="pp-action" onClick={copyProfileLink}><Link2 size={16} /> Copy Profile Link</button>
        </div>
        {copied && <div className="pp-toast"><Check size={14} /> Profile link copied</div>}

        <div className="pp-hero-stats">
          <StatTile icon={<Zap size={18} />} value={formatNumber(member.points)} label="Battle Points" />
          <StatTile icon={<BarChart3 size={18} />} value={`${dailyPercent}%`} label="Daily Contribution" />
          <StatTile icon={<Flame size={18} />} value={streaks.current > 0 ? `${streaks.current}d` : '0d'} label="Activity Streak" tone="flame" />
          <StatTile icon={<Target size={18} />} value={goalStatus} label="Daily Status" tone={goalStatus === 'On track' ? 'good' : undefined} />
        </div>

        <div className="pp-goal-bars">
          <div className="pp-goal-row"><span>Daily Goal <b>{formatNumber(dailyToday)} / 1,000</b></span><i><em style={{ width: `${dailyPercent}%` }} /></i></div>
          <div className="pp-goal-row"><span>Contribution Rank <b>{stats?.contribution_rank != null ? `#${stats.contribution_rank}` : '—'}</b></span><i><em style={{ width: `${stats?.contribution_rank ? Math.max(6, 100 - Math.min(100, stats.contribution_rank * 4)) : 0}%` }} /></i></div>
        </div>

        <nav className="pp-tabs">
          <TabButton active={tab === 'overview'} icon={<Users size={16} />} label="Overview" onClick={() => setTab('overview')} />
          <TabButton active={tab === 'performance'} icon={<BarChart3 size={16} />} label="Performance" onClick={() => setTab('performance')} />
          <TabButton active={tab === 'rewards'} icon={<Gem size={16} />} label="Rewards" onClick={() => setTab('rewards')} />
          <TabButton active={tab === 'info'} icon={<Info size={16} />} label="Info" onClick={() => setTab('info')} />
        </nav>

        <div className="pp-tab-body" key={tab}>
          {tab === 'overview' && (
            <div className="pp-grid">
              <section className="pp-card">
                <h3><Info size={15} /> Player Information</h3>
                <div className="pp-kv"><span>Roblox Username</span><b>{stats?.roblox_username ?? member.name}</b></div>
                <div className="pp-kv"><span>Clan</span><b>NANZ</b></div>
                <div className="pp-kv"><span>Member Since</span><b>{memberSince ? new Date(memberSince).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Join date unavailable'}</b></div>
                <div className="pp-kv"><span>Role</span><b>{roleMeta.label}</b></div>
              </section>
              <section className="pp-card">
                <h3><Trophy size={15} /> Player of the Battle</h3>
                <div className="pp-mvp-row">
                  <span className="pp-mvp-badge"><Award size={20} /></span>
                  <div>
                    <b>{mvpCount} MVP award{mvpCount === 1 ? '' : 's'}</b>
                    <small>{latestMvp ? `Most recent: ${new Date(latestMvp.awarded_at).toLocaleDateString()}` : 'No MVP awards recorded yet'}</small>
                  </div>
                </div>
                <div className="pp-kv"><span>Consecutive MVPs</span><b>{mvpCount > 0 ? `${mvpCount} total` : '—'}</b></div>
              </section>
              <section className="pp-card">
                <h3><Swords size={15} /> Battle Wins</h3>
                <b className="pp-big-num">{battleWins}</b>
                <small className="pp-muted">{battleWins > 0 ? 'Confirmed clan battle wins with this player participating' : 'Tracking from now on — wins appear once battles finish and are confirmed'}</small>
              </section>
              <section className="pp-card">
                <h3><Gem size={15} /> Total Rewards Earned</h3>
                <div className="pp-mvp-row">
                  <span className="pp-mvp-badge gems"><Gem size={20} /></span>
                  <div>
                    <b>{formatNumber(totalGems)} gems</b>
                    <small>{payouts.length} payout{payouts.length === 1 ? '' : 's'}{latestPayout ? ` · most recent ${new Date(latestPayout.paid_at).toLocaleDateString()}` : ''}</small>
                  </div>
                </div>
              </section>
            </div>
          )}

          {tab === 'performance' && (
            <div className="pp-stack">
              <section className="pp-card">
                <h3><BarChart3 size={15} /> Points Development</h3>
                <div className="pp-range-tabs">
                  {(['24h', '7d', '30d', 'all'] as const).map((item) => (
                    <button key={item} className={chartRange === item ? 'active' : ''} onClick={() => setChartRange(item)}>
                      {item === 'all' ? 'All Time' : item}
                    </button>
                  ))}
                </div>
                {chartPath ? (
                  <div className="pp-chart">
                    <svg viewBox={`0 0 ${chartPath.width} ${chartPath.height}`} preserveAspectRatio="none" role="img" aria-label="Daily points development">
                      <polyline points={chartPath.points} fill="none" stroke="var(--pink)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                    </svg>
                  </div>
                ) : <div className="pp-chart-empty">At least two recorded days are needed for the chart.</div>}
              </section>
              <div className="pp-grid">
                <StatTile icon={<Zap size={18} />} value={formatNumber(stats?.total_recorded_points ?? member.points)} label="Total Recorded Points" />
                <StatTile icon={<BarChart3 size={18} />} value={stats?.avg_daily_points != null ? formatNumber(Math.round(stats.avg_daily_points)) : '—'} label="Average Daily Points" />
                <StatTile icon={<Flame size={18} />} value={stats?.highest_daily_points != null ? formatNumber(stats.highest_daily_points) : '—'} label="Highest Daily Points" />
                <StatTile icon={<Calendar size={18} />} value={String(stats?.contributing_days ?? 0)} label="Active Days Recorded" />
              </div>
              <section className="pp-card">
                <h3><Award size={15} /> Personal Records</h3>
                <div className="pp-records">
                  <div className="pp-record"><span>Highest Daily Points</span><b>{stats?.highest_daily_points != null ? formatNumber(stats.highest_daily_points) : '—'}</b><small>{stats?.highest_daily_points != null ? 'Best recorded calendar day' : 'No data yet'}</small></div>
                  <div className="pp-record"><span>Best Battle Performance</span><b>{bestBattle ? formatNumber(bestBattle.battle_points) : '—'}</b><small>{bestBattle?.archive?.battle_name ?? 'No completed battle recorded yet'}</small></div>
                  <div className="pp-record"><span>Highest Point Rate</span><b>{stats?.current_battle_points != null ? `${formatNumber(stats.current_battle_points)} pts` : '—'}</b><small>Current battle peak (points per hour pending sync)</small></div>
                </div>
              </section>
              <section className="pp-card">
                <h3><Hourglass size={15} /> Activity Streak</h3>
                <div className="pp-grid compact">
                  <StatTile icon={<Flame size={18} />} value={String(streaks.current)} label="Current Streak (days)" />
                  <StatTile icon={<Trophy size={18} />} value={String(streaks.longest)} label="Longest Streak (days)" />
                  <StatTile icon={<Calendar size={18} />} value={stats?.last_active_date ? new Date(stats.last_active_date).toLocaleDateString() : '—'} label="Last Active" />
                </div>
              </section>
            </div>
          )}

          {tab === 'rewards' && (
            <div className="pp-stack">
              <div className="pp-grid">
                <StatTile icon={<Gem size={18} />} value={formatNumber(totalGems)} label="Total Gems Paid" tone="gold" />
                <StatTile icon={<Award size={18} />} value={String(payouts.length)} label="Reward Payouts" />
                <StatTile icon={<Calendar size={18} />} value={latestPayout ? new Date(latestPayout.paid_at).toLocaleDateString() : '—'} label="Most Recent Reward" />
                <StatTile icon={<Swords size={18} />} value={String(battleWins)} label="Battle Wins" />
              </div>
              <section className="pp-card">
                <h3><Gem size={15} /> Payout Ledger</h3>
                {payouts.length === 0
                  ? <small className="pp-muted">No confirmed payouts recorded yet. The ledger starts tracking from deployment — only rewards explicitly marked as paid appear here.</small>
                  : <div className="pp-payout-list">{payouts.slice(0, 12).map((row, index) => (
                    <div key={index} className="pp-payout-row">
                      <Gem size={14} />
                      <b>{formatNumber(row.gems)} gems</b>
                      <span>{row.battle_id ?? row.period_label ?? 'Clan reward'}</span>
                      <small>{new Date(row.paid_at).toLocaleDateString()}</small>
                    </div>
                  ))}</div>}
              </section>
            </div>
          )}

          {tab === 'info' && (
            <div className="pp-stack">
              <section className="pp-card">
                <h3><Info size={15} /> Identity & Verification</h3>
                <div className="pp-kv"><span>Roblox Username</span><b>{stats?.roblox_username ?? member.name}</b></div>
                <div className="pp-kv"><span>Roblox User ID</span><b>{member.user_id}</b></div>
                <div className="pp-kv"><span>Discord Account</span><b>{discordLinked ? `Linked (${discordConn?.discord_username ?? 'verified'})` : 'Not linked'}</b></div>
                <div className="pp-kv"><span>Member Since</span><b>{memberSince ? new Date(memberSince).toLocaleDateString() : 'Join date unavailable'}</b></div>
                <div className="pp-kv"><span>Clan Role</span><b>{roleMeta.label}</b></div>
                <div className="pp-kv"><span>Member Status</span><b>{memberRow?.clan_status === 'active' ? 'Active' : memberRow?.clan_status ?? 'Unknown'}</b></div>
                <div className="pp-kv"><span>Verification</span><b>Verified Member</b></div>
                {discordLinked && <div className="pp-kv"><span>Discord Server</span><b>{discordConn?.discord_in_server ? 'Discord Member' : 'Not verified'}</b></div>}
              </section>
              <section className="pp-card">
                <h3><Swords size={15} /> Current Battle Context</h3>
                <div className="pp-kv"><span>Current Battle Points</span><b>{stats?.current_battle_points != null ? formatNumber(stats.current_battle_points) : '—'}</b></div>
                <div className="pp-kv"><span>Contribution Rank</span><b>{stats?.contribution_rank != null ? `#${stats.contribution_rank}` : '—'}</b></div>
                <div className="pp-kv"><span>Battles Recorded (archive)</span><b>{String(stats?.archived_battles ?? 0)}</b></div>
              </section>
            </div>
          )}
        </div>

        <button className="text-link pp-return" onClick={onClose}>Return to ranking</button>
      </div>
    </div>
  );
}

function AvatarImage({ member, avatars, className }: { member: { name: string; initials?: string; color?: string }; avatars: AvatarMap; className?: string }) {
  const entry = avatars[member.name.toLowerCase()];
  const url = entry?.avatar_url ?? null;
  if (url) return <img className={className} src={url} alt={member.name} />;
  return <span className={`${className ?? ''} pp-avatar-fallback`} style={{ '--avatar-color': member.color } as React.CSSProperties}>{member.initials ?? member.name.slice(0, 2).toUpperCase()}</span>;
}
