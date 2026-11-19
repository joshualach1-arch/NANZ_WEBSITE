import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AvatarMap, BattleMemberRanking, BattlePointSnapshot, BattleReward, BattleScanState, fetchRobloxAvas, ModuleStatus, NanzNotification, supabase } from '@/lib/supabase';
import { PlayerUniverse } from '@/components/PlayerUniverse';
import { RivalIntelligence } from '@/components/Intelligence';
import { BattleArchive, HallOfFame } from '@/components/Legacy';
import { StaffAdmin } from '@/components/StaffAdmin';
import { DiscordAdmin } from '@/components/DiscordAdmin';
import { PlayerProfileModal, type ProfileMember } from '@/components/PlayerProfile';
import { JoinDiscordButton, DiscordCommunity } from '@/components/DiscordCommunity';
import { ApplicationStatus } from '@/components/ApplicationStatus';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  BarChart3,
  Bell,
  Check,
  ChevronRight,
  Crosshair,
  Crown,
  Diamond,
  Gem,
  Globe2,
  Menu,
  RefreshCw,
  Search,
  Shield,
  Swords,
  Target,
  TrendingUp,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react';

type Section = 'home' | 'clan' | 'battle' | 'leaderboard' | 'rewards' | 'apply' | 'players' | 'rivals' | 'goals' | 'hof' | 'archive' | 'community' | 'status';

type Member = {
  name: string;
  points: number;
  role: string;
  trend: 'up' | 'down' | 'steady';
  color: string;
  initials: string;
  user_id?: number;
};

const avatarColors = ['#ff375f', '#0a84ff', '#ff9f0a', '#bf5af2', '#64d2ff'];

function mapLiveMember(row: BattleMemberRanking, index: number): Member {
  const name = row.username ?? `Roblox user ${row.user_id}`;
  const initials = name.slice(0, 2).toUpperCase();
  return {
    name,
    points: row.battle_points,
    role: row.battle_points > 0 ? 'Active contributor' : 'Roster member',
    trend: 'steady',
    color: avatarColors[index % avatarColors.length],
    initials,
    user_id: row.user_id,
  };
}

const primaryNavItems: { id: Section; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'battle', label: 'Battle' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'players', label: 'Players' },
];

const menuNavItems: { id: Section; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'clan', label: 'The Clan' },
  { id: 'battle', label: 'Battle' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'players', label: 'Players' },
  { id: 'rivals', label: 'Rival Intelligence' },
  { id: 'goals', label: 'Clan Goals' },
  { id: 'hof', label: 'Hall of Fame' },
  { id: 'archive', label: 'Battle Archive' },
  { id: 'rewards', label: 'Rewards' },
  { id: 'community', label: 'Community' },
  { id: 'apply', label: 'Apply' },
  { id: 'status', label: 'Application Status' },
];

const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value);

type OfficialReward = {
  title: string;
  range: string;
  bestPlace: number;
  worstPlace: number;
  image: string;
  targetPoints: number;
  kind: 'pet' | 'cosmetic' | 'gift' | 'medal';
};

const officialRewards: OfficialReward[] = [
  { title: 'Gargantuan Butler Penguin', range: '#1 Place', bestPlace: 1, worstPlace: 1, image: '/images/rewards/image.png', targetPoints: 733351, kind: 'pet' },
  { title: 'Rainbow Titanic Nine Eyed Lion', range: '#2–3 Place', bestPlace: 2, worstPlace: 3, image: '/images/rewards/image copy.png', targetPoints: 728541, kind: 'pet' },
  { title: 'Golden Titanic Nine Eyed Lion', range: '#4–10 Place', bestPlace: 4, worstPlace: 10, image: '/images/rewards/image copy 2.png', targetPoints: 655970, kind: 'pet' },
  { title: 'Titanic Nine Eyed Lion', range: '#11–50 Place', bestPlace: 11, worstPlace: 50, image: '/images/rewards/image copy 3.png', targetPoints: 633033, kind: 'pet' },
  { title: 'Huge Nine Eyed Lion', range: '#51–250 Place', bestPlace: 51, worstPlace: 250, image: '/images/rewards/image copy 4.png', targetPoints: 523656, kind: 'pet' },
  { title: 'Nine Eyed Lion Hoverboard', range: 'Top 30', bestPlace: 1, worstPlace: 30, image: '/images/rewards/image copy 5.png', targetPoints: 558581, kind: 'cosmetic' },
  { title: 'Nine Eyed Lion Booth', range: 'Top 50', bestPlace: 1, worstPlace: 50, image: '/images/rewards/image copy 6.png', targetPoints: 524964, kind: 'cosmetic' },
  { title: 'Clan Gift', range: 'Top 500', bestPlace: 1, worstPlace: 500, image: '/images/rewards/image copy 7.png', targetPoints: 66319, kind: 'gift' },
];

function useLiveData() {
  const [rankState, setRankState] = useState<BattleScanState | null>(null);
  const [liveMembers, setLiveMembers] = useState<Member[]>([]);
  const [snapshots, setSnapshots] = useState<BattlePointSnapshot[]>([]);
  const [avatars, setAvatars] = useState<AvatarMap>({});
  const [rewards, setRewards] = useState<BattleReward[]>([]);

  const load = async () => {
    const { data: state } = await supabase.from('nanz_battle_scan_state').select('*').eq('id', true).maybeSingle();
    if (state) setRankState(state as BattleScanState);
    const { data: rewardRows } = await supabase.from('nanz_battle_rewards').select('battle_id, reward_item_name, best_place, worst_place').order('best_place', { ascending: true });
    setRewards((rewardRows ?? []) as BattleReward[]);
    const battleId = state?.battle_id as string | null | undefined;
    if (!battleId) return;
    const { data: memberRows } = await supabase.from('nanz_battle_member_rankings').select('battle_id, user_id, username, display_name, battle_points, rank, captured_at').eq('battle_id', battleId).order('battle_points', { ascending: false });
    const rows = (memberRows ?? []) as BattleMemberRanking[];
    setLiveMembers(rows.map(mapLiveMember));
    const { data: snapshotRows } = await supabase.from('nanz_battle_point_snapshots').select('battle_id, battle_points, captured_at').eq('battle_id', battleId).order('captured_at', { ascending: false }).limit(168);
    setSnapshots(((snapshotRows ?? []) as BattlePointSnapshot[]).reverse());
    const usernames = rows.map((row) => row.username).filter((name): name is string => Boolean(name));
    setAvatars(await fetchRobloxAvas(usernames));
  };

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      await supabase.functions.invoke('nanz-ranking');
      if (!cancelled) await load();
    };
    void sync();
    const refresh = window.setInterval(() => { void sync(); }, 60000);
    const intelligence = window.setInterval(() => { void supabase.functions.invoke('nanz-intelligence'); }, 60000);
    return () => { cancelled = true; window.clearInterval(refresh); window.clearInterval(intelligence); };
  }, []);

  return { rankState, rewards, liveMembers, snapshots, avatars };
}

