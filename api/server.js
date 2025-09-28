// Serveur HTTP Node minimal (sans dépendances) qui sert les fichiers statiques et proxifie l’API OpenAI
// Utilisation : OPENAI_API_KEY=sk-... node api/server.js

import { createServer } from 'http';
import { randomBytes, randomUUID } from 'crypto';
import { readFile, stat } from 'fs/promises';
import { extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import {
  HttpError,
  fetchAnonProfile,
  getServiceConfig,
  normalizeCode,
  processAnonChildrenRequest,
} from '../lib/anon-children.js';
import { processAnonCommunityRequest } from '../lib/anon-community.js';
import { processAnonMessagesRequest } from '../lib/anon-messages.js';
import { processAnonParentUpdatesRequest } from '../lib/anon-parent-updates.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_DIGITS = '23456789';
const MAX_ANON_ATTEMPTS = 5;

/**
 * Génère un code lisible pour les profils anonymes en alternant lettres et chiffres.
 * On exclut volontairement les caractères ambigus (I, O, 0, 1) pour limiter les erreurs de saisie.
 */
function generateAnonCode() {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    const alphabet = i % 2 === 0 ? CODE_LETTERS : CODE_DIGITS;
    const index = bytes[i] % alphabet.length;
    out += alphabet[index];
  }
  return out;
}

/**
 * Détermine s’il faut retenter une création de profil après une erreur Supabase.
 * Les collisions de code_unique déclenchent un nouvel essai jusqu’à atteindre MAX_ANON_ATTEMPTS.
 */
function shouldRetryDuplicate(status, detailsText) {
  if (status === 409) return true;
  if (!detailsText) return false;
  return /duplicate key value/i.test(detailsText) && /code_unique/i.test(detailsText);
}

// Charge les variables d’environnement depuis .env.local/.env en local si nécessaire
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
const GOOGLE_KEY = process.env.GOOGLE_API_KEY || '';
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image-preview';
const AI_UNAVAILABLE_RESPONSE = { status: 'unavailable', message: 'Fonction IA désactivée' };

let cachedSupabaseEnv = null;
let cachedServiceClient = null;
let cachedServiceConfig = null;

async function resolveSupabaseEnv() {
  if (cachedSupabaseEnv) return cachedSupabaseEnv;
  const fromEnv = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
  };
  let url = fromEnv.url;
  let anonKey = fromEnv.anonKey;
  if (!url || !anonKey) {
    try {
      const filePath = resolve(ROOT, 'assets/supabase-env.json');
      const content = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(content || '{}');
      url = url || parsed.url || parsed.SUPABASE_URL || '';
      anonKey = anonKey || parsed.anonKey || parsed.SUPABASE_ANON_KEY || '';
    } catch {}
  }
  cachedSupabaseEnv = { url: url || '', anonKey: anonKey || '' };
  return cachedSupabaseEnv;
}

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

/**
 * Envoie une réponse HTTP en ajoutant les en-têtes de sécurité et de CORS.
 * Les réponses JSON passent par cette fonction afin d’harmoniser les en-têtes.
 */
