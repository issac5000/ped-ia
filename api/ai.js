import { HttpError, getServiceConfig, supabaseRequest } from '../lib/anon-children.js';
import { buildGrowthPromptLines, summarizeGrowthStatus } from '../assets/ia.js';

async function resolveProfileIdFromCode(codeUnique, { supaUrl: supaUrlArg, headers }) {
  if (!codeUnique) return null;
  const lookup = await supabaseRequest(
    `${supaUrlArg}/rest/v1/profiles?select=id&code_unique=eq.${encodeURIComponent(codeUnique)}&limit=1`,
    { headers }
  );
  const row = Array.isArray(lookup) ? lookup[0] : lookup;
  if (!row || row.id == null) return null;
  const resolved = String(row.id).trim().slice(0, 128);
  return resolved || null;
}

function getAnonSupabaseConfig() {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (!supaUrl) {
    console.error('[ai] Missing Supabase URL for anon config (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL)');
    throw new HttpError(500, 'Missing SUPABASE_URL');
  }
  if (!anonKey) {
    console.error('[ai] Missing Supabase anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY)');
    throw new HttpError(500, 'Missing SUPABASE_ANON_KEY');
  }
  return { supaUrl, anonKey };
}

async function fetchFamilyBilanForPrompt({ profileId, codeUnique }) {
  let normalizedProfileId = profileId == null ? '' : String(profileId).trim();
  const normalizedCode = codeUnique == null ? '' : String(codeUnique).trim().toUpperCase();
  if (!normalizedProfileId && !normalizedCode) return null;

  if (!normalizedProfileId && normalizedCode) {
    const { supaUrl, serviceKey } = getServiceConfig();
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    normalizedProfileId =
      (await resolveProfileIdFromCode(normalizedCode, { supaUrl, headers })) || '';
  }

  const { supaUrl, anonKey } = getAnonSupabaseConfig();
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
  const effectiveProfileId = normalizedProfileId;
  if (!effectiveProfileId) return null;

  const url = `${supaUrl}/rest/v1/family_context?select=ai_bilan&profile_id=eq.${encodeURIComponent(
    effectiveProfileId
  )}&order=last_generated_at.desc&limit=1`;

  console.log("[AI DEBUG] profile_id:", effectiveProfileId);
  console.log("[AI DEBUG] URL:", url);

  const data = await supabaseRequest(url, { headers });
  console.log("[AI DEBUG] family_context response:", data);

  const row = Array.isArray(data) ? data[0] : data;
  return row?.ai_bilan ?? null;
}

async function fetchChildrenContextForPrompt({ profileId, codeUnique }) {
  const normalizedProfileId = typeof profileId === 'string' ? profileId.trim() : '';
  const normalizedCode = typeof codeUnique === 'string' ? codeUnique.trim().toUpperCase() : '';
  if (!normalizedProfileId && !normalizedCode) {
    return { childSummary: '', childUpdatesSummary: '', childNames: [], effectiveProfileId: '' };
  }

  let supaUrl = '';
  let headers = null;
  let effectiveProfileId = normalizedProfileId;
  let usingService = false;

  try {
    if (normalizedProfileId) {
      const { supaUrl: anonUrl, anonKey } = getAnonSupabaseConfig();
      supaUrl = anonUrl;
      headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
    } else {
      const { supaUrl: serviceUrl, serviceKey } = getServiceConfig();
      supaUrl = serviceUrl;
      headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
      usingService = true;
      const resolved = await resolveProfileIdFromCode(normalizedCode, { supaUrl: serviceUrl, headers });
      if (!resolved) return { childSummary: '', childUpdatesSummary: '', childNames: [], effectiveProfileId: '' };
      effectiveProfileId = resolved;
    }

    if (!effectiveProfileId) return { childSummary: '', childUpdatesSummary: '', childNames: [], effectiveProfileId: '' };

    const childrenUrl = `${supaUrl}/rest/v1/children?select=id,first_name,sex,dob,ai_preview,user_id&user_id=eq.${encodeURIComponent(
      effectiveProfileId
    )}&order=dob.asc`;
    const childrenRows = await supabaseRequest(childrenUrl, { headers }).catch((err) => {
      console.warn('[ai] fetchChildrenContextForPrompt children failed', {
        profileId: effectiveProfileId,
        usingService,
        details: err?.message || err,
      });
      return [];
    });
    const children = Array.isArray(childrenRows) ? childrenRows.filter(Boolean) : [];
    const childSummary = children.length ? formatChildrenForPrompt(children).slice(0, 800) : '';
    const childNames = children
      .map((child) => (child?.first_name ? String(child.first_name).trim() : ''))
      .filter(Boolean)
      .slice(0, 10);

    const childIds = children.map((child) => child?.id).filter(Boolean).map(String);
    if (!childIds.length) {
      return { childSummary, childUpdatesSummary: '', childNames, effectiveProfileId };
    }

    const inParam = childIds.map((id) => encodeURIComponent(id)).join(',');
    const updatesUrl = `${supaUrl}/rest/v1/child_updates?select=child_id,ai_summary,update_type,update_content,created_at&child_id=in.(${inParam})&order=created_at.desc&limit=${Math.min(
      15,
      childIds.length * 3
    )}`;
    const updatesRows = await supabaseRequest(updatesUrl, { headers }).catch((err) => {
      console.warn('[ai] fetchChildrenContextForPrompt updates failed', {
        profileId: effectiveProfileId,
        usingService,
        details: err?.message || err,
      });
      return [];
    });
    const updatesList = formatChildUpdatesForFamilyPrompt(updatesRows, children).slice(0, 6);
    const childUpdatesSummary = updatesList.length ? updatesList.join('\n').slice(0, 900) : '';

    return { childSummary, childUpdatesSummary, childNames, effectiveProfileId };
  } catch (err) {
    console.warn('[ai] fetchChildrenContextForPrompt unexpected error', err);
    return { childSummary: '', childUpdatesSummary: '', childNames: [], effectiveProfileId: normalizedProfileId };
  }
}

const DEFAULT_PARENT_CHILD_CONTEXT = Object.freeze({
  parent: {
    name: 'non renseigné',
    role: 'non renseigné',
    stress: 'non renseigné',
    fatigue: 'non renseigné',
    emploi: 'non renseigné',
  },
  children: [],
});

function normalizeFieldValue(value, maxLength = 160) {
  if (value == null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return String(value);
  }
  const str = typeof value === 'string' ? value.trim() : String(value).trim();
  if (!str) return '';
  return str.slice(0, maxLength);
}

function normalizeNightWakings(value) {
  if (value == null) return 'non renseigné';
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 3) return '3+';
    if (value <= 0) return '0';
    return String(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 'non renseigné';
    const numeric = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(numeric)) {
      if (numeric >= 3) return '3+';
      if (numeric <= 0) return '0';
      return String(numeric);
    }
    return trimmed.slice(0, 60);
  }
  const normalized = normalizeFieldValue(value, 60);
  return normalized || 'non renseigné';
}

function normalizeGrowthStatus(entry) {
  if (!entry || typeof entry !== 'object') return 'non renseigné';
  const candidates = [
    entry.status_global,
    entry.statusGlobal,
    entry.status_height,
    entry.statusHeight,
    entry.status_weight,
    entry.statusWeight,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeFieldValue(candidate, 80);
    if (normalized) return normalized;
  }
  return 'non renseigné';
}

const CRITICAL_GROWTH_KEYWORDS = ['trop bas', 'trop eleve', 'a surveiller', 'retard', 'hors norme'];

function normalizeWithoutDiacritics(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function containsCriticalGrowthKeywords(text) {
  if (!text) return false;
  const normalized = normalizeWithoutDiacritics(String(text));
  return CRITICAL_GROWTH_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function extractChildrenFromAiBilanText(text) {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const results = [];
  const childHeaderRegex = /^-\s*\*\*(.+?)\*\*/;
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (typeof rawLine !== 'string') continue;
    const line = rawLine.trim();
    if (!line) continue;
    const headerMatch = childHeaderRegex.exec(line);
    if (!headerMatch) continue;
    const name = headerMatch[1]?.trim().slice(0, 80) || 'Enfant';
    let growth = line.replace(childHeaderRegex, '').trim();
    growth = growth.replace(/^[:\-–—]\s*/, '').trim();
    if (!growth) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidateRaw = lines[j];
        if (typeof candidateRaw !== 'string') continue;
        const candidate = candidateRaw.trim();
        if (!candidate) continue;
        if (childHeaderRegex.test(candidate)) {
          break;
        }
        growth = candidate.replace(/^[:\-–—]\s*/, '').trim();
        if (growth) {
          break;
        }
      }
    }
    if (!growth) continue;
    const limitedGrowth = growth.slice(0, 240);
    results.push({ name, growth: limitedGrowth });
  }
  return results;
}

function extractChildrenFromStructuredAiBilan(aiBilan) {
  const results = [];

  const addChild = (child, indexOffset = 0) => {
    if (!child || typeof child !== 'object') return;
    const nameCandidates = [
      child.prenom,
      child.first_name,
      child.firstName,
      child.name,
    ];
    let name = '';
    for (const candidate of nameCandidates) {
      const normalized = normalizeFieldValue(candidate, 80);
      if (normalized) {
        name = normalized;
        break;
      }
    }
    if (!name) {
      name = `Enfant ${results.length + indexOffset + 1}`;
    }

    const growthCandidates = [];
    const growthData = child.growth;
    if (growthData && typeof growthData === 'object') {
      const growthStrings = [
        growthData.status_global,
        growthData.statusGlobal,
        growthData.status_height,
        growthData.statusHeight,
        growthData.status_weight,
        growthData.statusWeight,
        growthData.status_imc,
        growthData.statusImc,
        growthData.summary,
        growthData.resume,
        growthData.text,
        growthData.comment,
      ];
      growthStrings.forEach((value) => {
        if (typeof value === 'string' && value.trim()) {
          growthCandidates.push(value.trim());
        }
      });
    } else if (typeof growthData === 'string' && growthData.trim()) {
      growthCandidates.push(growthData.trim());
    }

    const childTextCandidates = [
      child.summary,
      child.resume,
      child.resume_global,
      child.text,
      child.ai_preview,
      child.ai_summary,
      child.comment,
    ];
    childTextCandidates.forEach((value) => {
      if (typeof value === 'string' && value.trim()) {
        growthCandidates.push(value.trim());
      }
    });

    const lastUpdate = child.last_update || child.lastUpdate;
    if (lastUpdate && typeof lastUpdate === 'object') {
      const lastUpdateCandidates = [
        lastUpdate.ai_summary,
        lastUpdate.summary,
        lastUpdate.content,
        lastUpdate.text,
      ];
      lastUpdateCandidates.forEach((value) => {
        if (typeof value === 'string' && value.trim()) {
          growthCandidates.push(value.trim());
        }
      });
    }

    const uniqueGrowth = [];
    const seenGrowth = new Set();
    growthCandidates.forEach((candidate) => {
      const normalized = candidate.slice(0, 240);
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (seenGrowth.has(key)) return;
      seenGrowth.add(key);
      uniqueGrowth.push(normalized);
    });

    if (!uniqueGrowth.length) return;

    const growth = uniqueGrowth.slice(0, 2).join(' ').slice(0, 240);
    if (!growth) return;

    results.push({ name, growth });
  };

  const addFromList = (entries) => {
    if (!Array.isArray(entries)) return;
    entries.forEach((entry, index) => addChild(entry, index));
  };

  const tryStructured = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      addFromList(value);
      return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value.children)) {
      addFromList(value.children);
    }
    if (Array.isArray(value.enfants)) {
      addFromList(value.enfants);
    }
  };

  tryStructured(aiBilan);

  if (!results.length && typeof aiBilan === 'string') {
    try {
      const parsed = JSON.parse(aiBilan);
      tryStructured(parsed);
    } catch (_err) {
      // Ignore JSON parse error, fallback handled below
    }
  }

  if (!results.length && typeof aiBilan === 'string') {
    return extractChildrenFromAiBilanText(aiBilan);
  }

  return results;
}

