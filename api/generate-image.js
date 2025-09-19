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

  const payload = {
    model: IMAGE_MODEL,
    prompt: description,
    size: '1024x1024',
    response_format: 'b64_json'
  };

  const endpoints = resolveImageEndpoints(IMAGE_MODEL);
  let lastError = null;

  for (const endpoint of endpoints) {
    const attempt = await requestImageFromEndpoint({ endpoint, payload, config, timeoutMs });
    if (attempt.success) {
      return { imageBase64: attempt.imageBase64, mimeType: attempt.mimeType, model: IMAGE_MODEL };
    }
    lastError = attempt.error;
    if (!attempt.shouldFallback) {
      throw attempt.error;
    }
  }

  if (lastError) throw lastError;
  const err = new Error('Image generation failed');
  err.status = 502;
  throw err;
}

function resolveImageEndpoints(model) {
  const name = (model || '').toLowerCase();
  const endpoints = [];
  if (name.includes('dall-e-2') || name.includes('dall_e_2')) {
    endpoints.push('/v1/images/generations');
  } else {
    endpoints.push('/v1/images');
  }
  if (!endpoints.includes('/v1/images')) endpoints.push('/v1/images');
  if (!endpoints.includes('/v1/images/generations')) endpoints.push('/v1/images/generations');
  return endpoints;
}

async function requestImageFromEndpoint({ endpoint, payload, config, timeoutMs }) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const url = `${config.baseUrl}${endpoint}`;
    const headers = buildOpenAIHeaders(config, { 'Content-Type': 'application/json' });
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller?.signal
    });

    const text = await resp.text();
    if (!resp.ok) {
      let details = text;
      let shouldFallback = false;
      try {
        const errJson = JSON.parse(text);
        details = errJson?.error?.message || errJson?.error?.type || details;
        const lowerDetails = typeof details === 'string' ? details.toLowerCase() : '';
        const lowerType = typeof errJson?.error?.type === 'string' ? errJson.error.type.toLowerCase() : '';
        const lowerCode = typeof errJson?.error?.code === 'string' ? errJson.error.code.toLowerCase() : '';
        if (
          resp.status === 404 ||
          resp.status === 405 ||
          lowerCode === 'not_found' ||
          lowerDetails.includes('not found') ||
          lowerDetails.includes('unknown path') ||
          (lowerType === 'invalid_request_error' && lowerDetails.includes('use the images api'))
        ) {
          shouldFallback = true;
        }
      } catch {}
      const err = new Error(`OpenAI error: ${details}`);
      err.status = resp.status >= 400 ? resp.status : 502;
      err.details = details;
      return { success: false, error: err, shouldFallback };
    }

    let data;
    try { data = JSON.parse(text); }
    catch {
      const err = new Error('Invalid response from OpenAI');
      err.status = 502;
      err.details = 'Invalid JSON payload';
      return { success: false, error: err, shouldFallback: false };
    }

    const image = data?.data?.[0]?.b64_json;
    if (!image) {
      const err = new Error('No image data returned from OpenAI');
      err.status = 502;
      err.details = 'No image data returned from OpenAI';
      return { success: false, error: err, shouldFallback: false };
    }

    const mimeType = data?.data?.[0]?.mime_type || 'image/png';
    return { success: true, imageBase64: image, mimeType };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const err = new Error('OpenAI request timed out');
      err.status = 504;
      err.details = 'OpenAI request timed out';
      return { success: false, error: err, shouldFallback: false };
    }
    const detail = error?.message || error;
    const err = new Error(`Failed to reach OpenAI: ${detail}`);
    err.status = 502;
    err.details = detail;
    return { success: false, error: err, shouldFallback: false };
  } finally {
    if (timeout != null) clearTimeout(timeout);
  }
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
