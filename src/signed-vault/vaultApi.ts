import { supabase } from '@/lib/supabase';

export type Variant = 'normal' | 'golden' | 'rainbow' | 'shiny' | 'golden_shiny' | 'rainbow_shiny';

export type Collector = {
  collector_no: number;
  label: string;
  is_owner: boolean;
  roblox_username: string | null;
  roblox_user_id: number | null;
  avatar_url: string | null;
  notes: string | null;
};

export type CatalogPet = {
  id: string;
  pet_name: string;
  category: string;
  image_url: string | null;
  notes: string | null;
  cosmic_value: number | null;
  demand: number | null;
  value_source: string | null;
  in_game_value?: number | null;
  in_game_value_source?: string | null;
  in_game_value_timestamp?: string | null;
  external_id?: string | null;
  display_name?: string | null;
  signability?: string;
  signability_source?: string | null;
  signability_verified_at?: string | null;
  is_huge?: boolean;
  is_exclusive?: boolean;
  is_titanic?: boolean;
  is_gargantuan?: boolean;
  data_source?: string;
  manual_value?: number | null;
  manual_value_source?: string | null;
  manual_value_locked?: boolean;
  trade_hub_rap?: number | null;
  trade_hub_exist_count?: number | null;
  trade_hub_updated_at?: string | null;
};

export type SignerRole =
  | 'big_games_developer'
  | 'big_games_partner'
  | 'content_creator'
  | 'youtuber'
  | 'streamer'
  | 'influencer'
  | 'community_creator'
  | 'other';

export type Signer = {
  id: string;
  signer_name: string;
  roblox_username: string | null;
  roblox_user_id: number | null;
  avatar_url: string | null;
  notes: string | null;
  signature_count: number;
  cosmic_exclusive_value?: number | null;
  cosmic_huge_value?: number | null;
  cosmic_titanic_value?: number | null;
  cosmic_demand?: number | null;
  cosmic_exclusive_status?: string | null;
  cosmic_huge_status?: string | null;
  cosmic_titanic_status?: string | null;
  cosmic_demand_status?: string | null;
  cosmic_values_updated_at?: string | null;
  display_name?: string | null;
  profile_url?: string | null;
  roles?: SignerRole[];
  is_developer?: boolean;
  is_partner?: boolean;
  is_creator?: boolean;
  youtube_channel_id?: string | null;
  youtube_channel_name?: string | null;
  youtube_channel_url?: string | null;
  youtube_avatar_url?: string | null;
  youtube_subscribers?: number | null;
  verification_status?: 'verified' | 'community_verified' | 'unverified' | 'needs_review';
  data_source?: string;
};

export type SignatureRecord = {
  id: string;
  pet_id: string;
  signer_id: string;
  variant: Variant;
  notes: string | null;
  cosmic_signature_id?: string | null;
  signature_name?: string | null;
  signature_value?: number | string | null;
  verification_status?: 'verified' | 'community_verified' | 'unverified' | 'needs_review';
  source?: string | null;
  verified_at?: string | null;
  updated_at?: string;
};

export type VaultPet = {
  id: string;
  pet_id: string;
  pet_name: string;
  pet_image: string | null;
  pet_category: string;
  signer_id: string | null;
  signer_name: string | null;
  variant: Variant;
  nickname: string | null;
  acquired_at: string | null;
  purchase_price: number | string | null;
  currency: string;
  inventory_uid: string | null;
  added_by: string;
  notes: string | null;
  created_at: string;
  cosmic_value: number | null;
  signed_status?: SignedStatus;
  verification_status?: string;
  quantity?: number;
  stack_key?: string | null;
  instance_id?: string | null;
  collector_no?: number;
};

export type Acquisition = {
  id: string;
  pet_id: string;
  pet_name: string;
  signer_id: string | null;
  signer_name: string | null;
  variant: Variant;
  acquired_at: string | null;
  purchase_price: number | string | null;
  currency: string;
  source: 'manual' | 'sync' | 'trade' | 'gift' | 'booth_purchase' | 'auction' | 'giveaway' | 'other' | 'unconfirmed';
  notes: string | null;
  created_at: string;
  acquisition_type?: 'booth_purchase' | 'trade' | 'auction' | 'giveaway' | 'gift' | 'manual_addition' | 'other' | 'unconfirmed' | 'sync';
  verification_status?: 'verified' | 'community_verified' | 'unverified' | 'needs_review';
  signature_value_at_acquisition?: number | string | null;
  current_value?: number | string | null;
};

