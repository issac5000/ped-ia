import { readFile } from 'fs/promises';
import { resolve } from 'path';

let cachedEnv = null;

async function loadSupabaseEnv() {
  if (cachedEnv) return cachedEnv;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  let resolvedUrl = url || '';
  let resolvedAnonKey = anonKey || '';

  if (!resolvedUrl || !resolvedAnonKey) {
    try {
      const filePath = resolve(process.cwd(), 'assets', 'supabase-env.json');
      const content = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(content || '{}');
      resolvedUrl = resolvedUrl || parsed.url || parsed.SUPABASE_URL || '';
      resolvedAnonKey = resolvedAnonKey || parsed.anonKey || parsed.SUPABASE_ANON_KEY || '';
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn('[api/env] Failed to read supabase-env.json', err);
      }
    }
  }

  cachedEnv = { url: resolvedUrl, anonKey: resolvedAnonKey };
  return cachedEnv;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const env = await loadSupabaseEnv();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(env);
  } catch (error) {
    console.error('[api/env] handler error', error);
    return res.status(500).json({ error: 'Failed to resolve Supabase environment' });
  }
}
