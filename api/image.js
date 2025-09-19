// Fonction serverless : /api/image
// Route unique pour gérer la génération d'illustrations, le suivi de statut et le worker.

import { randomUUID } from 'crypto';

import { buildOpenAIHeaders, getOpenAIConfig } from './openai-config.js';
import { buildOpenAIUrl, resolveOpenAIBaseUrl } from './openai-url.js';
import {
  insertImageJob,
  fetchPendingImageJobs,
  parseJobPayload,
  updateImageJob,
  fetchImageJobById,
} from './image-job-store.js';

const IMAGES_PATH = 'images/generations';
const DEFAULT_IMAGE_MODEL = 'gpt-image-1';
const LEGACY_FALLBACK_MODELS = ['dall-e-3'];
const AZURE_HOST_REGEX = /\.openai\.azure\.com$/i;
const AZURE_PATH_HINT_REGEX = /\/openai\//i;
const AZURE_IMAGE_POLL_TIMEOUT_MS = 60_000;
const AZURE_IMAGE_POLL_INITIAL_DELAY_MS = 1_000;
const AZURE_IMAGE_POLL_MAX_DELAY_MS = 5_000;
const DEFAULT_BATCH_LIMIT = 3;
const MAX_ERROR_MESSAGE_LENGTH = 2_000;

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
  const parsedResult = parseJobResult(inserted?.result);
  const errorMessage = typeof inserted?.error_message === 'string' ? inserted.error_message : null;
  return {
    id: finalId,
    jobId: finalId,
    status: finalStatus,
    result: parsedResult,
    error_message: errorMessage,
  };
}

function parseJobResult(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed;
  } catch {}
  return trimmed;
}

export async function getImageJobStatus(jobId) {
  if (!jobId) {
    const err = new Error('jobId required');
    err.status = 400;
    throw err;
  }
  const job = await fetchImageJobById(jobId);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }
  return {
    status: job.status || 'pending',
    result: parseJobResult(job.result),
    error_message: job.error_message ?? null,
  };
}

function pickBatchLimit({ searchParams, body }) {
  if (body && typeof body === 'object' && body !== null) {
    const fromBody = Number(body.limit ?? body.batchSize);
    if (Number.isFinite(fromBody) && fromBody > 0) {
      return Math.min(Math.floor(fromBody), 10);
    }
  }
  if (searchParams) {
    const fromQuery = Number(searchParams.get('limit') ?? searchParams.get('batchSize'));
    if (Number.isFinite(fromQuery) && fromQuery > 0) {
      return Math.min(Math.floor(fromQuery), 10);
    }
  }
  return DEFAULT_BATCH_LIMIT;
}

function normalizeResultPayload(result) {
  if (!result || typeof result !== 'object') {
    return {
      imageUrl: typeof result === 'string' ? result : '',
      model: IMAGE_MODEL,
    };
  }
  return {
    imageUrl: typeof result.imageUrl === 'string' ? result.imageUrl : '',
    model: typeof result.model === 'string' && result.model ? result.model : IMAGE_MODEL,
  };
}

function serializeResultPayload(result) {
  const payload = normalizeResultPayload(result);
  return JSON.stringify(payload);
}

