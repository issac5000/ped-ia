// Champs textuels susceptibles de contenir beaucoup de contexte libre côté parent
const CHILD_TEXT_FIELDS = [
  'context_allergies',
  'context_history',
  'context_care',
  'context_languages',
  'sleep_falling',
  'sleep_night_wakings',
  'sleep_wake_duration',
];

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Erreur HTTP enrichie utilisée pour faire remonter proprement les statuts Supabase
class HttpError extends Error {
  constructor(status, message, details) {
    super(message || 'Error');
    this.status = status;
    this.details = details;
  }
}

// Récupère l’URL et la clé service Supabase en validant leur présence
function getServiceConfig() {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  if (!supaUrl || !serviceKey) {
    throw new HttpError(500, 'Server misconfigured');
  }
  return { supaUrl, serviceKey };
}

// Normalise le code anonyme saisi (trim + majuscules)
function normalizeCode(raw) {
  if (!raw) return '';
  const code = String(raw).trim().toUpperCase();
  return code;
}

/**
 * Exécute une requête Supabase REST et parse la réponse JSON si disponible.
 * Lève une HttpError enrichie en cas de statut HTTP >=400 pour faciliter le debug côté client.
 */
async function supabaseRequest(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text().catch(() => '');
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch {}
  }
  if (!res.ok) {
    throw new HttpError(res.status, 'Supabase error', json ?? text);
  }
  return json;
}

function limitString(value, max = 600) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function sanitizeForPrompt(value, depth = 0) {
  if (depth > 3) return '[...]';
  if (typeof value === 'string') return value.slice(0, 400);
  if (Array.isArray(value)) {
    return value.slice(0, 10).map(entry => sanitizeForPrompt(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value).slice(0, 20);
  const out = {};
  for (const [key, val] of entries) {
    out[key] = sanitizeForPrompt(val, depth + 1);
  }
  return out;
}

function parseUpdateContent(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') {
    try { return JSON.parse(JSON.stringify(raw)); }
    catch { return { ...raw }; }
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') return parsed;
      return { summary: trimmed };
    } catch {
      return { summary: trimmed };
    }
  }
  return {};
}

function extractParentComment(updateObject) {
  if (!updateObject || typeof updateObject !== 'object') return '';
  const comment = updateObject.userComment;
  if (typeof comment !== 'string') return '';
  return limitString(comment, 600);
}

function buildUpdateText(updateType, updateObject) {
  const payload = {
    type: updateType || 'update',
    data: sanitizeForPrompt(updateObject || {})
  };
  return JSON.stringify(payload).slice(0, 4000);
}

async function fetchRecentSummaries(supaUrl, headers, childId, limit = 10) {
  try {
    const data = await supabaseRequest(
      `${supaUrl}/rest/v1/child_updates?select=ai_summary&child_id=eq.${encodeURIComponent(childId)}&ai_summary=not.is.null&order=created_at.desc&limit=${Math.max(1, Math.min(10, limit))}`,
      { headers }
    );
    const rows = Array.isArray(data) ? data : [];
    return rows
      .map(row => typeof row?.ai_summary === 'string' ? row.ai_summary.trim() : '')
      .filter(Boolean);
  } catch (err) {
    console.warn('[anon-children] failed to fetch ai_summary history', err);
    return [];
  }
}

async function fetchGrowthDataForAnonPrompt(supaUrl, headers, childId, { measurementLimit = 3, teethLimit = 3 } = {}) {
  if (!supaUrl || !headers || !childId) {
    return { measurements: [], teeth: [] };
  }
  const limitedMeasurements = Math.max(1, Math.min(6, Number.isFinite(Number(measurementLimit)) ? Number(measurementLimit) : 3));
  const limitedTeeth = Math.max(1, Math.min(6, Number.isFinite(Number(teethLimit)) ? Number(teethLimit) : 3));
  const measurementUrl = `${supaUrl}/rest/v1/growth_measurements?select=month,height_cm,weight_kg,recorded_at,created_at&child_id=eq.${encodeURIComponent(childId)}&order=month.desc&order=created_at.desc&limit=${limitedMeasurements}`;
  const teethUrl = `${supaUrl}/rest/v1/growth_teeth?select=month,count,recorded_at,created_at&child_id=eq.${encodeURIComponent(childId)}&order=month.desc&order=created_at.desc&limit=${limitedTeeth}`;
  const [measurementRows, teethRows] = await Promise.all([
    supabaseRequest(measurementUrl, { headers }).catch((err) => {
      console.warn('[anon-children] growth measurements fetch failed', err);
      return [];
    }),
    supabaseRequest(teethUrl, { headers }).catch((err) => {
      console.warn('[anon-children] growth teeth fetch failed', err);
      return [];
    }),
  ]);
  const measurements = Array.isArray(measurementRows) ? measurementRows.filter(Boolean) : [];
  const teeth = Array.isArray(teethRows) ? teethRows.filter(Boolean) : [];
  return { measurements, teeth };
}

