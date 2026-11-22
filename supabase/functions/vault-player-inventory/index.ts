import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization, Apikey, X-Client-Info"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const rec=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const API="https://ps99.biggamesapi.io", AUTH="https://db.biggames.io/oauth/authorize", TOKEN="https://db.biggames.io/oauth/token";
const SCOPES=["player-data:pet-simulator-99:inventory:read"];
function b64(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
async function hash(s:string){return new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return json({error:"method_not_allowed"},405);
 try{
  const body=rec(await req.json().catch(()=>({}))), action=String(body.action??""), token=String(body.token??"");
  const clientId=Deno.env.get("BIG_GAMES_CLIENT_ID")??"", clientSecret=Deno.env.get("BIG_GAMES_CLIENT_SECRET")??"";
  if(!clientId||!clientSecret)return json({error:"oauth_not_configured"},503);
  if(action==="start"){
   const session=await supabase.rpc("vault_assert_session",{p_token:token});
   if(session.error)return json({error:"vault_access_denied"},401);
   const username=String(body.username??"").trim().replace(/^@/,"");
   if(!/^[A-Za-z0-9_]{3,20}$/.test(username))return json({error:"roblox_username_invalid"},400);
   const lookup=await fetch("https://users.roblox.com/v1/usernames/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({usernames:[username],excludeBannedUsers:false})});
   if(!lookup.ok)return json({error:"roblox_lookup_failed"},502);
   // Resolve the requested username to its canonical Roblox ID. Never trust a client-supplied ID.
   const lookupBody=await lookup.json();
   const lookupData=rec(lookupBody).data;
   const first=rec(Array.isArray(lookupData)?lookupData[0]:null);
   const userId=Number(first.id); if(!Number.isSafeInteger(userId)||userId<=0)return json({error:"roblox_not_found"},404);
   const verifier=b64(crypto.getRandomValues(new Uint8Array(48))), challenge=b64(await hash(verifier)), state=b64(crypto.getRandomValues(new Uint8Array(24)));
   const redirect="https://nanz-clan.com/signed-vault/player-callback";
   const saved=await supabase.rpc("vault_player_oauth_state_set",{p_state:state,p_code_verifier:verifier,p_redirect_uri:redirect,p_collector:Number(session.data),p_target_user_id:userId,p_target_username:username});
   if(saved.error)return json({error:"oauth_state_store_failed"},500);
   const url=new URL(AUTH);url.searchParams.set("client_id",clientId);url.searchParams.set("redirect_uri",redirect);url.searchParams.set("scope",SCOPES.join(" "));url.searchParams.set("code_challenge",challenge);url.searchParams.set("code_challenge_method","S256");url.searchParams.set("state",state);
   return json({status:"ok",authorize_url:url.toString(),username,user_id:userId});
  }
  if(action==="callback"){
   const code=String(body.code??""),state=String(body.state??"");
   if(!code||!state)return json({error:"oauth_callback_invalid"},400);
   const claimed=await supabase.rpc("vault_player_oauth_state_claim",{p_state:state});
   if(claimed.error)return json({error:"oauth_state_invalid"},400);
   const row=Array.isArray(claimed.data)?rec(claimed.data[0]):rec(claimed.data);
   const exchange=await fetch(TOKEN,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Authorization:"Basic "+btoa(clientId+":"+clientSecret)},body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:String(row.out_redirect_uri),code_verifier:String(row.out_code_verifier)})});
   const tok=rec(await exchange.json().catch(()=>({})));
   if(!exchange.ok||!tok.access_token)return json({error:"oauth_exchange_failed"},400);
   const access=String(tok.access_token),scope=String(tok.scope??"");
   if(!scope.includes("player-data:pet-simulator-99:inventory:read"))return json({error:"inventory_scope_missing"},403);
   const userId=Number(row.out_target_user_id);
   const username=String(row.out_target_username??"");
   const display=username;
   if(!Number.isSafeInteger(userId)||userId<=0||!username)return json({error:"oauth_target_missing"},400);
   const saved=await supabase.rpc("vault_player_oauth_save",{p_user_id:userId,p_username:username,p_display_name:display,p_access_token:access,p_scope:scope,p_expires_at:new Date(Date.now()+Number(tok.expires_in??2592000)*1000).toISOString(),p_collector:Number(row.out_collector)});
   if(saved.error)return json({error:"token_store_failed"},500);
   return json({status:"ok",username,user_id:userId});
  }
  if(action==="inventory"||action==="list"||action==="revoke"){
   const session=await supabase.rpc("vault_assert_session",{p_token:token});
   if(session.error)return json({error:"vault_access_denied"},401);
   if(action==="list"){
    const rows=await supabase.from("vault_player_oauth_tokens").select("roblox_user_id,roblox_username,display_name,expires_at,authorized_at").eq("authorized_by_collector",Number(session.data)).order("authorized_at",{ascending:false});
    if(rows.error)return json({error:"connections_unavailable"},500);
    return json({status:"ok",connections:rows.data??[]});
   }
   const userId=Number(body.user_id);if(!Number.isSafeInteger(userId)||userId<=0)return json({error:"user_id_invalid"},400);
   if(action==="revoke"){
    const del=await supabase.from("vault_player_oauth_tokens").delete().eq("roblox_user_id",userId).eq("authorized_by_collector",Number(session.data));
    return del.error?json({error:"revoke_failed"},500):json({status:"ok"});
   }
   const row=await supabase.from("vault_player_oauth_tokens").select("access_token,expires_at,token_scope").eq("roblox_user_id",userId).eq("authorized_by_collector",Number(session.data)).maybeSingle();
   if(row.error||!row.data)return json({error:"private_inventory_not_authorized"},404);
   if(new Date(row.data.expires_at).getTime()<Date.now())return json({error:"private_inventory_authorization_expired"},401);
   const res=await fetch(API+"/v1/account/inventory",{headers:{Authorization:"Bearer "+row.data.access_token,Accept:"application/json"}});
   if(res.status===401)return json({error:"private_inventory_authorization_expired"},401);
   if(res.status===403)return json({error:"inventory_scope_missing"},403);
   if(res.status===429)return json({error:"rate_limited",retry_after:res.headers.get("Retry-After")??"60"},429);
   if(!res.ok)return json({error:"private_inventory_fetch_failed"},502);
   const payload=rec(await res.json());return json({status:"ok",data:payload.data??{}});
  }
  return json({error:"unknown_action"},400);
 }catch(e){console.error("[vault-player-inventory]",e);return json({error:"integration_error"},500);}
});
