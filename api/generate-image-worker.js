import { fetchPendingImageJobs, parseJobPayload, updateImageJob } from './image-job-store.js';
import { generateImage, extractErrorDetails, resolveErrorModel, IMAGE_MODEL } from './generate-image.js';

const DEFAULT_BATCH_LIMIT = 3;
const MAX_ERROR_MESSAGE_LENGTH = 2000;

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

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
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
    const url = new URL(req.url || '', 'http://localhost');
    const raw = await readBody(req);
    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    const limit = pickBatchLimit({ searchParams: url.searchParams, body });
    const summary = await runImageGenerationWorker({ limit });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify({ ...summary, limit }));
  } catch (error) {
    console.error('Image worker execution failed:', error);
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const message = error?.details || error?.message || 'Worker failure';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).send(JSON.stringify({ error: 'Image worker failed', details: message }));
  }
}
