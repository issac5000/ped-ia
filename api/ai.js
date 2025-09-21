import { HttpError, getServiceConfig, supabaseRequest } from '../lib/anon-children.js';

// Fonction serverless unique : /api/ai (regroupe story, advice, comment, recipes)
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}');
    const typeFromQuery = req?.query?.type;
    const type = typeof body.type === 'string' && body.type ? body.type : (typeof typeFromQuery === 'string' ? typeFromQuery : '');

    switch (type) {
      case 'story': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
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
          method:'POST', headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ model:'gpt-4o-mini', temperature:0.7, messages:[
            {role:'system', content: system}, {role:'user', content: user}
          ]})
        });
        if (!r.ok){ const t=await r.text(); return res.status(502).json({ error:'OpenAI error', details:t }); }
        const j = await r.json();
        const text = j.choices?.[0]?.message?.content?.trim() || '';
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({ text }));
      }
      case 'advice': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

        const question = String(body.question || '').slice(0, 2000);
        const child = safeChildSummary(body.child);
        const history = Array.isArray(body.history) ? body.history.slice(-20) : [];

        const system = `Tu es Ped’IA, un assistant parental pour enfants 0–7 ans.
Réponds de manière bienveillante, concrète et structurée en puces.
Inclure: Sommeil, Alimentation, Repères de développement et Quand consulter.
Prends en compte les champs du profil (allergies, type d’alimentation, style d’appétit, infos de sommeil, jalons, mesures) si présents.`;
        const user = `Contexte enfant: ${JSON.stringify(child)}\nQuestion du parent: ${question}`;

        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.4,
            messages: [
              { role: 'system', content: system },
              ...history.filter(m=>m && (m.role==='user'||m.role==='assistant') && typeof m.content==='string').map(m=>({ role:m.role, content: m.content.slice(0,2000) })),
              { role: 'user', content: user }
            ]
          })
        });
        if (!r.ok) {
          const t = await r.text();
          return res.status(502).json({ error: 'OpenAI error', details: t });
        }
        const json = await r.json();
        const text = json.choices?.[0]?.message?.content?.trim() || '';

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({ text }));
      }
     case 'comment': {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  const content = String(body.content || '').slice(0, 2000);
  const system = `Tu es Ped’IA, un assistant bienveillant pour parents. 
  Ta mission est de rédiger un commentaire bref et clair (max 80 mots) sur la mise à jour donnée. 

  - Sois objectif et factuel.  
  - Si le changement est positif, félicite et encourage.  
  - Si le changement est négatif ou préoccupant, relève la difficulté avec empathie et propose un conseil pratique adapté, tout en terminant sur une note rassurante.  
  - Évite les tournures vagues ou trop générales.  
  - Le ton doit être chaleureux, encourageant et accessible à tous les parents.`;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${apiKey}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content }
      ]
    })
  });
        if (!r.ok) {
          const t = await r.text();
          return res.status(502).json({ error: 'OpenAI error', details: t });
        }
        const j = await r.json();
        const text = j.choices?.[0]?.message?.content?.trim() || '';
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({ text }));
      }
      case 'child-update': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
        const updateType = String(body.updateType || '').slice(0, 64);
        const updateForPrompt = sanitizeUpdatePayload(body.update);
        const parentComment = typeof body.parentComment === 'string' ? body.parentComment.trim().slice(0, 600) : '';
        const historySummaries = Array.isArray(body.historySummaries)
          ? body.historySummaries
              .map((entry) => (entry != null ? String(entry).trim().slice(0, 400) : ''))
              .filter(Boolean)
              .slice(0, 10)
          : [];
        const updateText = JSON.stringify({ type: updateType || 'update', data: updateForPrompt }).slice(0, 4000);
        const summaryMessages = [
          { role: 'system', content: "Tu es Ped’IA. Résume factuellement la mise à jour fournie en français en 50 mots maximum. Utilise uniquement les informations transmises (mise à jour + commentaire parent)." },
          { role: 'user', content: [
            updateType ? `Type de mise à jour: ${updateType}` : '',
            `Mise à jour (JSON): ${updateText || 'Aucune'}`,
            `Commentaire du parent: ${parentComment || 'Aucun'}`
          ].filter(Boolean).join('\n\n') }
        ];
        let summary = '';
        try {
          const summaryRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.2, messages: summaryMessages })
          });
          if (summaryRes.ok) {
            const summaryJson = await summaryRes.json();
            summary = summaryJson.choices?.[0]?.message?.content?.trim() || '';
          } else {
            const errText = await summaryRes.text();
            console.warn('[api/ai] child-update summary error', summaryRes.status, errText);
          }
        } catch (err) {
          console.warn('[api/ai] child-update summary exception', err);
        }

        const historyText = historySummaries.length
          ? historySummaries.map((entry, idx) => `${idx + 1}. ${entry}`).join('\n')
          : 'Aucun historique disponible';
        const commentMessages = [
          { role: 'system', content: "Tu es Ped’IA, assistant parental bienveillant. Rédige un commentaire personnalisé (80 mots max) basé uniquement sur la nouvelle mise à jour, le commentaire parent et les résumés factuels fournis. Ne réutilise jamais d’anciens commentaires IA." },
          { role: 'user', content: [
            updateType ? `Type de mise à jour: ${updateType}` : '',
            `Historique des résumés (du plus récent au plus ancien):\n${historyText}`,
            summary ? `Résumé factuel de la nouvelle mise à jour: ${summary}` : '',
            `Nouvelle mise à jour détaillée (JSON): ${updateText || 'Aucune donnée'}`,
            `Commentaire du parent: ${parentComment || 'Aucun'}`
          ].filter(Boolean).join('\n\n') }
        ];
        let comment = '';
        try {
          const commentRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.35, messages: commentMessages })
          });
          if (commentRes.ok) {
            const commentJson = await commentRes.json();
            comment = commentJson.choices?.[0]?.message?.content?.trim() || '';
          } else {
            const errText = await commentRes.text();
            console.warn('[api/ai] child-update comment error', commentRes.status, errText);
          }
        } catch (err) {
          console.warn('[api/ai] child-update comment exception', err);
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({ summary, comment }));
      }
      case 'child-full-report': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

        const childIdCandidates = [
          typeof body.childId === 'string' ? body.childId.trim() : '',
          typeof body.child_id === 'string' ? body.child_id.trim() : '',
          typeof req?.query?.childId === 'string' ? req.query.childId.trim() : '',
          typeof req?.query?.child_id === 'string' ? req.query.child_id.trim() : '',
        ];
        const childId = childIdCandidates.find(Boolean)?.slice(0, 128) || '';
        if (!childId) {
          return res.status(400).json({ error: 'childId required' });
        }

        let updateRows = [];
        try {
          const { supaUrl, serviceKey } = getServiceConfig();
          const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
          const data = await supabaseRequest(
            `${supaUrl}/rest/v1/child_updates?select=created_at,update_type,update_content,ai_summary&child_id=eq.${encodeURIComponent(childId)}&order=created_at.asc`,
            { headers }
          );
          updateRows = Array.isArray(data) ? data : [];
        } catch (err) {
          const status = err instanceof HttpError && err.status ? err.status : (typeof err?.status === 'number' ? err.status : 500);
          const detailString = (() => {
            if (err instanceof HttpError) {
              if (typeof err.details === 'string') return err.details;
              if (err.details) {
                try { return JSON.stringify(err.details); } catch { return String(err.details); }
              }
            }
            if (typeof err?.message === 'string') return err.message;
            return '';
          })();
          return res.status(status >= 400 && status < 600 ? status : 500).json({
            error: 'Unable to fetch child updates',
            details: detailString,
          });
        }

        const formatted = [];
        for (const row of updateRows) {
          const aiSummary = typeof row?.ai_summary === 'string' ? row.ai_summary.trim().slice(0, 600) : '';
          const updateObj = parseUpdateContentForPrompt(row?.update_content);
          const parentSummary = typeof updateObj?.summary === 'string' ? updateObj.summary.trim().slice(0, 600) : '';
          const userComment = typeof updateObj?.userComment === 'string' ? updateObj.userComment.trim().slice(0, 600) : '';
          const snapshotSource = updateObj && typeof updateObj === 'object'
            ? (updateObj.next && typeof updateObj.next === 'object' ? updateObj.next : updateObj)
            : {};
          const sanitizedSnapshot = sanitizeUpdatePayload(snapshotSource);
          const detailText = formatUpdateDataForPrompt(sanitizedSnapshot).slice(0, 1200);
          if (aiSummary || parentSummary || userComment || detailText) {
            formatted.push({
              type: typeof row?.update_type === 'string' ? row.update_type.trim().slice(0, 64) : '',
              date: typeof row?.created_at === 'string' ? row.created_at : '',
              aiSummary,
              parentSummary,
              userComment,
              detailText,
            });
          }
        }

        if (!formatted.length) {
          return res.status(404).json({ error: 'Pas assez de données pour générer un bilan complet.' });
        }

        const updatesText = formatted.map((item, idx) => {
          const lines = [];
          const headerParts = [`Mise à jour ${idx + 1}`];
          const dateText = formatDateForPrompt(item.date);
          if (dateText) headerParts.push(`date: ${dateText}`);
          if (item.type) headerParts.push(`type: ${item.type}`);
          lines.push(headerParts.join(' – '));
          if (item.aiSummary) lines.push(`Résumé IA: ${item.aiSummary}`);
          if (item.parentSummary && item.parentSummary !== item.aiSummary) {
            lines.push(`Résumé parent: ${item.parentSummary}`);
          }
          if (item.detailText) lines.push(`Données: ${item.detailText}`);
          if (item.userComment) lines.push(`Commentaire parent: ${item.userComment}`);
          return lines.join('\n');
        }).join('\n\n');

        const system = `Tu es Ped’IA, assistant parental. À partir des observations fournies, rédige un bilan complet en français (maximum 500 mots). Structure ta réponse avec exactement les sections suivantes : Croissance (taille, poids, dents), Sommeil, Alimentation, Jalons de développement, Remarques parentales, Recommandations pratiques. Utilise uniquement les données réelles transmises. Pour chaque section sans information fiable, écris « Pas de données disponibles ». Sois synthétique, factuel et accessible.`;
        const userPrompt = `Nombre de mises à jour: ${formatted.length}.\n\nDonnées réelles des mises à jour (ordre chronologique, de la plus ancienne à la plus récente):\n\n${updatesText}`;

        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.3,
            max_tokens: 900,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userPrompt }
            ]
          })
        });
        if (!r.ok) {
          const t = await r.text();
          return res.status(502).json({ error: 'OpenAI error', details: t });
        }
        const j = await r.json();
        const report = j.choices?.[0]?.message?.content?.trim() || '';
        if (!report) {
          return res.status(502).json({ error: 'Rapport indisponible' });
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({ report }));
      }
      case 'recipes': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
        const child = safeChildSummary(body.child);
        const prefs = String(body.prefs || '').slice(0, 400);

        const system = `Tu es Ped’IA, assistant nutrition 0–3 ans.
Donne des idées de menus et recettes adaptées à l’âge, en excluant les allergènes indiqués.
Prends en compte le type d’alimentation (allaitement/biberon/diversification), le style d’appétit, et les préférences fournies.
Structure la réponse avec: Idées de repas, Portions suggérées, Conseils pratiques, Liste de courses.`;
        const user = `Contexte enfant: ${JSON.stringify(child)}\nPréférences/contraintes: ${prefs}`;

        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method:'POST', headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ model:'gpt-4o-mini', temperature:0.4, messages:[
            {role:'system', content: system}, {role:'user', content: user}
          ]})
        });
        if (!r.ok){ const t=await r.text(); return res.status(502).json({ error:'OpenAI error', details:t }); }
        const j = await r.json();
        const text = j.choices?.[0]?.message?.content?.trim() || '';
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({ text }));
      }
      default:
        return res.status(400).json({ error: 'Type non reconnu' });
    }
  } catch (e){
    return res.status(500).json({ error: 'IA indisponible', details: String(e?.message || e) });
  }
}

