// Fonction serverless : /api/generate-image
// Génère une illustration à partir d'un prompt via l'API Images d'OpenAI.

import { randomUUID } from 'crypto';

import { buildOpenAIHeaders, getOpenAIConfig } from './openai-config.js';
import { buildOpenAIUrl, resolveOpenAIBaseUrl } from './openai-url.js';
import { insertImageJob } from './image-job-store.js';

const IMAGES_PATH = 'images/generations';
const DEFAULT_IMAGE_MODEL = 'gpt-image-1';
const LEGACY_FALLBACK_MODELS = ['dall-e-3'];
const AZURE_HOST_REGEX = /\.openai\.azure\.com$/i;
const AZURE_PATH_HINT_REGEX = /\/openai\//i;
const AZURE_IMAGE_POLL_TIMEOUT_MS = 60_000;
const AZURE_IMAGE_POLL_INITIAL_DELAY_MS = 1_000;
const AZURE_IMAGE_POLL_MAX_DELAY_MS = 5_000;

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

function sanitizeChildForJob(child) {
  if (!child || typeof child !== 'object') {
    return null;
  }
  const out = {};
  if (typeof child.firstName === 'string') out.firstName = child.firstName.slice(0, 120);
  if (typeof child.sex === 'string') out.sex = child.sex.slice(0, 40);
  if (typeof child.dob === 'string') out.dob = child.dob.slice(0, 40);
  if (typeof child.context === 'string') out.context = child.context.slice(0, 2000);
  if (Array.isArray(child.milestones)) out.milestones = child.milestones.slice(0, 120);
  if (child.growth !== undefined) out.growth = child.growth;
  return out;
}