function useCountdown(rankState: BattleScanState | null) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!rankState?.battle_finish_time) return;
    const target = new Date(rankState.battle_finish_time).getTime();
    const update = () => Math.max(0, Math.floor((target - Date.now()) / 1000));
    setSeconds(update());
    const timer = window.setInterval(() => setSeconds(update()), 1000);
    return () => window.clearInterval(timer);
  }, [rankState?.battle_finish_time]);

  const timeLabel = rankState?.battle_finish_time ? `${String(Math.floor(seconds / 86400)).padStart(2, '0')}D ${String(Math.floor((seconds % 86400) / 3600)).padStart(2, '0')}H ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}M ${String(seconds % 60).padStart(2, '0')}S` : 'Awaiting battle timing';
  return { seconds, timeLabel };
}

function LogoMark() {
  return <span className="logo-mark"><img src="/image.png" alt="NANZ" /></span>;
}

function AvatarImage({ member, avatars, className }: { member: Member; avatars: AvatarMap; className: string }) {
  const entry = avatars[member.name.toLowerCase()];
  const url = entry?.avatar_url ?? null;
  if (url) return <img className={`${className} avatar-img`} src={url} alt={member.name} />;
  return <span className={className} style={{ '--avatar-color': member.color } as React.CSSProperties}>{member.initials}</span>;
}

