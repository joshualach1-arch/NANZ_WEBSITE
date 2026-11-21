import { useMemo, useState } from 'react';
import { ArrowDownUp, Plus, Trash2, Sparkles, TrendingUp, TrendingDown, Scale, ShieldCheck, Search, Coins, Calculator, X, Check } from 'lucide-react';
import { formatValue, variantLabelWide, type VaultData, type Variant } from './vaultApi';

type Side = 'give' | 'get';
type TradeItem = { id: string; petId: string; signerId: string; variant: Variant; signatureValue: string; hugeValue: string; demand: number };
const variants: Variant[] = ['normal', 'golden', 'rainbow', 'shiny', 'golden_shiny', 'rainbow_shiny'];
const money = (value: number) => formatValue(Number.isFinite(value) ? value : 0, '');
const num = (value: string) => Math.max(0, Number(value) || 0);
const rarityFactor = (demand: number) => 1 + (demand - 5) * 0.04;
const makeId = () => `trade-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function petBaseValue(data: VaultData, petId: string) {
  const pet = data.catalog.find((entry) => entry.id === petId);
  return Number(pet?.cosmic_value ?? 0);
}
function signerValue(data: VaultData, petId: string, signerId: string, variant: Variant) {
  const signer = data.signers.find((entry) => entry.id === signerId);
  const signature = data.signatures.find((entry) => entry.pet_id === petId && entry.signer_id === signerId && entry.variant === variant);
  const category = String(data.catalog.find((entry) => entry.id === petId)?.category ?? '').toLowerCase();
  const value = signature?.signature_value ?? (category.includes('titanic') ? signer?.cosmic_titanic_value : category.includes('huge') ? signer?.cosmic_huge_value : signer?.cosmic_exclusive_value);
  return value == null ? '' : String(value);
}

function TradeSide({ side, title, subtitle, items, data, gems, onGems, onAdd, onChange, onRemove }: {
  side: Side; title: string; subtitle: string; items: TradeItem[]; data: VaultData; gems: string; onGems: (v: string) => void;
  onAdd: (item: TradeItem) => void; onChange: (id: string, patch: Partial<TradeItem>) => void; onRemove: (id: string) => void;
}) {
  const [petQuery, setPetQuery] = useState('');
  const [petId, setPetId] = useState('');
  const [variant, setVariant] = useState<Variant>('normal');
  const [signerQuery, setSignerQuery] = useState('');
  const [signerId, setSignerId] = useState('');
  const [petOpen, setPetOpen] = useState(false);
  const [signerOpen, setSignerOpen] = useState(false);
  const [demand, setDemand] = useState(5);
  const pet = data.catalog.find((p) => p.id === petId);
  const signer = data.signers.find((s) => s.id === signerId);
  const filteredPets = data.catalog.filter((p) => String(p.display_name || p.pet_name).toLowerCase().includes(petQuery.toLowerCase())).slice(0, 35);
  const filteredSigners = data.signers.filter((s) => String(s.display_name || s.signer_name).toLowerCase().includes(signerQuery.toLowerCase())).slice(0, 30);
  const addPet = () => {
    if (!petId) return;
    const sigValue = signerId ? signerValue(data, petId, signerId, variant) : '';
    const huge = petBaseValue(data, petId);
    onAdd({ id: makeId(), petId, signerId, variant, signatureValue: sigValue, hugeValue: String(huge || 0), demand });
    setPetId(''); setPetQuery(''); setSignerId(''); setSignerQuery(''); setVariant('normal'); setDemand(5);
  };
  const accent = side === 'give' ? 'give' : 'get';
  const petTotal = items.reduce((sum, item) => sum + num(item.hugeValue), 0);
  const sigTotal = items.reduce((sum, item) => sum + num(item.signatureValue), 0);
  return <section className={`tc-side tc-${accent}`}>
    <div className="tc-side-head"><div><span className="tc-side-kicker">{side === 'give' ? 'YOUR OFFER' : 'YOU RECEIVE'}</span><h3>{title}</h3><p>{subtitle}</p></div><span className="tc-side-count">{items.length} {items.length === 1 ? 'PET' : 'PETS'}</span></div>
    <div className="tc-builder">
      <div className="tc-builder-title"><Sparkles size={15}/> ADD ITEMS TO YOUR {side === 'give' ? 'OFFER' : 'RECEIVE SIDE'}</div>
      <div className="tc-search-wrap">
        <Search size={16}/>
        <input value={petQuery} onFocus={() => setPetOpen(true)} onChange={(e) => {setPetQuery(e.target.value);setPetId('');setPetOpen(true);}} placeholder="Search any pet by name…"/>
        {petId && <button onClick={() => {setPetId('');setPetQuery('');}}><X size={14}/></button>}
        {petOpen && <div className="tc-search-results">{filteredPets.map((p) => <button key={p.id} onClick={() => {setPetId(p.id);setPetQuery(p.display_name || p.pet_name);setPetOpen(false);}}>{p.image_url && <img src={p.image_url} alt=""/>}<span>{p.display_name || p.pet_name}</span><small>{p.category || 'Pet'}</small></button>)}{filteredPets.length === 0 && <p>No pets found</p>}</div>}
      </div>
      <div className="tc-builder-row">
        <select value={variant} onChange={(e) => setVariant(e.target.value as Variant)}>{variants.map((v) => <option key={v} value={v}>{variantLabelWide[v] || v}</option>)}</select>
        <div className="tc-search-wrap tc-signer-search"><Search size={15}/><input value={signerQuery} onFocus={() => setSignerOpen(true)} onChange={(e) => {setSignerQuery(e.target.value);setSignerId('');setSignerOpen(true);}} placeholder="Search designer / no signature…"/>{signerId && <button onClick={() => {setSignerId('');setSignerQuery('');}}><X size={13}/></button>}
          {signerOpen && <div className="tc-search-results">{filteredSigners.map((s) => <button key={s.id} onClick={() => {setSignerId(s.id);setSignerQuery(s.display_name || s.signer_name);setDemand(Number(s.cosmic_demand ?? 5));setSignerOpen(false);}}><span>{s.display_name || s.signer_name}</span><small>Designer</small></button>)}<button onClick={() => {setSignerId('');setSignerQuery('No signature');setSignerOpen(false);}}><span>No signature</span><small>Unsigned pet</small></button>{filteredSigners.length === 0 && <p>No designers found</p>}</div>}
        </div>
      </div>
      <div className="tc-builder-row tc-builder-values">
        <label><span>DEMAND / RARITY</span><select value={demand} onChange={(e) => setDemand(Number(e.target.value))}>{Array.from({length:10},(_,i)=>i+1).map(n=><option key={n} value={n}>{n}/10 · {n>=9?'Extremely rare':n>=7?'Very rare':n>=5?'Uncommon':n>=3?'Common':'Very common'}</option>)}</select></label>
        <button className="tc-add-selected" disabled={!petId} onClick={addPet}><Plus size={17}/> Add pet</button>
      </div>
      {pet && <div className="tc-selected-preview"><span>{pet.display_name || pet.pet_name}</span><small>{signer ? `Signed by ${signer.display_name || signer.signer_name}` : 'No signature selected'} · {variantLabelWide[variant] || variant}</small></div>}
    </div>
    <div className="tc-added-heading"><span>TRADE ITEMS</span><small>{items.length} added</small></div>
    <div className="tc-items">
      {items.map((item) => {
        const p = data.catalog.find((entry) => entry.id === item.petId);
        const s = data.signers.find((entry) => entry.id === item.signerId);
        return <article className="tc-item tc-added-item" key={item.id}>
          <div className="tc-item-top"><div className="tc-pet-art">{p?.image_url ? <img src={p.image_url} alt={p.pet_name}/> : <Sparkles size={25}/>}</div>
            <div className="tc-added-info"><strong>{p?.display_name || p?.pet_name || 'Unknown pet'}</strong><span>{variantLabelWide[item.variant] || item.variant}</span><small>{s ? `✦ ${s.display_name || s.signer_name}` : 'No signature · Unsigned'}</small></div>
            <button className="tc-remove" onClick={() => onRemove(item.id)} title="Remove pet"><Trash2 size={16}/></button></div>
          <div className="tc-item-values">
            <label><span>PET / HUGE VALUE</span><div><input type="number" min="0" value={item.hugeValue} onChange={(e) => onChange(item.id,{hugeValue:e.target.value})}/><small>Gems</small></div></label>
            <label><span>SIGNATURE VALUE</span><div><input type="number" min="0" value={item.signatureValue} onChange={(e) => onChange(item.id,{signatureValue:e.target.value})} placeholder="0"/><small>Gems</small></div></label>
            <label className="tc-demand-field"><span>DEMAND</span><select value={item.demand} onChange={(e)=>onChange(item.id,{demand:Number(e.target.value)})}>{Array.from({length:10},(_,i)=>i+1).map(n=><option key={n} value={n}>{n}/10</option>)}</select></label>
          </div>
        </article>;
      })}
      {items.length === 0 && <div className="tc-empty-items">No pets added yet. Search a pet above to build this side of the trade.</div>}
    </div>
    <div className="tc-gems-row"><div><Coins size={17}/><span>ADD GEMS TO THIS SIDE?</span></div><label><input type="number" min="0" value={gems} onChange={(e)=>onGems(e.target.value)} placeholder="0"/><small>Gems</small></label></div>
    <div className="tc-side-totals"><div><span>PET VALUE</span><strong>{money(petTotal)}</strong></div><div><span>SIGNATURE VALUE</span><strong>{money(sigTotal)}</strong></div><div><span>GEMS</span><strong>{money(num(gems))}</strong></div></div>
  </section>;
}

export function TradeCalculator({ data }: { data: VaultData }) {
  const [give,setGive]=useState<TradeItem[]>([]);
  const [get,setGet]=useState<TradeItem[]>([]);
  const [giveGems,setGiveGems]=useState('0');
  const [getGems,setGetGems]=useState('0');
  const [rarityEnabled,setRarityEnabled]=useState(true);
  const [calculated,setCalculated]=useState(false);
  const update=(side:Side,id:string,patch:Partial<TradeItem>)=>(side==='give'?setGive:setGet)(items=>items.map(item=>item.id===id?{...item,...patch}:item));
  const add=(side:Side,item:TradeItem)=>(side==='give'?setGive:setGet)(items=>[...items,item]);
  const remove=(side:Side,id:string)=>(side==='give'?setGive:setGet)(items=>items.filter(item=>item.id!==id));
  const totals=(items:TradeItem[],gems:string)=>{
    const pet=items.reduce((sum,item)=>sum+num(item.hugeValue),0);
    const signature=items.reduce((sum,item)=>sum+num(item.signatureValue),0);
    const adjusted=items.reduce((sum,item)=>sum+(num(item.hugeValue)+num(item.signatureValue))*rarityFactor(item.demand),0);
    const selected=items;
    const demand=selected.length?selected.reduce((sum,item)=>sum+item.demand,0)/selected.length:0;
    return {pet,signature,combined:pet+signature+num(gems),adjusted:adjusted+num(gems),demand};
  };
  const a=useMemo(()=>totals(give,giveGems),[give,giveGems,rarityEnabled]);
  const b=useMemo(()=>totals(get,getGems),[get,getGems,rarityEnabled]);
  const baseDiff=b.combined-a.combined;
  const pct=a.combined>0?baseDiff/a.combined*100:b.combined>0?100:0;
  const effectiveGive=rarityEnabled?a.adjusted:a.combined;
  const effectiveGet=rarityEnabled?b.adjusted:b.combined;
  const effectiveDiff=effectiveGet-effectiveGive;
  const effectivePct=effectiveGive>0?effectiveDiff/effectiveGive*100:effectiveGet>0?100:0;
  const demandDiff=b.demand-a.demand;
  let verdict='Ready when you are';let tone='neutral';let detail='Add pets and Gems on both sides, then calculate your trade.';
  if(calculated){
    if(effectivePct>=30){verdict='INSANE WIN';tone='win';detail='A massive value advantage on the receive side.';}
    else if(effectivePct>=12){verdict='VERY GOOD DEAL';tone='win';detail='You receive clearly more value than you give.';}
    else if(effectivePct>=3){verdict='GOOD DEAL';tone='win';detail='The trade is favorable for you.';}
    else if(effectivePct>-3){verdict='FAIR TRADE';tone='fair';detail='The values are close. Rarity and preference can decide.';}
    else if(effectivePct>-12){verdict='SLIGHT OVERPAY';tone='loss';detail='You give a little more value than you receive.';}
    else if(effectivePct>-30){verdict='BAD DEAL';tone='loss';detail='You are overpaying. Consider asking for adds.';}
    else{verdict='VERY BAD DEAL';tone='loss';detail='A heavy overpay. Consider renegotiating.';}
  }
  return <div className="tc-page">
    <div className="tc-hero"><div><span className="tc-kicker">NANZO TRADE LAB</span><h2>Trade Profit <b>Calculator</b></h2><p>Build your offer, add the other side, then calculate the real trade value.</p></div><div className="tc-hero-icon"><ArrowDownUp size={38}/></div></div>
    <div className="tc-modebar"><div><span className="tc-live-dot"/> TRADE BUILDER <small>Add pets, signatures and Gems before calculating</small></div><label className="tc-toggle"><input type="checkbox" checked={rarityEnabled} onChange={(e)=>setRarityEnabled(e.target.checked)}/><span/> Rarity weighting <b>{rarityEnabled?'ON':'OFF'}</b></label></div>
    <div className="tc-trade-grid">
      <TradeSide side="give" title="You Give" subtitle="Everything you put into the trade" items={give} data={data} gems={giveGems} onGems={setGiveGems} onAdd={(item)=>add('give',item)} onChange={(id,patch)=>update('give',id,patch)} onRemove={(id)=>remove('give',id)}/>
      <div className="tc-versus"><span>VS</span><ArrowDownUp size={19}/></div>
      <TradeSide side="get" title="You Get" subtitle="Everything you receive in the trade" items={get} data={data} gems={getGems} onGems={setGetGems} onAdd={(item)=>add('get',item)} onChange={(id,patch)=>update('get',id,patch)} onRemove={(id)=>remove('get',id)}/>
    </div>
    <div className="tc-calculate-bar"><div><Calculator size={19}/><span><b>Trade ready?</b><small>{give.length} offered · {get.length} received · Gems included</small></span></div><button onClick={()=>{setCalculated(true);document.getElementById('tc-results')?.scrollIntoView({behavior:'smooth',block:'start'});}}><Scale size={18}/> THAT'S MY TRADE</button></div>
    {calculated && <section id="tc-results" className={`tc-result tc-result-${tone}`}>
      <div className="tc-result-top"><div><span className="tc-kicker">TRADE VERDICT</span><h3>{verdict}</h3><p>{detail}</p><span className={`tc-direction tc-direction-${effectiveDiff>0?'up':effectiveDiff<0?'down':'even'}`}>{effectiveDiff>0?'YOU UNDERPAY':effectiveDiff<0?'YOU OVERPAY':'EVEN VALUE'}</span></div><div className="tc-verdict-mark">{tone==='win'?<TrendingUp size={30}/>:tone==='loss'?<TrendingDown size={30}/>:<Scale size={30}/>}</div></div>
      <div className="tc-result-grid">
        <div><span>PROFIT / LOSS · COMBINED VALUE</span><strong className={baseDiff>=0?'tc-positive':'tc-negative'}>{baseDiff>=0?'+':'−'}{money(Math.abs(baseDiff))}</strong><small>{pct>=0?'+':''}{pct.toFixed(1)}% vs your offer</small></div>
        <div><span>PET VALUE DIFFERENCE</span><strong>{money(b.pet-a.pet)}</strong><small>Received minus given</small></div>
        <div><span>SIGNATURE VALUE DIFFERENCE</span><strong>{money(b.signature-a.signature)}</strong><small>Signed value only</small></div>
        <div><span>RARITY-ADJUSTED RESULT</span><strong className={effectiveDiff>=0?'tc-positive':'tc-negative'}>{effectiveDiff>=0?'+':'−'}{money(Math.abs(effectiveDiff))}</strong><small>{effectivePct>=0?'+':''}{effectivePct.toFixed(1)}% · {rarityEnabled?'rarity included':'rarity ignored'}</small></div>
        <div><span>DEMAND / RARITY DIFFERENCE</span><strong>{demandDiff>0?'+':''}{demandDiff.toFixed(1)} / 10</strong><small>{demandDiff>0?'Received side is rarer':demandDiff<0?'Your offer is rarer':'Equal average rarity'}</small></div>
        <div><span>GEMS DIFFERENCE</span><strong>{money(num(getGems)-num(giveGems))}</strong><small>Received minus given</small></div>
      </div>
      <div className="tc-demand-note"><ShieldCheck size={17}/><span><b>NANZO rarity model:</b> 10/10 adds up to 20% to the evaluation; 1/10 reduces it by up to 16%. This is a collector estimate, not an official market formula.</span></div>
    </section>}
    <div className="tc-footnote"><Search size={14}/> Search works across the full pet and designer catalogs. Unsigned pets are supported. All item values can be edited manually before calculating.</div>
  </div>;
}
