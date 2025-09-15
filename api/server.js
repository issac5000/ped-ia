// Minimal Node HTTP server (no deps) serving static files and proxying OpenAI
// Usage: OPENAI_API_KEY=sk-... node api/server.js

import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load env vars from .env.local/.env for local dev if not already present
async function loadLocalEnv() {
  const tryFiles = ['.env.local', '.env'];
  for (const f of tryFiles) {
    try {
      const p = resolve(ROOT, f);
      const content = await readFile(p, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) return;
        const k = m[1];
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (process.env[k] == null) process.env[k] = v;
      });
    } catch {}
  }
}
await loadLocalEnv();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const API_KEY = process.env.OPENAI_API_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers={}) {
  const security = {
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
    // Allow Supabase + jsdelivr to match production CSP in vercel.json
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co https://*.supabase.in https://cdn.jsdelivr.net; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  };
  const h = { 'Access-Control-Allow-Origin': '*', ...security, ...headers };
  res.writeHead(status, h);
  res.end(body);
}

async function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  // prevent directory traversal
  const filePath = resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  try {
    const st = await stat(filePath);
    if (st.isDirectory()) return send(res, 404, 'Not Found');
    const ext = extname(filePath);
    const data = await readFile(filePath);
    const cc = ext === '.html' ? 'no-store' : 'public, max-age=604800';
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cc });
  } catch {
    send(res, 404, 'Not Found');
  }
}

async function parseJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function safeChildSummary(child) {
  if (!child) return 'Aucun profil';
  return {
    prenom: child.firstName,
    sexe: child.sex,
    date_naissance: child.dob,
    contexte: child.context,
    jalons: child.milestones,
    mesures: child.growth,
  };
}

async function aiAdvice(body) {
  if (!API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const question = String(body.question || '').slice(0, 2000);
  const child = safeChildSummary(body.child);
  const history = Array.isArray(body.history) ? body.history.slice(-20) : [];
  const system = `Tu es Ped’IA, un assistant parental pour enfants 0–7 ans.
Réponds de manière bienveillante, concrète et structurée en puces.
Inclure: Sommeil, Alimentation, Repères de développement et Quand consulter.
Prends en compte les champs du profil (allergies, type d’alimentation, style d’appétit, infos de sommeil, jalons, mesures) si présents.`;
  const user = `Contexte enfant: ${JSON.stringify(child)}\nQuestion du parent: ${question}`;
  const convo = [{ role:'system', content: system },
    ...history.filter(m=>m && (m.role==='user' || m.role==='assistant') && typeof m.content==='string').map(m=>({ role:m.role, content: m.content.slice(0,2000) })),
    { role:'user', content: user }
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.4, messages: convo })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${t}`);
  }
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content?.trim() || '';
  return { text };
}

async function aiRecipes(body){
  if (!API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const child = safeChildSummary(body.child);
  const prefs = String(body.prefs || '').slice(0, 400);
  const system = `Tu es Ped’IA, assistant nutrition 0–7 ans.
Donne des idées de menus et recettes adaptées à l’âge, en excluant les allergènes indiqués.
Prends en compte le type d’alimentation (allaitement/biberon/diversification), le style d’appétit et, si pertinent, les repères de sommeil.
Structure la réponse avec: Idées de repas, Portions suggérées, Conseils pratiques, Liste de courses.`;
  const user = `Contexte enfant: ${JSON.stringify(child)}\nPréférences/contraintes: ${prefs}`;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST', headers:{ 'Authorization':`Bearer ${API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model:'gpt-4o-mini', temperature:0.4, messages:[
      {role:'system', content: system}, {role:'user', content: user}
    ]})
  });
  if (!r.ok){ const t=await r.text(); throw new Error(`OpenAI error ${r.status}: ${t}`); }
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content?.trim() || '';
  return { text };
}

async function aiStory(body){
  if (!API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const child = safeChildSummary(body.child);
  const theme = String(body.theme || '').slice(0, 200);
  const duration = Math.max(1, Math.min(10, Number(body.duration || 3)));
  const sleepy = !!body.sleepy;
  const system = `Tu es Ped’IA, créateur d’histoires courtes pour 0–7 ans.
Rédige une histoire de ${duration} minute(s), adaptée à l’âge, avec le prénom.
Style ${sleepy ? 'très apaisant, vocabulaire doux, propice au coucher' : 'dynamique et bienveillant'}.
Texte clair, phrases courtes. Termine par une petite morale positive.`;
  const user = `Contexte enfant: ${JSON.stringify(child)}\nThème souhaité: ${theme || 'libre'}`;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST', headers:{ 'Authorization':`Bearer ${API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model:'gpt-4o-mini', temperature:0.7, messages:[
      {role:'system', content: system}, {role:'user', content: user}
    ]})
  });
  if (!r.ok){ const t=await r.text(); throw new Error(`OpenAI error ${r.status}: ${t}`); }
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content?.trim() || '';
  return { text };
}