function parseChildrenFromAiBilan(aiBilanText) {
  const skipSections = [
    'Bilan familial',
    'Points marquants pour chaque enfant',
    'Contexte parental',
    'Recommandations pratiques',
  ];
  if (typeof aiBilanText !== 'string') return [];
  const trimmedText = aiBilanText.trim();
  if (!trimmedText) return [];

  const lines = trimmedText.split(/\r?\n/);
  const headerRegex = /^\s*(?:[-•]\s*)?\*{1,2}([^*]+?)\*{1,2}\s*:?(.*)$/;
  const childrenSections = [];
  let currentSection = null;

  for (const rawLine of lines) {
    if (typeof rawLine !== 'string') continue;
    const line = rawLine.trim();
    if (!line) continue;

    const headerMatch = headerRegex.exec(line);
    if (headerMatch) {
      if (currentSection) {
        childrenSections.push(currentSection);
      }
      const rawName = headerMatch[1] ?? '';
      const cleanedName = rawName.replace(/^[\s*:-]+/, '').replace(/[\s*:-]+$/, '').trim();
      const name = cleanedName.slice(0, 80);
      const rest = headerMatch[2]?.trim() || '';
      if (name && !skipSections.includes(name)) {
        currentSection = { name, lines: [] };
        if (rest) {
          currentSection.lines.push(rest);
        }
      } else {
        currentSection = null;
      }
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    }
  }

  if (currentSection) {
    childrenSections.push(currentSection);
  }

  const ensureInfo = (value) => (value ? value.slice(0, 240) : 'non renseigné');
  const findInfoLine = (linesArray, keywords) => {
    for (const text of linesArray) {
      const lower = text.toLowerCase();
      if (keywords.some((keyword) => lower.includes(keyword))) {
        return text;
      }
    }
    return '';
  };

  return childrenSections
    .filter((section) => section.name && !skipSections.includes(section.name))
    .map((section, index) => {
      const infoLines = Array.isArray(section.lines) ? section.lines : [];
      const growthLine = findInfoLine(infoLines, ['poids', 'taille', 'croissance']);
      const feedingLine = findInfoLine(infoLines, ['appétit', 'appetit', 'alimentation', 'allaitement']);
      const sleepLine = findInfoLine(infoLines, ['sommeil', 'réveil', 'reveil', 'nuit']);

      const name = section.name || `Enfant ${index + 1}`;

      return {
        name,
        growth: ensureInfo(growthLine),
        feeding: ensureInfo(feedingLine),
        sleep: ensureInfo(sleepLine),
      };
    });
}

function buildDefaultParentChildContext() {
  return {
    parent: { ...DEFAULT_PARENT_CHILD_CONTEXT.parent },
    children: [],
  };
}

async function buildContext(profileId, { codeUnique } = {}) {
  const normalized = typeof profileId === 'string' ? profileId.trim() : '';
  if (!normalized) {
    return buildDefaultParentChildContext();
  }

  try {
    let supaUrl = '';
    let headers = null;
    try {
      const { supaUrl: anonUrl, anonKey } = getAnonSupabaseConfig();
      if (anonUrl && anonKey) {
        supaUrl = anonUrl;
        headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
      }
    } catch (err) {
      // ignore, will try service config below
    }
    if (!headers) {
      const { supaUrl: serviceUrl, serviceKey } = getServiceConfig();
      if (!serviceUrl || !serviceKey) {
        return buildDefaultParentChildContext();
      }
      supaUrl = serviceUrl;
      headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    }
    if (!supaUrl || !headers) {
      return buildDefaultParentChildContext();
    }

    const profileUrl = `${supaUrl}/rest/v1/profiles?select=full_name,parent_role,parental_stress,parental_fatigue,parental_employment&id=eq.${encodeURIComponent(
      normalized
    )}&limit=1`;
    const childrenUrl = `${supaUrl}/rest/v1/children?select=id,first_name,eating_style,sleep_night_wakings&user_id=eq.${encodeURIComponent(
      normalized
    )}&order=dob.asc`;

    const childrenPromise = supabaseRequest(childrenUrl, { headers }).catch((err) => {
      console.warn('[ai] buildContext children fallback triggered', {
        profileId: normalized,
        details: err?.message || err,
      });
      return [];
    });

    const [profileRowRaw, childrenRowsRaw] = await Promise.all([
      supabaseRequest(profileUrl, { headers }).catch(() => null),
      childrenPromise,
    ]);

    const profileRow = Array.isArray(profileRowRaw) ? profileRowRaw[0] : profileRowRaw;
    const childrenRows = Array.isArray(childrenRowsRaw) ? childrenRowsRaw.filter(Boolean) : [];

    const context = buildDefaultParentChildContext();
    context.parent = {
      name: normalizeFieldValue(profileRow?.full_name, 120) || 'non renseigné',
      role: normalizeFieldValue(profileRow?.parent_role, 80) || 'non renseigné',
      stress: normalizeFieldValue(profileRow?.parental_stress, 80) || 'non renseigné',
      fatigue: normalizeFieldValue(profileRow?.parental_fatigue, 80) || 'non renseigné',
      emploi: normalizeFieldValue(profileRow?.parental_employment, 80) || 'non renseigné',
    };

    if (!childrenRows.length) {
      let childrenFallback = [];
      try {
        const aiBilan = await fetchFamilyBilanForPrompt({ profileId: normalized, codeUnique });
        const textCandidates = [];
        if (typeof aiBilan === 'string' && aiBilan.trim()) {
          const trimmed = aiBilan.trim();
          textCandidates.push(trimmed);
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object') {
              if (typeof parsed.text === 'string' && parsed.text.trim()) {
                textCandidates.push(parsed.text);
              }
              if (typeof parsed.ai_preview === 'string' && parsed.ai_preview.trim()) {
                textCandidates.push(parsed.ai_preview);
              }
            }
          } catch (_err) {
            // ignore JSON parse errors, raw text will be used
          }
        }
        if (aiBilan && typeof aiBilan === 'object') {
          if (typeof aiBilan.text === 'string' && aiBilan.text.trim()) {
            textCandidates.push(aiBilan.text);
          }
          if (typeof aiBilan.ai_preview === 'string' && aiBilan.ai_preview.trim()) {
            textCandidates.push(aiBilan.ai_preview);
          }
        }
        const seenTexts = new Set();
        for (const candidate of textCandidates) {
          const candidateText = typeof candidate === 'string' ? candidate.trim() : '';
          if (!candidateText || seenTexts.has(candidateText)) {
            continue;
          }
          seenTexts.add(candidateText);
          const parsed = extractChildrenFromAiBilanText(candidateText);
          if (parsed.length) {
            childrenFallback = parsed;
            break;
          }
        }
      } catch (err) {
        console.warn('[ai] buildContext unable to build fallback children', {
          profileId: normalized,
          details: err?.message || err,
        });
      }

      context.children = Array.isArray(childrenFallback) ? childrenFallback : [];
      console.log('[AI DEBUG] fallback children from ai_bilan:', context.children);

      return context;
    }

    const childIds = childrenRows
      .map((child) => (child?.id == null ? null : String(child.id).trim()))
      .filter(Boolean);

    let growthMap = new Map();
    if (childIds.length) {
      const limit = Math.min(60, Math.max(childIds.length * 2, 10));
      const growthUrl = `${supaUrl}/rest/v1/child_growth_with_status?select=child_id,status_global,status_height,status_weight&child_id=in.(${childIds
        .map((id) => encodeURIComponent(id))
        .join(',')})&order=child_id.asc&order=agemos.desc.nullslast&limit=${limit}`;
      const growthRowsRaw = await supabaseRequest(growthUrl, { headers }).catch(() => []);
      const growthRows = Array.isArray(growthRowsRaw) ? growthRowsRaw : [];
      growthMap = new Map();
      for (const row of growthRows) {
        if (!row || row.child_id == null) continue;
        const childId = String(row.child_id).trim();
        if (!childId || growthMap.has(childId)) continue;
        growthMap.set(childId, row);
      }
    }

    context.children = childrenRows.map((child) => {
      const childId = child?.id == null ? '' : String(child.id).trim();
      const growthEntry = childId ? growthMap.get(childId) : null;
      return {
        name: normalizeFieldValue(child?.first_name, 80) || 'non renseigné',
        growth: normalizeGrowthStatus(growthEntry),
        night_wakings: normalizeNightWakings(child?.sleep_night_wakings),
        appetit: normalizeFieldValue(child?.eating_style, 120) || 'non renseigné',
      };
    });

    return context;
  } catch (err) {
    console.warn('[ai] buildContext failed', { profileId: normalized, error: err?.message || err });
    return buildDefaultParentChildContext();
  }
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

function normalizeSpaces(s = '') {
  return s.replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
}

function endsWithSentencePunct(s = '') {
  return /[.!?…]\s*$/.test(s);
}