function send(res, status, body, headers={}) {
  const security = {
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
    // Autorise Supabase + jsdelivr pour refléter la CSP de production définie dans vercel.json
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co https://*.supabase.in https://cdn.jsdelivr.net; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  };
  const h = { 'Access-Control-Allow-Origin': '*', ...security, ...headers };
  res.writeHead(status, h);
  res.end(body);
}

function getServiceSupabaseClient() {
  const { supaUrl, serviceKey } = getServiceConfig();
  const needsNewClient =
    !cachedServiceClient ||
    !cachedServiceConfig ||
    cachedServiceConfig.url !== supaUrl ||
    cachedServiceConfig.key !== serviceKey;
  if (needsNewClient) {
    cachedServiceClient = createClient(supaUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    cachedServiceConfig = { url: supaUrl, key: serviceKey };
  }
  return { supabase: cachedServiceClient, supaUrl, serviceKey };
}

function normalizeReplyId(value) {
  if (value == null) return '';
  return String(value).trim();
}

async function resolveForumActor(req, body, context, { required = false } = {}) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (token) {
    try {
      const { data, error } = await context.supabase.auth.getUser(token);
      if (error || !data?.user?.id) {
        return { error: 'Invalid token', status: 401 };
      }
      const uid = String(data.user.id);
      return { type: 'google', userId: uid, profileId: uid };
    } catch (err) {
      console.warn('[api/server] resolveForumActor token failed', err);
      return { error: 'Invalid token', status: 401 };
    }
  }

  const code = normalizeCode(body?.code || body?.code_unique);
  if (code) {
    try {
      const profile = await fetchAnonProfile(context.supaUrl, context.serviceKey, code);
      const pid = profile?.id != null ? String(profile.id) : '';
      if (pid) return { type: 'anon', userId: pid, profileId: pid };
    } catch (err) {
      if (err instanceof HttpError) {
        return { error: err.message || 'Invalid code', status: err.status || 400 };
      }
      console.warn('[api/server] resolveForumActor code failed', err);
      return { error: 'Invalid code', status: 400 };
    }
  }

  if (required) {
    return { error: 'Authentication required', status: 401 };
  }

  return { type: 'guest', userId: null, profileId: null };
}

/**
 * Sert les fichiers statiques du prototype (HTML, assets, etc.).
 * La résolution de chemin reste strictement sous ROOT pour éviter toute traversée de répertoire.
 */
async function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  // Empêche toute tentative de traversée de répertoires
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

/**
 * Lit et parse le corps JSON d’une requête POST.
 * Détruit la connexion si le corps dépasse 1 Mo pour éviter les abus.
 */
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

/**
 * Normalise les informations enfant transmises au prompt IA pour éviter l’exposition de champs inutiles.
 */
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

function extractGeminiImage(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [];
  if (Array.isArray(payload.images)) candidates.push(...payload.images);
  if (Array.isArray(payload.predictions)) candidates.push(...payload.predictions);
  if (Array.isArray(payload.data)) candidates.push(...payload.data);
  if (Array.isArray(payload.output)) candidates.push(...payload.output);
  const inline = payload?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (inline?.inlineData?.data) {
    return { data: inline.inlineData.data, mime: inline.inlineData.mimeType || 'image/png' };
  }
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const data = item.data || item.base64 || item.base64Data || item.bytesBase64Encoded || item.image || item.inlineData?.data;
    if (data) {
      return { data, mime: item.mimeType || item.mime || item.inlineData?.mimeType || 'image/png' };
    }
  }
  return null;
}

function createHttpError(status, message, details) {
  const err = new Error(message || 'Request failed');
  err.statusCode = status;
  if (details) err.details = details;
  return err;
}

/**
 * Appelle OpenAI pour générer un conseil parental structuré.
 * Les historiques sont tronqués et filtrés côté serveur pour éviter les débordements.
 */
async function aiAdvice(body) {
  if (!API_KEY) return AI_UNAVAILABLE_RESPONSE;
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
    body: JSON.stringify({ model: 'gpt-4.1-nano', temperature: 0.4, messages: convo })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${t}`);
  }
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content?.trim() || '';
  return { text };
}

/**
 * Génère des idées de recettes adaptées à l’âge et au contexte nutritionnel de l’enfant.
 */
async function aiRecipes(body){
  if (!API_KEY) return AI_UNAVAILABLE_RESPONSE;
  const child = safeChildSummary(body.child);
  const prefs = String(body.prefs || '').slice(0, 400);
  const system = `Tu es Ped’IA, assistant nutrition 0–7 ans.
Donne des idées de menus et recettes adaptées à l’âge, en excluant les allergènes indiqués.
Prends en compte le type d’alimentation (allaitement/biberon/diversification), le style d’appétit et, si pertinent, les repères de sommeil.
Structure la réponse avec: Idées de repas, Portions suggérées, Conseils pratiques, Liste de courses.`;
  const user = `Contexte enfant: ${JSON.stringify(child)}\nPréférences/contraintes: ${prefs}`;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST', headers:{ 'Authorization':`Bearer ${API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model:'gpt-4.1-nano', temperature:0.4, messages:[
      {role:'system', content: system}, {role:'user', content: user}
    ]})
  });
  if (!r.ok){ const t=await r.text(); throw new Error(`OpenAI error ${r.status}: ${t}`); }
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content?.trim() || '';
  return { text };
}

/**
 * Crée une histoire personnalisée (durée configurable, ton apaisant ou énergique).
 */
