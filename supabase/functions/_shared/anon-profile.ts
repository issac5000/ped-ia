// @ts-nocheck

const KEY_MAP = {
  fullName: 'full_name',
  avatarUrl: 'avatar_url',
  avatarURL: 'avatar_url',
  role: 'parent_role',
  parentRole: 'parent_role',
  showChildrenCount: 'show_children_count',
  numberOfChildren: 'number_of_children',
  parentalEmployment: 'parental_employment',
  parentalEmotion: 'parental_emotion',
  parentalStress: 'parental_stress',
  parentalFatigue: 'parental_fatigue',
  contextParental: 'context_parental',
};

const DISALLOWED_FIELDS = new Set([
  'id',
  'user_id',
  'code_unique',
  'code',
  'created_at',
  'updated_at',
]);

const ALLOWED_UPDATE_FIELDS = new Set([
  'full_name',
  'avatar_url',
  'parent_role',
  'show_children_count',
  'marital_status',
  'number_of_children',
  'parental_employment',
  'parental_emotion',
  'parental_stress',
  'parental_fatigue',
  'context_parental',
]);

const ALLOWED_PARENT_ROLES = new Map([
  ['maman', 'maman'],
  ['mere', 'maman'],
  ['mère', 'maman'],
  ['papa', 'papa'],
  ['pere', 'papa'],
  ['père', 'papa'],
  ['parent', 'parent'],
  ['tuteur', 'tuteur'],
  ['famille', 'famille'],
  ['autre', 'autre'],
]);

function camelToSnake(key) {
  if (!key) return key;
  if (KEY_MAP[key]) return KEY_MAP[key];
  if (!/[A-Z]/.test(key)) return key;
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function normalizeFullName(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, 120);
}

function normalizeAvatarUrl(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, 2048);
}

function normalizeParentRole(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (ALLOWED_PARENT_ROLES.has(lower)) return ALLOWED_PARENT_ROLES.get(lower);
  return lower.slice(0, 30);
}

function normalizeParentContextObject(value) {
  const ctx = {};
  const assign = (field, raw) => {
    const normalized = normalizeField(field, raw);
    if (normalized !== undefined) ctx[field] = normalized;
  };
  assign('marital_status', value?.maritalStatus ?? value?.marital_status ?? null);
  assign('number_of_children', value?.numberOfChildren ?? value?.number_of_children ?? null);
  assign('parental_employment', value?.parentalEmployment ?? value?.parental_employment ?? null);
  assign('parental_emotion', value?.parentalEmotion ?? value?.parental_emotion ?? null);
  assign('parental_stress', value?.parentalStress ?? value?.parental_stress ?? null);
  assign('parental_fatigue', value?.parentalFatigue ?? value?.parental_fatigue ?? null);
  return ctx;
}

function normalizeField(key, value) {
  if (key === 'full_name') return normalizeFullName(value);
  if (key === 'avatar_url') return normalizeAvatarUrl(value);
  if (key === 'parent_role') return normalizeParentRole(value);
  if (key === 'show_children_count') {
    if (value === null) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (['1', 'true', 'oui', 'yes'].includes(lower)) return true;
      if (['0', 'false', 'non', 'no'].includes(lower)) return false;
    }
    return undefined;
  }
  if (
    key === 'marital_status'
    || key === 'parental_employment'
    || key === 'parental_emotion'
    || key === 'parental_stress'
    || key === 'parental_fatigue'
  ) {
    if (value === null) return null;
    if (typeof value !== 'string') return undefined;
    return value.trim().slice(0, 120);
  }
  if (key === 'number_of_children') {
    if (value === null) return null;
    const parsed = parseInt(String(value).trim(), 10);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.max(0, Math.min(20, parsed));
  }
  if (key === 'context_parental') {
    if (value === null) return null;
    if (typeof value !== 'object') return undefined;
    return normalizeParentContextObject(value);
  }
  return value;
}

