import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AlertTriangle, Check, FileImage, LoaderCircle, ScanSearch, Sparkles, Upload, X } from 'lucide-react';
import type { VaultData, Variant } from './vaultApi';
import { variantLabelWide } from './vaultApi';

type Side = 'give' | 'get' | 'unknown';
type ScreenshotFile = { id: string; file: File; preview: string; data: string };
type DetectedItem = {
  pet_name: string; catalog_match: string; variant: string; side: Side; signer_name: string;
  signature_present: boolean; signature_screenshot_indices: number[]; source_screenshot_indices: number[];
  confidence: number; needs_review: boolean; review_reason: string;
};
type DetectedGem = { side: Side; amount: number; screenshot_indices: number[]; confidence: number };
type Analysis = { screenshots?: Array<{index:number;kind:string;side:string;notes:string}>; items?: DetectedItem[]; gems?: DetectedGem[]; warnings?: string[] };

const id = () => `shot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const readDataUrl = (file: File) => new Promise<string>((resolve,reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
});
async function optimizeImage(file: File): Promise<string> {
  const source = await readDataUrl(file);
  const image = new Image(); image.src = source;
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=reject;});
  const scale = Math.min(1, 1600 / Math.max(image.width,image.height));
  const canvas = document.createElement('canvas'); canvas.width=Math.round(image.width*scale); canvas.height=Math.round(image.height*scale);
  const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('Could not process screenshot.');
  ctx.drawImage(image,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',0.72);
}
const parseMoney = (n: number) => Number.isFinite(n) ? n : 0;

export function ScreenshotTradeAnalyzer({data,token,onImport,onSetGems}:{data:VaultData;token:string|null;onImport:(side:'give'|'get',petId:string,signerId:string,variant:Variant)=>void;onSetGems:(side:'give'|'get',amount:string)=>void}) {
  const [files,setFiles]=useState<ScreenshotFile[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [analysis,setAnalysis]=useState<Analysis|null>(null);
  const [imported,setImported]=useState(false);
  const [sideGems,setSideGems]=useState<{give:string;get:string}>({give:'0',get:'0'});
  const addFiles=async(list:FileList|null)=>{
    if(!list)return;
    const remaining=10-files.length;
    const selected=Array.from(list).slice(0,remaining);
    const valid=selected.filter(f=>/^image\/(png|jpeg|webp)$/i.test(f.type));
    const prepared=await Promise.all(valid.map(async file=>({id:id(),file,preview:await readDataUrl(file),data:await optimizeImage(file)})));
    setFiles(current=>[...current,...prepared]);setAnalysis(null);setImported(false);setError('');
  };
  const analyze=async()=>{
    if(!token){setError('Your vault session expired. Sign in again.');return;}
    if(!files.length){setError('Upload at least one screenshot first.');return;}
    const uploadBytes=files.reduce((sum,file)=>sum+Math.floor(file.data.length*0.75),0);
    if(uploadBytes>4.5*1024*1024){setError('The selected screenshots are too large for one request. Remove a few images or upload smaller screenshots (maximum 4.5 MB combined).');return;}
    setBusy(true);setError('');setAnalysis(null);setImported(false);
    const {data:response,error:invokeError}=await supabase.functions.invoke('screenshot-trade-analyzer',{body:{
      token,images:files.map(f=>({name:f.file.name,data:f.data})),
      petCatalog:data.catalog.map(p=>p.display_name||p.pet_name).slice(0,1800),
      signerCatalog:data.signers.map(s=>s.display_name||s.signer_name).slice(0,1200),
    }});
    setBusy(false);
    if(invokeError||response?.error){setError(response?.error||invokeError?.message||'Analysis failed.');return;}
    setAnalysis(response.analysis as Analysis);
    const gems=(response.analysis?.gems??[]) as DetectedGem[];
    setSideGems({give:String(gems.filter(g=>g.side==='give').reduce((n,g)=>n+parseMoney(g.amount),0)),get:String(gems.filter(g=>g.side==='get').reduce((n,g)=>n+parseMoney(g.amount),0))});
  };
  const updateItem=(index:number,patch:Partial<DetectedItem>)=>setAnalysis(a=>a?({...a,items:(a.items??[]).map((item,i)=>i===index?{...item,...patch}:item)}):a);
  const importAll=()=>{
    if(!analysis)return;
    for(const item of analysis.items??[]){
      if(item.side==='unknown')continue;
      const pet=data.catalog.find(p=>(p.display_name||p.pet_name)===item.catalog_match);
      if(!pet)continue;
      const signer=item.signature_present?data.signers.find(s=>(s.display_name||s.signer_name).toLowerCase()===(item.signer_name||'').toLowerCase()):undefined;
      const variant=(['normal','golden','rainbow','shiny','golden_shiny','rainbow_shiny'].includes(item.variant)?item.variant:'normal') as Variant;
      onImport(item.side,pet.id,signer?.id??'',variant);
    }
    onSetGems('give',sideGems.give);onSetGems('get',sideGems.get);setImported(true);
  };
  const catalogMatch=(item:DetectedItem)=>data.catalog.find(p=>(p.display_name||p.pet_name)===item.catalog_match);
  return <section className="sc-analyzer">
    <div className="sc-head"><div><span className="tc-kicker">NANZO VISION LAB</span><h3><ScanSearch/> Screenshot Trade Analyzer</h3><p>Upload up to 10 screenshots. Vision AI connects overview shots, signature close-ups and Gems into one trade.</p></div><div className="sc-ai-pill"><span/> VISION AI</div></div>
    <label className="sc-dropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void addFiles(e.dataTransfer.files);}}><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e=>{void addFiles(e.target.files);e.currentTarget.value='';}}/><Upload size={27}/><b>Drop screenshots here or click to browse</b><span>PNG, JPG or WEBP · Up to 10 images · Multiple screenshots are analyzed together</span><strong>{files.length}/10 UPLOADED</strong></label>
    {files.length>0&&<div className="sc-upload-grid">{files.map((f,i)=><article key={f.id}><img src={f.preview} alt={f.file.name}/><span>SCREENSHOT {i+1}</span><button onClick={()=>{setFiles(v=>v.filter(x=>x.id!==f.id));setAnalysis(null);}} aria-label="Remove screenshot"><X size={14}/></button><small>{f.file.name}</small></article>)}</div>}
    {error&&<div className="sc-error"><AlertTriangle size={16}/>{error}</div>}
    <button className="sc-analyze" disabled={!files.length||busy} onClick={()=>void analyze()}>{busy?<><LoaderCircle className="sc-spin"/> Analyzing all screenshots…</>:<><Sparkles size={18}/> Analyze trade with AI</>}</button>
    {analysis&&<div className="sc-review">
      <div className="sc-review-title"><div><span className="tc-kicker">AI DETECTION RESULTS</span><h4>Review your detected trade</h4><p>Close-ups are attached as signature evidence, not counted as extra pets. Check uncertain matches before importing.</p></div><span className="sc-count">{analysis.items?.length??0} PETS FOUND</span></div>
      {(analysis.screenshots??[]).map(s=><div className="sc-shot-kind" key={s.index}><b>Screenshot {s.index+1}</b><span>{s.kind.replaceAll('_',' ')}</span><small>{s.notes}</small></div>)}
      {(analysis.items??[]).map((item,i)=>{
        const match=catalogMatch(item);
        const signer=data.signers.find(s=>(s.display_name||s.signer_name).toLowerCase()===(item.signer_name||'').toLowerCase());
        return <article className="sc-detected" key={i}>
          <div className="sc-detected-art">{match?.image_url?<img src={match.image_url} alt=""/>:<FileImage/>}</div>
          <div className="sc-detected-fields">
            <div className="sc-detected-top"><b>{item.pet_name||'Unknown pet'}</b><span className={item.confidence>=.85?'sc-confidence-good':'sc-confidence-low'}>{Math.round((item.confidence||0)*100)}% match</span></div>
            <div className="sc-fields-grid">
              <label>Pet match<select value={item.catalog_match} onChange={e=>updateItem(i,{catalog_match:e.target.value})}><option value="">Choose catalog pet…</option>{data.catalog.map(p=><option key={p.id} value={p.display_name||p.pet_name}>{p.display_name||p.pet_name}</option>)}</select></label>
              <label>Trade side<select value={item.side} onChange={e=>updateItem(i,{side:e.target.value as Side})}><option value="give">You Give</option><option value="get">You Receive</option><option value="unknown">Unclear</option></select></label>
              <label>Variant<select value={item.variant} onChange={e=>updateItem(i,{variant:e.target.value})}>{['normal','golden','rainbow','shiny','golden_shiny','rainbow_shiny','unknown'].map(v=><option key={v} value={v}>{variantLabelWide[v as Variant]||v}</option>)}</select></label>
              <label>Designer / signature<select value={item.signer_name} onChange={e=>updateItem(i,{signer_name:e.target.value,signature_present:!!e.target.value})}><option value="">No signature / not seen</option>{data.signers.map(s=><option key={s.id} value={s.display_name||s.signer_name}>{s.display_name||s.signer_name}</option>)}</select></label>
            </div>
            <small>{item.signature_screenshot_indices?.length? `Signature evidence: screenshot(s) ${item.signature_screenshot_indices.map(n=>n+1).join(', ')} · `:''}{item.source_screenshot_indices?.length? `Pet shown in screenshot(s) ${item.source_screenshot_indices.map(n=>n+1).join(', ')}`:''}</small>
            {item.needs_review&&<em><AlertTriangle size={13}/> Needs review: {item.review_reason||'AI is not fully certain.'}</em>}
            {!match&&<em><AlertTriangle size={13}/> Select the correct catalog pet before importing.</em>}
            {item.signature_present&&!signer&&item.signer_name&&<em><AlertTriangle size={13}/> Designer not matched. Select a known designer or clear the field.</em>}
          </div>
        </article>;
      })}
      <div className="sc-gems-review"><b>Gems detected</b>{(['give','get'] as const).map(side=><label key={side}>{side==='give'?'You Give':'You Receive'}<input value={sideGems[side]} onChange={e=>setSideGems(v=>({...v,[side]:e.target.value}))} placeholder="0"/></label>)}</div>
      {(analysis.warnings??[]).map((w,i)=><div className="sc-warning" key={i}><AlertTriangle size={14}/>{w}</div>)}
      <button className="sc-import" onClick={importAll} disabled={imported||!(analysis.items??[]).some(x=>x.side!=='unknown'&&!!x.catalog_match)}>{imported?<><Check size={17}/> Added to normal trade calculator</>:<>Import reviewed items into trade calculator</>}</button>
      {imported&&<p className="sc-success">Your detected pets and Gems are now in the Normal Trade Calculator. Switch back to calculate the deal.</p>}
    </div>}
  </section>;
}