function trimToWordsAndSentences(text, maxWords = 80, softMaxWords = 92) {
  if (!text) return '';
  const preserved = text.replace(/[ \t]+/g, ' ').replace(/\r/g, '');
  const words = preserved.split(/\s+/);
  if (words.length <= maxWords && endsWithSentencePunct(preserved)) {
    return preserved;
  }

  const limit = Math.min(words.length, softMaxWords);
  let candidate = words.slice(0, limit).join(' ').trim();

  const lastPunct = Math.max(
    candidate.lastIndexOf('.'),
    candidate.lastIndexOf('!'),
    candidate.lastIndexOf('?'),
    candidate.lastIndexOf('…')
  );

  if (lastPunct >= 0 && lastPunct >= candidate.length - 60) {
    return candidate.slice(0, lastPunct + 1).trim();
  }

  const hard = words.slice(0, maxWords).join(' ').trim();
  return endsWithSentencePunct(hard) ? hard : `${hard}…`;
}

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
        const profileCandidates = [
          typeof body.profileId === 'string' ? body.profileId.trim() : '',
          typeof body.profile_id === 'string' ? body.profile_id.trim() : '',
        ];
        const profileId = profileCandidates.find((candidate) => candidate) || '';
        let effectiveProfileId = profileId;
        const codeCandidates = [
          typeof body.code_unique === 'string' ? body.code_unique.trim().toUpperCase() : '',
          typeof body.code === 'string' ? body.code.trim().toUpperCase() : '',
        ];
        const codeUnique = codeCandidates.find((candidate) => candidate) || '';
        let aiBilan = null;
        let familyBilanText = '';
        let fallbackChildrenFromAiBilan = [];
        if (profileId || codeUnique) {
          try {
            aiBilan = await fetchFamilyBilanForPrompt({ profileId, codeUnique });
            familyBilanText = formatFamilyAiBilanForPrompt(aiBilan);
            if (aiBilan) {
              fallbackChildrenFromAiBilan = extractChildrenFromStructuredAiBilan(aiBilan);
            }
          } catch (err) {
            const status = err instanceof HttpError ? err.status : null;
            console.warn('[ai/parent-update] unable to fetch family_context.ai_bilan', {
              profileId: profileId || null,
              codeUnique: codeUnique || null,
              status,
              details: err?.details || err?.message || String(err || ''),
            });
          }
        }
        const updateFacts = formatParentUpdateFacts(updateType, updatePayload);
        function makeFamilyBilanPreview(bilan) {
          if (!Array.isArray(bilan) || bilan.length === 0) return { used: false, preview: '' };
          const lines = bilan.slice(0, 2).map((c) => {
            const name = (c?.name || 'Enfant').toString().slice(0, 40);
            const status = (c?.growth?.status_global || '—').toString().slice(0, 60);
            const lu = c?.last_update || {};
            const luContent = (lu?.ai_summary || lu?.content || '').toString().slice(0, 120);
            const parts = [
              `• ${name}: statut OMS ${status}`,
              luContent ? `   Dernière note: ${luContent}` : null
            ].filter(Boolean);
            return parts.join('\n');
          });
          const preview = lines.join('\n').slice(0, 220);
          return { used: true, preview };
        }

        const bilanArray = Array.isArray(aiBilan)
          ? aiBilan
          : Array.isArray(aiBilan?.children)
            ? aiBilan.children
            : [];
        const { preview: familyBilanPreview } = makeFamilyBilanPreview(bilanArray);

        const {
          childSummary,
          childUpdatesSummary,
          childNames,
          effectiveProfileId: resolvedChildProfileId,
        } = await fetchChildrenContextForPrompt({ profileId, codeUnique });
        if (resolvedChildProfileId) {
          effectiveProfileId = resolvedChildProfileId;
        }

        const summarizedContext = await buildContext(effectiveProfileId, { codeUnique });
        if (
          (!Array.isArray(summarizedContext?.children) || !summarizedContext.children.length) &&
          fallbackChildrenFromAiBilan.length
        ) {
          summarizedContext.children = fallbackChildrenFromAiBilan;
          console.log('[AI DEBUG] fallback children from ai_bilan:', summarizedContext.children);
        }
        if (
          codeUnique &&
          (!Array.isArray(summarizedContext?.children) || !summarizedContext.children.length)
        ) {
          const parsedChildren = parseChildrenFromAiBilan(typeof aiBilan === 'string' ? aiBilan : '');
          if (parsedChildren.length) {
            summarizedContext.children = parsedChildren;
            console.log(
              '[AI DEBUG] fallback children from ai_bilan (anonymous):',
              summarizedContext.children
            );
          }
        }
        console.log(
          "[AI DEBUG] summarizedContext.children:",
          summarizedContext?.children || []
        );
        console.log(
          "[AI DEBUG] growthAnomalyChildren (avant filtrage):",
          Array.isArray(summarizedContext?.children)
            ? summarizedContext.children.map((c) => ({
                name: c?.name,
                growth: c?.growth,
              }))
            : []
        );
        const summarizedContextJson = JSON.stringify(summarizedContext);
        const contextChildren = Array.isArray(summarizedContext?.children)
          ? summarizedContext.children
          : [];
        let growthAnomalyChildren = contextChildren
          .map((child, index) => {
            if (!child || typeof child !== 'object') return null;
            const rawName = typeof child.name === 'string' ? child.name.trim() : '';
            const displayName = rawName || `Enfant #${index + 1}`;
            const growthText = typeof child.growth === 'string' ? child.growth.trim() : '';
            if (!growthText) return null;
            const normalizedGrowth = normalizeWithoutDiacritics(growthText);
            const hasAnomalyKeyword = CRITICAL_GROWTH_KEYWORDS.some((keyword) =>
              normalizedGrowth.includes(keyword)
            );
            if (!hasAnomalyKeyword) return null;
            if (/(pas\s+de|aucun|sans)\s+retard/.test(normalizedGrowth)) {
              return null;
            }
            return { name: displayName, growth: growthText };
          })
          .filter(Boolean);

        if (!growthAnomalyChildren.length && !contextChildren.length) {
          if (containsCriticalGrowthKeywords(familyBilanText)) {
            const parsedFromBilan = extractChildrenFromAiBilanText(familyBilanText);
            if (parsedFromBilan.length) {
              growthAnomalyChildren = parsedFromBilan;
            } else {
              const condensed = familyBilanText.split('\n').map((line) => line.trim()).filter(Boolean);
              const criticalLine = condensed.find((line) => containsCriticalGrowthKeywords(line));
              const growthText = (criticalLine || familyBilanText || '').trim().slice(0, 200);
              if (growthText) {
                growthAnomalyChildren = [{ name: 'Enfant', growth: growthText }];
              }
            }
          }
        }

        const rawAiPreview = (() => {
          if (!aiBilan) return '';
          if (typeof aiBilan === 'string') return aiBilan.trim();
          if (Array.isArray(aiBilan)) {
            const candidate = aiBilan.find((entry) => entry && typeof entry.ai_preview === 'string' && entry.ai_preview.trim());
            return candidate ? candidate.ai_preview.trim() : '';
          }
          if (typeof aiBilan === 'object') {
            if (typeof aiBilan.ai_preview === 'string' && aiBilan.ai_preview.trim()) {
              return aiBilan.ai_preview.trim();
            }
            if (Array.isArray(aiBilan.children)) {
              const childCandidate = aiBilan.children.find((entry) => entry && typeof entry.ai_preview === 'string' && entry.ai_preview.trim());
              if (childCandidate) return childCandidate.ai_preview.trim();
            }
          }
          return '';
        })();
        const aiPreview = rawAiPreview ? rawAiPreview.split('\n').slice(0, 6).join('\n').slice(0, 400) : '';

        const contextParts = [];
        if (familyBilanPreview) contextParts.push(`--- CONTEXTE FAMILIAL ---\n${familyBilanPreview}`);
        if (aiPreview) contextParts.push(`--- CONTEXTE ENFANTS ---\n${aiPreview}`);
        if (childSummary) contextParts.push(`--- FICHE ENFANTS (BDD) ---\n${childSummary}`);
        if (childUpdatesSummary) contextParts.push(`--- MISES À JOUR ENFANTS RÉCENTES ---\n${childUpdatesSummary}`);
        const contextText = contextParts.join('\n\n');
        const contextChildNames = new Set(
          bilanArray
            .map((entry) => (entry?.name ? String(entry.name).trim() : ''))
            .filter(Boolean)
        );
        childNames.forEach((name) => {
          if (name) contextChildNames.add(name);
        });
        const usedAiBilan = Boolean(
          familyBilanText ||
          familyBilanPreview ||
          aiPreview ||
          childSummary ||
          childUpdatesSummary ||
          contextChildNames.size
        );
        const userParts = [
          updateType ? `Type de mise à jour: ${updateType}` : '',
          updateFacts ? `Données factuelles de la mise à jour: ${updateFacts}` : '',
        ];
        if (parentContextLines.length) {
          userParts.push(`Contexte parental actuel:\n${parentContextLines.map((line) => `- ${line}`).join('\n')}`);
        }
        if (familyBilanText) {
          userParts.push(`Contexte global des enfants (ai_bilan):\n${familyBilanText}`);
        }
        if (contextChildNames.size) {
          const namesList = Array.from(contextChildNames).join(', ');
          userParts.push(`Analyse attendue: fournir un état de santé détaillé pour ${namesList} et relier ces informations aux recommandations pratiques pour la famille.`);
        }
        const userContentBlocks = [];
        const globalContextBlock = `Contexte global:\n${summarizedContextJson}`;
        const parentCommentBlock = `Commentaire parent:\n${parentComment || '(aucun commentaire transmis)'}`;
        userContentBlocks.push(globalContextBlock);
        userContentBlocks.push(parentCommentBlock);
        if (contextText) {
          userContentBlocks.push(`Contextes fournis (à intégrer sans les recopier mot pour mot) :\n${contextText}`);
        }
        if (growthAnomalyChildren.length) {
          const anomalySummary = growthAnomalyChildren
            .map((entry) => `${entry.name}: ${entry.growth}`)
            .join('; ');
          userContentBlocks.push(`Anomalies de croissance détectées:\n${anomalySummary}`);
        }
        userContentBlocks.push(userParts.filter(Boolean).join('\n\n'));
        const userContent = userContentBlocks.filter(Boolean).join('\n\n') || 'Aucune donnée fournie.';

        let system = `Tu es Ped’IA, coach parental bienveillant. Analyse les informations factuelles ci-dessous et rédige un commentaire personnalisé (150 mots max).
Ton ton reste chaleureux, mais privilégie l'analyse factuelle et les actions concrètes.
Relie explicitement les informations concernant les enfants (prénoms, croissance, incidents, santé) aux conseils que tu donnes.
Si le parent demande des informations centrées sur les enfants, respecte cette consigne.
Propose des recommandations précises et actionnables plutôt que des généralités.`;
        system += `\nRéponds à la fois au contexte global (parent + enfants) **et** au commentaire du parent. Relie l’état du parent (stress, fatigue, emploi) avec celui des enfants (croissance, réveils nocturnes, appétit). Si un enfant a 3 réveils nocturnes ou plus, mentionne-le explicitement comme facteur de stress parental. Sois concret et bienveillant, 150 mots max.`;
        if (growthAnomalyChildren.length) {
          const anomalyLines = growthAnomalyChildren
            .map((entry) => `- ${entry.name}: ${entry.growth}`)
            .join('\n');
          system += `\n[CRITIQUE] Des anomalies de croissance ont été détectées : \n${anomalyLines}\nTu dois les citer explicitement et recommander un suivi médical clair (consultation, surveillance ou examen).`;
        }
        if (usedAiBilan) {
          system += `\n[IMPORTANT] Un bloc "Contexte global des enfants (ai_bilan)" est fourni : tu DOIS en tenir compte et y faire explicitement référence au moins une fois dans ta réponse.`;
        }
        if (contextChildNames.size) {
          const namesList = Array.from(contextChildNames).join(', ');
          system += `\nLES ENFANTS À COUVRIR: ${namesList}. Pour chacun, décris concrètement l'état de santé/croissance, rappelle les points critiques et fournis une action ou un suivi clair.`;
        }
        const parentCommentLower = parentComment.toLowerCase();
        const wantsChildFocus = /enfant|croissance|sant[eé]/i.test(parentComment) && /(uniquement|juste|parle.*enfant|rien.*parent)/i.test(parentCommentLower);
        if (wantsChildFocus) {
          system += `\n[FOCUS ENFANTS] Limite toute mention du parent à la manière dont il peut soutenir ses enfants. Ne renvoie pas la discussion sur l’adulte.`;
        }
        const criticalTextAggregate = `${familyBilanText}\n${familyBilanPreview}\n${aiPreview}\n${childUpdatesSummary}`;
        const hasCriticalAlert = /fractur|pl[aâ]tre|bronchiol|bronchit|hospital|urgence|déshydrat|statut\s*oms\s*:\s*(?!.*(ok|normal))|(a|à)\s*surveiller|hors\s*norme|\bretard\b|croissance[\s\S]{0,80}anormal/i.test(criticalTextAggregate);
        if (hasCriticalAlert) {
          system += `\n[CRITIQUE] Des anomalies importantes sont signalées : cite-les explicitement (motifs, prénoms) et propose une action médicale concrète (consultation, examen, surveillance renforcée).`;
        }
        if (contextText) console.log('[AI DEBUG] contextText:', contextText);
        console.log('[AI DEBUG] usedAiBilan:', usedAiBilan);
        if (usedAiBilan) console.log('[AI DEBUG] familyBilanPreview:', familyBilanPreview);
        const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.35,
            max_tokens: 420,
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
        const choice = aiJson?.choices?.[0] || {};
        const finishReason = choice?.finish_reason || '';
        let comment = (choice?.message?.content || '').trim();
        if (finishReason === 'length') {
          comment = `${comment}…`;
        }
        comment = trimToWordsAndSentences(comment, 130, 150);
        if (comment.length > 2000) comment = comment.slice(0, 2000).trim();
        if (!comment || areTextsTooSimilar(comment, parentComment)) {
          comment = fallbackParentAiComment(parentComment);
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(JSON.stringify({
          comment,
          aiCommentaire: comment,
          used_ai_bilan: usedAiBilan,
          familyBilanPreview
        }));
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
        console.info('[ai/growth] before anomaly check', JSON.stringify(growthData, null, 2));
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
        let primaryGlobalStatus = '';
        const recordStatusesFromEntry = (entry) => {
          if (!entry || typeof entry !== 'object') return;
          const statusValues = [
            entry.status_global ?? entry.statusGlobal,
            entry.status_height ?? entry.statusHeight,
            entry.status_weight ?? entry.statusWeight,
          ];
          statusValues.forEach((value, idx) => {
            const text = sanitizeGrowthSummary(value);
            if (!text) return;
            statusTokens.add(text);
            if (idx === 0 && !primaryGlobalStatus) {
              primaryGlobalStatus = text;
            }
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
          return normalized === 'normal' || normalized === 'normale' || normalized === 'ok';
        };
        const hasGrowthAnomalyFromStatus = Array.from(statusTokens).some(
          (status) => status && !isStatusNormal(status)
        );
        let growthSummary = rawGrowthSummary;
        const measurementSummary = sanitizeGrowthSummary(
          buildGrowthAlertSummaryFromMeasurements(growthData?.measurements)
        );
        if (!growthSummary && measurementSummary) {
          growthSummary = measurementSummary;
        }
        if (growthSummary) {
          console.info('[ai/growth] growthSummary', growthSummary);
        }
        const summarySignalsAlert = growthSummary
          ? /⚠️|anomalie|surveill|alerte|danger|critique/i.test(growthSummary)
          : false;
        const globalStatusIsAlert = primaryGlobalStatus
          ? !isStatusNormal(primaryGlobalStatus)
          : false;
        const hasGrowthAnomaly = hasGrowthAnomalyFromStatus || summarySignalsAlert || globalStatusIsAlert;
        if (hasGrowthAnomaly) {
          console.warn('[ai/growth] anomaly detected for childId', childId);
        }
        const includeGrowth =
          (Array.isArray(growthData?.measurements) && growthData.measurements.length > 0) ||
          Boolean(growthSummary) ||
          Boolean(primaryGlobalStatus);
        const filteredContextParts = hasGrowthAnomaly && growthSummary
          ? contextParts.filter((entry) => !isSameGrowthSummary(entry, growthSummary))
          : contextParts;
        const growthPromptLines = includeGrowth
          ? buildGrowthPromptLines({ parentComment, latestGrowthData }).filter(
              (line) => !/^\s*Analyse\s+OMS/i.test(line || '')
            )
          : [];
        const growthSection = includeGrowth ? formatGrowthSectionForPrompt(growthData) : '';
        const globalStatusSentence = primaryGlobalStatus ? `Statut global OMS: ${primaryGlobalStatus}.` : '';
        const growthSummaryLine = growthSummary ? `Synthèse croissance (OMS): ${growthSummary}` : '';
        const growthAlertLine = hasGrowthAnomaly && growthSummary
          ? `Alerte OMS à relayer impérativement: ${growthSummary}`
          : '';
        const summarySections = [
          updateType ? `Type de mise à jour: ${updateType}` : '',
          `Mise à jour (JSON): ${updateText || 'Aucune'}`,
          globalStatusSentence,
          growthSummaryLine,
          growthAlertLine,
          ...growthPromptLines,
          ...filteredContextParts,
          includeGrowth && growthSection ? `Section Croissance:\n${growthSection}` : ''
        ].filter(Boolean);
        const summaryMessages = [
          {
            role: 'system',
            content:
              "Tu es Ped’IA. Résume factuellement la mise à jour fournie en français en 50 mots maximum. Utilise uniquement les informations transmises (mise à jour + commentaire parent + données de croissance). Si les statuts OMS indiquent une anomalie (statut global, taille ou poids différent de \"normal\"), ajoute une phrase d'alerte explicite.",
          },
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
          globalStatusSentence,
          growthSummaryLine,
          hasGrowthAnomaly && growthSummary ? `Alerte OMS obligatoire pour le commentaire: ${growthSummary}` : '',
          ...growthPromptLines,
          ...filteredContextParts,
          includeGrowth && growthSection ? `Croissance récente:\n${growthSection}` : '',
          parentContextBlock
        ].filter(Boolean);
        const commentMessages = [
          {
            role: 'system',
            content:
              "Tu es Ped’IA, assistant parental bienveillant. Rédige un commentaire personnalisé (80 mots max) basé uniquement sur la nouvelle mise à jour, le commentaire parent, les données de croissance fournies et les résumés factuels. Prends en compte le contexte parental (stress, fatigue, émotions) pour adapter ton empathie et tes conseils. Ne réutilise jamais d’anciens commentaires IA. Si une anomalie OMS est signalée, inclue une phrase d'alerte explicite.",
          },
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
        const childStatusLines = buildFamilyChildrenGlobalStatus({
          children: childrenRows,
          childUpdates,
          growthByChild,
        });
        const childStatusFallback = childrenRows.map((child, index) => {
          if (!child) return `Enfant #${index + 1} : aucune donnée récente`;
          const rawName = typeof child.first_name === 'string' ? child.first_name.trim() : '';
          const displayName = rawName || `#${index + 1}`;
          return `Enfant ${displayName} : aucune donnée récente`;
        });
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
          childrenRows.length
            ? `État global des enfants:\n${(childStatusLines.length ? childStatusLines : childStatusFallback).join('\n')}`
            : 'État global des enfants:\nAucun enfant enregistré.',
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
        let profileId = profileIdCandidates.find(Boolean)?.slice(0, 128) || '';
        const codeCandidates = [
          typeof body.code_unique === 'string' ? body.code_unique : '',
          typeof body.code === 'string' ? body.code : '',
          typeof req?.query?.code_unique === 'string' ? req.query.code_unique : '',
          typeof req?.query?.code === 'string' ? req.query.code : '',
        ];
        const rawCode = codeCandidates.find(Boolean) || '';
        const codeUnique = rawCode ? String(rawCode).trim().toUpperCase().slice(0, 64) : '';

        const startTime = Date.now();
        console.info('[ai] child-full-report start', { childId, profileId: profileId || null });

        let supaConfig;
        try {
          supaConfig = getServiceConfig();
        } catch (err) {
          console.error('[ai] child-full-report fail', { step: 'config', err });
          if (err instanceof HttpError && /Missing SUPABASE/i.test(err.message || '')) {
            return res.status(500).json({ error: 'Missing Supabase service credentials' });
          }
          return res.status(500).json({ error: 'Supabase configuration error' });
        }
        const { supaUrl, serviceKey } = supaConfig;
        if (!supaUrl || !serviceKey) {
          console.error('[ai] child-full-report fail', { step: 'config', err: 'Missing service credentials' });
          return res.status(500).json({ error: 'Missing Supabase service credentials' });
        }
        const supabaseHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

        if (!profileId && codeUnique) {
          try {
            const resolved = await resolveProfileIdFromCode(codeUnique, { supaUrl, headers: supabaseHeaders });
            if (resolved) profileId = resolved;
          } catch (err) {
            console.warn('[ai] child-full-report profile resolve failed', { codeUnique, err });
          }
        }

        let childUpdates;
        try {
          childUpdates = await fetchChildUpdatesForReport({ supaUrl, headers: supabaseHeaders, childId, limit: 15 });
        } catch (err) {
          console.error('[ai] child-full-report fail', { step: 'updates', err });
          const status = err instanceof HttpError && err.status ? err.status : 500;
          return res.status(status).json({ error: 'Unable to fetch child updates' });
        }
        if (!childUpdates.length) {
          console.info('[ai] updates counts', { child: 0, parent: 0 });
          return res.status(404).json({ error: 'Not enough updates' });
        }
        const childSummaries = childUpdates.map(summarizeChildUpdateForReport);

        let childBaselineRow = null;
        try {
          childBaselineRow = await fetchChildBaselineRow({ supaUrl, headers: supabaseHeaders, childId });
        } catch (err) {
          console.warn('[ai] child-full-report baseline fetch failed', { childId, err });
        }
        const mergedChildData = mergeChildBaselineData(childBaselineRow, childUpdates);

        let parentUpdates = [];
        if (profileId) {
          try {
            parentUpdates = await fetchParentUpdatesForReport({
              supaUrl,
              headers: supabaseHeaders,
              childId,
              profileId,
              limit: 5,
            });
          } catch (err) {
            console.error('[ai] child-full-report fail', { step: 'parent-updates', err });
            const status = err instanceof HttpError && err.status ? err.status : 500;
            return res.status(status).json({ error: 'Unable to fetch parent updates' });
          }
        }
        const parentSummaries = parentUpdates.map(summarizeParentUpdateForReport);
        console.info('[ai] updates counts', { child: childSummaries.length, parent: parentSummaries.length });

        let growthData = null;
        let growthError = null;
        try {
          growthData = await fetchGrowthDataForPrompt({
            childId,
            measurementLimit: 3,
            teethLimit: 3,
            supaUrl,
            headers: supabaseHeaders,
            profileId,
            codeUnique,
          });
        } catch (err) {
          growthError = err;
          console.error('[ai] child-full-report fail', { step: 'growth', err });
        }
        const hasMeasurements = Array.isArray(growthData?.measurements) && growthData.measurements.length > 0;
        const hasTeeth = Array.isArray(growthData?.teeth) && growthData.teeth.length > 0;
        console.info('[ai] growth presence', { hasMeasurements, hasTeeth });

        if (mergedChildData) {
          enrichChildGrowthFromMeasurements(mergedChildData, growthData);
        }

        const childFirstName = await fetchChildFirstName({ supaUrl, headers: supabaseHeaders, childId }).catch((err) => {
          console.warn('[ai] child-full-report first name fetch failed', { childId, err });
          return '';
        });

        const resumeSection = buildReportResumeSection({
          firstName: childFirstName,
          childCount: childSummaries.length,
          parentCount: parentSummaries.length,
        });

        const growthSection = buildReportGrowthSection({
          growthData,
          hasError: Boolean(growthError),
        });

        const detailsSection = buildReportDetailsSection({
          childSummaries,
          parentSummaries,
        });

        const baselineSection = buildChildBaselineSection({ childData: mergedChildData });
        const promptSections = [resumeSection];
        if (baselineSection) promptSections.push(baselineSection);
        promptSections.push(growthSection, detailsSection);
        const userPrompt = promptSections.join('\n---\n');
        console.info('[ai] prompt sizes', { userChars: userPrompt.length });

        const system = `Tu es Ped’IA, assistant parental. À partir des informations résumées ci-dessous, rédige un bilan complet en français (maximum 500 mots). Structure ta réponse avec exactement les sections suivantes : Croissance (taille, poids, dents), Sommeil, Alimentation, Jalons de développement, Remarques parentales, Recommandations pratiques. Utilise uniquement les données résumées fournies, sans extrapoler. Pour chaque section sans information fiable, écris « À compléter ». Analyse la croissance en t'appuyant sur les mesures et statuts fournis. Ton style est factuel, positif et accessible.`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        let aiResponse;
        try {
          aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              temperature: 0.3,
              max_tokens: 900,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: userPrompt },
              ],
            }),
          });
        } catch (err) {
          clearTimeout(timeout);
          if (err?.name === 'AbortError') {
            console.warn('[ai] timeout', { feature: 'child-full-report', childId, elapsedMs: Date.now() - startTime });
            return res.status(504).json({ error: 'AI timeout exceeded 20s' });
          }
          console.error('[ai] openai error', { step: 'fetch', err });
          return res.status(502).json({ error: 'Erreur IA', details: err?.message || 'Unknown error' });
        }
        clearTimeout(timeout);

        if (!aiResponse.ok) {
          const errorBody = await aiResponse.text();
          console.error('[ai] openai error', { status: aiResponse.status, body: errorBody });
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.status(502).send(errorBody || 'OpenAI error');
        }

        const aiJson = await aiResponse.json();
        const report = aiJson.choices?.[0]?.message?.content?.trim() || '';
        if (!report) {
          console.error('[ai] child-full-report fail', { step: 'openai', err: 'Empty report' });
          return res.status(502).json({ error: 'Rapport indisponible' });
        }

        const elapsedMs = Date.now() - startTime;
        const tokensUsed = aiJson?.usage?.total_tokens ?? null;
        console.info('[ai] child-full-report ok', { tokensUsed, elapsedMs });

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