export function buildProfileUpdatePayload(payload = {}) {
  const update = {};
  for (const [rawKey, rawValue] of Object.entries(payload || {})) {
    const key = camelToSnake(rawKey);
    if (key === 'code_unique' || DISALLOWED_FIELDS.has(key)) continue;
    if (!ALLOWED_UPDATE_FIELDS.has(key)) continue;
    const normalizedValue = normalizeField(key, rawValue);
    if (normalizedValue === undefined) continue;
    update[key] = normalizedValue;
  }
  return update;
}

export function extractAnonCode(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const keys = ['code_unique', 'codeUnique', 'code'];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed.toUpperCase();
    }
    if (typeof value === 'number') {
      const str = String(value).trim();
      if (str) return str.toUpperCase();
    }
  }
  return '';
}

function optionalString(value, max = 600) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, max);
}

export function sanitizeParentUpdateRow(rawRow, profileId) {
  if (!rawRow || typeof rawRow !== 'object' || !profileId) return null;
  const row = {};
  row.profile_id = profileId;
  const typeRaw = rawRow.update_type ?? rawRow.updateType ?? 'parent_context';
  const updateType = optionalString(typeRaw, 120) || 'parent_context';
  row.update_type = updateType;
  let updateContent = rawRow.update_content ?? rawRow.updateContent ?? null;
  if (updateContent && typeof updateContent === 'object') {
    try {
      updateContent = JSON.stringify(updateContent);
    } catch {
      updateContent = JSON.stringify({});
    }
  }
  if (typeof updateContent === 'string') {
    const trimmed = updateContent.trim();
    if (trimmed) {
      row.update_content = trimmed.slice(0, 16000);
    }
  }
  if (!row.update_content) return null;
  const parentComment = optionalString(rawRow.parent_comment ?? rawRow.parentComment, 600);
  if (parentComment) row.parent_comment = parentComment;
  const aiComment = optionalString(
    rawRow.ai_commentaire ?? rawRow.aiCommentaire ?? rawRow.ai_comment,
    800
  );
  if (aiComment) row.ai_commentaire = aiComment;
  return row;
}

export function buildProfileResponse({ updated, existing = {}, code } = {}) {
  const current = updated && typeof updated === 'object' ? updated : {};
  const fallback = existing && typeof existing === 'object' ? existing : {};
  const profile = {
    id: current.id || fallback.id || null,
    code_unique: current.code_unique || fallback.code_unique || code || null,
    full_name: typeof current.full_name === 'string'
      ? current.full_name
      : (typeof fallback.full_name === 'string' ? fallback.full_name : ''),
    avatar_url: Object.prototype.hasOwnProperty.call(current, 'avatar_url')
      ? current.avatar_url
      : (Object.prototype.hasOwnProperty.call(fallback, 'avatar_url') ? fallback.avatar_url : null),
    parent_role: Object.prototype.hasOwnProperty.call(current, 'parent_role')
      ? current.parent_role
      : (Object.prototype.hasOwnProperty.call(fallback, 'parent_role') ? fallback.parent_role : null),
    show_children_count: Object.prototype.hasOwnProperty.call(current, 'show_children_count')
      ? current.show_children_count
      : (Object.prototype.hasOwnProperty.call(fallback, 'show_children_count')
          ? fallback.show_children_count
          : null),
    user_id: Object.prototype.hasOwnProperty.call(current, 'user_id')
      ? current.user_id
      : (Object.prototype.hasOwnProperty.call(fallback, 'user_id') ? fallback.user_id : null),
  };
  const contextFields = [
    'marital_status',
    'number_of_children',
    'parental_employment',
    'parental_emotion',
    'parental_stress',
    'parental_fatigue',
    'context_parental',
  ];
  contextFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(current, field)) {
      profile[field] = current[field];
    } else if (Object.prototype.hasOwnProperty.call(fallback, field)) {
      profile[field] = fallback[field];
    }
  });
  return profile;
}
