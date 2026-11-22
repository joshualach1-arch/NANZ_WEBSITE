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
  const [progress,setProgress]=useState<{percent:number;stage:string;detail:string}>({percent:0,stage:'',detail:''});
  const [error,setError]=useState('');
  const [analysis,setAnalysis]=useState<Analysis|null>(null);
  const [imported,setImported]=useState(false);
  const [sideGems,setSideGems]=useState<{give:string;get:string}>({give:'0',get:'0'});
  const addFiles=async(list:FileList|File[]|null)=>{
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
    setBusy(true);setError('');setAnalysis(null);setImported(false);setProgress({percent:2,stage:'Connecting to Vision AI',detail:'Securely sending your screenshots for analysis.'});
    try {
      const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/screenshot-trade-analyzer`,{
        method:'POST',
        headers:{'Content-Type':'application/json',apikey:import.meta.env.VITE_SUPABASE_ANON_KEY,Authorization:`Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`},
        body:JSON.stringify({
          token,images:files.map(f=>({name:f.file.name,data:f.data})),
          petCatalog:data.catalog.map(p=>({name:p.display_name||p.pet_name,category:p.category,cosmic_value:p.cosmic_value})).slice(0,1800),
          signerCatalog:data.signers.map(s=>({signer_name:s.signer_name,display_name:s.display_name,cosmic_exclusive_value:s.cosmic_exclusive_value,cosmic_huge_value:s.cosmic_huge_value,cosmic_titanic_value:s.cosmic_titanic_value})).slice(0,1200),
        }),
      });
      if(!response.ok||!response.body) {
        const payload=await response.json().catch(()=>({}));
        throw new Error(payload.error||`Vision service returned HTTP ${response.status}. Please try again.`);
      }
      const reader=response.body.getReader();
      const decoder=new TextDecoder();
      let buffer='';
      let completed:Analysis|null=null;
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        const events=buffer.split('\n\n');
        buffer=events.pop()||'';
        for(const event of events){
          const line=event.split('\n').find(part=>part.startsWith('data:'));
          if(!line)continue;
          const payload=JSON.parse(line.slice(5).trim());
          if(payload.type==='progress')setProgress({percent:Number(payload.percent)||0,stage:String(payload.stage||'Analyzing'),detail:String(payload.detail||'')});
          if(payload.type==='error')throw new Error(String(payload.error||'Screenshot analysis failed. Please try again.'));
          if(payload.type==='complete'){
            completed=payload.analysis as Analysis;
            setProgress({percent:100,stage:'Analysis complete',detail:'Your trade is ready to review.'});
          }
        }
      }
      if(!completed)throw new Error('The analysis connection ended before a result was received. Please try again.');
      setAnalysis(completed);
      const gems=(completed.gems??[]) as DetectedGem[];
      setSideGems({give:String(gems.filter(g=>g.side==='give').reduce((n,g)=>n+parseMoney(g.amount),0)),get:String(gems.filter(g=>g.side==='get').reduce((n,g)=>n+parseMoney(g.amount),0))});
    } catch(e) {
      setError(e instanceof Error?e.message:'An unexpected error occurred while analyzing your screenshots.');
    } finally {
      setBusy(false);
    }
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
    <div className="sc-paste-wrap">
      <label htmlFor="sc-paste-input"><span>QUICK PASTE</span><small>Click the field and press Ctrl+V (or Cmd+V) to add a copied screenshot</small></label>
      <textarea id="sc-paste-input" className="sc-paste-input" rows={2} placeholder="Click here, then paste your copied image…" onPaste={e=>{
        const imageFiles=Array.from(e.clipboardData.items).filter(item=>item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>!!file);
        if(imageFiles.length){e.preventDefault();void addFiles(imageFiles.map((file,index)=>new File([file],file.name||`pasted-screenshot-${Date.now()}-${index}.png`,{type:file.type||'image/png'})));}
      }} />
      <span className="sc-paste-hint"><FileImage size={14}/> Images copied from screenshots, Snipping Tool or browser can be pasted here</span>
    </div>
    <label className="sc-dropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void addFiles(e.dataTransfer.files);}}><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e=>{void addFiles(e.target.files);e.currentTarget.value='';}}/><Upload size={27}/><b>Drop screenshots here or click to browse</b><span>PNG, JPG or WEBP · Up to 10 images · Multiple screenshots are analyzed together</span><strong>{files.length}/10 UPLOADED</strong></label>
    {files.length>0&&<div className="sc-upload-grid">{files.map((f,i)=><article key={f.id}><img src={f.preview} alt={f.file.name}/><span>SCREENSHOT {i+1}</span><button onClick={()=>{setFiles(v=>v.filter(x=>x.id!==f.id));setAnalysis(null);}} aria-label="Remove screenshot"><X size={14}/></button><small>{f.file.name}</small></article>)}</div>}
    {error&&<div className="sc-error"><AlertTriangle size={16}/>{error}</div>}
    {busy&&<div className="sc-progress" role="status" aria-live="polite">
      <div className="sc-progress-top"><span><LoaderCircle className="sc-spin"/> {progress.stage||'Starting analysis'}</span><strong>{Math.min(100,Math.max(0,progress.percent))}%</strong></div>
      <div className="sc-progress-track"><div className="sc-progress-fill" style={{width:`${Math.min(100,Math.max(0,progress.percent))}%`}}/></div>
      <p>{progress.detail}</p>
    </div>}
    <button className="sc-analyze" disabled={!files.length||busy} onClick={()=>void analyze()}>{busy?<><LoaderCircle className="sc-spin"/> {progress.stage||'Analyzing screenshots…'}</>:<><Sparkles size={18}/> Analyze trade with AI</>}</button>
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
