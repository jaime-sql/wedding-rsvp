import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AdminSummary, ExportRow, GuestInput, InvitePayload, SubmitResult } from './types';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const demoMode = !supabaseUrl || !supabaseAnonKey;

function client(): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey);
}

function asInvite(data: unknown): InvitePayload | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as InvitePayload;
  if (!record.wedding || !record.household || !Array.isArray(record.guests)) return null;
  return record;
}

function asSummary(data: unknown): AdminSummary | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as AdminSummary;
  if (!record.counts || !Array.isArray(record.households)) return null;
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

export async function fetchAdminSummary(pin: string): Promise<AdminSummary | null> {
  if (!supabaseUrl || !supabaseAnonKey) {
    const { demoApi } = await import('./demo-backend');
    const origin = typeof location === 'undefined' ? 'https://jaime-sql.github.io' : location.origin;
    return demoApi().adminSummary(pin, origin, import.meta.env.BASE_URL);
  }
  const { data, error } = await client().rpc('admin_summary', { pin });
  if (error) return null;
  return asSummary(data);
}

export async function fetchAdminExport(pin: string): Promise<ExportRow[] | null> {
  if (!supabaseUrl || !supabaseAnonKey) {
    const { demoApi } = await import('./demo-backend');
    return demoApi().adminExport(pin);
  }
  const { data, error } = await client().rpc('admin_export', { pin });
  if (error || !Array.isArray(data)) return null;
  return data as ExportRow[];
}