function formatGrowthSectionForAnonPrompt(growthData) {
  const measurementLines = formatGrowthMeasurementsForPrompt(growthData?.measurements);
  const lines = [];
  if (measurementLines.length) {
    lines.push('Mesures taille/poids récentes:');
    measurementLines.forEach((line) => lines.push(`- ${line}`));
  }
  const teethLine = formatGrowthTeethForPrompt(growthData?.teeth);
  if (teethLine) {
    lines.push(`Dents: ${teethLine}`);
  }
  if (!lines.length) return '';
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
  if (heightText) parts.push(`taille ${heightText}`);
  const weightText = formatGrowthNumber(entry.weight_kg, { unit: 'kg', decimals: 2 });
  if (weightText) parts.push(`poids ${weightText}`);
  if (!parts.length) return '';
  const period = formatGrowthPeriod(entry);
  return period ? `${period}: ${parts.join(' ; ')}` : parts.join(' ; ');
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

function formatGrowthPeriod(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const month = Number(entry.month);
  if (Number.isFinite(month) && month >= 0) {
    return `mois ${month}`;
  }
  const recorded = typeof entry.recorded_at === 'string' ? entry.recorded_at : '';
  const created = typeof entry.created_at === 'string' ? entry.created_at : '';
  return formatDateForPrompt(recorded) || formatDateForPrompt(created) || '';
}

function formatGrowthNumber(value, { unit = '', decimals = 1 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '';
  const factor = 10 ** Math.max(0, Math.min(6, Math.floor(decimals)));
  const rounded = Math.round(num * factor) / factor;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded.toFixed(decimals)).replace(/\.0+$/, '');
  return unit ? `${text} ${unit}` : text;
}

function formatDateForPrompt(value) {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().split('T')[0];
}

async function callOpenAi(messages, { temperature = 0.4 } = {}) {
  if (!OPENAI_API_KEY) return '';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'gpt-4o-mini', temperature, messages })
  });
  if (!res.ok) {
    const details = await res.text().catch(() => '');
    console.warn('[anon-children] OpenAI chat error', res.status, details);
    return '';
  }
  const json = await res.json().catch(() => null);
  return json?.choices?.[0]?.message?.content?.trim() || '';
}