async function aiStory(body){
  if (!API_KEY) return AI_UNAVAILABLE_RESPONSE;
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
    body: JSON.stringify({ model:'gpt-4.1-nano', temperature:0.7, messages:[
      {role:'system', content: system}, {role:'user', content: user}
    ]})
  });
  if (!r.ok){ const t=await r.text(); throw new Error(`OpenAI error ${r.status}: ${t}`); }
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content?.trim() || '';
  return { text };
}

/**
 * Produit un commentaire bref, objectif et empathique pour les journaux d’évolution.
 */
async function aiComment(body){
  if (!API_KEY) return AI_UNAVAILABLE_RESPONSE;
  const content = String(body.content || '').slice(0, 2000);
  const system = `Tu es Ped’IA, un assistant parental bienveillant ET objectif. Analyse la mise à jour fournie et rédige un commentaire clair et bref (maximum 50 mots).
- Souligne les progrès lorsqu’ils sont présents.
- Si la mise à jour décrit une difficulté ou une régression, reconnais-la explicitement, garde un ton apaisant (sans dramatiser) et propose un conseil concret ou une piste de surveillance.
- Montre de l’empathie sans compliments excessifs ni exclamations automatiques.`;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST', headers:{ 'Authorization':`Bearer ${API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model:'gpt-4.1-nano', temperature:0.4, messages:[
      {role:'system', content: system}, {role:'user', content}
    ]})
  });
  if (!r.ok){ const t=await r.text(); throw new Error(`OpenAI error ${r.status}: ${t}`); }
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content?.trim() || '';
  return { text };
}

function formatParentContextPromptLines(raw){
  if (!raw || typeof raw !== 'object') return [];
  const normalize = (value, max = 120) => {
    if (value == null) return '';
    const str = String(value).trim();
    return str ? str.slice(0, max) : '';
  };
  const num = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(20, n));
  };
  const ctx = {
    fullName: normalize(raw.pseudo ?? raw.full_name ?? ''),
    role: normalize(raw.role ?? raw.parent_role ?? ''),
    maritalStatus: normalize(raw.maritalStatus ?? raw.marital_status ?? ''),
    numberOfChildren: num(raw.numberOfChildren ?? raw.number_of_children ?? null),
    employment: normalize(raw.parentalEmployment ?? raw.parental_employment ?? ''),
    emotion: normalize(raw.parentalEmotion ?? raw.parental_emotion ?? ''),
    stress: normalize(raw.parentalStress ?? raw.parental_stress ?? ''),
    fatigue: normalize(raw.parentalFatigue ?? raw.parental_fatigue ?? ''),
  };
  const lines = [];
  if (ctx.role) lines.push(`Rôle affiché: ${ctx.role}`);
  if (ctx.maritalStatus) lines.push(`Statut marital: ${ctx.maritalStatus}`);
  if (Number.isFinite(ctx.numberOfChildren)) lines.push(`Nombre d’enfants: ${ctx.numberOfChildren}`);
  if (ctx.employment) lines.push(`Situation professionnelle: ${ctx.employment}`);
  if (ctx.emotion) lines.push(`État émotionnel: ${ctx.emotion}`);
  if (ctx.stress) lines.push(`Niveau de stress: ${ctx.stress}`);
  if (ctx.fatigue) lines.push(`Niveau de fatigue: ${ctx.fatigue}`);
  return lines;
}

