export function callerAddress(headers: Headers): string {
  const cloudflare = headers.get('cf-connecting-ip')?.trim() ?? '';
  if (cloudflare) return cloudflare;
  const forwarded = headers.get('x-forwarded-for') ?? '';
  for (const part of forwarded.split(',')) {
    const ip = part.trim();
    if (ip) return ip;
  }
  return 'unknown';
}

export async function hashCaller(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