async function generateAiSummary(updateType, updateText, parentComment, growthSection) {
  if (!OPENAI_API_KEY || !updateText) return '';
  const system = "Tu es Ped’IA. Résume factuellement la mise à jour fournie en français, en 50 mots maximum. Bannis toute donnée extérieure et concentre-toi uniquement sur la mise à jour, le commentaire parent et les données de croissance transmises.";
  const userParts = [];
  if (updateType) userParts.push(`Type de mise à jour: ${updateType}`);
  userParts.push(`Mise à jour (JSON): ${updateText}`);
  userParts.push(`Commentaire du parent: ${parentComment || 'Aucun'}`);
  if (growthSection) {
    userParts.push(`Section Croissance:\n${growthSection}`);
  }
  const user = userParts.join('\n\n');
  return callOpenAi([
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { temperature: 0.2 });
}

async function generateAiCommentaire(updateType, updateText, parentComment, previousSummaries, latestSummary, growthSection) {
  if (!OPENAI_API_KEY) return '';
  const history = Array.isArray(previousSummaries) && previousSummaries.length
    ? previousSummaries.map((s, idx) => `${idx + 1}. ${s}`).join('\n')
    : 'Aucun historique disponible';
  const system = "Tu es Ped’IA, assistant parental bienveillant. Rédige un commentaire personnalisé (80 mots max) basé uniquement sur la nouvelle mise à jour, le commentaire parent, les données de croissance fournies et les résumés factuels. Ne réutilise jamais d’anciens commentaires IA. Sois chaleureux, concret et rassurant.";
  const parts = [];
  if (updateType) parts.push(`Type de mise à jour: ${updateType}`);
  parts.push(`Historique des résumés (du plus récent au plus ancien):\n${history}`);
  if (latestSummary) parts.push(`Résumé factuel de la nouvelle mise à jour: ${latestSummary}`);
  parts.push(`Nouvelle mise à jour détaillée (JSON): ${updateText}`);
  parts.push(`Commentaire du parent: ${parentComment || 'Aucun'}`);
  if (growthSection) {
    parts.push(`Croissance récente:\n${growthSection}`);
  }
  const user = parts.join('\n\n');
  return callOpenAi([
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { temperature: 0.35 });
}

// Normalise une chaîne en limitant sa longueur et en gérant éventuellement les valeurs nulles
function normalizeString(raw, max = 500, { allowNull = false } = {}) {
  if (raw == null) return allowNull ? null : '';
  const str = String(raw).trim();
  if (!str && allowNull) return null;
  return str.slice(0, max);
}

function normalizeSex(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw === 0 || raw === 1) return raw;
    return null;
  }
  if (typeof raw === 'string') {
    const stripped = raw.trim();
    if (!stripped) return null;
    const normalized = stripped
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (['0', 'f', 'fille', 'girl', 'femme', 'female', 'feminin'].includes(normalized)) return 0;
    if (['1', 'g', 'm', 'garcon', 'garconne', 'boy', 'masculin', 'male'].includes(normalized)) return 1;
  }
  return null;
}

function normalizeDob(raw) {
  if (raw == null) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().split('T')[0];
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return null;
    const iso = date.toISOString().split('T')[0];
    if (iso !== `${match[1]}-${match[2]}-${match[3]}`) return null;
    return iso;
  }
  return null;
}

function normalizeUuid(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return UUID_REGEX.test(trimmed) ? trimmed : '';
  }
  if (value == null) return '';
  return normalizeUuid(String(value));
}

function resolveChildId(source, { required = false } = {}) {
  const candidate = source && typeof source === 'object'
    ? source.child_id ?? source.childId ?? source.id ?? (source.child && source.child.id)
    : source;
  const normalized = normalizeUuid(candidate || '');
  if (!normalized && required) {
    throw new HttpError(400, 'child_id manquant ou invalide');
  }
  return normalized;
}

// Convertit différentes représentations (nombre, booléen, texte) en booléen strict
function normalizeBoolean(raw) {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'oui'].includes(v)) return true;
    if (['0', 'false', 'no', 'non'].includes(v)) return false;
  }
  return false;
}

// Tronque la liste des jalons pour éviter les payloads trop volumineux
function normalizeMilestones(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 120).map(v => !!v);
}

/**
 * Prépare le payload d’insertion enfant pour Supabase.
 * Tous les champs attendus sont normalisés afin d’éviter les erreurs de type.
 */
function sanitizeChildInsert(raw, profileId) {
  if (!raw || typeof raw !== 'object') raw = {};
  const payload = {
    user_id: profileId,
    first_name: normalizeString(raw.first_name ?? raw.firstName ?? '', 120),
    photo_url: normalizeString(raw.photo_url ?? raw.photoUrl ?? raw.photo ?? '', 2048, { allowNull: true }),
    feeding_type: normalizeString(raw.feeding_type ?? raw.feedingType ?? '', 120),
    eating_style: normalizeString(raw.eating_style ?? raw.eatingStyle ?? '', 120),
    sleep_sleeps_through: normalizeBoolean(raw.sleep_sleeps_through ?? raw.sleepSleepsThrough),
    sleep_bedtime: normalizeString(raw.sleep_bedtime ?? raw.sleepBedtime ?? '', 16, { allowNull: true }),
    milestones: normalizeMilestones(raw.milestones),
    is_primary: !!raw.is_primary,
  };
  const sexValue = normalizeSex(raw.sex ?? raw.gender);
  if (sexValue != null) payload.sex = sexValue;
  const dobValue = normalizeDob(raw.dob ?? raw.birthdate ?? raw.birth_date);
  if (dobValue) payload.dob = dobValue;
  CHILD_TEXT_FIELDS.forEach(key => {
    const altKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    payload[key] = normalizeString(raw[key] ?? raw[altKey] ?? '', 500);
  });
  return payload;
}