function buildFamilyChildrenGlobalStatus({ children = [], childUpdates = [], growthByChild }) {
  if (!Array.isArray(children) || !children.length) return [];
  const updatesByChild = new Map();
  (Array.isArray(childUpdates) ? childUpdates : []).forEach((row) => {
    if (!row || !Object.prototype.hasOwnProperty.call(row, 'child_id')) return;
    const id = row.child_id != null ? String(row.child_id) : '';
    if (!id) return;
    const list = updatesByChild.get(id) || [];
    if (list.length >= 3) return;
    list.push(row);
    updatesByChild.set(id, list);
  });
  return children
    .map((child, index) => {
      if (!child) return '';
      const id = child.id != null ? String(child.id) : '';
      const rawName = typeof child.first_name === 'string' ? child.first_name.trim() : '';
      const displayName = rawName || `#${index + 1}`;
      const updates = updatesByChild.get(id) || [];
      const updateHighlights = updates
        .map((row) => extractChildUpdateHighlight(row))
        .filter(Boolean);
      const growthEntry = growthByChild && typeof growthByChild.get === 'function' ? growthByChild.get(id) : null;
      const growthHighlight = buildChildGrowthHighlight(growthEntry);
      const parts = [];
      if (updateHighlights.length) {
        parts.push(updateHighlights.join(' | '));
      }
      if (growthHighlight) {
        parts.push(`Croissance: ${growthHighlight}`);
      }
      const body = parts.length ? truncateForPrompt(parts.join(' ; '), 280) : 'aucune donnée récente';
      return `Enfant ${displayName} : ${body}`;
    })
    .filter(Boolean);
}

