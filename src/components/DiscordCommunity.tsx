import { useEffect, useState } from 'react';
import { MessageCircle, ExternalLink, Settings, Hash, Megaphone, ShieldAlert, ScrollText, Bot, Sparkles, Bell, Users, Swords, LifeBuoy } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export type DiscordConfigPublic = {
  invite_url: string | null;
  guild_id: string | null;
  guild_name: string | null;
  server_icon_url: string | null;
};

export type DiscordChannel = {
  id: string;
  channel_id: string | null;
  display_name: string;
  category: string;
  description: string | null;
  display_order: number;
  is_public: boolean;
  channel_url: string | null;
};

export type DiscordRule = {
  id: string;
  title: string;
  description: string;
  category: string;
  display_order: number;
  is_enabled: boolean;
  is_placeholder: boolean;
};

export type DiscordAnnouncement = {
  id: string;
  title: string;
  body: string;
  author_label: string | null;
  pinned: boolean;
  created_at: string;
};

export function useDiscordConfig(): { config: DiscordConfigPublic | null; loaded: boolean } {
  const [config, setConfig] = useState<DiscordConfigPublic | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    supabase.from('nanz_discord_config_public').select('invite_url, guild_id, guild_name, server_icon_url').maybeSingle()
      .then(({ data }) => { setConfig((data ?? null) as DiscordConfigPublic | null); setLoaded(true); });
  }, []);
  return { config, loaded };
}

