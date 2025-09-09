// Minimal Node HTTP server (no deps) serving static files and proxying OpenAI
// Usage: OPENAI_API_KEY=sk-... node api/server.js

import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
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
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
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

  // Static
  return handleStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Ped’IA server on http://localhost:${PORT}`);
});