function extractChildUpdateHighlight(row = {}) {
  const summary = truncateForPrompt(row?.ai_summary, 200);
  if (summary) return summary;
  const comment = truncateForPrompt(row?.ai_commentaire, 200);
  if (comment) return comment;
  const parsed = parseUpdateContentForPrompt(row?.update_content);
  if (parsed && typeof parsed === 'object') {
    const parsedSummary = truncateForPrompt(parsed.summary, 200);
    if (parsedSummary) return parsedSummary;
    const formatted = formatUpdateDataForPrompt(parsed);
    if (formatted) return truncateForPrompt(formatted, 200);
  }
  return '';
}

function buildChildGrowthHighlight(growthData) {
  if (!growthData || typeof growthData !== 'object') return '';
  const measurements = Array.isArray(growthData.measurements)
    ? growthData.measurements.filter(Boolean).slice(0, 3)
    : [];
  const measurementLines = formatGrowthMeasurementsForPrompt(measurements).slice(0, 2);
  const analysis = buildGrowthInterpretationLine(measurements) || '';
  const teethLine = formatGrowthTeethForPrompt(growthData.teeth);
  const parts = [];
  if (measurementLines.length) {
    parts.push(measurementLines.join(' | '));
  }
  if (analysis) {
    parts.push(analysis.replace(/^Analyse\s*:\s*/i, '').trim());
  }
  if (teethLine) {
    parts.push(`Dents: ${teethLine}`);
  }
  const text = parts.filter(Boolean).join(' ; ');
  return text ? truncateForPrompt(text, 200) : '';
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

async function fetchChildUpdatesForReport({ supaUrl, headers, childId, limit = 15 }) {
  if (!supaUrl || !headers || !childId) {
    throw new HttpError(500, 'Missing Supabase parameters');
  }
  const effectiveLimit = Math.max(1, Math.min(15, Number(limit) || 15));
  const url = `${supaUrl}/rest/v1/child_updates?select=id,child_id,update_type,update_content,created_at,ai_summary,ai_commentaire&child_id=eq.${encodeURIComponent(childId)}&order=created_at.desc&limit=${effectiveLimit}`;
  const data = await supabaseRequest(url, { headers });
  return Array.isArray(data) ? data : [];
}

async function fetchParentUpdatesForReport({ supaUrl, headers, childId, profileId, limit = 5 }) {
  if (!supaUrl || !headers || !childId || !profileId) {
    throw new HttpError(500, 'Missing Supabase parameters');
  }
  const effectiveLimit = Math.max(1, Math.min(5, Number(limit) || 5));
  const query = `${supaUrlArg}/rest/v1/parent_updates?select=id,profile_id,child_id,update_type,update_content,parent_comment,ai_commentaire,created_at&child_id=eq.${encodeURIComponent(childId)}&profile_id=eq.${encodeURIComponent(profileId)}&order=created_at.desc&limit=${effectiveLimit}`;
  const data = await supabaseRequest(query, { headers });
  return Array.isArray(data) ? data : [];
}

async function fetchChildFirstName({ supaUrl, headers, childId }) {
  if (!supaUrl || !headers || !childId) return '';
  try {
    const data = await supabaseRequest(
      `${supaUrlArg}/rest/v1/children?select=first_name&id=eq.${encodeURIComponent(childId)}&limit=1`,
      { headers }
    );
    const row = Array.isArray(data) ? data[0] : data;
    const name = typeof row?.first_name === 'string' ? row.first_name.trim() : '';
    return name.slice(0, 120);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, 'Unable to fetch child name', err?.message || err);
  }
}

function summarizeChildUpdateForReport(row = {}) {
  const type = typeof row?.update_type === 'string' ? row.update_type.trim().slice(0, 64) : '';
  const ai_summary = truncateForPrompt(row?.ai_summary, 400);
  const ai_commentaire = truncateForPrompt(row?.ai_commentaire, 400);
  let contentRaw = '';
  if (typeof row?.update_content === 'string') {
    contentRaw = row.update_content;
  } else if (row?.update_content != null) {
    try {
      contentRaw = JSON.stringify(row.update_content);
    } catch (err) {
      contentRaw = String(row.update_content);
    }
  }
  const content = truncateForPrompt(contentRaw, 400);
  return {
    date: toIsoString(row?.created_at),
    type,
    ai_summary,
    ai_commentaire,
    content,
  };
}

function summarizeParentUpdateForReport(row = {}) {
  const type = typeof row?.update_type === 'string' ? row.update_type.trim().slice(0, 64) : '';
  const parent_comment = truncateForPrompt(row?.parent_comment, 400);
  const ai_commentaire = truncateForPrompt(row?.ai_commentaire, 400);
  return {
    date: toIsoString(row?.created_at),
    type,
    parent_comment,
    ai_commentaire,
  };
}

async function fetchChildBaselineRow({ supaUrl, headers, childId }) {
  if (!supaUrl || !headers || !childId) return null;
  try {
    const query = `${supaUrlArg}/rest/v1/children?select=*&id=eq.${encodeURIComponent(childId)}&limit=1`;
    const data = await supabaseRequest(query, { headers });
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

function mergeChildBaselineData(baseRow, updateRows = []) {
  const state = mapChildRowToState(baseRow);
  const updates = Array.isArray(updateRows) ? [...updateRows] : [];
  updates.sort((a, b) => {
    const aTime = new Date(a?.created_at || 0).getTime();
    const bTime = new Date(b?.created_at || 0).getTime();
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return -1;
    if (Number.isNaN(bTime)) return 1;
    return aTime - bTime;
  });
  updates.forEach((row) => applyChildUpdateToState(state, row));
  return state;
}

function createEmptyChildSleep() {
  return {
    falling: '',
    sleepsThrough: null,
    nightWakings: '',
    wakeDuration: '',
    bedtime: '',
  };
}

function createEmptyChildContext() {
  return {
    allergies: '',
    history: '',
    care: '',
    languages: '',
    feedingType: '',
    eatingStyle: '',
    sleep: createEmptyChildSleep(),
  };
}

function createEmptyChildState() {
  return {
    firstName: '',
    dob: '',
    sex: '',
    context: createEmptyChildContext(),
    milestones: [],
    growth: {
      heightCm: null,
      weightKg: null,
      teethCount: null,
    },
  };
}

function sanitizeChildTextValue(value, { maxLength = 200 } = {}) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return truncateForPrompt(trimmed, maxLength);
  }
  try {
    const text = String(value);
    return sanitizeChildTextValue(text, { maxLength });
  } catch {
    return '';
  }
}

