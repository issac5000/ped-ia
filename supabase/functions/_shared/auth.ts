// supabase/functions/_shared/auth.ts
export function readClientJwt(req: Request): string | null {
  const h = req.headers.get('x-client-authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1] : null;
}

export type UserContext =
  | { kind: 'jwt'; jwt: string }
  | { kind: 'code'; code: string }
  | { kind: 'anonymous' };

export async function resolveUserContext(req: Request, body: any): Promise<UserContext> {
  const jwt = readClientJwt(req);
  if (jwt) return { kind: 'jwt', jwt };
  const code = body?.code ?? body?.anonCode ?? null;
  if (code) return { kind: 'code', code };
  return { kind: 'anonymous' };
}
