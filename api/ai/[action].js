// Route serverless dynamique : /api/ai/[action]
// Regroupe les anciens endpoints /api/ai/advice, /api/ai/recipes, /api/ai/story et /api/ai/comment

import { buildOpenAIHeaders, buildOpenAIUrl, getOpenAIConfig } from '../openai-config.js';

const ACTION_HANDLERS = {
  advice: handleAdvice,
  recipes: handleRecipes,
  story: handleStory,
  comment: handleComment,
};

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

  const action = getActionName(req);
  const actionHandler = ACTION_HANDLERS[action];
  if (!actionHandler) {
    return res.status(404).json({ error: 'Not Found' });
  }

  const config = getOpenAIConfig();
  if (!config.apiKey) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  try {
    const raw = await readBody(req);
    const body = parseJson(raw);
    const payload = await actionHandler(body, config);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify(payload));
  } catch (error) {
    const status = error?.statusCode || error?.status || 500;
    const details = typeof error?.details === 'string' ? error.details : String(error?.message || error);
    const response = typeof error?.payload === 'object' && error.payload !== null
      ? error.payload
      : { error: status === 404 ? 'Not Found' : 'IA indisponible', details };
    if (response.error == null) response.error = 'IA indisponible';
    if (response.details == null && details) response.details = details;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).send(JSON.stringify(response));
  }
}

function getActionName(req) {
  const queryValue = req?.query?.action;
  if (Array.isArray(queryValue)) return queryValue[0];
  if (typeof queryValue === 'string') return queryValue;
  const match = req.url && req.url.match(/\/api\/ai\/([^/?]+)/);
  if (match && match[1]) return decodeURIComponent(match[1]);
  return undefined;
}

async function handleAdvice(body, config) {
  const question = String(body?.question || '').slice(0, 2000);
  const child = safeChildSummary(body?.child);
  const history = Array.isArray(body?.history) ? body.history.slice(-20) : [];

  const system = `Tu es Ped’IA, un assistant parental pour enfants 0–7 ans.
Réponds de manière bienveillante, concrète et structurée en puces.
Inclure: Sommeil, Alimentation, Repères de développement et Quand consulter.
Prends en compte les champs du profil (allergies, type d’alimentation, style d’appétit, infos de sommeil, jalons, mesures) si présents.`;
  const user = `Contexte enfant: ${JSON.stringify(child)}\nQuestion du parent: ${question}`;

  const response = await fetch(buildOpenAIUrl(config, '/v1/chat/completions'), {
    method: 'POST',
    headers: buildOpenAIHeaders(config),
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        ...history
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })),
        { role: 'user', content: user },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw createHttpError(502, 'OpenAI error', text);
  }

  const json = await response.json();
  const text = json.choices?.[0]?.message?.content?.trim() || '';
  return { text };
}

async function handleRecipes(body, config) {
  const child = safeChildSummary(body?.child);
  const prefs = String(body?.prefs || '').slice(0, 400);

  const system = `Tu es Ped’IA, assistant nutrition 0–7 ans.
Donne des idées de menus et recettes adaptées à l’âge, en excluant les allergènes indiqués.
Prends en compte le type d’alimentation (allaitement/biberon/diversification), le style d’appétit, et les préférences fournies.
Structure la réponse avec: Idées de repas, Portions suggérées, Conseils pratiques, Liste de courses.`;
  const user = `Contexte enfant: ${JSON.stringify(child)}\nPréférences/contraintes: ${prefs}`;

  const response = await fetch(buildOpenAIUrl(config, '/v1/chat/completions'), {
    method: 'POST',
    headers: buildOpenAIHeaders(config),
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw createHttpError(502, 'OpenAI error', text);
  }

  const json = await response.json();
  const text = json.choices?.[0]?.message?.content?.trim() || '';
  return { text };
}

async function handleStory(body, config) {
  const child = safeChildSummary(body?.child);
  const theme = String(body?.theme || '').slice(0, 200);
  const duration = Math.max(1, Math.min(10, Number(body?.duration || 3)));
  const sleepy = Boolean(body?.sleepy);

  const system = `Tu es Ped’IA, créateur d’histoires courtes pour 0–7 ans.
Rédige une histoire de ${duration} minute(s), adaptée à l’âge, avec le prénom.
Style ${sleepy ? 'très apaisant, vocabulaire doux, propice au coucher' : 'dynamique et bienveillant'}.
Texte clair, phrases courtes. Termine par une petite morale positive.`;
  const user = `Contexte enfant: ${JSON.stringify(child)}\nThème souhaité: ${theme || 'libre'}`;

  const response = await fetch(buildOpenAIUrl(config, '/v1/chat/completions'), {
    method: 'POST',
    headers: buildOpenAIHeaders(config),
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw createHttpError(502, 'OpenAI error', text);
  }

  const json = await response.json();
  const text = json.choices?.[0]?.message?.content?.trim() || '';
  return { text };
}

async function handleComment(body, config) {
  const content = String(body?.content || '').slice(0, 2000);
  const system = 'Tu es Ped’IA, un assistant bienveillant pour parents. Rédige un commentaire clair, positif et bref (moins de 50 mots) sur la mise à jour fournie.';

  const response = await fetch(buildOpenAIUrl(config, '/v1/chat/completions'), {
    method: 'POST',
    headers: buildOpenAIHeaders(config),
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw createHttpError(502, 'OpenAI error', text);
  }

  const json = await response.json();
  const text = json.choices?.[0]?.message?.content?.trim() || '';
  return { text };
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

function parseJson(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw createHttpError(400, 'Invalid JSON', String(error?.message || error));
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 1e6) {
        req.destroy();
        reject(createHttpError(413, 'Payload too large'));
      }
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function createHttpError(statusCode, error, details) {
  const err = new Error(details || error || 'Request error');
  err.statusCode = statusCode;
  err.payload = details == null ? { error } : { error, details };
  return err;
}
