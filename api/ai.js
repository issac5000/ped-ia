import { HttpError, getServiceConfig, supabaseRequest } from '../lib/anon-children.js';
import { buildGrowthPromptLines, summarizeGrowthStatus } from '../assets/ia.js';

async function resolveProfileIdFromCode(codeUnique, { supaUrl, headers }) {
  if (!codeUnique) return null;
  const lookup = await supabaseRequest(
    `${supaUrl}/rest/v1/profiles?select=id&code_unique=eq.${encodeURIComponent(codeUnique)}&limit=1`,
    { headers }
  );
  const row = Array.isArray(lookup) ? lookup[0] : lookup;
  if (!row || row.id == null) return null;
  const resolved = String(row.id).trim().slice(0, 128);
  return resolved || null;
}

const PARENT_CONTEXT_FIELD_LABELS = {
  full_name: 'Pseudo',
  parent_role: 'Rôle affiché',
  marital_status: 'Statut marital',
  number_of_children: 'Nombre d’enfants',
  parental_employment: 'Situation professionnelle',
  parental_emotion: 'État émotionnel',
  parental_stress: 'Niveau de stress',
  parental_fatigue: 'Niveau de fatigue',
};

const PARENT_CONTEXT_VALUE_LABELS = {
  marital_status: {
    marie: 'Marié·e / Pacsé·e',
    couple: 'En couple',
    celibataire: 'Célibataire',
    separe: 'Séparé·e / Divorcé·e',
    veuf: 'Veuf / Veuve',
    autre: 'Autre',
  },
  parental_employment: {
    conge_parental: 'Congé parental',
    temps_plein: 'Temps plein',
    temps_partiel: 'Temps partiel',
    horaires_decales: 'Horaires décalés / Nuit',
    sans_emploi: 'Sans emploi / Entre deux',
    maman_foyer: 'Maman au foyer',
    papa_foyer: 'Papa au foyer',
    autre: 'Autre',
  },
  parental_emotion: {
    positif: 'Positif / serein',
    neutre: 'Neutre',
    fragile: 'Fragile / sensible',
    anxieux: 'Anxieux / stressé',
  },
  parental_stress: {
    faible: 'Faible',
    modere: 'Modéré',
    eleve: 'Élevé',
  },
  parental_fatigue: {
    faible: 'Faible',
    modere: 'Modérée',
    eleve: 'Élevée',
  },
};

const AI_UNAVAILABLE_RESPONSE = { status: 'unavailable', message: 'Fonction IA désactivée' };

