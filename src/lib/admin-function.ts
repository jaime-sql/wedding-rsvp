import { callerAddress, hashCaller } from './admin-caller';

export const adminCorsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

export type AdminAction = 'summary' | 'export';

export type AdminCaller = (action: AdminAction, pin: string, callerHash: string) => Promise<unknown>;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: adminCorsHeaders });
}

export async function handleAdminRequest(
  req: Request,
  call: AdminCaller,
  salt: string | undefined,
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: adminCorsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'unavailable' }, 405);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: 'unavailable' }, 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ ok: false, error: 'unavailable' }, 400);
  }

  const record = payload as Record<string, unknown>;
  const action = record.action;
  const pin = record.pin;
  if ((action !== 'summary' && action !== 'export') || typeof pin !== 'string') {
    return json({ ok: false, error: 'unavailable' }, 400);
  }

  const trimmedSalt = salt?.trim() ?? '';
  if (!trimmedSalt) {
    return json({ ok: false, error: 'config', message: 'ADMIN_IP_SALT is not set' }, 500);
  }

  try {
    const callerHash = await hashCaller(callerAddress(req.headers), trimmedSalt);
    const data = await call(action, pin, callerHash);
    if (data === undefined || data === null) return json({ ok: false, error: 'unavailable' });
    return json(data);
  } catch {
    return json({ ok: false, error: 'unavailable' });
  }
}
