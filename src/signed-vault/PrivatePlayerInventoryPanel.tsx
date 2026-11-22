import { useEffect, useState } from 'react';
import { Copy, ExternalLink, LockKeyhole, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { readStoredToken } from './vaultApi';

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vault-player-inventory`;
async function call(action:string, extra:Record<string,unknown>={}) {
 const response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`},body:JSON.stringify({action,token:readStoredToken(),...extra})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.error)throw new Error(String(data.error??'request_failed'));
 return data;
}
type Connection={roblox_user_id:number;roblox_username:string|null;display_name:string|null;expires_at:string;authorized_at:string};
type Pet={id?:string;displayName?:string;count?:number;icon?:string;rap?:number;exists?:number;rarity?:string};
export function PrivatePlayerInventoryPanel(){
 const [username,setUsername]=useState(''),[connections,setConnections]=useState<Connection[]>([]),[selected,setSelected]=useState<number|null>(null),[items,setItems]=useState<Pet[]>([]),[link,setLink]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=async()=>{try{const r=await call('list');setConnections(r.connections??[]);}catch(e){setError((e as Error).message);}};
 useEffect(()=>{void load();},[]);
 const start=async()=>{setBusy(true);setError('');try{const r=await call('start',{username});setLink(String(r.authorize_url??''));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const inspect=async(id:number)=>{setBusy(true);setError('');setSelected(id);setItems([]);try{const r=await call('inventory',{user_id:id});const data=r.data??{};setItems((data.items??[]).filter((x:Pet & {class?:string})=>x.class==='Pet'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const revoke=async(id:number)=>{setBusy(true);try{await call('revoke',{user_id:id});if(selected===id){setSelected(null);setItems([]);}await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="vault-card" style={{marginTop:18}}>
  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}><LockKeyhole size={18}/><h3 style={{margin:0}}>Consented private inventories</h3></div>
  <p className="vault-note">A player can authorize NANZO to read their private PS99 inventory. Generate a consent link and send it to that player. They must approve it themselves on BIG Games.</p>
  <div className="vault-row" style={{marginTop:12}}><input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Roblox username of the player" aria-label="Roblox username"/><button className="vault-btn vault-btn-gold" disabled={busy||!username.trim()} onClick={()=>void start()}>{busy?'Creating…':'Create consent link'}</button></div>
  {link&&<div style={{marginTop:12}}><div className="vault-note">Send this one-time authorization link to the player:</div><div className="vault-row"><input readOnly value={link}/><button className="vault-btn vault-btn-sm" onClick={()=>void navigator.clipboard.writeText(link)}><Copy size={13}/> Copy link</button><a className="vault-btn vault-btn-sm" href={link} target="_blank" rel="noreferrer"><ExternalLink size={13}/> Open</a></div></div>}
  <div style={{marginTop:16,fontWeight:700}}>Authorized players</div>
  {!connections.length&&<p className="vault-note">No players have authorized private inventory access yet.</p>}
  {connections.map(c=><div key={c.roblox_user_id} className="vault-row" style={{justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--line,rgba(255,255,255,.08))'}}>
   <div><b>{c.display_name||c.roblox_username||c.roblox_user_id}</b><div className="vault-note">@{c.roblox_username||'Roblox player'} · expires {new Date(c.expires_at).toLocaleDateString()}</div></div>
   <div className="vault-row"><button className="vault-btn vault-btn-sm" disabled={busy} onClick={()=>void inspect(c.roblox_user_id)}>View inventory</button><button className="vault-btn vault-btn-sm" disabled={busy} onClick={()=>void revoke(c.roblox_user_id)}><Unplug size={12}/> Revoke</button></div>
  </div>)}
  {selected!==null&&<div style={{marginTop:14}}><div className="vault-note">Private inventory · {items.length} pet stacks</div><div className="pie-grid">{items.map((p,i)=><article className="pie-pet-card" key={p.id??i}><div className="pie-pet-art">{p.icon&&<img src={p.icon} alt="" loading="lazy"/>}</div><div className="pie-pet-info"><b>{p.displayName||p.id||'Pet'}</b><small>Qty {p.count??1}</small><div><span>RAP</span><strong>{p.rap?.toLocaleString()??'—'}</strong></div><div><span>Exists</span><strong>{p.exists?.toLocaleString()??'—'}</strong></div></div></article>)}</div></div>}
  {error&&<div className="vault-error" style={{marginTop:10}}>{error}</div>}
  <div className="vault-note" style={{marginTop:12,display:'flex',gap:6,alignItems:'center'}}><ShieldCheck size={13}/> Tokens are stored server-side; the player can revoke access from their BIG Games account.</div>
 </section>;
}
export function PrivateInventoryOAuthCallback(){
 const [message,setMessage]=useState('Completing player authorization…');
 useEffect(()=>{const q=new URLSearchParams(window.location.search);const code=q.get('code'),state=q.get('state');if(q.get('error')){setMessage('The player declined authorization.');return;}if(!code||!state){setMessage('Authorization callback is incomplete.');return;}
  void call('callback',{code,state}).then(r=>{setMessage(`Private inventory authorized for @${r.username||r.user_id}. Returning to Explorer…`);window.setTimeout(()=>{window.location.href='/signed-vault/player-inventory';},1400);}).catch(e=>setMessage(`Authorization failed: ${(e as Error).message}`));
 },[]);
 return <div className="vault-lock-wrap"><div className="vault-lock-card"><RefreshCw size={28} className="vault-spin"/><h1 className="vault-lock-title">Player authorization</h1><p className="vault-lock-sub">{message}</p><a className="vault-btn" href="/signed-vault/player-inventory">Back to Explorer</a></div></div>;
}