function enforceWordLimit(text, maxWords = 80){
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(' ')}…`;
}

function normalizeForComparison(text){
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function areTextsTooSimilar(a, b){
  if (!a || !b) return false;
  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normB.length >= 20 && normA.includes(normB)) return true;
  return false;
}

function fallbackParentAiComment(){
  return 'Merci pour votre partage. Prenez le temps de souffler, reconnaissez vos besoins et n’hésitez pas à solliciter un proche ou un professionnel si vous en ressentez le besoin. Vous faites de votre mieux pour votre famille.';
}

async function aiParentUpdate(body){
  if (!API_KEY) return AI_UNAVAILABLE_RESPONSE;
  const updateType = typeof body.updateType === 'string'
    ? body.updateType.trim().slice(0, 64)
    : typeof body.update_type === 'string'
      ? String(body.update_type).trim().slice(0, 64)
      : '';
  const rawContent = body.updateContent ?? body.update_content ?? {};
  let updateFacts = '';
  if (typeof rawContent === 'string') {
    updateFacts = rawContent.trim().slice(0, 800);
  } else {
    try { updateFacts = JSON.stringify(rawContent); }
    catch { updateFacts = ''; }
    updateFacts = (updateFacts || '').slice(0, 800);
  }
  const parentComment = typeof body.parentComment === 'string'
    ? body.parentComment.trim().slice(0, 600)
    : '';
  const parentContextLines = formatParentContextPromptLines(body.parentContext);
  const userParts = [
    updateType ? `Type de mise à jour: ${updateType}` : '',
    updateFacts ? `Données factuelles de la mise à jour: ${updateFacts}` : '',
    parentComment
      ? `Commentaire libre du parent: ${parentComment}`
      : 'Commentaire libre du parent: aucun commentaire transmis.'
  ];
  if (parentContextLines.length) {
    userParts.push(`Contexte parental actuel:\n${parentContextLines.map((line) => `- ${line}`).join('\n')}`);
  }
  const user = userParts.filter(Boolean).join('\n\n') || 'Aucune donnée fournie.';
  const system = `Tu es Ped’IA, coach parental bienveillant. Analyse les informations factuelles ci-dessous et rédige un commentaire personnalisé (80 mots max).
