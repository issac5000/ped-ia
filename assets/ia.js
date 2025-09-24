export function summarizeGrowthStatus(growth) {
  if (!growth || typeof growth !== 'object') return null;
  const statusGlobal = normalizeText(growth.status_global ?? growth.statusGlobal);
  if (!statusGlobal || statusGlobal.toLowerCase() === 'normal') return null;
  let summary = `⚠️ Croissance: ${statusGlobal}.`;

  const weightStatus = normalizeText(growth.status_weight ?? growth.statusWeight);
  const weightValueRaw = growth.weight_kg ?? growth.weightKg ?? null;
  const weightValue = Number.isFinite(Number(weightValueRaw)) ? Number(weightValueRaw) : null;
  if (weightValue != null && weightStatus) {
    summary += ` Poids: ${Number(weightValue.toFixed(2))}kg (${weightStatus}).`;
  }

  const heightStatus = normalizeText(growth.status_height ?? growth.statusHeight);
  const heightValueRaw = growth.height_cm ?? growth.heightCm ?? null;
  const heightValue = Number.isFinite(Number(heightValueRaw)) ? Number(heightValueRaw) : null;
  if (heightValue != null && heightStatus) {
    summary += ` Taille: ${Number(heightValue.toFixed(1))}cm (${heightStatus}).`;
  }

  return summary;
}

export function formatGrowthForAI(growth) {
  if (!growth || typeof growth !== 'object') {
    return null;
  }
  const summary = summarizeGrowthStatus(growth);
  if (summary) return summary.replace(/^⚠️\s*/u, '').trim();
  return null;
}

export function buildGrowthPromptLines({ parentComment, latestGrowthData } = {}) {
  const lines = [];
  const commentText = normalizeText(parentComment);
  lines.push(`Commentaire du parent: ${commentText || 'Aucun'}`);
  const analysis = summarizeGrowthStatus(latestGrowthData);
  if (analysis) {
    lines.push(`Analyse OMS: ${analysis}`);
  }
  return lines;
}

function normalizeText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}
