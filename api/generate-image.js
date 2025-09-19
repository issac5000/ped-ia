// Fonction serverless : /api/generate-image
// Génère une illustration à partir d'un prompt via l'API Images d'OpenAI.

import { buildOpenAIHeaders, getOpenAIConfig } from './openai-config.js';
import { buildOpenAIUrl, resolveOpenAIBaseUrl } from './openai-url.js';

const IMAGES_PATH = 'images/generations';
const DEFAULT_IMAGE_MODEL = 'gpt-image-1';
const LEGACY_FALLBACK_MODELS = ['dall-e-3'];

export const IMAGE_MODEL = DEFAULT_IMAGE_MODEL;

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

  const requestedModel = normalizeModel(body?.model);
  const modelCandidates = getImageModelCandidates({
    requestedModel,
    overrides: configOverrides,
  });

  const triedModels = [];
  let lastError = null;

  for (const model of modelCandidates) {
    try {
      return await generateWithOpenAI({ prompt, contextText, config, model });
    } catch (error) {
      const normalizedError = normalizeOpenAIError(error, model);
      triedModels.push({
        model,
        status: normalizedError.status ?? undefined,
        code: normalizedError.code ?? undefined,
        message: normalizedError.message,
      });
      if (!shouldFallbackToNextModel(normalizedError)) {
        normalizedError.triedModels = triedModels;
        throw normalizedError;
      }
      lastError = normalizedError;
    }
  }

  const error = lastError instanceof Error ? lastError : new Error('Image generation failed');
  if (error.status == null) error.status = 500;
  error.triedModels = triedModels;
  throw error;
}

function buildContextText(child) {
  if (child && child !== 'Aucun profil') {
    return `Contexte enfant: ${JSON.stringify(child)}`;
  }
  return 'Contexte enfant: aucun détail spécifique.';
}

async function generateWithOpenAI({ prompt, contextText, config, model }) {
  const description = [
    'Crée une illustration colorée, douce et rassurante adaptée aux enfants de 0 à 7 ans. Style chaleureux, sans violence ni éléments effrayants.',
    contextText,
    `Description à illustrer: ${prompt}`
  ].join('\n');

  const endpoint = buildOpenAIUrl(config.baseUrl, IMAGES_PATH, config.apiVersion);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildOpenAIHeaders(config),
    body: JSON.stringify({
      model,
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
    err.cause = error;
    throw err;
  }

  if (!response.ok) {
    const message = data?.error?.message || `OpenAI API error (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    if (data?.error?.code) err.code = data.error.code;
    else if (data?.error?.type) err.code = data.error.type;
    if (data?.error?.param) err.param = data.error.param;
    err.raw = data;
    err.endpoint = endpoint;
    throw err;
  }

  const image = data?.data?.[0]?.b64_json;
  if (!image) {
    const err = new Error('No image data returned from OpenAI');
    err.status = 502;
    throw err;
  }

  return { imageBase64: image, mimeType: 'image/png', model };
}

export function getImageModelCandidates({ requestedModel, overrides } = {}) {
  const envModels = [
    normalizeModel(process.env.OPENAI_IMAGE_MODEL),
    ...parseModelEnv(process.env.OPENAI_IMAGE_MODELS),
  ].filter(Boolean);
  const overrideModel = normalizeModel(overrides?.imageModel ?? overrides?.model);
  const defaultModels = [...LEGACY_FALLBACK_MODELS];
  defaultModels.unshift(DEFAULT_IMAGE_MODEL);
  return dedupeModels([
    normalizeModel(requestedModel),
    overrideModel,
    ...envModels,
    ...defaultModels,
  ]);
}

function resolveConfig(overrides) {
  if (overrides && typeof overrides === 'object' && overrides.apiKey) {
    const baseUrl = overrides.baseUrl || overrides.baseURL;
    const { baseUrl: normalizedBase, version, searchParams } = resolveOpenAIBaseUrl(baseUrl);
    const queryString = searchParams?.toString() || '';
    const rebuiltBase = queryString ? `${normalizedBase}?${queryString}` : normalizedBase;
    const versionOverride = overrides.apiVersion ?? overrides.version;
    return {
      ...overrides,
      baseUrl: rebuiltBase,
      apiVersion: versionOverride ?? version ?? undefined,
    };
  }
  return getOpenAIConfig(overrides || {});
}

function normalizeModel(value) {
  if (!value) return '';
  if (typeof value !== 'string') return String(value).trim();
  return value.trim();
}

function parseModelEnv(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => normalizeModel(v)).filter(Boolean);
  return String(value)
    .split(',')
    .map((v) => normalizeModel(v))
    .filter(Boolean);
}

function dedupeModels(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeOpenAIError(error, model) {
  if (!(error instanceof Error)) {
    const err = new Error(typeof error === 'string' ? error : 'Unknown error');
    if (error && typeof error === 'object') {
      Object.assign(err, error);
    }
    error = err;
  }
  if (error.status == null && typeof error.statusCode === 'number') {
    error.status = error.statusCode;
  }
  if (!error.code && typeof error.errorCode === 'string') {
    error.code = error.errorCode;
  }
  if (!error.code && error.raw && typeof error.raw === 'object') {
    const rawCode = error.raw?.error?.code || error.raw?.error?.type;
    if (rawCode) error.code = rawCode;
  }
  error.model = model;
  return error;
}

function shouldFallbackToNextModel(error) {
  const status = typeof error.status === 'number' ? error.status : undefined;
  if (status === 404) return true;
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
  if (code.includes('model_not_found') || code.includes('invalid_model') || code.includes('deployment_not_found')) {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (!message) return false;
  if (message.includes('does not exist') || message.includes('not exist')) {
    if (message.includes('model') || message.includes('deployment')) return true;
  }
  if (message.includes('not available') && message.includes('model')) return true;
  if (message.includes('you do not have access') && message.includes('model')) return true;
  return false;
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
    const payload = { error: message };
    if (e?.details && typeof e.details === 'string') {
      payload.details = e.details;
    }
    if (Array.isArray(e?.triedModels) && e.triedModels.length) {
      payload.triedModels = e.triedModels;
      const lastModel = e.triedModels[e.triedModels.length - 1]?.model;
      if (lastModel && !payload.model) payload.model = lastModel;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).send(JSON.stringify(payload));
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