/**
 * Construit un patch partiel pour la mise à jour d’un enfant.
 * Seuls les champs explicitement fournis sont transmis à Supabase.
 */
function sanitizeChildUpdate(raw) {
  const payload = {};
  if (!raw || typeof raw !== 'object') return payload;
  if (Object.prototype.hasOwnProperty.call(raw, 'first_name') || Object.prototype.hasOwnProperty.call(raw, 'firstName')) {
    payload.first_name = normalizeString(raw.first_name ?? raw.firstName ?? '', 120);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'sex')) {
    const sexValue = normalizeSex(raw.sex);
    if (sexValue != null) payload.sex = sexValue;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'dob')) {
    const dobValue = normalizeDob(raw.dob);
    if (dobValue) payload.dob = dobValue;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'photo_url') || Object.prototype.hasOwnProperty.call(raw, 'photoUrl') || Object.prototype.hasOwnProperty.call(raw, 'photo')) {
    payload.photo_url = normalizeString(raw.photo_url ?? raw.photoUrl ?? raw.photo ?? '', 2048, { allowNull: true });
  }
  CHILD_TEXT_FIELDS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      payload[key] = normalizeString(raw[key], 500);
    } else {
      const altKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (Object.prototype.hasOwnProperty.call(raw, altKey)) {
        payload[key] = normalizeString(raw[altKey], 500);
      }
    }
  });
  if (Object.prototype.hasOwnProperty.call(raw, 'feeding_type') || Object.prototype.hasOwnProperty.call(raw, 'feedingType')) {
    payload.feeding_type = normalizeString(raw.feeding_type ?? raw.feedingType ?? '', 120);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'eating_style') || Object.prototype.hasOwnProperty.call(raw, 'eatingStyle')) {
    payload.eating_style = normalizeString(raw.eating_style ?? raw.eatingStyle ?? '', 120);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'sleep_sleeps_through') || Object.prototype.hasOwnProperty.call(raw, 'sleepSleepsThrough')) {
    payload.sleep_sleeps_through = normalizeBoolean(raw.sleep_sleeps_through ?? raw.sleepSleepsThrough);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'sleep_bedtime') || Object.prototype.hasOwnProperty.call(raw, 'sleepBedtime')) {
    payload.sleep_bedtime = normalizeString(raw.sleep_bedtime ?? raw.sleepBedtime ?? '', 16, { allowNull: true });
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'milestones')) {
    payload.milestones = normalizeMilestones(raw.milestones);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'is_primary')) {
    payload.is_primary = !!raw.is_primary;
  }
  return payload;
}

function normalizeMonth(value) {
  const month = Number(value);
  if (!Number.isInteger(month)) return null;
  return month;
}

/**
 * Agrège les mesures taille/poids par mois en fusionnant les doublons.
 * Retourne uniquement les enregistrements valides pour limiter les allers-retours réseau.
 */
function buildMeasurementRecords(input) {
  const arr = Array.isArray(input) ? input : (input ? [input] : []);
  const byMonth = new Map();
  arr.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const month = normalizeMonth(item.month);
    if (month == null) return;
    const current = byMonth.get(month) || { month };
    const hRaw = item.height_cm ?? item.height;
    const wRaw = item.weight_kg ?? item.weight;
    if (hRaw != null) {
      const h = Number(hRaw);
      if (Number.isFinite(h)) current.height_cm = h;
    }
    if (wRaw != null) {
      const w = Number(wRaw);
      if (Number.isFinite(w)) current.weight_kg = w;
    }
    byMonth.set(month, current);
  });
  const out = [];
  byMonth.forEach(entry => {
    const record = { month: entry.month };
    let valid = false;
    if (Number.isFinite(entry.height_cm)) { record.height_cm = entry.height_cm; valid = true; }
    if (Number.isFinite(entry.weight_kg)) { record.weight_kg = entry.weight_kg; valid = true; }
    if (valid) out.push(record);
  });
  return out;
}

// Transforme les entrées « dents » en enregistrements Supabase (un par mois)
function buildTeethRecords(input) {
  const arr = Array.isArray(input) ? input : (input ? [input] : []);
  const out = [];
  arr.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const month = normalizeMonth(item.month);
    if (month == null) return;
    const countRaw = item.count ?? item.teeth ?? item.value;
    const count = Number(countRaw);
    if (!Number.isFinite(count)) return;
    out.push({ month, count: Math.max(0, Math.round(count)) });
  });
  return out;
}

