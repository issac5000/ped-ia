import { fetchAnonProfile, getServiceConfig, normalizeCode } from '../../lib/anon-children.js';
import { buildProfileResponse } from '../../lib/anon-profile.js';
import { fetchProfileDetails } from '../../lib/anon-parent-updates.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    let codeRaw = '';
    if (req.method === 'GET') {
      codeRaw = typeof req.query?.code === 'string' ? req.query.code : '';
    } else {
      let body = '';
      for await (const chunk of req) body += chunk;
      if (body) {
        try {
          const payload = JSON.parse(body);
          codeRaw = typeof payload?.code === 'string' ? payload.code : codeRaw;
        } catch (e) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.status(400).json({ error: 'Invalid JSON body' });
        }
      }
    }

    const code = normalizeCode(codeRaw);
    if (!code) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(400).json({ error: 'code required' });
    }

    const { supaUrl, serviceKey } = getServiceConfig();
    const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
    let profile;
    try {
      profile = await fetchAnonProfile(supaUrl, serviceKey, code);
    } catch (err) {
      const status = err?.status || 404;
      const message = status === 403 ? 'Code not found' : err?.message || 'Code not found';
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(status === 403 ? 404 : status).json({ error: message });
    }
    if (!profile?.id) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(404).json({ error: 'Code not found' });
    }

    const profileRow = await fetchProfileDetails(supaUrl, headers, profile.id).catch(() => null);
    const response = buildProfileResponse({ updated: profileRow || {}, existing: profile, code });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ profile: response });
  } catch (e) {
    console.error('[api/profiles/by-code] handler error', e);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ error: 'Server error', details: String(e?.message || e) });
  }
}
