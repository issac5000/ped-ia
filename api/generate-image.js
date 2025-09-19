// Fonction serverless : /api/generate-image
// Génère une illustration à partir d'un prompt via l'API Images d'OpenAI.
import { buildOpenAIHeaders, getOpenAIConfig } from './openai-config.js';

export const IMAGE_MODEL = (process.env.OPENAI_IMAGE_MODEL || '').trim() || 'gpt-image-1';

export async function generateImage(body = {}, overrides = {}) {
  const config = getOpenAIConfig(overrides);
  const openaiKey = config.apiKey;

  const promptRaw = (body?.prompt ?? '').toString().trim();
  if (!promptRaw) {
    const err = new Error('prompt required');
    err.status = 400;
    throw err;
  }

  const prompt = promptRaw.slice(0, 600);
  const child = safeChildSummary(body.child);
  const contextText = buildContextText(child);

  if (!openaiKey) {
    const err = new Error('Missing OPENAI_API_KEY');
    err.status = 500;
    throw err;
  }

  return await generateWithOpenAI({
    prompt,
    contextText,
    config,
  });
}

function buildContextText(child) {
  if (child && child !== 'Aucun profil') {
    return `Contexte enfant: ${JSON.stringify(child)}`;
  }
  return 'Contexte enfant: aucun détail spécifique.';
}

async function generateWithOpenAI({ prompt, contextText, config, timeoutMs = 55000 }) {
  const description = [
    'Crée une illustration colorée, douce et rassurante adaptée aux enfants de 0 à 7 ans. Style chaleureux, sans violence ni éléments effrayants.',
    contextText,
    `Description à illustrer: ${prompt}`
  ].join('\n');

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let resp;
  try {
    const url = `${config.baseUrl}/v1/images/generations`;
    const headers = buildOpenAIHeaders(config, { 'Content-Type': 'application/json' });
    resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: description,
        size: '1024x1024',
        response_format: 'b64_json',
        n: 1
      }),
      signal: controller?.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const err = new Error('OpenAI request timed out');
      err.status = 504;
      throw err;
    }
    const detail = error?.message || error;
    const err = new Error(`Failed to reach OpenAI: ${detail}`);
    err.status = 502;
    throw err;
  } finally {
    if (timeout != null) clearTimeout(timeout);
  }

  const text = await resp.text();
  if (!resp.ok) {
    let details = text;
    try {
      const errJson = JSON.parse(text);
      details = errJson?.error?.message || errJson?.error?.type || details;
    } catch {}
    const err = new Error(`OpenAI error: ${details}`);
    err.status = resp.status >= 400 ? resp.status : 502;
    err.details = details;
    throw err;
  }

  let data;
  try { data = JSON.parse(text); }
  catch {
    const err = new Error('Invalid response from OpenAI');
    err.status = 502;
    throw err;
  }

  const image = data?.data?.[0]?.b64_json;
  if (!image) {
    const err = new Error('No image data returned from OpenAI');
    err.status = 502;
    throw err;
  }

  const mimeType = data?.data?.[0]?.mime_type || 'image/png';
  return { imageBase64: image, mimeType, model: IMAGE_MODEL };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}');
    const result = await generateImage(body);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify(result));
  } catch (e) {
    const status = Number.isInteger(e?.status) ? e.status : Number.isInteger(e?.statusCode) ? e.statusCode : 500;
    const details = e?.details ? String(e.details) : String(e?.message || e);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).send(JSON.stringify({ error: 'Image generation failed', details, model: IMAGE_MODEL }));
  }
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => { buf += chunk; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}