// Prépare les durées de sommeil mensuelles à insérer/mettre à jour
function buildSleepRecords(input) {
  const arr = Array.isArray(input) ? input : (input ? [input] : []);
  const out = [];
  arr.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const month = normalizeMonth(item.month);
    if (month == null) return;
    const hoursRaw = item.hours ?? item.value;
    const hours = Number(hoursRaw);
    if (!Number.isFinite(hours)) return;
    out.push({ month, hours });
  });
  return out;
}

// Charge un profil anonyme à partir de son code unique et refuse les comptes déjà liés à un utilisateur
async function fetchAnonProfile(supaUrl, serviceKey, code) {
  const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
  const data = await supabaseRequest(
    `${supaUrl}/rest/v1/profiles?select=id,code_unique,user_id,full_name&code_unique=eq.${encodeURIComponent(code)}&limit=1`,
    { headers }
  );
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new HttpError(404, 'Code non reconnu');
  if (row.user_id) throw new HttpError(403, 'Accès non autorisé');
  return row;
}

// Récupère un enfant précis tout en validant son appartenance au profil anonyme
async function fetchChild(supaUrl, serviceKey, childId) {
  const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
  const data = await supabaseRequest(
    `${supaUrl}/rest/v1/children?select=*&id=eq.${encodeURIComponent(childId)}&limit=1`,
    { headers }
  );
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new HttpError(404, 'Child not found');
  return row;
}

// Ajoute l’identifiant enfant à chaque enregistrement associé (mesures, sommeil, dents)
function withChildId(records, childId) {
  if (!Array.isArray(records) || !records.length) return [];
  return records.map(r => ({ ...r, child_id: childId }));
}

async function hasPrimaryChild(supaUrl, headers, profileId) {
  try {
    const data = await supabaseRequest(
      `${supaUrl}/rest/v1/children?select=id&user_id=eq.${encodeURIComponent(profileId)}&is_primary=eq.true&limit=1`,
      { headers }
    );
    if (Array.isArray(data)) return data.length > 0;
    return !!data;
  } catch (err) {
    console.warn('[anon-children] primary child lookup failed', err);
    return false;
  }
}

/**
 * Point d’entrée unique pour toutes les actions anonymes liées aux enfants.
 * Chaque action valide l’accès via le code anonyme puis appelle Supabase en conséquence.
 */