function normalizeSexValue(value) {
  if (value == null) return '';
  if (typeof value === 'number') {
    if (value === 0) return 'fille';
    if (value === 1) return 'garçon';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const normalized = trimmed
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (['0', 'f', 'fille', 'girl', 'female', 'feminin'].includes(normalized)) return 'fille';
    if (['1', 'g', 'm', 'garcon', 'garçon', 'boy', 'male', 'masculin'].includes(normalized)) return 'garçon';
    return truncateForPrompt(trimmed, 40);
  }
  return truncateForPrompt(String(value), 40);
}

function normalizeBooleanInput(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return null;
    if (['1', 'true', 'yes', 'oui'].includes(trimmed)) return true;
    if (['0', 'false', 'no', 'non'].includes(trimmed)) return false;
  }
  return null;
}

function mergeChildSleepValues(base, updates) {
  const sleep = base && typeof base === 'object' ? { ...base } : createEmptyChildSleep();
  if (!updates || typeof updates !== 'object') return sleep;
  const keys = ['falling', 'nightWakings', 'wakeDuration', 'bedtime'];
  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      const raw = updates[key];
      const text = sanitizeChildTextValue(raw, { maxLength: 80 });
      sleep[key] = text == null ? '' : text;
    }
  });
  if (Object.prototype.hasOwnProperty.call(updates, 'sleepsThrough')) {
    const bool = updates.sleepsThrough;
    sleep.sleepsThrough = typeof bool === 'boolean'
      ? bool
      : normalizeBooleanInput(bool);
  }
  return sleep;
}

function mergeChildContextValues(base, updates) {
  const context = base && typeof base === 'object' ? { ...base } : createEmptyChildContext();
  if (!updates || typeof updates !== 'object') return context;
  const assignments = [
    ['allergies', 200],
    ['history', 200],
    ['care', 200],
    ['languages', 200],
    ['feedingType', 120],
    ['eatingStyle', 120],
  ];
  assignments.forEach(([key, limit]) => {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      const raw = updates[key];
      const text = sanitizeChildTextValue(raw, { maxLength: limit });
      if (key === 'feedingType' || key === 'eatingStyle') {
        context[key] = text == null ? '' : text;
      } else {
        context[key] = text == null ? '' : text;
      }
    }
  });
  if (Object.prototype.hasOwnProperty.call(updates, 'sleep')) {
    context.sleep = mergeChildSleepValues(context.sleep, updates.sleep);
  }
  return context;
}

function mergeChildGrowthValues(base, updates) {
  const growth = base && typeof base === 'object'
    ? { ...base }
    : { heightCm: null, weightKg: null, teethCount: null };
  if (!updates || typeof updates !== 'object') return growth;
  if (Object.prototype.hasOwnProperty.call(updates, 'heightCm')) {
    const val = Number(updates.heightCm);
    growth.heightCm = Number.isFinite(val) ? val : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'weightKg')) {
    const val = Number(updates.weightKg);
    growth.weightKg = Number.isFinite(val) ? val : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'teethCount')) {
    const val = Number(updates.teethCount);
    growth.teethCount = Number.isFinite(val) ? Math.max(0, Math.round(val)) : null;
  }
  return growth;
}

function mergeChildStateValues(state, updates) {
  if (!state || typeof state !== 'object' || !updates || typeof updates !== 'object') return state;
  if (Object.prototype.hasOwnProperty.call(updates, 'firstName')) {
    const text = sanitizeChildTextValue(updates.firstName, { maxLength: 120 });
    state.firstName = text == null ? '' : text;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'dob')) {
    const text = sanitizeChildTextValue(updates.dob, { maxLength: 40 });
    state.dob = text == null ? '' : text;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'sex')) {
    state.sex = normalizeSexValue(updates.sex);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'context')) {
    state.context = mergeChildContextValues(state.context, updates.context);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'milestones')) {
    state.milestones = Array.isArray(updates.milestones)
      ? updates.milestones.slice(0, 120).map((entry) => !!entry)
      : state.milestones;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'growth')) {
    state.growth = mergeChildGrowthValues(state.growth, updates.growth);
  }
  return state;
}

function mapChildRowToState(row) {
  const state = createEmptyChildState();
  if (!row || typeof row !== 'object') return state;
  if (Object.prototype.hasOwnProperty.call(row, 'first_name') || Object.prototype.hasOwnProperty.call(row, 'firstName')) {
    const text = sanitizeChildTextValue(row.first_name ?? row.firstName, { maxLength: 120 });
    state.firstName = text == null ? '' : text;
  }
  if (Object.prototype.hasOwnProperty.call(row, 'dob')) {
    const text = sanitizeChildTextValue(row.dob, { maxLength: 40 });
    state.dob = text == null ? '' : text;
  }
  if (Object.prototype.hasOwnProperty.call(row, 'sex')) {
    state.sex = normalizeSexValue(row.sex);
  }
  const contextPayload = {
    allergies: row.context_allergies,
    history: row.context_history,
    care: row.context_care,
    languages: row.context_languages,
    feedingType: row.feeding_type,
    eatingStyle: row.eating_style,
    sleep: {
      falling: row.sleep_falling,
      sleepsThrough: typeof row.sleep_sleeps_through === 'boolean'
        ? row.sleep_sleeps_through
        : normalizeBooleanInput(row.sleep_sleeps_through),
      nightWakings: row.sleep_night_wakings,
      wakeDuration: row.sleep_wake_duration,
      bedtime: row.sleep_bedtime,
    },
  };
  state.context = mergeChildContextValues(state.context, contextPayload);
  if (Array.isArray(row.milestones)) {
    state.milestones = row.milestones.slice(0, 120).map((entry) => !!entry);
  }
  const growthPayload = {};
  if (Object.prototype.hasOwnProperty.call(row, 'height_cm')) growthPayload.heightCm = row.height_cm;
  if (Object.prototype.hasOwnProperty.call(row, 'weight_kg')) growthPayload.weightKg = row.weight_kg;
  if (Object.prototype.hasOwnProperty.call(row, 'teeth_count')) growthPayload.teethCount = row.teeth_count;
  state.growth = mergeChildGrowthValues(state.growth, growthPayload);
  return state;
}

function readStringCandidate(source, keys, { maxLength = 200 } = {}) {
  if (!source || typeof source !== 'object') return { found: false };
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key];
      const text = sanitizeChildTextValue(value, { maxLength });
      return { found: true, value: text == null ? '' : text };
    }
  }
  return { found: false };
}

function readBooleanCandidate(source, keys) {
  if (!source || typeof source !== 'object') return { found: false };
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return { found: true, value: normalizeBooleanInput(source[key]) };
    }
  }
  return { found: false };
}

function readNumberCandidate(source, keys) {
  if (!source || typeof source !== 'object') return { found: false };
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const raw = source[key];
      if (raw == null || raw === '') return { found: true, value: null };
      const num = Number(raw);
      if (Number.isFinite(num)) return { found: true, value: num };
      return { found: true, value: null };
    }
  }
  return { found: false };
}

function readSexCandidate(source) {
  if (!source || typeof source !== 'object') return { found: false };
  if (Object.prototype.hasOwnProperty.call(source, 'sex')) {
    return { found: true, value: normalizeSexValue(source.sex) };
  }
  if (Object.prototype.hasOwnProperty.call(source, 'gender')) {
    return { found: true, value: normalizeSexValue(source.gender) };
  }
  return { found: false };
}

function extractSleepFromCandidate(source) {
  if (!source || typeof source !== 'object') return null;
  const sleepSources = [];
  if (source.sleep && typeof source.sleep === 'object') sleepSources.push(source.sleep);
  if (source.context && typeof source.context === 'object' && source.context.sleep && typeof source.context.sleep === 'object') {
    sleepSources.push(source.context.sleep);
  }
  sleepSources.push(source);
  let result = null;
  sleepSources.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (!result) result = {};
    const falling = readStringCandidate(entry, ['falling', 'sleep_falling', 'endormissement'], { maxLength: 80 });
    if (falling.found) result.falling = falling.value;
    const night = readStringCandidate(entry, ['nightWakings', 'sleep_night_wakings', 'reveils'], { maxLength: 80 });
    if (night.found) result.nightWakings = night.value;
    const wake = readStringCandidate(entry, ['wakeDuration', 'sleep_wake_duration', 'duree_eveil'], { maxLength: 80 });
    if (wake.found) result.wakeDuration = wake.value;
    const bedtime = readStringCandidate(entry, ['bedtime', 'sleep_bedtime', 'heure_coucher'], { maxLength: 40 });
    if (bedtime.found) result.bedtime = bedtime.value;
    const through = readBooleanCandidate(entry, ['sleepsThrough', 'sleep_sleeps_through', 'sleepThrough', 'fait_ses_nuits']);
    if (through.found) result.sleepsThrough = through.value;
  });
  return result;
}

function extractContextFromCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const sources = [];
  sources.push(candidate);
  if (candidate.context && typeof candidate.context === 'object') sources.push(candidate.context);
  if (candidate.profile && typeof candidate.profile === 'object' && candidate.profile.context && typeof candidate.profile.context === 'object') {
    sources.push(candidate.profile.context);
  }
  let context = null;
  sources.forEach((source) => {
    if (!source || typeof source !== 'object') return;
    const allergies = readStringCandidate(source, ['allergies', 'context_allergies'], { maxLength: 200 });
    const history = readStringCandidate(source, ['history', 'context_history', 'antecedents'], { maxLength: 200 });
    const care = readStringCandidate(source, ['care', 'context_care', 'mode_de_garde'], { maxLength: 200 });
    const languages = readStringCandidate(source, ['languages', 'context_languages'], { maxLength: 200 });
    const feeding = readStringCandidate(source, ['feedingType', 'feeding_type', 'alimentation'], { maxLength: 120 });
    const eating = readStringCandidate(source, ['eatingStyle', 'eating_style', 'appetit'], { maxLength: 120 });
    const sleep = extractSleepFromCandidate(source);
    if (allergies.found || history.found || care.found || languages.found || feeding.found || eating.found || sleep) {
      if (!context) context = {};
      if (allergies.found) context.allergies = allergies.value;
      if (history.found) context.history = history.value;
      if (care.found) context.care = care.value;
      if (languages.found) context.languages = languages.value;
      if (feeding.found) context.feedingType = feeding.value;
      if (eating.found) context.eatingStyle = eating.value;
      if (sleep) {
        const baseSleep = context.sleep && typeof context.sleep === 'object' ? context.sleep : undefined;
        context.sleep = mergeChildSleepValues(baseSleep, sleep);
      }
    }
  });
  return context;
}

function extractGrowthFromCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const sources = [];
  if (candidate.growth && typeof candidate.growth === 'object') sources.push(candidate.growth);
  if (candidate.snapshot && typeof candidate.snapshot === 'object' && candidate.snapshot.growth) sources.push(candidate.snapshot.growth);
  if (candidate.next && typeof candidate.next === 'object' && candidate.next.growth) sources.push(candidate.next.growth);
  sources.push(candidate);
  let growth = null;
  sources.forEach((source) => {
    if (!source || typeof source !== 'object') return;
    const height = readNumberCandidate(source, ['heightCm', 'height_cm', 'height']);
    const weight = readNumberCandidate(source, ['weightKg', 'weight_kg', 'weight']);
    const teeth = readNumberCandidate(source, ['teethCount', 'teeth_count', 'teeth']);
    if (height.found || weight.found || teeth.found) {
      if (!growth) growth = {};
      if (height.found) growth.heightCm = height.value;
      if (weight.found) growth.weightKg = weight.value;
      if (teeth.found) {
        growth.teethCount = teeth.value == null ? null : Math.max(0, Math.round(teeth.value));
      }
    }
  });
  return growth;
}

function extractChildStateFromCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const out = {};
  const firstName = readStringCandidate(candidate, ['firstName', 'first_name'], { maxLength: 120 });
  if (firstName.found) out.firstName = firstName.value;
  const dob = readStringCandidate(candidate, ['dob', 'birthdate', 'birth_date'], { maxLength: 40 });
  if (dob.found) out.dob = dob.value;
  const sex = readSexCandidate(candidate);
  if (sex.found) out.sex = sex.value;
  if (Array.isArray(candidate.milestones)) {
    out.milestones = candidate.milestones.slice(0, 120).map((entry) => !!entry);
  }
  const context = extractContextFromCandidate(candidate);
  if (context) out.context = context;
  const growth = extractGrowthFromCandidate(candidate);
  if (growth) out.growth = growth;
  return Object.keys(out).length ? out : null;
}

function applyChildUpdateToState(state, updateRow) {
  if (!updateRow) return;
  const parsed = parseUpdateContentForPrompt(updateRow?.update_content);
  if (!parsed || typeof parsed !== 'object') return;
  const candidates = [parsed];
  const keys = ['next', 'child', 'snapshot', 'profile', 'current', 'data', 'context'];
  keys.forEach((key) => {
    const value = parsed[key];
    if (value && typeof value === 'object') candidates.push(value);
  });
  candidates.forEach((candidate) => {
    const extracted = extractChildStateFromCandidate(candidate);
    if (extracted) mergeChildStateValues(state, extracted);
  });
}

function enrichChildGrowthFromMeasurements(childData, growthData) {
  if (!childData || typeof childData !== 'object') return;
  if (!childData.growth || typeof childData.growth !== 'object') {
    childData.growth = { heightCm: null, weightKg: null, teethCount: null };
  }
  if (growthData && Array.isArray(growthData.measurements) && growthData.measurements.length) {
    const latestMeasurement = growthData.measurements.find((entry) => {
      const height = Number(entry?.height_cm ?? entry?.height);
      const weight = Number(entry?.weight_kg ?? entry?.weight);
      return Number.isFinite(height) || Number.isFinite(weight);
    });
    if (latestMeasurement) {
      const height = Number(latestMeasurement.height_cm ?? latestMeasurement.height);
      const weight = Number(latestMeasurement.weight_kg ?? latestMeasurement.weight);
      if (Number.isFinite(height)) childData.growth.heightCm = height;
      if (Number.isFinite(weight)) childData.growth.weightKg = weight;
    }
  }
  if (growthData && Array.isArray(growthData.teeth) && growthData.teeth.length) {
    const latestTeeth = growthData.teeth.find((entry) => Number.isFinite(Number(entry?.count)));
    if (latestTeeth) {
      const teethCount = Number(latestTeeth.count);
      if (Number.isFinite(teethCount)) childData.growth.teethCount = Math.max(0, Math.round(teethCount));
    }
  }
}

function labelChildFeedingType(value) {
  if (value == null) return '';
  const map = {
    'allaitement_exclusif': 'Allaitement exclusif',
    'mixte_allaitement_biberon': 'Mixte allaitement + biberon',
    'allaitement_diversification': 'Diversification + allaitement',
    'biberon_diversification': 'Biberon + diversification',
    'lait_poudre_vache': 'Lait en poudre / vache',
  };
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) return '';
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  return truncateForPrompt(key, 120);
}

function labelChildEatingStyle(value) {
  if (value == null) return '';
  const map = {
    'mange_tres_bien': 'Mange très bien',
    'appetit_variable': 'Appétit variable',
    'selectif_difficile': 'Sélectif / difficile',
    'petites_portions': 'Petites portions',
  };
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) return '';
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  return truncateForPrompt(key, 120);
}

function formatChildSleepForBaseline(sleep) {
  if (!sleep || typeof sleep !== 'object') return '';
  const parts = [];
  const falling = sanitizeChildTextValue(sleep.falling, { maxLength: 80 });
  if (falling) parts.push(`endormissement ${falling}`);
  if (typeof sleep.sleepsThrough === 'boolean') {
    parts.push(sleep.sleepsThrough ? 'fait ses nuits' : 'réveils nocturnes');
  }
  const night = sanitizeChildTextValue(sleep.nightWakings, { maxLength: 80 });
  if (night) parts.push(`réveils: ${night}`);
  const wake = sanitizeChildTextValue(sleep.wakeDuration, { maxLength: 80 });
  if (wake) parts.push(`durée éveil: ${wake}`);
  const bedtime = sanitizeChildTextValue(sleep.bedtime, { maxLength: 40 });
  if (bedtime) parts.push(`coucher ${bedtime}`);
  return parts.join(' • ');
}

function describeMilestoneSummary(milestones) {
  if (!Array.isArray(milestones) || !milestones.length) return '';
  const total = milestones.length;
  const completed = milestones.filter(Boolean).length;
  return `${completed}/${total} jalons validés`;
}

function buildChildBaselineSection({ childData }) {
  if (!childData || typeof childData !== 'object') return '';
  const lines = ['Profil enfant'];
  const identityParts = [];
  if (childData.firstName) identityParts.push(`Prénom: ${truncateForPrompt(childData.firstName, 80)}`);
  if (childData.sex) identityParts.push(`Sexe: ${truncateForPrompt(childData.sex, 40)}`);
  if (childData.dob) {
    const formattedDob = formatDateForPrompt(childData.dob) || truncateForPrompt(childData.dob, 40);
    if (formattedDob) identityParts.push(`Naissance: ${formattedDob}`);
  }
  if (identityParts.length) lines.push(identityParts.join(' • '));
  const context = childData.context || {};
  const contextParts = [];
  if (context.allergies) contextParts.push(`Allergies: ${truncateForPrompt(context.allergies, 200)}`);
  if (context.history) contextParts.push(`Antécédents: ${truncateForPrompt(context.history, 200)}`);
  if (context.care) contextParts.push(`Mode de garde: ${truncateForPrompt(context.care, 200)}`);
  if (context.languages) contextParts.push(`Langues: ${truncateForPrompt(context.languages, 200)}`);
  const feedingLabel = labelChildFeedingType(context.feedingType);
  if (feedingLabel) contextParts.push(`Alimentation: ${feedingLabel}`);
  const eatingLabel = labelChildEatingStyle(context.eatingStyle);
  if (eatingLabel) contextParts.push(`Appétit: ${eatingLabel}`);
  const sleepText = formatChildSleepForBaseline(context.sleep);
  if (sleepText) contextParts.push(`Sommeil: ${sleepText}`);
  contextParts.forEach((part) => lines.push(`- ${part}`));
  const milestoneLine = describeMilestoneSummary(childData.milestones);
  if (milestoneLine) lines.push(`Jalons: ${milestoneLine}`);
  const growth = childData.growth || {};
  const growthParts = [];
  if (Number.isFinite(growth.heightCm)) {
    growthParts.push(`taille ${formatGrowthNumber(growth.heightCm, { unit: 'cm', decimals: 1 })}`);
  }
  if (Number.isFinite(growth.weightKg)) {
    growthParts.push(`poids ${formatGrowthNumber(growth.weightKg, { unit: 'kg', decimals: 1 })}`);
  }
  if (Number.isFinite(growth.teethCount)) {
    growthParts.push(`${Math.max(0, Math.round(growth.teethCount))} dents`);
  }
  if (growthParts.length) {
    lines.push(`Mesures: ${growthParts.join(' • ')}`);
  }
  if (lines.length <= 1) return '';
  return lines.join('\n');
}

function buildReportResumeSection({ firstName, childCount, parentCount }) {
  const safeName = firstName ? firstName.trim().slice(0, 120) : '';
  const label = safeName || 'Inconnu';
  return [
    'Résumé',
    `Enfant: ${label}. Updates enfant retenues: ${childCount}, updates parent retenues: ${parentCount}.`,
  ].join('\n');
}

function buildReportGrowthSection({ growthData, hasError }) {
  const lines = ['Croissance'];
  if (hasError || !growthData) {
    lines.push('Croissance non disponible (erreur technique).');
    return lines.join('\n');
  }
  const measurements = Array.isArray(growthData.measurements)
    ? growthData.measurements.filter(Boolean).slice(0, 3)
    : [];
  const measurementLines = formatGrowthMeasurementsForPrompt(measurements).slice(0, 3);
  if (measurementLines.length) {
    measurementLines.forEach((line) => {
      lines.push(`- ${line}`);
    });
    lines.push(buildGrowthInterpretationLine(measurements));
  }
  const teethLines = buildGrowthTeethLines(growthData.teeth);
  teethLines.forEach((line) => lines.push(line));
  if (!measurementLines.length && !teethLines.length) {
    lines.push('Pas de mesure enregistrée.');
  }
  return lines.join('\n');
}

function buildReportDetailsSection({ childSummaries, parentSummaries }) {
  const lines = ['Détails'];
  lines.push('Enfant:');
  const childLines = (Array.isArray(childSummaries) ? childSummaries : [])
    .slice(0, 15)
    .map(formatChildDetailLine)
    .filter(Boolean);
  if (childLines.length) {
    lines.push(...childLines);
  } else {
    lines.push('- Aucune mise à jour enfant disponible.');
  }
  lines.push('Parent:');
  const parentLines = (Array.isArray(parentSummaries) ? parentSummaries : [])
    .slice(0, 5)
    .map(formatParentDetailLine)
    .filter(Boolean);
  if (parentLines.length) {
    lines.push(...parentLines);
  } else {
    lines.push('- Aucune mise à jour parent disponible.');
  }
  return lines.join('\n');
}