function respondAiUnavailable(res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  } catch (err) {
    console.warn('[ai] unable to set headers for unavailable response', err);
  }
  return res.status(200).send(JSON.stringify(AI_UNAVAILABLE_RESPONSE));
}

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
        if (!apiKey) return respondAiUnavailable(res);
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
        if (!apiKey) return respondAiUnavailable(res);

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
        if (!apiKey) return respondAiUnavailable(res);
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
      case 'parent-update': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return respondAiUnavailable(res);
        const updateType = typeof body.updateType === 'string'
          ? body.updateType.trim().slice(0, 64)
          : typeof body.update_type === 'string'
            ? String(body.update_type).trim().slice(0, 64)
            : '';
        const updatePayload = sanitizeUpdatePayload(body.updateContent ?? body.update_content ?? {});
        const parentComment = typeof body.parentComment === 'string'
          ? body.parentComment.trim().slice(0, 600)
          : '';
        const parentContext = sanitizeParentContextInput(body.parentContext);
        const parentContextLines = parentContextToPromptLines(parentContext);
        const updateFacts = formatParentUpdateFacts(updateType, updatePayload);
        const userParts = [
          updateType ? `Type de mise à jour: ${updateType}` : '',
          updateFacts ? `Données factuelles de la mise à jour: ${updateFacts}` : '',
          parentComment
            ? `Commentaire libre du parent: ${parentComment}`
            : 'Commentaire libre du parent: aucun commentaire transmis.'
        ];
        if (parentContextLines.length) {
          userParts.push(`Contexte parental actuel:\n${parentContextLines.map((line) => `- ${line}`).join('\n')}`);
        }
        const userContent = userParts.filter(Boolean).join('\n\n') || 'Aucune donnée fournie.';
        const system = `Tu es Ped’IA, coach parental bienveillant. Analyse les informations factuelles ci-dessous et rédige un commentaire personnalisé (80 mots max).
Ton ton est empathique, rassurant et constructif.
Ne copie pas mot pour mot le commentaire du parent : reformule et apporte un éclairage nouveau.`;
        const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.35,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userContent }
            ]
          })
        });
        if (!aiRes.ok) {
          const errText = await aiRes.text();
          return res.status(502).json({ error: 'OpenAI error', details: errText });
        }
        const aiJson = await aiRes.json();
        let comment = aiJson.choices?.[0]?.message?.content?.trim() || '';
        comment = enforceWordLimit(comment, 80);
        comment = comment.slice(0, 2000);
        if (!comment || areTextsTooSimilar(comment, parentComment)) {
          comment = fallbackParentAiComment(parentComment);
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({ comment }));
      }
      case 'child-update': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return respondAiUnavailable(res);
        const updateType = String(body.updateType || '').slice(0, 64);
        const updateForPrompt = sanitizeUpdatePayload(body.update);
        const parentComment = typeof body.parentComment === 'string' ? body.parentComment.trim().slice(0, 600) : '';
        const historySummaries = Array.isArray(body.historySummaries)
          ? body.historySummaries
              .map((entry) => (entry != null ? String(entry).trim().slice(0, 400) : ''))
              .filter(Boolean)
              .slice(0, 10)
          : [];
        const childIdCandidates = [
          typeof body.childId === 'string' ? body.childId.trim() : '',
          typeof body.child_id === 'string' ? body.child_id.trim() : '',
        ];
        const childId = childIdCandidates.find(Boolean)?.slice(0, 128) || '';
        const profileCandidates = [
          typeof body.profileId === 'string' ? body.profileId.trim() : '',
          typeof body.profile_id === 'string' ? body.profile_id.trim() : '',
        ];
        const profileId = profileCandidates.find(Boolean)?.slice(0, 128) || '';
        const codeCandidates = [
          typeof body.code_unique === 'string' ? body.code_unique : '',
          typeof body.code === 'string' ? body.code : '',
        ];
        const rawCode = codeCandidates.find(Boolean) || '';
        const codeUnique = rawCode ? String(rawCode).trim().toUpperCase().slice(0, 64) : '';
        const growthData = await fetchGrowthDataForPrompt({
          childId,
          profileId,
          codeUnique,
          measurementLimit: 3,
          teethLimit: 3,
        });
        const parentContext = sanitizeParentContextInput(body.parentContext);
        const parentContextLines = parentContextToPromptLines(parentContext);
        const parentContextBlock = parentContextLines.length
          ? `Contexte parental actuel:\n${parentContextLines.map((line) => `- ${line}`).join('\n')}`
          : 'Contexte parental actuel: non précisé.';
        const updateText = JSON.stringify({ type: updateType || 'update', data: updateForPrompt }).slice(0, 4000);
        const growthStatusEntries = Array.isArray(body.growthStatus)
          ? body.growthStatus.filter((entry) => entry && typeof entry === 'object')
          : [];
        const rawContextParts = Array.isArray(body.contextParts)
          ? body.contextParts.map((entry) => {
              if (entry == null) return '';
              const text = String(entry).trim();
              return text ? text.slice(0, 400) : '';
            })
          : [];
        const contextParts = rawContextParts.filter(Boolean).slice(0, 10);
        const latestGrowthData = growthStatusEntries[0] || null;
        const growthSummaryFromEntry = summarizeGrowthStatus(latestGrowthData);
        const growthSummaryFromBody = sanitizeGrowthSummary(
          body.growthStatusSummary ?? body.growth_status_summary ?? ''
        );
        const rawGrowthSummary = sanitizeGrowthSummary(growthSummaryFromEntry || growthSummaryFromBody || '');
        const statusTokens = new Set();
        const recordStatusesFromEntry = (entry) => {
          if (!entry || typeof entry !== 'object') return;
          const statusValues = [
            entry.status_global ?? entry.statusGlobal,
            entry.status_height ?? entry.statusHeight,
            entry.status_weight ?? entry.statusWeight,
          ];
          statusValues.forEach((value) => {
            const text = sanitizeGrowthSummary(value);
            if (text) statusTokens.add(text);
          });
        };
        recordStatusesFromEntry(latestGrowthData);
        growthStatusEntries.slice(1, 5).forEach(recordStatusesFromEntry);
        if (Array.isArray(growthData?.measurements)) {
          growthData.measurements.slice(0, 5).forEach(recordStatusesFromEntry);
        }
        const isStatusNormal = (status) => {
          if (!status) return false;
          const normalized = String(status)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z]/g, '');
          return normalized === 'normal' || normalized === 'normale';
        };
        const hasGrowthAnomalyFromStatus = Array.from(statusTokens).some(
          (status) => status && !isStatusNormal(status)
        );
        const hasGrowthAnomaly = hasGrowthAnomalyFromStatus || Boolean(rawGrowthSummary);
        const growthSummary = hasGrowthAnomaly ? rawGrowthSummary : '';
        const growthTermPatterns = [
          /(^|[^a-z0-9])croissance([^a-z0-9]|$)/i,
          /(^|[^a-z0-9])growth([^a-z0-9]|$)/i,
          /(^|[^a-z0-9])taille([^a-z0-9]|$)/i,
          /(^|[^a-z0-9])height([^a-z0-9]|$)/i,
          /(^|[^a-z0-9])poids([^a-z0-9]|$)/i,
          /(^|[^a-z0-9])weight([^a-z0-9]|$)/i,
          /(^|[^a-z0-9])dentition([^a-z0-9]|$)/i,
          /(^|[^a-z0-9])dents([^a-z0-9]|$)/i,
          /(^|[^a-z0-9])dent([^a-z0-9]|$)/i,
          /(^|[^a-z0-9])teeth([^a-z0-9]|$)/i,
          /(^|[^a-z0-9])tooth([^a-z0-9]|$)/i,
        ];
        const containsGrowthTerm = (value) => {
          if (!value) return false;
          const text = typeof value === 'string' ? value : String(value);
          return growthTermPatterns.some((pattern) => pattern.test(text));
        };
        const hasGrowthTermInData = (value, depth = 0) => {
          if (depth > 3 || value == null) return false;
          if (typeof value === 'string' || typeof value === 'number') {
            return containsGrowthTerm(value);
          }
          if (Array.isArray(value)) {
            return value.some((entry) => hasGrowthTermInData(entry, depth + 1));
          }
          if (typeof value === 'object') {
            return Object.entries(value).some(([key, val]) => {
              if (containsGrowthTerm(key)) return true;
              return hasGrowthTermInData(val, depth + 1);
            });
          }
          return false;
        };
        const isGrowthRelatedUpdate =
          growthStatusEntries.length > 0 ||
          containsGrowthTerm(updateType) ||
          containsGrowthTerm(parentComment) ||
          containsGrowthTerm(updateText) ||
          hasGrowthTermInData(updateForPrompt);
        const includeGrowth = hasGrowthAnomaly || isGrowthRelatedUpdate;
        const filteredContextParts = hasGrowthAnomaly && growthSummary
          ? contextParts.filter((entry) => !isSameGrowthSummary(entry, growthSummary))
          : contextParts;
        const growthPromptLines = includeGrowth
          ? buildGrowthPromptLines({ parentComment, latestGrowthData }).filter(
              (line) => !/^\s*Analyse\s+OMS/i.test(line || '')
            )
          : [];
        const growthSection = includeGrowth ? formatGrowthSectionForPrompt(growthData) : '';
        const summarySections = [
          updateType ? `Type de mise à jour: ${updateType}` : '',
          `Mise à jour (JSON): ${updateText || 'Aucune'}`,
          hasGrowthAnomaly && growthSummary ? `Synthèse croissance (OMS): ${growthSummary}` : '',
          ...growthPromptLines,
          ...filteredContextParts,
          includeGrowth && growthSection ? `Section Croissance:\n${growthSection}` : ''
        ].filter(Boolean);
        const summaryMessages = [
          { role: 'system', content: "Tu es Ped’IA. Résume factuellement la mise à jour fournie en français en 50 mots maximum. Utilise uniquement les informations transmises (mise à jour + commentaire parent + données de croissance)." },
          { role: 'user', content: summarySections.join('\n\n') }
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
        const commentSections = [
          updateType ? `Type de mise à jour: ${updateType}` : '',
          `Historique des résumés (du plus récent au plus ancien):\n${historyText}`,
          summary ? `Résumé factuel de la nouvelle mise à jour: ${summary}` : '',
          `Nouvelle mise à jour détaillée (JSON): ${updateText || 'Aucune donnée'}`,
          hasGrowthAnomaly && growthSummary ? `Synthèse croissance (OMS): ${growthSummary}` : '',
          ...growthPromptLines,
          ...filteredContextParts,
          includeGrowth && growthSection ? `Croissance récente:\n${growthSection}` : '',
          parentContextBlock
        ].filter(Boolean);
        const commentMessages = [
          { role: 'system', content: "Tu es Ped’IA, assistant parental bienveillant. Rédige un commentaire personnalisé (80 mots max) basé uniquement sur la nouvelle mise à jour, le commentaire parent, les données de croissance fournies et les résumés factuels. Prends en compte le contexte parental (stress, fatigue, émotions) pour adapter ton empathie et tes conseils. Ne réutilise jamais d’anciens commentaires IA." },
          { role: 'user', content: commentSections.join('\n\n') }
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
      case 'family-bilan': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return respondAiUnavailable(res);
        const profileIdCandidates = [
          typeof body.profileId === 'string' ? body.profileId.trim() : '',
          typeof body.profile_id === 'string' ? body.profile_id.trim() : '',
          typeof req?.query?.profileId === 'string' ? req.query.profileId.trim() : '',
          typeof req?.query?.profile_id === 'string' ? req.query.profile_id.trim() : '',
        ];
        let profileId = profileIdCandidates.find(Boolean)?.slice(0, 128) || '';
        const receivedId = profileId;
        const codeCandidates = [
          typeof body.code_unique === 'string' ? body.code_unique : '',
          typeof body.code === 'string' ? body.code : '',
          typeof req?.query?.code_unique === 'string' ? req.query.code_unique : '',
          typeof req?.query?.code === 'string' ? req.query.code : '',
        ];
        const rawCode = codeCandidates.find(Boolean) || '';
        const codeUnique = rawCode ? String(rawCode).trim().toUpperCase().slice(0, 64) : '';
        console.log('[family-bilan] incoming identifiers', {
          profileIdFromBody: body?.profileId ?? body?.profile_id ?? null,
          profileIdFromQuery: req?.query?.profileId ?? req?.query?.profile_id ?? null,
          resolvedProfileId: profileId || null,
          codeUnique: codeUnique || null,
        });
        const { supaUrl, serviceKey } = getServiceConfig();
        const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
        if (!profileId && codeUnique) {
          try {
            const resolvedId = await resolveProfileIdFromCode(codeUnique, { supaUrl, headers });
            if (!resolvedId) {
              console.warn('[family-bilan] code_unique resolved to no profile', { codeUnique });
              return res.status(400).json({ error: 'Profile not found', debug: { receivedId: receivedId || null, codeUnique } });
            }
            profileId = resolvedId;
          } catch (err) {
            const status = err instanceof HttpError && err.status ? err.status : 500;
            const details = err?.details || err?.message || '';
            console.error('[family-bilan] code_unique resolution error', { codeUnique, status, details });
            if (status >= 500) {
              return res.status(status).json({ error: 'Impossible de valider le code_unique', details });
            }
            return res.status(400).json({ error: 'Profile not found', debug: { receivedId: receivedId || null, codeUnique } });
          }
        }
        if (!profileId) {
          console.warn('[family-bilan] missing profile identifier after resolution', { receivedId: receivedId || null, codeUnique: codeUnique || null });
          return res.status(400).json({ error: 'Profile not found', debug: { receivedId: receivedId || null, codeUnique: codeUnique || null } });
        }
        let profileRow = null;
        let childrenRows = [];
        let childUpdates = [];
        let parentUpdates = [];
        try {
          const [profileData, childrenData] = await Promise.all([
            supabaseRequest(
              `${supaUrl}/rest/v1/profiles?select=full_name,parent_role,marital_status,number_of_children,parental_employment,parental_emotion,parental_stress,parental_fatigue,context_parental&id=eq.${encodeURIComponent(profileId)}&limit=1`,
              { headers }
            ),
            supabaseRequest(
              `${supaUrl}/rest/v1/children?select=id,first_name,sex,dob&user_id=eq.${encodeURIComponent(profileId)}&order=dob.asc`,
              { headers }
            ),
          ]);
          profileRow = Array.isArray(profileData) ? profileData[0] : profileData;
          childrenRows = Array.isArray(childrenData) ? childrenData : [];
        } catch (err) {
          const status = err instanceof HttpError ? err.status : 500;
          return res.status(status).json({ error: 'Unable to fetch family data', details: err?.details || err?.message || '' });
        }
        if (profileRow) {
          console.log('[family-bilan] profile resolved', { profileId, childrenCount: childrenRows.length });
        } else {
          console.warn('[family-bilan] profile not found in Supabase', { profileId });
          return res.status(404).json({ error: 'No profile data', profileId });
        }
        const childIds = childrenRows.map((child) => child?.id).filter(Boolean).map(String);
        if (childIds.length) {
          const inParam = childIds.map((id) => `${encodeURIComponent(id)}`).join(',');
          try {
            const updates = await supabaseRequest(
              `${supaUrl}/rest/v1/child_updates?select=child_id,ai_summary,update_type,update_content,created_at&child_id=in.(${inParam})&order=created_at.desc&limit=40`,
              { headers }
            );
            childUpdates = Array.isArray(updates) ? updates : [];
          } catch (err) {
            console.warn('[family-bilan] unable to fetch child_updates', err);
          }
        }
        try {
          const parentRows = await supabaseRequest(
            `${supaUrl}/rest/v1/parent_updates?select=update_type,update_content,parent_comment,ai_commentaire,created_at&profile_id=eq.${encodeURIComponent(profileId)}&order=created_at.desc&limit=20`,
            { headers }
          );
          parentUpdates = Array.isArray(parentRows) ? parentRows : [];
        } catch (err) {
          console.warn('[family-bilan] unable to fetch parent_updates', err);
        }
        const parentContext = sanitizeParentContextInput(profileRow);
        const parentContextLines = parentContextToPromptLines(parentContext);
        const childContextText = formatChildrenForPrompt(childrenRows);
        const growthByChild = new Map();
        if (childIds.length) {
          await Promise.all(
            childIds.map(async (id) => {
              try {
                const growth = await fetchGrowthDataForPrompt({
                  childId: id,
                  profileId,
                  measurementLimit: 3,
                  teethLimit: 2,
                  supaUrl,
                  headers,
                });
                if (growth) {
                  growthByChild.set(String(id), growth);
                }
              } catch (err) {
                const status = err instanceof HttpError ? err.status : null;
                console.warn('[family-bilan] unable to fetch growth data', {
                  childId: id,
                  status,
                  message: err?.message || err,
                });
                growthByChild.set(String(id), {
                  measurements: [],
                  teeth: [],
                  status: 'error',
                });
              }
            })
          );
        }
        const growthContextText = buildFamilyGrowthSection(childrenRows, growthByChild);
        const childUpdatesText = formatChildUpdatesForFamilyPrompt(childUpdates, childrenRows);
        const parentUpdatesText = formatParentUpdatesForPrompt(parentUpdates);
        console.log('[family-bilan] preparing OpenAI payload', {
          profileId,
          childrenCount: childrenRows.length,
          childUpdatesCount: childUpdates.length,
          parentUpdatesCount: parentUpdates.length,
        });
        const userPromptSections = [
          `Enfants suivis:\n${childContextText}`,
          growthContextText
            ? `Croissance récente (taille/poids/dents):\n${growthContextText}`
            : 'Croissance récente: aucune mesure enregistrée.',
          parentContextLines.length
            ? `Contexte parental actuel:\n${parentContextLines.map((line) => `- ${line}`).join('\n')}`
            : 'Contexte parental actuel: non précisé.',
          childUpdatesText.length
            ? `Évolutions enfant (du plus récent au plus ancien):\n${childUpdatesText.join('\n')}`
            : 'Évolutions enfant: aucune donnée exploitable.',
          parentUpdatesText.length
            ? `Historique parental récent:\n${parentUpdatesText.join('\n')}`
            : 'Historique parental: aucun changement récent consigné.',
        ];
        const system = `Tu es Ped’IA, coach familial bienveillant. À partir des observations enfants et du contexte parental, rédige un bilan structuré en français (400 mots max).
Structure attendue :
1. État général de la famille (quelques phrases)
2. Points marquants pour chaque enfant (liste à puces)
3. Contexte parental (stress, fatigue, émotions)
4. Recommandations pratiques (3 actions concrètes adaptées)
Ton ton est chaleureux, réaliste et encourageant. Mets en lien les difficultés parentales et les observations enfants, et propose des pistes concrètes.`;
        let openAiResponse;
        try {
          openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              temperature: 0.35,
              max_tokens: 700,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: userPromptSections.join('\n\n') }
              ]
            })
          });
        } catch (err) {
          console.error('[family-bilan] OpenAI request failed', err);
          return res.status(502).json({ error: 'OpenAI timeout', details: err?.message || 'Unknown error' });
        }
        if (!openAiResponse.ok) {
          const errText = await openAiResponse.text();
          return res.status(502).json({ error: 'OpenAI error', details: errText });
        }
        const openAiJson = await openAiResponse.json();
        const bilan = openAiJson.choices?.[0]?.message?.content?.trim() || '';
        if (!bilan) {
          return res.status(502).json({ error: 'Bilan indisponible' });
        }
        const nowIso = new Date().toISOString();
        const payload = [{
          profile_id: profileId,
          children_ids: childIds,
          ai_bilan: bilan.slice(0, 4000),
          last_generated_at: nowIso,
        }];
        try {
          await supabaseRequest(
            `${supaUrl}/rest/v1/family_context?on_conflict=profile_id`,
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
              body: JSON.stringify(payload),
            }
          );
        } catch (err) {
          console.warn('[family-bilan] unable to upsert family_context', err);
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({ bilan, lastGeneratedAt: nowIso }));
      }
      case 'child-full-report': {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return respondAiUnavailable(res);

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

        const profileIdCandidates = [
          typeof body.profileId === 'string' ? body.profileId.trim() : '',
          typeof body.profile_id === 'string' ? body.profile_id.trim() : '',
          typeof req?.query?.profileId === 'string' ? req.query.profileId.trim() : '',
          typeof req?.query?.profile_id === 'string' ? req.query.profile_id.trim() : '',
        ];
        const profileId = profileIdCandidates.find(Boolean)?.slice(0, 128) || '';
        const codeCandidates = [
          typeof body.code_unique === 'string' ? body.code_unique : '',
          typeof body.code === 'string' ? body.code : '',
          typeof req?.query?.code_unique === 'string' ? req.query.code_unique : '',
          typeof req?.query?.code === 'string' ? req.query.code : '',
        ];
        const rawCode = codeCandidates.find(Boolean) || '';
        const codeUnique = rawCode ? String(rawCode).trim().toUpperCase().slice(0, 64) : '';

        let supaConfig = null;
        let supabaseHeaders = null;
        const REPORT_UPDATE_LIMIT = 10;
        let updateRows = [];
        try {
          supaConfig = getServiceConfig();
          const { supaUrl, serviceKey } = supaConfig;
          supabaseHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
          const data = await supabaseRequest(
            `${supaUrl}/rest/v1/child_updates?select=created_at,update_type,update_content,ai_summary,ai_commentaire&child_id=eq.${encodeURIComponent(childId)}&order=created_at.desc&limit=${REPORT_UPDATE_LIMIT}`,
            { headers: supabaseHeaders }
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

        const growthData = await fetchGrowthDataForPrompt({
          childId,
          profileId,
          codeUnique,
          measurementLimit: 3,
          teethLimit: 3,
          supaUrl: supaConfig?.supaUrl,
          headers: supabaseHeaders,
        });
        const growthSection = formatGrowthSectionForPrompt(growthData);

        const limitedUpdates = updateRows
          .filter((row) => row && typeof row === 'object')
          .slice(0, REPORT_UPDATE_LIMIT);

        const formatted = [];
        for (const row of limitedUpdates) {
          const aiSummary = truncateForPrompt(row?.ai_summary, 350);
          const aiCommentaire = truncateForPrompt(row?.ai_commentaire, 350);
          const parsedContent = parseUpdateContentForPrompt(row?.update_content);
          const parentSummary = truncateForPrompt(parsedContent?.summary, 350);
          const parentComment = truncateForPrompt(parsedContent?.userComment, 320);

          let fallbackDetails = '';
          if (!aiSummary && !parentSummary) {
            const snapshotSource = parsedContent && typeof parsedContent === 'object'
              ? (parsedContent.next && typeof parsedContent.next === 'object' ? parsedContent.next : parsedContent)
              : {};
            const sanitizedSnapshot = sanitizeUpdatePayload(snapshotSource);
            fallbackDetails = truncateForPrompt(formatUpdateDataForPrompt(sanitizedSnapshot), 320);
          }

          if (aiSummary || aiCommentaire || parentSummary || parentComment || fallbackDetails) {
            formatted.push({
              type: typeof row?.update_type === 'string' ? row.update_type.trim().slice(0, 64) : '',
              date: typeof row?.created_at === 'string' ? row.created_at : '',
              aiSummary,
              aiCommentaire,
              parentSummary,
              parentComment,
              fallbackDetails,
            });
          }
        }

        if (!formatted.length) {
          return res.status(200).json({ report: 'Aucun résumé disponible.' });
        }

        const updatesText = formatted.map((item, idx) => {
          const lines = [];
          const headerParts = [`Mise à jour ${idx + 1}`];
          const dateText = formatDateForPrompt(item.date);
          if (dateText) headerParts.push(`date: ${dateText}`);
          if (item.type) headerParts.push(`type: ${item.type}`);
          lines.push(headerParts.join(' – '));
          if (item.aiSummary) lines.push(`Résumé IA: ${item.aiSummary}`);
          if (item.aiCommentaire) lines.push(`Commentaire IA: ${item.aiCommentaire}`);
          if (item.parentSummary && item.parentSummary !== item.aiSummary) {
            lines.push(`Résumé parent: ${item.parentSummary}`);
          }
          if (item.parentComment) lines.push(`Commentaire parent: ${item.parentComment}`);
          if (item.fallbackDetails) lines.push(`Données clés: ${item.fallbackDetails}`);
          return lines.join('\n');
        }).join('\n\n');

        const system = `Tu es Ped’IA, assistant parental. À partir des observations fournies, rédige un bilan complet en français (maximum 500 mots). Structure ta réponse avec exactement les sections suivantes : Croissance (taille, poids, dents), Sommeil, Alimentation, Jalons de développement, Remarques parentales, Recommandations pratiques. Utilise uniquement les données réelles transmises. Pour chaque section sans information fiable, écris « À compléter ». Valorise les données de croissance fournies pour analyser taille, poids et dents par rapport à l’âge de l’enfant. Sois synthétique, factuel et accessible.`;
        const userPrompt = [
          `Nombre de mises à jour utilisées: ${formatted.length} (de la plus récente à la plus ancienne).`,
          `Section Croissance:\n${growthSection}`,
          `Données réelles des mises à jour (ordre décroissant):\n\n${updatesText}`,
        ].join('\n\n');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        let r;
        try {
          r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            signal: controller.signal,
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
        } catch (err) {
          clearTimeout(timeout);
          if (err?.name === 'AbortError') {
            console.warn('[child-full-report] OpenAI request aborted (timeout)');
            return res.status(504).json({ error: 'Timeout AI' });
          }
          console.error('[child-full-report] OpenAI request failed', err);
          return res.status(502).json({ error: 'Erreur IA', details: err?.message || 'Unknown error' });
        }
        clearTimeout(timeout);
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
        if (!apiKey) return respondAiUnavailable(res);
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
    console.error('[api/ai] handler error', e);
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

function sanitizeParentContextInput(raw) {
  const ctx = {
    full_name: '',
    parent_role: '',
    marital_status: '',
    number_of_children: null,
    parental_employment: '',
    parental_emotion: '',
    parental_stress: '',
    parental_fatigue: '',
  };
  if (!raw || typeof raw !== 'object') return ctx;
  const str = (value) => {
    if (value == null) return '';
    const text = String(value).trim();
    return text.slice(0, 120);
  };
  const num = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(20, n));
  };
  ctx.full_name = str(raw.pseudo || raw.full_name || '');
  ctx.parent_role = str(raw.role || raw.parent_role || '');
  ctx.marital_status = str(raw.maritalStatus || raw.marital_status || '');
  const numberCandidate = raw.numberOfChildren ?? raw.number_of_children;
  ctx.number_of_children = numberCandidate != null ? num(numberCandidate) : null;
  ctx.parental_employment = str(raw.parentalEmployment || raw.parental_employment || '');
  ctx.parental_emotion = str(raw.parentalEmotion || raw.parental_emotion || '');
  ctx.parental_stress = str(raw.parentalStress || raw.parental_stress || '');
  ctx.parental_fatigue = str(raw.parentalFatigue || raw.parental_fatigue || '');
  if (raw.context_parental && typeof raw.context_parental === 'object') {
    const nested = sanitizeParentContextInput(raw.context_parental);
    Object.keys(ctx).forEach((key) => {
      if (!ctx[key]) ctx[key] = nested[key];
    });
  }
  return ctx;
}

function formatParentContextValue(field, value) {
  if (field === 'number_of_children') {
    if (!Number.isFinite(value)) return '';
    const n = Number(value);
    return `${n} enfant${n > 1 ? 's' : ''}`;
  }
  const labels = PARENT_CONTEXT_VALUE_LABELS[field];
  if (labels && value != null) {
    const key = String(value).trim().toLowerCase();
    if (labels[key]) return labels[key];
  }
  if (value == null) return '';
  const text = String(value).trim();
  return text;
}

function parentContextToPromptLines(ctx = {}) {
  const lines = [];
  if (ctx.full_name) lines.push(`Pseudo: ${ctx.full_name}`);
  if (ctx.parent_role) lines.push(`Rôle affiché: ${ctx.parent_role}`);
  if (ctx.marital_status) lines.push(`Statut marital: ${formatParentContextValue('marital_status', ctx.marital_status)}`);
  if (Number.isFinite(ctx.number_of_children)) lines.push(`Nombre d’enfants: ${formatParentContextValue('number_of_children', ctx.number_of_children)}`);
  if (ctx.parental_employment) lines.push(`Situation professionnelle: ${formatParentContextValue('parental_employment', ctx.parental_employment)}`);
  if (ctx.parental_emotion) lines.push(`État émotionnel: ${formatParentContextValue('parental_emotion', ctx.parental_emotion)}`);
  if (ctx.parental_stress) lines.push(`Niveau de stress: ${formatParentContextValue('parental_stress', ctx.parental_stress)}`);
  if (ctx.parental_fatigue) lines.push(`Niveau de fatigue: ${formatParentContextValue('parental_fatigue', ctx.parental_fatigue)}`);
  return lines;
}

function buildFamilyGrowthSection(children = [], growthMap) {
  if (!Array.isArray(children) || !children.length) return '';
  if (!growthMap || typeof growthMap.get !== 'function') return '';
  const blocks = [];
  for (const child of children) {
    if (!child) continue;
    const id = child.id != null ? String(child.id) : '';
    if (!id) continue;
    const formatted = formatGrowthSectionForPrompt(growthMap.get(id));
    if (!formatted) continue;
    const name = child.first_name ? String(child.first_name).trim() : '';
    const header = name || 'Enfant';
    const indented = formatted
      .split('\n')
      .map((line) => (line ? `  ${line}` : line))
      .join('\n');
    blocks.push(`${header}:\n${indented}`);
  }
  return blocks.join('\n\n');
}

function formatChildrenForPrompt(children = []) {
  if (!Array.isArray(children) || !children.length) return 'Aucun enfant enregistré.';
  return children.map((child, index) => {
    const parts = [`${index + 1}. ${child?.first_name || 'Enfant'}`];
    if (child?.sex) parts.push(`sexe: ${child.sex}`);
    if (child?.dob) parts.push(`naissance: ${formatDateForPrompt(child.dob) || child.dob}`);
    return parts.join(' – ');
  }).join('\n');
}

function formatChildUpdatesForFamilyPrompt(updates = [], children = []) {
  if (!Array.isArray(updates)) return [];
  const map = new Map();
  if (Array.isArray(children)) {
    children.forEach((child) => {
      if (!child) return;
      map.set(String(child.id), child);
    });
  }
  return updates
    .filter(Boolean)
    .slice(0, 20)
    .map((row, index) => {
      const child = map.get(String(row.child_id));
      const name = child?.first_name || 'Enfant';
      const date = formatDateForPrompt(row.created_at);
      const type = row?.update_type ? String(row.update_type).trim() : '';
      let summary = typeof row?.ai_summary === 'string' ? row.ai_summary.trim().slice(0, 400) : '';
      if (!summary) {
        const parsed = parseUpdateContentForPrompt(row?.update_content);
        summary = typeof parsed?.summary === 'string' ? parsed.summary.trim().slice(0, 400) : '';
      }
      const headerParts = [`${index + 1}. ${name}`];
      if (date) headerParts.push(`date: ${date}`);
      if (type) headerParts.push(`type: ${type}`);
      const header = headerParts.join(' – ');
      return summary ? `${header}: ${summary}` : header;
    });
}

function formatParentUpdatesForPrompt(updates = []) {
  if (!Array.isArray(updates)) return [];
  return updates
    .filter(Boolean)
    .slice(0, 20)
    .map((row, index) => {
      const type = typeof row?.update_type === 'string' ? row.update_type.trim() : '';
      const label = type === 'parent_context'
        ? 'Contexte parental'
        : (PARENT_CONTEXT_FIELD_LABELS[type] || (type ? type.replace(/_/g, ' ') : 'Champ'));
      const date = formatDateForPrompt(row?.created_at);
      const summaryParts = [];
      if (type === 'parent_context') {
        const facts = formatParentUpdateFacts(type, row?.update_content ?? '');
        if (facts) summaryParts.push(facts);
      } else {
        let previous = '';
        let next = '';
        if (typeof row?.update_content === 'string') {
          try {
            const parsed = JSON.parse(row.update_content);
            if (parsed && typeof parsed === 'object') {
              previous = formatParentContextValue(type, parsed.previous ?? parsed.avant ?? parsed.old ?? '');
              next = formatParentContextValue(type, parsed.next ?? parsed.apres ?? parsed.new ?? '');
            }
          } catch {}
        } else if (row?.update_content && typeof row.update_content === 'object') {
          previous = formatParentContextValue(type, row.update_content.previous);
          next = formatParentContextValue(type, row.update_content.next);
        }
        const text = `${previous || 'non renseigné'} → ${next || 'non renseigné'}`;
        if (text) summaryParts.push(text);
      }
      const parentComment = typeof row?.parent_comment === 'string' ? row.parent_comment.trim() : '';
      if (parentComment) {
        summaryParts.push(`Commentaire parent: ${parentComment.slice(0, 160)}`);
      }
      const comment = typeof row?.ai_commentaire === 'string' ? row.ai_commentaire.trim() : '';
      if (comment) {
        summaryParts.push(`Retour IA: ${comment.slice(0, 160)}`);
      }
      const summary = summaryParts.join(' ; ').slice(0, 400);
      const prefix = `${index + 1}. ${label}`;
      const body = summary || 'mise à jour enregistrée';
      return date ? `${prefix} (${date}) : ${body}` : `${prefix}: ${body}`;
    });
}

async function fetchGrowthDataForPrompt({
  childId,
  profileId = '',
  codeUnique = '',
  measurementLimit = 3,
  teethLimit = 3,
  supaUrl,
  headers,
} = {}) {
  if (!childId) {
    return { measurements: [], teeth: [] };
  }
  let effectiveUrl = typeof supaUrl === 'string' && supaUrl ? supaUrl : '';
  let effectiveHeaders = headers && typeof headers === 'object' ? headers : null;
  if (!effectiveUrl || !effectiveHeaders) {
    const config = getServiceConfig();
    effectiveUrl = config.supaUrl;
    effectiveHeaders = { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` };
  }
  let resolvedProfileId = typeof profileId === 'string' ? profileId.trim().slice(0, 128) : '';
  const normalizedCode = codeUnique ? String(codeUnique).trim().toUpperCase().slice(0, 64) : '';
  if (!resolvedProfileId && normalizedCode) {
    try {
      const resolved = await resolveProfileIdFromCode(normalizedCode, { supaUrl: effectiveUrl, headers: effectiveHeaders });
      if (resolved) resolvedProfileId = resolved;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : null;
      const detail = err?.details || err?.message || '';
      console.warn('[api/ai] growth profile resolution failed', { codeUnique: normalizedCode || null, status, detail });
    }
  }
  if (resolvedProfileId) {
    try {
      const check = await supabaseRequest(
        `${effectiveUrl}/rest/v1/children?select=id&user_id=eq.${encodeURIComponent(resolvedProfileId)}&id=eq.${encodeURIComponent(childId)}&limit=1`,
        { headers: effectiveHeaders }
      );
      const row = Array.isArray(check) ? check[0] : check;
      if (!row) {
        console.warn('[api/ai] growth data skipped: child not linked to profile', { childId, resolvedProfileId });
        return { measurements: [], teeth: [] };
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : null;
      const details = err?.details || err?.message || err;
      console.warn('[api/ai] growth child/profile validation failed', { childId, resolvedProfileId, status, details });
      if (status && status >= 400 && status < 500) {
        return { measurements: [], teeth: [] };
      }
    }
  }
  try {
    const tables = await fetchGrowthTables(effectiveUrl, effectiveHeaders, childId, { measurementLimit, teethLimit });
    const measurements = Array.isArray(tables?.measurements) ? tables.measurements.filter(Boolean) : [];
    const teeth = Array.isArray(tables?.teeth) ? tables.teeth.filter(Boolean) : [];
    const hasData = measurements.length > 0 || teeth.length > 0;
    return {
      measurements,
      teeth,
      status: hasData ? 'ok' : 'empty',
    };
  } catch (err) {
    const status = err instanceof HttpError ? err.status : (typeof err?.status === 'number' ? err.status : null);
    const details = extractSupabaseErrorDetails(err);
    console.error('[api/ai] growth data fetch failed', {
      childId,
      profileId: resolvedProfileId || null,
      codeUnique: normalizedCode || null,
      status,
      details,
    });
    return {
      measurements: [],
      teeth: [],
      status: 'error',
      error: 'technical_failure',
      errorMessage: details || 'Growth data unavailable due to technical error.',
    };
  }
}

async function fetchGrowthTables(supaUrl, headers, childId, { measurementLimit = 3, teethLimit = 3 } = {}) {
  if (!supaUrl || !headers || !childId) {
    return { measurements: [], teeth: [] };
  }
  const limitedMeasurements = Math.max(1, Math.min(6, Number.isFinite(Number(measurementLimit)) ? Number(measurementLimit) : 3));
  const limitedTeeth = Math.max(1, Math.min(6, Number.isFinite(Number(teethLimit)) ? Number(teethLimit) : 3));
  const measurementBaseUrl = `${supaUrl}/rest/v1/child_growth_with_status?select=child_id,height_cm,weight_kg,status_height,status_weight,status_global,agemos,recorded_at,created_at&child_id=eq.${encodeURIComponent(childId)}&limit=${limitedMeasurements}`;
  const {
    rows: measurementRows,
    query: measurementQuery,
  } = await fetchSupabaseRowsWithFallback(measurementBaseUrl, headers, [
    '&order=agemos.desc.nullslast&order=recorded_at.desc.nullslast&order=created_at.desc',
    '&order=recorded_at.desc.nullslast&order=created_at.desc',
    '&order=created_at.desc',
    '',
  ], {
    logLabel: '[api/ai] growth measurements fetch error',
    errorMessage: 'Unable to fetch growth measurements',
    context: { childId },
  });
  const filteredMeasurementRows = Array.isArray(measurementRows) ? measurementRows.filter(Boolean) : [];
  if (!filteredMeasurementRows.length) {
    console.error('[api/ai] growth measurements empty', {
      childId,
      query: measurementQuery,
    });
  }
  const teethBaseUrl = `${supaUrl}/rest/v1/growth_teeth?select=month,count,recorded_at,created_at&child_id=eq.${encodeURIComponent(childId)}&limit=${limitedTeeth}`;
  const {
    rows: teethRows,
  } = await fetchSupabaseRowsWithFallback(teethBaseUrl, headers, [
    '&order=month.desc.nullslast&order=recorded_at.desc.nullslast&order=created_at.desc',
    '&order=recorded_at.desc.nullslast&order=created_at.desc',
    '&order=created_at.desc',
    '',
  ], {
    logLabel: '[api/ai] growth teeth fetch error',
    errorMessage: 'Unable to fetch teeth measurements',
    context: { childId },
  });
  const measurements = sortGrowthMeasurements(filteredMeasurementRows)
    .slice(0, limitedMeasurements);
  const teeth = sortGrowthTeeth(Array.isArray(teethRows) ? teethRows.filter(Boolean) : [])
    .slice(0, limitedTeeth);
  return { measurements, teeth };
}

function extractSupabaseErrorDetails(err) {
  if (!err) return '';
  if (err instanceof HttpError) {
    if (typeof err.details === 'string') return err.details;
    if (err.details != null) {
      try {
        return JSON.stringify(err.details);
      } catch {
        return String(err.details);
      }
    }
    if (typeof err.message === 'string') return err.message;
  }
  if (typeof err?.message === 'string') return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function wrapSupabaseError(err, message) {
  if (err instanceof HttpError) {
    return new HttpError(err.status, message || err.message, err.details ?? err.message);
  }
  const status = typeof err?.status === 'number' ? err.status : 500;
  const details = err?.details ?? err?.message ?? err;
  return new HttpError(status, message || 'Supabase request failed', details);
}

async function fetchSupabaseRowsWithFallback(baseUrl, headers, orderSuffixes, { logLabel, errorMessage, context } = {}) {
  const attempts = Array.isArray(orderSuffixes) && orderSuffixes.length ? orderSuffixes : [''];
  let lastError = null;
  let lastQuery = '';
  for (let index = 0; index < attempts.length; index += 1) {
    const suffix = attempts[index] || '';
    const query = `${baseUrl}${suffix}`;
    try {
      const data = await supabaseRequest(query, { headers });
      return { rows: Array.isArray(data) ? data : [], query };
    } catch (err) {
      lastError = err;
      lastQuery = query;
      if (logLabel) {
        const status = err instanceof HttpError ? err.status : (typeof err?.status === 'number' ? err.status : null);
        const details = extractSupabaseErrorDetails(err);
        console.error(logLabel, { ...(context || {}), order: suffix || 'default', status, details });
      }
      if (index === attempts.length - 1) {
        throw wrapSupabaseError(err, errorMessage);
      }
    }
  }
  if (lastError) {
    throw wrapSupabaseError(lastError, errorMessage);
  }
  return { rows: [], query: lastQuery || baseUrl };
}

function sortGrowthMeasurements(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows
    .slice()
    .sort((a, b) => compareGrowthEntries(b, a));
}

function sortGrowthTeeth(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows
    .slice()
    .sort((a, b) => compareGrowthEntries(b, a));
}

function compareGrowthEntries(first, second) {
  const firstMonth = extractGrowthMonth(first);
  const secondMonth = extractGrowthMonth(second);
  if (Number.isFinite(firstMonth) || Number.isFinite(secondMonth)) {
    const normalizedFirst = Number.isFinite(firstMonth) ? firstMonth : -Infinity;
    const normalizedSecond = Number.isFinite(secondMonth) ? secondMonth : -Infinity;
    return normalizedFirst - normalizedSecond;
  }
  const firstTimestamp = extractGrowthTimestamp(first);
  const secondTimestamp = extractGrowthTimestamp(second);
  const normalizedFirst = Number.isFinite(firstTimestamp) ? firstTimestamp : -Infinity;
  const normalizedSecond = Number.isFinite(secondTimestamp) ? secondTimestamp : -Infinity;
  return normalizedFirst - normalizedSecond;
}

function extractGrowthMonth(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const keys = ['agemos', 'age_month', 'ageMonth', 'month', 'months', 'age_in_months'];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
    const value = Number(entry[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function extractGrowthTimestamp(entry) {
  if (!entry || typeof entry !== 'object') return -Infinity;
  const recorded = typeof entry.recorded_at === 'string' ? Date.parse(entry.recorded_at) : NaN;
  const created = typeof entry.created_at === 'string' ? Date.parse(entry.created_at) : NaN;
  if (Number.isFinite(recorded)) return recorded;
  if (Number.isFinite(created)) return created;
  return -Infinity;
}

function formatGrowthSectionForPrompt(growthData) {
  if (!growthData || typeof growthData !== 'object') {
    return 'Croissance non disponible (erreur technique).';
  }
  if (growthData.status === 'error') {
    return 'Croissance non disponible (erreur technique).';
  }
  const measurementLines = formatGrowthMeasurementsForPrompt(growthData?.measurements);
  const lines = [];
  if (measurementLines.length) {
    lines.push('Mesures taille/poids récentes:');
    measurementLines.forEach((line) => {
      lines.push(`- ${line}`);
    });
  }
  const teethLine = formatGrowthTeethForPrompt(growthData?.teeth);
  if (teethLine) {
    lines.push(`Dents: ${teethLine}`);
  }
  if (!lines.length) {
    return 'Pas de mesure enregistrée';
  }
  return lines.join('\n').slice(0, 600);
}

function formatGrowthMeasurementsForPrompt(measurements = []) {
  if (!Array.isArray(measurements) || !measurements.length) return [];
  return measurements
    .map((entry) => formatGrowthMeasurementEntry(entry))
    .filter(Boolean);
}

function formatGrowthMeasurementEntry(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const parts = [];
  const heightText = formatGrowthNumber(entry.height_cm, { unit: 'cm', decimals: 1 });
  if (heightText) {
    let heightLabel = `taille ${heightText}`;
    const heightStatus = sanitizeGrowthSummary(entry.status_height);
    if (heightStatus) {
      heightLabel += ` (statut: ${heightStatus})`;
    }
    parts.push(heightLabel);
  }
  const weightText = formatGrowthNumber(entry.weight_kg, { unit: 'kg', decimals: 2 });
  if (weightText) {
    let weightLabel = `poids ${weightText}`;
    const weightStatus = sanitizeGrowthSummary(entry.status_weight);
    if (weightStatus) {
      weightLabel += ` (statut: ${weightStatus})`;
    }
    parts.push(weightLabel);
  }
  if (!parts.length) return '';
  const globalStatus = sanitizeGrowthSummary(entry.status_global);
  if (globalStatus) {
    const label = `statut global: ${globalStatus}`;
    if (!parts.includes(label)) {
      parts.push(label);
    }
  }
  const uniqueParts = [];
  for (const part of parts) {
    if (!uniqueParts.includes(part)) {
      uniqueParts.push(part);
    }
  }
  let period = formatGrowthAgeForPrompt(entry);
  if (!period) {
    const recordedAt = typeof entry.recorded_at === 'string' ? entry.recorded_at : '';
    const createdAt = typeof entry.created_at === 'string' ? entry.created_at : '';
    period = formatDateForPrompt(recordedAt) || formatDateForPrompt(createdAt) || '';
  }
  return period ? `${period}: ${uniqueParts.join(' ; ')}` : uniqueParts.join(' ; ');
}

function formatGrowthTeethForPrompt(teethEntries = []) {
  if (!Array.isArray(teethEntries) || !teethEntries.length) return '';
  const latest = teethEntries[0];
  if (!latest || typeof latest !== 'object') return '';
  const rawCount = latest.count ?? latest.teeth ?? latest.value;
  const number = Number(rawCount);
  if (!Number.isFinite(number) || number < 0) return '';
  const count = Math.max(0, Math.round(number));
  const label = `${count} dent${count > 1 ? 's' : ''}`;
  const period = formatGrowthPeriod(latest);
  return period ? `${label} (${period})` : label;
}

function sanitizeGrowthSummary(value) {
  if (!value) return '';
  const text = typeof value === 'string' ? value : String(value);
  return text.trim().slice(0, 400);
}

function isSameGrowthSummary(a, b) {
  if (!a || !b) return false;
  const normalize = (text) =>
    String(text)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  return normalize(a) === normalize(b);
}

function formatGrowthPeriod(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const ageText = formatGrowthAgeForPrompt(entry);
  if (ageText) return ageText;
  const recorded = typeof entry.recorded_at === 'string' ? entry.recorded_at : '';
  const created = typeof entry.created_at === 'string' ? entry.created_at : '';
  return formatDateForPrompt(recorded) || formatDateForPrompt(created) || '';
}

function formatGrowthAgeForPrompt(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const keys = ['agemos', 'age_month', 'ageMonth', 'month', 'months', 'age_in_months'];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
    const value = entry[key];
    if (value === undefined || value === null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      const normalized = numeric % 1 === 0 ? numeric : Number(numeric.toFixed(1));
      return `mois ${normalized}`;
    }
    const text = sanitizeGrowthSummary(value);
    if (text) {
      return `mois ${text}`;
    }
  }
  return '';
}

function formatGrowthNumber(value, { unit = '', decimals = 1 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '';
  const factor = 10 ** Math.max(0, Math.min(6, Math.floor(decimals)));
  const rounded = Math.round(num * factor) / factor;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded.toFixed(decimals)).replace(/\.0+$/, '');
  return unit ? `${text} ${unit}` : text;
}

function truncateForPrompt(value, maxLength = 350) {
  if (typeof value !== 'string') {
    if (value == null) return '';
    try {
      const text = String(value);
      return truncateForPrompt(text, maxLength);
    } catch {
      return '';
    }
  }
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatParentUpdateFacts(updateType, rawContent) {
  let parsed = parseUpdateContentForPrompt(rawContent);
  if (!parsed || typeof parsed !== 'object') parsed = {};
  const lines = [];
  if (updateType === 'parent_context') {
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
      lines.push(parsed.summary.trim());
    }
    const context = (parsed.snapshot && typeof parsed.snapshot === 'object'
      ? parsed.snapshot.context
      : null) || (parsed.context && typeof parsed.context === 'object' ? parsed.context : {});
    const contextKeys = ['parental_emotion', 'parental_stress', 'parental_fatigue', 'parental_employment', 'marital_status', 'number_of_children'];
    contextKeys.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(context, key)) return;
      const formatted = formatParentContextValue(key, context[key]);
      if (formatted) {
        const keyLabel = PARENT_CONTEXT_FIELD_LABELS[key] || key.replace(/_/g, ' ');
        lines.push(`${keyLabel}: ${formatted}`);
      }
    });
    if (Array.isArray(parsed.changes)) {
      parsed.changes.slice(0, 6).forEach((change) => {
        if (!change || !change.field) return;
        const field = String(change.field);
        const before = formatParentContextValue(field, change.previous);
        const after = formatParentContextValue(field, change.next);
        const changeLabel = PARENT_CONTEXT_FIELD_LABELS[field] || field.replace(/_/g, ' ');
        lines.push(`${changeLabel}: ${before || 'non renseigné'} → ${after || 'non renseigné'}`);
      });
    }
  } else {
    const before = formatParentContextValue(updateType, parsed.previous ?? parsed.before ?? parsed.old ?? '');
    const after = formatParentContextValue(updateType, parsed.next ?? parsed.after ?? parsed.new ?? '');
    if (before || after) {
      lines.push(`${before || 'non renseigné'} → ${after || 'non renseigné'}`);
    }
  }
  if (!lines.length) {
    const fallback = formatUpdateDataForPrompt(parsed);
    if (fallback) lines.push(fallback);
  }
  return lines.join(' ; ').slice(0, 600);
}

function enforceWordLimit(text, maxWords = 80) {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(' ')}…`;
}

function normalizeForComparison(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function areTextsTooSimilar(a, b) {
  if (!a || !b) return false;
  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normB.length >= 20 && normA.includes(normB)) return true;
  return false;
}

function fallbackParentAiComment() {
  return 'Merci pour votre partage. Prenez le temps de souffler, reconnaissez vos besoins et n’hésitez pas à solliciter un proche ou un professionnel si vous en ressentez le besoin. Vous faites de votre mieux pour votre famille.';
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