export async function processAnonChildrenRequest(body) {
  try {
    const action = String(body?.action || '').trim();
    if (!action) throw new HttpError(400, 'action required');
    const code = normalizeCode(body.code || body.code_unique);
    if (!code) throw new HttpError(400, 'code required');
    const { supaUrl, serviceKey } = getServiceConfig();
    const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
    const profile = await fetchAnonProfile(supaUrl, serviceKey, code);
    const profileId = profile.id;

    if (action === 'list') {
      const data = await supabaseRequest(
        `${supaUrl}/rest/v1/children?select=*&user_id=eq.${encodeURIComponent(profileId)}&order=created_at.asc`,
        { headers }
      );
      return { status: 200, body: { children: Array.isArray(data) ? data : [] } };
    }

    if (action === 'get') {
      const childId = resolveChildId(body, { required: true });
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Accès non autorisé');
      const [ms, sleep, teeth] = await Promise.all([
        supabaseRequest(
          `${supaUrl}/rest/v1/growth_measurements?select=month,height_cm,weight_kg,created_at&child_id=eq.${encodeURIComponent(childId)}&order=month.asc`,
          { headers }
        ),
        supabaseRequest(
          `${supaUrl}/rest/v1/growth_sleep?select=month,hours&child_id=eq.${encodeURIComponent(childId)}&order=month.asc`,
          { headers }
        ),
        supabaseRequest(
          `${supaUrl}/rest/v1/growth_teeth?select=month,count&child_id=eq.${encodeURIComponent(childId)}&order=month.asc`,
          { headers }
        ),
      ]);
      return {
        status: 200,
        body: {
          child,
          growth: {
            measurements: Array.isArray(ms) ? ms : [],
            sleep: Array.isArray(sleep) ? sleep : [],
            teeth: Array.isArray(teeth) ? teeth : [],
          }
        }
      };
    }

    if (action === 'growth-status') {
      const childId = resolveChildId(body, { required: true });
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Accès non autorisé');
      const limit = Math.max(1, Math.min(20, Number(body.limit) || 20));
      const baseUrl = `${supaUrl}/rest/v1/child_growth_with_status?select=*&child_id=eq.${encodeURIComponent(childId)}&limit=${limit}`;
      const attempts = [
        '&order=measured_at.desc.nullslast',
        '&order=recorded_at.desc.nullslast',
        '&order=created_at.desc',
        '',
      ];
      let rows = [];
      let lastError = null;
      for (const suffix of attempts) {
        try {
          const data = await supabaseRequest(`${baseUrl}${suffix}`, { headers });
          rows = Array.isArray(data) ? data : [];
          if (rows.length || suffix === '') break;
        } catch (err) {
          lastError = err;
          if (suffix === '') throw err;
        }
      }
      const bodyPayload = { rows };
      if ((!rows || rows.length === 0) && lastError instanceof HttpError && [401, 403].includes(lastError.status)) {
        bodyPayload.notice = {
          status: 'unavailable',
          message: 'Impossible de récupérer les repères OMS pour le moment. Réessayez plus tard ou contactez le support.'
        };
      }
      return { status: 200, body: bodyPayload };
    }

    if (action === 'create') {
      const childPayload = sanitizeChildInsert(body.child, profileId);
      if (!childPayload.first_name || typeof childPayload.dob !== 'string' || !Number.isInteger(childPayload.sex)) {
        throw new HttpError(400, 'Invalid child payload');
      }
      const alreadyHasPrimary = await hasPrimaryChild(supaUrl, headers, profileId);
      childPayload.is_primary = !alreadyHasPrimary;
      const inserted = await supabaseRequest(
        `${supaUrl}/rest/v1/children`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify([childPayload])
        }
      );
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      if (!row?.id) throw new HttpError(500, 'Create failed');
      const childId = row.id;
      const measurements = withChildId(buildMeasurementRecords(body.growthMeasurements), childId);
      if (measurements.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_measurements?on_conflict=child_id,month`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify(measurements)
          }
        );
      }
      const teeth = withChildId(buildTeethRecords(body.growthTeeth), childId);
      if (teeth.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_teeth`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(teeth)
          }
        );
      }
      const sleep = withChildId(buildSleepRecords(body.growthSleep), childId);
      if (sleep.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_sleep`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(sleep)
          }
        );
      }
      return { status: 200, body: { child: row } };
    }

    if (action === 'update') {
      const childId = resolveChildId(body, { required: true });
      const existing = await fetchChild(supaUrl, serviceKey, childId);
      if (existing.user_id !== profileId) throw new HttpError(403, 'Accès non autorisé');
      const updatePayload = sanitizeChildUpdate(body.child);
      let updatedRow = existing;
      if (Object.keys(updatePayload).length) {
        const updated = await supabaseRequest(
          `${supaUrl}/rest/v1/children?id=eq.${encodeURIComponent(childId)}`,
          {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            body: JSON.stringify(updatePayload)
          }
        );
        updatedRow = Array.isArray(updated) && updated[0] ? updated[0] : existing;
      }
      const measurements = withChildId(buildMeasurementRecords(body.growthMeasurements), childId);
      if (measurements.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_measurements?on_conflict=child_id,month`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify(measurements)
          }
        );
      }
      const teeth = withChildId(buildTeethRecords(body.growthTeeth), childId);
      if (teeth.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_teeth`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(teeth)
          }
        );
      }
      const sleep = withChildId(buildSleepRecords(body.growthSleep), childId);
      if (sleep.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_sleep`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(sleep)
          }
        );
      }
      return { status: 200, body: { child: updatedRow } };
    }

    if (action === 'delete') {
      const childId = resolveChildId(body, { required: true });
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Accès non autorisé');
      await supabaseRequest(
        `${supaUrl}/rest/v1/children?id=eq.${encodeURIComponent(childId)}`,
        {
          method: 'DELETE',
          headers: { ...headers, 'Prefer': 'return=representation' }
        }
      );
      return { status: 200, body: { success: true } };
    }

    if (action === 'set-primary') {
      const childId = resolveChildId(body, { required: true });
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Accès non autorisé');
      await supabaseRequest(
        `${supaUrl}/rest/v1/children?user_id=eq.${encodeURIComponent(profileId)}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_primary: false })
        }
      );
      await supabaseRequest(
        `${supaUrl}/rest/v1/children?id=eq.${encodeURIComponent(childId)}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_primary: true })
        }
      );
      return { status: 200, body: { success: true } };
    }

    if (action === 'log-update') {
      const childId = resolveChildId(body, { required: true });
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Accès non autorisé');
      const updateType = normalizeString(body.updateType ?? body.type ?? '', 64);
      const contentRaw = body.updateContent ?? body.content ?? null;
      const isEmptyObject =
        contentRaw && typeof contentRaw === 'object' && !Array.isArray(contentRaw)
          ? Object.keys(contentRaw).length === 0
          : false;
      if (
        contentRaw == null
        || (typeof contentRaw === 'string' && !contentRaw.trim())
        || isEmptyObject
      ) {
        throw new HttpError(400, 'updateContent required');
      }
      const parsedContent = parseUpdateContent(contentRaw);
      const parsedIsEmptyObject =
        parsedContent && typeof parsedContent === 'object' && !Array.isArray(parsedContent)
          ? Object.keys(parsedContent).length === 0
          : false;
      if (!parsedContent || parsedIsEmptyObject) {
        throw new HttpError(400, 'updateContent required');
      }
      const updateContent = JSON.stringify(parsedContent ?? {});
      const parentComment = extractParentComment(parsedContent);
      const updateText = buildUpdateText(updateType, parsedContent);
      let aiSummary = '';
      let aiCommentaire = '';
      if (OPENAI_API_KEY) {
        const growthData = await fetchGrowthDataForAnonPrompt(supaUrl, headers, childId, { measurementLimit: 3, teethLimit: 3 });
        const growthSection = formatGrowthSectionForAnonPrompt(growthData);
        aiSummary = await generateAiSummary(updateType, updateText, parentComment, growthSection);
        const previousSummaries = await fetchRecentSummaries(supaUrl, headers, childId, 10);
        aiCommentaire = await generateAiCommentaire(updateType, updateText, parentComment, previousSummaries, aiSummary, growthSection);
      }
      const payload = {
        child_id: childId,
        update_type: updateType || 'update',
        update_content: updateContent,
      };
      if (aiSummary) payload.ai_summary = aiSummary;
      if (aiCommentaire) payload.ai_commentaire = aiCommentaire;
      const inserted = await supabaseRequest(
        `${supaUrl}/rest/v1/child_updates`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify([payload])
        }
      );
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      return { status: 200, body: { update: row } };
    }

    if (action === 'list-updates') {
      const childId = resolveChildId(body, { required: true });
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Accès non autorisé');
      const updates = await supabaseRequest(
        `${supaUrl}/rest/v1/child_updates?select=*&child_id=eq.${encodeURIComponent(childId)}&order=created_at.desc`,
        { headers }
      );
      return { status: 200, body: { updates: Array.isArray(updates) ? updates : [] } };
    }

    if (action === 'add-growth') {
      const childId = resolveChildId(body, { required: true });
      const child = await fetchChild(supaUrl, serviceKey, childId);
      if (child.user_id !== profileId) throw new HttpError(403, 'Forbidden');
      const measurements = withChildId(buildMeasurementRecords(body.growthMeasurements ?? body.measurements), childId);
      if (measurements.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_measurements?on_conflict=child_id,month`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify(measurements)
          }
        );
      }
      const sleep = withChildId(buildSleepRecords(body.growthSleep ?? body.sleepEntries), childId);
      if (sleep.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_sleep`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(sleep)
          }
        );
      }
      const teeth = withChildId(buildTeethRecords(body.growthTeeth ?? body.teethEntries), childId);
      if (teeth.length) {
        await supabaseRequest(
          `${supaUrl}/rest/v1/growth_teeth`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(teeth)
          }
        );
      }
      return { status: 200, body: { success: true } };
    }

    throw new HttpError(400, 'Unknown action');
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status || 500, body: { error: err.message, details: err.details } };
    }
    return { status: 500, body: { error: 'Server error', details: String(err && err.message ? err.message : err) } };
  }
}

export {
  HttpError,
  buildMeasurementRecords,
  buildTeethRecords,
  buildSleepRecords,
  fetchAnonProfile,
  getServiceConfig,
  normalizeCode,
  supabaseRequest,
};