export async function enqueueImageJob(body = {}) {
  const promptRaw = (body?.prompt ?? '').toString().trim();
  if (!promptRaw) {
    const err = new Error('prompt required');
    err.status = 400;
    throw err;
  }

  const prompt = promptRaw.slice(0, 600);
  const sanitizedChild = sanitizeChildForJob(body.child);
  const payload = { prompt, child: sanitizedChild };

  let serializedPayload;
  try {
    serializedPayload = JSON.stringify(payload);
  } catch (error) {
    const err = new Error('Invalid job payload');
    err.status = 400;
    err.cause = error;
    throw err;
  }

  const jobId = randomUUID();
  const jobRecord = {
    id: jobId,
    prompt: serializedPayload,
    status: 'pending',
    result: null,
    error_message: null,
  };

  const inserted = await insertImageJob(jobRecord);
  const finalId = inserted?.id || jobId;
  const finalStatus = inserted?.status || 'pending';
  return { jobId: finalId, status: finalStatus };
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
  const imageUrlRaw = data?.data?.[0]?.url;
  const imageUrl = typeof imageUrlRaw === 'string' ? imageUrlRaw.trim() : '';
  if (imageUrl) {
    return { imageUrl, model };
  }

  const imageDirect = extractImageUrl(data);
  if (imageDirect) {
    return { imageUrl: imageDirect, model };
  }

  if (isAzureConfig(config)) {
    const azureResult = await pollAzureImageOperation({ config, response, payload: data, model });
    if (azureResult) return azureResult;
  }

  const err = new Error('No image data returned from OpenAI');
  err.status = 502;
  err.raw = data;
  throw err;
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

function extractImageUrl(data) {
  if (!data || typeof data !== 'object') return '';
  const direct = typeof data?.data?.[0]?.url === 'string' ? data.data[0].url.trim() : '';
  if (direct) return direct;
  const nested = typeof data?.result?.data?.[0]?.url === 'string' ? data.result.data[0].url.trim() : '';
  if (nested) return nested;
  const contentUrl = typeof data?.result?.contentUrl === 'string' ? data.result.contentUrl.trim() : '';
  if (contentUrl) return contentUrl;
  const alt = typeof data?.result?.image_url === 'string' ? data.result.image_url.trim() : '';
  if (alt) return alt;
  return '';
}

function isAzureConfig(config) {
  const base = config?.baseUrl || config?.baseURL || '';
  if (!base) return false;
  try {
    const url = new URL(base);
    if (AZURE_HOST_REGEX.test(url.hostname)) return true;
  } catch {}
  return AZURE_HOST_REGEX.test(base) || AZURE_PATH_HINT_REGEX.test(base);
}

async function pollAzureImageOperation({ config, response, payload, model }) {
  const operationUrl = resolveAzureOperationUrl({ config, response, payload });
  const status = typeof payload?.status === 'string' ? payload.status.toLowerCase() : '';
  const directImage = extractImageUrl(payload);
  if (directImage && (!status || status === 'succeeded')) {
    return { imageUrl: directImage, model };
  }
  if (!operationUrl) {
    return null;
  }

  const deadline = Date.now() + AZURE_IMAGE_POLL_TIMEOUT_MS;
  let delayMs = computeNextAzureDelay(0, response);
  while (Date.now() < deadline) {
    if (delayMs > 0) await delay(delayMs);
    const pollRes = await fetch(operationUrl, {
      method: 'GET',
      headers: buildOpenAIHeaders(config),
    });

    let pollData;
    try {
      pollData = await pollRes.json();
    } catch (error) {
      const err = new Error('Invalid response from OpenAI');
      err.status = 502;
      err.cause = error;
      err.model = model;
      throw err;
    }

    const image = extractImageUrl(pollData);
    const pollStatus = typeof pollData?.status === 'string' ? pollData.status.toLowerCase() : '';

    if (!pollRes.ok && pollStatus !== 'running' && pollStatus !== 'notrunning') {
      const message = pollData?.error?.message || `OpenAI API error (${pollRes.status})`;
      const err = new Error(message);
      err.status = pollRes.status;
      if (pollData?.error?.code) err.code = pollData.error.code;
      else if (pollData?.error?.type) err.code = pollData.error.type;
      err.raw = pollData;
      err.model = model;
      throw err;
    }

    if (pollStatus === 'succeeded') {
      if (image) return { imageUrl: image, model };
      const err = new Error('No image data returned from OpenAI');
      err.status = 502;
      err.raw = pollData;
      err.model = model;
      throw err;
    }

    if (pollStatus === 'failed' || pollStatus === 'cancelled' || pollStatus === 'canceled') {
      const message = pollData?.error?.message || `Azure image generation ${pollStatus}`;
      const err = new Error(message);
      if (pollData?.error?.code) err.code = pollData.error.code;
      err.status = pollRes.ok ? 500 : pollRes.status;
      err.raw = pollData;
      err.model = model;
      throw err;
    }

    if (image && !pollStatus) {
      return { imageUrl: image, model };
    }

    delayMs = computeNextAzureDelay(delayMs, pollRes);
  }

  const timeoutError = new Error('Azure image generation timed out');
  timeoutError.status = 504;
  timeoutError.code = 'timeout';
  timeoutError.model = model;
  throw timeoutError;
}

function resolveAzureOperationUrl({ config, response, payload }) {
  const headerNames = ['operation-location', 'azure-asyncoperation', 'location'];
  for (const name of headerNames) {
    const value = readHeader(response, name);
    if (value) return value;
  }
  const opId = typeof payload?.id === 'string' ? payload.id.trim() : '';
  if (!opId) return '';
  return buildOpenAIUrl(config.baseUrl, `operations/images/${opId}`, config.apiVersion);
}

function computeNextAzureDelay(previousDelay, res) {
  const retryAfter = parseRetryAfter(readHeader(res, 'retry-after'));
  if (retryAfter != null) return Math.max(0, retryAfter);
  if (!previousDelay) return AZURE_IMAGE_POLL_INITIAL_DELAY_MS;
  const next = previousDelay * 1.5;
  return Math.min(Math.max(0, next), AZURE_IMAGE_POLL_MAX_DELAY_MS);
}

function delay(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readHeader(res, name) {
  if (!res || !res.headers) return '';
  const lower = name.toLowerCase();
  try {
    if (typeof res.headers.get === 'function') {
      const value = res.headers.get(name) ?? res.headers.get(lower);
      if (value) return value;
    }
  } catch {}
  try {
    if (lower in res.headers) return res.headers[lower];
    if (name in res.headers) return res.headers[name];
  } catch {}
  return '';
}

function parseRetryAfter(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric * 1000;
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    const delta = asDate - Date.now();
    if (Number.isFinite(delta)) return delta;
  }
  return null;
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
    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    const job = await enqueueImageJob(body);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(202).send(JSON.stringify(job));
  } catch (e) {
    console.error('Image job enqueue failed:', e);
    const status = Number.isInteger(e?.status) ? e.status : 500;
    const payload = {
      error: 'Image job enqueue failed',
      details: await extractErrorDetails(e),
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).send(JSON.stringify(payload));
  }
}

export async function extractErrorDetails(error) {
  if (!error) return 'Unknown error';

  if (typeof error.details !== 'undefined') {
    if (typeof error.details === 'string' && error.details) return error.details;
    if (error.details && typeof error.details === 'object') return error.details;
  }

  if (error.raw && typeof error.raw === 'object') {
    return error.raw;
  }

  if (error.errJson) {
    return error.errJson;
  }

  const response = error.response;
  if (response) {
    if (typeof response.data !== 'undefined') {
      return response.data;
    }
    if (typeof response.body === 'string' && response.body) {
      try {
        return JSON.parse(response.body);
      } catch {
        return response.body;
      }
    }
    if (response.body && typeof response.body === 'object') {
      return response.body;
    }
    if (typeof response.json === 'function') {
      try {
        const json = await response.json();
        if (json) return json;
      } catch {}
    }
    if (typeof response.text === 'function') {
      try {
        const text = await response.text();
        if (text) {
          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        }
      } catch {}
    }
  }

  if (error.message) {
    return String(error.message);
  }

  try {
    return JSON.parse(JSON.stringify(error));
  } catch {}

  return String(error);
}

export function resolveErrorModel(error) {
  if (error?.model && typeof error.model === 'string' && error.model) {
    return error.model;
  }
  if (Array.isArray(error?.triedModels) && error.triedModels.length) {
    const lastModel = error.triedModels[error.triedModels.length - 1]?.model;
    if (lastModel) return lastModel;
  }
  return DEFAULT_IMAGE_MODEL;
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
