import { useMemo, useState } from 'react';
import { ArrowDownUp, Plus, Trash2, Sparkles, TrendingUp, TrendingDown, Scale, ShieldCheck, Search } from 'lucide-react';
import { formatValue, variantLabelWide, type VaultData, type Variant, type CatalogPet, type Signer } from './vaultApi';

type Side = 'give' | 'get';
type TradeItem = { id: string; petId: string; signerId: string; variant: Variant; signatureValue: string; hugeValue: string; demand: number };

const variants: Variant[] = ['normal', 'golden', 'rainbow', 'shiny', 'golden_shiny', 'rainbow_shiny'];
const money = (value: number) => formatValue(Number.isFinite(value) ? value : 0, '');
const num = (value: string) => Math.max(0, Number(value) || 0);
const rarityFactor = (demand: number) => 1 + (demand - 5) * 0.04;

function newItem(): TradeItem {
  return { id: `trade-${Date.now()}-${Math.random().toString(36).slice(2)}`, petId: '', signerId: '', variant: 'normal', signatureValue: '', hugeValue: '', demand: 5 };
}

function TradeSide({ side, title, subtitle, items, data, onAdd, onChange, onRemove, totalSignature, totalHuge, rarityAdjusted }: {
  side: Side; title: string; subtitle: string; items: TradeItem[]; data: VaultData;
  onAdd: () => void; onChange: (id: string, patch: Partial<TradeItem>) => void; onRemove: (id: string) => void;
  totalSignature: number; totalHuge: number; rarityAdjusted: number;
}) {
  const accent = side === 'give' ? 'give' : 'get';
  const updatePet = (item: TradeItem, petId: string) => {
    const pet = data.catalog.find((entry) => entry.id === petId);
    const signer = data.signers.find((entry) => entry.id === item.signerId);
    onChange(item.id, { petId, signatureValue: signer?.cosmic_exclusive_value != null ? String(signer.cosmic_exclusive_value) : '', hugeValue: signer?.cosmic_huge_value != null ? String(signer.cosmic_huge_value) : pet?.cosmic_value != null ? String(pet.cosmic_value) : '', demand: Number(signer?.cosmic_demand ?? pet?.demand ?? 5) });
  };
  const updateSigner = (item: TradeItem, signerId: string) => {
    const signer = data.signers.find((entry) => entry.id === signerId);
    const sig = data.signatures.find((entry) => entry.pet_id === item.petId && entry.signer_id === signerId && entry.variant === item.variant);
    onChange(item.id, { signerId, signatureValue: sig?.signature_value != null ? String(sig.signature_value) : signer?.cosmic_exclusive_value != null ? String(signer.cosmic_exclusive_value) : item.signatureValue, hugeValue: signer?.cosmic_huge_value != null ? String(signer.cosmic_huge_value) : item.hugeValue, demand: Number(signer?.cosmic_demand ?? item.demand) });
  };
  return <section className={`tc-side tc-${accent}`}>
    <div className="tc-side-head">
      <div><span className="tc-side-kicker">{side === 'give' ? 'YOUR OFFER' : 'YOU RECEIVE'}</span><h3>{title}</h3><p>{subtitle}</p></div>
      <span className="tc-side-count">{items.length} {items.length === 1 ? 'PET' : 'PETS'}</span>
    </div>
    <div className="tc-items">
      {items.map((item) => {
        const pet = data.catalog.find((entry) => entry.id === item.petId);
        return <article className="tc-item" key={item.id}>
          <div className="tc-item-top">
            <div className="tc-pet-art">{pet?.image_url ? <img src={pet.image_url} alt={pet.pet_name}/> : <Sparkles size={27}/>}</div>
            <div className="tc-item-selects">
              <select value={item.petId} onChange={(e) => updatePet(item, e.target.value)} aria-label="Pet"><option value="">Select pet…</option>{data.catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name || entry.pet_name}</option>)}</select>
              <select value={item.variant} onChange={(e) => onChange(item.id, { variant: e.target.value as Variant })} aria-label="Variant">{variants.map((v) => <option key={v} value={v}>{variantLabelWide[v] || v}</option>)}</select>
              <select value={item.signerId} onChange={(e) => updateSigner(item, e.target.value)} aria-label="Designer / signer"><option value="">No signature / select designer</option>{data.signers.map((s) => <option key={s.id} value={s.id}>{s.display_name || s.signer_name}</option>)}</select>
            </div>
            <button className="tc-remove" onClick={() => onRemove(item.id)} title="Remove pet"><Trash2 size={16}/></button>
          </div>
          <div className="tc-item-values">
            <label><span>SIGNATURE VALUE</span><div><input type="number" min="0" value={item.signatureValue} onChange={(e) => onChange(item.id, { signatureValue: e.target.value })} placeholder="0"/><small>Gems</small></div></label>
            <label><span>HUGE VALUE</span><div><input type="number" min="0" value={item.hugeValue} onChange={(e) => onChange(item.id, { hugeValue: e.target.value })} placeholder="0"/><small>Gems</small></div></label>
            <label className="tc-demand-field"><span>RARITY / DEMAND</span><div><input type="number" min="1" max="10" value={item.demand} onChange={(e) => onChange(item.id, { demand: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}/><small>/ 10</small></div><em>{item.demand >= 9 ? 'Extremely rare' : item.demand >= 7 ? 'Very rare' : item.demand >= 5 ? 'Uncommon' : item.demand >= 3 ? 'Common' : 'Very common'}</em></label>
          </div>
        </article>;
      })}
      <button className="tc-add" onClick={onAdd}><Plus size={17}/> Add pet to {side === 'give' ? 'your offer' : 'the receive side'}</button>
    </div>
    <div className="tc-side-totals">
      <div><span>SIGNATURE VALUE</span><strong>{money(totalSignature)}</strong></div>
      <div><span>HUGE VALUE</span><strong>{money(totalHuge)}</strong></div>
      <div><span>RARITY-ADJUSTED</span><strong>{money(rarityAdjusted)}</strong></div>
    </div>
  </section>;
}

