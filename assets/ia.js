export function formatGrowthForAI(growth) {
  if (!growth || typeof growth !== 'object') {
    return null;
  }
  const globalStatusRaw = normalizeText(growth.status_global ?? growth.statusGlobal);
  if (!globalStatusRaw || globalStatusRaw.toLowerCase() === 'normal') {
    return null;
  }
  const parts = [];
  const heightPart = formatGrowthDimension(
    'Taille',
    growth.status_height ?? growth.statusHeight,
    growth.height_diff_pct ?? growth.heightDiffPct
  );
  if (heightPart) parts.push(heightPart);
  const weightPart = formatGrowthDimension(
    'Poids',
    growth.status_weight ?? growth.statusWeight,
    growth.weight_diff_pct ?? growth.weightDiffPct
  );
  if (weightPart) parts.push(weightPart);
  if (!parts.length) {
    return 'Croissance hors norme: écarts inconnus.';
  }
  return `Croissance hors norme: ${parts.join(' / ')}.`;
}

export function buildGrowthPromptLines({ parentComment, latestGrowthData } = {}) {
  const lines = [];
  const commentText = normalizeText(parentComment);
  lines.push(`Commentaire du parent: ${commentText || 'Aucun'}`);
  const analysis = formatGrowthForAI(latestGrowthData);
  if (analysis) {
    lines.push(`Analyse OMS: ${analysis}`);
  }
  return lines;
}

function formatGrowthDimension(label, statusValue, diffValue) {
  const statusText = normalizeText(statusValue);
  const diffText = formatGrowthDiff(diffValue);
  if (!statusText && diffText === 'écart inconnu') {
    return `${label}: écart inconnu`;
  }
  if (!statusText) {
    return `${label}: ${diffText}`;
  }
  return `${label}: ${statusText} (${diffText})`;
}

function formatGrowthDiff(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 'écart inconnu';
  }
  const rounded = Math.round(num * 10) / 10;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const prefix = normalized > 0 ? '+' : '';
  return `${prefix}${normalized.toFixed(1)}%`;
}

function normalizeText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}
