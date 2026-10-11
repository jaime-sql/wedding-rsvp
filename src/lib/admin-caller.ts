// The platform proxy appends the connecting client as the rightmost
// X-Forwarded-For hop. Hops to the left are whatever the caller sent, so
// they must not identify anyone. cf-connecting-ip is ignored for the same
// reason: the client can set it before the proxy.
export function callerAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for') ?? '';
  const hops = forwarded
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return hops.length > 0 ? hops[hops.length - 1] : 'unknown';
}

export async function hashCaller(ip: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