Ton ton est empathique, rassurant et constructif.
Ne copie pas mot pour mot le commentaire du parent : reformule et apporte un éclairage nouveau.`;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({
      model:'gpt-4.1-nano',
      temperature:0.35,
      messages:[
        {role:'system', content: system},
        {role:'user', content: user}
      ]
    })
  });
  if (!r.ok){ const t=await r.text(); throw new Error(`OpenAI error ${r.status}: ${t}`); }
  const j = await r.json();
  let comment = j.choices?.[0]?.message?.content?.trim() || '';
  comment = enforceWordLimit(comment, 80);
  if (!comment || areTextsTooSimilar(comment, parentComment)) {
    comment = fallbackParentAiComment();
  }
  return { comment };
}

async function generateImage(prompt){
  if (!GOOGLE_KEY) throw createHttpError(500, 'Missing GOOGLE_API_KEY');
  const cleanPrompt = prompt.trim().slice(0, 800);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GOOGLE_KEY}`;
  console.info('[api/image] Envoi Gemini', { model: GEMINI_IMAGE_MODEL, promptLength: cleanPrompt.length });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: cleanPrompt }]
        }
      ]
    })
  });
  const text = await response.text();
  console.info('[api/image] Statut Gemini', { status: response.status, ok: response.ok });
  if (!response.ok) {
    let parsed = null;
    try { parsed = JSON.parse(text || '{}'); } catch {}
    const msg = parsed?.error?.message || parsed?.error || text || 'Gemini error';
    throw createHttpError(response.status, msg, parsed?.error);
  }
  let payload = null;
  try { payload = JSON.parse(text || '{}'); }
  catch (err) {
    console.error('[api/image] JSON invalide Gemini', err);
    throw createHttpError(502, 'Réponse inattendue du service image');
  }
  const imageNode = extractGeminiImage(payload);
  if (!imageNode?.data) {
    console.error('[api/image] Aucune image retournée', payload);
    throw createHttpError(502, 'Aucune image générée');
  }
  return { image: imageNode.data, mime: imageNode.mime || 'image/png' };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Pré-vol CORS
  if (req.method === 'OPTIONS') {
    return send(res, 204, '', {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/env') {
    const env = await resolveSupabaseEnv().catch(err => {
      console.warn('resolveSupabaseEnv failed', err);
      return { url: '', anonKey: '' };
    });
    return send(res, 200, JSON.stringify(env), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/image') {
    try {
      const body = await parseJson(req);
      const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt) {
        return send(res, 400, JSON.stringify({ error: 'Prompt manquant' }), { 'Content-Type': 'application/json; charset=utf-8' });
      }
      console.info('[api/image] Reçu', { promptLength: prompt.length, promptPreview: prompt.slice(0, 80) });
      const result = await generateImage(prompt);
      return send(res, 200, JSON.stringify(result), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      console.error('[api/image] Erreur', e);
      const isSyntax = e instanceof SyntaxError;
      const status = Number(e?.statusCode) || Number(e?.status) || (isSyntax ? 400 : 500);
      const payload = { error: isSyntax ? 'Requête JSON invalide' : (e?.message || 'Génération indisponible') };
      if (e?.details) payload.details = e.details;
      return send(res, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/ai') {
    try {
      const body = await parseJson(req);
      const typeFromQuery = url.searchParams.get('type');
      const type = typeof body?.type === 'string' && body.type ? body.type : (typeof typeFromQuery === 'string' ? typeFromQuery : '');
      let out;
      switch (type) {
        case 'advice':
          out = await aiAdvice(body);
          break;
        case 'recipes':
          out = await aiRecipes(body);
          break;
        case 'story':
          out = await aiStory(body);
          break;
        case 'comment':
          out = await aiComment(body);
          break;
        case 'parent-update':
          out = await aiParentUpdate(body);
          break;
        default:
          return send(res, 400, JSON.stringify({ error: 'Type non reconnu' }), { 'Content-Type': 'application/json; charset=utf-8' });
      }
      return send(res, 200, JSON.stringify(out), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      console.error('[api/server] /api/ai handler error', e);
      return send(res, 500, JSON.stringify({ error: 'IA indisponible', details: String(e.message || e) }), { 'Content-Type': 'application/json' });
    }
  }

  if (req.method === 'OPTIONS' && url.pathname === '/api/profiles/create-anon') {
    return send(res, 204, '', {
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/profiles/create-anon') {
    try {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
      const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
      if (!serviceKey || !supaUrl) {
        return send(res, 500, JSON.stringify({ error: 'Server misconfigured' }), { 'Content-Type': 'application/json; charset=utf-8' });
      }

      let body = {};
      try {
        body = await parseJson(req);
      } catch {
        return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }), { 'Content-Type': 'application/json; charset=utf-8' });
      }
      const fullNameRaw = typeof body.fullName === 'string' ? body.fullName.trim() : '';
      const basePayload = {};
      if (fullNameRaw) basePayload.full_name = fullNameRaw.slice(0, 120);

      let lastError = null;
      for (let attempt = 0; attempt < MAX_ANON_ATTEMPTS; attempt += 1) {
        const insertPayload = {
          ...basePayload,
          id: randomUUID(),
          code_unique: generateAnonCode()
        };

        const response = await fetch(`${supaUrl}/rest/v1/profiles`, {
          method: 'POST',
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(insertPayload)
        });

        const text = await response.text().catch(() => '');
        let json = null;
        if (text) {
          try { json = JSON.parse(text); } catch {}
        }

        if (response.ok) {
          const row = Array.isArray(json) ? json?.[0] : json;
          const id = row?.id || insertPayload.id;
          const code = row?.code_unique || insertPayload.code_unique;
          if (!id || !code) {
            return send(res, 500, JSON.stringify({ error: 'Invalid response from Supabase' }), { 'Content-Type': 'application/json; charset=utf-8' });
          }
          const profile = {
            id,
            code_unique: code,
            full_name: row?.full_name || basePayload.full_name || '',
            user_id: row?.user_id ?? null
          };
          return send(res, 200, JSON.stringify({ profile }), { 'Content-Type': 'application/json; charset=utf-8' });
        }

        const detailsText = json ? JSON.stringify(json) : text;
        if (shouldRetryDuplicate(response.status, detailsText)) {
          lastError = { status: response.status, details: detailsText };
          continue;
        }

        return send(res, response.status, JSON.stringify({ error: 'Create failed', details: detailsText || undefined }), { 'Content-Type': 'application/json; charset=utf-8' });
      }

      return send(res, lastError?.status || 500, JSON.stringify({ error: 'Create failed', details: lastError?.details || undefined }), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: 'Server error', details: String(e.message || e) }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
  }

  if (req.method === 'OPTIONS' && url.pathname === '/api/anon/children') {
    return send(res, 204, '', {
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/anon/children') {
    try {
      const body = await parseJson(req);
      const result = await processAnonChildrenRequest(body);
      return send(res, result.status, JSON.stringify(result.body), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      const status = e && Number.isInteger(e.status) ? e.status : 500;
      const payload = { error: 'Server error', details: String(e?.details || e?.message || e) };
      return send(res, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
    }
  }

  if (req.method === 'OPTIONS' && url.pathname === '/api/anon/community') {
    return send(res, 204, '', {
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/anon/community') {
    try {
      const body = await parseJson(req);
      const result = await processAnonCommunityRequest(body);
      return send(res, result.status, JSON.stringify(result.body), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      const status = e && Number.isInteger(e.status) ? e.status : 500;
      const payload = { error: 'Server error', details: String(e?.details || e?.message || e) };
      return send(res, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/server') {
    try {
      const body = await parseJson(req);
      const action = String(body?.action || '').trim();
      if (!action) {
        return send(res, 400, JSON.stringify({ error: 'action required' }), { 'Content-Type': 'application/json; charset=utf-8' });
      }

      let context;
      try {
        context = getServiceSupabaseClient();
      } catch (cfgErr) {
        const status = cfgErr instanceof HttpError ? cfgErr.status || 500 : 500;
        const message = cfgErr?.message || 'Server misconfigured';
        console.error('[api/server] service client init failed', cfgErr);
        return send(res, status, JSON.stringify({ error: message }), { 'Content-Type': 'application/json; charset=utf-8' });
      }

      if (action === 'like' || action === 'unlike') {
        const replyId = normalizeReplyId(body?.replyId || body?.reply_id || body?.id);
        if (!replyId) {
          return send(res, 400, JSON.stringify({ error: 'replyId required' }), { 'Content-Type': 'application/json; charset=utf-8' });
        }
        const actor = await resolveForumActor(req, body, context, { required: true });
        if (actor.error) {
          const status = actor.status || 401;
          return send(res, status, JSON.stringify({ error: actor.error }), { 'Content-Type': 'application/json; charset=utf-8' });
        }
        if (action === 'like') {
          const { error: upsertError } = await context.supabase
            .from('forum_reply_likes')
            .upsert([{ reply_id: replyId, user_id: actor.userId }], { onConflict: 'reply_id,user_id' });
          if (upsertError) {
            console.error('[api/server] like insert failed', upsertError);
            return send(res, 500, JSON.stringify({ error: 'like failed' }), { 'Content-Type': 'application/json; charset=utf-8' });
          }
        } else {
          const { error: deleteError } = await context.supabase
            .from('forum_reply_likes')
            .delete()
            .eq('reply_id', replyId)
            .eq('user_id', actor.userId);
          if (deleteError) {
            console.error('[api/server] unlike delete failed', deleteError);
            return send(res, 500, JSON.stringify({ error: 'unlike failed' }), { 'Content-Type': 'application/json; charset=utf-8' });
          }
        }
        const { data: rows, error: countError } = await context.supabase
          .from('forum_reply_likes')
          .select('reply_id,user_id')
          .eq('reply_id', replyId);
        if (countError) {
          console.error('[api/server] like count failed', countError);
          return send(res, 500, JSON.stringify({ error: 'count failed' }), { 'Content-Type': 'application/json; charset=utf-8' });
        }
        const array = Array.isArray(rows) ? rows : [];
        const count = array.length;
        const responsePayload = { success: true, count };
        if (actor.userId) {
          const normalizedActorId = String(actor.userId);
          const liked = array.some((row) => row?.user_id != null && String(row.user_id) === normalizedActorId);
          responsePayload.liked = liked;
        }
        return send(res, 200, JSON.stringify(responsePayload), { 'Content-Type': 'application/json; charset=utf-8' });
      }

      if (action === 'get-likes') {
        const idsRaw = [];
        if (Array.isArray(body?.replyIds)) idsRaw.push(...body.replyIds);
        if (body?.replyId != null) idsRaw.push(body.replyId);
        if (body?.reply_id != null) idsRaw.push(body.reply_id);
        const replyIds = Array.from(new Set(idsRaw.map(normalizeReplyId).filter(Boolean)));
        if (!replyIds.length) {
          return send(res, 400, JSON.stringify({ error: 'replyId required' }), { 'Content-Type': 'application/json; charset=utf-8' });
        }
        const actor = await resolveForumActor(req, body, context, { required: false });
        if (actor.error) {
          const status = actor.status || 401;
          return send(res, status, JSON.stringify({ error: actor.error }), { 'Content-Type': 'application/json; charset=utf-8' });
        }
        const { data, error } = await context.supabase
          .from('forum_reply_likes')
          .select('reply_id,user_id')
          .in('reply_id', replyIds);
        if (error) {
          console.error('[api/server] get-likes select failed', error);
          return send(res, 500, JSON.stringify({ error: 'fetch failed' }), { 'Content-Type': 'application/json; charset=utf-8' });
        }
        const counts = Object.create(null);
        const likedMap = Object.create(null);
        if (Array.isArray(data)) {
          data.forEach((row) => {
            const rid = row?.reply_id != null ? String(row.reply_id) : '';
            if (!rid) return;
            counts[rid] = (counts[rid] || 0) + 1;
            if (actor.userId && row?.user_id != null && String(row.user_id) === actor.userId) {
              likedMap[rid] = true;
            }
          });
        }
        replyIds.forEach((id) => {
          if (!(id in counts)) counts[id] = 0;
          if (actor.userId && !(id in likedMap)) likedMap[id] = false;
        });
        const single = replyIds.length === 1;
        const responsePayload = { success: true };
        if (single) {
          const key = replyIds[0];
          responsePayload.count = counts[key] ?? 0;
          if (actor.userId) responsePayload.liked = !!likedMap[key];
        } else {
          responsePayload.count = counts;
          if (actor.userId) responsePayload.liked = likedMap;
        }
        return send(res, 200, JSON.stringify(responsePayload), { 'Content-Type': 'application/json; charset=utf-8' });
      }

      return send(res, 400, JSON.stringify({ error: 'Unknown action' }), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (err) {
      console.error('[api/server] /api/server handler error', err);
      const status = Number(err?.statusCode || err?.status) || 500;
      const message = err?.message || 'Server error';
      return send(res, status, JSON.stringify({ error: message }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
  }

  if (req.method === 'OPTIONS' && url.pathname === '/api/anon/messages') {
    return send(res, 204, '', {
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/anon/messages') {
    try {
      const body = await parseJson(req);
      const result = await processAnonMessagesRequest(body);
      return send(res, result.status, JSON.stringify(result.body), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      const status = e && Number.isInteger(e.status) ? e.status : 500;
      const payload = { error: 'Server error', details: String(e?.details || e?.message || e) };
      return send(res, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
    }
  }

  if (req.method === 'OPTIONS' && url.pathname === '/api/anon/parent-updates') {
    return send(res, 204, '', {
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/anon/parent-updates') {
    try {
      const body = await parseJson(req);
      const result = await processAnonParentUpdatesRequest(body);
      return send(res, result.status, JSON.stringify(result.body), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      const status = e && Number.isInteger(e.status) ? e.status : 500;
      const payload = { error: 'Server error', details: String(e?.details || e?.message || e) };
      return send(res, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
    }
  }

  // Suppression d’une conversation (parité avec la fonction Vercel en local)
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

  // Récupère un sous-ensemble public de profils via la clé service (liste d’identifiants)
  if (req.method === 'POST' && url.pathname === '/api/profiles/by-ids') {
    try {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
      const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
      if (!serviceKey || !supaUrl) return send(res, 500, JSON.stringify({ error:'Server misconfigured' }), { 'Content-Type':'application/json' });

      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token) return send(res, 401, JSON.stringify({ error:'Missing Authorization' }), { 'Content-Type':'application/json' });

      // Vérifie que le jeton correspond bien à un utilisateur connecté (limite le scraping public)
      const uRes = await fetch(`${supaUrl}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': anonKey || serviceKey }
      });
      if (!uRes.ok) {
        const t = await uRes.text().catch(()=> '');
        return send(res, 401, JSON.stringify({ error:'Invalid token', details: t }), { 'Content-Type':'application/json' });
      }

      const body = await parseJson(req);
      const ids = Array.isArray(body?.ids) ? body.ids.map(x=>String(x)).filter(Boolean) : [];
      // Limite le nombre d’identifiants autorisés par appel
      if (!ids.length) return send(res, 400, JSON.stringify({ error:'ids required' }), { 'Content-Type':'application/json' });
      if (ids.length > 200) return send(res, 400, JSON.stringify({ error:'too many ids' }), { 'Content-Type':'application/json' });

      // Construit le filtre PostgREST in() en échappant les identifiants
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

  // Fichiers statiques
  return handleStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Ped’IA server on http://localhost:${PORT}`);
});