// Limite les informations enfant transmises à l’IA pour raconter l’histoire et générer des conseils ou repas
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

function sanitizeUpdatePayload(value, depth = 0) {
  if (depth > 3) return '[...]';
  if (typeof value === 'string') return value.slice(0, 400);
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((entry) => sanitizeUpdatePayload(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') return value ?? {};
  const out = {};
  const entries = Object.entries(value).slice(0, 20);
  for (const [key, val] of entries) {
    out[key] = sanitizeUpdatePayload(val, depth + 1);
  }
  return out;
}

const PROMPT_SKIP_KEYS = new Set(['userComment', 'summary', 'ai_summary']);

function parseUpdateContentForPrompt(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') {
    try {
      return JSON.parse(JSON.stringify(raw));
    } catch {
      return { ...raw };
    }
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
    return { summary: trimmed };
  }
  return {};
}

function formatUpdateDataForPrompt(value, depth = 0) {
  if (depth > 3 || value == null) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.slice(0, 400);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 6)
      .map((entry) => formatUpdateDataForPrompt(entry, depth + 1))
      .filter(Boolean);
    return items.join(' | ');
  }
  if (typeof value === 'object') {
    const parts = [];
    const entries = Object.entries(value).slice(0, 15);
    for (const [key, val] of entries) {
      if (PROMPT_SKIP_KEYS.has(key)) continue;
      const text = formatUpdateDataForPrompt(val, depth + 1);
      if (text) parts.push(`${key}: ${text}`);
    }
    return parts.join(' ; ');
  }
  return '';
}

function formatDateForPrompt(value) {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().split('T')[0];
}

// Lit l’intégralité du corps de la requête tout en limitant la taille
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}