function formatChildDetailLine(summary) {
  if (!summary) return '';
  const date = summary.date ? formatDateForPrompt(summary.date) : '';
  const headerParts = [];
  if (date) headerParts.push(date);
  if (summary.type) headerParts.push(summary.type);
  const header = headerParts.length ? headerParts.join(' • ') : 'Mise à jour';
  const detailParts = [];
  if (summary.ai_summary) detailParts.push(summary.ai_summary);
  if (summary.ai_commentaire) detailParts.push(`IA: ${summary.ai_commentaire}`);
  if (!detailParts.length && summary.content) detailParts.push(summary.content);
  const body = detailParts.slice(0, 2).join(' | ');
  return body ? `- ${header}: ${body}` : `- ${header}`;
}

function formatParentDetailLine(summary) {
  if (!summary) return '';
  const date = summary.date ? formatDateForPrompt(summary.date) : '';
  const headerParts = [];
  if (date) headerParts.push(date);
  if (summary.type) headerParts.push(summary.type);
  const header = headerParts.length ? headerParts.join(' • ') : 'Mise à jour parent';
  const detailParts = [];
  if (summary.parent_comment) detailParts.push(summary.parent_comment);
  if (summary.ai_commentaire) detailParts.push(`IA: ${summary.ai_commentaire}`);
  const body = detailParts.slice(0, 2).join(' | ');
  return body ? `- ${header}: ${body}` : `- ${header}`;
}

function buildGrowthInterpretationLine(measurements = []) {
  const statuses = [];
  measurements.slice(0, 3).forEach((entry) => {
    const values = [entry?.status_global, entry?.status_height, entry?.status_weight];
    values.forEach((value) => {
      const text = sanitizeGrowthSummary(value);
      if (text) statuses.push(text.toLowerCase());
    });
  });
  if (!statuses.length) {
    return 'Analyse: données partielles, à compléter lors des prochaines mesures.';
  }
  const hasAlert = statuses.some((status) => !/normal/i.test(status));
  if (hasAlert) {
    return 'Analyse: variations à surveiller, proposer un suivi médical si besoin.';
  }
  return 'Analyse: trajectoire conforme aux repères attendus.';
}

function buildGrowthTeethLines(teethEntries = []) {
  if (!Array.isArray(teethEntries) || !teethEntries.length) return [];
  const lines = [];
  teethEntries
    .filter(Boolean)
    .slice(0, 3)
    .forEach((entry) => {
      const countNum = Number(entry?.count);
      if (!Number.isFinite(countNum)) return;
      const count = Math.max(0, Math.round(countNum));
      const monthLabel = formatMonthLabel(entry?.month);
      if (!monthLabel) return;
      lines.push(`Dents: ${count} à ${monthLabel} mois`);
    });
  return lines;
}

function formatMonthLabel(value) {
  if (value == null || value === '') return '';
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const rounded = numeric % 1 === 0 ? numeric : Number(numeric.toFixed(1));
    return String(rounded).replace(/\.0+$/, '');
  }
  return truncateForPrompt(String(value), 40);
}

function toIsoString(value) {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

async function fetchGrowthDataForPrompt({
  childId,
  measurementLimit = 3,
  teethLimit = 3,
  supaUrl,
  headers,
  profileId,
  codeUnique,
} = {}) {
  const isAnonContext = !profileId && Boolean(codeUnique);
  const logAnonFailure = (err) => {
    if (isAnonContext) {
      console.error('[ai/growth] anon fetch failed', { childId, err });
    }
  };
  if (!childId) {
    logAnonFailure('missing childId');
    return { measurements: [], teeth: [] };
  }
  let config;
  try {
    config = getServiceConfig();
  } catch (err) {
    logAnonFailure(err);
    throw err;
  }
  const effectiveUrl = typeof supaUrl === 'string' && supaUrl ? supaUrl : config.supaUrl;
  const baseHeaders = headers && typeof headers === 'object' && !Array.isArray(headers) ? { ...headers } : {};
  const serviceHeaders = { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` };
  const effectiveHeaders = { ...baseHeaders, ...serviceHeaders };
  const limitedMeasurements = Math.max(1, Math.min(3, Number(measurementLimit) || 3));
  const limitedTeeth = Math.max(1, Math.min(3, Number(teethLimit) || 3));
  try {
    const measurementUrl = `${effectiveUrl}/rest/v1/child_growth_with_status?select=agemos,height_cm,weight_kg,status_weight,status_height,status_global&child_id=eq.${encodeURIComponent(childId)}&order=agemos.desc.nullslast&limit=${limitedMeasurements}`;
    const measurementRows = await supabaseRequest(measurementUrl, { headers: effectiveHeaders });
    const measurements = (Array.isArray(measurementRows) ? measurementRows : [])
      .filter(Boolean)
      .map((row) => ({
        agemos: row?.agemos ?? null,
        height_cm: row?.height_cm ?? null,
        weight_kg: row?.weight_kg ?? null,
        status_weight: row?.status_weight ?? null,
        status_height: row?.status_height ?? null,
        status_global: row?.status_global ?? null,
      }));

    const teethUrl = `${effectiveUrl}/rest/v1/growth_teeth?select=month,count,created_at&child_id=eq.${encodeURIComponent(childId)}&order=month.desc.nullslast&limit=${limitedTeeth}`;
    const teethRows = await supabaseRequest(teethUrl, { headers: effectiveHeaders });
    const teeth = (Array.isArray(teethRows) ? teethRows : [])
      .filter(Boolean)
      .map((row) => ({
        month: row?.month ?? null,
        count: row?.count ?? null,
        created_at: row?.created_at ?? null,
      }));

    if (!measurements.length && !teeth.length) {
      logAnonFailure('empty growth dataset');
    }

    const growthData = { measurements, teeth };
    console.info('[ai/growth] raw growthData', JSON.stringify(growthData, null, 2));
    return growthData;
  } catch (err) {
    const details = err instanceof HttpError ? err.details : err?.message;
    console.error('[ai/growth] fetch failed', { childId, err, details });
    logAnonFailure(err);
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, 'Supabase growth fetch failed', details);
  }
}

function formatGrowthSectionForPrompt(growthData, { errorMessage = 'Croissance non disponible (erreur technique).' } = {}) {
  if (!growthData || typeof growthData !== 'object') {
    return errorMessage;
  }
  const measurementLines = formatGrowthMeasurementsForPrompt(growthData?.measurements).slice(0, 3);
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
  const alertSummary = buildGrowthAlertSummaryFromMeasurements(growthData?.measurements);
  if (alertSummary) {
    lines.push(`Analyse OMS: ${alertSummary}`);
  }
  if (!lines.length) {
    return 'Pas de mesure enregistrée.';
  }
  return lines.join('\n').slice(0, 600);
}

function buildGrowthAlertSummaryFromMeasurements(measurements = []) {
  if (!Array.isArray(measurements)) return '';
  for (const entry of measurements.filter(Boolean)) {
    const statusGlobal = sanitizeGrowthSummary(entry?.status_global);
    const statusHeight = sanitizeGrowthSummary(entry?.status_height);
    const statusWeight = sanitizeGrowthSummary(entry?.status_weight);
    const statuses = [statusGlobal, statusHeight, statusWeight].filter(Boolean);
    if (!statuses.length) continue;
    const hasAlert = statuses.some((status) => status && !isStatusLabelNormal(status));
    const prefix = hasAlert ? '⚠️ ' : '';
    const baseLabel = statusGlobal
      ? `Croissance: ${statusGlobal}.`
      : hasAlert
        ? 'Croissance: anomalie OMS détectée.'
        : 'Croissance: suivi OMS disponible.';
    let summary = `${prefix}${baseLabel}`;
    if (statusWeight) {
      const weightText = formatGrowthNumber(entry?.weight_kg, { unit: 'kg', decimals: 2 });
      if (weightText) summary += ` Poids: ${weightText} (${statusWeight}).`;
    }
    if (statusHeight) {
      const heightText = formatGrowthNumber(entry?.height_cm, { unit: 'cm', decimals: 1 });
      if (heightText) summary += ` Taille: ${heightText} (${statusHeight}).`;
    }
    return summary.trim();
  }
  return '';
}

function isStatusLabelNormal(status) {
  if (!status) return true;
  const normalized = String(status)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
  return normalized === 'normal' || normalized === 'normale' || normalized === 'ok';
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

function limitFamilyText(value, max = 200) {
  if (value == null) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
  }
  try {
    return limitFamilyText(String(value), max);
  } catch {
    return '';
  }
}

function formatFamilyAiBilanForPrompt(aiBilan) {
  if (!aiBilan) return '';
  const candidates = Array.isArray(aiBilan)
    ? aiBilan
    : Array.isArray(aiBilan?.children)
      ? aiBilan.children
      : [aiBilan];
  const entries = [];
  candidates
    .filter(Boolean)
    .slice(0, 5)
    .forEach((child, index) => {
      if (!child || typeof child !== 'object') return;
      const name = limitFamilyText(
        child.prenom ?? child.first_name ?? child.name ?? `Enfant ${index + 1}`,
        60
      ) || `Enfant ${index + 1}`;
      const summary = limitFamilyText(child.summary ?? child.resume ?? '', 240);
      const status = limitFamilyText(child?.growth?.status_global ?? '', 60);
      const lastUpdate = child?.last_update && typeof child.last_update === 'object'
        ? child.last_update
        : null;
      const lastSummary = limitFamilyText(
        lastUpdate?.ai_summary ?? lastUpdate?.summary ?? lastUpdate?.content ?? '',
        240
      );
      const lastDate = formatDateForPrompt(
        typeof lastUpdate?.created_at === 'string'
          ? lastUpdate.created_at
          : typeof lastUpdate?.createdAt === 'string'
            ? lastUpdate.createdAt
            : typeof lastUpdate?.date === 'string'
              ? lastUpdate.date
              : ''
      );
      const parts = [];
      parts.push(summary ? `Résumé: ${summary}` : 'Résumé: non précisé.');
      if (status) parts.push(`Statut croissance: ${status}`);
      if (lastSummary) {
        parts.push(lastDate ? `Dernière mise à jour (${lastDate}): ${lastSummary}` : `Dernière mise à jour: ${lastSummary}`);
      } else if (lastDate) {
        parts.push(`Dernière mise à jour: ${lastDate}`);
      }
      const line = `- ${name} • ${parts.join(' | ')}`;
      entries.push(limitFamilyText(line, 400));
    });

  if (!entries.length && typeof aiBilan === 'string') {
    return limitFamilyText(aiBilan, 400);
  }

  if (!entries.length) {
    try {
      return limitFamilyText(JSON.stringify(aiBilan), 400);
    } catch {
      return '';
    }
  }
  return entries.join('\n').slice(0, 1200);
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
