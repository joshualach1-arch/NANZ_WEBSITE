-- Consented private PS99 inventory connections for Player Inventory Explorer.
-- Each Roblox player authorizes NANZO independently. Tokens are never exposed to clients.
create table if not exists public.vault_player_oauth_states (
  state text primary key,
  code_verifier text not null,
  redirect_uri text not null,
  created_by_collector integer not null check (created_by_collector in (1,2)),
  target_user_id bigint not null,
  target_username text not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create table if not exists public.vault_player_oauth_tokens (
  roblox_user_id bigint primary key,
  roblox_username text,
  display_name text,
  access_token text not null,
  token_scope text not null,
  expires_at timestamptz not null,
  authorized_at timestamptz not null default now(),
  authorized_by_collector integer not null check (authorized_by_collector in (1,2)),
  updated_at timestamptz not null default now()
);
alter table public.vault_player_oauth_states enable row level security;
alter table public.vault_player_oauth_tokens enable row level security;
revoke all on public.vault_player_oauth_states from anon, authenticated;
revoke all on public.vault_player_oauth_tokens from anon, authenticated;

create or replace function public.vault_player_oauth_state_set(
  p_state text, p_code_verifier text, p_redirect_uri text, p_collector integer, p_target_user_id bigint, p_target_username text
) returns void language sql security definer set search_path=public as $$
  insert into public.vault_player_oauth_states(state,code_verifier,redirect_uri,created_by_collector,target_user_id,target_username)
  values(p_state,p_code_verifier,p_redirect_uri,p_collector,p_target_user_id,p_target_username);
$$;
create or replace function public.vault_player_oauth_state_claim(p_state text)
returns table(out_code_verifier text,out_redirect_uri text,out_collector integer,out_target_user_id bigint,out_target_username text)
language plpgsql security definer set search_path=public as $$
declare r record;
begin
  delete from public.vault_player_oauth_states where created_at < now()-interval '1 hour';
  update public.vault_player_oauth_states set claimed_at=now()
   where state=p_state and claimed_at is null
   returning code_verifier,redirect_uri,created_by_collector,target_user_id,target_username into r;
  if not found then raise exception 'oauth_state_invalid'; end if;
  return query select r.code_verifier,r.redirect_uri,r.created_by_collector,r.target_user_id,r.target_username;
end $$;
create or replace function public.vault_player_oauth_save(
 p_user_id bigint,p_username text,p_display_name text,p_access_token text,p_scope text,p_expires_at timestamptz,p_collector integer
) returns void language sql security definer set search_path=public as $$
 insert into public.vault_player_oauth_tokens(roblox_user_id,roblox_username,display_name,access_token,token_scope,expires_at,authorized_by_collector)
 values(p_user_id,p_username,p_display_name,p_access_token,p_scope,p_expires_at,p_collector)
 on conflict(roblox_user_id) do update set roblox_username=excluded.roblox_username,display_name=excluded.display_name,
 access_token=excluded.access_token,token_scope=excluded.token_scope,expires_at=excluded.expires_at,
 authorized_by_collector=excluded.authorized_by_collector,updated_at=now();
$$;
revoke execute on function public.vault_player_oauth_state_set(text,text,text,integer,bigint,text) from public,anon,authenticated;
revoke execute on function public.vault_player_oauth_state_claim(text) from public,anon,authenticated;
revoke execute on function public.vault_player_oauth_save(bigint,text,text,text,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.vault_player_oauth_state_set(text,text,text,integer,bigint,text) to service_role;
grant execute on function public.vault_player_oauth_state_claim(text) to service_role;
grant execute on function public.vault_player_oauth_save(bigint,text,text,text,text,timestamptz,integer) to service_role;