export type AcquisitionHistoryEntry = Acquisition & {
  collector_no: number;
  pet_image: string | null;
  pet_category: string | null;
  sync_batch_id: string | null;
  updated_at: string | null;
  updated_by: string | null;
  external_transaction_key?: string | null;
  trade_group_id?: string | null;
};

export type SignedStatus = 'verified' | 'unverified' | 'not_signed' | 'manual_review';

export type InventoryItem = {
  id: string;
  pet_id: string | null;
  pet_name: string;
  category: string | null;
  variant: Variant;
  quantity: number;
  stack_key: string | null;
  instance_id: string | null;
  inventory_uid: string;
  signature_data: Record<string, unknown> | null;
  signer_id: string | null;
  signer_name: string | null;
  signer_avatar: string | null;
  signer_roles: string[] | null;
  signed_status: SignedStatus;
  verification_status: string;
  present: boolean;
  first_seen_at: string;
  last_seen_at: string;
  data_source: string;
  cosmic_value: number | string | null;
};

export type InventorySnapshot = {
  id: string;
  status: 'running' | 'complete' | 'failed' | 'partial';
  pet_count: number;
  added: number;
  removed: number;
  changed: number;
  acquisitions_detected: number;
  error_code: string | null;
  started_at: string;
  completed_at: string | null;
};

export type VaultNotification = {
  id: string;
  kind: string;
  title: string;
  body_lines: string[];
  shown_at: string;
  dismissed_at: string | null;
};

export type ScannerData = {
  items: InventoryItem[];
  snapshots: InventorySnapshot[];
  notifications: VaultNotification[];
};

export type ChecklistEntry = {
  pet_id: string;
  pet_name: string;
  display_name: string | null;
  image_url: string | null;
  category: string;
  signability: string;
  signability_source: string | null;
  is_huge: boolean;
  is_exclusive: boolean;
  is_titanic: boolean;
  is_gargantuan: boolean;
  created_at: string;
  cosmic_value: number | string | null;
  owned_verified: boolean;
  owned_unverified: boolean;
  owned_any: boolean;
  known_signers: number;
  best_signature_value: number | string | null;
  sort_value: number | string | null;
};

export type ChecklistStatus = 'COLLECTED' | 'MISSING' | 'UNVERIFIED' | 'NOT_AVAILABLE' | 'RECENTLY_ADDED';

export type ValueSnapshot = {
  total_value: number | string;
  pet_count: number;
  captured_at: string;
};