function Pill({ children, tone = 'blue' }: { children: string; tone?: 'blue' | 'pink' | 'gold' | 'gray' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function SectionHeader({ kicker, title, accent, trailing }: { kicker: string; title: string; accent?: string; trailing?: string }) {
  return (
    <div className="section-header">
      <div>
        <span className="kicker">{kicker}</span>
        <h2>{title} {accent && <span className="accent-text">{accent}</span>}</h2>
      </div>
      {trailing && <span className="trailing-label">{trailing}</span>}
    </div>
  );
}

function App() {
  const [activeSection, setActiveSection] = useState<Section>('home');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profile, setProfile] = useState<{ member: Member; rank: number } | null>(null);
  const [playerDeepLink, setPlayerDeepLink] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortDescending, setSortDescending] = useState(true);
  const [applicationStatus, setApplicationStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [applicationReference, setApplicationReference] = useState<string | null>(null);
  const [adminMode, setAdminMode] = useState<boolean>(() => window.location.hash === '#admin');
  const [notifications, setNotifications] = useState<NanzNotification[]>([]);
  const { rankState, rewards, liveMembers, snapshots, avatars } = useLiveData();
  const { timeLabel } = useCountdown(rankState);

  useEffect(() => {
    const onHash = () => setAdminMode(window.location.hash === '#admin');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Shared profile links: /player/:robloxUserId opens the profile once members have loaded.
  useEffect(() => {
    const match = window.location.pathname.match(/^\/player\/(\d+)/);
    if (!match) return;
    const userId = Number(match[1]);
    if (liveMembers.length === 0) return;
    const target = liveMembers.find((m) => m.user_id === userId);
    if (target) setProfile((current) => current ?? { member: target, rank: 0 });
  }, [liveMembers]);

  useEffect(() => {
    const loadNotifs = async () => {
      const { data } = await supabase.from('nanz_notifications').select('*').order('created_at', { ascending: false }).limit(20);
      setNotifications((data ?? []) as NanzNotification[]);
    };
    void loadNotifs();
    const interval = window.setInterval(loadNotifs, 30000);
    return () => window.clearInterval(interval);
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  useEffect(() => {
    const drawer = document.querySelector<HTMLElement>('.nav-drawer');
    if (!drawer) return;
    let startX = 0;
    const onStart = (e: Event) => { startX = (e as TouchEvent).touches[0].clientX; };
    const onMove = (e: Event) => {
      if (!startX) return;
      const dx = (e as TouchEvent).touches[0].clientX - startX;
      if (dx > 0) drawer.style.transform = `translateX(${dx}px)`;
    };
    const onEnd = (e: Event) => {
      const dx = (e as TouchEvent).changedTouches[0].clientX - startX;
      drawer.style.transform = '';
      if (dx > 70) setMobileOpen(false);
      startX = 0;
    };
    drawer.addEventListener('touchstart', onStart, { passive: true });
    drawer.addEventListener('touchmove', onMove, { passive: true });
    drawer.addEventListener('touchend', onEnd);
    return () => {
      drawer.removeEventListener('touchstart', onStart);
      drawer.removeEventListener('touchmove', onMove);
      drawer.removeEventListener('touchend', onEnd);
    };
  }, []);

  const submitApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApplicationStatus('sending');
    const form = new FormData(event.currentTarget);
    const payload = {
      roblox_username: String(form.get('roblox_username') ?? '').trim(),
      roblox_user_id: String(form.get('roblox_user_id') ?? '').trim() || null,
      discord_username: String(form.get('discord_username') ?? '').trim(),
      daily_playtime: String(form.get('daily_playtime') ?? '').trim(),
      daily_points_potential: String(form.get('daily_points_potential') ?? '').trim(),
      previous_clan: String(form.get('previous_clan') ?? '').trim() || null,
      experience: String(form.get('experience') ?? '').trim(),
    };
    const { data, error } = await supabase.from('nanz_recruitment_applications').insert(payload).select('id').single();
    if (error || !data) {
      console.error('[application-submit] insert failed', {
        code: (error as { code?: string } | null)?.code ?? null,
        message: (error as { message?: string } | null)?.message ?? (error ? String(error) : 'no data returned'),
        hint: (error as { hint?: string } | null)?.hint ?? null,
        roblox_username: payload.roblox_username,
        playtime: payload.daily_playtime,
        potential: payload.daily_points_potential,
        experience_length: payload.experience.length,
      });
      setApplicationStatus('error');
      return;
    }
    const appId = String((data as { id: string }).id);
    let reference: string | null = null;
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nanz-discord-bridge`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'dispatch', applicationId: appId }),
      });
      if (res.ok) {
        const result = await res.json();
        reference = typeof result?.reference === 'string' ? result.reference : null;
      } else {
        const result = await res.json().catch(() => null);
        console.error('[application-submit] bridge dispatch failed', {
          status: res.status,
          error: result?.error ?? null,
          detail: result?.detail ?? null,
          application_id: appId,
        });
      }
    } catch (e) {
      reference = null;
      console.error('[application-submit] bridge dispatch unreachable', {
        application_id: appId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
    setApplicationReference(reference);
    setApplicationStatus('sent');
  };

  const visibleMembers = useMemo(() => liveMembers
    .filter((member) => member.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortDescending ? b.points - a.points : a.points - b.points), [liveMembers, search, sortDescending]);

  const navigate = (section: Section | string) => {
    if (typeof section === 'string' && section.startsWith('player/')) {
      const userId = Number(section.slice('player/'.length));
      if (Number.isFinite(userId) && userId > 0) {
        const target = liveMembers.find((m) => m.user_id === userId);
        if (target) setProfile({ member: target, rank: 0 });
        window.history.replaceState(null, '', `/player/${userId}`);
      }
      return;
    }
    if (typeof section === 'string' && section.startsWith('players/')) {
      setPlayerDeepLink(section);
      setActiveSection('players');
      setMobileOpen(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (section !== 'players') setPlayerDeepLink(null);
    setActiveSection(section as Section);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="app">
      <div className="bg-glow bg-glow-1" />
      <div className="bg-glow bg-glow-2" />
      <header className="nav-bar">
        <div className="nav-inner">
          <button className="brand" onClick={() => navigate('home')} aria-label="Go to home">
            <LogoMark />
            <span className="brand-name">NANZ</span>
          </button>
          <nav className="nav-desktop">
            {primaryNavItems.map((item) => <button key={item.id} className={activeSection === item.id ? 'nav-item active' : 'nav-item'} onClick={() => navigate(item.id)}>{item.label}</button>)}
          </nav>
          <div className="nav-right">
            <span className="rank-badge">{rankState?.official_battle_place ? `#${rankState.official_battle_place}` : '—'}</span>
            <JoinDiscordButton size="sm" className="nav-discord-btn" />
            <button className="icon-btn" onClick={() => setNotificationsOpen((open) => !open)} aria-label="Notifications"><Bell size={18} />{unreadCount > 0 && <span className="notif-dot" />}</button>
            <button className="menu-btn" onClick={() => setMobileOpen((open) => !open)} aria-label="Menu">{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
          </div>
        </div>
        {notificationsOpen && <div className="notif-panel"><div className="notif-title">Notifications {unreadCount > 0 && <span>{unreadCount} new</span>}</div>{notifications.length === 0 ? <div className="notif-item"><span>No notifications yet</span></div> : notifications.slice(0, 8).map((notif) => <div key={notif.id} className="notif-item"><Zap size={15} /><span>{notif.title}</span></div>)}<button className="notif-clear" onClick={() => setNotificationsOpen(false)}>Close</button></div>}
      </header>
      <div className={`drawer-scrim ${mobileOpen ? 'open' : ''}`} onClick={() => setMobileOpen(false)} aria-hidden="true" />
      <aside className={`nav-drawer ${mobileOpen ? 'open' : ''}`} aria-hidden={!mobileOpen}>
        <div className="drawer-head">
          <div className="drawer-brand"><LogoMark /><span className="brand-name">NANZ</span></div>
          <button className="menu-btn drawer-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={20} /></button>
        </div>
        <nav className="drawer-nav">
          {menuNavItems.map((item, index) => (
            <button
              key={item.id}
              className={`drawer-item ${activeSection === item.id ? 'active' : ''}`}
              style={{ transitionDelay: mobileOpen ? `${80 + index * 24}ms` : '0ms' }}
              onClick={() => navigate(item.id)}
            >
              <span className="drawer-item-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="drawer-item-label">{item.label}</span>
              {activeSection === item.id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="drawer-foot">
          <JoinDiscordButton size="sm" className="drawer-discord" />
          <span className="drawer-tag">BUILT TO COMPETE. BORN TO DOMINATE.</span>
        </div>
      </aside>

      <main>
        {adminMode && <><AdminDiagnostics rankState={rankState} liveMembers={liveMembers} snapshots={snapshots} onSync={async () => { await supabase.functions.invoke('nanz-ranking'); }} /><StaffAdmin /><DiscordAdmin passkey={window.sessionStorage.getItem('nanz_staff_key') ?? ''} /></>}

        {!adminMode && <>
        {activeSection === 'home' && <Home members={liveMembers} onNavigate={navigate} onProfile={(member) => setProfile({ member, rank: 0 })} timeLabel={timeLabel} rankState={rankState} rewards={rewards} avatars={avatars} />}
        {activeSection === 'clan' && <Clan members={liveMembers} memberCount={rankState?.member_count ?? 0} onProfile={(member) => setProfile({ member, rank: 0 })} avatars={avatars} rankState={rankState} />}
        {activeSection === 'battle' && <Battle timeLabel={timeLabel} rankState={rankState} snapshots={snapshots} />}
        {activeSection === 'leaderboard' && <Leaderboard members={visibleMembers} search={search} setSearch={setSearch} sortDescending={sortDescending} setSortDescending={setSortDescending} onProfile={(member) => setProfile({ member, rank: 0 })} avatars={avatars} />}
        {activeSection === 'rewards' && <Rewards members={liveMembers} rewards={rewards} rankState={rankState} avatars={avatars} />}
        {activeSection === 'apply' && <Apply applicationStatus={applicationStatus} applicationReference={applicationReference} onTrack={() => navigate('status')} onSubmit={submitApplication} />}
        {activeSection === 'players' && <PlayerUniverse avatars={avatars} onNavigate={navigate} deepLink={playerDeepLink} />}
        {activeSection === 'rivals' && <RivalIntelligence scanState={rankState} />}
        {activeSection === 'goals' && <RivalIntelligence scanState={rankState} initialView="goals" />}
        {activeSection === 'hof' && <HallOfFame avatars={avatars} onOpenProfile={(username, userId) => navigate(`players/${username}:${userId}`)} />}
        {activeSection === 'archive' && <BattleArchive avatars={avatars} onOpenProfile={(username, userId) => navigate(`players/${username}:${userId}`)} />}
        {activeSection === 'community' && <DiscordCommunity onNavigate={(section) => navigate(section)} />}
        {activeSection === 'status' && <ApplicationStatus />}
        </>}
      </main>

      {profile && <PlayerProfileModal member={{ name: profile.member.name, user_id: profile.member.user_id ?? 0, points: profile.member.points, rank: (liveMembers.findIndex((m) => m.name === profile.member.name) + 1) || profile.rank, initials: profile.member.initials, color: profile.member.color, avatarUrl: avatars[profile.member.name.toLowerCase()]?.avatar_url ?? null }} onClose={() => setProfile(null)} avatars={avatars} />}
      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand"><LogoMark /><span>© 2026 NANZ</span></div>
          <span className="footer-tag">Built to compete. Born to dominate.</span>
          <div className="footer-actions"><JoinDiscordButton size="sm" /><button className="footer-link" onClick={() => navigate('community')}>Community</button><button className="footer-link" onClick={() => navigate('status')}>Application Status</button></div>
          <span className="footer-live"><span className="live-dot" /> All systems operational</span>
        </div>
      </footer>
    </div>
  );
}

function Home({ members, onNavigate, onProfile, timeLabel, rankState, rewards, avatars }: { members: Member[]; onNavigate: (section: Section) => void; onProfile: (member: Member) => void; timeLabel: string; rankState: BattleScanState | null; rewards: BattleReward[]; avatars: AvatarMap }) {
  const officialPlace = rankState?.official_battle_place;
  return <>
    <section className="hero-section">
      <div className="hero-container">
        <div className="hero-text">
          <Pill tone="pink">NANZ Clan</Pill>
          <h1 className="hero-title">Built to compete.<br /><span className="title-accent">Born to dominate.</span></h1>
          <p className="hero-sub">NANZ is built for players who take competition seriously. Every point matters. Every contribution counts. Every battle is an opportunity to prove yourself.</p>
          <div className="hero-buttons">
            <button className="btn-primary" onClick={() => onNavigate('apply')}>Apply to NANZ <ArrowUpRight size={18} /></button>
            <button className="btn-secondary" onClick={() => onNavigate('leaderboard')}>View Live Ranking <ChevronRight size={16} /></button>
            <JoinDiscordButton size="lg" />
          </div>
          <div className="hero-meta">
            <span><Target size={15} /> Daily standard <b>1,000 pts</b></span>
            <span><Gem size={15} /> Top 5 bonus <b>5B gems</b></span>
            <span><Activity size={15} /> NANZ <b>active</b></span>
          </div>
        </div>
        <div className="hero-visual">
          <img className="hero-logo" src="/image.png" alt="NANZ clan logo" />
          <div className="hero-stat-card">
            <span>Current Global Place</span>
            <strong>{officialPlace ? `#${officialPlace}` : '—'}</strong>
            <small>{rankState?.battle_name ?? 'Waiting for sync'}</small>
          </div>
        </div>
      </div>
    </section>
    <section className="stats-row">
      <StatCard label="Global Rank" value={officialPlace ? `#${officialPlace}` : '—'} meta="Official API place" icon={<Globe2 size={22} />} />
      <StatCard label="Battle Points" value={rankState?.nanz_battle_points ? formatNumber(rankState.nanz_battle_points) : '—'} meta={rankState?.battle_name ?? 'Unavailable'} icon={<Swords size={22} />} />
      <StatCard label="Clan Members" value={rankState?.member_count ? formatNumber(rankState.member_count) : '—'} meta={`${rankState?.active_contributor_count ?? '—'} active contributors`} icon={<Users size={22} />} />
      <StatCard label="Reward Tiers" value={rewards.length ? formatNumber(rewards.length) : '—'} meta="Official rewards" icon={<Trophy size={22} />} />
    </section>
    <section className="content-block">
      <SectionHeader kicker="Who we are" title="The NANZ" accent="Standard" trailing="Discipline · Performance · Community" />
      <div className="principle-grid">
        <PrincipleCard icon={<Swords size={24} />} title="Competitive First" text="We focus on Pet Simulator 99 Clan Battles. Preparation, contribution and smart teamwork are at the center of everything we do." />
        <PrincipleCard icon={<BarChart3 size={24} />} title="Consistency Wins" text="Our daily member standard is 1,000 battle points. We track progress transparently and recognize people who put in the work." />
        <PrincipleCard icon={<Diamond size={24} />} title="Rewards That Matter" text="The final top five individual contributors are eligible for a NANZ-funded bonus, paid manually by clan leadership." />
      </div>
    </section>
    <section className="content-block">
      <SectionHeader kicker="Live battle" title="Current" accent="Battle" trailing="Active event" />
      <div className="battle-overview">
        <div className="battle-card">
          <span className="card-label">Active event</span>
          <h3>{rankState?.battle_name ?? 'Active Battle'}</h3>
          <p>Battle ID: {rankState?.battle_id ?? 'Unavailable'} · {rankState?.is_stale ? 'Cached result' : 'Collector snapshot'}</p>
          <div className="big-number"><span>NANZ Battle Points</span><b>{rankState?.nanz_battle_points ? formatNumber(rankState.nanz_battle_points) : 'Unavailable'}</b></div>
        </div>
        <div className="battle-card">
          <span className="card-label">Data Integrity</span>
          <h3>Real data. Clear labels.</h3>
          <p>Battle contribution records are separated from all-time clan points. This view uses the available clan snapshot and never presents all-time rank as current placement.</p>
          <Pill tone="gray">Cached snapshot</Pill>
        </div>
      </div>
    </section>
    <section className="content-block">
      <SectionHeader kicker="The ones putting in work" title="Live" accent="Leaderboard" trailing="Top 5 contributors" />
      <div className="glass-card"><LeaderboardRows members={members.slice(0, 5)} onProfile={onProfile} avatars={avatars} /></div>
      <button className="text-link" onClick={() => onNavigate('leaderboard')}>Open full leaderboard <ArrowUpRight size={16} /></button>
    </section>
    <section className="content-block">
      <SectionHeader kicker="Explore every member" title="Player" accent="Universe" trailing="Profiles · Achievements · Awards" />
      <div className="principle-grid">
        <PrincipleCard icon={<Users size={24} />} title="Player Directory" text="Browse every NANZ member with live battle points, reputation levels, achievement counts and contribution rankings." />
        <PrincipleCard icon={<Trophy size={24} />} title="Achievements" text="27 unlockable achievements across battle performance, consistency, contribution, community and special categories." />
        <PrincipleCard icon={<Award size={24} />} title="NANZ Awards" text="Official clan recognition with automatic calculation for Player of the Week, Battle MVP, Most Consistent and more." />
      </div>
      <button className="btn-secondary" onClick={() => onNavigate('players')}>Open Player Universe <ChevronRight size={16} /></button>
    </section>
    <section className="content-block">
      <SectionHeader kicker="Competitive intelligence & legacy" title="Know the enemy." accent="Honor the greats." trailing="4 new systems" />
      <div className="principle-grid">
        <PrincipleCard icon={<Crosshair size={24} />} title="Rival Intelligence" text="Track verified rival clans side-by-side with NANZ, live development charts, rival alerts and a clearly labeled rank simulator." />
        <PrincipleCard icon={<Target size={24} />} title="Clan Goals & Missions" text="Clan-wide goals with automatic progress after every sync, individual missions and a mission leaderboard." />
        <PrincipleCard icon={<Crown size={24} />} title="Hall of Fame" text="All-time legends, battle records, most consistent contributors and management honors — computed from tracked history only." />
        <PrincipleCard icon={<BarChart3 size={24} />} title="Battle Archive" text="Every battle permanently archived with completeness labels, full reports and side-by-side comparisons. History is never deleted." />
      </div>
      <div className="hero-buttons">
        <button className="btn-secondary" onClick={() => onNavigate('rivals')}>Rival Intelligence <ChevronRight size={16} /></button>
        <button className="btn-secondary" onClick={() => onNavigate('hof')}>Hall of Fame <ChevronRight size={16} /></button>
        <button className="btn-secondary" onClick={() => onNavigate('archive')}>Battle Archive <ChevronRight size={16} /></button>
      </div>
    </section>
    <section className="countdown-banner">
      <div>
        <span className="kicker">Battle countdown</span>
        <h2>The clock is <span className="accent-text">running.</span></h2>
        <p>The current battle ends in <strong>{timeLabel}</strong>. Every point changes the board.</p>
      </div>
      <button className="btn-secondary" onClick={() => onNavigate('battle')}>Open Battle Center <Crosshair size={16} /></button>
    </section>
  </>;
}

function StatCard({ label, value, meta, icon }: { label: string; value: string; meta: string; icon: JSX.Element }) { return <div className="stat-tile"><div className="stat-icon">{icon}</div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><small className="stat-meta">{meta}</small></div>; }
function PrincipleCard({ icon, title, text }: { icon: JSX.Element; title: string; text: string }) { return <article className="principle-tile"><div className="principle-icon">{icon}</div><h3>{title}</h3><p>{text}</p></article>; }

function Clan({ members, memberCount, onProfile, avatars, rankState }: { members: Member[]; memberCount: number; onProfile: (member: Member) => void; avatars: AvatarMap; rankState: BattleScanState | null }) {
  const [archivedTotal, setArchivedTotal] = useState<number | null>(null);
  const [archiveCount, setArchiveCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from('nanz_battle_archive').select('battle_id, nanz_final_points');
      if (cancelled || !data) return;
      const rows = data as { battle_id: string; nanz_final_points: number | null }[];
      const currentBattle = rankState?.battle_id;
      let total = 0;
      let count = 0;
      for (const row of rows) {
        if (row.nanz_final_points === null) continue;
        if (currentBattle && row.battle_id === currentBattle) continue;
        total += row.nanz_final_points;
        count += 1;
      }
      setArchivedTotal(total);
      setArchiveCount(count);
    };
    void load();
    return () => { cancelled = true; };
  }, [rankState?.battle_id]);

  const livePoints = rankState?.nanz_battle_points ?? 0;
  const allTimePoints = (archivedTotal ?? 0) + livePoints;
  const allTimeKnown = archivedTotal !== null || livePoints > 0;
  const coverage = rankState?.scan_coverage != null ? Math.round(rankState.scan_coverage) : null;

  const OWNER_USER_ID = 4616447639;
  const ownerIndex = members.findIndex((member) => member.user_id === OWNER_USER_ID);
  const isOwner = (member: Member) => member.user_id === OWNER_USER_ID;

  return <div className="page-inner">
    <SectionHeader kicker="The organization" title="The" accent="NANZ" trailing={`Clan · Roster ${memberCount || '—'} / 50`} />
    <div className="clan-banner">
      <div className="clan-emblem"><img src="/images/clan/image copy.png" alt="NANZ clan emblem" /></div>
      <div className="clan-info">
        <Pill tone="pink">Pet Simulator 99 · Verified roster</Pill>
        <h1><span className="accent-text">NANZ</span></h1>
        <p>Discipline, performance and community. A competitive clan for players who want their contribution to be counted.</p>
      </div>
      <div className="clan-score">
        <span>All-time clan points</span>
        <b>{allTimeKnown ? formatNumber(allTimePoints) : '—'}</b>
        <small>{archiveCount > 0 ? `${archiveCount} completed battle${archiveCount === 1 ? '' : 's'} + current` : 'Current battle'} · live-tracked total</small>
      </div>
    </div>
    <div className="clan-stat-row">
      <InfoTile icon={<Shield size={20} />} title="Our Standard" value="1,000" label="Daily battle points" />
      <InfoTile icon={<Trophy size={20} />} title="Reward Pool" value="25B" label="Gems · Top 5" />
      <InfoTile icon={<Activity size={20} />} title="Data Coverage" value={coverage !== null ? `${coverage}%` : '100%'} label="Roster snapshot" />
    </div>
    <div className="clan-layout">
      <div className="glass-card roster-card">
        <div className="card-header"><div><span className="card-label">Member directory</span><h3>The Roster</h3></div><Pill tone="blue">{`${memberCount || '—'} members`}</Pill></div>
        <div className="roster-list">{members.map((member, index) => <button key={member.name} onClick={() => onProfile(member)} className={`roster-item ${isOwner(member) ? 'is-owner' : ''}`}><AvatarImage member={member} avatars={avatars} className="avatar" /><span className="roster-name"><b>{member.name}</b><small>{isOwner(member) ? 'Clan Owner · NANZ ELITE' : member.role}</small></span><strong className="roster-rank">#{index + 1}</strong>{isOwner(member) && <Crown size={15} className="roster-owner-crown" />}</button>)}</div>
      </div>
      <div className="clan-side">
        <div className="owner-card">
          <div className="owner-card-top"><Crown size={18} /><span>CLAN OWNER</span></div>
          <AvatarImage member={ownerIndex >= 0 ? members[ownerIndex] : { name: 'NodaBoda 01', color: '#ff375f', initials: 'NO', points: 0, role: 'Owner', trend: 'steady' } as Member} avatars={avatars} className="owner-avatar" />
          <b>{ownerIndex >= 0 ? members[ownerIndex].name : 'NodaBoda 01'}</b>
          <small>Leading NANZ ELITE · Final authority on roster, strategy and rewards</small>
          {ownerIndex >= 0 && <Pill tone="gold">{`Rank #${ownerIndex + 1} this battle`}</Pill>}
        </div>
        <div className="clan-info-note"><InfoTile icon={<Globe2 size={20} />} title="Battle Place" value={rankState?.official_battle_place ? `#${rankState.official_battle_place}` : '—'} label="Official API ranking" /></div>
      </div>
    </div>
  </div>;
}

function InfoTile({ icon, title, value, label }: { icon: JSX.Element; title: string; value: string; label: string }) { return <div className="info-tile"><div className="info-icon">{icon}</div><span className="info-title">{title}</span><strong className="info-value">{value}</strong><small className="info-label">{label}</small></div>; }

function Battle({ timeLabel, rankState, snapshots }: { timeLabel: string; rankState: BattleScanState | null; snapshots: BattlePointSnapshot[] }) {
  const officialPlace = rankState?.official_battle_place;
  const currentRank = rankState?.is_complete ? rankState.rank_within_scanned_clans : officialPlace;
  const rankLabel = rankState?.is_complete ? 'Calculated across scanned clans' : 'API current battle place';
  return <div className="page-inner"><SectionHeader kicker="Command center" title="Current" accent="Battle" trailing={rankState?.api_status === 'connected' ? 'Live data' : 'Cached data'} /><ApiHealthBanner rankState={rankState} /><div className="battle-hero-card"><div className="battle-hero-left"><Pill tone="pink">Active event</Pill><h1>{rankState?.battle_name ?? 'Active'}<span className="accent-text">{rankState?.battle_id ? ' Battle' : ''}</span></h1><p>Live contribution window · Battle ID {rankState?.battle_id ?? 'Unavailable'}</p><div className="countdown-display"><span>{timeLabel === 'Awaiting battle timing' ? 'Battle timing' : 'Battle ends in'}</span><b>{timeLabel}</b></div></div><div className="battle-ring-visual"><div className="ring-inner"><strong>{currentRank ? `#${currentRank}` : '—'}</strong><span>{rankLabel}</span></div></div></div><div className="battle-kpi-row"><InfoTile icon={<Swords size={22} />} title="NANZ Points" value={rankState?.nanz_battle_points !== null && rankState?.nanz_battle_points !== undefined ? formatNumber(rankState.nanz_battle_points) : '—'} label={rankState?.battle_name ?? 'Unavailable'} /><InfoTile icon={<BarChart3 size={22} />} title="Points / Hour" value={rankState?.points_per_hour ? `${formatNumber(Math.round(rankState.points_per_hour))}` : 'AWAITING DATA'} label={rankState?.points_per_hour ? 'Calculated from snapshots' : 'Needs history'} /><InfoTile icon={<Trophy size={22} />} title="Battle Status" value={rankState?.is_stale ? 'STALE' : rankState?.api_status === 'connected' ? 'Connected' : 'Waiting'} label={rankState?.last_successful_scan_at ? new Date(rankState.last_successful_scan_at).toLocaleString() : 'No sync yet'} /></div><div className="battle-analytics"><div className="glass-card chart-block"><div className="card-header"><div><span className="card-label">Contribution rate</span><h3>Points Development</h3></div><Pill tone="gray">{snapshots.length > 1 ? 'Historical data' : 'Awaiting data'}</Pill></div><PointsChart snapshots={snapshots} /></div><div className="glass-card timeline-block"><span className="card-label">Battle timeline</span><h3>Milestones</h3><TimelineRow label="Battle activated" time={rankState?.battle_start_time ? new Date(rankState.battle_start_time).toLocaleString() : 'Awaiting data'} done={Boolean(rankState?.battle_start_time)} /><TimelineRow label="Latest sync" time={rankState?.last_successful_scan_at ? new Date(rankState.last_successful_scan_at).toLocaleString() : 'Awaiting data'} done={Boolean(rankState?.last_successful_scan_at)} /><TimelineRow label="Battle close" time={timeLabel} /></div></div></div>;
}

function ApiHealthBanner({ rankState }: { rankState: BattleScanState | null }) {
  if (!rankState) return null;
  const status = rankState.api_status;
  const isError = status === 'error' || rankState.is_stale;
  const isConnected = status === 'connected' && !rankState.is_stale;
  const tone = isError ? 'error' : isConnected ? 'ok' : 'idle';
  const label = isError ? (rankState.last_api_error ?? 'Cached — last sync failed') : isConnected ? 'BIG Games API connected · live data' : 'Awaiting first sync';
  const lastSync = rankState.sync_completed_at ? new Date(rankState.sync_completed_at).toLocaleString() : 'Never';
  return <div className={`api-health-banner ${tone}`}><span className={`api-health-dot ${tone}`} /><div className="api-health-text"><strong>{label}</strong><small>Last sync {lastSync} · {rankState.successful_profile_requests} OK / {rankState.failed_profile_requests} failed profile requests</small></div></div>;
}

function PointsChart({ snapshots }: { snapshots: BattlePointSnapshot[] }) {
  const [range, setRange] = useState<'1h' | '6h' | '24h' | '7d' | 'battle'>('battle');
  const now = Date.now();
  const rangeMs: Record<'1h' | '6h' | '24h' | '7d' | 'battle', number> = { '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000, '7d': 604_800_000, battle: Number.POSITIVE_INFINITY };
  const visible = snapshots.filter((snapshot) => now - new Date(snapshot.captured_at).getTime() <= rangeMs[range]);
  if (visible.length < 2) return <div><div className="chart-range-tabs">{(['1h', '6h', '24h', '7d', 'battle'] as const).map((item) => <button key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{item === 'battle' ? 'Battle' : item}</button>)}</div><div className="chart-placeholder">At least two saved snapshots are needed to show points development.</div></div>;
  const min = Math.min(...visible.map((item) => item.battle_points));
  const max = Math.max(...visible.map((item) => item.battle_points));
  const width = 680;
  const height = 190;
  const points = visible.map((item, index) => `${(index / (visible.length - 1)) * width},${height - ((item.battle_points - min) / Math.max(1, max - min)) * (height - 20) - 10}`).join(' ');
  const best = visible.reduce((winner, item, index) => index === 0 ? winner : item.battle_points - visible[index - 1].battle_points > winner.gain ? { item, gain: item.battle_points - visible[index - 1].battle_points } : winner, { item: visible[0], gain: 0 });
  return <div><div className="chart-range-tabs">{(['1h', '6h', '24h', '7d', 'battle'] as const).map((item) => <button key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{item === 'battle' ? 'Battle' : item}</button>)}</div><div className="points-chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="NANZ battle points over time" preserveAspectRatio="none"><polyline points={points} fill="none" stroke="var(--pink)" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg><div className="chart-tooltip-row"><span>{new Date(visible[0].captured_at).toLocaleString()}</span><strong>{formatNumber(visible[visible.length - 1].battle_points)} points</strong><span>{best.gain > 0 ? `Best period +${formatNumber(best.gain)}` : 'No increase recorded yet'}</span></div></div></div>;
}
function TimelineRow({ label, time, done }: { label: string; time: string; done?: boolean }) { return <div className="timeline-item"><span className={done ? 'timeline-dot done' : 'timeline-dot'}>{done && <Check size={11} />}</span><span className="timeline-label">{label}</span><b className="timeline-time">{time}</b></div>; }

function Leaderboard({ members: list, search, setSearch, sortDescending, setSortDescending, onProfile, avatars }: { members: Member[]; search: string; setSearch: (value: string) => void; sortDescending: boolean; setSortDescending: (value: boolean) => void; onProfile: (member: Member) => void; avatars: AvatarMap }) {
  return <div className="page-inner"><SectionHeader kicker="The ones putting in work" title="Live" accent="Leaderboard" trailing="Current contributors" />{list.length >= 3 ? <div className="podium-row"><PodiumCard member={list[1]} rank="02" tone="silver" onProfile={onProfile} avatars={avatars} /><PodiumCard member={list[0]} rank="01" tone="gold" onProfile={onProfile} avatars={avatars} /><PodiumCard member={list[2]} rank="03" tone="bronze" onProfile={onProfile} avatars={avatars} /></div> : <div className="empty-state">Live member contributions are awaiting the first successful synchronization.</div>}<div className="lb-controls"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search players..." /></div><button className="btn-pill" onClick={() => setSortDescending(!sortDescending)}>{sortDescending ? 'Highest points' : 'Lowest points'} <ChevronRight size={14} /></button><Pill tone="gray">Live snapshot</Pill></div><div className="glass-card"><div className="lb-header"><span>Rank</span><span>Player</span><span>Role</span><span>Battle Points</span></div><LeaderboardRows members={list} onProfile={onProfile} avatars={avatars} /></div></div>;
}
function PodiumCard({ member, rank, tone, onProfile, avatars }: { member: Member; rank: string; tone: string; onProfile: (member: Member) => void; avatars: AvatarMap }) { return <button className={`podium-card podium-${tone}`} onClick={() => onProfile(member)}><span className="podium-rank">{rank}</span><AvatarImage member={member} avatars={avatars} className="podium-avatar" /><b className="podium-name">{member.name}</b><strong className="podium-points">{formatNumber(member.points)}</strong><small className="podium-label">Battle points</small></button>; }
function LeaderboardRows({ members: list, onProfile, avatars }: { members: Member[]; onProfile: (member: Member) => void; avatars: AvatarMap }) { return <div>{list.map((member, index) => <button className="lb-row" key={member.name} onClick={() => onProfile(member)}><span className="lb-rank">#{index + 1}</span><span className="lb-player"><AvatarImage member={member} avatars={avatars} className="avatar" /><b>{member.name}</b></span><span className="lb-role">{member.role}</span><span className="lb-points">{formatNumber(member.points)} <span className={`trend ${member.trend}`}>{member.trend === 'up' ? <ArrowUpRight size={14} /> : member.trend === 'down' ? <ArrowDownRight size={14} /> : <span>—</span>}</span></span></button>)}</div>; }

function Rewards({ members: list, rankState, avatars }: { members: Member[]; rewards: BattleReward[]; rankState: BattleScanState | null; avatars: AvatarMap }) {
  const officialPlace = rankState?.official_battle_place ?? null;
  const currentPoints = rankState?.nanz_battle_points ?? null;
  const eligibleRewards = officialPlace ? officialRewards.filter((reward) => officialPlace >= reward.bestPlace && officialPlace <= reward.worstPlace) : [];

  const getProgress = (reward: OfficialReward) => {
    const eligible = officialPlace !== null && officialPlace >= reward.bestPlace && officialPlace <= reward.worstPlace;
    const ranksAway = officialPlace === null ? null : Math.max(0, officialPlace - reward.worstPlace);
    const pointsAway = currentPoints === null || eligible ? 0 : Math.max(0, reward.targetPoints - currentPoints);
    return { eligible, ranksAway, pointsAway };
  };

  return <div className="page-inner"><SectionHeader kicker="Official battle rewards" title="Battle" accent="Rewards" trailing="From Big Games API" /><div className="reward-hero"><div><Pill tone="gold">Official reward board</Pill><h1>Every rank<br /><span className="accent-text">counts.</span></h1><p>All official rewards for the current Big Games Clan Battle. Every member in your clan gets the prize when NANZ reaches the required placement.</p></div><div className="reward-place"><span>NANZ current place</span><b>#{officialPlace ?? '—'}</b><small>{currentPoints !== null ? `${formatNumber(currentPoints)} battle points` : 'Waiting for sync'} · {rankState?.battle_name ?? 'Battle'}</small></div></div>

  <div className="reward-summary"><div><span className="summary-label">Current status</span><strong>{eligibleRewards.length} rewards unlocked</strong><small>{officialPlace ? `NANZ is currently #${officialPlace}` : 'Official rank not synced yet'}</small></div><div><span className="summary-label">Clan-wide prize</span><strong>Every member gets it</strong><small>Rewards are awarded to the entire clan</small></div><div><span className="summary-label">Points shown</span><strong>{currentPoints !== null ? formatNumber(currentPoints) : '—'}</strong><small>Current NANZ battle points</small></div></div>

  {eligibleRewards.length > 0 && <div className="eligible-notice"><Check size={22} /><div><strong>NANZ currently earns {eligibleRewards.length} official reward{eligibleRewards.length > 1 ? 's' : ''}</strong><p>{eligibleRewards.map((reward) => reward.title).join(' · ')}</p></div></div>}

  <div className="reward-section-intro"><div><span className="kicker">Official prize ladder</span><h2>Pets, cosmetics<br />and clan rewards</h2></div><p>See exactly what is unlocked now, how many ranks separate NANZ from the next tier and the point target shown by the latest ranking snapshot.</p></div>
  <div className="official-reward-grid">{officialRewards.map((reward) => {
    const progress = getProgress(reward);
    return <article className={`official-reward-card ${progress.eligible ? 'is-eligible' : ''}`} key={reward.title}>
      <div className="reward-image-wrap"><img src={reward.image} alt={reward.title} /><span className={`reward-state ${progress.eligible ? 'unlocked' : ''}`}>{progress.eligible ? 'Unlocked' : 'Next target'}</span></div>
      <div className="official-reward-copy"><span className="reward-range">{reward.range}</span><h3>{reward.title}</h3><span className="reward-kind">{reward.kind === 'pet' ? 'Pet reward' : reward.kind === 'cosmetic' ? 'Cosmetic reward' : 'Clan reward'}</span></div>
      <div className="reward-progress"><div className="progress-row"><span>Rank distance</span><strong>{progress.eligible ? 'Qualified' : progress.ranksAway !== null ? `${progress.ranksAway} ranks to go` : '—'}</strong></div><div className="progress-row"><span>Points needed</span><strong>{progress.eligible ? '0 points' : currentPoints !== null ? `${formatNumber(progress.pointsAway)} points` : '—'}</strong></div>{!progress.eligible && currentPoints !== null && <div className="progress-track"><span style={{ width: `${Math.min(100, Math.max(5, (currentPoints / reward.targetPoints) * 100))}%` }} /></div>}</div>
    </article>;
  })}</div>

  <div className="medal-section"><SectionHeader kicker="Clan placement medals" title="Medals" accent="for the clan" trailing="Every member gets the prize" /><div className="medal-grid"><MedalCard title="Gold Medal" range="#1 Clan" tone="gold" /><MedalCard title="Silver Medal" range="#2–8 Clans" tone="silver" /><MedalCard title="Bronze Medal" range="#9–20 Clans" tone="bronze" /></div><p className="medal-note">Every member in your clan gets the prize. Medal artwork is shown using the exact provided reward assets.</p></div>

  <div className="reward-divider"><SectionHeader kicker="NANZ owner bonus" title="Internal" accent="Rewards" trailing="Owner-funded" /></div><div className="reward-cards">{list.slice(0, 5).map((member, index) => <div className={`reward-tile rank-${index + 1}`} key={member.name}><span className="reward-pos">#{String(index + 1).padStart(2, '0')}</span><AvatarImage member={member} avatars={avatars} className="reward-av" /><div className="reward-detail"><b>{member.name}</b><small>{formatNumber(member.points)} points</small></div><strong className="reward-amount">5B <small>gems</small></strong><span className="reward-status"><Check size={13} /> Eligible</span></div>)}</div><div className="reward-footnote"><Award size={18} /><span>Official rewards come from the BIG Games API. Internal NANZ bonuses are paid manually by leadership after the battle closes.</span></div></div>;
}

function MedalCard({ title, range, tone }: { title: string; range: string; tone: 'gold' | 'silver' | 'bronze' }) {
  return <article className={`medal-card medal-${tone}`}><div className="medal-ring"><span>{tone === 'gold' ? '1' : tone === 'silver' ? '2–8' : '9–20'}</span></div><div><span>{range}</span><h3>{title}</h3><small>Every clan member receives this prize</small></div></article>;
}

function Apply({ applicationStatus, applicationReference, onTrack, onSubmit }: { applicationStatus: 'idle' | 'sending' | 'sent' | 'error'; applicationReference: string | null; onTrack: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <div className="page-inner"><SectionHeader kicker="Your next move starts here" title="Join" accent="NANZ" trailing="Reviewed by NANZ management" /><div className="apply-grid"><div className="apply-side"><div className="apply-logo"><img src="/image.png" alt="NANZ clan logo" /></div><Pill tone="pink">Recruitment open</Pill><h2>Ready to<br /><span className="accent-text">represent?</span></h2><p>Tell us who you are, how you play and why you belong in NANZ. Our management team reviews every application in Discord.</p><div className="apply-expectation"><Target size={18} /><span>Minimum expectation<br /><b>1,000 battle points / day</b></span></div><div className="apply-discord-cta"><JoinDiscordButton size="md" /></div></div><form className="apply-form" onSubmit={onSubmit}>{applicationStatus === 'sent' ? <div className="success-block"><div className="success-check"><Check size={30} /></div><h2>Application<br /><span className="accent-text">received.</span></h2><p>Your application is ready for NANZ management review. Keep an eye on your community messages for the next move.</p>{applicationReference && <div className="reference-block"><span className="card-label">Your application reference</span><b className="reference-code">{applicationReference}</b><small>Save this code. Use it on the Application Status page to track your application at any time.</small></div>}{applicationReference && <button type="button" className="btn-secondary" onClick={onTrack}>Track my application</button>}<button type="button" className="btn-secondary" onClick={() => window.location.reload()}>Submit another</button></div> : <><div className="form-header"><span className="card-label">Enter the arena</span><h3>Player Application</h3></div><div className="form-fields"><label>Roblox Username *<input name="roblox_username" required placeholder="Your Roblox username" /></label><label>Discord Username *<input name="discord_username" required placeholder="name or @name" /></label><label>Roblox User ID<input name="roblox_user_id" inputMode="numeric" placeholder="Numeric user ID" /></label><label>Daily Playtime *<select name="daily_playtime" required defaultValue=""><option value="" disabled>Choose...</option><option>1–2 hours</option><option>3–4 hours</option><option>5+ hours</option></select></label><label>Daily Points Potential *<select name="daily_points_potential" required defaultValue=""><option value="" disabled>Choose...</option><option>1,000–2,000</option><option>2,000–5,000</option><option>5,000+</option></select></label><label>Previous Clan<input name="previous_clan" placeholder="Optional" /></label><label className="full-width">Why should NANZ accept you? *<textarea name="experience" required minLength={20} rows={4} placeholder="Tell us about your activity, experience and what you bring to NANZ..." /></label></div><label className="checkbox-row"><input type="checkbox" required /> I confirm that the information is correct and agree to be contacted by NANZ management.</label><button className="btn-primary btn-submit" disabled={applicationStatus === 'sending'}>{applicationStatus === 'sending' ? 'Sending application...' : 'Submit Application'} <ArrowUpRight size={16} /></button>{applicationStatus === 'error' && <small className="form-error">The application could not be saved. Please try again.</small>}<small className="form-hint">Never enter your Roblox password, cookies or account credentials.</small></>}</form></div></div> }

function AdminDiagnostics({ rankState, liveMembers, snapshots, onSync }: { rankState: BattleScanState | null; liveMembers: Member[]; snapshots: BattlePointSnapshot[]; onSync: () => Promise<void> }) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [modules, setModules] = useState<ModuleStatus[]>([]);

  useEffect(() => {
    supabase.from('nanz_module_status').select('id, module_name, is_active, database_ready, last_successful_update, integration_status, last_error').order('module_name', { ascending: true }).then(({ data }) => { setModules((data ?? []) as ModuleStatus[]); });
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      await onSync();
      setResult('Sync triggered successfully. Data refreshed from BIG Games API.');
    } catch {
      setResult('Sync request failed. Check the API health status below.');
    } finally {
      setSyncing(false);
    }
  };

  const rows: { label: string; value: string }[] = rankState ? [
    { label: 'Battle ID', value: rankState.battle_id ?? '—' },
    { label: 'Battle Name', value: rankState.battle_name ?? '—' },
    { label: 'API Status', value: rankState.api_status },
    { label: 'Is Stale', value: String(rankState.is_stale) },
    { label: 'Is Complete', value: String(rankState.is_complete) },
    { label: 'NANZ Battle Points', value: rankState.nanz_battle_points !== null ? formatNumber(rankState.nanz_battle_points) : '—' },
    { label: 'Official Battle Place', value: rankState.official_battle_place ? `#${rankState.official_battle_place}` : '—' },
    { label: 'Computed Rank (scanned)', value: rankState.rank_within_scanned_clans ? `#${rankState.rank_within_scanned_clans}` : '—' },
    { label: 'Member Count', value: formatNumber(rankState.member_count) },
    { label: 'Active Contributors', value: formatNumber(rankState.active_contributor_count) },
    { label: 'Points / Hour', value: rankState.points_per_hour ? formatNumber(Math.round(rankState.points_per_hour)) : '—' },
    { label: 'Scan Coverage', value: `${rankState.scan_coverage}%` },
    { label: 'Scanned / Candidate Clans', value: `${rankState.scanned_clan_count} / ${rankState.candidate_clan_count}` },
    { label: 'Candidate Cursor', value: String(rankState.candidate_cursor ?? 0) },
    { label: 'Scan Depth', value: String(rankState.scan_depth ?? 0) },
    { label: 'Successful Profile Requests', value: String(rankState.successful_profile_requests) },
    { label: 'Failed Profile Requests', value: String(rankState.failed_profile_requests) },
    { label: 'Last API Error', value: rankState.last_api_error ?? 'None' },
    { label: 'Last Successful Scan', value: rankState.last_successful_scan_at ? new Date(rankState.last_successful_scan_at).toLocaleString() : 'Never' },
    { label: 'Sync Completed At', value: rankState.sync_completed_at ? new Date(rankState.sync_completed_at).toLocaleString() : 'Never' },
    { label: 'Next Sync At', value: rankState.next_sync_at ? new Date(rankState.next_sync_at).toLocaleString() : '—' },
    { label: 'Battle Start Time', value: rankState.battle_start_time ? new Date(rankState.battle_start_time).toLocaleString() : '—' },
    { label: 'Battle Finish Time', value: rankState.battle_finish_time ? new Date(rankState.battle_finish_time).toLocaleString() : '—' },
  ] : [];

  const moduleTone = (status: string): 'blue' | 'pink' | 'gold' | 'gray' => status === 'connected' ? 'blue' : status === 'error' ? 'pink' : status === 'configured' ? 'gold' : 'gray';

  return <div className="page-inner admin-panel"><SectionHeader kicker="Admin only" title="Diagnostics" accent="Panel" trailing="NANZ live sync" /><div className="admin-actions"><button className="btn-primary" onClick={handleSync} disabled={syncing}>{syncing ? 'Syncing...' : 'Run Sync Now'} <RefreshCw size={16} className={syncing ? 'spinning' : ''} /></button><Pill tone={rankState?.api_status === 'connected' ? 'blue' : rankState?.is_stale ? 'pink' : 'gray'}>{rankState?.api_status ?? 'unknown'}</Pill></div>{result && <div className={`admin-result ${result.includes('failed') ? 'error' : 'ok'}`}>{result}</div>}<div className="glass-card admin-state-card"><div className="card-header"><div><span className="card-label">Live sync state</span><h3>Database scan_state row</h3></div><Pill tone="gray">{`${rows.length} fields`}</Pill></div><div className="admin-state-grid">{rows.map((row) => <div key={row.label} className="admin-state-row"><span>{row.label}</span><strong>{row.value}</strong></div>)}</div></div><div className="admin-summary-row"><div className="glass-card admin-mini-card"><span className="card-label">Ranked members</span><strong>{formatNumber(liveMembers.length)}</strong></div><div className="glass-card admin-mini-card"><span className="card-label">Snapshots stored</span><strong>{formatNumber(snapshots.length)}</strong></div><div className="glass-card admin-mini-card"><span className="card-label">Ranking source</span><strong>{rankState?.ranking_source ?? '—'}</strong></div></div><div className="glass-card admin-modules-card"><div className="card-header"><div><span className="card-label">Platform Modules</span><h3>Extension module status</h3></div><Pill tone="gray">{`${modules.length} modules`}</Pill></div><div className="admin-module-list">{modules.map((mod) => <div key={mod.id} className="admin-module-row"><div className="admin-module-info"><strong>{mod.module_name}</strong><small>{mod.last_successful_update ? `Updated ${new Date(mod.last_successful_update).toLocaleString()}` : 'No updates yet'}{mod.last_error ? ` · ${mod.last_error}` : ''}</small></div><div className="admin-module-badges"><Pill tone={mod.database_ready ? 'blue' : 'gray'}>{mod.database_ready ? 'DB ready' : 'DB pending'}</Pill><Pill tone={mod.is_active ? 'blue' : 'gray'}>{mod.is_active ? 'Active' : 'Inactive'}</Pill><Pill tone={moduleTone(mod.integration_status)}>{mod.integration_status}</Pill></div></div>)}</div></div></div>;
}

export default App;