// JOIN OUR DISCORD — premium branded button. If no invitation is configured,
// renders an admin configuration warning instead of a broken link.
export function JoinDiscordButton({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const { config, loaded } = useDiscordConfig();
  if (!loaded) return <button className={`discord-btn discord-${size} ${className} loading`} disabled><MessageCircle size={size === 'lg' ? 20 : 16} /> Join Our Discord</button>;
  if (!config?.invite_url) {
    return <button className={`discord-btn discord-${size} ${className} unconfigured`} disabled title="DISCORD_INVITE_URL is not configured yet">
      <Settings size={size === 'lg' ? 20 : 16} /> Discord invite not configured
    </button>;
  }
  return <a className={`discord-btn discord-${size} ${className}`} href={config.invite_url} target="_blank" rel="noopener noreferrer">
    <svg viewBox="0 0 24 24" width={size === 'lg' ? 20 : 16} height={size === 'lg' ? 20 : 16} fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
    Join Our Discord <ExternalLink size={size === 'lg' ? 16 : 14} />
  </a>;
}

const channelCategoryIcons: Record<string, JSX.Element> = {
  general: <Hash size={16} />,
  competitive: <Swords size={16} />,
  support: <LifeBuoy size={16} />,
  community: <Users size={16} />,
};

const ruleCategoryLabels: Record<string, string> = {
  conduct: 'Conduct',
  competitive: 'Competitive',
  recruitment: 'Recruitment',
  community: 'Community',
  support: 'Support',
};

export function DiscordCommunity({ onNavigate }: { onNavigate: (section: string) => void }) {
  const { config } = useDiscordConfig();
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [rules, setRules] = useState<DiscordRule[]>([]);
  const [announcements, setAnnouncements] = useState<DiscordAnnouncement[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const [chanRes, ruleRes, annRes] = await Promise.all([
        supabase.from('nanz_discord_channels').select('*').order('display_order'),
        supabase.from('nanz_discord_rules').select('*').order('display_order'),
        supabase.from('nanz_discord_announcements').select('*').eq('is_enabled', true).order('pinned', { ascending: false }).order('created_at', { ascending: false }),
      ]);
      setChannels((chanRes.data ?? []) as DiscordChannel[]);
      setRules((ruleRes.data ?? []) as DiscordRule[]);
      setAnnouncements((annRes.data ?? []) as DiscordAnnouncement[]);
      setLoaded(true);
    })();
  }, []);

  const grouped = ['general', 'competitive', 'support', 'community'].map((cat) => ({
    category: cat,
    items: channels.filter((ch) => ch.category === cat),
  })).filter((group) => group.items.length > 0);

  const groupedRules = ['conduct', 'competitive', 'recruitment', 'community', 'support'].map((cat) => ({
    category: cat,
    items: rules.filter((r) => r.category === cat),
  })).filter((group) => group.items.length > 0);

  const serverName = config?.guild_name ?? 'the NANZ Discord server';

  return <div className="page-inner community-page">
    <section className="community-hero">
      <div className="community-hero-text">
        <span className="kicker">Discord · NANZ CORE ecosystem</span>
        <h1>NANZ <span className="accent-text">COMMUNITY</span></h1>
        <p className="community-subtitle">ONE CLAN. ONE COMMUNITY. ONE STANDARD.</p>
        <p className="community-intro">NANZ is a competitive Pet Simulator 99 clan built on discipline and measurable contribution. Our Discord server is where the clan actually lives — daily battle coordination, live leaderboard updates, recruitment reviews and the community culture that keeps us at the top. The NANZ CORE bot connects this website and the server into one ecosystem: apply here, and your application opens directly in our recruitment ticket workflow.</p>
        <div className="community-cta-row">
          <JoinDiscordButton size="lg" />
        </div>
        {config?.guild_name && <p className="community-server-line"><MessageCircle size={14} /> {config.guild_name}{config.guild_id ? <span className="community-guild-id"> · Server ID {config.guild_id}</span> : null}</p>}
      </div>
      <div className="community-hero-visual">
        {config?.server_icon_url
          ? <img src={config.server_icon_url} alt={`${serverName} icon`} className="community-server-icon" />
          : <div className="community-server-icon fallback"><MessageCircle size={44} /></div>}
        <div className="community-core-card">
          <div className="community-core-head"><Bot size={18} /><b>NANZ CORE</b></div>
          <p>Our always-on Discord bot powers recruitment tickets, status synchronization, role management and event notifications between this website and the server.</p>
          <div className="community-core-tags"><span>Recruitment tickets</span><span>Status sync</span><span>Notifications</span></div>
        </div>
      </div>
    </section>

    <section className="community-benefits">
      <div className="section-header"><div><span className="kicker">Why join the server</span><h2>Community <span className="accent-text">benefits</span></h2></div></div>
      <div className="principle-grid">
        <div className="principle-tile"><div className="principle-icon"><Swords size={24} /></div><h3>Battle coordination</h3><p>Daily battle plans, contribution targets and real-time rank tracking with the whole clan.</p></div>
        <div className="principle-tile"><div className="principle-icon"><Bell size={24} /></div><h3>Instant updates</h3><p>Rank milestones, reward unlocks and clan goals posted the moment they happen.</p></div>
        <div className="principle-tile"><div className="principle-icon"><Sparkles size={24} /></div><h3>Recognition</h3><p>Player of the Week, awards and Hall of Fame moments celebrated where the clan gathers.</p></div>
        <div className="principle-tile"><div className="principle-icon"><Users size={24} /></div><h3>A real team</h3><p>Players who take competition seriously — plus voice channels, media sharing and inventory flexes.</p></div>
      </div>
    </section>

    <section className="community-section">
      <div className="section-header"><div><span className="kicker">Find your way around</span><h2>Important <span className="accent-text">channels</span></h2></div><span className="trailing-label">Curated public links only</span></div>
      {!loaded ? <div className="community-loading">Loading channels...</div> : grouped.length === 0 ? (
        <div className="community-empty"><Hash size={20} /><p>Channel links are being configured by NANZ management. Check back soon, or join the server and explore.</p></div>
      ) : grouped.map((group) => <div key={group.category} className="channel-category">
        <div className="channel-category-head">{channelCategoryIcons[group.category]}<b>{group.category.toUpperCase()}</b></div>
        <div className="channel-grid">{group.items.map((ch) => (
          <a key={ch.id} className="channel-card" href={ch.channel_url ?? (ch.channel_id && config?.guild_id ? `https://discord.com/channels/${config.guild_id}/${ch.channel_id}` : undefined)} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (!ch.channel_url && !(ch.channel_id && config?.guild_id)) e.preventDefault(); }}>
            <span className="channel-icon">{channelCategoryIcons[ch.category] ?? <Hash size={16} />}</span>
            <div><b>{ch.display_name}</b>{ch.description && <small>{ch.description}</small>}</div>
            <ExternalLink size={13} />
          </a>
        ))}</div>
      </div>)}
      {loaded && channels.some((ch) => !ch.is_public) && <p className="community-private-note"><ShieldAlert size={14} /> Private staff and ticket channels are intentionally not listed here.</p>}
    </section>

    <section className="community-section">
      <div className="section-header"><div><span className="kicker">The NANZ standard</span><h2>Server <span className="accent-text">rules</span></h2></div><span className="trailing-label">Enforced by NANZ CORE</span></div>
      {!loaded ? <div className="community-loading">Loading rules...</div> : groupedRules.length === 0 ? (
        <div className="community-empty"><ScrollText size={20} /><p>The official server rules are being finalized by NANZ management. Members can always find the current rules in the Discord server itself.</p></div>
      ) : groupedRules.map((group, gi) => <div key={group.category} className="rules-group">
        <div className="rules-group-head"><span>{ruleCategoryLabels[group.category] ?? group.category}</span></div>
        <div className="rules-list">{group.items.map((rule, ri) => <div key={rule.id} className="rule-row">
          <span className="rule-number">{String(gi * 10 + ri + 1).padStart(2, '0')}</span>
          <div><b>{rule.title}</b><p>{rule.description}</p></div>
        </div>)}</div>
      </div>)}
    </section>

    <section className="community-section">
      <div className="section-header"><div><span className="kicker">Latest from the server</span><h2>Community <span className="accent-text">announcements</span></h2></div><span className="trailing-label">From the NANZ Discord server</span></div>
      {!loaded ? <div className="community-loading">Loading announcements...</div> : announcements.length === 0 ? (
        <div className="community-empty"><Megaphone size={20} /><p>No announcements yet. Join the Discord server to catch every update first.</p></div>
      ) : <div className="announcement-list">{announcements.map((a) => <article key={a.id} className={`announcement-card ${a.pinned ? 'pinned' : ''}`}>
        {a.pinned && <span className="announcement-pin">Pinned</span>}
        <h3>{a.title}</h3><p>{a.body}</p>
        <small>{a.author_label ? `${a.author_label} · ` : ''}{new Date(a.created_at).toLocaleDateString()}</small>
      </article>)}</div>}
    </section>

    <section className="community-recruit-cta">
      <div>
        <span className="kicker">Ready to compete?</span>
        <h2>Join the clan. <span className="accent-text">Earn your place.</span></h2>
        <p>Apply through the website — your application lands directly in our Discord recruitment workflow.</p>
      </div>
      <div className="community-recruit-buttons">
        <button className="btn-primary" onClick={() => onNavigate('apply')}>Apply to NANZ</button>
        <button className="btn-secondary" onClick={() => onNavigate('status')}>Track my application</button>
      </div>
    </section>
  </div>;
}
