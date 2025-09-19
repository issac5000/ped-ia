// Fonction serverless : /api/generate-image
// Génère une illustration à partir d'un prompt via l'API Images d'OpenAI.

import { buildOpenAIHeaders, getOpenAIConfig } from './openai-config.js';

const IMAGES_PATH = '/v1/images/generations';
export const IMAGE_MODEL = 'gpt-image-1';

export async function generateImage(body = {}, configOverrides = undefined) {
  const config = resolveConfig(configOverrides);
  const promptRaw = (body?.prompt ?? '').toString().trim();
  if (!promptRaw) {
    const err = new Error('prompt required');
    err.status = 400;
    throw err;
  }

  const prompt = promptRaw.slice(0, 600);
  const child = safeChildSummary(body.child);
  const contextText = buildContextText(child);

  if (!config.apiKey) {
    const err = new Error('Missing OPENAI_API_KEY');
    err.status = 500;
    throw err;
  }

  return await generateWithOpenAI({ prompt, contextText, config });
}

function buildContextText(child) {
  if (child && child !== 'Aucun profil') {
    return `Contexte enfant: ${JSON.stringify(child)}`;
  }
  return 'Contexte enfant: aucun détail spécifique.';
}

async function generateWithOpenAI({ prompt, contextText, config }) {
  const description = [
    'Crée une illustration colorée, douce et rassurante adaptée aux enfants de 0 à 7 ans. Style chaleureux, sans violence ni éléments effrayants.',
    contextText,
    `Description à illustrer: ${prompt}`
  ].join('\n');

  const endpoint = buildImagesEndpoint(config);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildOpenAIHeaders(config),
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: description,
      size: '1024x1024',
      response_format: 'b64_json',
    }),
  });

  let data;
  try {
    data = await response.json();
  } catch (error) {
    const err = new Error('Invalid response from OpenAI');
    err.status = 502;
    throw err;
  }

  if (!response.ok) {
    const message = data?.error?.message || 'OpenAI API error';
    const err = new Error(message);
    err.status = 500;
    throw err;
  }

  const image = data?.data?.[0]?.b64_json;
  if (!image) {
    const err = new Error('No image data returned from OpenAI');
    err.status = 502;
    throw err;
  }

  return { imageBase64: image, mimeType: 'image/png', model: IMAGE_MODEL };
}

function resolveConfig(overrides) {
  if (overrides && typeof overrides === 'object' && overrides.apiKey) {
    const baseUrl = overrides.baseUrl || overrides.baseURL;
    return {
      ...overrides,
      baseUrl: normalizeBaseUrl(baseUrl),
    };
  }
  return getOpenAIConfig(overrides || {});
}

function buildImagesEndpoint(config) {
  const base = normalizeBaseUrl(config?.baseUrl || config?.baseURL);
  return `${base}${IMAGES_PATH}`;
}

function normalizeBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'https://api.openai.com';
  return raw.replace(/\/+$/, '') || 'https://api.openai.com';
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
    const status = Number.isInteger(e?.status) ? e.status : 500;
    const message = e?.message ? String(e.message) : 'Image generation failed';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).send(JSON.stringify({ error: message }));
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