async function aiComment(body){
  if (!API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const content = String(body.content || '').slice(0, 2000);
  const system = `Tu es Ped’IA, un assistant bienveillant pour parents. Rédige un commentaire clair, positif et bref (moins de 50 mots) sur la mise à jour fournie.`;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST', headers:{ 'Authorization':`Bearer ${API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model:'gpt-4o-mini', temperature:0.4, messages:[
      {role:'system', content: system}, {role:'user', content}
    ]})
  });
  if (!r.ok){ const t=await r.text(); throw new Error(`OpenAI error ${r.status}: ${t}`); }
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content?.trim() || '';
  return { text };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return send(res, 204, '', {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/advice') {
    try {
      const body = await parseJson(req);
      const out = await aiAdvice(body);
      return send(res, 200, JSON.stringify(out), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: 'IA indisponible', details: String(e.message || e) }), { 'Content-Type': 'application/json' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/recipes') {
    try {
      const body = await parseJson(req);
      const out = await aiRecipes(body);
      return send(res, 200, JSON.stringify(out), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: 'IA indisponible', details: String(e.message || e) }), { 'Content-Type': 'application/json' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/story') {
    try {
      const body = await parseJson(req);
      const out = await aiStory(body);
      return send(res, 200, JSON.stringify(out), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: 'IA indisponible', details: String(e.message || e) }), { 'Content-Type': 'application/json' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/comment') {
    try {
      const body = await parseJson(req);
      const out = await aiComment(body);
      return send(res, 200, JSON.stringify(out), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: 'IA indisponible', details: String(e.message || e) }), { 'Content-Type': 'application/json' });
    }
  }

  // Delete conversation (local dev server parity with Vercel function)
  if (req.method === 'POST' && url.pathname === '/api/messages/delete-conversation') {
    try {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
      const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
      if (!serviceKey || !supaUrl) return send(res, 500, JSON.stringify({ error:'Server misconfigured' }), { 'Content-Type':'application/json' });

      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token) return send(res, 401, JSON.stringify({ error:'Missing Authorization' }), { 'Content-Type':'application/json' });

      const body = await parseJson(req);
      const otherId = String(body.otherId || '').trim();
      if (!otherId) return send(res, 400, JSON.stringify({ error:'otherId required' }), { 'Content-Type':'application/json' });

      const uRes = await fetch(`${supaUrl}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': anonKey || serviceKey }
      });
      if (!uRes.ok) {
        const t = await uRes.text().catch(()=> '');
        return send(res, 401, JSON.stringify({ error:'Invalid token', details: t }), { 'Content-Type':'application/json' });
      }
      const uJson = await uRes.json();
      const uid = String(uJson?.id || uJson?.user?.id || '').trim();
      if (!uid) return send(res, 401, JSON.stringify({ error:'Invalid token' }), { 'Content-Type':'application/json' });

      const q1 = `${supaUrl}/rest/v1/messages?sender_id=eq.${encodeURIComponent(uid)}&receiver_id=eq.${encodeURIComponent(otherId)}`;
      const q2 = `${supaUrl}/rest/v1/messages?sender_id=eq.${encodeURIComponent(otherId)}&receiver_id=eq.${encodeURIComponent(uid)}`;
      for (const u of [q1, q2]) {
        const dRes = await fetch(u, {
          method: 'DELETE',
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Prefer': 'return=minimal'
          }
        });
        if (!dRes.ok) {
          const t = await dRes.text().catch(()=> '');
          return send(res, 500, JSON.stringify({ error:'Delete failed', details: t }), { 'Content-Type':'application/json' });
        }
      }

      return send(res, 200, JSON.stringify({ ok:true }), { 'Content-Type':'application/json' });
    } catch (e) {
      return send(res, 500, JSON.stringify({ error:'Server error', details: String(e.message || e) }), { 'Content-Type':'application/json' });
    }
  }

  // Fetch limited public profile fields for a list of user IDs using service role
  if (req.method === 'POST' && url.pathname === '/api/profiles/by-ids') {
    try {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
      const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
      if (!serviceKey || !supaUrl) return send(res, 500, JSON.stringify({ error:'Server misconfigured' }), { 'Content-Type':'application/json' });

      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token) return send(res, 401, JSON.stringify({ error:'Missing Authorization' }), { 'Content-Type':'application/json' });

      // Verify the token corresponds to a logged-in user (only to prevent open scraping)
      const uRes = await fetch(`${supaUrl}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': anonKey || serviceKey }
      });
      if (!uRes.ok) {
        const t = await uRes.text().catch(()=> '');
        return send(res, 401, JSON.stringify({ error:'Invalid token', details: t }), { 'Content-Type':'application/json' });
      }

      const body = await parseJson(req);
      const ids = Array.isArray(body?.ids) ? body.ids.map(x=>String(x)).filter(Boolean) : [];
      // Limit to a reasonable amount
      if (!ids.length) return send(res, 400, JSON.stringify({ error:'ids required' }), { 'Content-Type':'application/json' });
      if (ids.length > 200) return send(res, 400, JSON.stringify({ error:'too many ids' }), { 'Content-Type':'application/json' });

      // Build PostgREST in() filter
      const escaped = ids.map(id => id.replace(/"/g, '""'));
      const list = `(${escaped.map(id=>`"${id}"`).join(',')})`;
      const q = `${supaUrl}/rest/v1/profiles?select=id,full_name&id=in.${encodeURIComponent(list)}`;
      const pRes = await fetch(q, {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        }
      });
      if (!pRes.ok) {
        const t = await pRes.text().catch(()=> '');
        return send(res, 500, JSON.stringify({ error:'Fetch profiles failed', details: t }), { 'Content-Type':'application/json' });
      }
      const arr = await pRes.json();
      return send(res, 200, JSON.stringify({ profiles: arr }), { 'Content-Type':'application/json' });
    } catch (e) {
      return send(res, 500, JSON.stringify({ error:'Server error', details: String(e.message || e) }), { 'Content-Type':'application/json' });
    }
  }

  // Static
  return handleStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Ped’IA server on http://localhost:${PORT}`);
});