function truncateErrorMessage(message) {
  if (typeof message !== 'string') {
    try {
      return truncateErrorMessage(JSON.stringify(message));
    } catch {
      return 'Unknown error';
    }
  }
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) return message;
  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3)}...`;
}

export async function runImageGenerationWorker(options = {}) {
  const { limit = DEFAULT_BATCH_LIMIT } = options;
  const jobs = await fetchPendingImageJobs(limit);
  const summaries = [];
  for (const job of jobs) {
    if (!job || !job.id) continue;
    const payload = parseJobPayload(job.prompt);
    const jobBody = {
      prompt: payload.prompt,
      child: payload.child,
    };
    try {
      const result = await generateImage(jobBody);
      const serializedResult = serializeResultPayload(result);
      await updateImageJob(job.id, {
        status: 'done',
        result: serializedResult,
        error_message: null,
      }).catch((err) => {
        console.error('Failed to update job as done:', err);
      });
      summaries.push({ id: job.id, status: 'done', model: result?.model ?? IMAGE_MODEL });
    } catch (error) {
      console.error(`Image generation failed for job ${job.id}:`, error);
      const details = await extractErrorDetails(error);
      const fallbackModel = resolveErrorModel(error);
      const message = truncateErrorMessage(
        typeof details === 'string' ? details : JSON.stringify(details)
      );
      await updateImageJob(job.id, {
        status: 'failed',
        result: null,
        error_message: message,
      }).catch((err) => {
        console.error('Failed to mark job as failed:', err);
      });
      summaries.push({ id: job.id, status: 'failed', error: message, model: fallbackModel });
    }
  }
  return { processed: summaries.length, jobs: summaries };
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return res.status(204).end();
  }

  const url = new URL(req.url || '', 'http://localhost');
  const raw = await readBody(req);
  let body = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { ok: false, data: { message: 'Invalid JSON body' } });
    }
  }

  const action = normalizeAction(body?.action ?? url.searchParams.get('action'));
  if (!action) {
    return sendJson(res, 400, { ok: false, data: { message: 'Missing action parameter' } });
  }

  try {
    switch (action) {
      case 'generate': {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST,OPTIONS');
          return sendJson(res, 405, { ok: false, data: { message: 'Method Not Allowed' } });
        }
        const job = await enqueueImageJob(body);
        return sendJson(res, 202, { ok: true, data: job });
      }
      case 'status': {
        if (req.method !== 'GET' && req.method !== 'POST') {
          res.setHeader('Allow', 'GET,POST,OPTIONS');
          return sendJson(res, 405, { ok: false, data: { message: 'Method Not Allowed' } });
        }
        const jobId = parseJobId({ searchParams: url.searchParams, body });
        if (!jobId) {
          return sendJson(res, 400, { ok: false, data: { message: 'jobId query parameter required' } });
        }
        const status = await getImageJobStatus(jobId);
        return sendJson(res, 200, { ok: true, data: { id: jobId, jobId, ...status } });
      }
      case 'worker': {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST,OPTIONS');
          return sendJson(res, 405, { ok: false, data: { message: 'Method Not Allowed' } });
        }
        const limit = pickBatchLimit({ searchParams: url.searchParams, body });
        const summary = await runImageGenerationWorker({ limit });
        return sendJson(res, 200, { ok: true, data: { ...summary, limit } });
      }
      default:
        return sendJson(res, 400, { ok: false, data: { message: 'Unknown action' } });
    }
  } catch (error) {
    console.error('Image API error:', error);
    const status = resolveErrorStatus(error);
    const payload = await buildErrorResponse(error, status);
    return sendJson(res, status, payload);
  }
}

function normalizeAction(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase();
}

function parseJobId({ searchParams, body }) {
  if (body && typeof body === 'object' && body !== null) {
    const fromBody = body.id ?? body.jobId ?? body.jobid;
    if (typeof fromBody === 'string' && fromBody.trim()) {
      return fromBody.trim();
    }
  }
  if (!searchParams) return null;
  const fromQuery =
    searchParams.get('id') ?? searchParams.get('jobId') ?? searchParams.get('jobid');
  if (typeof fromQuery === 'string' && fromQuery.trim()) {
    return fromQuery.trim();
  }
  return null;
}

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(payload));
}

function resolveErrorStatus(error, fallback = 500) {
  const status =
    typeof error?.status === 'number'
      ? error.status
      : typeof error?.statusCode === 'number'
        ? error.statusCode
        : null;
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    return status;
  }
  return fallback;
}

async function buildErrorResponse(error, status) {
  const message =
    typeof error?.message === 'string' && error.message
      ? error.message
      : status >= 500
        ? 'Internal Server Error'
        : 'Bad Request';
  const data = { message };

  if (error?.details) {
    data.details = error.details;
  } else if (status >= 500) {
    const details = await extractErrorDetails(error);
    if (details && details !== message) {
      data.details = details;
    }
  }

  return { ok: false, data };
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