export function TradeCalculator({ data }: { data: VaultData }) {
  const [give, setGive] = useState<TradeItem[]>([newItem()]);
  const [get, setGet] = useState<TradeItem[]>([newItem()]);
  const [rarityEnabled, setRarityEnabled] = useState(true);
  const update = (side: Side, id: string, patch: Partial<TradeItem>) => {
    const setter = side === 'give' ? setGive : setGet;
    setter((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  };
  const add = (side: Side) => (side === 'give' ? setGive : setGet)((items) => [...items, newItem()]);
  const remove = (side: Side, id: string) => (side === 'give' ? setGive : setGet)((items) => items.filter((item) => item.id !== id));
  const totals = (items: TradeItem[]) => {
    const signature = items.reduce((sum, item) => sum + num(item.signatureValue), 0);
    const huge = items.reduce((sum, item) => sum + num(item.hugeValue), 0);
    const adjusted = items.reduce((sum, item) => sum + num(item.signatureValue) * rarityFactor(item.demand), 0);
    const demand = items.length ? items.reduce((sum, item) => sum + item.demand, 0) / items.length : 0;
    return { signature, huge, adjusted, demand };
  };
  const a = useMemo(() => totals(give), [give]);
  const b = useMemo(() => totals(get), [get]);
  const baseDiff = b.signature - a.signature;
  const pct = a.signature > 0 ? baseDiff / a.signature * 100 : b.signature > 0 ? 100 : 0;
  const effectiveGive = rarityEnabled ? a.adjusted : a.signature;
  const effectiveGet = rarityEnabled ? b.adjusted : b.signature;
  const effectiveDiff = effectiveGet - effectiveGive;
  const effectivePct = effectiveGive > 0 ? effectiveDiff / effectiveGive * 100 : effectiveGet > 0 ? 100 : 0;
  const demandDiff = b.demand - a.demand;
  const filled = [...give, ...get].filter((item) => item.petId).length;
  let verdict = 'Add pets to compare';
  let tone = 'neutral';
  let detail = 'Add the pets on both sides to calculate the trade.';
  if (filled > 0 && a.signature + b.signature > 0) {
    if (effectivePct >= 30) { verdict = 'INSANE WIN'; tone = 'win'; detail = 'You receive significantly more value, even after rarity is considered.'; }
    else if (effectivePct >= 12) { verdict = 'VERY GOOD DEAL'; tone = 'win'; detail = 'A strong win. The received side clearly outweighs your offer.'; }
    else if (effectivePct >= 3) { verdict = 'GOOD DEAL'; tone = 'win'; detail = 'You are getting a favorable trade.'; }
    else if (effectivePct > -3) { verdict = 'FAIR TRADE'; tone = 'fair'; detail = 'The values are close. Rarity and personal preference may decide it.'; }
    else if (effectivePct > -12) { verdict = 'SLIGHT OVERPAY'; tone = 'loss'; detail = 'You are paying a little more. Check whether the rarity is worth it.'; }
    else if (effectivePct > -30) { verdict = 'BAD DEAL'; tone = 'loss'; detail = 'You are overpaying. Consider asking for adds.'; }
    else { verdict = 'VERY BAD DEAL'; tone = 'loss'; detail = 'A heavy overpay. You should renegotiate unless there is a special reason.'; }
  }
  const sideProps = (side: Side, items: TradeItem[], total: ReturnType<typeof totals>) => ({
    side, title: side === 'give' ? 'You Give' : 'You Get', subtitle: side === 'give' ? 'What leaves your inventory' : 'What enters your inventory',
    items, data, onAdd: () => add(side), onChange: (id: string, patch: Partial<TradeItem>) => update(side, id, patch), onRemove: (id: string) => remove(side, id),
    totalSignature: total.signature, totalHuge: total.huge, rarityAdjusted: rarityEnabled ? total.adjusted : total.signature,
  });
  return <div className="tc-page">
    <div className="tc-hero"><div><span className="tc-kicker">NANZO TRADE LAB</span><h2>Trade Profit <b>Calculator</b></h2><p>Build both sides of a trade. Compare signed value, Huge value and rarity before you accept.</p></div><div className="tc-hero-icon"><ArrowDownUp size={38}/></div></div>
    <div className="tc-modebar"><div><span className="tc-live-dot"/> LIVE CALCULATION <small>Changes update instantly</small></div><label className="tc-toggle"><input type="checkbox" checked={rarityEnabled} onChange={(e) => setRarityEnabled(e.target.checked)}/><span/> Rarity weighting <b>{rarityEnabled ? 'ON' : 'OFF'}</b></label></div>
    <div className="tc-trade-grid"><TradeSide {...sideProps('give', give, a)}/><div className="tc-versus"><span>VS</span><ArrowDownUp size={19}/></div><TradeSide {...sideProps('get', get, b)}/></div>
    <section className={`tc-result tc-result-${tone}`}>
      <div className="tc-result-top"><div><span className="tc-kicker">TRADE VERDICT</span><h3>{verdict}</h3><p>{detail}</p></div><div className="tc-verdict-mark">{tone === 'win' ? <TrendingUp size={30}/> : tone === 'loss' ? <TrendingDown size={30}/> : <Scale size={30}/>}</div></div>
      <div className="tc-result-grid">
        <div><span>PROFIT / LOSS · SIGNATURE VALUE</span><strong className={baseDiff >= 0 ? 'tc-positive' : 'tc-negative'}>{baseDiff >= 0 ? '+' : '−'}{money(Math.abs(baseDiff))}</strong><small>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}% vs your offer</small></div>
        <div><span>HUGE VALUE DIFFERENCE</span><strong>{money(b.huge - a.huge)}</strong><small>Received minus given</small></div>
        <div><span>RARITY-ADJUSTED RESULT</span><strong className={effectiveDiff >= 0 ? 'tc-positive' : 'tc-negative'}>{effectiveDiff >= 0 ? '+' : '−'}{money(Math.abs(effectiveDiff))}</strong><small>{effectivePct >= 0 ? '+' : ''}{effectivePct.toFixed(1)}% · {rarityEnabled ? 'rarity included' : 'rarity ignored'}</small></div>
        <div><span>DEMAND / RARITY DIFFERENCE</span><strong>{demandDiff > 0 ? '+' : ''}{demandDiff.toFixed(1)} / 10</strong><small>{demandDiff > 0 ? 'Received side is rarer' : demandDiff < 0 ? 'Your offer is rarer' : 'Equal average rarity'}</small></div>
      </div>
      <div className="tc-demand-note"><ShieldCheck size={17}/><span><b>How rarity affects the verdict:</b> 10/10 means extremely rare and adds up to 20% to the evaluation; 1/10 is common and reduces it by up to 16%. Toggle rarity weighting to compare both views. This is a NANZO estimate, not an official market formula.</span></div>
    </section>
    <div className="tc-footnote"><Search size={14}/> Values are prefilled from the vault's signer Cosmic Values where available. You can edit every value and rarity score manually. Signature Value is used for the main verdict; Huge Value is shown as a separate comparison.</div>
  </div>;
}
