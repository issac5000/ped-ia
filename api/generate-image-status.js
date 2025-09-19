import { fetchImageJobById } from './image-job-store.js';

function parseResult(raw) {
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
  const result = parseResult(job.result);
  return {
    status: job.status || 'pending',
    result,
    error_message: job.error_message ?? null,
  };
}

function parseJobId(req) {
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const jobId = url.searchParams.get('jobId') || url.searchParams.get('jobid');
    if (jobId && jobId.trim()) return jobId.trim();
    return null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const jobId = parseJobId(req);
    if (!jobId) {
      return res.status(400).json({ error: 'jobId query parameter required' });
    }
    const status = await getImageJobStatus(jobId);
    if (typeof status.result === 'object' && status.result !== null) {
      const normalized = {};
      if (typeof status.result.imageUrl === 'string') normalized.imageUrl = status.result.imageUrl;
      if (typeof status.result.model === 'string') normalized.model = status.result.model;
      status.result = normalized;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify({ jobId, ...status }));
  } catch (error) {
    console.error('Failed to load image job status:', error);
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const details = error?.details || error?.message || 'Status lookup failed';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).send(JSON.stringify({ error: 'Status lookup failed', details }));
  }
}
