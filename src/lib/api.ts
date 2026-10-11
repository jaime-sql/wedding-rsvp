import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AdminAuthError,
  AdminExportResult,
  AdminSummary,
  AdminSummaryResult,
  ExportRow,
  GuestInput,
  InvitePayload,
  SubmitResult,
} from './types';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const demoMode = !supabaseUrl || !supabaseAnonKey;

function client(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase is not configured');
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

function asAuth(data: unknown): AdminAuthError {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'unavailable' };
  }
  const record = data as Record<string, unknown>;
  if (record.error === 'locked') return { ok: false, error: 'locked' };
  if (record.error === 'wrong_passphrase') {
    const remaining = typeof record.remaining === 'number' ? record.remaining : Number(record.remaining);
    return {
      ok: false,
      error: 'wrong_passphrase',
      remaining: Number.isFinite(remaining) ? remaining : 0,
    };
  }
  return { ok: false, error: 'unavailable' };
}

function asSummaryResult(data: unknown): AdminSummaryResult {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as AdminSummary & { error?: string };
    if (record.error === 'locked' || record.error === 'wrong_passphrase') return asAuth(data);
    if (record.counts && Array.isArray(record.households)) return { ok: true, summary: record };
  }
  return asAuth(data);
}

function asExportResult(data: unknown): AdminExportResult {
  if (Array.isArray(data)) return { ok: true, rows: data as ExportRow[] };
  return asAuth(data);
}

function asInvite(data: unknown): InvitePayload | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as InvitePayload;
  if (!record.wedding || !record.household || !Array.isArray(record.guests)) return null;
  return record;
}

export async function fetchInvite(token: string): Promise<InvitePayload | null> {
  if (!supabaseUrl || !supabaseAnonKey) {
    const { demoApi } = await import('./demo-backend');
    return demoApi().getInvite(token);
  }
  const { data, error } = await client().rpc('get_invite', { token });
  if (error) return null;
  return asInvite(data);
}

export async function sendRsvp(
  token: string,
  guests: GuestInput[],
  message: string | null,
): Promise<SubmitResult> {
  if (!supabaseUrl || !supabaseAnonKey) {
    const { demoApi } = await import('./demo-backend');
    return demoApi().submit(token, guests, message);
  }
  const { data, error } = await client().rpc('submit_rsvp', { token, guests, message });
  if (error || !data || typeof data !== 'object') {
    return { ok: false, error: 'invalid' };
  }
  const record = data as { ok?: boolean; error?: SubmitResult extends { error: infer E } ? E : never };
  if (record.ok === true) {
    const payload = asInvite(data);
    if (!payload) return { ok: false, error: 'invalid' };
    return { ok: true, payload };
  }
  if (record.error === 'deadline' || record.error === 'seats' || record.error === 'not_found') {
    return { ok: false, error: record.error };
  }
  return { ok: false, error: 'invalid' };
}

export async function fetchAdminSummary(pin: string): Promise<AdminSummaryResult> {
  if (!supabaseUrl || !supabaseAnonKey) {
    const { demoApi } = await import('./demo-backend');
    const origin = typeof location === 'undefined' ? 'https://jaime-sql.github.io' : location.origin;
    return demoApi().adminSummary(pin, origin, import.meta.env.BASE_URL);
  }
  const { data, error } = await client().rpc('admin_summary', { pin });
  if (error) return { ok: false, error: 'unavailable' };
  return asSummaryResult(data);
}

export async function fetchAdminExport(pin: string): Promise<AdminExportResult> {
  if (!supabaseUrl || !supabaseAnonKey) {
    const { demoApi } = await import('./demo-backend');
    return demoApi().adminExport(pin);
  }
  const { data, error } = await client().rpc('admin_export', { pin });
  if (error) return { ok: false, error: 'unavailable' };
  return asExportResult(data);
}
