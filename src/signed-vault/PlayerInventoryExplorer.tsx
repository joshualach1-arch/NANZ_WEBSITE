import { useMemo, useState } from 'react';
import { Search, Sparkles, Crown, Gem, RefreshCw, ShieldAlert, Package } from 'lucide-react';

type PlayerItem = { class?: string; id?: string; displayName?: string; count?: number; icon?: string; rap?: number; exists?: number; rarity?: string; collection?: string; rawData?: Record<string, unknown> };
type PlayerInfo = { username: string; displayName?: string | null; robloxUserId: string; publicViews?: Record<string, boolean> };
const API = 'https://ps99.biggamesapi.io/v1/players/';

function category(name: string) {
  const n = name.toLowerCase();
  if (n.includes('gargantuan') || n.includes('gargantua')) return 'Gargantuan';
  if (n.includes('titanic')) return 'Titanic';
  if (n.startsWith('huge ') || n.includes(' huge ')) return 'Huge';
  if (n.startsWith('exclusive ') || n.includes(' exclusive ')) return 'Exclusive';
  return 'Other';
}
function imageUrl(icon?: string) {
  if (!icon) return '';
  if (icon.startsWith('http')) return icon;
  const id = icon.match(/rbxassetid:\/\/(\d+)/)?.[1];
  return id ? `https://thumbnails.roblox.com/v1/assets?assetIds=${id}&size=420x420&format=Png` : '';
}
function short(value?: number) {
  if (!value) return '—';
  if (value >= 1e12) return (value / 1e12).toFixed(2) + 'T';
  if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
  if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toLocaleString();
}

export function PlayerInventoryExplorer() {
  const [query, setQuery] = useState('');
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [items, setItems] = useState<PlayerItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');

  const load = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const slug = query.trim();
    if (!slug) return;
    setBusy(true); setError(''); setPlayer(null); setItems([]);
    try {
      const response = await fetch(API + encodeURIComponent(slug) + '?include=inventory', { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok || payload.status === 'error') throw new Error(payload.error?.code === 'player_not_found' ? 'Player not found, or this player has no publicly enabled PS99 views.' : 'Public player data could not be loaded.');
      const data = payload.data ?? {};
      const view = data.views?.inventory;
      if (!view?.available || !Array.isArray(view.data?.items)) throw new Error('This player has not made their PS99 inventory public. Ask them to enable the Inventory public view in their BIG Games dashboard.');
      setPlayer(data.account);
      setItems(view.data.items.filter((item: PlayerItem) => item.class === 'Pet'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load player inventory.'); }
    finally { setBusy(false); }
  };

  const visible = useMemo(() => items.filter(item => {
    const name = item.displayName || item.id || '';
    const cat = category(name);
    return (filter === 'All' || cat === filter) && name.toLowerCase().includes(search.toLowerCase());
  }), [items, filter, search]);
  const counts = useMemo(() => ({
    huge: items.filter(i => category(i.displayName || i.id || '') === 'Huge').reduce((n,i)=>n+(i.count||1),0),
    titanic: items.filter(i => category(i.displayName || i.id || '') === 'Titanic').reduce((n,i)=>n+(i.count||1),0),
    gargantuan: items.filter(i => category(i.displayName || i.id || '') === 'Gargantuan').reduce((n,i)=>n+(i.count||1),0),
    exclusive: items.filter(i => category(i.displayName || i.id || '') === 'Exclusive').reduce((n,i)=>n+(i.count||1),0),
  }), [items]);

  return <div className="pie-wrap">
    <section className="pie-hero">
      <div className="pie-kicker"><Sparkles size={13}/> NANZO · PUBLIC PLAYER DATABASE</div>
      <h2>Player Inventory <span>Explorer</span></h2>
      <p>Explore another player's publicly shared Pet Simulator 99 collection.</p>
      <form className="pie-search" onSubmit={load}>
        <Search size={19}/>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Enter Roblox username or user ID…" aria-label="Roblox username or user ID"/>
        <button type="submit" disabled={busy || !query.trim()}>{busy ? <RefreshCw className="vault-spin" size={16}/> : 'Explore inventory'}</button>
      </form>
      <div className="pie-privacy"><ShieldAlert size={13}/> Only inventories the player has chosen to make public can be viewed.</div>
    </section>
    {error && <div className="vault-error pie-error">{error}</div>}
    {player && <>
      <div className="pie-profile">
        <div className="pie-avatar">{player.displayName?.slice(0,1) || player.username.slice(0,1).toUpperCase()}</div>
        <div className="pie-player-copy"><span>PLAYER INVENTORY</span><h3>{player.displayName || player.username}</h3><p>@{player.username} · ID {player.robloxUserId}</p></div>
        <a href={`https://www.roblox.com/users/${player.robloxUserId}/profile`} target="_blank" rel="noreferrer">Roblox Profile ↗</a>
      </div>
      <div className="pie-stats">
        <div><Package/><span>Total pets</span><b>{items.reduce((n,i)=>n+(i.count||1),0).toLocaleString()}</b></div>
        <div><Gem/><span>Huge</span><b>{counts.huge}</b></div>
        <div><Crown/><span>Titanic</span><b>{counts.titanic}</b></div>
        <div><Sparkles/><span>Gargantuan</span><b>{counts.gargantuan}</b></div>
      </div>
      <div className="pie-toolbar"><div><span>COLLECTION</span><h3>{visible.length} items displayed</h3></div><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search pets…"/></div>
      <div className="pie-filters">{['All','Huge','Titanic','Gargantuan','Exclusive'].map(f=><button key={f} className={filter===f?'active':''} onClick={()=>setFilter(f)}>{f}</button>)}</div>
      {visible.length ? <div className="pie-grid">{visible.map((item,i)=>{
        const name=item.displayName||item.id||'Unknown Pet'; const cat=category(name); const src=imageUrl(item.icon);
        return <article className={`pie-pet-card pie-${cat.toLowerCase()}`} key={item.stackKey||name+i}>
          <div className="pie-pet-art">{src?<img src={src} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none';}}/>:<Sparkles size={36}/>}<span>{cat}</span></div>
          <div className="pie-pet-info"><b>{name}</b><small>{item.rarity||'Pet'} · Qty {item.count||1}</small><div><span>RAP</span><strong>{short(item.rap)}</strong></div><div><span>Exists</span><strong>{item.exists?.toLocaleString()||'—'}</strong></div></div>
        </article>;
      })}</div> : <div className="vault-empty">No pets match this filter.</div>}
      <div className="pie-footnote">Inventory snapshot: {items.length.toLocaleString()} pet stacks · Data supplied by BIG Games Public Player API. Signature ownership is not exposed in public inventory data.</div>
    </>}
    {!player && !busy && !error && <div className="pie-empty"><div><Package size={32}/></div><h3>Whose collection are you exploring?</h3><p>Enter a Roblox username above to open their PS99 inventory as a visual pet collection.</p></div>}
  </div>;
}
