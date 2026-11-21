create table if not exists public.vault_trade_groups (
  id uuid primary key default gen_random_uuid(),
  collector_no smallint not null check (collector_no in (1,2)),
  external_transaction_key text not null,
  source text not null check (source in ('trade','booth')),
  transaction_at timestamptz not null,
  total_gems numeric,
  counterparty text,
  given_items jsonb not null default '[]'::jsonb,
  received_items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collector_no, external_transaction_key)
);

alter table public.vault_trade_groups add column if not exists given_items jsonb not null default '[]'::jsonb;
alter table public.vault_trade_groups add column if not exists received_items jsonb not null default '[]'::jsonb;

alter table public.vault_acquisitions add column if not exists trade_group_id uuid references public.vault_trade_groups(id) on delete set null;

create table if not exists public.vault_trade_allocations (
  id uuid primary key default gen_random_uuid(),
  trade_group_id uuid not null references public.vault_trade_groups(id) on delete cascade,
  acquisition_id uuid not null unique references public.vault_acquisitions(id) on delete cascade,
  allocated_gems numeric not null check (allocated_gems >= 0),
  updated_at timestamptz not null default now()
);

insert into public.vault_trade_groups(collector_no,external_transaction_key,source,transaction_at,total_gems,counterparty)
select a.collector_no,a.external_transaction_key,
  case when bool_or(a.acquisition_type='booth_purchase') then 'booth' else 'trade' end,
  coalesce(min(a.acquired_at)::timestamptz,min(a.created_at)),
  max(a.purchase_price),
  nullif(substring(string_agg(coalesce(a.notes,''),' ') from 'Other party: ([^.]+)'), '')
from public.vault_acquisitions a
where a.external_transaction_key is not null
group by a.collector_no,a.external_transaction_key
on conflict(collector_no,external_transaction_key) do nothing;

update public.vault_acquisitions a set trade_group_id=g.id
from public.vault_trade_groups g
where a.collector_no=g.collector_no and a.external_transaction_key=g.external_transaction_key and a.trade_group_id is null;

create index if not exists vault_trade_groups_collector_time_idx on public.vault_trade_groups(collector_no, transaction_at desc);
create index if not exists vault_acquisitions_trade_group_idx on public.vault_acquisitions(trade_group_id);

alter table public.vault_trade_groups enable row level security;
alter table public.vault_trade_allocations enable row level security;

create or replace function public.vault_trade_groups_get(p_token text, p_collector_no smallint default null) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare v_collector smallint; v_owner boolean; v_scope smallint;
begin
  select s.collector_no,c.is_owner into v_collector,v_owner from vault_sessions s join vault_collectors c using(collector_no)
  where s.token_hash=public.vault_hash_secret(p_token) and s.revoked_at is null and s.expires_at>now();
  if not found then raise exception 'vault_access_denied'; end if;
  if p_collector_no is null or p_collector_no=v_collector then v_scope:=v_collector;
  elsif v_owner and p_collector_no in (1,2) then v_scope:=p_collector_no;
  else raise exception 'vault_owner_only'; end if;
  return jsonb_build_object('collector_no',v_scope,'groups',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',g.id,'external_transaction_key',g.external_transaction_key,'source',g.source,
      'transaction_at',g.transaction_at,'total_gems',g.total_gems,'counterparty',g.counterparty,
      'given_items',g.given_items,'received_items',g.received_items,'items',coalesce((select jsonb_agg(jsonb_build_object(
        'acquisition_id',a.id,'pet_name',pc.pet_name,'variant',a.variant,'pet_image',pc.image_url,
        'allocated_gems',al.allocated_gems
      ) order by pc.pet_name) from vault_acquisitions a join vault_pet_catalog pc on pc.id=a.pet_id
      left join vault_trade_allocations al on al.acquisition_id=a.id
      where a.trade_group_id=g.id), '[]'::jsonb)
    ) order by g.transaction_at desc) from vault_trade_groups g where g.collector_no=v_scope
  ),'[]'::jsonb));
end; $$;

create or replace function public.vault_trade_group_update(p_token text,p_group_id uuid,p_total_gems numeric,p_allocations jsonb) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare v_collector smallint; v_owner boolean; v_scope smallint; v_sum numeric; v_count int;
begin
  select s.collector_no,c.is_owner into v_collector,v_owner from vault_sessions s join vault_collectors c using(collector_no)
  where s.token_hash=public.vault_hash_secret(p_token) and s.revoked_at is null and s.expires_at>now();
  if not found then raise exception 'vault_access_denied'; end if;
  select collector_no into v_scope from vault_trade_groups where id=p_group_id;
  if not found then raise exception 'trade_group_not_found'; end if;
  if v_scope<>v_collector and not (v_owner and v_scope in (1,2)) then raise exception 'vault_owner_only'; end if;
  if p_total_gems is not null and p_total_gems<0 then raise exception 'invalid_total'; end if;
  if jsonb_typeof(coalesce(p_allocations,'[]'::jsonb))<>'array' then raise exception 'invalid_allocations'; end if;
  select coalesce(sum((x->>'allocated_gems')::numeric),0),count(*) into v_sum,v_count from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) x;
  if exists(select 1 from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) x where coalesce(x->>'acquisition_id','')='' or coalesce(x->>'allocated_gems','') !~ '^[0-9]+([.][0-9]+)?$') then raise exception 'invalid_allocations'; end if;
  if p_total_gems is not null and v_sum>p_total_gems then raise exception 'allocations_exceed_total'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) x left join vault_acquisitions a on a.id=(x->>'acquisition_id')::uuid and a.trade_group_id=p_group_id where a.id is null) then raise exception 'allocation_pet_not_in_trade'; end if;
  update vault_trade_groups set total_gems=p_total_gems,updated_at=now() where id=p_group_id;
  delete from vault_trade_allocations where trade_group_id=p_group_id;
  insert into vault_trade_allocations(trade_group_id,acquisition_id,allocated_gems)
  select p_group_id,(x->>'acquisition_id')::uuid,(x->>'allocated_gems')::numeric from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) x;
  return jsonb_build_object('ok',true,'total_gems',p_total_gems,'allocated_gems',v_sum,'items',v_count);
end; $$;

revoke all on function public.vault_trade_groups_get(text,smallint) from public,anon,authenticated;
grant execute on function public.vault_trade_groups_get(text,smallint) to service_role;
revoke all on function public.vault_trade_group_update(text,uuid,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.vault_trade_group_update(text,uuid,numeric,jsonb) to service_role;
