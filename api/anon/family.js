import { processAnonFamilyRequest } from '../../lib/anon-family.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    let bodyRaw = '';
    for await (const chunk of req) bodyRaw += chunk;
    let payload = {};
    if (bodyRaw) {
      try {
        payload = JSON.parse(bodyRaw);
      } catch (err) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    const result = await processAnonFamilyRequest(payload);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(result.status).json(result.body);
  } catch (err) {
    const status = err && Number.isInteger(err.status) ? err.status : 500;
    const details = String(err?.details || err?.message || err);
    console.error('[api/anon/family] handler error', { status, details, error: err });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).json({ error: 'Server error', details });
  }
}