export type VerificationRequest = {
  id: string;
  collector_no: number;
  pet_id: string;
  pet_name: string;
  signer_id: string | null;
  signer_name: string | null;
  status: 'pending' | 'verified' | 'rejected';
  evidence_url: string | null;
  notes: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type EggCatalogEntry = { id: string; egg_name: string; image_url: string | null; cosmic_value: number | string | null; rap_value: number | string | null; demand: number | null; value_source: string | null };
export type EggCollectionEntry = { id: string; collector_no: number; egg_id: string; owned: boolean; quantity: number; notes: string | null; acquired_at: string | null; egg_name: string; image_url: string | null; cosmic_value: number | string | null; demand: number | null };

export type VaultData = {
  me: number;
  is_owner: boolean;
  collectors: Collector[];
  settings: Record<string, unknown> | null;
  catalog: CatalogPet[];
  signers: Signer[];
  signatures: SignatureRecord[];
  pets: VaultPet[];
  other_pets: VaultPet[] | null;
  acquisitions: Acquisition[];
  value_snapshots: ValueSnapshot[];
  verification: VerificationRequest[];
  access_setup_required: boolean;
  roblox_accounts?: RobloxAccount[];
  egg_catalog?: EggCatalogEntry[];
  egg_collection?: EggCollectionEntry[];
};

export type RobloxAccount = {
  collector_no: number;
  roblox_user_id: number | null;
  roblox_username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  profile_url?: string | null;
  connection_status: string;
  connected_at?: string | null;
  last_synced_at?: string | null;
  is_self: boolean;
};

const BRIDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vault-bridge`;
const BIGGAMES_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vault-biggames`;
const CATALOG_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vault-catalog`;

export class VaultApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function vaultCall(action: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  // biggames-* / roblox-lookup / catalog-import actions live in dedicated
  // integration functions (kebab-case on the client, snake_case on the server);
  // everything else goes through the vault-bridge dispatcher. The session token
  // is injected automatically for the integration functions.
  const isBiggames = action.startsWith('biggames-') || action === 'roblox-lookup';
  const isCatalog = action === 'catalog-import' || action === 'cosmic-signers-import' || action === 'cosmic-pet-values-import' || action === 'cosmic-pet-values-progress' || action === 'cosmic-egg-import' || action === 'trade-hub-exclusive-import';
  const url = isBiggames ? BIGGAMES_URL : isCatalog ? CATALOG_URL : BRIDGE_URL;
  const payloadBody: Record<string, unknown> = isBiggames || isCatalog
    ? {
        action: action === 'cosmic-signers-import'
          ? 'cosmic_signer_import'
          : action.replace(/^biggames-/, '').replace(/-/g, '_'),
        ...body,
        token: body.token ?? readStoredToken(),
      }
    : { action, ...body };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
    body: JSON.stringify(payloadBody),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) throw new VaultApiError('Unreachable. Try again.', response.status);
  if (!response.ok || payload.error) {
    const code = String(payload.error ?? 'vault_error');
    const message = code === 'vault_access_denied'
      ? 'Access denied. Check the passkey.'
      : code === 'vault_owner_only'
        ? 'Only the owner can do this.'
        : code === 'vault_passkey_too_short'
          ? 'New passkey needs at least 10 characters.'
          : code === 'vault_setup_key_missing'
            ? 'Setup is locked: the VAULT_SETUP_KEY secret is not configured for the vault-bridge function yet. Add it in the Supabase dashboard (Edge Functions → vault-bridge → Secrets), then reload this page.'
            : code === 'pet_not_in_catalog' || code === 'pet_not_found'
            ? 'That pet is not in the catalog.'
            : code === 'signer_not_found'
              ? 'That signer does not exist.'
              : code === 'entry_not_found'
                ? 'That entry no longer exists.'
                : code === 'oauth_history_scope_missing' || code === 'oauth_scope_missing'
                  ? 'BIG Games trade/booth permissions are missing. Enable trades:read and booth:read in your BIG Games OAuth app, then reconnect your Roblox account.'
                  : code === 'oauth_token_expired'
                    ? 'Your BIG Games connection expired. Reconnect your Roblox account.'
                    : code === 'history_fetch_failed'
                      ? 'BIG Games trade history could not be loaded. Try again later.'
                      : code === 'history_store_failed'
                        ? 'Trade history was retrieved but could not be saved. Contact the vault owner.'
                : code === 'vault_roblox_input_invalid'
                  ? 'Enter a valid Roblox username (3–20 characters) or user ID.'
                  : code === 'vault_roblox_already_bound'
                    ? 'That Roblox account is already connected to the other collector.'
                    : code === 'roblox_not_found'
                      ? 'Roblox account not found. Check the username.'
                      : code === 'roblox_rate_limited'
                        ? 'Roblox is rate limiting. Try again in a minute.'
                        : code === 'roblox_unreachable'
                          ? 'Roblox is unreachable right now. Try again.'
                          : action.startsWith('cosmic-pet-values-') ? code : 'Something went wrong. Try again.';
    throw new VaultApiError(message, response.status);
  }
  return payload;
}

export function rpcCall(rpc: string, token: string, params: Record<string, unknown> = {}) {
  return vaultCall('manage', { rpc, token, params });
}

export async function fetchScannerData(token: string, collectorNo: number | null = null): Promise<ScannerData> {
  const result = await rpcCall('vault_scanner_data_get', token, collectorNo ? { p_collector_no: collectorNo } : {});
  return result.result as ScannerData;
}

export async function fetchChecklist(token: string, collectorNo: number | null = null): Promise<ChecklistEntry[]> {
  const result = await rpcCall('vault_checklist_get', token, collectorNo ? { p_collector_no: collectorNo } : {});
  return (result.result as { checklist: ChecklistEntry[] }).checklist;
}

export async function fetchAcquisitions(token: string, collectorNo: number | null = null): Promise<AcquisitionHistoryEntry[]> {
  const result = await rpcCall('vault_acquisitions_get', token, collectorNo ? { p_collector_no: collectorNo } : {});
  return (result.result as { acquisitions: AcquisitionHistoryEntry[] }).acquisitions;
}

export type VaultTradeGroup = {
  id: string; external_transaction_key: string; source: 'trade' | 'booth'; booth_kind?: 'purchase' | 'sale' | null; counterparty_uid?: number | null;
  transaction_at: string; total_gems: number | string | null; counterparty: string | null;
  given_items: Array<Record<string, unknown>>; received_items: Array<Record<string, unknown>>;
  items: Array<{ acquisition_id: string; pet_name: string; variant: Variant; pet_image: string | null; allocated_gems: number | string | null }>;
};

export async function fetchTradeGroups(token: string, collectorNo: number | null = null): Promise<VaultTradeGroup[]> {
  const result = await rpcCall('vault_trade_groups_get', token, collectorNo ? { p_collector_no: collectorNo } : {});
  return (result.result as { groups: VaultTradeGroup[] }).groups ?? [];
}

export async function updateTradeGroup(token: string, groupId: string, totalGems: number | null, allocations: Array<{ acquisition_id: string; allocated_gems: number }>): Promise<void> {
  await rpcCall('vault_trade_group_update', token, { p_group_id: groupId, p_total_gems: totalGems, p_allocations: allocations });
}

export async function dismissNotification(token: string, notificationId: string): Promise<void> {
  await rpcCall('vault_notifications_manage', token, { p_action: 'dismiss', p_notification_id: notificationId });
}

export async function correctAcquisition(token: string, acquisitionId: string, patch: {
  purchase_price?: number | null;
  currency?: string | null;
  acquisition_type?: string | null;
  acquired_at?: string | null;
  notes?: string | null;
}): Promise<void> {
  await rpcCall('vault_acquisition_manage', token, { p_acquisition_id: acquisitionId, ...patch });
}


export async function importCosmicPetValues(category: string, page: number): Promise<Record<string, unknown>> {
  return await vaultCall('cosmic-pet-values-import', { category, page });
}

export async function fetchCosmicPetImportProgress(): Promise<Record<string, unknown>> {
  const result = await vaultCall('cosmic-pet-values-progress');
  return (result.progress ?? {}) as Record<string, unknown>;
}

export async function importCosmicSigners(): Promise<Record<string, unknown>> {
  const result = await vaultCall('cosmic-signers-import');
  return result;
}

export async function assignUnknownSigner(token: string, params: {
  petEntryId: string;
  robloxUsername: string;
  variant?: string;
  signatureValue?: number | null;
  notes?: string | null;
}): Promise<Record<string, unknown>> {
  const result = await rpcCall('vault_unknown_signer_assign', token, {
    p_pet_entry_id: params.petEntryId,
    p_roblox_username: params.robloxUsername,
    p_variant: params.variant ?? null,
    p_signature_value: params.signatureValue ?? null,
    p_notes: params.notes ?? null,
  });
  return result.result as Record<string, unknown>;
}

export async function fetchStatus(): Promise<{ setup_required: boolean }> {
  const result = await vaultCall('status');
  return { setup_required: Boolean(result.setup_required) };
}

export async function login(passkey: string): Promise<{ token: string; collector_no: number; is_owner: boolean }> {
  const result = await vaultCall('login', { passkey });
  if (!result.token) throw new VaultApiError('Access denied. Check the passkey.', 401);
  return { token: String(result.token), collector_no: Number(result.collector_no), is_owner: Boolean(result.is_owner) };
}

export async function logout(token: string): Promise<void> {
  try {
    await vaultCall('logout', { token });
  } catch {
    // best-effort
  }
}

export async function fetchData(token: string): Promise<VaultData> {
  const result = await vaultCall('data', { token });
  const data = result.data as VaultData;
  try {
    const eggs = await rpcCall('vault_egg_data_get', token);
    return { ...data, ...(eggs.result as Pick<VaultData, 'egg_catalog' | 'egg_collection'>) };
  } catch {
    return { ...data, egg_catalog: [], egg_collection: [] };
  }
}

export const TOKEN_KEY = 'nanz_vault_token';

export function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable
  }
}

export function formatValue(value: number | string | null | undefined, currency = '$'): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (num === null || num === undefined || !Number.isFinite(num)) return '—';
  if (Math.abs(num) >= 1e12) return `${currency}${(num / 1e12).toFixed(2)}T`;
  if (Math.abs(num) >= 1e9) return `${currency}${(num / 1e9).toFixed(2)}B`;
  if (Math.abs(num) >= 1e6) return `${currency}${(num / 1e6).toFixed(2)}M`;
  if (Math.abs(num) >= 1e3) return `${currency}${(num / 1e3).toFixed(1)}K`;
  return `${currency}${num.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const variantLabel: Record<Variant, string> = {
  normal: 'Normal',
  golden: 'Golden',
  rainbow: 'Rainbow',
  shiny: 'Shiny',
  golden_shiny: 'Golden Shiny',
  rainbow_shiny: 'Rainbow Shiny',
};

export const variantLabelWide: Record<string, string> = {
  ...variantLabel,
  other: 'Other',
};

export const signedStatusLabels: Record<SignedStatus, string> = {
  verified: 'Signed – Verified',
  unverified: 'Signed – Unverified',
  not_signed: 'Not signed',
  manual_review: 'Unknown – Needs review',
};

export const acquisitionTypeLabels: Record<string, string> = {
  booth_purchase: 'Booth purchase',
  trade: 'Trade',
  auction: 'Auction',
  giveaway: 'Giveaway',
  gift: 'Gift',
  manual_addition: 'Manual addition',
  other: 'Other',
  unconfirmed: 'Unconfirmed',
  sync: 'Inventory scan',
};

export const variantTone: Record<Variant, 'gold' | 'blue' | 'pink' | 'gray'> = {
  normal: 'gray',
  golden: 'gold',
  rainbow: 'blue',
  shiny: 'pink',
};

export const signerRoleLabels: Record<SignerRole, string> = {
  big_games_developer: 'BIG Games Developer',
  big_games_partner: 'BIG Games Partner',
  content_creator: 'Content Creator',
  youtuber: 'YouTuber',
  streamer: 'Streamer',
  influencer: 'Influencer',
  community_creator: 'Community Creator',
  other: 'Other',
};

export const signabilityLabels: Record<string, string> = {
  signable: 'Signable',
  not_signable: 'Not signable',
  unknown: 'Unknown',
  needs_review: 'Needs review',
};

export const verificationLabels: Record<string, string> = {
  verified: 'Verified',
  community_verified: 'Community verified',
  unverified: 'Unverified',
  needs_review: 'Needs review',
};

/* ── Task 05: activity feed, value history, verification center ─── */

export type ActivityEvent = {
  at: string;
  kind: 'audit' | 'notification' | 'value_snapshot';
  event: string;
  actor: string;
  collector_no: number | null;
  detail: Record<string, unknown> | null;
};

export async function fetchActivityFeed(
  token: string,
  collectorNo: number | null = null,
  limit = 30
): Promise<ActivityEvent[]> {
  const result = await rpcCall('vault_activity_feed', token, {
    ...(collectorNo ? { p_collector_no: collectorNo } : {}),
    p_limit: limit,
  });
  return (result.result as { events: ActivityEvent[] }).events;
}

export type ValueHistoryPoint = {
  pet_value: number | string | null;
  signature_value: number | string | null;
  combined_value: number | string | null;
  source: string;
  captured_at: string;
};

export async function fetchValueHistory(token: string, petId: string): Promise<ValueHistoryPoint[]> {
  const result = await rpcCall('vault_value_history_get', token, { p_pet_id: petId });
  return (result.result ?? []) as ValueHistoryPoint[];
}

export async function fetchAuditLog(token: string): Promise<ActivityEvent[]> {
  const result = await rpcCall('vault_audit_get', token, {});
  const rows = Array.isArray(result.result) ? result.result : [];
  return rows.map((row) => {
    const entry = row as Record<string, unknown>;
    return {
      at: String(entry.created_at ?? ''),
      kind: 'audit' as const,
      event: String(entry.action ?? ''),
      actor: String(entry.actor ?? ''),
      collector_no: entry.collector_no != null ? Number(entry.collector_no) : null,
      detail: (entry.detail ?? null) as Record<string, unknown> | null,
    };
  });
}

export type VaultStats = {
  counts: Record<string, number>;
  verified: number;
  community_verified: number;
  unverified: number;
  not_signed: number;
  total_signed: number;
  total_value: number | string;
  verified_value: number | string;
  purchase_cost: number | string;
  progress: {
    total_signable: number;
    collected_verified: number;
    collected_unverified: number;
    signable_unknown: number;
    signable_unconfirmed: number;
  };
};

export async function fetchStats(token: string, collectorNo: number | null = null): Promise<VaultStats> {
  const result = await rpcCall('vault_stats_get', token, collectorNo ? { p_collector_no: collectorNo } : {});
  return result.result as VaultStats;
}

export type CostSnapshot = {
  total_value: number | string;
  purchase_cost: number | string;
  pet_count: number;
  captured_at: string;
};

export async function fetchSnapshots(token: string, collectorNo: number | null = null): Promise<CostSnapshot[]> {
  const result = await rpcCall('vault_snapshots_get', token, collectorNo ? { p_collector_no: collectorNo } : {});
  return (result.result as { snapshots: CostSnapshot[] }).snapshots;
}

export { supabase };
