import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { handleAdminRequest } from '../../../src/lib/admin-function.ts';

function readEnv(name: string): string | undefined {
  const runtime = globalThis as {
    Deno?: { env: { get(key: string): string | undefined } };
  };
  return runtime.Deno?.env.get(name);
}

let service: SupabaseClient | undefined;

function serviceClient(): SupabaseClient {
  if (service) return service;
  const url = readEnv('SUPABASE_URL');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase service role is not configured');
  service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return service;
}

const handler = (req: Request): Promise<Response> =>
  handleAdminRequest(req, async (action, pin, callerHash) => {
    const rpc = action === 'summary' ? 'admin_summary' : 'admin_export';
    const { data, error } = await serviceClient().rpc(rpc, {
      pin,
      caller_hash: callerHash,
    });
    if (error) throw new Error('admin rpc failed');
    return data;
  }, readEnv('ADMIN_IP_SALT'));

export default { fetch: handler };
