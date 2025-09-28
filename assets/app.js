let notifCount = 0;
const NOTIF_LAST_KEY = 'pedia_notif_last';
const NOTIF_BOOT_FLAG = 'pedia_notif_booted';
// Synap'Kids SPA — Prototype 100 % front avec localStorage + authentification Supabase (Google)
import { DEV_QUESTIONS } from './questions-dev.js';
import { ensureReactGlobals } from './react-shim.js';
import { getSupabaseClient } from './supabase-client.js';
import { createDataProxy, normalizeAnonChildPayload, normalizeChildPayloadForSupabase, assertValidChildId } from './data-proxy.js';
import { summarizeGrowthStatus } from './ia.js';

const TIMELINE_STAGES = [
  { label: 'Naissance', day: 0, subtitle: '0 j' },
  { label: '3 mois', day: 90, subtitle: '90 j' },
  { label: '6 mois', day: 180, subtitle: '180 j' },
  { label: '1 an', day: 365, subtitle: '365 j' },
  { label: '18 mois', day: 540, subtitle: '540 j' },
  { label: '2 ans', day: 730, subtitle: '730 j' },
  { label: '1000 jours', day: 1000, subtitle: '1000 j' }
];

const TIMELINE_MILESTONES = [
  { key: '0_12_smile_social', label: 'Premiers sourires', day: 45, range: '1 et 3 mois' },
  { key: '0_12_hold_head', label: 'Tient sa tête', day: 90, range: '2 et 4 mois' },
  { key: '0_12_roll_both', label: 'Se retourne seul', day: 150, range: '4 et 6 mois' },
  { key: '0_12_sit_unaided', label: 'Assis sans aide', day: 210, range: '6 et 8 mois' },
  { key: '0_12_babble', label: 'Babille activement', day: 240, range: '6 et 9 mois' },
  { key: '12_24_walk_alone', label: 'Marche seul', day: 420, range: '12 et 15 mois' },
  { key: '12_24_words_10_20', label: 'Dit 10 à 20 mots', day: 510, range: '16 et 20 mois' },
  { key: '12_24_two_word_combo', label: 'Associe 2 mots', day: 540, range: '18 et 24 mois' },
  { key: '12_24_simple_symbolic_play', label: 'Jeu symbolique', day: 580, range: '18 et 26 mois' },
  { key: '24_36_jump_two_feet', label: 'Saute à pieds joints', day: 720, range: '24 et 30 mois' },
  { key: '24_36_phrase_3_4', label: 'Phrases de 3-4 mots', day: 750, range: '26 et 32 mois' },
  { key: '24_36_start_toilet_training', label: 'Apprentissage propreté', day: 840, range: '28 et 36 mois' }
];
// import { LENGTH_FOR_AGE, WEIGHT_FOR_AGE, BMI_FOR_AGE } from '/src/data/who-curves.js';
(async () => {
  document.body.classList.remove('no-js');
  try {
    await ensureReactGlobals();
  } catch (err) {
    console.warn('Optional React globals failed to load', err);
  }
  // Forcer l’interface « menu hamburger » sur tous les formats d’écran
  try { document.body.classList.add('force-mobile'); } catch {}
  // Helpers DOM accessibles immédiatement
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const safeScrollTo = (el, options) => {
    if (!el) return;
    try {
      if (typeof el.scrollTo === 'function') {
        el.scrollTo(options);
        return;
      }
    } catch {}
    try {
      if (options && typeof options === 'object' && 'top' in options) {
        el.scrollTop = options.top;
      }
    } catch {}
  };
  const normalizeRoutePath = (input) => {
    const raw = typeof input === 'string' ? input.trim() : '';
    if (!raw) return '/';
    const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw;
    if (!withoutHash) return '/';
    const pathOnly = withoutHash.split('?')[0].split('&')[0] || '/';
    return pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  };
  const parseHashQuery = (hash) => {
    if (typeof hash !== 'string') return null;
    const idx = hash.indexOf('?');
    if (idx === -1) return null;
    const query = hash.slice(idx + 1);
    try { return new URLSearchParams(query); }
    catch { return null; }
  };
  async function withRetry(fn, { retries = 3, timeout = 3000 } = {}) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      let timerId = null;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => fn()),
          new Promise((_, reject) => {
            timerId = setTimeout(() => reject(new Error('Timeout')), timeout);
          }),
        ]);
        if (timerId != null) clearTimeout(timerId);
        return result;
      } catch (err) {
        if (timerId != null) clearTimeout(timerId);
        console.warn(`Retry ${attempt}/${retries} failed`, err);
        if (attempt === retries) throw err;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw new Error('withRetry exhausted without executing function');
  }
  let aiFocusCleanupTimer = null;
  const aiFocusMap = {
    chat: 'form-ai-chat',
    story: 'form-ai-story',
    recipes: 'form-ai-recipes',
    images: 'form-ai-image'
  };
  function clearAiFocusHighlight(){
    document.querySelectorAll('.ai-focus-highlight').forEach(node => node.classList.remove('ai-focus-highlight'));
    if (aiFocusCleanupTimer) { clearTimeout(aiFocusCleanupTimer); aiFocusCleanupTimer = null; }
  }
  function focusAIToolSection(key){
    if (!key) return;
    const targetId = aiFocusMap[key];
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (!el) return;
    const card = el.closest('.card') || el;
    clearAiFocusHighlight();
    card.classList.add('ai-focus-highlight');
    try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    aiFocusCleanupTimer = setTimeout(() => {
      card.classList.remove('ai-focus-highlight');
      aiFocusCleanupTimer = null;
    }, 1600);
  }
  const aiPageState = { currentChild: null, instance: 0 };
  function disposeAIPage(){
    aiPageState.instance += 1;
    aiPageState.currentChild = null;
    try {
      const chatInput = document.querySelector('section[data-route="/ai"] textarea[name="q"]');
      if (chatInput && chatInput._aiPlaceholderInterval) {
        clearInterval(chatInput._aiPlaceholderInterval);
        delete chatInput._aiPlaceholderInterval;
      }
    } catch {}
  }
  let pendingDashboardFocus = null;
  let dashboardFocusCleanupTimer = null;
  function maybeFocusDashboardSection(){
    if (!pendingDashboardFocus) return;
    const focusKey = pendingDashboardFocus;
    const targetId = focusKey === 'history'
      ? 'dashboard-history'
      : focusKey === 'parent-updates'
        ? 'dashboard-parent-updates'
        : '';
    if (!targetId) {
      pendingDashboardFocus = null;
      return;
    }
    const target = document.getElementById(targetId);
    if (!target) return;
    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      target.scrollIntoView();
    }
    target.classList.add('dashboard-focus-highlight');
    if (dashboardFocusCleanupTimer) {
      clearTimeout(dashboardFocusCleanupTimer);
      dashboardFocusCleanupTimer = null;
    }
    dashboardFocusCleanupTimer = setTimeout(() => {
      target.classList.remove('dashboard-focus-highlight');
      dashboardFocusCleanupTimer = null;
    }, 1800);
    pendingDashboardFocus = null;
  }
  const routeSections = new Map();
  document.querySelectorAll('section[data-route]').forEach(section => {
    const key = normalizeRoutePath(section.dataset.route || '/');
    if (!routeSections.has(key)) routeSections.set(key, section);
  });
  let activeRouteEl = document.querySelector('section.route.active') || null;
  const navLinks = new Map();
  const navLinkTargets = new Map();
  document.querySelectorAll('#main-nav .nav-link').forEach(link => {
    const href = link.getAttribute('href') || '';
    navLinks.set(href, link);
    if (href.startsWith('#')) navLinkTargets.set(href, normalizeRoutePath(href));
  });
  const navBadges = new Map();
  const navBtn = document.getElementById('nav-toggle');
  const mainNav = document.getElementById('main-nav');
  const navBackdrop = document.getElementById('nav-backdrop');
  const closeMobileNav = () => {
    if (mainNav) mainNav.classList.remove('open');
    if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
    navBackdrop?.classList.remove('open');
  };
  // Les courbes OMS utilisaient auparavant Chart.js chargé via CDN.
  // Pour éviter les erreurs de chargement (réseau ou CSP),
  // on n'utilise plus de dépendance externe ici.
  // Les graphiques sont désormais rendus en SVG via une fonction locale.
  const { LENGTH_FOR_AGE, WEIGHT_FOR_AGE, BMI_FOR_AGE } = await import('../src/data/who-curves.js').catch(e => {
    console.error('Curves import failed', e);
    return {};
  });
  if (!LENGTH_FOR_AGE) console.error('Curves import failed');
  const fallbackCurves = { 0: { P3: null, P15: null, P50: null, P85: null, P97: null } };
  const curves = {
    LENGTH_FOR_AGE: LENGTH_FOR_AGE || fallbackCurves,
    WEIGHT_FOR_AGE: WEIGHT_FOR_AGE || fallbackCurves,
    BMI_FOR_AGE: BMI_FOR_AGE || fallbackCurves,
  };

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
    del(k) { localStorage.removeItem(k); },
  };
  const growthStatusState = {
    cache: new Map(),
    pending: new Map(),
  };
  const routes = [
    "/", "/signup", "/login", "/onboarding", "/dashboard",
    "/community", "/settings", "/about", "/ai", "/contact", "/legal"
  ];
  const protectedRoutes = new Set(['/dashboard','/community','/ai','/settings','/onboarding']);
  // Clés utilisées pour le stockage local du modèle de données
  const K = {
    user: 'pedia_user',
    children: 'pedia_children',
    forum: 'pedia_forum',
    privacy: 'pedia_privacy',
    session: 'pedia_session',
    messages: 'pedia_messages',
    notifs: 'pedia_notifs'
  };
  const DEBUG_AUTH = (typeof localStorage !== 'undefined' && localStorage.getItem('debug_auth') === '1');

  // Chargement des informations Supabase et du client JS
  let supabase = null;
  let authSession = null;
  let activeProfile = null;
  let dataProxy = null;
  // Conserver la liste des canaux de notifications pour les nettoyer à la déconnexion
  let notifChannels = [];
  let anonNotifTimer = null;
  // Conserver la dernière route activée pour maîtriser les remises à zéro du scroll
  let __activePath = null;
  // Observateur d’animations de révélation (initialisé plus tard dans setupScrollAnimations)
  let revealObserver = null;
  const settingsState = {
    user: {},
    privacy: { showStats: true, allowMessages: true },
    children: [],
    childrenMap: new Map(),
    selectedChildId: null,
    snapshots: new Map(),
  };

  const dashboardState = {
    viewMode: 'child',
    profileId: null,
    family: {
      data: null,
      error: null,
      loading: false,
      lastFetchedAt: 0,
      inFlight: null,
      regenerating: false,
      pendingRefresh: false,
      regenerationPromise: null,
      needsManualRefresh: false,
    },
  };

  const PARENT_FIELD_DEFS = [
    { key: 'maritalStatus', column: 'marital_status', form: 'marital_status', type: 'string' },
    { key: 'numberOfChildren', column: 'number_of_children', form: 'number_of_children', type: 'number' },
    { key: 'parentalEmployment', column: 'parental_employment', form: 'parental_employment', type: 'string' },
    { key: 'parentalEmotion', column: 'parental_emotion', form: 'parental_emotion', type: 'string' },
    { key: 'parentalStress', column: 'parental_stress', form: 'parental_stress', type: 'string' },
    { key: 'parentalFatigue', column: 'parental_fatigue', form: 'parental_fatigue', type: 'string' },
  ];

  const PARENT_LABELS = {
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

  const PARENT_CONTEXT_TITLES = {
    full_name: 'Pseudo',
    parent_role: 'Rôle affiché',
    marital_status: 'Statut marital',
    number_of_children: 'Nombre d’enfants',
    parental_employment: 'Situation professionnelle',
    parental_emotion: 'État émotionnel',
    parental_stress: 'Niveau de stress',
    parental_fatigue: 'Niveau de fatigue',
  };

  const PARENT_UPDATE_SNAPSHOT_TYPE = 'parent_context';
  const PARENT_UPDATES_LIMIT = 12;

  const DEFAULT_PARENT_CONTEXT = Object.freeze(PARENT_FIELD_DEFS.reduce((acc, def) => {
    acc[def.key] = def.type === 'number' ? null : '';
    return acc;
  }, {}));

  function normalizeParentField(def, raw) {
    if (!def) return raw;
    if (def.type === 'number') {
      if (raw == null || raw === '') return null;
      const num = typeof raw === 'number' ? raw : parseInt(String(raw).replace(/[^0-9-]/g, ''), 10);
      if (!Number.isFinite(num)) return null;
      const clamped = Math.max(0, Math.min(20, num));
      return clamped;
    }
    if (raw == null) return '';
    const str = String(raw).trim();
    return str.slice(0, 120);
  }

  function normalizeParentContext(source = {}, fallback = {}) {
    const context = { ...DEFAULT_PARENT_CONTEXT, ...fallback };
    const rawCtx = source && typeof source === 'object' ? source : {};
    const ctxJson = rawCtx.context_parental && typeof rawCtx.context_parental === 'object'
      ? rawCtx.context_parental
      : {};
    PARENT_FIELD_DEFS.forEach((def) => {
      let value;
      if (rawCtx && Object.prototype.hasOwnProperty.call(rawCtx, def.column)) {
        value = rawCtx[def.column];
      }
      if (value == null && Object.prototype.hasOwnProperty.call(rawCtx, def.key)) {
        value = rawCtx[def.key];
      }
      if (value == null && Object.prototype.hasOwnProperty.call(ctxJson, def.column)) {
        value = ctxJson[def.column];
      }
      if (value == null && Object.prototype.hasOwnProperty.call(ctxJson, def.key)) {
        value = ctxJson[def.key];
      }
      if (value != null) {
        context[def.key] = normalizeParentField(def, value);
      }
    });
    return context;
  }

  function parentContextToDbPayload(context = {}) {
    const payload = {};
    PARENT_FIELD_DEFS.forEach((def) => {
      const value = context[def.key];
      if (def.type === 'number') {
        payload[def.column] = Number.isFinite(value) ? Math.max(0, Math.min(20, Number(value))) : null;
      } else {
        if (value == null) payload[def.column] = null;
        else {
          const str = String(value).trim();
          payload[def.column] = str ? str.slice(0, 120) : null;
        }
      }
    });
    payload.context_parental = {};
    PARENT_FIELD_DEFS.forEach((def) => {
      const value = context[def.key];
      if (def.type === 'number') {
        payload.context_parental[def.column] = Number.isFinite(value) ? Math.max(0, Math.min(20, Number(value))) : null;
      } else {
        const str = value == null ? '' : String(value).trim();
        payload.context_parental[def.column] = str ? str.slice(0, 120) : null;
      }
    });
    return payload;
  }

  function readParentContextFromForm(form) {
    if (!form) return { ...DEFAULT_PARENT_CONTEXT };
    const fd = form instanceof FormData ? form : new FormData(form);
    const context = { ...DEFAULT_PARENT_CONTEXT };
    PARENT_FIELD_DEFS.forEach((def) => {
      const raw = fd.get(def.form);
      context[def.key] = normalizeParentField(def, raw == null ? null : raw);
    });
    return context;
  }

  function diffParentContexts(prev = {}, next = {}) {
    const changes = [];
    PARENT_FIELD_DEFS.forEach((def) => {
      const prevVal = prev[def.key];
      const nextVal = next[def.key];
      const changed = def.type === 'number'
        ? (Number.isFinite(prevVal) ? prevVal : null) !== (Number.isFinite(nextVal) ? nextVal : null)
        : (prevVal || '') !== (nextVal || '');
      if (changed) {
        changes.push({ field: def.column, key: def.key, previous: prevVal, next: nextVal });
      }
    });
    return changes;
  }

  function sanitizeParentText(value, max = 120) {
    if (value == null) return null;
    const str = String(value).trim();
    if (!str) return null;
    return str.slice(0, max);
  }

  function sanitizeParentComment(value) {
    if (value == null) return '';
    const str = String(value).trim();
    if (!str) return '';
    return str.slice(0, 2000);
  }

  function sanitizeParentAiFeedback(value) {
    if (value == null) return '';
    const str = String(value).trim();
    if (!str) return '';
    return str.slice(0, 2000);
  }

  function sanitizeFamilyBilanPreview(value) {
    if (value == null) return '';
    const str = String(value).trim();
    if (!str) return '';
    return str.slice(0, 400);
  }

  function buildParentSnapshot(userInfo = {}, context = {}) {
    const pseudo = sanitizeParentText(userInfo.pseudo);
    const role = sanitizeParentText(userInfo.role);
    const payload = parentContextToDbPayload(context || {});
    const contextValues = payload?.context_parental && typeof payload.context_parental === 'object'
      ? payload.context_parental
      : {};
    return {
      pseudo,
      parent_role: role,
      context: contextValues,
    };
  }

  function buildParentChangeDetails(changes = [], previousSnapshot, nextSnapshot) {
    if (!Array.isArray(changes) || !changes.length) return [];
    return changes
      .map((change) => {
        if (!change || !change.field) return null;
        const field = String(change.field);
        let previous = null;
        let next = null;
        if (field === 'full_name') {
          previous = previousSnapshot?.pseudo ?? null;
          next = nextSnapshot?.pseudo ?? null;
        } else if (field === 'parent_role') {
          previous = previousSnapshot?.parent_role ?? null;
          next = nextSnapshot?.parent_role ?? null;
        } else {
          previous = previousSnapshot?.context?.[field] ?? null;
          next = nextSnapshot?.context?.[field] ?? null;
        }
        return {
          field,
          previous,
          next,
        };
      })
      .filter(Boolean);
  }

  function buildParentSnapshotSummary(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return '';
    const context = snapshot.context && typeof snapshot.context === 'object'
      ? snapshot.context
      : {};
    const summaryKeys = [
      'parental_emotion',
      'parental_stress',
      'parental_fatigue',
      'parental_employment',
      'marital_status',
      'number_of_children',
    ];
    const parts = [];
    summaryKeys.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(context, key)) return;
      const formatted = formatParentContextValue(key, context[key]);
      if (formatted && formatted !== '—') {
        const label = PARENT_CONTEXT_TITLES[key] || key.replace(/_/g, ' ');
        parts.push(`${label}: ${formatted}`);
      }
    });
    let text = parts.join(' • ');
    text = text || '(Pas encore de bilan généré)';
    return text.slice(0, 400);
  }

  function buildParentContextSnapshotInsert({
    profileId,
    previousUser = {},
    previousContext = {},
    nextUser = {},
    nextContext = {},
    changes = [],
    comment = '',
  } = {}) {
    if (!profileId) return null;
    const sanitizedComment = sanitizeParentComment(comment);
    const previousSnapshot = buildParentSnapshot(previousUser, previousContext);
    const nextSnapshot = buildParentSnapshot(nextUser, nextContext);
    const changeDetails = buildParentChangeDetails(changes, previousSnapshot, nextSnapshot);
    const hasChanges = changeDetails.length > 0;
    if (!hasChanges && !sanitizedComment) return null;
    const summary = buildParentSnapshotSummary(nextSnapshot);
    const payload = {
      snapshot: nextSnapshot,
      source: 'parent',
    };
    if (summary) payload.summary = summary;
    if (hasChanges) payload.changes = changeDetails;
    if (hasChanges) payload.previous_snapshot = previousSnapshot;
    if (sanitizedComment) payload.comment_origin = 'parent';
    const row = {
      profile_id: profileId,
      update_type: PARENT_UPDATE_SNAPSHOT_TYPE,
      update_content: JSON.stringify(payload),
    };
    if (sanitizedComment) row.parent_comment = sanitizedComment;
    return {
      row,
      sanitizedComment,
      updateContent: payload,
    };
  }

  function formatParentContextValue(column, value) {
    if (column === 'number_of_children') {
      if (!Number.isFinite(value)) return '—';
      const n = Number(value);
      return `${n} enfant${n > 1 ? 's' : ''}`;
    }
    const labels = PARENT_LABELS[column];
    if (labels) {
      const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (key && Object.prototype.hasOwnProperty.call(labels, key)) return labels[key];
    }
    if (value == null) return '—';
    const str = String(value).trim();
    return str || '—';
  }

  function getEffectiveParentContext() {
    const merged = { ...DEFAULT_PARENT_CONTEXT };
    const apply = (ctx) => {
      if (!ctx) return;
      PARENT_FIELD_DEFS.forEach((def) => {
        const value = ctx[def.key];
        if (def.type === 'number') {
          if (Number.isFinite(value)) merged[def.key] = Number(value);
        } else if (value != null) {
          const str = String(value).trim();
          if (str) merged[def.key] = str;
        }
      });
    };
    try {
      apply(normalizeParentContext(store.get(K.user) || {}));
    } catch {}
    if (activeProfile) {
      apply(normalizeParentContext({
        ...activeProfile,
        context_parental: activeProfile.context_parental,
      }));
    }
    apply(normalizeParentContext(settingsState.user || {}));
    return merged;
  }

  function buildParentContextForPrompt() {
    const ctx = getEffectiveParentContext();
    const storedUser = (() => {
      try { return store.get(K.user) || {}; } catch { return {}; }
    })();
    const role = (settingsState.user?.role || activeProfile?.parent_role || storedUser.role || '').toString().trim();
    const pseudo = (settingsState.user?.pseudo || activeProfile?.full_name || storedUser.pseudo || '').toString().trim();
    return {
      pseudo,
      role,
      maritalStatus: ctx.maritalStatus || '',
      numberOfChildren: Number.isFinite(ctx.numberOfChildren) ? Number(ctx.numberOfChildren) : null,
      parentalEmployment: ctx.parentalEmployment || '',
      parentalEmotion: ctx.parentalEmotion || '',
      parentalStress: ctx.parentalStress || '',
      parentalFatigue: ctx.parentalFatigue || '',
    };
  }

  async function generateParentUpdateAiComment({ updateType, updateContent, parentComment }) {
    const payload = {
      type: 'parent-update',
      updateType: typeof updateType === 'string' ? updateType : String(updateType || ''),
      updateContent,
      parentComment,
      parentContext: buildParentContextForPrompt(),
    };
    const profileId = getActiveProfileId();
    if (profileId) {
      const normalizedProfileId = String(profileId).trim();
      if (normalizedProfileId) {
        payload.profileId = normalizedProfileId;
      }
    }
    const codeUnique = activeProfile?.code_unique
      ? String(activeProfile.code_unique).trim().toUpperCase()
      : '';
    if (codeUnique) {
      payload.code_unique = codeUnique;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timeoutId = null;
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
    if (controller) {
      options.signal = controller.signal;
      timeoutId = setTimeout(() => {
        try { controller.abort(); }
        catch {}
      }, 20000);
    }

    try {
      const res = await fetch('/api/ai', options);
      let data = null;
      try {
        data = await res.json();
      } catch {}
      if (!res.ok) {
        const message = data?.error || 'AI error';
        throw new Error(message);
      }
      if (data?.status === 'unavailable') {
        throw new Error(data?.message || 'IA indisponible');
      }
      const comment = sanitizeParentAiFeedback(data?.comment ?? data?.text ?? '');
      const usedAiBilan = Boolean(data?.used_ai_bilan);
      const familyBilanPreview = sanitizeFamilyBilanPreview(data?.familyBilanPreview);
      return { comment, usedAiBilan, familyBilanPreview };
    } catch (err) {
      console.warn('generateParentUpdateAiComment request failed', err);
      throw err;
    } finally {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
    }
  }

  const SETTINGS_REMOTE_CACHE_TTL = 15000;
  let settingsRemoteCache = null;
  let settingsRemoteCacheAt = 0;
  let settingsRemoteInFlight = null;
  let settingsRemoteCacheToken = 0;

  function invalidateSettingsRemoteCache() {
    settingsRemoteCache = null;
    settingsRemoteCacheAt = 0;
    settingsRemoteInFlight = null;
    settingsRemoteCacheToken += 1;
  }

  function cloneChildForSettings(child) {
    if (!child) return null;
    const context = child.context || {};
    const sleep = context.sleep || {};
    return {
      ...child,
      context: {
        ...context,
        sleep: {
          ...sleep,
        },
      },
      milestones: Array.isArray(child.milestones) ? child.milestones.slice() : [],
      growth: {
        measurements: Array.isArray(child.growth?.measurements)
          ? child.growth.measurements.map((m) => ({ ...m }))
          : [],
        sleep: Array.isArray(child.growth?.sleep)
          ? child.growth.sleep.map((s) => ({ ...s }))
          : [],
        teeth: Array.isArray(child.growth?.teeth)
          ? child.growth.teeth.map((t) => ({ ...t }))
          : [],
      },
    };
  }

  function cloneSettingsSnapshot(snapshot = {}) {
    return {
      user: { ...(snapshot.user || {}) },
      privacy: { ...(snapshot.privacy || {}) },
      children: Array.isArray(snapshot.children)
        ? snapshot.children.map((child) => cloneChildForSettings(child)).filter(Boolean)
        : [],
      primaryId: snapshot.primaryId ?? null,
    };
  }

  async function loadRemoteSettingsSnapshot(baseSnapshot) {
    const remoteReady = useRemote();
    if (!remoteReady) return cloneSettingsSnapshot(baseSnapshot);
    const now = Date.now();
    if (settingsRemoteCache && now - settingsRemoteCacheAt < SETTINGS_REMOTE_CACHE_TTL) {
      return cloneSettingsSnapshot(settingsRemoteCache);
    }
    if (settingsRemoteInFlight) {
      try {
        const cached = await settingsRemoteInFlight;
        return cloneSettingsSnapshot(cached);
      } catch (err) {
        settingsRemoteInFlight = null;
        throw err;
      }
    }
    const token = settingsRemoteCacheToken;
    const fetchPromise = (async () => {
      const working = cloneSettingsSnapshot(baseSnapshot);
      try {
        if (isAnonProfile()) {
          const childAccess = dataProxy.children();
          const res = await withRetry(() => childAccess.callAnon('list', {}));
          const rows = Array.isArray(res.children) ? res.children : [];
          working.children = rows
            .map((row) => {
              const mapped = mapRowToChild(row);
              if (!mapped) return null;
              mapped.isPrimary = !!row.is_primary;
              return mapped;
            })
            .filter(Boolean);
          const primaryRow = rows.find((row) => row && row.is_primary);
          if (primaryRow?.id != null) working.primaryId = primaryRow.id;
          try {
            const parentAccess = dataProxy.parentUpdates();
            const profileRes = await withRetry(() => parentAccess.callAnon('profile', {}));
            const profileRow = profileRes?.profile || null;
            if (profileRow) {
              const pseudo = profileRow.full_name || working.user.pseudo || '';
              const parentContext = normalizeParentContext(profileRow, working.user);
              working.user = {
                ...working.user,
                pseudo,
                role: profileRow.parent_role || working.user.role || 'maman',
                ...parentContext,
              };
              working.privacy = {
                ...working.privacy,
                showStats:
                  profileRow.show_children_count != null
                    ? !!profileRow.show_children_count
                    : working.privacy.showStats,
              };
              const nextProfile = { ...(activeProfile || {}), id: profileRow.id || activeProfile?.id };
              if (Object.prototype.hasOwnProperty.call(profileRow, 'full_name')) {
                nextProfile.full_name = profileRow.full_name || pseudo;
              } else {
                nextProfile.full_name = pseudo;
              }
              if (Object.prototype.hasOwnProperty.call(profileRow, 'parent_role')) {
                nextProfile.parent_role = profileRow.parent_role;
              }
              if (Object.prototype.hasOwnProperty.call(profileRow, 'show_children_count')) {
                nextProfile.show_children_count = profileRow.show_children_count;
              }
              if (Object.prototype.hasOwnProperty.call(profileRow, 'code_unique')) {
                nextProfile.code_unique = profileRow.code_unique;
              }
              PARENT_FIELD_DEFS.forEach((def) => {
                if (Object.prototype.hasOwnProperty.call(profileRow, def.column)) {
                  nextProfile[def.column] = profileRow[def.column];
                }
              });
              if (Object.prototype.hasOwnProperty.call(profileRow, 'context_parental')) {
                nextProfile.context_parental = profileRow.context_parental;
              }
              nextProfile.isAnonymous = true;
              setActiveProfile(nextProfile);
            }
          } catch (anonProfileErr) {
            console.warn('anonParentRequest profile failed', anonProfileErr);
          }
        } else {
          const uid = getActiveProfileId();
          if (uid) {
            const [profileRes, childrenRes] = await withRetry(() => Promise.all([
              supabase
                .from('profiles')
                .select('id,full_name,avatar_url,parent_role,code_unique,show_children_count,marital_status,number_of_children,parental_employment,parental_emotion,parental_stress,parental_fatigue,context_parental')
                .eq('id', uid)
                .maybeSingle(),
              supabase
                .from('children')
                .select('*')
                .eq('user_id', uid)
                .order('created_at', { ascending: true }),
            ]));
            if (!profileRes.error && profileRes.data) {
              const profileRow = profileRes.data;
              const pseudo = profileRow.full_name || working.user.pseudo || '';
              const parentContext = normalizeParentContext(profileRow, working.user);
              working.user = {
                ...working.user,
                pseudo,
                role: profileRow.parent_role || working.user.role || 'maman',
                ...parentContext,
              };
              working.privacy = {
                ...working.privacy,
                showStats:
                  profileRow.show_children_count != null
                    ? !!profileRow.show_children_count
                    : working.privacy.showStats,
              };
              if (profileRow.id) {
                const nextProfile = { ...(activeProfile || {}), id: profileRow.id, full_name: pseudo };
                if (Object.prototype.hasOwnProperty.call(profileRow, 'code_unique')) {
                  nextProfile.code_unique = profileRow.code_unique;
                }
                if (Object.prototype.hasOwnProperty.call(profileRow, 'avatar_url')) {
                  nextProfile.avatar_url = profileRow.avatar_url;
                }
                if (Object.prototype.hasOwnProperty.call(profileRow, 'parent_role')) {
                  nextProfile.parent_role = profileRow.parent_role;
                }
                if (Object.prototype.hasOwnProperty.call(profileRow, 'show_children_count')) {
                  nextProfile.show_children_count = profileRow.show_children_count;
                }
                PARENT_FIELD_DEFS.forEach((def) => {
                  if (Object.prototype.hasOwnProperty.call(profileRow, def.column)) {
                    nextProfile[def.column] = profileRow[def.column];
                  }
                });
                nextProfile.context_parental = parentContextToDbPayload(parentContext).context_parental;
                setActiveProfile(nextProfile);
              }
            }
            if (!childrenRes.error && Array.isArray(childrenRes.data)) {
              const childRows = childrenRes.data;
              working.children = childRows
                .map((row) => {
                  const mapped = mapRowToChild(row);
                  if (!mapped) return null;
                  mapped.isPrimary = !!row.is_primary;
                  return mapped;
                })
                .filter(Boolean);
              const primaryRow = childRows.find((row) => row && row.is_primary);
              if (primaryRow?.id != null) working.primaryId = primaryRow.id;
            }
          }
        }
      } catch (err) {
        console.warn('loadRemoteSettingsSnapshot failed', err);
      }
      return working;
    })();
    settingsRemoteInFlight = fetchPromise;
    try {
      const resolved = await fetchPromise;
      if (settingsRemoteCacheToken === token) {
        settingsRemoteCache = cloneSettingsSnapshot(resolved);
        settingsRemoteCacheAt = Date.now();
      }
      return cloneSettingsSnapshot(resolved);
    } finally {
      if (settingsRemoteInFlight === fetchPromise) {
        settingsRemoteInFlight = null;
      }
    }
  }

  async function applySettingsSnapshot(snapshot, options = {}) {
    const {
      rid,
      skipRemoteChild = false,
      updateStore = true,
    } = options;
    const form = $('#form-settings');
    const list = $('#children-list');
    if (!form || !list) return;

    const normalizedUser = {
      role: 'maman',
      ...DEFAULT_PARENT_CONTEXT,
      ...(snapshot.user || {}),
    };
    if (!normalizedUser.role) normalizedUser.role = 'maman';
    const normalizedPrivacy = {
      showStats:
        snapshot.privacy?.showStats != null
          ? !!snapshot.privacy.showStats
          : true,
      allowMessages:
        snapshot.privacy?.allowMessages != null
          ? !!snapshot.privacy.allowMessages
          : true,
    };
    const children = Array.isArray(snapshot.children)
      ? snapshot.children.map((child) => cloneChildForSettings(child)).filter(Boolean)
      : [];

    const childIdSet = new Set(children.map((child) => String(child.id)));
    let primaryId = snapshot.primaryId != null ? snapshot.primaryId : normalizedUser.primaryChildId ?? null;
    if (primaryId != null && !childIdSet.has(String(primaryId))) {
      primaryId = null;
    }
    if (primaryId == null && children.length) {
      primaryId = children[0].id;
    }

    const previousSelectedStr = settingsState.selectedChildId != null
      ? String(settingsState.selectedChildId)
      : null;
    const fallbackSelected = primaryId != null
      ? String(primaryId)
      : (children[0]?.id != null ? String(children[0].id) : null);
    const selectedId = previousSelectedStr && childIdSet.has(previousSelectedStr)
      ? previousSelectedStr
      : fallbackSelected;

    const userForStore = { ...normalizedUser, primaryChildId: primaryId ?? null };

    if (updateStore) {
      store.set(K.user, userForStore);
      store.set(K.privacy, normalizedPrivacy);
      store.set(K.children, children);
    }

    settingsState.user = userForStore;
    settingsState.privacy = normalizedPrivacy;
    settingsState.children = children;
    settingsState.childrenMap = new Map(children.map((child) => [String(child.id), child]));
    settingsState.snapshots = new Map();
    settingsState.selectedChildId = selectedId || null;

    const pseudoInput = form.elements.namedItem('pseudo');
    if (pseudoInput) pseudoInput.value = userForStore.pseudo || '';
    const roleSelect = form.elements.namedItem('role');
    if (roleSelect) roleSelect.value = userForStore.role || 'maman';

    PARENT_FIELD_DEFS.forEach((def) => {
      const control = form.elements.namedItem(def.form);
      if (!control) return;
      const value = userForStore[def.key];
      if (def.type === 'number') {
        control.value = Number.isFinite(value) ? String(value) : '';
      } else {
        control.value = value || '';
      }
    });

    const showStatsInput = form.elements.namedItem('showStats');
    if (showStatsInput) {
      showStatsInput.checked = !!normalizedPrivacy.showStats;
      if (!showStatsInput.dataset.boundShowChildren) {
        showStatsInput.addEventListener('change', handleShowChildrenCountToggle);
        showStatsInput.dataset.boundShowChildren = '1';
      }
    }
    const allowMessagesInput = form.elements.namedItem('allowMessages');
    if (allowMessagesInput) allowMessagesInput.checked = !!normalizedPrivacy.allowMessages;

    if (!form.dataset.bound) {
      form.addEventListener('submit', handleSettingsSubmit);
      form.dataset.bound = '1';
    }

    renderSettingsChildrenList(children, primaryId);

    if (!list.dataset.bound) {
      list.addEventListener('click', handleSettingsListClick);
      list.dataset.bound = '1';
    }

    await renderChildEditor(settingsState.selectedChildId, rid, { skipRemote: skipRemoteChild });
  }

  const getActiveProfileId = () => activeProfile?.id || null;
  const isProfileLoggedIn = () => !!getActiveProfileId();
  // ✅ Fix: useRemote défini dès le départ
  const useRemote = () => !!supabase && isProfileLoggedIn();
  const isAnonProfile = () => {
    if (dataProxy && typeof dataProxy.isAnon === 'function') {
      try { return dataProxy.isAnon(); }
      catch { /* fallback */ }
    }
    return !!activeProfile?.isAnonymous && !!activeProfile?.code_unique;
  };

  restoreAnonSession();

  async function anonChildRequest(action, payload = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const code = (activeProfile.code_unique || '').toString().trim().toUpperCase();
    if (!code) throw new Error('Code unique manquant');
    let normalizedPayload = payload;
    try {
      normalizedPayload = normalizeAnonChildPayload(action, payload);
    } catch (err) {
      throw err;
    }
    const body = { action, code, ...normalizedPayload };
    if (typeof body.code === 'string') {
      body.code = body.code.trim().toUpperCase();
    }
    if (!body.code) {
      console.warn('Anon request without code:', body);
    }
    const response = await fetch('/api/anon/children', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text().catch(() => '');
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch {}
    }
    if (!response.ok) {
      console.error('Anon response:', response.status, text);
      const err = new Error(json?.error || 'Service indisponible');
      if (json?.details) err.details = json.details;
      throw err;
    }
    return json || {};
  }

  async function anonParentRequest(action, payload = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const code = (activeProfile.code_unique || '').toString().trim().toUpperCase();
    if (!code) throw new Error('Code unique manquant');
    const body = { action, code, ...payload };
    if (typeof body.code === 'string') {
      body.code = body.code.trim().toUpperCase();
    }
    if (!body.code) {
      console.warn('Anon request without code:', body);
    }
    const response = await fetch('/api/anon/parent-updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text().catch(() => '');
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch {}
    }
    if (!response.ok) {
      console.error('Anon response:', response.status, text);
      const err = new Error(json?.error || 'Service indisponible');
      if (json?.details) err.details = json.details;
      throw err;
    }
    return json || {};
  }

  async function anonFamilyRequest(action, payload = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const code = (activeProfile.code_unique || '').toString().trim().toUpperCase();
    if (!code) throw new Error('Code unique manquant');
    const body = { action, code, ...payload };
    if (typeof body.code === 'string') {
      body.code = body.code.trim().toUpperCase();
    }
    if (!body.code) {
      console.warn('Anon request without code:', body);
    }
    const response = await fetch('/api/anon/family', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text().catch(() => '');
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch {}
    }
    if (!response.ok) {
      console.error('Anon response:', response.status, text);
      const err = new Error(json?.error || 'Service indisponible');
      if (json?.details) err.details = json.details;
      throw err;
    }
    return json || {};
  }

  async function anonMessagesRequest(code_unique, { since = null } = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const code = typeof code_unique === 'string' ? code_unique.trim().toUpperCase() : '';
    if (!code) return { messages: [], senders: {} };
    try {
      const body = { action: 'recent-activity', code };
      if (since) body.since = since;
      const response = await fetch('/api/anon/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text().catch(() => '');
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const err = new Error(payload?.error || 'Service indisponible');
        if (payload?.details) err.details = payload.details;
        throw err;
      }
      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      const senders = payload?.senders && typeof payload.senders === 'object' ? payload.senders : {};
      return { messages, senders };
    } catch (err) {
      console.error('anonMessagesRequest failed', err);
      return { messages: [], senders: {} };
    }
  }

  async function anonCommunityRequest(action, payload = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const code = (activeProfile.code_unique || '').toString().trim().toUpperCase();
    if (!code) throw new Error('Code unique manquant');
    const body = { action, code, ...payload };
    if (typeof body.code === 'string') {
      body.code = body.code.trim().toUpperCase();
    }
    if (!body.code) {
      console.warn('Anon request without code:', body);
    }
    const response = await fetch('/api/anon/community', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text().catch(() => '');
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch {}
    }
    if (!response.ok) {
      console.error('Anon response:', response.status, text);
      const err = new Error(json?.error || 'Service indisponible');
      if (json?.details) err.details = json.details;
      throw err;
    }
    return json || {};
  }

  anonChildRequest.__anonEndpoint = '/api/anon/children';
  anonChildRequest.__expectsCode = true;
  anonChildRequest.__normalizePayload = normalizeAnonChildPayload;
  anonParentRequest.__anonEndpoint = '/api/anon/parent-updates';
  anonParentRequest.__expectsCode = true;
  anonFamilyRequest.__anonEndpoint = '/api/anon/family';
  anonFamilyRequest.__expectsCode = true;

  dataProxy = createDataProxy({
    getActiveProfile: () => activeProfile,
    ensureSupabaseClient,
    getSupabaseClient: () => supabase,
    anonChildrenRequest: (action, payload) => anonChildRequest(action, payload),
    anonParentRequest: (action, payload) => anonParentRequest(action, payload),
    anonFamilyRequest: (action, payload) => anonFamilyRequest(action, payload),
  });

  async function fetchAnonProfileByCode(rawCode) {
    const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
    if (!code) throw new Error('Code unique manquant');
    const response = await fetch('/api/anon/parent-updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'profile', code })
    });
    const text = await response.text().catch(() => '');
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = null; }
    }
    if (!response.ok) {
      const err = new Error(payload?.error || 'Connexion impossible pour le moment.');
      if (payload?.details) err.details = payload.details;
      throw err;
    }
    const profile = payload?.profile || null;
    if (!profile || !profile.id) {
      throw new Error('Profil introuvable pour ce code.');
    }
    return profile;
  }

  function buildMeasurementPayloads(entries) {
    const arr = Array.isArray(entries) ? entries : (entries ? [entries] : []);
    const byMonth = new Map();
    arr.forEach(item => {
      if (!item) return;
      const month = Number(item.month);
      if (!Number.isInteger(month)) return;
      const current = byMonth.get(month) || { month };
      if (item.height != null || item.height_cm != null) {
        const h = Number(item.height_cm ?? item.height);
        if (Number.isFinite(h)) current.height_cm = h;
      }
      if (item.weight != null || item.weight_kg != null) {
        const w = Number(item.weight_kg ?? item.weight);
        if (Number.isFinite(w)) current.weight_kg = w;
      }
      byMonth.set(month, current);
    });
    const out = [];
    byMonth.forEach(entry => {
      const rec = { month: entry.month };
      let valid = false;
      if (Number.isFinite(entry.height_cm)) { rec.height_cm = entry.height_cm; valid = true; }
      if (Number.isFinite(entry.weight_kg)) { rec.weight_kg = entry.weight_kg; valid = true; }
      if (valid) out.push(rec);
    });
    return out;
  }

  function buildTeethPayloads(entries) {
    const arr = Array.isArray(entries) ? entries : (entries ? [entries] : []);
    const out = [];
    arr.forEach(item => {
      if (!item) return;
      const month = Number(item.month);
      if (!Number.isInteger(month)) return;
      const countRaw = item.count ?? item.teeth ?? item.value;
      const count = Number(countRaw);
      if (!Number.isFinite(count)) return;
      out.push({ month, count: Math.max(0, Math.round(count)) });
    });
    return out;
  }

  function buildSleepPayloads(entries) {
    const arr = Array.isArray(entries) ? entries : (entries ? [entries] : []);
    const out = [];
    arr.forEach(item => {
      if (!item) return;
      const month = Number(item.month);
      if (!Number.isInteger(month)) return;
      const hoursRaw = item.hours ?? item.value;
      const hours = Number(hoursRaw);
      if (!Number.isFinite(hours)) return;
      out.push({ month, hours });
    });
    return out;
  }

  function mapRowToChild(row) {
    if (!row || !row.id) return null;
    return {
      id: row.id,
      firstName: row.first_name,
      sex: row.sex,
      dob: row.dob,
      photo: row.photo_url,
      context: {
        allergies: row.context_allergies,
        history: row.context_history,
        care: row.context_care,
        languages: row.context_languages,
        feedingType: row.feeding_type,
        eatingStyle: row.eating_style,
        sleep: {
          falling: row.sleep_falling,
          sleepsThrough: row.sleep_sleeps_through,
          nightWakings: row.sleep_night_wakings,
          wakeDuration: row.sleep_wake_duration,
          bedtime: row.sleep_bedtime,
        },
      },
      milestones: Array.isArray(row.milestones) ? row.milestones : [],
      growth: { measurements: [], sleep: [], teeth: [] }
    };
  }

  try {
    supabase = await getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    // Cas robuste : si Google renvoie ?code dans l’URL, on échange immédiatement contre une session
    try {
      const urlNow = new URL(window.location.href);
      if (urlNow.searchParams.get('code')) {
        // Supabase veut l’URL sans hash (#/dashboard), donc on nettoie
        const cleanUrl = window.location.origin + urlNow.pathname + urlNow.search;
        const { error: xErr } = await supabase.auth.exchangeCodeForSession(cleanUrl);
        if (xErr) {
          console.warn('exchangeCodeForSession error', xErr);
        }
        // On enlève juste le ?code de l’URL, mais on garde le hash
        urlNow.search = '';
        history.replaceState({}, '', urlNow.toString());
      }
    } catch (e) {
      console.warn('exchangeCodeForSession failed', e);
    }

    // Vérifier si un utilisateur est déjà connecté après redirection OAuth
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      authSession = { user };
      await ensureProfile(user);
      await syncUserFromSupabase();
      updateHeaderAuth();
      // Si l'utilisateur est déjà connecté et qu'aucun hash n'est fourni ou qu'on se trouve sur
      // les pages de connexion/inscription, on redirige vers le dashboard. Sinon, on reste sur la
      // page actuelle (ex: rafraîchissement sur l'accueil doit rester sur l'accueil).
      if (!location.hash || location.hash === '#' || location.hash === '#/login' || location.hash === '#/signup') {
        location.hash = '#/dashboard';
      } else {
        setActiveRoute(location.hash);
      }
    }

    // Récupérer la session en cours (utile si pas d'user direct)
    const { data: { session } } = await supabase.auth.getSession();
    authSession = session || authSession;
    if (authSession?.user && !isProfileLoggedIn()) {
      await ensureProfile(authSession.user);
      await syncUserFromSupabase();
    }
    if (isProfileLoggedIn() && (location.hash === '' || location.hash === '#' || location.hash === '#/login' || location.hash === '#/signup')) {
      location.hash = '#/dashboard';
    }
    supabase.auth.onAuthStateChange(async (_event, session) => {
      authSession = session || null;
      if (session?.user) {
        await ensureProfile(session.user);
        await syncUserFromSupabase();
      } else {
        if (!isAnonProfile()) {
          setActiveProfile(null);
        }
      }
      updateHeaderAuth();
      if (isProfileLoggedIn() && (location.hash === '' || location.hash === '#' || location.hash === '#/login' || location.hash === '#/signup')) {
        location.hash = '#/dashboard';
      } else {
        setActiveRoute(location.hash);
      }
      // Ré-attache les notifications temps réel à chaque changement d’authentification
      if (authSession?.user) {
        setupRealtimeNotifications();
        updateBadgeFromStore();
        // Récupère systématiquement les notifications manquées après connexion (lacunes possibles après OAuth)
        fetchMissedNotifications();
        // Ne rejoue les toasts qu’une seule fois par session
        if (!hasBootedNotifs()) { replayUnseenNotifs(); markBootedNotifs(); }
      } else {
        // Nettoie les canaux lors de la déconnexion
        try { for (const ch of notifChannels) await supabase.removeChannel(ch); } catch {}
        notifChannels = [];
      }
    });
    // Routage initial une fois l’état d’authentification déterminé
    if (location.hash) {
      setActiveRoute(location.hash);
    } else {
      location.hash = isProfileLoggedIn() ? '#/dashboard' : '#/';
    }
    // Abonne les notifications pour une session déjà active et rejoue les toasts une fois
    if (authSession?.user) {
      setupRealtimeNotifications();
      updateBadgeFromStore();
      // Récupère systématiquement les notifications manquées à l’ouverture si déjà connecté
      fetchMissedNotifications();
      // Ne rejoue les toasts qu’une fois par session
      if (!hasBootedNotifs()) { replayUnseenNotifs(); markBootedNotifs(); }
    }
  } catch (e) {
    console.warn('Supabase init failed (env or import)', e);
  }

 

  

  // Données démo locales pour pré-remplir le carnet de santé & la communauté
  const DEMO_CHILD_ID = 'demo-child-1';
  function buildDemoChild() {
    const baseDob = '2022-05-12';
    const now = Date.now();
    const withTimestamp = (offsetDays) => {
      const date = new Date(now - offsetDays * 24 * 3600 * 1000);
      return date.toISOString();
    };
    const demoMilestones = Array.from({ length: DEV_QUESTIONS.length }, (_, idx) => idx < 14 ? true : idx < 18 ? idx % 2 === 0 : false);
    return {
      id: DEMO_CHILD_ID,
      firstName: 'Maya',
      sex: 'fille',
      dob: baseDob,
      photo: '',
      context: {
        allergies: 'Arachide (surveillée)',
        history: 'Suivi classique, RAS',
        care: 'Crèche municipale',
        languages: 'Français, Anglais',
        feedingType: 'mixte_allaitement_biberon',
        eatingStyle: 'mange_tres_bien',
        sleep: {
          falling: 'Routine apaisée (10 min)',
          sleepsThrough: true,
          nightWakings: '1 réveil rare',
          wakeDuration: 'Réveils brefs',
          bedtime: '20:30',
        },
      },
      milestones: demoMilestones,
      growth: {
        measurements: [
          { month: 0, height: 50, weight: 3.4, measured_at: withTimestamp(950) },
          { month: 3, height: 60, weight: 5.6, measured_at: withTimestamp(860) },
          { month: 6, height: 66, weight: 7.3, measured_at: withTimestamp(770) },
          { month: 9, height: 71, weight: 8.2, measured_at: withTimestamp(680) },
          { month: 12, height: 75, weight: 9.1, measured_at: withTimestamp(590) },
          { month: 18, height: 82, weight: 10.4, measured_at: withTimestamp(410) },
          { month: 24, height: 88, weight: 11.6, measured_at: withTimestamp(230) },
          { month: 30, height: 93, weight: 12.4, measured_at: withTimestamp(50) },
        ],
        sleep: [
          { month: 6, hours: 15 },
          { month: 12, hours: 14 },
          { month: 24, hours: 13 },
        ],
        teeth: [
          { month: 8, count: 2 },
          { month: 12, count: 6 },
          { month: 18, count: 12 },
        ],
      },
    };
  }

  function buildDemoForum() {
    const base = Date.now();
    return [
      {
        id: 'demo-topic-1',
        title: '[Sommeil] Vos rituels du coucher préférés ? ',
        content: 'Bonjour à tous ! Notre petite Maya de bientôt 2 ans a encore besoin de beaucoup de câlins avant de dormir. Quels rituels utilisent vos enfants pour se détendre ? 😊',
        author: 'Élodie — maman de Maya',
        createdAt: base - 1000 * 60 * 60 * 12,
        replies: [
          {
            author: 'Karim — papa de Lina',
            content: 'On lit une histoire courte avec une veilleuse tamisée. Depuis que nous avons introduit un petit massage des mains, elle s’endort beaucoup plus vite !',
            createdAt: base - 1000 * 60 * 60 * 8,
          },
          {
            author: 'Sophie — maman de Jules',
            content: 'Chez nous, on chante la même berceuse tous les soirs. La répétition rassure énormément Jules.',
            createdAt: base - 1000 * 60 * 60 * 6,
          },
        ],
      },
      {
        id: 'demo-topic-2',
        title: '[Alimentation] Idées de petits-déjeuners équilibrés',
        content: 'Je cherche des idées rapides mais gourmandes pour varier les petits-déjeuners. Maya adore les fruits, et chez vous ? 🥣🍓',
        author: 'Élodie — maman de Maya',
        createdAt: base - 1000 * 60 * 60 * 30,
        replies: [
          {
            author: 'Léa — maman d’Émile',
            content: 'Nous faisons souvent un porridge avec flocons d’avoine, lait végétal et banane écrasée. Je rajoute parfois des graines de chia pour les oméga-3.',
            createdAt: base - 1000 * 60 * 60 * 26,
          },
        ],
      },
      {
        id: 'demo-topic-3',
        title: '[Développement] Des jeux pour encourager le langage',
        content: 'Avez-vous des jeux simples à proposer pour enrichir le vocabulaire ? Nous aimons chanter et montrer des cartes imagées, mais je suis preneuse d’autres idées.',
        author: 'Camille — maman de Zoé',
        createdAt: base - 1000 * 60 * 60 * 52,
        replies: [
          {
            author: 'Thomas — papa de Hugo',
            content: 'Les imagiers sonores ont été une révélation ici. On commente chaque image et on invente une mini-histoire.',
            createdAt: base - 1000 * 60 * 60 * 48,
          },
          {
            author: 'Fatou — maman de Sélena',
            content: 'On adore aussi le jeu “je vois, tu vois” en décrivant un objet de la pièce. C’est ludique et ça enrichit le vocabulaire.',
            createdAt: base - 1000 * 60 * 60 * 45,
          },
        ],
      },
    ];
  }

  // Valeurs par défaut de démarrage
  function bootstrap() {
    const forumData = store.get(K.forum);
    if (!forumData || !Array.isArray(forumData.topics) || forumData.topics.length === 0) {
      store.set(K.forum, { topics: buildDemoForum() });
    }
    const childrenData = store.get(K.children);
    if (!Array.isArray(childrenData) || childrenData.length === 0) {
      store.set(K.children, [buildDemoChild()]);
    }
    const privacyData = store.get(K.privacy);
    if (!privacyData) {
      store.set(K.privacy, { showStats: true, allowMessages: true });
    }
    const sessionData = store.get(K.session);
    if (!sessionData) {
      store.set(K.session, { loggedIn: false });
    }
    const userData = store.get(K.user);
    if (!userData || Object.keys(userData).length === 0) {
      store.set(K.user, {
        pseudo: 'Élodie',
        role: 'maman',
        primaryChildId: DEMO_CHILD_ID,
      });
    }
    }

    // Gestion du routage
  function setActiveRoute(hash) {
    const requestedPath = normalizeRoutePath(hash);
    const path = routeSections.has(requestedPath) ? requestedPath : '/';
    const queryParams = parseHashQuery(typeof hash === 'string' ? hash : '');
    const focusParam = (() => {
      const raw = queryParams?.get('focus');
      return raw ? String(raw).trim().toLowerCase() : '';
    })();
    const viewParam = (() => {
      const raw = queryParams?.get('view');
      return raw ? String(raw).trim().toLowerCase() : '';
    })();
    const targetSection = routeSections.get(path) || null;
    if (targetSection && activeRouteEl !== targetSection) {
      activeRouteEl?.classList.remove('active');
      targetSection.classList.add('active');
      activeRouteEl = targetSection;
    } else if (!targetSection && activeRouteEl) {
      activeRouteEl.classList.add('active');
    }
    for (const [href, link] of navLinks) {
      const targetPath = navLinkTargets.get(href);
      link.classList.toggle('active', !!targetPath && targetPath === path);
    }
    try {
      const pl = document.getElementById('page-logo');
      if (pl) pl.hidden = (path === '/' || path === '');
    } catch {}
    updateHeaderAuth();
    const previousPath = (typeof __activePath === 'string' && __activePath.length > 0) ? __activePath : null;
    if (previousPath !== path) {
      window.scrollTo(0, 0);
    }
    const authed = isProfileLoggedIn();
    if (protectedRoutes.has(path) && !authed) {
      location.hash = '#/login';
      return;
    }
    if ((path === '/login' || path === '/signup') && authed) {
      location.hash = '#/dashboard';
      return;
    }
    if (path === '/onboarding') { renderOnboarding(); }
    if (path === '/dashboard') {
      if (viewParam === 'family' || viewParam === 'child') {
        dashboardState.viewMode = viewParam;
      } else if (focusParam === 'parent-updates') {
        dashboardState.viewMode = 'family';
      }
      pendingDashboardFocus = focusParam || null;
      renderDashboard();
    } else if (path !== '/ai') {
      pendingDashboardFocus = null;
    }
    if (path === '/community') { renderCommunity(); }
    if (path === '/settings') { renderSettings(); }
    if (path === '/ai') {
      setupAIPage();
      if (focusParam) {
        setTimeout(() => focusAIToolSection(focusParam), 60);
      }
    } else {
      clearAiFocusHighlight();
      disposeAIPage();
    }
    if (path === '/contact') { setupContact(); }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(setupScrollAnimations);
    } else {
      setTimeout(setupScrollAnimations, 0);
    }
    if (path === '/') {
      try { setupNewsletter(); } catch {}
      stopRouteParticles();
      stopSectionParticles();
      startHeroParticles();
      stopLogoParticles();
      if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
        startRouteParticles();
        startSectionParticles();
        startCardParticles();
      } else {
        startRouteParticles();
        stopCardParticles();
      }
    } else {
      stopHeroParticles();
      stopSectionParticles();
      stopRouteParticles();
      stopLogoParticles();
      stopCardParticles();
      startRouteParticles();
      startLogoParticles();
    }
    __activePath = path;
  }

  window.addEventListener('hashchange', () => {
    setActiveRoute(location.hash || '#/ai');
    closeMobileNav();
  });

  // Forcer en permanence le menu hamburger, quelle que soit la largeur d’écran
  function evaluateHeaderFit(){
    document.body.classList.add('force-mobile');
  }

  // Au redimensionnement/orientation, réévaluer l’entête et réinitialiser l’état du menu si besoin
  function onViewportChange(){
    // Conserver systématiquement le mode mobile
    document.body.classList.add('force-mobile');
    // Garantir la cohérence de l’overlay lors des redimensionnements
    if (!mainNav?.classList.contains('open')) {
      closeMobileNav();
    }
  }
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
  // Recontrôle après stabilisation du resize pour tenir compte du reflow des polices
  let resizeRaf = null;
  window.addEventListener('resize', () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(onViewportChange);
  });
  // Nouvelle évaluation après chargement complet (les polices/ressources peuvent modifier les largeurs)
  window.addEventListener('load', evaluateHeaderFit);

  // --- Notifications (popup) -------------------------------------------------
  // Notifications type toast (fermeture auto en 4 s, empilables)
  let notifyAudioCtx = null;
  function playNotifySound(){
    try {
      // Crée ou réutilise un AudioContext unique
      notifyAudioCtx = notifyAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = notifyAudioCtx;
      const now = ctx.currentTime + 0.01;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now); // tintement doux
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    } catch {}
  }
  function getToastHost(){
    let host = document.getElementById('notify-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'notify-toasts';
      host.className = 'notify-toasts';
      document.body.appendChild(host);
    }
    return host;
  }
  function showNotification(opts){
    try {
      const {
        title = 'Notification',
        text = '',
        actionHref = '',
        actionLabel = 'Voir',
        onAcknowledge,
        onAction,
        durationMs = 4000
      } = opts || {};
      const host = getToastHost();
      // Limite la pile à 4 éléments en supprimant le plus ancien
      while (host.children.length >= 4) host.removeChild(host.firstElementChild);
      const toast = document.createElement('div');
      toast.className = 'notify-toast';
      toast.innerHTML = `
        <div class="nt-content">
          <h3 class="nt-title"></h3>
          <p class="nt-text"></p>
          <div class="nt-actions">
            <button type="button" class="btn btn-secondary nt-close">Fermer</button>
            <button type="button" class="btn btn-primary nt-link">${actionLabel}</button>
          </div>
        </div>
      `;
      toast.querySelector('.nt-title').textContent = title;
      toast.querySelector('.nt-text').textContent = text;
      const link = toast.querySelector('.nt-link');
      let timer = null;
      const hide = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        try { toast.classList.add('hide'); setTimeout(()=>toast.remove(), 250); }
        catch { toast.remove(); }
      };
      const acknowledge = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        try { toast.classList.add('hide'); setTimeout(()=>toast.remove(), 250); }
        catch { toast.remove(); }
        finally {
          try { onAcknowledge && onAcknowledge(); }
          catch {}
        }
      };
      toast.querySelector('.nt-close').addEventListener('click', acknowledge);
      if (onAction || actionHref) {
        link.hidden = false;
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          acknowledge();
          try {
            if (typeof onAction === 'function') {
              onAction();
            } else if (actionHref) {
              if (actionHref.startsWith('http')) {
                window.location.href = actionHref;
              } else {
                window.location.href = actionHref;
              }
            }
          } catch {}
        });
      } else {
        link.hidden = true;
      }
      host.appendChild(toast);
      // Son discret lors d’une notification
      playNotifySound();
      const delay = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 4000;
      if (delay > 0) {
        timer = setTimeout(hide, delay);
        toast.addEventListener('mouseenter', () => {
          if (timer) { clearTimeout(timer); timer = null; }
        });
        toast.addEventListener('mouseleave', () => {
          if (!toast.classList.contains('hide')) {
            timer = setTimeout(hide, 1500);
          }
        });
      }
    } catch {}
  }

  function showError(message) {
    const text = typeof message === 'string' && message.trim()
      ? message.trim()
      : 'Une erreur est survenue. Veuillez réessayer plus tard.';
    showNotification({ title: 'Erreur', text, actionLabel: 'Fermer', durationMs: 6000 });
  }

  // Badges sur les liens de navigation (messages + communauté)
  function setNavBadgeFor(hrefSel, n){
    const link = navLinks.get(hrefSel);
    if (!link) return;
    let badge = navBadges.get(hrefSel);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      link.appendChild(badge);
      navBadges.set(hrefSel, badge);
    }
    const value = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : Math.max(0, n|0);
    badge.textContent = String(value);
    badge.hidden = value === 0;
  }
  function countsByKind(){
    const arr = loadNotifs();
    let msg = 0, reply = 0;
    for (const n of arr) { if (!n.seen) { if (n.kind==='msg') msg++; else if (n.kind==='reply') reply++; } }
    return { msg, reply };
  }
  function bumpMessagesBadge(){
    // Compatibilité : recalculer tous les badges depuis le store local
    updateBadgeFromStore();
  }

  // --- Persistance des notifications non lues (localStorage) ---
  function loadNotifs(){ return store.get(K.notifs, []); }
  function saveNotifs(arr){ store.set(K.notifs, arr); }
  function addNotif(n){
    const arr = loadNotifs();
    const exists = arr.some(x=>x.id===n.id);
    if (!exists) { arr.push({ ...n, seen:false }); saveNotifs(arr); }
    updateBadgeFromStore();
    return !exists;
  }
  function markNotifSeen(id){ const arr = loadNotifs(); const i = arr.findIndex(x=>x.id===id); if (i>=0) { arr[i].seen=true; saveNotifs(arr); } updateBadgeFromStore(); }
  function markAllByTypeSeen(kind){ const arr = loadNotifs().map(x=> x.kind===kind? { ...x, seen:true } : x); saveNotifs(arr); setNotifLastNow(kind); updateBadgeFromStore(); }
  function unseenNotifs(){ return loadNotifs().filter(x=>!x.seen); }
  function updateBadgeFromStore(){
    const { msg, reply } = countsByKind();
    setNavBadgeFor('messages.html', msg);
    setNavBadgeFor('#/community', reply);
  }

  const ANON_NOTIF_INTERVAL_MS = 15000;

  async function fetchAnonMissedNotifications(){
    if (!isAnonProfile()) return;
    const code = (activeProfile.code_unique || '').toString().trim().toUpperCase();
    if (!code) return;
    const sinceDefault = new Date(Date.now() - 7*24*3600*1000).toISOString();
    const sinceRep = getNotifLastSince('reply') || sinceDefault;
    try {
      const sinceMsg = getNotifLastSince('msg') || sinceDefault;
      const { messages, senders } = await anonMessagesRequest(code, { since: sinceMsg });
      const list = Array.isArray(messages) ? messages : [];
      for (const m of list) {
        if (!m || m.id == null) continue;
        const senderRaw = m.sender_id ?? m.senderId ?? m.sender_code ?? m.senderCode;
        if (senderRaw == null) continue;
        const fromId = String(senderRaw);
        const notifId = `msg:${m.id}`;
        const fromName = senders?.[fromId] || m.sender_name || m.senderName || m.sender_full_name || m.senderFullName || 'Un parent';
        const wasNew = addNotif({ id:notifId, kind:'msg', fromId, fromName, createdAt:m.created_at });
        if (wasNew) {
          showNotification({
            title:'Nouveau message',
            text:`Vous avez un nouveau message de ${fromName}`,
            actionHref:`messages.html?user=${fromId}`,
            actionLabel:'Ouvrir',
            onAcknowledge: () => { markNotifSeen(notifId); setNotifLastNow('msg'); }
          });
        }
      }
    } catch (err) {
      console.warn('fetchAnonMissedNotifications messages failed', err);
    }
    try {
      const resRep = await anonCommunityRequest('recent-replies', { since: sinceRep });
      const replies = Array.isArray(resRep?.replies) ? resRep.replies : [];
      const authors = resRep?.authors || {};
      const topics = resRep?.topics || {};
      for (const r of replies) {
        if (!r || r.id == null) continue;
        const topicIdRaw = r.topic_id ?? r.topicId;
        const topicId = topicIdRaw != null ? String(topicIdRaw) : '';
        const whoIdRaw = r.user_id ?? r.userId;
        const whoId = whoIdRaw != null ? String(whoIdRaw) : '';
        const authorEntry = authors[whoId];
        let who = 'Un parent';
        if (authorEntry && typeof authorEntry === 'object') {
          who = authorEntry.full_name || authorEntry.name || who;
        } else if (authorEntry != null) {
          who = String(authorEntry) || who;
        }
        const rawTitle = topics[topicId] || '';
        const cleanTitle = rawTitle ? rawTitle.replace(/^\[(.*?)\]\s*/, '') : '';
        const notifId = `reply:${r.id}`;
        const wasNew = addNotif({ id:notifId, kind:'reply', who, title: cleanTitle, topicId, createdAt:r.created_at });
        if (wasNew) {
          const t = cleanTitle ? ` « ${cleanTitle} »` : '';
          showNotification({
            title:'Nouvelle réponse',
            text:`${who} a répondu à votre publication${t}`,
            actionHref:'#/community',
            actionLabel:'Voir',
            onAcknowledge: () => { markNotifSeen(notifId); setNotifLastNow('reply'); }
          });
        }
      }
    } catch (err) {
      console.warn('fetchAnonMissedNotifications replies failed', err);
    }
    updateBadgeFromStore();
  }

  function stopAnonNotifPolling(){
    if (anonNotifTimer) {
      clearInterval(anonNotifTimer);
      anonNotifTimer = null;
    }
  }

  async function anonNotifTick(){
    try {
      await fetchAnonMissedNotifications();
    } catch (err) {
      console.warn('anon notification tick failed', err);
    }
  }

  function startAnonNotifPolling(){
    stopAnonNotifPolling();
    anonNotifTick();
    anonNotifTimer = setInterval(anonNotifTick, ANON_NOTIF_INTERVAL_MS);
  }
  function isNotifUnseen(id){
    try { return unseenNotifs().some(x => x.id === id); } catch { return false; }
  }
  function replayUnseenNotifs(){
    unseenNotifs().forEach(n => {
      if (n.kind==='msg') {
        showNotification({ title:'Nouveau message', text:`Vous avez un nouveau message de ${n.fromName||'Un parent'}`, actionHref:`messages.html?user=${n.fromId}`, actionLabel:'Ouvrir', onAcknowledge: () => { markNotifSeen(n.id); setNotifLastNow('msg'); } });
      } else if (n.kind==='reply') {
        const t = n.title ? ` « ${n.title} »` : '';
        showNotification({ title:'Nouvelle réponse', text:`${n.who||'Un parent'} a répondu à votre publication${t}`, actionHref:'#/community', actionLabel:'Voir', onAcknowledge: () => { markNotifSeen(n.id); setNotifLastNow('reply'); } });
      }
    });
  }

  // Gestion des horodatages de dernière vue pour récupérer les notifications manquées à la connexion
  function getNotifLast(){ return store.get(NOTIF_LAST_KEY, {}); }
  function setNotifLast(obj){ store.set(NOTIF_LAST_KEY, obj); }
  function getNotifLastSince(kind){ const o = getNotifLast(); return o[kind] || null; }
  function setNotifLastNow(kind){ const o = getNotifLast(); o[kind] = new Date().toISOString(); setNotifLast(o); }

  async function fetchMissedNotifications(){
    try {
      if (isAnonProfile()) {
        await fetchAnonMissedNotifications();
        return;
      }
      if (!useRemote()) return;
      const uid = getActiveProfileId(); if (!uid) return;
      const sinceDefault = new Date(Date.now() - 7*24*3600*1000).toISOString();
      const sinceMsg = getNotifLastSince('msg') || sinceDefault;
      const sinceRep = getNotifLastSince('reply') || sinceDefault;
      // Messages reçus depuis la dernière consultation
      const { data: msgs } = await supabase
        .from('messages')
        .select('id,sender_id,created_at')
        .eq('receiver_id', uid)
        .gt('created_at', sinceMsg)
        .order('created_at', { ascending:true })
        .limit(50);
      if (msgs && msgs.length) {
        const senders = Array.from(new Set(msgs.map(m=>m.sender_id)));
        let names = new Map();
        try {
          const { data: profs } = await supabase.from('profiles').select('id,full_name').in('id', senders);
          names = new Map((profs||[]).map(p=>[p.id, p.full_name]));
        } catch {}
        for (const m of msgs) {
          const senderId = String(m.sender_id);
          const fromName = names.get(m.sender_id) || 'Un parent';
          const notifId = `msg:${m.id}`;
          const wasNew = addNotif({ id:notifId, kind:'msg', fromId:senderId, fromName, createdAt:m.created_at });
          if (wasNew) {
            showNotification({ title:'Nouveau message', text:`Vous avez un nouveau message de ${fromName}`, actionHref:`messages.html?user=${senderId}`, actionLabel:'Ouvrir', onAcknowledge: () => { markNotifSeen(notifId); setNotifLastNow('msg'); } });
          }
        }
      }
      // Réponses aux sujets que je possède ou où j’ai déjà commenté depuis la dernière visite
      const [{ data: topics }, { data: myReps }] = await Promise.all([
        supabase.from('forum_topics').select('id').eq('user_id', uid).limit(200),
        supabase.from('forum_replies').select('topic_id').eq('user_id', uid).limit(500)
      ]);
      const topicIdSet = new Set([...(topics||[]).map(t=>t.id), ...(myReps||[]).map(r=>r.topic_id)]);
      const topicIds = Array.from(topicIdSet);
      if (topicIds.length) {
        const { data: reps } = await supabase
          .from('forum_replies')
          .select('id,topic_id,user_id,created_at')
          .in('topic_id', topicIds)
          .neq('user_id', uid)
          .gt('created_at', sinceRep)
          .order('created_at', { ascending:true })
          .limit(100);
        if (reps && reps.length) {
          const userIds = Array.from(new Set(reps.map(r=>r.user_id)));
          let names = new Map();
          try {
            const { data: profs } = await supabase.from('profiles').select('id,full_name').in('id', userIds);
            names = new Map((profs||[]).map(p=>[p.id, p.full_name]));
          } catch {}
          // Nécessite également la table des titres
          let titleMap = new Map();
          try {
            const { data: ts } = await supabase.from('forum_topics').select('id,title').in('id', Array.from(new Set(reps.map(r=>r.topic_id))));
            titleMap = new Map((ts||[]).map(t=>[t.id, (t.title||'').replace(/^\[(.*?)\]\s*/, '')]));
          } catch {}
          for (const r of reps) {
            const who = names.get(r.user_id) || 'Un parent';
            const title = titleMap.get(r.topic_id) || '';
            const cleanTitle = title ? title.replace(/^\[(.*?)\]\s*/, '') : '';
            const notifId = `reply:${r.id}`;
            const wasNew = addNotif({ id:notifId, kind:'reply', who, title: cleanTitle, topicId:r.topic_id, createdAt:r.created_at });
            if (wasNew) {
              const t = cleanTitle ? ` « ${cleanTitle} »` : '';
              showNotification({ title:'Nouvelle réponse', text:`${who} a répondu à votre publication${t}`, actionHref:'#/community', actionLabel:'Voir', onAcknowledge: () => { markNotifSeen(notifId); setNotifLastNow('reply'); } });
            }
          }
        }
      }
      updateBadgeFromStore();
    } catch (e) { console.warn('fetchMissedNotifications error', e); }
  }

  // Éviter de rejouer les notifications à chaque changement de route : garde par session
  function hasBootedNotifs(){ try { return sessionStorage.getItem(NOTIF_BOOT_FLAG) === '1'; } catch { return false; } }
  function markBootedNotifs(){ try { sessionStorage.setItem(NOTIF_BOOT_FLAG, '1'); } catch {} }

  function setupRealtimeNotifications(){
    try {
      stopAnonNotifPolling();
      if (isAnonProfile()) {
        startAnonNotifPolling();
        return;
      }
      if (!useRemote()) return;
      const uid = getActiveProfileId(); if (!uid) return;
      // Nettoyer les abonnements précédents
      try { for (const ch of notifChannels) supabase.removeChannel(ch); } catch {}
      notifChannels = [];
      // Nouveaux messages qui me sont adressés
      const chMsg = supabase
        .channel('notify-messages-'+uid)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${uid}`
        }, async (payload) => {
          const row = payload.new || {};
          const fromId = row.sender_id != null ? String(row.sender_id) : '';
          if (!fromId) return;
          // Résoudre le nom de l’expéditeur
          let fromName = 'Un parent';
          try {
            const { data } = await supabase.from('profiles').select('full_name').eq('id', fromId).maybeSingle();
            if (data?.full_name) fromName = data.full_name;
          } catch {}
          const notifId = `msg:${row.id}`;
          const wasNew = addNotif({ id:notifId, kind:'msg', fromId, fromName, createdAt: row.created_at });
          if (wasNew) {
            showNotification({
              title: 'Nouveau message',
              text: `Vous avez un nouveau message de ${fromName}`,
              actionHref: `messages.html?user=${fromId}`,
              actionLabel: 'Ouvrir',
              onAcknowledge: () => markNotifSeen(notifId)
            });
            updateBadgeFromStore();
          }
        })
        .subscribe();
      notifChannels.push(chMsg);

      // Réponses sur les sujets que je possède ou où j’ai déjà commenté
      const chRep = supabase
        .channel('notify-replies-'+uid)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'forum_replies'
        }, async (payload) => {
          const r = payload.new || {};
          if (!r?.topic_id) return;
          // Ignorer mes propres réponses
          if (String(r.user_id) === String(uid)) return;
          try {
            const { data: topic } = await supabase.from('forum_topics').select('id,user_id,title').eq('id', r.topic_id).maybeSingle();
            if (!topic) return;
            let isParticipant = String(topic.user_id) === String(uid);
            if (!isParticipant) {
              const { count } = await supabase
                .from('forum_replies')
                .select('id', { count: 'exact', head: true })
                .eq('topic_id', r.topic_id)
                .eq('user_id', uid);
              isParticipant = (count||0) > 0;
            }
            if (!isParticipant) return;
            // Résoudre le nom de l’auteur de la réponse
            let who = 'Un parent';
            try {
              const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', r.user_id).maybeSingle();
              if (prof?.full_name) who = prof.full_name;
            } catch {}
            const title = (topic.title||'').replace(/^\[(.*?)\]\s*/, '');
            const notifId = `reply:${r.id}`;
            const wasNew = addNotif({ id:notifId, kind:'reply', who, title, topicId: r.topic_id, createdAt: r.created_at });
            if (wasNew) {
              showNotification({
                title: 'Nouvelle réponse',
                text: `${who} a répondu à votre publication${title?` « ${title} »`:''}`,
                actionHref: '#/community',
                actionLabel: 'Voir',
                onAcknowledge: () => markNotifSeen(notifId)
              });
              updateBadgeFromStore();
            }
          } catch {}
        })
        .subscribe();
      notifChannels.push(chRep);
    } catch {}
  }

  // Remet les badges à zéro lorsque l’utilisateur visite les pages
  window.addEventListener('DOMContentLoaded', () => {
    const link = document.querySelector('#main-nav a[href="messages.html"]');
    // Messages : on masque seulement le badge au clic, la vraie lecture se fait en ouvrant la conversation
    link?.addEventListener('click', () => { try { setNavBadgeFor('messages.html', 0); } catch {} });
    const linkComm = document.querySelector('#main-nav a[href="#/community"]');
    linkComm?.addEventListener('click', () => { markAllByTypeSeen('reply'); });
  });

  // Marque les notifications communauté comme lues lors de la visite de la page dédiée
  const origSetActiveRoute = setActiveRoute;
  setActiveRoute = function(hash){
    origSetActiveRoute(hash);
    try {
      const path = normalizeRoutePath(hash);
      if (path === '/community') markAllByTypeSeen('reply');
    } catch {}
  };

  // Particules pastel dans le hero
  let heroParticlesState = { raf: 0, canvas: null, ctx: null, parts: [], lastT: 0, resize: null, observer: null, extra: 0, route: null, hero: null };
  function startHeroParticles(){
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const route = document.querySelector('section[data-route="/"]');
      if (!route) return;
      const hero = route.querySelector('.hero-v2') || route.querySelector('.hero');
      const cvs = document.getElementById('hero-canvas');
      if (!cvs) return;
      // Conserver le canvas dans le hero pour ne pas impacter le scroll de page
      if (cvs.parentElement !== hero && hero) hero.prepend(cvs);
      const width = hero ? hero.clientWidth : route.clientWidth;
      const height = hero ? hero.clientHeight : route.clientHeight;
      const extra = 0; // aucune zone supplémentaire : rester dans les limites du hero
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      // Réinitialiser la taille pour épouser la zone du hero
      cvs.style.left = '';
      cvs.style.top = '';
      cvs.style.right = '';
      cvs.style.bottom = '';
      cvs.style.width = '100%';
      cvs.style.height = '100%';
      cvs.width = Math.floor((width + extra) * dpr);
      cvs.height = Math.floor((height + extra) * dpr);
      const ctx = cvs.getContext('2d');
      ctx.setTransform(dpr,0,0,dpr,0,0);
      heroParticlesState.canvas = cvs;
      heroParticlesState.ctx = ctx;
      heroParticlesState.parts = [];
      heroParticlesState.extra = extra;
      heroParticlesState.route = route;
      heroParticlesState.hero = hero;
      // Palette dérivée des variables CSS
      const cs = getComputedStyle(document.documentElement);
      const palette = [
        cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
        cs.getPropertyValue('--orange').trim()||'#ffcba4',
        cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
        '#ffd9e6'
      ];
      const W = width, H = height;
      const isSmallScreen = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
      // Ajuster le nombre de particules sur les écrans petits ou économes en énergie
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      const lowPower = !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) || Math.min(W, H) < 520;
      const N = lowPower
        ? Math.max(8, Math.min(24, Math.round(W*H/80000)))
        : Math.max(20, Math.min(48, Math.round(W*H/45000)));
      for (let i=0;i<N;i++) {
        // Trois familles de tailles : petites (50 %), moyennes (35 %), grandes (15 %) avec des rayons distincts
        const u = Math.random();
        const r = u < .5 ? (5 + Math.random()*8)       // 5–13 px
                : (u < .85 ? (12 + Math.random()*12)   // 12–24 px
                : (22 + Math.random()*20));            // 22–42 px
        heroParticlesState.parts.push({
          x: Math.random()*W,
          y: Math.random()*H,
          r,
          vx: (Math.random()*.35 - .175),
          vy: (Math.random()*.35 - .175),
          hue: palette[Math.floor(Math.random()*palette.length)],
          alpha: (isSmallScreen ? .08 : .12) + Math.random()*(isSmallScreen ? .22 : .24),
          drift: Math.random()*Math.PI*2,
          spin: .0015 + Math.random()*.0035
        });
      }
      // Ajoute des particules supplémentaires concentrées autour du hero
      const heroH = hero?.offsetHeight || 0;
      const extraHeroParts = heroH ? Math.round(N * 0.3) : 0;
      for (let i=0; i<extraHeroParts; i++) {
        const u = Math.random();
        const r = u < .5 ? (5 + Math.random()*8)
                : (u < .85 ? (12 + Math.random()*12)
                : (22 + Math.random()*20));
        heroParticlesState.parts.push({
          x: Math.random()*W,
          y: Math.random()*heroH,
          r,
          vx: (Math.random()*.35 - .175),
          vy: (Math.random()*.35 - .175),
          hue: palette[Math.floor(Math.random()*palette.length)],
          alpha: (isSmallScreen ? .08 : .12) + Math.random()*(isSmallScreen ? .22 : .24),
          drift: Math.random()*Math.PI*2,
          spin: .0015 + Math.random()*.0035
        });
      }
      const step = (t)=>{
        const ctx = heroParticlesState.ctx; if (!ctx) return;
        const now = t || performance.now();
        const dt = heroParticlesState.lastT? Math.min(40, now - heroParticlesState.lastT) : 16;
        // Ne dessine rien si l’onglet est caché pour préserver batterie/CPU
        if (document.hidden) { heroParticlesState.lastT = now; heroParticlesState.raf = requestAnimationFrame(step); return; }
        heroParticlesState.lastT = now;
        const hero = heroParticlesState.hero;
        const W = hero ? hero.clientWidth : 0;
        const H = hero ? hero.clientHeight : 0;
        const extra = heroParticlesState.extra || 0;
        // Efface la zone de dessin
        ctx.clearRect(0,0,W+extra,H+extra);
        // Dessine chaque particule
        for (const p of heroParticlesState.parts){
          p.drift += p.spin*dt;
          p.x += p.vx + Math.cos(p.drift)*.05;
          p.y += p.vy + Math.sin(p.drift)*.05;
          // Remise en circulation quand une particule sort de l’aire
          if (p.x < -20) p.x = W+20; if (p.x > W+20) p.x = -20;
          if (p.y < -20) p.y = H+20; if (p.y > H+20) p.y = -20;
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = p.hue;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
        }
        heroParticlesState.raf = requestAnimationFrame(step);
      };
      cancelAnimationFrame(heroParticlesState.raf);
      heroParticlesState.raf = requestAnimationFrame(step);
      // Gestion du redimensionnement
      const onR = ()=>{
        const hero = heroParticlesState.hero;
        if (!hero) return;
        const width = hero.clientWidth;
        const height = hero.clientHeight;
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const extra = heroParticlesState.extra || 0;
        cvs.width = Math.floor((width + extra) * dpr);
        cvs.height = Math.floor((height + extra) * dpr);
        heroParticlesState.ctx?.setTransform(dpr,0,0,dpr,0,0);
      };
      window.addEventListener('resize', onR);
      heroParticlesState.resize = onR;
      if (window.ResizeObserver && hero) {
        const ro = new ResizeObserver(onR);
        ro.observe(hero);
        heroParticlesState.observer = ro;
      }
    } catch {}
  }
  function stopHeroParticles(){
    try {
      cancelAnimationFrame(heroParticlesState.raf);
      heroParticlesState.raf = 0;
      if (heroParticlesState.resize) window.removeEventListener('resize', heroParticlesState.resize);
      heroParticlesState.resize = null;
      if (heroParticlesState.observer) { heroParticlesState.observer.disconnect(); heroParticlesState.observer = null; }
      if (heroParticlesState.ctx){
        const route = heroParticlesState.route;
        const extra = heroParticlesState.extra || 0;
        if (route) heroParticlesState.ctx.clearRect(-extra/2,-extra/2,route.clientWidth+extra,route.clientHeight+extra);
      }
      if (heroParticlesState.canvas){
        heroParticlesState.canvas.style.left = '';
        heroParticlesState.canvas.style.top = '';
        heroParticlesState.canvas.style.right = '';
        heroParticlesState.canvas.style.bottom = '';
        heroParticlesState.canvas.style.width = '';
        heroParticlesState.canvas.style.height = '';
        if (heroParticlesState.hero){
          heroParticlesState.hero.prepend(heroParticlesState.canvas);
        }
      }
      heroParticlesState.ctx = null; heroParticlesState.parts = [];
      heroParticlesState.extra = 0;
      heroParticlesState.route = null;
      heroParticlesState.hero = null;
    } catch {}
  }

    // Particules plein écran pour les routes (dashboard utilise un canvas fixe couvrant tout l’écran)
    let routeParticles = { cvs: null, ctx: null, parts: [], raf: 0, lastT: 0, resize: null, route: null, dpr: 1, observer: null };
  function startRouteParticles(){
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const route = document.querySelector('.route.active');
      if (!route) return;
      const routePath = route.getAttribute('data-route') || '';
      const isDashboard = routePath === '/dashboard';
      const isHome = routePath === '/';
      const cvs = document.createElement('canvas');
      // Dashboard : canvas fixe plein écran pour recouvrir toute la page
      if (isDashboard || isHome) {
        cvs.className = 'route-canvas route-canvas-fixed';
        // Empêche le canvas de bloquer les éléments d’interface
        cvs.style.pointerEvents = 'none';
        document.body.prepend(cvs);
      } else {
        cvs.className = 'route-canvas';
        cvs.style.pointerEvents = 'none';
        route.prepend(cvs);
      }
      const width = (isDashboard || isHome) ? window.innerWidth : route.clientWidth;
      const height = (isDashboard || isHome) ? window.innerHeight : route.scrollHeight;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      cvs.width = Math.floor(width * dpr);
      cvs.height = Math.floor(height * dpr);
      const ctx = cvs.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
        // Palette dérivée des variables CSS
        const cs = getComputedStyle(document.documentElement);
        const palette = [
          cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
          cs.getPropertyValue('--orange').trim()||'#ffcba4',
          cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
          '#ffd9e6'
        ];
        const W = width, H = height;
        const area = Math.max(1, W*H);
        const N = Math.max(14, Math.min(40, Math.round(area/52000)));
        const parts = [];
        const isSmallScreen = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
        for (let i=0;i<N;i++){
          const u = Math.random();
          const r = u < .5 ? (4 + Math.random()*7) : (u < .85 ? (10 + Math.random()*10) : (20 + Math.random()*18));
          parts.push({
            x: Math.random()*W,
            y: Math.random()*H,
            r,
            vx:(Math.random()*.28 - .14),
            vy:(Math.random()*.28 - .14),
            hue: palette[Math.floor(Math.random()*palette.length)],
            alpha:(isSmallScreen ? .08 : .12) + Math.random()*(isSmallScreen ? .22 : .24),
            drift: Math.random()*Math.PI*2,
            spin:.001 + Math.random()*.003
          });
        }
        routeParticles = { cvs, ctx, parts, raf: 0, lastT: 0, resize: null, route, dpr, observer: null };
      const step = (t)=>{
        const now = t || performance.now();
        const dt = routeParticles.lastT ? Math.min(40, now - routeParticles.lastT) : 16;
        routeParticles.lastT = now;
        const W = (isDashboard || isHome) ? window.innerWidth : route.clientWidth;
        const H = (isDashboard || isHome) ? window.innerHeight : route.scrollHeight;
        const dpr = routeParticles.dpr;
        ctx.setTransform(dpr,0,0,dpr,0,0);
        ctx.clearRect(0,0,W,H);
        for (const p of routeParticles.parts){
          p.drift += p.spin*dt;
            p.x += p.vx + Math.cos(p.drift)*.04;
            p.y += p.vy + Math.sin(p.drift)*.04;
            if (p.x < -20) p.x = W+20; if (p.x > W+20) p.x = -20;
            if (p.y < -20) p.y = H+20; if (p.y > H+20) p.y = -20;
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.hue;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
          }
          routeParticles.raf = requestAnimationFrame(step);
        };
        routeParticles.raf = requestAnimationFrame(step);
      const onR = ()=>{
        const width = (isDashboard || isHome) ? window.innerWidth : route.clientWidth;
        const height = (isDashboard || isHome) ? window.innerHeight : route.scrollHeight;
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        cvs.width = Math.floor(width * dpr);
        cvs.height = Math.floor(height * dpr);
        routeParticles.dpr = dpr;
        routeParticles.ctx?.setTransform(dpr,0,0,dpr,0,0);
      };
        window.addEventListener('resize', onR);
        routeParticles.resize = onR;
        if (!isDashboard && window.ResizeObserver) {
          const ro = new ResizeObserver(onR);
          ro.observe(route);
          routeParticles.observer = ro;
        }
      } catch {}
    }
    function stopRouteParticles(){
      try {
        cancelAnimationFrame(routeParticles.raf);
        routeParticles.raf = 0;
        if (routeParticles.resize) window.removeEventListener('resize', routeParticles.resize);
        routeParticles.resize = null;
        routeParticles.observer?.disconnect();
        routeParticles.observer = null;
        routeParticles.cvs?.remove();
        routeParticles = { cvs: null, ctx: null, parts: [], raf: 0, lastT: 0, resize: null, route: null, dpr: 1, observer: null };
      } catch {}
    }

    // Particules autour du logo supérieur (affiché sur les routes hors accueil)
    let logoParticles = { cvs: null, ctx: null, parts: [], raf: 0, lastT: 0, resize: null, el: null, dpr: 1 };
    function startLogoParticles(){
      try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const wrap = document.querySelector('#page-logo .container');
        if (!wrap || wrap.offsetParent === null) return;
        const cvs = document.createElement('canvas');
        cvs.className = 'logo-canvas';
        wrap.prepend(cvs);
        const width = wrap.clientWidth;
        const height = wrap.clientHeight;
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        cvs.width = Math.floor(width * dpr);
        cvs.height = Math.floor(height * dpr);
        const ctx = cvs.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
        const cs = getComputedStyle(document.documentElement);
        const palette = [
          cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
          cs.getPropertyValue('--orange').trim()||'#ffcba4',
          cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
          '#ffd9e6'
        ];
        const W = width, H = height;
        const area = Math.max(1, W*H);
        const N = Math.max(6, Math.min(16, Math.round(area/20000)));
        const parts = [];
        for (let i=0;i<N;i++){
          const u = Math.random();
          const r = u < .5 ? (3 + Math.random()*5) : (u < .85 ? (8 + Math.random()*8) : (16 + Math.random()*12));
          parts.push({
            x: Math.random()*W,
            y: Math.random()*H,
            r,
            vx:(Math.random()*.25 - .125),
            vy:(Math.random()*.25 - .125),
            hue: palette[Math.floor(Math.random()*palette.length)],
            alpha:.10 + Math.random()*.20,
            drift: Math.random()*Math.PI*2,
            spin:.001 + Math.random()*.003
          });
        }
        logoParticles = { cvs, ctx, parts, raf: 0, lastT: 0, resize: null, el: wrap, dpr };
        const step = (t)=>{
          const now = t || performance.now();
          const dt = logoParticles.lastT ? Math.min(40, now - logoParticles.lastT) : 16;
          logoParticles.lastT = now;
          const W = wrap.clientWidth, H = wrap.clientHeight;
          const dpr = logoParticles.dpr;
          ctx.setTransform(dpr,0,0,dpr,0,0);
          ctx.clearRect(0,0,W,H);
          for (const p of logoParticles.parts){
            p.drift += p.spin*dt;
            p.x += p.vx + Math.cos(p.drift)*.04;
            p.y += p.vy + Math.sin(p.drift)*.04;
            if (p.x < -20) p.x = W+20; if (p.x > W+20) p.x = -20;
            if (p.y < -20) p.y = H+20; if (p.y > H+20) p.y = -20;
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.hue;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
          }
          logoParticles.raf = requestAnimationFrame(step);
        };
        logoParticles.raf = requestAnimationFrame(step);
        const onR = ()=>{
          const width = wrap.clientWidth;
          const height = wrap.clientHeight;
          const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
          cvs.width = Math.floor(width * dpr);
          cvs.height = Math.floor(height * dpr);
          logoParticles.dpr = dpr;
          logoParticles.ctx?.setTransform(dpr,0,0,dpr,0,0);
        };
        window.addEventListener('resize', onR);
        logoParticles.resize = onR;
      } catch {}
    }
    function stopLogoParticles(){
      try {
        cancelAnimationFrame(logoParticles.raf);
        logoParticles.raf = 0;
        if (logoParticles.resize) window.removeEventListener('resize', logoParticles.resize);
        logoParticles.resize = null;
        logoParticles.cvs?.remove();
        logoParticles = { cvs: null, ctx: null, parts: [], raf: 0, lastT: 0, resize: null, el: null, dpr: 1 };
      } catch {}
    }

    // Particules pour certaines sections de l’accueil (mobile uniquement)
    let sectionParticlesStates = [];
    function startSectionParticles(){
      try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if (!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches)) return;
        stopSectionParticles();
        const root = document.querySelector('section[data-route="/"]');
        if (!root) return;
        const sections = Array.from(root.querySelectorAll(':scope > .section.bubble-mobile'));
        sections.forEach(sec => {
          const cvs = document.createElement('canvas');
          cvs.className = 'section-canvas';
          sec.prepend(cvs);
          const ctx = cvs.getContext('2d');
          const state = { sec, cvs, ctx, parts: [], raf: 0, lastT: 0, resize: null, observer: null, dpr: 1 };
          const resize = ()=>{
            const rect = sec.getBoundingClientRect();
            const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
            cvs.width = Math.floor(rect.width * dpr);
            cvs.height = Math.floor(rect.height * dpr);
            ctx.setTransform(dpr,0,0,dpr,0,0);
            state.dpr = dpr;
            return rect;
          };
          const rect = resize();
          const cs = getComputedStyle(document.documentElement);
          const palette = [
            cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
            cs.getPropertyValue('--orange').trim()||'#ffcba4',
            cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
            '#ffd9e6'
          ];
          const W = rect.width, H = rect.height;
          const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
          const lowPower = !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) || Math.min(W,H) < 520;
          const N = lowPower ? Math.max(8, Math.min(24, Math.round(W*H/80000))) : Math.max(20, Math.min(48, Math.round(W*H/45000)));
          for (let i=0;i<N;i++){
            const u = Math.random();
            const r = u < .5 ? (5 + Math.random()*8) : (u < .85 ? (12 + Math.random()*12) : (22 + Math.random()*20));
            state.parts.push({
              x: Math.random()*W,
              y: Math.random()*H,
              r,
              vx: (Math.random()*.35 - .175),
              vy: (Math.random()*.35 - .175),
              hue: palette[Math.floor(Math.random()*palette.length)],
              alpha: .08 + Math.random()*.24,
              drift: Math.random()*Math.PI*2,
              spin: .0015 + Math.random()*.0035
            });
          }
          const step = (t)=>{
            const now = t || performance.now();
            const dt = state.lastT ? Math.min(40, now - state.lastT) : 16;
            state.lastT = now;
            const W = sec.clientWidth, H = sec.clientHeight;
            const dpr = state.dpr;
            ctx.setTransform(dpr,0,0,dpr,0,0);
            ctx.clearRect(0,0,W,H);
            for (const p of state.parts){
              p.drift += p.spin*dt;
              p.x += p.vx + Math.cos(p.drift)*.05;
              p.y += p.vy + Math.sin(p.drift)*.05;
              if (p.x < -20) p.x = W+20; if (p.x > W+20) p.x = -20;
              if (p.y < -20) p.y = H+20; if (p.y > H+20) p.y = -20;
              ctx.globalAlpha = p.alpha;
              ctx.fillStyle = p.hue;
              ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
            }
            state.raf = requestAnimationFrame(step);
          };
          state.raf = requestAnimationFrame(step);
          window.addEventListener('resize', resize);
          state.resize = resize;
          if (window.ResizeObserver) {
            const ro = new ResizeObserver(resize);
            ro.observe(sec);
            state.observer = ro;
          }
          sectionParticlesStates.push(state);
        });
      } catch {}
    }
    function stopSectionParticles(){
      try {
        sectionParticlesStates.forEach(st => {
          cancelAnimationFrame(st.raf); st.raf=0;
          st.ctx?.clearRect(0,0,st.cvs.width, st.cvs.height);
          st.cvs.remove();
          st.observer?.disconnect();
          if (st.resize) window.removeEventListener('resize', st.resize);
        });
        sectionParticlesStates = [];
      } catch {}
    }

  let cardParticlesStates = [];
  function startCardParticles(){
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches)) return;
      stopCardParticles();
      const root = document.querySelector('section[data-route="/"]');
      if (!root) return;
      const cards = Array.from(root.querySelectorAll('.card'));
      cards.forEach(card => {
        const cvs = document.createElement('canvas');
        cvs.className = 'card-canvas';
        card.prepend(cvs);
        const ctx = cvs.getContext('2d');
        const state = { el: card, cvs, ctx, parts: [], raf: 0, lastT: 0, ro: null, dpr: 1 };
        const resize = ()=>{
          const rect = card.getBoundingClientRect();
          const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
          cvs.width = Math.floor(rect.width * dpr);
          cvs.height = Math.floor(rect.height * dpr);
          ctx.setTransform(dpr,0,0,dpr,0,0);
          state.dpr = dpr;
          return rect;
        };
        const rect = resize();
        const cs = getComputedStyle(document.documentElement);
        const palette = [
          cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
          cs.getPropertyValue('--orange').trim()||'#ffcba4',
          cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
          '#ffd9e6'
        ];
        const W = rect.width, H = rect.height;
        const area = Math.max(1, W*H);
        const isSmallScreen = true;
        const N = Math.max(8, Math.min(24, Math.round(area/52000)));
        for (let i=0;i<N;i++){
          const u = Math.random();
          const r = u < .5 ? (4 + Math.random()*7) : (u < .85 ? (10 + Math.random()*10) : (20 + Math.random()*18));
          state.parts.push({
            x: Math.random()*W,
            y: Math.random()*H,
            r,
            vx: (Math.random()*.28 - .14),
            vy: (Math.random()*.28 - .14),
            hue: palette[Math.floor(Math.random()*palette.length)],
            alpha: (.08) + Math.random()*.22,
            drift: Math.random()*Math.PI*2,
            spin: .001 + Math.random()*.003
          });
        }
        const step = (t)=>{
          const now = t || performance.now();
          const dt = state.lastT? Math.min(40, now - state.lastT) : 16;
          state.lastT = now;
          const W = card.clientWidth, H = card.clientHeight;
          const dpr = state.dpr;
          ctx.setTransform(dpr,0,0,dpr,0,0);
          ctx.clearRect(0,0,W,H);
          for (const p of state.parts){
            p.drift += p.spin*dt;
            p.x += p.vx + Math.cos(p.drift)*.04;
            p.y += p.vy + Math.sin(p.drift)*.04;
            if (p.x < -20) p.x = W+20; if (p.x > W+20) p.x = -20;
            if (p.y < -20) p.y = H+20; if (p.y > H+20) p.y = -20;
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.hue;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
          }
          state.raf = requestAnimationFrame(step);
        };
        state.raf = requestAnimationFrame(step);
        if (window.ResizeObserver) {
          const rObs = new ResizeObserver(resize);
          rObs.observe(card);
          state.ro = rObs;
        }
        cardParticlesStates.push(state);
      });
      const onR = ()=>{
        cardParticlesStates.forEach(st => {
          const rect = st.el.getBoundingClientRect();
          const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
          st.cvs.width = Math.floor(rect.width * dpr);
          st.cvs.height = Math.floor(rect.height * dpr);
          st.ctx.setTransform(dpr,0,0,dpr,0,0);
          st.dpr = dpr;
        });
      };
      window.addEventListener('resize', onR);
      startCardParticles._resize = onR;
    } catch {}
  }
  function stopCardParticles(){
    try {
      (cardParticlesStates||[]).forEach(st => { cancelAnimationFrame(st.raf); st.raf=0; st.ctx?.clearRect(0,0,st.cvs.width, st.cvs.height); st.cvs.remove(); st.ro?.disconnect(); });
      cardParticlesStates = [];
      if (startCardParticles._resize) window.removeEventListener('resize', startCardParticles._resize);
      startCardParticles._resize = null;
    } catch {}
  }

  // Boutons d’authentification de l’en-tête
  function updateHeaderAuth() {
    const logged = isProfileLoggedIn();
    $('#btn-login').hidden = logged;
    $('#btn-logout').hidden = !logged;
    $('#login-status').hidden = !logged;
  }

  function setActiveProfile(profile) {
    if (profile && profile.id) {
      const previous = activeProfile || {};
      const hasFullName = Object.prototype.hasOwnProperty.call(profile, 'full_name');
      const hasCode = Object.prototype.hasOwnProperty.call(profile, 'code_unique');
      const hasUserId = Object.prototype.hasOwnProperty.call(profile, 'user_id');
      const hasAnon = Object.prototype.hasOwnProperty.call(profile, 'isAnonymous');
      const hasAvatar = Object.prototype.hasOwnProperty.call(profile, 'avatar_url');
      const hasRole = Object.prototype.hasOwnProperty.call(profile, 'parent_role');
      const hasShowChildren = Object.prototype.hasOwnProperty.call(profile, 'show_children_count');
      const hasContext = Object.prototype.hasOwnProperty.call(profile, 'context_parental');

      activeProfile = {
        id: profile.id,
        full_name: hasFullName ? (profile.full_name || '') : (previous.full_name || ''),
        code_unique: hasCode
          ? (profile.code_unique ? String(profile.code_unique).trim().toUpperCase() : null)
          : previous.code_unique ?? null,
        user_id: hasUserId ? (profile.user_id ?? null) : previous.user_id ?? null,
        isAnonymous: hasAnon ? !!profile.isAnonymous : !!(previous.isAnonymous),
        avatar_url: hasAvatar ? profile.avatar_url ?? null : previous.avatar_url ?? null,
        parent_role: hasRole ? profile.parent_role ?? null : previous.parent_role ?? null,
        show_children_count: hasShowChildren
          ? profile.show_children_count ?? null
          : previous.show_children_count ?? null,
        marital_status: Object.prototype.hasOwnProperty.call(profile, 'marital_status')
          ? profile.marital_status ?? previous.marital_status ?? null
          : previous.marital_status ?? null,
        number_of_children: Object.prototype.hasOwnProperty.call(profile, 'number_of_children')
          ? (Number.isFinite(profile.number_of_children) ? Number(profile.number_of_children) : null)
          : (Number.isFinite(previous.number_of_children) ? Number(previous.number_of_children) : null),
        parental_employment: Object.prototype.hasOwnProperty.call(profile, 'parental_employment')
          ? profile.parental_employment ?? previous.parental_employment ?? null
          : previous.parental_employment ?? null,
        parental_emotion: Object.prototype.hasOwnProperty.call(profile, 'parental_emotion')
          ? profile.parental_emotion ?? previous.parental_emotion ?? null
          : previous.parental_emotion ?? null,
        parental_stress: Object.prototype.hasOwnProperty.call(profile, 'parental_stress')
          ? profile.parental_stress ?? previous.parental_stress ?? null
          : previous.parental_stress ?? null,
        parental_fatigue: Object.prototype.hasOwnProperty.call(profile, 'parental_fatigue')
          ? profile.parental_fatigue ?? previous.parental_fatigue ?? null
          : previous.parental_fatigue ?? null,
        context_parental: hasContext
          ? (profile.context_parental && typeof profile.context_parental === 'object'
              ? profile.context_parental
              : (profile.context_parental ?? null))
          : (previous.context_parental ?? null),
      };
      activeProfile.full_name = typeof activeProfile.full_name === 'string' ? activeProfile.full_name : '';
      activeProfile.parent_role = activeProfile.parent_role ?? '';
      activeProfile.isAnonymous = !!activeProfile.isAnonymous;
      if (activeProfile.context_parental && typeof activeProfile.context_parental !== 'object') {
        activeProfile.context_parental = null;
      }
      activeProfile.avatar_url = activeProfile.avatar_url ?? null;
      activeProfile.avatar = activeProfile.avatar_url;
      activeProfile.contexte = activeProfile.context_parental;
      if (activeProfile.show_children_count == null) {
        activeProfile.show_children_count = false;
      } else {
        activeProfile.show_children_count = !!activeProfile.show_children_count;
      }
    } else {
      activeProfile = null;
    }
    dashboardState.profileId = activeProfile?.id || null;
    if (activeProfile && activeProfile.isAnonymous && activeProfile.code_unique) {
      store.set(K.session, {
        type: 'anon',
        code: activeProfile.code_unique,
        id: activeProfile.id,
        fullName: activeProfile.full_name || '',
        loggedIn: true
      });
    } else {
      try { store.del(K.session); } catch {}
    }
    updateHeaderAuth();
    if (activeProfile && activeProfile.isAnonymous) {
      try {
        setupRealtimeNotifications();
        updateBadgeFromStore();
        fetchMissedNotifications();
        if (!hasBootedNotifs()) { replayUnseenNotifs(); markBootedNotifs(); }
      } catch (err) {
        console.warn('Anonymous notifications init failed', err);
      }
    } else {
      stopAnonNotifPolling();
    }
  }

  function restoreAnonSession() {
    try {
      const saved = store.get(K.session);
      if (saved?.type === 'anon' && saved?.code) {
        setActiveProfile({
          id: saved.id,
          full_name: saved.fullName || '',
          code_unique: saved.code,
          user_id: null,
          isAnonymous: true,
        });
        const currentHash = location?.hash || '';
        if (currentHash === '' || currentHash === '#' || currentHash === '#/login' || currentHash === '#/signup') {
          location.hash = '#/dashboard';
        }
        return true;
      }
    } catch {}
    return false;
  }

  // Garantir l’existence d’une ligne profil pour l’utilisateur authentifié sans écraser son pseudo
  async function ensureProfile(user){
    try {
      if (!supabase || !user?.id) return;
      const uid = user.id;
      const metaName = user.user_metadata?.full_name || user.email || '';
      // Vérifier si un profil existe déjà
      const { data: existing, error: selErr } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('id', uid)
        .maybeSingle();
      if (selErr) throw selErr;
      if (!existing) {
        // Insérer un nouveau profil avec les métadonnées par défaut (pas d’avatar)
        await supabase.from('profiles').insert({ id: uid, full_name: metaName });
      } else {
        // Ne pas écraser un full_name choisi par l’utilisateur ; rien d’autre à mettre à jour
      }
    } catch (e) {
      if (DEBUG_AUTH) console.warn('ensureProfile failed', e);
    }
  }

  // Garder le pseudo local synchronisé avec le profil Supabase
  async function syncUserFromSupabase() {
    try {
      if (isAnonProfile()) {
        const parentAccess = dataProxy.parentUpdates();
        const res = await parentAccess.callAnon('profile', {});
        const profileRow = res?.profile || null;
        if (profileRow) {
          setActiveProfile({ ...profileRow, isAnonymous: true });
          const current = store.get(K.user) || {};
          const pseudo = profileRow.full_name || current.pseudo || '';
          if (pseudo !== current.pseudo) {
            store.set(K.user, { ...current, pseudo });
          }
        }
        return;
      }
      const ok = await ensureSupabaseClient();
      if (!ok || !supabase) return;
      const uid = authSession?.user?.id || getActiveProfileId();
      if (!uid) return;
      const { data: prof, error } = await supabase
        .from('profiles')
        .select('id, full_name, code_unique, avatar_url, parent_role, show_children_count, marital_status, number_of_children, parental_employment, parental_emotion, parental_stress, parental_fatigue, context_parental')
        .eq('id', uid)
        .maybeSingle();
      if (error) throw error;
      if (prof) {
        setActiveProfile({ ...prof, isAnonymous: false });
      } else {
        setActiveProfile({ id: uid, isAnonymous: false });
      }
      const current = store.get(K.user) || {};
      const pseudo = prof?.full_name || current.pseudo || '';
      if (pseudo !== current.pseudo) {
        store.set(K.user, { ...current, pseudo });
      }
    } catch (e) {
      if (DEBUG_AUTH) console.warn('syncUserFromSupabase failed', e);
    }
  }
    async function ensureSupabaseClient() {
      if (supabase) return true;
      try {
        supabase = await getSupabaseClient();
        return !!supabase;
      } catch (e) {
        console.warn('ensureSupabaseClient failed', e);
        return false;
      }
    }

  async function signInGoogle(){
    try {
      const ok = await ensureSupabaseClient();
      if (!ok) throw new Error('Supabase indisponible');
      await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } });
    } catch (e) { alert('Connexion Google indisponible'); }
  }
  async function createAnonymousProfile() {
    const status = $('#anon-create-status');
    const btn = $('#btn-create-anon');
    if (btn?.dataset.busy === '1') return;
    status?.classList.remove('error');
    if (status) status.textContent = '';
    const ok = await ensureSupabaseClient();
    if (!ok) {
      if (status) { status.classList.add('error'); status.textContent = 'Service indisponible pour le moment.'; }
      return;
    }
    try {
      if (btn) { btn.dataset.busy = '1'; btn.disabled = true; }
      const response = await fetch('/api/profiles/create-anon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok || !payload?.profile) {
        const msg = payload?.error || 'Création impossible pour le moment.';
        const err = new Error(msg);
        if (payload?.details) err.details = payload.details;
        throw err;
      }
      const data = payload.profile;
      // Ne pas connecter automatiquement l’utilisateur : on lui fournit le code et on le laisse se connecter manuellement.
      setActiveProfile(null);
      authSession = null;
      if (status) {
        status.classList.remove('error');
        status.innerHTML = `Ton code unique : <strong>${data.code_unique}</strong>.<br>Garde-le précieusement et saisis-le juste en dessous dans « Se connecter avec un code ».`;
      }
      const inputCode = $('#anon-code-input');
      if (inputCode) {
        inputCode.value = data.code_unique || '';
        inputCode.focus();
        try { inputCode.select(); } catch {}
      }
    } catch (e) {
      console.error('createAnonymousProfile failed', e);
      if (status) {
        status.classList.add('error');
        const msg = (e && typeof e.message === 'string' && e.message.trim()) ? e.message : 'Création impossible pour le moment.';
        status.textContent = msg;
      }
    } finally {
      if (btn) { btn.dataset.busy = '0'; btn.disabled = false; }
    }
  }

  async function loginWithCode() {
    const input = $('#anon-code-input');
    const status = $('#anon-login-status');
    const btn = $('#btn-login-code');
    if (btn?.dataset.busy === '1') return;
    const rawCode = (input?.value || '').trim();
    const code = rawCode.toUpperCase();
    if (input) input.value = code;
    status?.classList.remove('error');
    if (!code) {
      if (status) { status.classList.add('error'); status.textContent = 'Saisis ton code unique pour continuer.'; }
      input?.focus();
      return;
    }
    if (status) status.textContent = '';
    try {
      if (btn) { btn.dataset.busy = '1'; btn.disabled = true; }
      const profile = await fetchAnonProfileByCode(code);
      setActiveProfile({ ...profile, isAnonymous: true });
      authSession = null;
      const current = store.get(K.user) || {};
      const pseudo = profile.full_name || current.pseudo || '';
      if (pseudo !== current.pseudo) {
        store.set(K.user, { ...current, pseudo });
      }
      if (status) { status.classList.remove('error'); status.textContent = ''; }
      if (input) input.value = '';
      location.hash = '#/dashboard';
    } catch (e) {
      console.error('loginWithCode failed', e);
      if (status) {
        status.classList.add('error');
        const msg = (e && typeof e.message === 'string') ? e.message : '';
        if (/code/i.test(msg) && /introuvable|invalid/i.test(msg)) {
          status.textContent = 'Code invalide.';
        } else if (/code/i.test(msg) && /manquant/i.test(msg)) {
          status.textContent = 'Saisis ton code unique pour continuer.';
        } else {
          status.textContent = 'Connexion impossible pour le moment.';
        }
      }
    } finally {
      if (btn) { btn.dataset.busy = '0'; btn.disabled = false; }
    }
  }

  function redirectToLogin() {
    const targetHash = '#/login';
    if (location.hash === targetHash) return;
    if (location.hash.startsWith('#/')) {
      location.hash = targetHash;
      return;
    }
    const path = location.pathname || '';
    if (path === '/' || path.endsWith('/') || path.endsWith('/index.html')) {
      location.hash = targetHash;
      return;
    }
    let basePath = path;
    if (path.endsWith('.html')) {
      basePath = path.replace(/[^/]*$/, '');
    } else if (!path.endsWith('/')) {
      basePath = `${path}/`;
    }
    if (!basePath.startsWith('/')) {
      basePath = `/${basePath}`;
    }
    location.href = `${basePath}${targetHash}`;
  }

  $('#btn-login').addEventListener('click', (e) => {
    e.preventDefault();
    redirectToLogin();
  });
  // Boutons des pages /login et /signup (délégation d’événements pour plus de robustesse)
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest('.btn-google-login') : null;
    if (t) {
      e.preventDefault();
      if (t.dataset.busy === '1') return;
      t.dataset.busy = '1';
      t.setAttribute('aria-disabled','true');
      signInGoogle();
    }
  });
  $('#btn-create-anon')?.addEventListener('click', (e) => {
    e.preventDefault();
    createAnonymousProfile();
  });

  $('#btn-login-code')?.addEventListener('click', (e) => {
    e.preventDefault();
    loginWithCode();
  });

  $('#anon-code-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      loginWithCode();
    }
  });

  $('#btn-logout').addEventListener('click', async (e) => {
    const btn = e.currentTarget; if (btn.dataset.busy==='1') return; btn.dataset.busy='1'; btn.disabled = true;
    try { if (authSession?.user) { await supabase?.auth.signOut(); } } catch {}
    setActiveProfile(null);
    authSession = null;
    try { if (supabase) { for (const ch of notifChannels) await supabase.removeChannel(ch); } } catch {}
    notifChannels = [];
    alert('Déconnecté.');
    updateHeaderAuth();
    location.hash = '#/login';
  });

  // Bascule du menu mobile
  navBtn?.addEventListener('click', () => {
    const isOpen = mainNav?.classList.toggle('open');
    navBtn.setAttribute('aria-expanded', String(!!isOpen));
    if (isOpen) navBackdrop?.classList.add('open'); else navBackdrop?.classList.remove('open');
  });
  // Ferme le menu lorsqu’un lien est cliqué (mobile)
  $$('.main-nav .nav-link').forEach(a => a.addEventListener('click', closeMobileNav));

  // Ferme le menu lors d’un appui sur l’arrière-plan
  navBackdrop?.addEventListener('click', closeMobileNav);

  // Parcours d’authentification
  $('#form-signup')?.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('Veuillez utiliser "Se connecter avec Google".');
    location.hash = '#/login';
  });

  $('#form-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (f.dataset.busy==='1') return; f.dataset.busy='1';
    const btn = f.querySelector('button[type="submit"],input[type="submit"]'); if (btn) btn.disabled = true;
    try { await signInGoogle(); } finally { /* redirect expected; keep disabled */ }
  });

  function logout() { /* replaced by supabase signOut above */ }

  // Contact (démo : enregistrement local)
  function setupContact(){
    const form = $('#form-contact');
    const status = $('#contact-status');
    if (!form) return;
    if (!form.dataset.bound) form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (form.dataset.busy === '1') return;
      form.dataset.busy = '1';
      const btn = form.querySelector('button[type="submit"],input[type="submit"]'); if (btn) btn.disabled = true;
      try {
        const fd = new FormData(form);
        const entry = {
          email: fd.get('email').toString(),
          subject: fd.get('subject').toString(),
          message: fd.get('message').toString(),
          createdAt: Date.now()
        };
        const msgs = store.get(K.messages, []);
        msgs.push(entry);
        store.set(K.messages, msgs);
        form.reset();
        if (status) status.textContent = 'Merci ! Votre message a été enregistré (démo locale).';
      } finally {
        form.dataset.busy = '0'; if (btn) btn.disabled = false;
      }
    }); form && (form.dataset.bound='1');
  }

  // Newsletter (démo: enregistrement local + feedback)
  function setupNewsletter(){
    const form = document.getElementById('form-newsletter');
    if (!form || form.dataset.bound) return;
    const emailInput = form.querySelector('input[type="email"]');
    const status = document.getElementById('newsletter-status');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!emailInput) return;
      // Champ piège anti-bot
      const fd = new FormData(form);
      const trap = (fd.get('website')||'').toString().trim();
      if (trap) { return; }
      // Validation côté client
      const email = (fd.get('email')||'').toString().trim();
      if (!email) {
        if (status){ status.textContent = 'Veuillez renseigner votre email.'; status.classList.add('error'); }
        emailInput.focus();
        return;
      }
      if (emailInput && emailInput.checkValidity && !emailInput.checkValidity()){
        if (status){ status.textContent = 'Adresse e‑mail invalide.'; status.classList.add('error'); }
        emailInput.focus();
        return;
      }
      if (status){ status.textContent = ''; status.classList.remove('error'); }
      if (form.dataset.busy==='1') return; form.dataset.busy='1';
      const btn = form.querySelector('button[type="submit"],input[type="submit"]'); if (btn) btn.disabled = true;
      try {
        // Démo locale: on stocke en localStorage puis feedback
        const list = store.get('pedia_newsletter', []);
        list.push({ email, createdAt: Date.now() });
        store.set('pedia_newsletter', list);
        form.reset();
        if (status){ status.textContent = 'Merci ! Vous êtes bien inscrit(e) à la newsletter.'; status.classList.remove('error'); }
      } finally {
        form.dataset.busy='0'; if (btn) btn.disabled = false;
      }
    });
    form.dataset.bound='1';
  }

  // --- Gestion de la page IA ---
  function setupAIPage(){
    const route = document.querySelector('section[data-route="/ai"]');
    if (!route) return;
    const instanceId = ++aiPageState.instance;
    aiPageState.currentChild = null;

    const isActiveInstance = () => aiPageState.instance === instanceId;
    const isRouteAttached = () => isActiveInstance() && document.body.contains(route);
    const setCurrentChild = (child) => {
      if (!isActiveInstance()) return;
      aiPageState.currentChild = child || null;
    };
    const getCurrentChild = () => (isActiveInstance() ? aiPageState.currentChild : null);

    const loadChild = async () => {
      if (useRemote()) {
        try {
          if (isAnonProfile()) {
            const childAccess = dataProxy.children();
            const list = await childAccess.callAnon('list', {});
            const rows = Array.isArray(list.children) ? list.children : [];
            if (!rows.length) {
              const user = store.get(K.user);
              const children = store.get(K.children, []);
              return children.find((c) => c.id === user?.primaryChildId) || children[0] || null;
            }
            const primaryRow = rows.find((x) => x.is_primary) || rows[0];
            if (!primaryRow) return null;
            const detail = await childAccess.callAnon('get', { childId: primaryRow.id });
            const data = detail.child;
            if (!data) return null;
            const child = mapRowToChild(data);
            if (!child) return null;
            const growth = detail.growth || {};
            (growth.measurements || []).forEach((m) => {
              const h = Number(m?.height_cm);
              const w = Number(m?.weight_kg);
              const heightValid = Number.isFinite(h);
              const weightValid = Number.isFinite(w);
              child.growth.measurements.push({
                month: m.month,
                height: heightValid ? h : null,
                weight: weightValid ? w : null,
                bmi: heightValid && weightValid && h ? w / Math.pow(h / 100, 2) : null,
                measured_at: m.created_at,
              });
            });
            (growth.sleep || []).forEach((s) => child.growth.sleep.push({ month: s.month, hours: s.hours }));
            (growth.teeth || []).forEach((t) => child.growth.teeth.push({ month: t.month, count: t.count }));
            return child;
          }
          const uid = authSession?.user?.id || getActiveProfileId();
          if (!uid) {
            console.warn('Aucun user_id disponible pour la requête children (loadChild) — fallback local');
            const user = store.get(K.user);
            const children = store.get(K.children, []);
            return children.find((c) => c.id === user?.primaryChildId) || children[0] || null;
          }
          const { data: rows } = await supabase
            .from('children')
            .select('*')
            .eq('user_id', uid)
            .order('created_at', { ascending: true });
          const r = (rows || []).find((x) => x.is_primary) || (rows || [])[0];
          if (r) {
            const child = mapRowToChild(r);
            if (!child) return null;
            try {
              const [{ data: gm }, { data: gs }, { data: gt }] = await Promise.all([
                supabase.from('growth_measurements').select('month,height_cm,weight_kg,created_at').eq('child_id', r.id),
                supabase.from('growth_sleep').select('month,hours').eq('child_id', r.id),
                supabase.from('growth_teeth').select('month,count').eq('child_id', r.id),
              ]);
              (gm || [])
                .map((m) => {
                  const h = m.height_cm == null ? null : Number(m.height_cm);
                  const w = m.weight_kg == null ? null : Number(m.weight_kg);
                  return {
                    month: m.month,
                    height: h,
                    weight: w,
                    bmi: w && h ? w / Math.pow(h / 100, 2) : null,
                    measured_at: m.created_at,
                  };
                })
                .forEach((m) => child.growth.measurements.push(m));
              (gs || []).forEach((s) => child.growth.sleep.push({ month: s.month, hours: s.hours }));
              (gt || []).forEach((t) => child.growth.teeth.push({ month: t.month, count: t.count }));
            } catch {}
            return child;
          }
        } catch {}
      } else {
        const user = store.get(K.user);
        const children = store.get(K.children, []);
        const c = children.find((child) => child.id === user?.primaryChildId) || children[0];
        if (c) return c;
      }
      return null;
    };

    const loadChildById = async (id) => {
      if (!id) return null;
      if (useRemote()) {
        try {
          if (isAnonProfile()) {
            const childAccess = dataProxy.children();
            const detail = await childAccess.callAnon('get', { childId: id });
            const data = detail.child;
            if (!data) return null;
            const ch = mapRowToChild(data);
            if (!ch) return null;
            const growth = detail.growth || {};
            (growth.measurements || []).forEach((m) => {
              const h = Number(m?.height_cm);
              const w = Number(m?.weight_kg);
              const heightValid = Number.isFinite(h);
              const weightValid = Number.isFinite(w);
              ch.growth.measurements.push({
                month: m.month,
                height: heightValid ? h : null,
                weight: weightValid ? w : null,
                bmi: heightValid && weightValid && h ? w / Math.pow(h / 100, 2) : null,
                measured_at: m.created_at,
              });
            });
            (growth.sleep || []).forEach((s) => ch.growth.sleep.push({ month: s.month, hours: s.hours }));
            (growth.teeth || []).forEach((t) => ch.growth.teeth.push({ month: t.month, count: t.count }));
            return ch;
          }
          const uid = getActiveProfileId();
          if (!uid) {
            console.warn('Aucun user_id disponible pour la requête children (loadChildById) — fallback local');
            const children = store.get(K.children, []);
            return children.find((c) => c.id === id) || null;
          }
          const { data: r } = await supabase.from('children').select('*').eq('id', id).maybeSingle();
          if (!r) return null;
          const ch = mapRowToChild(r);
          if (!ch) return null;
          try {
            const [{ data: gm }, { data: gs }, { data: gt }] = await Promise.all([
              supabase.from('growth_measurements').select('month,height_cm,weight_kg,created_at').eq('child_id', r.id),
              supabase.from('growth_sleep').select('month,hours').eq('child_id', r.id),
              supabase.from('growth_teeth').select('month,count').eq('child_id', r.id),
            ]);
            (gm || [])
              .map((m) => {
                const h = m.height_cm == null ? null : Number(m.height_cm);
                const w = m.weight_kg == null ? null : Number(m.weight_kg);
                return {
                  month: m.month,
                  height: h,
                  weight: w,
                  bmi: w && h ? w / Math.pow(h / 100, 2) : null,
                  measured_at: m.created_at,
                };
              })
              .forEach((m) => ch.growth.measurements.push(m));
            (gs || []).forEach((s) => ch.growth.sleep.push({ month: s.month, hours: s.hours }));
            (gt || []).forEach((t) => ch.growth.teeth.push({ month: t.month, count: t.count }));
          } catch {}
          return ch;
        } catch {
          return null;
        }
      }
      const children = store.get(K.children, []);
      return children.find((c) => c.id === id) || null;
    };

    const chatKey = (c) => `pedia_ai_chat_${c?.id || 'anon'}`;
    const loadChat = (c) => {
      try {
        return JSON.parse(localStorage.getItem(chatKey(c)) || '[]');
      } catch {
        return [];
      }
    };
    const saveChat = (c, arr) => {
      try {
        localStorage.setItem(chatKey(c), JSON.stringify(arr.slice(-20)));
      } catch {}
    };
    const renderChat = (arr) => {
      if (!isRouteAttached()) return;
      const el = document.getElementById('ai-chat-messages');
      if (!el || !document.body.contains(el)) return;
      const userRole = store.get(K.user)?.role;
      const userAvatar = userRole === 'papa' ? '👨' : '👩';
      el.innerHTML = arr
        .map((m) => {
          const role = m.role === 'user' ? 'user' : 'assistant';
          const avatar = role === 'user' ? userAvatar : '🤖';
          const label = role === 'user' ? 'Vous' : 'Assistant';
          return `<div class=\"chat-line ${role}\"><div class=\"avatar\">${avatar}</div><div class=\"message\"><div class=\"meta\">${label}</div><div class=\"bubble ${role}\">${escapeHtml(m.content).replace(/\\n/g,'<br/>')}</div></div></div>`;
        })
        .join('');
      safeScrollTo(el, { top: el.scrollHeight, behavior: 'smooth' });
    };

    const fRecipes = document.getElementById('form-ai-recipes');
    const sRecipes = document.getElementById('ai-recipes-status');
    const outRecipes = document.getElementById('ai-recipes-result');
    if (fRecipes) {
      if (fRecipes._aiSubmitHandler) {
        fRecipes.removeEventListener('submit', fRecipes._aiSubmitHandler);
      }
      const handleRecipesSubmit = async (e) => {
        e.preventDefault();
        if (!isActiveInstance()) return;
        if (fRecipes.dataset.busy === '1') return;
        fRecipes.dataset.busy = '1';
        const submitBtn = fRecipes.querySelector('button[type="submit"],input[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        const runId = aiPageState.instance;
        const child = getCurrentChild();
        if (!child) {
          if (outRecipes) outRecipes.innerHTML = '<div class="muted">Ajoutez un profil enfant pour des recommandations personnalisées.</div>';
          if (sRecipes) sRecipes.textContent = '';
          fRecipes.dataset.busy = '0';
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        const prefs = new FormData(fRecipes).get('prefs')?.toString() || '';
        if (sRecipes) sRecipes.textContent = 'Génération en cours…';
        if (outRecipes) outRecipes.innerHTML = '';
        try {
          const text = await askAIRecipes(child, prefs);
          if (aiPageState.instance !== runId || !isRouteAttached()) return;
          if (outRecipes) outRecipes.innerHTML = `<div>${escapeHtml(text).replace(/\n/g,'<br/>')}</div>`;
        } catch (err) {
          if (aiPageState.instance !== runId || !isRouteAttached()) return;
          const msg = err instanceof Error && err.message ? err.message : 'Serveur IA indisponible.';
          if (outRecipes) outRecipes.innerHTML = `<div class="muted">${escapeHtml(msg)}</div>`;
        } finally {
          if (aiPageState.instance === runId) {
            if (sRecipes) sRecipes.textContent = '';
            fRecipes.dataset.busy = '0';
            if (submitBtn) submitBtn.disabled = false;
          }
        }
      };
      fRecipes.addEventListener('submit', handleRecipesSubmit);
      fRecipes._aiSubmitHandler = handleRecipesSubmit;
    }

    const fStory = document.getElementById('form-ai-story');
    const sStory = document.getElementById('ai-story-status');
    const outStory = document.getElementById('ai-story-result');
    if (fStory) {
      if (fStory._aiSubmitHandler) {
        fStory.removeEventListener('submit', fStory._aiSubmitHandler);
      }
      const handleStorySubmit = async (e) => {
        e.preventDefault();
        if (!isActiveInstance()) return;
        if (fStory.dataset.busy === '1') return;
        fStory.dataset.busy = '1';
        const submitBtn = fStory.querySelector('button[type="submit"],input[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        const runId = aiPageState.instance;
        const child = getCurrentChild();
        if (!child) {
          if (outStory) outStory.innerHTML = '<div class="muted">Ajoutez un profil enfant pour générer une histoire personnalisée.</div>';
          if (sStory) sStory.textContent = '';
          fStory.dataset.busy = '0';
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        const fd = new FormData(fStory);
        const theme = fd.get('theme')?.toString() || '';
        const duration = parseInt(fd.get('duration')?.toString() || '3', 10);
        const sleepy = !!fd.get('sleepy');
        if (sStory) sStory.textContent = 'Génération en cours…';
        if (outStory) outStory.innerHTML = '';
        try {
          const text = await askAIStory(child, { theme, duration, sleepy });
          if (aiPageState.instance !== runId || !isRouteAttached()) return;
          if (outStory) outStory.innerHTML = `<div>${escapeHtml(text).replace(/\n/g,'<br/>')}</div>`;
        } catch (err) {
          if (aiPageState.instance !== runId || !isRouteAttached()) return;
          const msg = err instanceof Error && err.message ? err.message : 'Serveur IA indisponible.';
          if (outStory) outStory.innerHTML = `<div class="muted">${escapeHtml(msg)}</div>`;
        } finally {
          if (aiPageState.instance === runId) {
            if (sStory) sStory.textContent = '';
            fStory.dataset.busy = '0';
            if (submitBtn) submitBtn.disabled = false;
          }
        }
      };
      fStory.addEventListener('submit', handleStorySubmit);
      fStory._aiSubmitHandler = handleStorySubmit;
    }

    const fImage = document.getElementById('form-ai-image');
    const sImage = document.getElementById('ai-image-status');
    const errorImage = document.getElementById('ai-image-error');
    const figureImage = document.getElementById('ai-image-result');
    const imgPreview = figureImage?.querySelector('img');
    const statusMessage = document.getElementById('generation-status');
    const spinnerImage = document.getElementById('ai-image-spinner');
    if (fImage) {
      if (fImage._aiSubmitHandler) {
        fImage.removeEventListener('submit', fImage._aiSubmitHandler);
      }
      const handleImageSubmit = async (e) => {
        e.preventDefault();
        if (!isActiveInstance()) return;
        if (fImage.dataset.busy === '1') return;
        const fd = new FormData(fImage);
        const prompt = fd.get('prompt')?.toString().trim();
        if (!prompt) {
          if (sImage) sImage.textContent = 'Décrivez une scène pour lancer la génération.';
          return;
        }
        console.info('[AI image] Génération demandée', { promptLength: prompt.length, preview: prompt.slice(0, 80) });
        fImage.dataset.busy = '1';
        const runToken = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        fImage.dataset.runToken = runToken;
        const submitBtn = fImage.querySelector('button[type="submit"],input[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        if (sImage) sImage.textContent = '';
        if (errorImage) {
          errorImage.textContent = '';
          errorImage.hidden = true;
        }
        if (figureImage) figureImage.hidden = true;
        if (imgPreview) imgPreview.removeAttribute('src');
        if (spinnerImage) spinnerImage.hidden = false;

        const statusTimers = [];
        let hideStatusTimeout = null;
        let statusActive = false;
        const clearStatusTimers = () => {
          statusTimers.forEach(clearTimeout);
          statusTimers.length = 0;
          if (hideStatusTimeout) {
            clearTimeout(hideStatusTimeout);
            hideStatusTimeout = null;
          }
        };
        const setStatusText = (text) => {
          if (!statusMessage) return;
          const activeToken = fImage.dataset.runToken;
          if (activeToken && activeToken !== runToken) return;
          statusMessage.hidden = false;
          statusMessage.textContent = text;
        };
        const startStatusSequence = () => {
          statusActive = true;
          setStatusText('✨ Ton image est en préparation…');
          statusTimers.push(
            setTimeout(() => {
              if (statusActive) setStatusText('⌛ Ça prend quelques secondes, merci de ta patience 🙏');
            }, 4000),
          );
          statusTimers.push(
            setTimeout(() => {
              if (statusActive) setStatusText('🎨 L’IA met les dernières touches à ton illustration…');
            }, 8000),
          );
        };
        const showSuccessStatus = () => {
          statusActive = false;
          clearStatusTimers();
          setStatusText('✅ Ton image est prête !');
          hideStatusTimeout = setTimeout(() => {
            if (!statusMessage) return;
            const activeToken = fImage.dataset.runToken;
            if (activeToken && activeToken !== runToken) return;
            statusMessage.hidden = true;
            statusMessage.textContent = '';
          }, 1200);
        };
        const showFailureStatus = () => {
          statusActive = false;
          clearStatusTimers();
          setStatusText('❌ Impossible de générer l’image pour le moment.');
        };
        const showSpinner = () => {
          if (!spinnerImage) return;
          const activeToken = fImage.dataset.runToken;
          if (activeToken && activeToken !== runToken) return;
          spinnerImage.hidden = false;
        };
        const hideSpinner = () => {
          if (!spinnerImage) return;
          const activeToken = fImage.dataset.runToken;
          if (activeToken && activeToken !== runToken) return;
          spinnerImage.hidden = true;
        };

        showSpinner();
        startStatusSequence();
        const runId = aiPageState.instance;

        try {
          const res = await fetch('/api/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
          });
          const raw = await res.text();
          console.info('[AI image] Réponse reçue', { status: res.status, ok: res.ok, bodySize: raw?.length ?? 0 });
          if (!res.ok) {
            let msg = 'Impossible de générer l’illustration pour le moment.';
            try {
              const payload = JSON.parse(raw || '{}');
              const basic = payload?.error || payload?.message;
              const detail = payload?.details || payload?.error?.message;
              msg = [basic || msg, detail].filter(Boolean).join(' — ');
            } catch {}
            throw new Error(msg);
          }
          let payload = {};
          try {
            payload = JSON.parse(raw || '{}');
          } catch {
            payload = { image: raw };
          }
          const rawImage = payload?.image || payload?.base64 || payload?.data || payload?.result || '';
          const mime = typeof payload?.mime === 'string' ? payload.mime : 'image/png';
          const dataUrl = rawImage.startsWith('data:')
            ? rawImage
            : (rawImage ? `data:${mime.startsWith('image/') ? mime : 'image/png'};base64,${rawImage}` : '');
          if (!dataUrl) throw new Error('Réponse image invalide.');
          if (aiPageState.instance !== runId || !isRouteAttached()) return;
          if (imgPreview) {
            imgPreview.src = dataUrl;
          }
          if (figureImage) figureImage.hidden = false;
          if (errorImage) {
            errorImage.textContent = '';
            errorImage.hidden = true;
          }
          hideSpinner();
          showSuccessStatus();
          if (sImage) sImage.textContent = '';
        } catch (err) {
          if (aiPageState.instance !== runId || !isRouteAttached()) return;
          console.error('[AI image] Erreur', err);
          const message = err instanceof Error ? err.message : 'Illustration indisponible.';
          if (errorImage) {
            errorImage.textContent = message;
            errorImage.hidden = false;
          }
          hideSpinner();
          showFailureStatus();
          if (sImage) sImage.textContent = '';
        } finally {
          hideSpinner();
          fImage.dataset.busy = '0';
          const submitBtnFinal = fImage.querySelector('button[type="submit"],input[type="submit"]');
          if (submitBtnFinal) submitBtnFinal.disabled = false;
        }
      };
      fImage.addEventListener('submit', handleImageSubmit);
      fImage._aiSubmitHandler = handleImageSubmit;
    }

    const fChat = document.getElementById('form-ai-chat');
    const sChat = document.getElementById('ai-chat-status');
    const msgsEl = document.getElementById('ai-chat-messages');
    const btnReset = document.getElementById('ai-chat-reset');
    const txtChat = fChat?.querySelector('textarea[name="q"]');
    if (txtChat) {
      if (txtChat._aiPlaceholderInterval) {
        clearInterval(txtChat._aiPlaceholderInterval);
      }
      const placeholders = ['Écris ici…', 'Pose ta question…', 'Dis-moi tout…'];
      let idx = 0;
      txtChat._aiPlaceholderInterval = setInterval(() => {
        if (document.activeElement !== txtChat) {
          idx = (idx + 1) % placeholders.length;
          txtChat.placeholder = placeholders[idx];
        }
      }, 4000);
    }
    if (btnReset) {
      if (btnReset._aiClickHandler) {
        btnReset.removeEventListener('click', btnReset._aiClickHandler);
      }
      const handleReset = (e) => {
        e.preventDefault();
        const child = getCurrentChild();
        const key = chatKey(child);
        try {
          localStorage.removeItem(key);
        } catch {}
        renderChat([]);
        if (sChat) sChat.textContent = '';
      };
      btnReset.addEventListener('click', handleReset);
      btnReset._aiClickHandler = handleReset;
    }
    if (fChat) {
      if (fChat._aiSubmitHandler) {
        fChat.removeEventListener('submit', fChat._aiSubmitHandler);
      }
      const handleChatSubmit = async (e) => {
        e.preventDefault();
        if (!isActiveInstance()) return;
        if (fChat.dataset.busy === '1') return;
        fChat.dataset.busy = '1';
        const submitBtn = fChat.querySelector('button[type="submit"],input[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        const runId = aiPageState.instance;
        const child = getCurrentChild();
        const childId = child && child.id != null ? String(child.id) : 'anon';
        const q = new FormData(fChat).get('q')?.toString().trim();
        if (!q) {
          fChat.dataset.busy = '0';
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        if (sChat) sChat.textContent = 'Réflexion en cours…';
        const history = loadChat(child);
        history.push({ role: 'user', content: q });
        saveChat(child, history);
        renderChat(history);
        document.getElementById('ai-typing')?.remove();
        const typing = document.createElement('div');
        typing.id = 'ai-typing';
        typing.className = 'chat-line assistant';
        typing.innerHTML = '<div class="avatar">🤖</div><div class="message"><div class="bubble assistant"><span class="typing"><span></span><span></span><span></span></span></div></div>';
        if (msgsEl && document.body.contains(msgsEl)) {
          msgsEl.appendChild(typing);
          safeScrollTo(msgsEl, { top: msgsEl.scrollHeight, behavior: 'smooth' });
        }
        try {
          const resp = await askAI(q, child, history);
          const active = getCurrentChild();
          const activeId = active && active.id != null ? String(active.id) : 'anon';
          if (aiPageState.instance !== runId || activeId !== childId || !isRouteAttached()) return;
          const newH = loadChat(child);
          newH.push({ role: 'assistant', content: resp });
          saveChat(child, newH);
          renderChat(newH);
        } catch (err) {
          const active = getCurrentChild();
          const activeId = active && active.id != null ? String(active.id) : 'anon';
          if (aiPageState.instance !== runId || activeId !== childId || !isRouteAttached()) return;
          const msg = err instanceof Error && err.message ? err.message : String(err || 'IA indisponible');
          const newH = loadChat(child);
          newH.push({ role: 'assistant', content: `[Erreur IA] ${msg}` });
          saveChat(child, newH);
          renderChat(newH);
        } finally {
          document.getElementById('ai-typing')?.remove();
          if (aiPageState.instance === runId) {
            if (sChat) sChat.textContent = '';
            fChat.dataset.busy = '0';
            if (submitBtn) submitBtn.disabled = false;
          }
        }
      };
      fChat.addEventListener('submit', handleChatSubmit);
      fChat._aiSubmitHandler = handleChatSubmit;
    }

    const renderIndicator = async (child) => {
      if (!isRouteAttached()) return;
      const container = route.querySelector('.stack');
      if (!container) return;
      let box = document.getElementById('ai-profile-indicator');
      if (!box) {
        box = document.createElement('div');
        box.id = 'ai-profile-indicator';
        box.className = 'card';
      }
      container.insertBefore(box, container.firstChild);
      const slim = await listChildrenSlim();
      if (!isActiveInstance()) return;
      if (!child || !slim.length) {
        box.innerHTML = '<div class="muted">Aucun profil enfant chargé pour l’IA. <a href="#/onboarding">Créer un profil</a>.</div>';
        return;
      }
      const ageTxt = formatAge(child.dob);
      const selectedId = child.id;
      const opts = slim
        .map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.firstName)}${c.dob ? ` • ${formatAge(c.dob)}` : ''}</option>`)
        .join('');
      box.className = 'ai-child-selector';
      const ctx = child.context || {};
      const safeAge = ageTxt ? escapeHtml(ageTxt) : '';
      const allergies = (ctx.allergies || '').trim();
      const safeAllergies = allergies ? escapeHtml(allergies) : '';
      const feeding = labelFeedingType(ctx.feedingType);
      const safeFeeding = feeding && feeding !== '—' ? escapeHtml(feeding) : '';
      const summaryParts = [];
      if (safeAge) summaryParts.push(`Âge : ${safeAge}`);
      if (safeAllergies) summaryParts.push(`Allergies : ${safeAllergies}`);
      if (safeFeeding) summaryParts.push(`Alimentation : ${safeFeeding}`);
      const summary = summaryParts.join(' • ');
      const safeName = escapeHtml(child.firstName);
      box.innerHTML = `
        <div class="ai-child-switcher">
          <label for="ai-child-switcher">
            <span class="ai-child-label">Enfant suivi</span>
            <div class="ai-child-select">
              <span class="ai-child-icon" aria-hidden="true">👶</span>
              <select id="ai-child-switcher" aria-label="Sélectionner un enfant">${opts}</select>
              <span class="ai-child-caret" aria-hidden="true">▾</span>
            </div>
          </label>
          <p class="ai-child-hint">${summary ? `${safeName} • ${summary}` : safeName}</p>
        </div>`;
      const sel = box.querySelector('#ai-child-switcher');
      if (sel) {
        if (sel._aiChangeHandler) {
          sel.removeEventListener('change', sel._aiChangeHandler);
        }
        const handleChange = async (e) => {
          const id = e.currentTarget.value;
          await setPrimaryChild(id);
          const nextChild = await loadChildById(id);
          if (!isActiveInstance()) return;
          setCurrentChild(nextChild);
          await renderIndicator(nextChild);
          if (!isActiveInstance()) return;
          renderChat(loadChat(nextChild));
          const outR = document.getElementById('ai-recipes-result');
          if (outR) outR.innerHTML = '';
          const outS = document.getElementById('ai-story-result');
          if (outS) outS.innerHTML = '';
        };
        sel.addEventListener('change', handleChange);
        sel._aiChangeHandler = handleChange;
      }
    };

    (async () => {
      const child = await loadChild();
      if (!isActiveInstance()) return;
      setCurrentChild(child);
      await renderIndicator(child);
      if (!isActiveInstance()) return;
      renderChat(loadChat(child));
      const m = document.getElementById('ai-chat-messages');
      if (m) safeScrollTo(m, { top: m.scrollHeight, behavior: 'smooth' });
    })();
  }

  // Onboarding

  function renderOnboarding() {
    const container = $('#dev-questions');
    if (!container) return;
    container.innerHTML = '';

    // Construire 3 sections avec titres et 10 cases à cocher chacune
    const groups = [
      { title: '0 – 12 mois', start: 0, end: 9 },
      { title: '12 – 24 mois', start: 10, end: 19 },
      { title: '24 – 36 mois', start: 20, end: 29 },
    ];

    groups.forEach(g => {
      const sec = document.createElement('section');
      sec.className = 'dev-group';
      const h = document.createElement('h4');
      h.textContent = g.title;
      const grid = document.createElement('div');
      grid.className = 'qgrid';
      for (let i = g.start; i <= g.end; i++) {
        const q = DEV_QUESTIONS[i];
        const id = `ms_${i}`;
        const item = document.createElement('div');
        item.className = 'qitem';
        // Case avec name milestones[] pour que FormData regroupe les valeurs (on lit .checked pour inclure les faux)
        item.innerHTML = `
          <input type="checkbox" id="${id}" name="milestones[]" data-index="${i}" />
          <label for="${id}">${q.label}</label>
        `;
        grid.appendChild(item);
      }
      sec.appendChild(h);
      sec.appendChild(grid);
      container.appendChild(sec);
    });

    const form = $('#form-child');
    if (form && !form.dataset.bound) {
      // Fonction d’envoi du profil enfant vers Supabase
      async function saveChildProfile(child) {
        const uid = getActiveProfileId();
        if (!uid) throw new Error('Profil utilisateur introuvable');
        const childAccess = dataProxy.children();
        const supaClient = childAccess.isSupabase ? await childAccess.getClient() : null;
        const storedChildren = Array.isArray(settingsState.children) && settingsState.children.length
          ? settingsState.children
          : (store.get(K.children, []) || []);
        const hasPrimaryLocally = storedChildren.some((entry) => {
          if (!entry) return false;
          if (typeof entry.isPrimary === 'boolean') return entry.isPrimary;
          if (typeof entry.is_primary === 'boolean') return entry.is_primary;
          return false;
        });
        let shouldBePrimary = !hasPrimaryLocally;
        if (childAccess.isSupabase && supaClient) {
          try {
            const { data: primaryRow, error: primaryError } = await supaClient
              .from('children')
              .select('id')
              .eq('user_id', uid)
              .eq('is_primary', true)
              .limit(1)
              .maybeSingle();
            if (primaryRow) {
              shouldBePrimary = false;
            } else if (primaryError && primaryError.code !== 'PGRST116') {
              throw primaryError;
            }
          } catch (primaryCheckError) {
            console.warn('Impossible de vérifier l’enfant principal', primaryCheckError);
          }
        }
        const payload = {
          user_id: uid,
          first_name: child.firstName,
          sex: child.sex,
          dob: child.dob,
          photo_url: child.photo,
          context_allergies: child.context.allergies,
          context_history: child.context.history,
          context_care: child.context.care,
          context_languages: child.context.languages,
          feeding_type: child.context.feedingType,
          eating_style: child.context.eatingStyle,
          sleep_falling: child.context.sleep.falling,
          sleep_sleeps_through: child.context.sleep.sleepsThrough,
          sleep_night_wakings: child.context.sleep.nightWakings,
          sleep_wake_duration: child.context.sleep.wakeDuration,
          sleep_bedtime: child.context.sleep.bedtime,
          milestones: child.milestones,
          is_primary: shouldBePrimary
        };
        const childPayload = normalizeChildPayloadForSupabase(payload);
        const measurementRecords = buildMeasurementPayloads(child.growth.measurements);
        const teethRecords = buildTeethPayloads(child.growth.teeth);
        const sleepRecords = buildSleepPayloads(child.growth.sleep);
        if (childAccess.isAnon) {
          await childAccess.callAnon('create', {
            child: childPayload,
            growthMeasurements: measurementRecords,
            growthTeeth: teethRecords,
            growthSleep: sleepRecords
          });
          return;
        }
        if (!supaClient) throw new Error('Supabase client unavailable');
        const { data: insChild, error: errC } = await supaClient
          .from('children')
          .insert([childPayload])
          .select('id')
          .single();
        if (errC) throw errC;
        const childId = assertValidChildId(insChild.id);
        const msPayload = measurementRecords.map(m => ({ ...m, child_id: childId }));
        if (msPayload.length) {
          await supaClient
            .from('growth_measurements')
            .upsert(msPayload, { onConflict: 'child_id,month' });
        }
        const teethPayloads = teethRecords.map(t => ({ ...t, child_id: childId }));
        if (teethPayloads.length) {
          await supaClient.from('growth_teeth').insert(teethPayloads);
        }
        const sleepPayloads = sleepRecords.map(s => ({ ...s, child_id: childId }));
        if (sleepPayloads.length) {
          await supaClient.from('growth_sleep').insert(sleepPayloads);
        }
      }

      form.dataset.bound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        // Anti double-clic + anti multi-bind
        if (form.dataset.busy === '1') return;
        form.dataset.busy = '1';
        const btn = form.querySelector('button[type="submit"],input[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Chargement...'; }
        try {
          const fd = new FormData(form);
          const dobStr = fd.get('dob').toString();
          const ageMAtCreation = ageInMonths(dobStr);
          const // lire 30 booléens dans l’ordre d’affichage (inclure les faux)
            msInputs = Array.from(document.querySelectorAll('#dev-questions input[name="milestones[]"]')),
            milestones = msInputs
              .sort((a,b)=> (Number(a.dataset.index||0) - Number(b.dataset.index||0)))
              .map(inp => !!inp.checked);

          const child = {
            id: genId(),
            firstName: fd.get('firstName').toString().trim(),
            sex: fd.get('sex').toString(),
            dob: dobStr,
            photo: null,
            context: {
              allergies: fd.get('allergies').toString(),
              history: fd.get('history').toString(),
              care: fd.get('care').toString(),
              languages: fd.get('languages').toString(),
              feedingType: fd.get('feedingType')?.toString() || '',
              eatingStyle: fd.get('eatingStyle')?.toString() || '',
              sleep: {
                falling: fd.get('sleep_falling')?.toString() || '',
                sleepsThrough: fd.get('sleep_through')?.toString() === 'oui',
                nightWakings: fd.get('sleep_wakings')?.toString() || '',
                wakeDuration: fd.get('sleep_wake_duration')?.toString() || '',
                bedtime: fd.get('sleep_bedtime')?.toString() || '',
              },
            },
            milestones,
            growth: {
              measurements: [], // {mois, taille, poids}
              sleep: [], // {mois, heures}
              teeth: [], // {mois, nombre}
            },
            createdAt: Date.now(),
          };
          // Mesures initiales si fournies
          const h = parseFloat(fd.get('height'));
          const w = parseFloat(fd.get('weight'));
          const t = parseInt(fd.get('teeth'));
          if (Number.isFinite(h)) child.growth.measurements.push({ month: ageMAtCreation, height: h });
          if (Number.isFinite(w)) child.growth.measurements.push({ month: ageMAtCreation, weight: w });
          if (Number.isFinite(t)) child.growth.teeth.push({ month: ageMAtCreation, count: t });
          if (!useRemote()) throw new Error('Backend indisponible');
          await saveChildProfile(child);
          invalidateSettingsRemoteCache();
          alert('Profil enfant créé.');
          if (btn) { btn.disabled = false; btn.textContent = 'Créer le profil'; }
          form.dataset.busy = '0';
          location.hash = '#/dashboard';
        } catch (err) {
          console.error('Erreur lors de la création du profil enfant', err);
          if (btn) { btn.disabled = false; btn.textContent = 'Réessayer'; }
          form.dataset.busy = '0';
        }
      });
    }
    }

  // Dashboard
  async function renderSettings() {
    const rid = (renderSettings._rid = (renderSettings._rid || 0) + 1);
    const form = $('#form-settings');
    const list = $('#children-list');
    const childEdit = $('#child-edit');
    const refreshBtn = $('#btn-refresh-settings');
    if (!form || !list || !childEdit) return;

    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', () => {
        invalidateSettingsRemoteCache();
        renderSettings();
      });
    }

    list.innerHTML = '<p class="muted">Chargement…</p>';
    childEdit.innerHTML = '<p class="muted">Chargement…</p>';

    const storedUser = store.get(K.user) || {};
    const storedPrivacyRaw = store.get(K.privacy, { showStats: true, allowMessages: true }) || {};
    const storedChildren = store.get(K.children, []);
    const baseSnapshot = {
      user: { role: 'maman', ...storedUser },
      privacy: {
        showStats: storedPrivacyRaw.showStats != null ? !!storedPrivacyRaw.showStats : true,
        allowMessages: storedPrivacyRaw.allowMessages != null ? !!storedPrivacyRaw.allowMessages : true,
      },
      children: Array.isArray(storedChildren) ? storedChildren : [],
      primaryId: storedUser.primaryChildId || null,
    };
    if (!baseSnapshot.user.role) baseSnapshot.user.role = 'maman';

    const remoteEnabled = useRemote();

    await applySettingsSnapshot(baseSnapshot, {
      rid,
      skipRemoteChild: remoteEnabled,
      updateStore: !remoteEnabled,
    });

    if (!remoteEnabled) return;

    try {
      const remoteSnapshot = await loadRemoteSettingsSnapshot(baseSnapshot);
      if (rid !== renderSettings._rid) return;
      await applySettingsSnapshot(remoteSnapshot, {
        rid,
        skipRemoteChild: false,
        updateStore: true,
      });
    } catch (err) {
      console.warn('renderSettings remote fetch failed', err);
    }
  }

  function renderSettingsChildrenList(children, primaryId) {
    const list = $('#children-list');
    if (!list) return;
    if (!children.length) {
      list.innerHTML = '<p class="muted">Aucun profil enfant enregistré.</p>';
      return;
    }
    const primaryStr = primaryId != null ? String(primaryId) : null;
    const selectedStr = settingsState.selectedChildId ? String(settingsState.selectedChildId) : null;
    const html = children.map((child) => {
      const id = String(child.id);
      const initials = (child.firstName || '?').slice(0, 2).toUpperCase();
      const isPrimary = primaryStr && primaryStr === id;
      const isSelected = selectedStr && selectedStr === id;
      const ageLabel = child.dob ? formatAge(child.dob) : 'Âge inconnu';
      const sexLabel = child.sex ? ` • ${escapeHtml(child.sex)}` : '';
      const chips = [
        child.context?.allergies ? `Allergies: ${escapeHtml(child.context.allergies)}` : '',
        child.context?.languages ? `Langues: ${escapeHtml(child.context.languages)}` : '',
      ].filter(Boolean).join(' • ');
      const chipsHtml = chips ? `<div class="muted">${chips}</div>` : '';
      const primaryBadge = isPrimary ? '<span class="badge">Principal</span>' : '';
      const actions = [
        isPrimary ? '' : `<button type="button" class="btn btn-secondary" data-action="set-primary" data-id="${id}">Définir principal</button>`,
        `<button type="button" class="btn btn-secondary" data-action="edit" data-id="${id}">Modifier</button>`,
        `<button type="button" class="btn btn-danger" data-action="delete" data-id="${id}">Supprimer</button>`,
      ].filter(Boolean).join('');
      return `
        <article class="child-item${isSelected ? ' active' : ''}" data-child-id="${id}">
          <div class="hstack" style="justify-content:space-between;align-items:center;gap:12px;">
            <div class="hstack" style="gap:12px;align-items:center;">
              <div class="avatar" aria-hidden="true" style="width:42px;height:42px;border-radius:12px;background:var(--blue-strong);color:#fff;display:grid;place-items:center;font-weight:600;">${escapeHtml(initials)}</div>
              <div class="stack" style="gap:2px;">
                <strong>${escapeHtml(child.firstName || '—')}</strong>
                <span class="muted">${escapeHtml(ageLabel)}${sexLabel}</span>
                ${chipsHtml}
              </div>
            </div>
            ${primaryBadge}
          </div>
          <div class="hstack" style="flex-wrap:wrap;gap:8px;margin-top:10px;">${actions}</div>
        </article>
      `;
    }).join('');
    list.innerHTML = html;
  }

  async function renderChildEditor(childId, ridRef, options = {}) {
    const container = $('#child-edit');
    if (!container) return;
    if (!childId) {
      container.innerHTML = '<p class="muted">Sélectionnez un enfant à modifier.</p>';
      return;
    }
    const idStr = String(childId);
    const { skipRemote = false } = options || {};
    let child = settingsState.childrenMap.get(idStr);
    const shouldFetchRemote = useRemote() && (!skipRemote || !child);
    if (shouldFetchRemote) {
      try {
        const childAccess = dataProxy.children();
        if (childAccess.isAnon) {
          const detail = await childAccess.callAnon('get', { childId: idStr });
          if (detail?.child) {
            child = mapRowToChild(detail.child) || child;
          }
        } else {
          const supaClient = await childAccess.getClient();
          const { data: row } = await supaClient.from('children').select('*').eq('id', idStr).maybeSingle();
          if (row) child = mapRowToChild(row) || child;
        }
      } catch (err) {
        console.warn('Chargement du profil enfant impossible', err);
      }
    }
    if (!child) {
      container.innerHTML = '<p class="muted">Profil enfant introuvable.</p>';
      return;
    }
    if (ridRef && ridRef !== renderSettings._rid) return;

    settingsState.childrenMap.set(idStr, child);
    settingsState.snapshots.set(idStr, makeUpdateSnapshot(child));

    const measures = normalizeMeasures(Array.isArray(child.growth?.measurements) ? child.growth.measurements : []);
    const latestHeight = [...measures].reverse().find((m) => Number.isFinite(m.height))?.height;
    const latestWeight = [...measures].reverse().find((m) => Number.isFinite(m.weight))?.weight;
    const lastTeethEntry = Array.isArray(child.growth?.teeth)
      ? [...child.growth.teeth].sort((a, b) => (Number(a?.month ?? 0) - Number(b?.month ?? 0))).slice(-1)[0]
      : null;
    const latestTeeth = lastTeethEntry != null
      ? Number(lastTeethEntry.count ?? lastTeethEntry.value ?? lastTeethEntry.teeth)
      : NaN;
    const heightInputValue = Number.isFinite(latestHeight) ? String(latestHeight) : '';
    const weightInputValue = Number.isFinite(latestWeight) ? String(latestWeight) : '';
    const teethInputValue = Number.isFinite(latestTeeth) ? String(Math.max(0, Math.round(latestTeeth))) : '';

    const milestonesHtml = milestonesInputsHtml(child.milestones);
    const sleep = child.context?.sleep || {};
    const sleepThroughVal = typeof sleep.sleepsThrough === 'boolean'
      ? (sleep.sleepsThrough ? 'oui' : 'non')
      : '';
    container.innerHTML = `
      <form id="form-edit-child" class="form-grid" data-child-id="${idStr}">
        <div class="hstack" style="flex-wrap:wrap;gap:12px;">
          <label>Prénom<input type="text" name="firstName" value="${escapeHtml(child.firstName || '')}" required /></label>
          <label>Sexe
            <select name="sex">
              <option value="fille" ${child.sex==='fille'?'selected':''}>Fille</option>
              <option value="garçon" ${child.sex==='garçon'?'selected':''}>Garçon</option>
            </select>
          </label>
          <label>Date de naissance<input type="date" name="dob" value="${escapeHtml(child.dob || '')}" required /></label>
        </div>
        <div class="hstack" style="flex-wrap:wrap;gap:12px;">
          <label>Taille (cm)<input type="number" step="0.1" min="0" name="height_cm" value="${escapeHtml(heightInputValue)}" inputmode="decimal" /></label>
          <label>Poids (kg)<input type="number" step="0.1" min="0" name="weight_kg" value="${escapeHtml(weightInputValue)}" inputmode="decimal" /></label>
          <label>Nombre de dents<input type="number" step="1" min="0" name="teeth_count" value="${escapeHtml(teethInputValue)}" inputmode="numeric" /></label>
        </div>
        <label>Allergies<input type="text" name="allergies" value="${escapeHtml(child.context?.allergies || '')}" /></label>
        <label>Antécédents<input type="text" name="history" value="${escapeHtml(child.context?.history || '')}" /></label>
        <label>Mode de garde<input type="text" name="care" value="${escapeHtml(child.context?.care || '')}" /></label>
        <label>Langues parlées<input type="text" name="languages" value="${escapeHtml(child.context?.languages || '')}" /></label>
        <label>Type d’alimentation
          <select name="feedingType">
            <option value="" ${!child.context?.feedingType?'selected':''}>—</option>
            <option value="allaitement_exclusif" ${child.context?.feedingType==='allaitement_exclusif'?'selected':''}>Allaitement exclusif</option>
            <option value="mixte_allaitement_biberon" ${child.context?.feedingType==='mixte_allaitement_biberon'?'selected':''}>Mixte (allaitement + biberon)</option>
            <option value="allaitement_diversification" ${child.context?.feedingType==='allaitement_diversification'?'selected':''}>Diversification + allaitement</option>
            <option value="biberon_diversification" ${child.context?.feedingType==='biberon_diversification'?'selected':''}>Biberon + diversification</option>
            <option value="lait_poudre_vache" ${child.context?.feedingType==='lait_poudre_vache'?'selected':''}>Lait en poudre / lait de vache</option>
          </select>
        </label>
        <label>Appétit / façon de manger
          <select name="eatingStyle">
            <option value="" ${!child.context?.eatingStyle?'selected':''}>—</option>
            <option value="mange_tres_bien" ${child.context?.eatingStyle==='mange_tres_bien'?'selected':''}>Mange très bien</option>
            <option value="appetit_variable" ${child.context?.eatingStyle==='appetit_variable'?'selected':''}>Appétit variable</option>
            <option value="selectif_difficile" ${child.context?.eatingStyle==='selectif_difficile'?'selected':''}>Sélectif / difficile</option>
            <option value="petites_portions" ${child.context?.eatingStyle==='petites_portions'?'selected':''}>Petites portions</option>
          </select>
        </label>
        <div class="hstack" style="flex-wrap:wrap;gap:12px;">
          <label>Endormissement
            <select name="sleep_falling">
              <option value="" ${!sleep.falling?'selected':''}>—</option>
              <option value="facile" ${sleep.falling==='facile'?'selected':''}>Facile</option>
              <option value="moyen" ${sleep.falling==='moyen'?'selected':''}>Moyen</option>
              <option value="difficile" ${sleep.falling==='difficile'?'selected':''}>Difficile</option>
            </select>
          </label>
          <label>Nuits complètes
            <select name="sleep_through">
              <option value="" ${sleepThroughVal===''?'selected':''}>—</option>
              <option value="oui" ${sleepThroughVal==='oui'?'selected':''}>Oui</option>
              <option value="non" ${sleepThroughVal==='non'?'selected':''}>Non</option>
            </select>
          </label>
          <label>Réveils nocturnes
            <select name="sleep_wakings">
              <option value="" ${!sleep.nightWakings?'selected':''}>—</option>
              <option value="0" ${sleep.nightWakings==='0'?'selected':''}>0</option>
              <option value="1" ${sleep.nightWakings==='1'?'selected':''}>1</option>
              <option value="2" ${sleep.nightWakings==='2'?'selected':''}>2</option>
              <option value="3+" ${sleep.nightWakings==='3+'?'selected':''}>3+</option>
            </select>
          </label>
          <label>Durée des éveils nocturnes
            <select name="sleep_wake_duration">
              <option value="" ${!sleep.wakeDuration?'selected':''}>—</option>
              <option value="<5min" ${sleep.wakeDuration==='<5min'?'selected':''}>Moins de 5 min</option>
              <option value="5-15min" ${sleep.wakeDuration==='5-15min'?'selected':''}>5–15 min</option>
              <option value="15-30min" ${sleep.wakeDuration==='15-30min'?'selected':''}>15–30 min</option>
              <option value="30-60min" ${sleep.wakeDuration==='30-60min'?'selected':''}>30–60 min</option>
              <option value=">60min" ${sleep.wakeDuration==='>60min'?'selected':''}>Plus de 60 min</option>
            </select>
          </label>
          <label>Heure du coucher<input type="time" name="sleep_bedtime" value="${escapeHtml(sleep.bedtime || '')}" /></label>
        </div>
        <h3>Jalons de développement</h3>
        <div class="milestone-toggle">
          <button type="button" class="btn btn-secondary" id="toggle-milestones" data-expanded="0" aria-expanded="false">Afficher les jalons</button>
        </div>
        <div id="edit-milestones" hidden>${milestonesHtml}</div>
        <label>Commentaire pour cette mise à jour <span style="font-size:0.85em;color:#6c757d;font-style:italic;">(recommandé)</span>
          <textarea name="update_note" rows="3" placeholder="Partagez une observation, un détail marquant ou votre ressenti de parent."></textarea>
          <p class="muted">Visible dans l’historique et pris en compte par l’assistant IA.</p>
        </label>
        <div class="form-actions-center">
          <div class="submit-with-spinner">
            <button type="submit" class="btn btn-primary" data-role="child-submit">Mettre à jour</button>
            <div class="loading-spinner loading-spinner--inline" data-role="child-spinner" hidden aria-hidden="true">
              <div class="loading-spinner-core"></div>
            </div>
          </div>
        </div>
      </form>
    `;
    const form = container.querySelector('#form-edit-child');
    if (form && !form.dataset.bound) {
      form.addEventListener('submit', handleChildFormSubmit);
      form.dataset.bound = '1';
    }
    if (form) {
      const milestonesBlock = form.querySelector('#edit-milestones');
      const toggleBtn = form.querySelector('#toggle-milestones');
      if (milestonesBlock && toggleBtn && !toggleBtn.dataset.bound) {
        milestonesBlock.hidden = true;
        toggleBtn.addEventListener('click', () => {
          const expanded = toggleBtn.dataset.expanded === '1';
          if (expanded) {
            milestonesBlock.hidden = true;
            toggleBtn.dataset.expanded = '0';
            toggleBtn.setAttribute('aria-expanded', 'false');
            toggleBtn.textContent = 'Afficher les jalons';
          } else {
            milestonesBlock.hidden = false;
            toggleBtn.dataset.expanded = '1';
            toggleBtn.setAttribute('aria-expanded', 'true');
            toggleBtn.textContent = 'Masquer les jalons';
          }
        });
        toggleBtn.dataset.bound = '1';
      }
    }
  }

  async function handleSettingsSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (form.dataset.busy === '1') return;
    form.dataset.busy = '1';
    const submitBtn = form.querySelector('[data-role="parent-submit"]')
      || form.querySelector('button[type="submit"],input[type="submit"]');
    const submitSpinner = form.querySelector('[data-role="parent-spinner"]');
    showButtonLoading(submitBtn, submitSpinner);
    const commentControl = form.elements.namedItem('parent_comment');
    let shouldResetComment = false;
    let shouldRefreshFamily = false;
    let hadError = false;
    try {
      const fd = new FormData(form);
      const pseudo = (fd.get('pseudo') || '').toString().trim();
      const role = (fd.get('role') || 'maman').toString();
      const showStats = !!fd.get('showStats');
      const allowMessages = !!fd.get('allowMessages');
      const parentContext = readParentContextFromForm(fd);
      const parentComment = sanitizeParentComment(fd.get('parent_comment'));
      const hasParentComment = !!parentComment;
      const previousUser = { ...(settingsState.user || {}) };
      const previousContext = normalizeParentContext(previousUser || {});
      const parentContextChanges = diffParentContexts(previousContext, parentContext);
      const pseudoChanged = (previousUser.pseudo || '') !== pseudo;
      const roleChanged = (previousUser.role || 'maman') !== role;
      const nextPrivacy = { showStats, allowMessages };
      const nextUser = { ...previousUser, pseudo, role, ...parentContext };
      store.set(K.user, nextUser);
      store.set(K.privacy, nextPrivacy);
      settingsState.user = nextUser;
      settingsState.privacy = nextPrivacy;

      const parentUpdateEntries = [];
      if (pseudoChanged) parentUpdateEntries.push({ field: 'full_name', previous: previousUser.pseudo || '', next: pseudo });
      if (roleChanged) parentUpdateEntries.push({ field: 'parent_role', previous: previousUser.role || '', next: role });
      parentContextChanges.forEach((change) => parentUpdateEntries.push(change));

      const parentDbPayload = parentContextToDbPayload(parentContext);
      const shouldLogSnapshot = parentUpdateEntries.length || hasParentComment;

      const prepareParentSnapshot = async (profileId) => {
        if (!profileId || !shouldLogSnapshot) return null;
        try {
          const snapshotResult = buildParentContextSnapshotInsert({
            profileId,
            previousUser,
            previousContext,
            nextUser,
            nextContext: parentContext,
            changes: parentUpdateEntries,
            comment: parentComment,
          });
          if (!snapshotResult?.row) return null;
          const { row: snapshotRow, sanitizedComment, updateContent } = snapshotResult;
          const hasParentNote = !!sanitizedComment;
          const hasStructuredChanges = Array.isArray(updateContent?.changes)
            ? updateContent.changes.length > 0
            : false;
          const shouldRequestAi = hasParentNote || hasStructuredChanges;
          let aiFeedback = '';
          let aiFeedbackMeta = null;
          if (shouldRequestAi) {
            try {
              const aiResult = await generateParentUpdateAiComment({
                updateType: snapshotRow.update_type,
                updateContent,
                parentComment: sanitizedComment || '',
              });
              aiFeedback = aiResult?.comment || '';
              aiFeedbackMeta = aiResult || null;
            } catch (aiErr) {
              console.warn('generateParentUpdateAiComment failed', aiErr);
              showNotification({
                title: 'Commentaire non généré',
                text: 'Impossible de générer un commentaire pour l’instant.',
                durationMs: 6000,
              });
            }
          }
          const rowForInsert = { ...snapshotRow };
          if (aiFeedback) {
            rowForInsert.ai_commentaire = aiFeedback;
            const baseContent = (updateContent && typeof updateContent === 'object')
              ? updateContent
              : (() => {
                  try { return JSON.parse(rowForInsert.update_content || '{}'); }
                  catch { return {}; }
                })();
            const updatedContent = { ...baseContent, ai_commentaire: aiFeedback };
            if (aiFeedbackMeta?.usedAiBilan) {
              updatedContent.ai_bilan_used = true;
            }
            const previewText = sanitizeFamilyBilanPreview(aiFeedbackMeta?.familyBilanPreview);
            if (previewText) {
              updatedContent.ai_bilan_preview = previewText;
            }
            if (!hasParentNote) updatedContent.comment_origin = 'ai';
            rowForInsert.update_content = JSON.stringify(updatedContent);
          }
          return {
            snapshotRow: rowForInsert,
            sanitizedComment,
            updateContent,
            hasParentNote,
          };
        } catch (err) {
          console.warn('prepareParentSnapshot failed', err);
          return null;
        }
      };

      let remoteProfileResponse = null;

      if (useRemote()) {
        const parentAccess = dataProxy.parentUpdates();
        if (parentAccess.isAnon) {
          const profileId = activeProfile?.id;
          const snapshotInfo = await prepareParentSnapshot(profileId);
          if (snapshotInfo?.hasParentNote) shouldResetComment = true;
          const payloadBody = {
            profileUpdate: {
              fullName: pseudo,
              role,
              showChildrenCount: showStats,
              maritalStatus: parentContext.maritalStatus,
              numberOfChildren: parentContext.numberOfChildren,
              parentalEmployment: parentContext.parentalEmployment,
              parentalEmotion: parentContext.parentalEmotion,
              parentalStress: parentContext.parentalStress,
              parentalFatigue: parentContext.parentalFatigue,
              contextParental: parentDbPayload.context_parental,
            },
          };
          if (snapshotInfo?.snapshotRow) {
            payloadBody.parentUpdate = snapshotInfo.snapshotRow;
          }
          try {
            const response = await parentAccess.callAnon('update-profile', payloadBody);
            remoteProfileResponse = response?.profile || null;
            if (snapshotInfo?.snapshotRow) shouldRefreshFamily = true;
          } catch (anonErr) {
            console.warn('anonParentRequest update-profile failed', anonErr);
            throw anonErr;
          }
        } else {
          const uid = getActiveProfileId();
          if (uid) {
            const supaClient = await parentAccess.getClient();
            const updatePayload = {
              full_name: pseudo,
              parent_role: role,
              show_children_count: showStats,
              ...parentDbPayload,
            };
            await supaClient.from('profiles').update(updatePayload).eq('id', uid);
            const snapshotInfo = await prepareParentSnapshot(uid);
            if (snapshotInfo?.snapshotRow) {
              try {
                await supaClient.from('parent_updates').insert(snapshotInfo.snapshotRow);
                if (snapshotInfo.hasParentNote) shouldResetComment = true;
                shouldRefreshFamily = true;
              } catch (logErr) {
                console.warn('parent_updates insert failed', logErr);
              }
            }
          }
        }
        const nextProfile = { ...activeProfile };
        const sourceProfile = remoteProfileResponse || {};
        nextProfile.full_name = sourceProfile.full_name ?? pseudo;
        nextProfile.parent_role = sourceProfile.parent_role ?? role;
        nextProfile.show_children_count = Object.prototype.hasOwnProperty.call(sourceProfile, 'show_children_count')
          ? sourceProfile.show_children_count
          : showStats;
        PARENT_FIELD_DEFS.forEach((def) => {
          if (Object.prototype.hasOwnProperty.call(sourceProfile, def.column)) {
            nextProfile[def.column] = sourceProfile[def.column];
          } else {
            nextProfile[def.column] = parentDbPayload[def.column];
          }
        });
        nextProfile.context_parental = Object.prototype.hasOwnProperty.call(sourceProfile, 'context_parental')
          ? sourceProfile.context_parental
          : parentDbPayload.context_parental;
        setActiveProfile(nextProfile);
      } else {
        const nextProfile = {
          ...activeProfile,
          full_name: pseudo,
          parent_role: role,
          show_children_count: showStats,
        };
        PARENT_FIELD_DEFS.forEach((def) => {
          nextProfile[def.column] = parentContext[def.key];
        });
        nextProfile.context_parental = parentDbPayload.context_parental;
        setActiveProfile(nextProfile);
      }

      invalidateSettingsRemoteCache();

      showNotification({
        title: 'Profil parent mis à jour',
        text: 'Rendez-vous dans le Carnet de santé à la section « Mises à jour parentales » vue famille, pour consulter toutes les mises à jour et lire les commentaires de votre assistant IA.',
        actionHref: '#/dashboard?view=family&focus=parent-updates',
        actionLabel: 'Voir',
        durationMs: 10000,
      });

      if (shouldResetComment && commentControl && typeof commentControl === 'object' && 'value' in commentControl) {
        commentControl.value = '';
      }

      if (useRemote() && !isAnonProfile() && shouldRefreshFamily) {
        scheduleFamilyContextRefresh();
      }
    } catch (err) {
      console.warn('handleSettingsSubmit failed', err);
      alert('Impossible de mettre à jour le profil parent.');
      hadError = true;
    } finally {
      delete form.dataset.busy;
      resolveButtonLoading(submitBtn, submitSpinner, {
        failed: hadError,
        defaultLabel: 'Mettre à jour',
        failureLabel: 'Réessayer',
      });
    }
  }

  function handleSettingsListClick(e) {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.getAttribute('data-action');
    const id = actionBtn.getAttribute('data-id');
    if (!id) return;
    if (action === 'set-primary') {
      setPrimaryChildAction(id);
    } else if (action === 'edit') {
      settingsState.selectedChildId = String(id);
      renderSettingsChildrenList(settingsState.children, settingsState.user.primaryChildId);
      renderChildEditor(settingsState.selectedChildId, renderSettings._rid);
      const editContainer = $('#child-edit');
      if (editContainer) {
        requestAnimationFrame(() => {
          const scrollTarget = editContainer.closest('.card') || editContainer;
          if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') {
            scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      }
    } else if (action === 'delete') {
      deleteChildAction(id);
    }
  }

  async function setPrimaryChildAction(childId) {
    try {
      await setPrimaryChild(childId);
      settingsState.user = { ...settingsState.user, primaryChildId: childId };
      store.set(K.user, settingsState.user);
      invalidateSettingsRemoteCache();
      renderSettings();
    } catch (err) {
      console.warn('setPrimaryChildAction failed', err);
      alert('Impossible de définir cet enfant comme principal.');
    }
  }

  async function deleteChildAction(childId) {
    if (!childId) return;
    if (!confirm('Supprimer ce profil enfant ?')) return;
    try {
      if (useRemote()) {
        const childAccess = dataProxy.children();
        const remoteChildId = assertValidChildId(childId);
        if (childAccess.isAnon) {
          await childAccess.callAnon('delete', { childId: remoteChildId });
        } else {
          const supaClient = await childAccess.getClient();
          await supaClient.from('children').delete().eq('id', remoteChildId);
        }
      } else {
        const localChildren = store.get(K.children, []).filter((child) => String(child.id) !== String(childId));
        store.set(K.children, localChildren);
      }
      alert('Profil enfant supprimé.');
    } catch (err) {
      console.warn('deleteChildAction failed', err);
      alert('Impossible de supprimer le profil enfant.');
    }
    invalidateSettingsRemoteCache();
    renderSettings();
  }

  function notifyChildProfileUpdated(){
    showNotification({
      title: 'Profil enfant mis à jour',
      text: 'Rendez-vous dans le Carnet de santé à la section « historique de l’évolution » pour consulter toutes les mises à jour et lire les commentaires de votre assistant IA.',
      actionHref: '#/dashboard?focus=history',
      actionLabel: 'Voir',
      durationMs: 10000
    });
  }

  async function handleChildFormSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (form.dataset.busy === '1') return;
    form.dataset.busy = '1';
    const submitBtn = form.querySelector('[data-role="child-submit"]')
      || form.querySelector('button[type="submit"],input[type="submit"]');
    const submitSpinner = form.querySelector('[data-role="child-spinner"]');
    showButtonLoading(submitBtn, submitSpinner);
    const childId = form.getAttribute('data-child-id');
    let hadError = false;
    try {
      const base = settingsState.childrenMap.get(childId);
      if (!base) throw new Error('Profil enfant introuvable');
      const remoteChildId = assertValidChildId(childId);
      const prevSnapshot = settingsState.snapshots.get(childId) || makeUpdateSnapshot(base);
      const { child: updated, growthInputs, userComment } = buildChildUpdateFromForm(base, form);
      const nextSnapshot = makeUpdateSnapshot(updated);
      const summary = summarizeUpdate(prevSnapshot, nextSnapshot);
      const commentText = typeof userComment === 'string' ? userComment.trim() : '';
      const hasComment = !!commentText;
      if (!summary && !hasComment) {
        alert('Aucun changement détecté.');
        return;
      }
      const hasProfileChanges = !!summary;

      let measurementRecords = [];
      let teethRecords = [];
      if (hasProfileChanges) {
        const prevGrowth = prevSnapshot.growth || {};
        const nextGrowthState = nextSnapshot.growth || {};
        const growthChanged = (prevGrowth.heightCm ?? null) !== (nextGrowthState.heightCm ?? null)
          || (prevGrowth.weightKg ?? null) !== (nextGrowthState.weightKg ?? null)
          || (prevGrowth.teethCount ?? null) !== (nextGrowthState.teethCount ?? null);
        const growthData = growthInputs || {};
        if (growthChanged && Number.isInteger(growthData.month)) {
          const measurementPayload = {};
          if (Number.isFinite(growthData.height)) measurementPayload.height = growthData.height;
          if (Number.isFinite(growthData.weight)) measurementPayload.weight = growthData.weight;
          if (Object.keys(measurementPayload).length) {
            measurementRecords = buildMeasurementPayloads([{ month: growthData.month, ...measurementPayload }]);
          }
          if (Number.isFinite(growthData.teeth)) {
            teethRecords = buildTeethPayloads([{ month: growthData.month, count: growthData.teeth }]);
          }
        }

        if (useRemote()) {
          const childAccess = dataProxy.children();
          if (childAccess.isAnon) {
            const payload = {
              firstName: updated.firstName,
              sex: updated.sex,
              dob: updated.dob,
              contextAllergies: updated.context.allergies,
              contextHistory: updated.context.history,
              contextCare: updated.context.care,
              contextLanguages: updated.context.languages,
              feedingType: updated.context.feedingType,
              eatingStyle: updated.context.eatingStyle,
              sleepFalling: updated.context.sleep.falling,
              sleepSleepsThrough: updated.context.sleep.sleepsThrough,
              sleepNightWakings: updated.context.sleep.nightWakings,
              sleepWakeDuration: updated.context.sleep.wakeDuration,
              sleepBedtime: updated.context.sleep.bedtime,
              milestones: updated.milestones,
            };
            const requestBody = { childId: remoteChildId, child: payload };
            if (measurementRecords.length) requestBody.growthMeasurements = measurementRecords;
            if (teethRecords.length) requestBody.growthTeeth = teethRecords;
            await childAccess.callAnon('update', requestBody);
          } else {
            const supaClient = await childAccess.getClient();
            const payload = {
              first_name: updated.firstName,
              sex: updated.sex,
              dob: updated.dob,
              context_allergies: updated.context.allergies,
              context_history: updated.context.history,
              context_care: updated.context.care,
              context_languages: updated.context.languages,
              feeding_type: updated.context.feedingType,
              eating_style: updated.context.eatingStyle,
              sleep_falling: updated.context.sleep.falling,
              sleep_sleeps_through: typeof updated.context.sleep.sleepsThrough === 'boolean' ? updated.context.sleep.sleepsThrough : null,
              sleep_night_wakings: updated.context.sleep.nightWakings,
              sleep_wake_duration: updated.context.sleep.wakeDuration,
              sleep_bedtime: updated.context.sleep.bedtime,
              milestones: updated.milestones,
            };
            const normalizedPayload = normalizeChildPayloadForSupabase(payload);
            await supaClient.from('children').update(normalizedPayload).eq('id', remoteChildId);
            if (measurementRecords.length || teethRecords.length) {
              const remoteUpdates = [];
              if (measurementRecords.length) {
                const upsertMeasurements = measurementRecords.map((rec) => {
                  const payload = { child_id: remoteChildId, month: rec.month };
                  if (Object.prototype.hasOwnProperty.call(rec, 'height_cm')) payload.height_cm = rec.height_cm;
                  if (Object.prototype.hasOwnProperty.call(rec, 'weight_kg')) payload.weight_kg = rec.weight_kg;
                  return payload;
                });
                remoteUpdates.push(
                  supaClient.from('growth_measurements').upsert(upsertMeasurements, { onConflict: 'child_id,month' })
                );
              }
              if (teethRecords.length) {
                const upsertTeeth = teethRecords.map((rec) => ({
                  child_id: remoteChildId,
                  month: rec.month,
                  count: rec.count,
                }));
                remoteUpdates.push((async () => {
                  try {
                    await supaClient.from('growth_teeth').upsert(upsertTeeth, { onConflict: 'child_id,month' });
                  } catch (errTeeth) {
                    console.warn('growth_teeth upsert failed, fallback to insert', errTeeth);
                    await supaClient.from('growth_teeth').insert(upsertTeeth);
                  }
                })());
              }
              if (remoteUpdates.length) await Promise.all(remoteUpdates);
            }
          }
        } else {
          const localChildren = store.get(K.children, []).map((child) => {
            if (String(child.id) === String(childId)) return updated;
            return child;
          });
          store.set(K.children, localChildren);
        }

        settingsState.childrenMap.set(childId, updated);
        settingsState.children = settingsState.children.map((child) => (String(child.id) === String(childId) ? updated : child));
        settingsState.snapshots.set(childId, nextSnapshot);
      } else {
        settingsState.snapshots.set(childId, nextSnapshot);
      }

      const logPayload = { prev: prevSnapshot, next: nextSnapshot, summary };
      if (hasComment) logPayload.userComment = commentText;
      await logChildUpdate(remoteChildId, 'profil', logPayload);
      if (hasProfileChanges) {
        invalidateSettingsRemoteCache();
        renderSettingsChildrenList(settingsState.children, settingsState.user.primaryChildId);
      }
      notifyChildProfileUpdated();
      const noteField = form.querySelector('[name="update_note"]');
      if (noteField) noteField.value = '';
    } catch (err) {
      console.warn('handleChildFormSubmit failed', err);
      alert('Impossible de mettre à jour le profil enfant.');
      hadError = true;
    } finally {
      delete form.dataset.busy;
      resolveButtonLoading(submitBtn, submitSpinner, {
        failed: hadError,
        defaultLabel: 'Mettre à jour',
        failureLabel: 'Réessayer',
      });
    }
  }

  async function handleShowChildrenCountToggle(e) {
    const input = e.currentTarget;
    if (!input) return;
    if (input.dataset.busy === '1') {
      input.checked = settingsState.privacy?.showStats ?? false;
      return;
    }
    const checked = !!input.checked;
    input.dataset.busy = '1';
    const previousPrivacy = settingsState.privacy || { showStats: false, allowMessages: true };
    const previousValue = !!previousPrivacy.showStats;
    const nextPrivacy = { ...previousPrivacy, showStats: checked };
    settingsState.privacy = nextPrivacy;
    store.set(K.privacy, nextPrivacy);
    const revert = () => {
      const restored = { ...previousPrivacy, showStats: previousValue };
      settingsState.privacy = restored;
      store.set(K.privacy, restored);
      input.checked = previousValue;
    };
    try {
      if (useRemote()) {
        const parentAccess = dataProxy.parentUpdates();
        if (parentAccess.isAnon) {
          try {
            const response = await parentAccess.callAnon('update-profile', {
              profileUpdate: { showChildrenCount: checked },
            });
            if (response?.profile && Object.prototype.hasOwnProperty.call(response.profile, 'show_children_count')) {
              setActiveProfile({
                ...activeProfile,
                show_children_count: response.profile.show_children_count,
              });
            }
          } catch (anonErr) {
            throw anonErr;
          }
        } else {
          const uid = getActiveProfileId();
          if (uid) {
            const supaClient = await parentAccess.getClient();
            const { error } = await supaClient
              .from('profiles')
              .update({ show_children_count: checked })
              .eq('id', uid);
            if (error) throw error;
          }
        }
      }
      invalidateSettingsRemoteCache();
      showNotification({
        title: 'Préférence sauvegardée',
        text: checked
          ? 'Le nombre d’enfants sera visible dans la communauté.'
          : 'Le nombre d’enfants ne sera plus affiché dans la communauté.',
      });
      try { renderCommunity(); } catch {}
    } catch (err) {
      console.warn('handleShowChildrenCountToggle failed', err);
      revert();
      alert('Impossible de mettre à jour la préférence. Réessayez plus tard.');
    } finally {
      delete input.dataset.busy;
    }
  }

  function buildChildUpdateFromForm(base, form) {
    const fd = new FormData(form);
    const clone = JSON.parse(JSON.stringify(base));
    const rawComment = (fd.get('update_note') || '').toString();
    const userComment = rawComment.trim().slice(0, 600);
    clone.firstName = (fd.get('firstName') || '').toString().trim();
    clone.sex = (fd.get('sex') || '').toString();
    clone.dob = (fd.get('dob') || '').toString();
    const mergedContext = mergeChildContext(clone.context || {}, {
      allergies: (fd.get('allergies') || '').toString().trim(),
      history: (fd.get('history') || '').toString().trim(),
      care: (fd.get('care') || '').toString().trim(),
      languages: (fd.get('languages') || '').toString().trim(),
      feedingType: (fd.get('feedingType') || '').toString(),
      eatingStyle: (fd.get('eatingStyle') || '').toString(),
      sleep: {
        falling: (fd.get('sleep_falling') || '').toString(),
        sleepsThrough: (fd.get('sleep_through') || '').toString(),
        nightWakings: (fd.get('sleep_wakings') || '').toString(),
        wakeDuration: (fd.get('sleep_wake_duration') || '').toString(),
        bedtime: (fd.get('sleep_bedtime') || '').toString(),
      },
    });
    const sleepThroughRaw = mergedContext.sleep.sleepsThrough;
    mergedContext.sleep.sleepsThrough = sleepThroughRaw === 'oui' ? true : (sleepThroughRaw === 'non' ? false : null);
    clone.context = mergedContext;

    const heightRaw = (fd.get('height_cm') || '').toString().replace(',', '.').trim();
    const weightRaw = (fd.get('weight_kg') || '').toString().replace(',', '.').trim();
    const teethRaw = (fd.get('teeth_count') || '').toString().trim();
    const heightVal = heightRaw ? Number.parseFloat(heightRaw) : NaN;
    const weightVal = weightRaw ? Number.parseFloat(weightRaw) : NaN;
    const teethVal = teethRaw ? Number.parseInt(teethRaw, 10) : NaN;
    const ageMonths = ageInMonths(clone.dob);
    const month = Number.isInteger(ageMonths) ? ageMonths : null;
    const hasHeight = Number.isFinite(heightVal);
    const hasWeight = Number.isFinite(weightVal);
    const hasTeeth = Number.isFinite(teethVal);

    clone.growth = clone.growth && typeof clone.growth === 'object' ? clone.growth : {};
    if (!Array.isArray(clone.growth.measurements)) clone.growth.measurements = [];
    if (!Array.isArray(clone.growth.sleep)) clone.growth.sleep = [];
    if (!Array.isArray(clone.growth.teeth)) clone.growth.teeth = [];

    if (month != null) {
      if (hasHeight || hasWeight) {
        const existingEntries = clone.growth.measurements.filter((entry) => Number(entry?.month ?? entry?.m) === month);
        let existingHeight = NaN;
        let existingWeight = NaN;
        for (const entry of existingEntries) {
          if (!Number.isFinite(existingHeight)) {
            const h = Number(entry?.height ?? entry?.height_cm);
            if (Number.isFinite(h)) existingHeight = h;
          }
          if (!Number.isFinite(existingWeight)) {
            const w = Number(entry?.weight ?? entry?.weight_kg);
            if (Number.isFinite(w)) existingWeight = w;
          }
          if (Number.isFinite(existingHeight) && Number.isFinite(existingWeight)) break;
        }
        clone.growth.measurements = clone.growth.measurements.filter((entry) => {
          const entryMonth = Number(entry?.month ?? entry?.m);
          return !Number.isInteger(entryMonth) || entryMonth !== month;
        });
        const measurementEntry = { month };
        const finalHeight = hasHeight ? heightVal : (Number.isFinite(existingHeight) ? existingHeight : null);
        const finalWeight = hasWeight ? weightVal : (Number.isFinite(existingWeight) ? existingWeight : null);
        if (Number.isFinite(finalHeight)) measurementEntry.height = finalHeight;
        if (Number.isFinite(finalWeight)) measurementEntry.weight = finalWeight;
        if (Number.isFinite(measurementEntry.height) && Number.isFinite(measurementEntry.weight) && measurementEntry.height > 0) {
          measurementEntry.bmi = measurementEntry.weight / Math.pow(measurementEntry.height / 100, 2);
        }
        if (Number.isFinite(measurementEntry.height) || Number.isFinite(measurementEntry.weight)) {
          measurementEntry.measured_at = new Date().toISOString();
          clone.growth.measurements.push(measurementEntry);
        }
        clone.growth.measurements.sort((a, b) => Number(a?.month ?? a?.m ?? 0) - Number(b?.month ?? b?.m ?? 0));
      }
      if (hasTeeth) {
        const count = Math.max(0, Math.round(teethVal));
        clone.growth.teeth = clone.growth.teeth.filter((entry) => {
          const entryMonth = Number(entry?.month ?? entry?.m);
          return !Number.isInteger(entryMonth) || entryMonth !== month;
        });
        clone.growth.teeth.push({ month, count });
        clone.growth.teeth.sort((a, b) => Number(a?.month ?? a?.m ?? 0) - Number(b?.month ?? b?.m ?? 0));
      }
    }

    const msInputs = Array.from(form.querySelectorAll('#edit-milestones input[name="milestones[]"]'))
      .sort((a, b) => Number(a.dataset.index || 0) - Number(b.dataset.index || 0))
      .map((input) => input.checked);
    if (msInputs.length) clone.milestones = msInputs;

    const growthInputs = {
      month: hasHeight || hasWeight || hasTeeth ? month : null,
      height: hasHeight ? heightVal : null,
      weight: hasWeight ? weightVal : null,
      teeth: hasTeeth ? Math.max(0, Math.round(teethVal)) : null,
    };

    return { child: clone, growthInputs, userComment };
  }

  function mergeChildContext(base, updates) {
    const src = base || {};
    const sleepBase = src.sleep || {};
    const updSleep = updates.sleep || {};
    return {
      allergies: updates.allergies ?? src.allergies ?? '',
      history: updates.history ?? src.history ?? '',
      care: updates.care ?? src.care ?? '',
      languages: updates.languages ?? src.languages ?? '',
      feedingType: updates.feedingType ?? src.feedingType ?? '',
      eatingStyle: updates.eatingStyle ?? src.eatingStyle ?? '',
      sleep: {
        falling: updSleep.falling ?? sleepBase.falling ?? '',
        sleepsThrough: updSleep.sleepsThrough ?? sleepBase.sleepsThrough ?? null,
        nightWakings: updSleep.nightWakings ?? sleepBase.nightWakings ?? '',
        wakeDuration: updSleep.wakeDuration ?? sleepBase.wakeDuration ?? '',
        bedtime: updSleep.bedtime ?? sleepBase.bedtime ?? '',
      },
    };
  }

  async function renderDashboard() {
    const rid = (renderDashboard._rid = (renderDashboard._rid || 0) + 1);
    let child = null; let all = [];
    if (useRemote()) {
      // Chargement distant
      const uid = getActiveProfileId();
      // Charger les enfants, choisir le primaire s’il existe sinon le premier
      // Supposition : une colonne booléenne is_primary est présente
      // Repli sur la première ligne si aucun enfant principal
      // Les données de croissance sont chargées après la mise en place du squelette DOM
    } else {
      const user = store.get(K.user);
      all = store.get(K.children, []);
      child = all.find(c => c.id === user?.primaryChildId) || all[0];
    }
    const dom = $('#dashboard-content');
    if (!dom) {
      const appEl = document.querySelector('#app');
      if (appEl) {
        console.warn('Dashboard container missing — injecting fallback');
        appEl.insertAdjacentHTML('beforeend', '<p>Aucune donnée disponible</p>');
      }
      return;
    }
    const viewMode = dashboardState.viewMode === 'family' ? 'family' : 'child';
    dashboardState.viewMode = viewMode;
    const buildToggleHtml = () => `
      <div class="dashboard-view-toggle" role="group" aria-label="Changer de vue">
        <button type="button" class="dashboard-view-toggle__btn ${viewMode === 'child' ? 'is-active' : ''}" data-dashboard-view="child">Vue enfant</button>
        <button type="button" class="dashboard-view-toggle__btn ${viewMode === 'family' ? 'is-active' : ''}" data-dashboard-view="family">Vue famille</button>
      </div>
    `;
    const bindToggle = () => {
      const buttons = dom.querySelectorAll('[data-dashboard-view]');
      buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.getAttribute('data-dashboard-view');
          if (!mode || dashboardState.viewMode === mode) return;
          dashboardState.viewMode = mode;
          renderDashboard();
        });
      });
    };
    const setDashboardHtml = (html) => {
      dom.innerHTML = `${buildToggleHtml()}${html}`;
      bindToggle();
    };

    if (viewMode === 'family') {
      await renderFamilyDashboardView({ dom, rid, setDashboardHtml });
      return;
    }
    // Local : afficher le sélecteur d’enfant si des profils existent
    if (!useRemote()) {
      const u = store.get(K.user) || {};
      const slimLocal = (all || []).map(c => ({ id: c.id, firstName: c.firstName, dob: c.dob, isPrimary: c.id === u.primaryChildId }));
      if (slimLocal.length) renderChildSwitcher(dom.parentElement || dom, slimLocal, (slimLocal.find(s=>s.isPrimary)||slimLocal[0]).id, () => renderDashboard());
    }
    if (!useRemote() && !child) {
      if (rid !== renderDashboard._rid) return;
      setDashboardHtml(`<div class="card stack"><p>Aucun profil enfant. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Ajouter un enfant</a></div>`);
      return;
    }
    // Placeholder pendant le chargement distant
    if (useRemote()) {
      if (rid !== renderDashboard._rid) return;
      setDashboardHtml(`<div class="card stack"><p>Chargement du profil…</p><button id="btn-refresh-profile" class="btn btn-secondary">Forcer le chargement</button></div>`);
      $('#btn-refresh-profile')?.addEventListener('click', () => location.reload());
    }
    const renderForChild = async (child) => {
      const safeChild = child && typeof child === 'object' ? child : {};
      const dobValue = safeChild.dob;
      const ageRaw = dobValue ? ageInMonths(dobValue) : NaN;
      const ageM = Number.isFinite(ageRaw) ? ageRaw : 0;
      const ageTxt = Number.isFinite(ageRaw) ? formatAge(dobValue) : 'Date de naissance à compléter';
      const context = safeChild.context && typeof safeChild.context === 'object' ? safeChild.context : {};
      const sleepContext = context.sleep && typeof context.sleep === 'object' ? context.sleep : {};
      const growth = safeChild.growth && typeof safeChild.growth === 'object' ? safeChild.growth : {};
      const measurements = Array.isArray(growth.measurements) ? growth.measurements : [];
      const sleepEntries = Array.isArray(growth.sleep) ? growth.sleep : [];
      const teethEntries = Array.isArray(growth.teeth) ? growth.teeth : [];
      const milestones = Array.isArray(safeChild.milestones) ? safeChild.milestones : [];
      if (rid !== renderDashboard._rid) return;
      // Calculer le dernier état de santé (mesures récentes)
      const msAll = normalizeMeasures(measurements);
      const latestH = [...msAll].reverse().find(m=>Number.isFinite(m.height))?.height;
      const latestW = [...msAll].reverse().find(m=>Number.isFinite(m.weight))?.weight;
      const lastTeeth = [...teethEntries].sort((a,b)=> (a.month??0)-(b.month??0)).slice(-1)[0]?.count;
      const lastSleepHours = [...sleepEntries].sort((a,b)=> (a.month??0)-(b.month??0)).slice(-1)[0]?.hours;
      const ageDays = ageInDays(dobValue);
      const timelineSection = build1000DaysTimeline(safeChild, ageDays);
      if (rid !== renderDashboard._rid) return;
      setDashboardHtml(`
      <div class="grid-2">
        <div class="card stack">
          <div class="hstack">
            ${safeChild.photo ? `<img src="${safeChild.photo}" alt="${safeChild.firstName}" style="width:64px;height:64px;object-fit:cover;border-radius:12px;border:1px solid var(--border);"/>` :
            `<div style="width:64px;height:64px;border-radius:12px;border:1px solid var(--border);display:grid;place-items:center;background:#111845;font-weight:600;font-size:24px;color:#fff;">${(safeChild.firstName||'?').slice(0,1).toUpperCase()}</div>`}
            <div>
              <h2 style="margin:0">${safeChild.firstName || 'Votre enfant'}</h2>
              <div class="muted">${safeChild.sex || '—'} • ${ageTxt}</div>
            </div>
          </div>
          <div class="hstack">
            <span class="chip">Allergies: ${context.allergies || '—'}</span>
            <span class="chip">Mode de garde: ${context.care || '—'}</span>
            <span class="chip">Langues: ${context.languages || '—'}</span>
            <span class="chip">Alimentation: ${labelFeedingType(context.feedingType)}</span>
            <span class="chip">Appétit: ${labelEatingStyle(context.eatingStyle)}</span>
            <span class="chip">Sommeil: ${summarizeSleep(sleepContext)}</span>
          </div>
          <div class="hstack">
            <button class="btn btn-primary" type="button" id="btn-toggle-milestones">Afficher les jalons</button>
          </div>
          <div class="hstack" id="milestones-list" hidden>
            ${milestones.map((v,i)=> v?`<span class="badge done">${DEV_QUESTIONS[i]?.label||''}</span>`: '').join('') || '<span class="muted">Pas encore de badges — cochez des étapes dans le profil.</span>'}
          </div>
        </div>
      </div>

      <div class="grid-2" style="margin-top:12px">
        <div class="card chart-card">
          <div class="chart-header">
            <h3>Taille (cm)</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>Enfant</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet-strong)"></span>P50</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet)"></span>P15/P85</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--border)"></span>P3/P97</span>
            </div>
          </div>
          <svg class="chart" id="chart-height"></svg>
        </div>
        <div class="card chart-card">
          <div class="chart-header">
            <h3>Poids (kg)</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>Enfant</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet-strong)"></span>P50</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet)"></span>P15/P85</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--border)"></span>P3/P97</span>
            </div>
          </div>
          <svg class="chart" id="chart-weight"></svg>
        </div>
        <div class="card chart-card">
          <div class="chart-header">
            <h3>IMC</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>Enfant</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet-strong)"></span>P50</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet)"></span>P15/P85</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--border)"></span>P3/P97</span>
            </div>
          </div>
          <svg class="chart" id="chart-bmi"></svg>
        </div>
        
        <div class="card chart-card">
          <div class="chart-header">
            <h3>Dents (nb)</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>Enfant</span>
            </div>
          </div>
          <svg class="chart" id="chart-teeth"></svg>
        </div>
      </div>

      ${timelineSection}

      `);

      setupTimelineScroller(dom);

    // Section « Profil santé » retirée à la demande

    // Ajouter le bloc d’historique des mises à jour
    try {
      const updates = await getChildUpdates(safeChild.id);
      const growthStatus = await renderGrowthStatus(safeChild.id).catch((err) => {
        console.warn('renderGrowthStatus failed', err);
        return null;
      });
      if (rid !== renderDashboard._rid) return;
      const hist = document.createElement('div');
      hist.className = 'card stack';
      hist.id = 'dashboard-history';
      hist.style.marginTop = '20px';
      const timelineHtml = updates.map((u) => {
        const created = new Date(u.created_at);
        const hasValidDate = !Number.isNaN(created.getTime());
        const when = hasValidDate
          ? created.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
          : 'Date inconnue';
        const iso = hasValidDate ? created.toISOString() : '';
        let details = '';
        let parentNoteHtml = '';
        let growthHtml = '';
        let parsed = null;
        if (typeof u.update_content === 'string' && u.update_content.trim()) {
          try { parsed = JSON.parse(u.update_content); } catch (err) { parsed = null; }
        } else if (u.update_content && typeof u.update_content === 'object') {
          parsed = u.update_content;
        }
        if (typeof parsed === 'string') {
          details = escapeHtml(parsed);
        } else if (parsed && typeof parsed === 'object') {
          try {
            const summaryText = parsed.summary || summarizeUpdate(parsed.prev || {}, parsed.next || {});
            if (summaryText) details = escapeHtml(summaryText);
          } catch {}
          const parentNote = typeof parsed.userComment === 'string' ? parsed.userComment.trim() : '';
          if (parentNote) {
            const formattedNote = escapeHtml(parentNote).replace(/\n/g, '<br>');
            parentNoteHtml = `
              <div class="timeline-parent-note">
                <span class="timeline-parent-note__label">Commentaire parent</span>
                <div class="timeline-parent-note__text">${formattedNote}</div>
              </div>
            `.trim();
            if (!details) details = 'Commentaire ajouté au profil.';
          }
          if (growthStatus) {
            const growthInputs = extractGrowthInputsFromUpdate(parsed);
            if (growthInputs.hasMeasurements) {
              const entry = growthStatus.matchUpdate(u, growthInputs);
              if (entry) growthHtml = growthStatus.renderHtml(entry, growthInputs);
            }
          }
        } else if (u.update_content) {
          details = escapeHtml(String(u.update_content));
        }
        if (!growthHtml && growthStatus) {
          const inferredInputs = extractGrowthInputsFromUpdate(parsed);
          if (inferredInputs.hasMeasurements) {
            const entry = growthStatus.matchUpdate(u, inferredInputs);
            if (entry) growthHtml = growthStatus.renderHtml(entry, inferredInputs);
          }
        }
        const typeBadge = u.update_type ? `<span class="timeline-tag">${escapeHtml(u.update_type)}</span>` : '';
        const commentText = typeof u.ai_commentaire === 'string' && u.ai_commentaire
          ? u.ai_commentaire
          : (typeof u.ai_comment === 'string' ? u.ai_comment : '');
        const comment = commentText
          ? `<div class="timeline-ai-note">
              <span class="timeline-ai-note__label">Réponse de Ped’IA</span>
              <div class="timeline-ai-note__text">${escapeHtml(commentText).replace(/\n/g, '<br>')}</div>
            </div>`
          : '';
        return `
          <article class="timeline-item" role="listitem">
            <div class="timeline-marker" aria-hidden="true"></div>
            <div class="timeline-content">
              <div class="timeline-meta">
                <time datetime="${iso}">${when}</time>
                ${typeBadge}
              </div>
              <div class="timeline-summary">${details}</div>
              ${parentNoteHtml}
              ${growthHtml}
              ${comment}
            </div>
          </article>
        `;
      }).join('');

      hist.innerHTML = `
        <div class="card-header history-header">
          <h3>Historique de l’évolution</h3>
          <p class="page-subtitle">Suivez en un coup d’œil les derniers ajouts et observations.</p>
        </div>
      ` + (
        updates.length
          ? `<div class="timeline" role="list">${timelineHtml}</div>`
          : `<div class="empty-state muted">Aucune mise à jour enregistrée pour l’instant.</div>`
      );

      const timelineEl = hist.querySelector('.timeline');
      const actions = document.createElement('div');
      actions.className = 'timeline-actions';
      actions.style.flexWrap = 'wrap';
      actions.style.gap = '8px';

      if (timelineEl && updates.length > 1) {
        const items = Array.from(timelineEl.children);
        items.forEach((el, idx) => {
          if (idx >= 1) el.style.display = 'none';
        });
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary';
        btn.textContent = 'Tout afficher';
        btn.dataset.expanded = '0';
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', () => {
          const expanded = btn.dataset.expanded === '1';
          if (!expanded) {
            items.forEach(el => { el.style.display = ''; });
            btn.textContent = 'Réduire';
            btn.dataset.expanded = '1';
            btn.setAttribute('aria-expanded', 'true');
          } else {
            items.forEach((el, idx) => { if (idx >= 1) el.style.display = 'none'; });
            btn.textContent = 'Tout afficher';
            btn.dataset.expanded = '0';
            btn.setAttribute('aria-expanded', 'false');
          }
        });
        actions.appendChild(btn);
      }

      const reportBtn = document.createElement('button');
      reportBtn.type = 'button';
      reportBtn.className = 'btn btn-primary';
      reportBtn.textContent = 'Bilan complet';
      reportBtn.dataset.loading = '0';
      const reportSpinner = createLoadingSpinnerNode({ className: 'loading-spinner--inline' });
      const reportControls = document.createElement('div');
      reportControls.className = 'submit-with-spinner';
      reportControls.appendChild(reportBtn);
      reportControls.appendChild(reportSpinner);
      actions.appendChild(reportControls);
      hist.appendChild(actions);

      const reportContainer = document.createElement('div');
      reportContainer.className = 'timeline-report-block';
      reportContainer.style.marginTop = '12px';

      const reportMessage = document.createElement('div');
      reportMessage.className = 'muted';
      if (growthStatus?.notice?.message) {
        reportMessage.textContent = growthStatus.notice.message;
        reportMessage.classList.add('warning');
      } else {
        reportMessage.textContent = useRemote()
          ? 'Cliquez sur « Bilan complet » pour générer un rapport synthétique.'
          : 'Connectez-vous pour générer un rapport complet.';
      }
      reportMessage.setAttribute('role', 'status');
      reportMessage.setAttribute('aria-live', 'polite');

      const reportHighlights = document.createElement('div');
      reportHighlights.className = 'report-highlights';
      const highlightsId = `report-highlights-${safeChild.id || 'local'}`;
      reportHighlights.id = highlightsId;
      if (growthStatus) {
        try { updateReportHighlights(reportHighlights, growthStatus); } catch (err) { console.warn('updateReportHighlights failed', err); }
      }

      const reportContent = document.createElement('div');
      reportContent.className = 'timeline-report-content';
      reportContent.style.whiteSpace = 'pre-wrap';
      reportContent.style.lineHeight = '1.5';
      reportContent.style.fontSize = '14px';
      reportContent.style.padding = '12px';
      reportContent.style.borderRadius = '12px';
      reportContent.style.border = '1px solid var(--border)';
      reportContent.style.background = 'rgba(255,255,255,.06)';
      reportContent.style.marginTop = '8px';
      reportContent.style.maxHeight = '260px';
      reportContent.style.overflowY = 'auto';
      reportContent.hidden = true;
      reportContent.tabIndex = 0;
      const reportContentId = `child-full-report-${safeChild.id || 'local'}`;
      reportContent.id = reportContentId;
      reportBtn.setAttribute('aria-controls', reportContentId);

      reportContainer.appendChild(reportMessage);
      reportContainer.appendChild(reportHighlights);
      reportContainer.appendChild(reportContent);
      hist.appendChild(reportContainer);

      reportBtn.addEventListener('click', async () => {
        if (reportBtn.dataset.loading === '1') return;
        const remoteReady = useRemote();
        if (!remoteReady) {
          reportMessage.textContent = 'Connectez-vous pour générer un bilan complet.';
          return;
        }
        reportBtn.dataset.loading = '1';
        showButtonLoading(reportBtn, reportSpinner);
        reportMessage.textContent = 'Génération du bilan en cours…';
        reportContent.hidden = true;
        reportContent.textContent = '';
        let hadError = false;
        try {
          const report = await fetchChildFullReport(safeChild.id, { growthStatus });
          reportMessage.textContent = 'Bilan généré ci-dessous.';
          reportContent.textContent = report;
          reportContent.hidden = false;
          reportContent.scrollTop = 0;
          if (typeof reportContent.focus === 'function') {
            try { reportContent.focus({ preventScroll: true }); } catch {}
          }
          requestAnimationFrame(() => {
            if (!document.body.contains(reportContent)) return;
            const scrollTarget = reportContent.closest('.timeline-report-block') || reportContent;
            if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') {
              scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          });
        } catch (err) {
          const msg = err && typeof err.message === 'string'
            ? err.message
            : 'Bilan indisponible pour le moment.';
          reportMessage.textContent = msg;
          reportContent.hidden = true;
          reportContent.textContent = '';
          hadError = true;
        } finally {
          reportBtn.dataset.loading = '0';
          resolveButtonLoading(reportBtn, reportSpinner, {
            failed: hadError,
            defaultLabel: 'Bilan complet',
            failureLabel: 'Réessayer',
          });
        }
      });

      if (rid !== renderDashboard._rid) return;
      dom.appendChild(hist);
      const timelineNode = dom.querySelector('#timeline-1000-days');
      if (timelineNode) {
        dom.appendChild(timelineNode);
      }
      maybeFocusDashboardSection();
    } catch {}

    // Ajouter le bloc de conseils après l’historique
    const adviceWrap = document.createElement('div');
    adviceWrap.className = 'grid-2';
    adviceWrap.style.marginTop = '12px';
    adviceWrap.innerHTML = `
        <div class="card stack">
          <h3>Conseils IA (indicatifs)</h3>
          ${renderAdvice(ageM)}
        </div>
    `;
    if (rid !== renderDashboard._rid) return;
    dom.appendChild(adviceWrap);
    maybeFocusDashboardSection();

    // Gérer le formulaire de mesures (interface retirée ; garde au cas où)
    const formMeasure = $('#form-measure');
    if (formMeasure) formMeasure.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      if (form.dataset.busy === '1') return; // anti double-clic
      form.dataset.busy = '1';
      const submitEls = form.querySelectorAll('button[type="submit"],input[type="submit"]');
      submitEls.forEach(b => { b.disabled = true; });
      const fd = new FormData(form);
      const month = +fd.get('month');
      const height = parseFloat(fd.get('height'));
      const weight = parseFloat(fd.get('weight'));
      const sleep = parseFloat(fd.get('sleep'));
      const teeth = parseInt(fd.get('teeth'));
      const summaryParts = [];
      if (Number.isFinite(height)) summaryParts.push(`Taille: ${height} cm`);
      if (Number.isFinite(weight)) summaryParts.push(`Poids: ${weight} kg`);
      if (Number.isFinite(teeth)) summaryParts.push(`Dents: ${teeth}`);
      if (Number.isFinite(sleep)) summaryParts.push(`Sommeil: ${sleep} h`);
      const summary = summaryParts.join(' ; ');
      try {
        let handled = false;
        if (useRemote()) {
          try {
            const childAccess = dataProxy.children();
            if (childAccess.isAnon) {
              const measurementInputs = [];
              if (Number.isFinite(height)) measurementInputs.push({ month, height });
              if (Number.isFinite(weight)) measurementInputs.push({ month, weight });
              const measurementRecords = buildMeasurementPayloads(measurementInputs);
              const sleepRecords = Number.isFinite(sleep) ? buildSleepPayloads([{ month, hours: sleep }]) : [];
              const teethRecords = Number.isFinite(teeth) ? buildTeethPayloads([{ month, count: teeth }]) : [];
              await childAccess.callAnon('add-growth', {
                childId: safeChild.id,
                growthMeasurements: measurementRecords,
                growthSleep: sleepRecords,
                growthTeeth: teethRecords
              });
              await logChildUpdate(safeChild.id, 'measure', { summary, month, height, weight, sleep, teeth });
              renderDashboard();
              handled = true;
            } else {
              const supaClient = await childAccess.getClient();
              const promises = [];
              if (Number.isFinite(height) || Number.isFinite(weight)) {
                const payload = {
                  child_id: safeChild.id,
                  month,
                  height_cm: Number.isFinite(height) ? Number(height) : null,
                  weight_kg: Number.isFinite(weight) ? Number(weight) : null,
                };
                if (payload.child_id && Number.isInteger(payload.month)) {
                  promises.push(
                    supaClient
                      .from('growth_measurements')
                      .upsert([payload], { onConflict: 'child_id,month' })
                  );
                } else {
                  console.warn('Skip growth_measurements, invalid payload:', payload);
                }
              }
              if (Number.isFinite(sleep) && safeChild?.id) {
                promises.push((async () => {
                  try {
                    const { data, error } = await supaClient
                      .from('growth_sleep')
                      .insert([{ child_id: safeChild.id, month, hours: sleep }]);
                    if (error) {
                      console.error('Erreur insert growth_sleep:', error);
                    } else {
                    }
                  } catch (err) {
                    console.error('Exception insert growth_sleep:', err);
                  }
                })());
              }
              if (Number.isFinite(teeth)) {
                const payload = { child_id: safeChild.id, month, count: teeth };
                promises.push(
                  supaClient
                    .from('growth_teeth')
                    .insert([payload])
                );
              }
              const results = await Promise.allSettled(promises);
              await logChildUpdate(safeChild.id, 'measure', { summary, month, height, weight, sleep, teeth });
              renderDashboard();
              handled = true;
            }
          } catch (err) {
            console.error('Supabase error (form-measure):', err);
            alert('Erreur Supabase — enregistrement local des mesures.');
          }
        }
        if (!handled) {
        // Repli local
          const children = store.get(K.children, []);
          const c = children.find(x => x.id === safeChild.id);
          if (c) {
            if (!c.growth || typeof c.growth !== 'object') { c.growth = { measurements: [], sleep: [], teeth: [] }; }
            if (!Array.isArray(c.growth.measurements)) c.growth.measurements = [];
            if (!Array.isArray(c.growth.sleep)) c.growth.sleep = [];
            if (!Array.isArray(c.growth.teeth)) c.growth.teeth = [];
            if (Number.isFinite(height) || Number.isFinite(weight)) {
              const m = { month };
              if (Number.isFinite(height)) m.height = height;
              if (Number.isFinite(weight)) m.weight = weight;
              if (Number.isFinite(height) && Number.isFinite(weight)) {
                m.bmi = weight / Math.pow(height / 100, 2);
              }
              m.measured_at = new Date().toISOString();
              c.growth.measurements.push(m);
            }
            if (Number.isFinite(sleep)) c.growth.sleep.push({ month, hours: sleep });
            if (Number.isFinite(teeth)) c.growth.teeth.push({ month, count: teeth });
            store.set(K.children, children);
          }
          await logChildUpdate(safeChild.id, 'measure', { summary, month, height, weight, sleep, teeth });
          renderDashboard();
        }
      } finally {
        submitEls.forEach(b => { b.disabled = false; });
        delete form.dataset.busy;
      }
    });

    // Bouton pour afficher/masquer les jalons
    try {
      const btn = document.getElementById('btn-toggle-milestones');
      const list = document.getElementById('milestones-list');
      if (btn && list && !btn.dataset.bound) {
        btn.addEventListener('click', () => {
          const willShow = list.hidden;
          list.hidden = !willShow;
          btn.textContent = willShow ? 'Masquer les jalons' : 'Afficher les jalons';
        });
        btn.dataset.bound = '1';
      }
    } catch {}

    // Graphiques
    const ms = normalizeMeasures(measurements);
    const heightData = ms.filter(m=>Number.isFinite(m.height)).map(m=>({month:m.month,value:m.height}));
    const weightData = ms.filter(m=>Number.isFinite(m.weight)).map(m=>({month:m.month,value:m.weight}));
    const bmiData = ms.filter(m=>Number.isFinite(m.bmi))
                      .map(m=>({month:m.month, value: m.bmi}));
    const safeRender = (id, data, curve, unit) => {
      if (rid !== renderDashboard._rid) return;
      try {
        renderWhoChart(id, data, curve, unit);
      } catch (e) {
        console.error(e);
        const host = document.getElementById(id)?.parentElement;
        if (host) {
          const note = document.createElement('div');
          note.className = 'chart-note';
          note.textContent = 'Impossible de charger les courbes OMS';
          host.appendChild(note);
        }
      }
    };
    safeRender('chart-height', heightData, curves.LENGTH_FOR_AGE, 'cm');
    safeRender('chart-weight', weightData, curves.WEIGHT_FOR_AGE, 'kg');
    safeRender('chart-bmi', bmiData, curves.BMI_FOR_AGE, 'IMC');
    if (rid === renderDashboard._rid) {
      drawChart($('#chart-teeth'), buildSeries(teethEntries.map(t=>({x:t.month,y:t.count}))));
    }

    // Notes explicatives en langage simple pour les parents
    try {
      if (rid !== renderDashboard._rid) return;
      const latestT = [...teethEntries].sort((a,b)=> (a.month??0)-(b.month??0)).slice(-1)[0];
      const noteT = document.createElement('div'); noteT.className='chart-note';
      if (latestT) noteT.textContent = `Dernier relevé: ${latestT.count} dent(s). Le calendrier d’éruption varie beaucoup — comparez surtout avec les observations précédentes.`;
      else noteT.textContent = 'Ajoutez un relevé de dents pour suivre l’évolution.';
      document.getElementById('chart-teeth')?.parentElement?.appendChild(noteT);
    } catch {}

    // Assistant IA retiré du dashboard (disponible dans /ai)
    };

    if (!useRemote()) {
      await renderForChild(child);
    } else {
      (async () => {
        let remoteChild = null;
        let gmErr = null;
        let gmCount = 0;
        try {
          if (isAnonProfile()) {
            const childAccess = dataProxy.children();
            const listRes = await withRetry(() => childAccess.callAnon('list', {}));
            const rows = Array.isArray(listRes.children) ? listRes.children : [];
            if (!rows.length) {
              if (rid !== renderDashboard._rid) return;
              setDashboardHtml(`<div class="card stack"><p>Aucun profil. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Créer un profil enfant</a></div>`);
              return;
            }
            const slimRemote = rows.map(r => ({ id: r.id, firstName: r.first_name, dob: r.dob, isPrimary: !!r.is_primary }));
            const selId = (slimRemote.find(s=>s.isPrimary) || slimRemote[0]).id;
            if (rid !== renderDashboard._rid) return;
            renderChildSwitcher(dom.parentElement || dom, slimRemote, selId, () => renderDashboard());
            const primary = rows.find(r => r.id === selId) || rows[0];
            const detail = await withRetry(() => childAccess.callAnon('get', { childId: primary.id }));
            const data = detail.child;
            if (!data) throw new Error('Profil introuvable');
            const mapped = mapRowToChild(data);
            if (!mapped) throw new Error('Profil introuvable');
            remoteChild = mapped;
            const growth = detail.growth || {};
            (growth.measurements || []).forEach(m => {
              const h = Number(m?.height_cm);
              const w = Number(m?.weight_kg);
              const heightValid = Number.isFinite(h);
              const weightValid = Number.isFinite(w);
              remoteChild.growth.measurements.push({
                month: m.month,
                height: heightValid ? h : null,
                weight: weightValid ? w : null,
                bmi: heightValid && weightValid && h ? w / Math.pow(h / 100, 2) : null,
                measured_at: m.created_at
              });
            });
            (growth.sleep || []).forEach(s => remoteChild.growth.sleep.push({ month: s.month, hours: s.hours }));
            (growth.teeth || []).forEach(t => remoteChild.growth.teeth.push({ month: t.month, count: t.count }));
            gmCount = remoteChild.growth.measurements.length;
          } else {
            const uid = getActiveProfileId();
            if (!uid) {
              console.warn('Aucun user_id disponible pour la requête children (renderDashboard) — fallback local');
              const u = store.get(K.user) || {};
              const all = store.get(K.children, []);
              if (!all.length) {
                if (rid !== renderDashboard._rid) return;
                setDashboardHtml(`<div class="card stack"><p>Aucun profil. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Créer un profil enfant</a></div>`);
                return;
              }
              const slimLocal = all.map(c => ({ id: c.id, firstName: c.firstName, dob: c.dob, isPrimary: c.id === u.primaryChildId }));
              const selId = (slimLocal.find(s=>s.isPrimary) || slimLocal[0]).id;
              if (rid !== renderDashboard._rid) return;
              renderChildSwitcher(dom.parentElement || dom, slimLocal, selId, () => renderDashboard());
              const child = all.find(c => c.id === selId) || all[0];
              await renderForChild(child);
              return;
            }
            const { data: rows, error: rowsErr } = await withRetry(() =>
              supabase
                .from('children')
                .select('*')
                .eq('user_id', uid)
                .order('created_at', { ascending: true })
            );
            if (rowsErr) throw rowsErr;
            if (!rows || !rows.length) {
              if (rid !== renderDashboard._rid) return;
              setDashboardHtml(`<div class="card stack"><p>Aucun profil. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Créer un profil enfant</a></div>`);
              return;
            }
            const slimRemote = rows.map(r => ({ id: r.id, firstName: r.first_name, dob: r.dob, isPrimary: !!r.is_primary }));
            const selId = (slimRemote.find(s=>s.isPrimary) || slimRemote[0]).id;
            if (rid !== renderDashboard._rid) return;
            renderChildSwitcher(dom.parentElement || dom, slimRemote, selId, () => renderDashboard());
            const primary = rows.find(r=>r.is_primary) || rows[0];
            remoteChild = {
              id: primary.id,
              firstName: primary.first_name,
              sex: primary.sex,
              dob: primary.dob,
              photo: primary.photo_url,
              context: {
                allergies: primary.context_allergies,
                history: primary.context_history,
                care: primary.context_care,
                languages: primary.context_languages,
                feedingType: primary.feeding_type,
                eatingStyle: primary.eating_style,
                sleep: {
                  falling: primary.sleep_falling,
                  sleepsThrough: primary.sleep_sleeps_through,
                  nightWakings: primary.sleep_night_wakings,
                  wakeDuration: primary.sleep_wake_duration,
                  bedtime: primary.sleep_bedtime
                }
              },
              milestones: Array.isArray(primary.milestones)? primary.milestones : [],
              growth: { measurements: [], sleep: [], teeth: [] }
            };
            const [{ data: gm, error: gmErrLocal }, { data: gs }, { data: gt }] = await withRetry(() => Promise.all([
              supabase
                .from('growth_measurements')
                .select('month, height_cm, weight_kg, created_at')
                .eq('child_id', primary.id)
                .order('month', { ascending: true }),
              supabase.from('growth_sleep').select('month,hours').eq('child_id', primary.id),
              supabase.from('growth_teeth').select('month,count').eq('child_id', primary.id),
            ]));
            gmErr = gmErrLocal;
            const measurements = (gm || []).map(m => {
              const h = m.height_cm == null ? null : Number(m.height_cm);
              const w = m.weight_kg == null ? null : Number(m.weight_kg);
              return {
                month: m.month,
                height: h,
                weight: w,
                bmi: w && h ? w / Math.pow(h / 100, 2) : null,
                measured_at: m.created_at
              };
            });
            gmCount = measurements.length;
            measurements.forEach(m => remoteChild.growth.measurements.push(m));
            (gs||[]).forEach(r=> remoteChild.growth.sleep.push({ month: r.month, hours: r.hours }));
            (gt||[]).forEach(r=> remoteChild.growth.teeth.push({ month: r.month, count: r.count }));
          }
        } catch (e) {
          if (rid !== renderDashboard._rid) return;
          console.warn('renderDashboard remote load failed', e);
          showError('Impossible de charger le profil. Veuillez actualiser la page ou réessayer plus tard.');
          setDashboardHtml(`<div class="card stack"><p>Impossible de charger le profil. Veuillez actualiser la page ou réessayer plus tard.</p></div>`);
          return;
        }
        if (rid !== renderDashboard._rid) return;
        await renderForChild(remoteChild);
        if (rid !== renderDashboard._rid) return;
        if (gmErr) {
          ['chart-height', 'chart-weight', 'chart-bmi'].forEach(id => {
            const host = document.getElementById(id)?.parentElement;
            if (host) {
              const note = document.createElement('div');
              note.className = 'chart-note';
              note.textContent = 'Impossible de récupérer les mesures';
              host.appendChild(note);
            }
          });
        } else if (gmCount === 0) {
          ['chart-height', 'chart-weight', 'chart-bmi'].forEach(id => {
            const host = document.getElementById(id)?.parentElement;
            if (host) {
              const note = document.createElement('div');
              note.className = 'chart-note';
              note.textContent = 'Aucune mesure enregistrée';
              host.appendChild(note);
            }
          });
        }
      })();
    }
  }

  async function renderFamilyDashboardView({ dom, rid, setDashboardHtml }) {
    if (!useRemote()) {
      setDashboardHtml('<div class="card stack"><p>Connectez-vous pour accéder à la vue famille.</p></div>');
      return;
    }
    try {
      setDashboardHtml('<div class="card stack"><p>Chargement du contexte familial…</p></div>');
      const data = await fetchFamilyOverview();
      if (rid !== renderDashboard._rid) return;
      setDashboardHtml(buildFamilyDashboardHtml(data));
      bindFamilyViewActions(dom);
      maybeFocusDashboardSection();
    } catch (err) {
      console.warn('renderFamilyDashboardView failed', err);
      if (rid !== renderDashboard._rid) return;
      setDashboardHtml('<div class="card stack"><p>Impossible de charger la vue famille pour le moment.</p><button type="button" class="btn btn-secondary" id="btn-retry-family">Réessayer</button></div>');
      dom.querySelector('#btn-retry-family')?.addEventListener('click', () => renderDashboard());
    }
  }

  function labelParentUpdateType(type) {
    if (!type) return 'Mise à jour';
    const key = String(type).trim();
    if (key === PARENT_UPDATE_SNAPSHOT_TYPE) return 'Contexte parental';
    if (PARENT_CONTEXT_TITLES[key]) return PARENT_CONTEXT_TITLES[key];
    return key.replace(/_/g, ' ');
  }

  function formatParentUpdateValue(field, value) {
    if (!field) {
      if (value == null) return '—';
      const str = String(value).trim();
      return str || '—';
    }
    const key = String(field);
    if (key === 'full_name' || key === 'parent_role') {
      const str = value == null ? '' : String(value).trim();
      return str || '—';
    }
    return formatParentContextValue(key, value);
  }

  function formatParentUpdateDetail(change) {
    if (!change || !change.field) return '';
    const field = String(change.field);
    const label = PARENT_CONTEXT_TITLES[field] || labelParentUpdateType(field);
    const previous = formatParentUpdateValue(field, change.previous);
    const next = formatParentUpdateValue(field, change.next);
    if (previous === next) return `${label}: ${next}`;
    return `${label}: ${previous} → ${next}`;
  }

  function parseParentUpdateRowContent(row) {
    const raw = row?.update_content;
    let parsed = null;
    if (typeof raw === 'string' && raw.trim()) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw.trim();
      }
    } else if (raw && typeof raw === 'object') {
      parsed = raw;
    }
    let summary = '';
    let snapshot = null;
    let context = null;
    const changes = [];
    let source = null;
    let commentOrigin = null;
    let usedAiBilan = false;
    let familyBilanPreview = '';
    if (typeof parsed === 'string') {
      summary = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (typeof parsed.summary === 'string') summary = parsed.summary.trim();
      if (parsed.snapshot && typeof parsed.snapshot === 'object') snapshot = parsed.snapshot;
      if (!context) {
        if (snapshot?.context && typeof snapshot.context === 'object') context = snapshot.context;
        else if (parsed.context && typeof parsed.context === 'object') context = parsed.context;
      }
      if (Array.isArray(parsed.changes)) {
        parsed.changes.forEach((entry) => {
          if (!entry || typeof entry !== 'object') return;
          const field = entry.field || entry.key || '';
          const previous = entry.previous ?? entry.before ?? entry.old ?? null;
          const next = entry.next ?? entry.after ?? entry.new ?? null;
          if (!field && previous == null && next == null) return;
          changes.push({ field, previous, next });
        });
      } else if (parsed.field) {
        const field = parsed.field;
        const previous = parsed.previous ?? parsed.before ?? parsed.old ?? null;
        const next = parsed.next ?? parsed.after ?? parsed.new ?? null;
        changes.push({ field, previous, next });
      }
      if (typeof parsed.source === 'string') source = parsed.source;
      if (typeof parsed.comment_origin === 'string') commentOrigin = parsed.comment_origin;
      const applyAiMetaCandidate = (candidate) => {
        if (!candidate || typeof candidate !== 'object') return;
        if (typeof candidate.usedAiBilan === 'boolean') usedAiBilan = usedAiBilan || candidate.usedAiBilan;
        if (typeof candidate.used_ai_bilan === 'boolean') usedAiBilan = usedAiBilan || candidate.used_ai_bilan;
        if (typeof candidate.aiBilanUsed === 'boolean') usedAiBilan = usedAiBilan || candidate.aiBilanUsed;
        if (typeof candidate.familyBilanPreview === 'string' && !familyBilanPreview) {
          const preview = sanitizeFamilyBilanPreview(candidate.familyBilanPreview);
          if (preview) familyBilanPreview = preview;
        }
        if (typeof candidate.ai_bilan_preview === 'string' && !familyBilanPreview) {
          const preview = sanitizeFamilyBilanPreview(candidate.ai_bilan_preview);
          if (preview) familyBilanPreview = preview;
        }
      };
      applyAiMetaCandidate(parsed.ai_meta);
      applyAiMetaCandidate(parsed.aiMeta);
      applyAiMetaCandidate(parsed.ai_commentaire_meta);
      if (typeof parsed.ai_bilan_used === 'boolean') usedAiBilan = usedAiBilan || parsed.ai_bilan_used;
      if (typeof parsed.used_ai_bilan === 'boolean') usedAiBilan = usedAiBilan || parsed.used_ai_bilan;
      if (typeof parsed.usedAiBilan === 'boolean') usedAiBilan = usedAiBilan || parsed.usedAiBilan;
      if (typeof parsed.ai_bilan_preview === 'string' && !familyBilanPreview) {
        const preview = sanitizeFamilyBilanPreview(parsed.ai_bilan_preview);
        if (preview) familyBilanPreview = preview;
      }
    }
    if (!commentOrigin) {
      if (source === 'ai') commentOrigin = 'ai';
      else if (source === 'parent') commentOrigin = 'parent';
    }
    const aiMeta = usedAiBilan || familyBilanPreview
      ? { usedAiBilan, familyBilanPreview }
      : null;
    return {
      raw: parsed,
      summary,
      snapshot,
      context,
      changes,
      source,
      commentOrigin,
      aiMeta,
    };
  }

  function buildParentUpdatesListItem(row, extraClass = '') {
    if (!row || typeof row !== 'object') return '';
    const parsed = parseParentUpdateRowContent(row);
    const typeLabel = labelParentUpdateType(row?.update_type);
    const created = row?.created_at ? new Date(row.created_at) : null;
    const hasValidDate = created && !Number.isNaN(created.getTime());
    const timeAttr = hasValidDate ? created.toISOString() : '';
    const dateLabel = hasValidDate
      ? created.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
      : 'Date inconnue';
    let summary = parsed.summary || '';
    if (!summary && row?.update_type === PARENT_UPDATE_SNAPSHOT_TYPE) {
      const snapshot = parsed.snapshot || (parsed.context ? { context: parsed.context } : null);
      summary = buildParentSnapshotSummary(snapshot);
    }
    const detailStrings = parsed.changes.map((change) => formatParentUpdateDetail(change)).filter(Boolean);
    if (!summary && detailStrings.length) summary = detailStrings[0];
    if (!summary && typeof parsed.raw === 'string') summary = parsed.raw;
    if (!summary) summary = 'Mise à jour enregistrée.';
    let detailsHtml = '';
    if (detailStrings.length) {
      const detailsToRender = (!parsed.summary && summary === detailStrings[0])
        ? detailStrings.slice(1)
        : detailStrings;
      if (detailsToRender.length) {
        detailsHtml = `<ul class="parent-update-details">${detailsToRender.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>`;
      }
    }
    const storedParentComment = typeof row?.parent_comment === 'string' ? row.parent_comment.trim() : '';
    const storedAiComment = typeof row?.ai_commentaire === 'string' ? row.ai_commentaire.trim() : '';
    const parsedAiComment = (() => {
      const raw = parsed?.raw;
      if (!raw || typeof raw !== 'object') return '';
      const candidates = [];
      if (typeof raw.ai_commentaire === 'string') candidates.push(raw.ai_commentaire.trim());
      if (typeof raw.aiCommentaire === 'string') candidates.push(raw.aiCommentaire.trim());
      if (raw.snapshot && typeof raw.snapshot === 'object') {
        const snapshotComment = raw.snapshot.ai_commentaire ?? raw.snapshot.aiCommentaire;
        if (typeof snapshotComment === 'string') candidates.push(snapshotComment.trim());
      }
      return candidates.find((value) => value) || '';
    })();
    const aiComment = parsedAiComment && parsedAiComment.length > storedAiComment.length
      ? parsedAiComment
      : storedAiComment;
    const originKey = (parsed.commentOrigin || '').toLowerCase();
    const parentBlocks = [];
    const aiBlocks = [];
    const otherBlocks = [];
    if (storedParentComment) {
      parentBlocks.push({ label: 'Commentaire parent', text: storedParentComment });
    }
    if (aiComment) {
      if (!storedParentComment && (!originKey || originKey === 'parent')) {
        parentBlocks.push({ label: 'Commentaire parent', text: aiComment });
      } else if (originKey && originKey !== 'ai' && originKey !== 'parent') {
        const originLabel = originKey === 'coach'
          ? 'Commentaire coach'
          : originKey === 'pro'
            ? 'Commentaire professionnel'
            : `Commentaire ${originKey}`;
        otherBlocks.push({ label: originLabel, text: aiComment });
      } else {
        aiBlocks.push({ label: 'Réponse de Ped’IA', text: aiComment });
      }
    }
    const renderNote = (label, text) => `
      <div class="timeline-parent-note">
        <span class="timeline-parent-note__label">${escapeHtml(label)}</span>
        <div class="timeline-parent-note__text">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
      </div>
    `;
    const renderAi = (label, text) => `
      <div class="timeline-ai-note">
        <span class="timeline-ai-note__label">${escapeHtml(label)}</span>
        <div class="timeline-ai-note__text">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
      </div>
    `;
    const blocksHtml = [
      ...parentBlocks.map((block) => renderNote(block.label, block.text)),
      ...aiBlocks.map((block) => renderAi(block.label, block.text)),
      ...otherBlocks.map((block) => renderNote(block.label, block.text)),
    ].filter(Boolean);
    const commentHtml = blocksHtml.join('');
    const aiMeta = parsed.aiMeta || null;
    const contextBadgeHtml = aiMeta?.usedAiBilan && commentHtml
      ? `
        <div class="parent-update-ai-context">
          <span class="badge">Contexte enfants pris en compte</span>
          ${aiMeta.familyBilanPreview ? `<span class="parent-update-ai-context-info" role="img" aria-label="Contexte enfants pris en compte" title="${escapeHtml(aiMeta.familyBilanPreview)}">ℹ️</span>` : ''}
        </div>
      `
      : '';
    const itemClasses = ['parent-update-item'];
    if (extraClass) itemClasses.push(extraClass);
    return `
      <li class="${itemClasses.join(' ')}">
        <div class="parent-update-meta">
          <time datetime="${escapeHtml(timeAttr)}">${escapeHtml(dateLabel)}</time>
          <span class="timeline-tag">${escapeHtml(typeLabel)}</span>
        </div>
        <div class="parent-update-summary">${escapeHtml(summary)}</div>
        ${detailsHtml}
        ${contextBadgeHtml}
        ${commentHtml}
      </li>
    `;
  }

  function buildParentUpdatesSectionHtml(updates = []) {
    const list = Array.isArray(updates) ? updates.filter(Boolean) : [];
    const header = `
      <div class="card-header">
        <h3>Mises à jour parentales</h3>
        <p class="page-subtitle">Historique du contexte parental et des ressentis.</p>
      </div>
    `;
    if (!list.length) {
      return `
        <div class="card stack parent-updates-card" id="dashboard-parent-updates">
          ${header}
          <div class="empty-state muted">Aucune mise à jour parentale enregistrée pour l’instant.</div>
        </div>
      `;
    }
    const shouldCollapse = list.length > 1;
    const itemsHtml = list.map((row, index) => {
      const extraClass = shouldCollapse && index > 0 ? 'hidden js-parent-update-hidden' : '';
      return buildParentUpdatesListItem(row, extraClass);
    }).join('');
    const toggleHtml = shouldCollapse
      ? `
        <div class="parent-updates-actions">
          <button type="button" class="btn btn-secondary parent-updates-toggle" data-state="collapsed" aria-expanded="false">Tout afficher</button>
        </div>
      `
      : '';
    const collapsibleAttr = shouldCollapse ? ' data-collapsible="1"' : '';
    return `
      <div class="card stack parent-updates-card" id="dashboard-parent-updates"${collapsibleAttr}>
        ${header}
        <ul class="parent-updates-list">${itemsHtml}</ul>
        ${toggleHtml}
      </div>
    `;
  }

  function buildFamilyDashboardHtml(data = {}) {
    const parentInfo = data.parentInfo || {};
    const parentContext = { ...DEFAULT_PARENT_CONTEXT, ...(data.parentContext || {}) };
    const formattedContext = {
      maritalStatus: formatParentContextValue('marital_status', parentContext.maritalStatus),
      numberOfChildren: formatParentContextValue('number_of_children', parentContext.numberOfChildren),
      parentalEmployment: formatParentContextValue('parental_employment', parentContext.parentalEmployment),
      parentalEmotion: formatParentContextValue('parental_emotion', parentContext.parentalEmotion),
      parentalStress: formatParentContextValue('parental_stress', parentContext.parentalStress),
      parentalFatigue: formatParentContextValue('parental_fatigue', parentContext.parentalFatigue),
    };
    const growthAlerts = Array.isArray(data.growthAlerts) ? data.growthAlerts : [];
    const contextRows = [
      { label: 'Pseudo', value: parentInfo.pseudo || '—' },
      { label: 'Rôle affiché', value: parentInfo.role || '—' },
      { label: 'Statut marital', value: formattedContext.maritalStatus },
      { label: 'Nombre d’enfants', value: formattedContext.numberOfChildren },
      { label: 'Situation professionnelle', value: formattedContext.parentalEmployment },
      { label: 'État émotionnel', value: formattedContext.parentalEmotion },
      { label: 'Niveau de stress', value: formattedContext.parentalStress },
      { label: 'Niveau de fatigue', value: formattedContext.parentalFatigue },
    ];
    const contextList = `
      <ul class="family-context-list">
        ${contextRows.map((row) => `
          <li>
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.value)}</strong>
          </li>
        `).join('')}
      </ul>
    `;
    const moodEntries = [
      { label: 'Émotion', value: formattedContext.parentalEmotion },
      { label: 'Stress', value: formattedContext.parentalStress },
      { label: 'Fatigue', value: formattedContext.parentalFatigue },
    ].filter((entry) => entry.value && entry.value !== '—');
    const moodChips = moodEntries.length
      ? `
        <div class="family-hero-chips">
          ${moodEntries.map((entry) => `
            <span class="chip chip-soft">
              <span class="chip-label">${escapeHtml(entry.label)}</span>
              <span class="chip-value">${escapeHtml(entry.value)}</span>
            </span>
          `).join('')}
        </div>
      `
      : '';
    const statEntries = [
      { label: 'Statut marital', value: formattedContext.maritalStatus },
      { label: 'Situation professionnelle', value: formattedContext.parentalEmployment },
      { label: 'Nombre d’enfants', value: formattedContext.numberOfChildren },
    ].filter((entry) => entry.value && entry.value !== '—');
    const heroStats = statEntries.length
      ? `
        <div class="family-hero-stats">
          ${statEntries.map((entry) => `
            <div class="family-hero-stat">
              <span class="family-hero-stat-label">${escapeHtml(entry.label)}</span>
              <strong class="family-hero-stat-value">${escapeHtml(entry.value)}</strong>
            </div>
          `).join('')}
        </div>
      `
      : '';
    const parentDisplayName = parentInfo.pseudo || 'Parent principal';
    const avatarInitial = parentDisplayName ? parentDisplayName.slice(0, 1).toUpperCase() : 'P';
    const children = Array.isArray(data.children) ? data.children : [];
    const inferredChildrenLabel = children.length
      ? `${children.length} enfant${children.length > 1 ? 's' : ''}`
      : '';
    const heroSubtitleParts = [];
    if (parentInfo.role) heroSubtitleParts.push(parentInfo.role);
    if (formattedContext.numberOfChildren && formattedContext.numberOfChildren !== '—') heroSubtitleParts.push(formattedContext.numberOfChildren);
    else if (inferredChildrenLabel) heroSubtitleParts.push(inferredChildrenLabel);
    if (formattedContext.maritalStatus && formattedContext.maritalStatus !== '—') heroSubtitleParts.push(formattedContext.maritalStatus);
    const heroSubtitle = heroSubtitleParts.length ? heroSubtitleParts.join(' • ') : 'Profil familial';
    const childrenList = children.length
      ? `<ul class="family-children-list">${children.map((child) => {
          const name = escapeHtml(child.firstName || 'Enfant');
          const initial = (child.firstName || 'E').slice(0, 1).toUpperCase();
          const metaParts = [];
          if (child.sex) metaParts.push(child.sex);
          if (child.ageText) metaParts.push(child.ageText);
          else if (child.dob) metaParts.push(formatAge(child.dob));
          const metaHtml = metaParts.length
            ? `<p class="family-child-meta">${metaParts.map((value) => escapeHtml(value)).join(' • ')}</p>`
            : '';
          let dobHtml = '';
          if (child.dob) {
            const dobDate = new Date(child.dob);
            if (!Number.isNaN(dobDate.getTime())) {
              const dobLabel = dobDate.toLocaleDateString('fr-FR', { dateStyle: 'long' });
              dobHtml = `<p class="family-child-dob muted">Né·e le ${escapeHtml(dobLabel)}</p>`;
            }
          }
          return `
            <li class="family-child-card">
              <div class="family-child-avatar" aria-hidden="true">${escapeHtml(initial)}</div>
              <div class="family-child-body">
                <strong>${name}</strong>
                ${metaHtml}
                ${dobHtml}
              </div>
            </li>
          `;
        }).join('')}</ul>`
      : '<div class="empty-state muted">Aucun enfant associé pour le moment.</div>';
    const heroCard = `
      <div class="card stack family-hero-card">
        <div class="family-hero-header">
          <div class="family-avatar" aria-hidden="true">${escapeHtml(avatarInitial)}</div>
          <div class="family-hero-heading">
            <h2>${escapeHtml(parentDisplayName)}</h2>
            <p class="muted">${escapeHtml(heroSubtitle)}</p>
          </div>
        </div>
        ${moodChips}
        ${heroStats}
      </div>
    `;
    const contextCard = `
      <div class="card stack family-context-card">
        <div class="card-header">
          <h3>Contexte parental</h3>
          <p class="page-subtitle">Synthèse des informations partagées.</p>
        </div>
        ${contextList}
      </div>
    `;
    const childrenCard = `
      <div class="card stack family-children-card">
        <div class="card-header">
          <h3>Enfants associés (${children.length})</h3>
          <p class="page-subtitle">Aperçu des profils suivis.</p>
        </div>
        ${childrenList}
      </div>
    `;
    const childrenFactsRaw = typeof data.familyContext?.children_facts_text === 'string'
      ? data.familyContext.children_facts_text.trim()
      : typeof data.familyContext?.childrenFactsText === 'string'
        ? data.familyContext.childrenFactsText.trim()
        : '';
    const aiBilanRaw = typeof data.familyContext?.ai_bilan === 'string'
      ? data.familyContext.ai_bilan.trim()
      : '';
    const displayBilan = childrenFactsRaw || aiBilanRaw;
    const bilanText = displayBilan
      ? `<div class="family-bilan-text"><p>${escapeHtml(displayBilan).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>`
      : '<div class="empty-state muted">Aucun bilan généré pour l’instant.</div>';
    let generatedInfo = '';
    if (data.familyContext?.last_generated_at) {
      const date = new Date(data.familyContext.last_generated_at);
      if (!Number.isNaN(date.getTime())) {
        generatedInfo = `<p class="family-bilan-meta muted">Dernière génération : ${escapeHtml(date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }))}</p>`;
      }
    }
    const parentUpdatesSection = buildParentUpdatesSectionHtml(data.parentUpdates || []);
    const growthAlertsSection = renderFamilyGrowthAlertsCard(growthAlerts, children);
    return `
      <div class="family-dashboard">
        ${heroCard}
        <div class="family-columns">
          <div class="family-main">
            ${growthAlertsSection}
            ${parentUpdatesSection}
            <div class="card stack family-bilan-card">
              <div class="card-header family-bilan-header">
                <h3>Bilan familial IA</h3>
                <div class="submit-with-spinner">
                  <button type="button" class="btn btn-secondary" id="btn-refresh-family-bilan">Générer le bilan</button>
                  <div class="loading-spinner loading-spinner--inline" id="family-bilan-spinner" hidden aria-hidden="true">
                    <div class="loading-spinner-core"></div>
                  </div>
                </div>
              </div>
              <p class="page-subtitle family-bilan-description">Obtenez en un clic une synthèse personnalisée basée sur vos profils et vos mises à jour partagées.</p>
              ${bilanText}
              ${generatedInfo}
            </div>
          </div>
          <aside class="family-side">
            ${contextCard}
            ${childrenCard}
          </aside>
        </div>
      </div>
    `;
  }

  function bindFamilyViewActions(dom) {
    const refreshBtn = dom.querySelector('#btn-refresh-family-bilan');
    const refreshSpinner = dom.querySelector('#family-bilan-spinner');
    if (refreshBtn) {
      const defaultLabel = 'Générer le bilan';
      const applyBusyState = (isBusy, { failed = false } = {}) => {
        refreshBtn.dataset.busy = isBusy ? '1' : '0';
        if (isBusy) {
          showButtonLoading(refreshBtn, refreshSpinner);
        } else {
          resolveButtonLoading(refreshBtn, refreshSpinner, {
            failed,
            defaultLabel,
            failureLabel: 'Réessayer',
          });
        }
      };
      refreshBtn.dataset.needsRefresh = dashboardState.family.needsManualRefresh ? '1' : '0';
      if (dashboardState.family.regenerating) {
        applyBusyState(true);
      } else {
        applyBusyState(false);
      }
      refreshBtn.addEventListener('click', async () => {
        if (refreshBtn.dataset.busy === '1') return;
        dashboardState.family.needsManualRefresh = false;
        refreshBtn.dataset.needsRefresh = '0';
        const profileId = dashboardState.profileId || getActiveProfileId();
        const anonCode = isAnonProfile()
          ? (activeProfile?.code_unique ? String(activeProfile.code_unique).trim().toUpperCase() : '')
          : '';
        if (!profileId && !anonCode) {
          showNotification({
            title: 'Profil introuvable',
            text: 'Connectez-vous pour générer le bilan familial.',
          });
          dashboardState.family.needsManualRefresh = true;
          refreshBtn.dataset.needsRefresh = '1';
          return;
        }
        applyBusyState(true);
        let hadError = false;
        try {
          const result = await runFamilyContextRegeneration(profileId || null, { refreshDashboard: true, skipIfRunning: false });
          if (result) {
            showNotification({ title: 'Bilan familial mis à jour', text: 'Un nouveau bilan est disponible.' });
            const bilanContainer = dom.querySelector('.family-bilan-card');
            if (bilanContainer) {
              requestAnimationFrame(() => {
                if (!document.body.contains(bilanContainer)) return;
                bilanContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
              });
            }
          }
        } catch (err) {
          console.warn('Family bilan refresh failed', err);
          const message = (err && typeof err.message === 'string' && err.message.trim())
            ? err.message
            : 'Impossible de régénérer un nouveau bilan pour le moment.';
          showNotification({ title: 'Génération impossible', text: message });
          hadError = true;
        } finally {
          if (dashboardState.family.regenerating) {
            applyBusyState(true);
          } else {
            applyBusyState(false, { failed: hadError });
            if (hadError) {
              dashboardState.family.needsManualRefresh = true;
              refreshBtn.dataset.needsRefresh = '1';
            }
          }
        }
      });
    }
    const parentUpdatesCard = dom.querySelector('.parent-updates-card');
    if (parentUpdatesCard) {
      const toggleBtn = parentUpdatesCard.querySelector('.parent-updates-toggle');
      if (toggleBtn && !toggleBtn.dataset.bound) {
        toggleBtn.dataset.bound = '1';
        toggleBtn.addEventListener('click', () => {
          const isExpanded = toggleBtn.dataset.state === 'expanded';
          const hiddenItems = parentUpdatesCard.querySelectorAll('.js-parent-update-hidden');
          hiddenItems.forEach((item) => {
            if (isExpanded) item.classList.add('hidden');
            else item.classList.remove('hidden');
          });
          toggleBtn.dataset.state = isExpanded ? 'collapsed' : 'expanded';
          toggleBtn.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
          toggleBtn.textContent = isExpanded ? 'Tout afficher' : 'Réduire';
        });
      }
    }
  }

  async function fetchFamilyOverview({ force = false } = {}) {
    const state = dashboardState.family;
    if (!useRemote()) {
      const parentContext = getEffectiveParentContext();
      const storedUser = (() => { try { return store.get(K.user) || {}; } catch { return {}; } })();
      const children = (() => {
        try {
          return (store.get(K.children) || []).map((child) => ({
            id: child.id,
            firstName: child.firstName,
            sex: child.sex,
            dob: child.dob,
            ageText: child.dob ? formatAge(child.dob) : '',
          }));
        } catch {
          return [];
        }
      })();
      return {
        parentContext,
        parentInfo: {
          pseudo: storedUser.pseudo || '',
          role: storedUser.role || 'maman',
        },
        children,
        familyContext: null,
        parentUpdates: [],
        growthAlerts: [],
      };
    }
    if (isAnonProfile()) {
      if (!force && state.data && Date.now() - state.lastFetchedAt < 15000) {
        return state.data;
      }
      if (state.inFlight) {
        try { return await state.inFlight; }
        catch (err) { throw err; }
      }
      const fetchPromise = (async () => {
        state.loading = true;
        state.error = null;
        try {
          const parentContext = getEffectiveParentContext();
          const parentInfo = {
            pseudo: activeProfile?.full_name || '',
            role: activeProfile?.parent_role || 'parent',
          };
          const normalizeChild = (child) => {
            if (!child) return null;
            const id = child.id != null ? child.id : child.childId;
            if (id == null) return null;
            const dob = child.dob || child.birthdate || null;
            const firstName = child.firstName || child.first_name || '';
            const sex = child.sex || child.gender || '';
            const ageText = typeof child.ageText === 'string' && child.ageText
              ? child.ageText
              : (dob ? formatAge(dob) : '');
            return {
              id,
              firstName,
              sex,
              dob,
              ageText,
            };
          };
          let children = [];
          try {
            const childAccess = dataProxy.children();
            const res = await withRetry(() => childAccess.callAnon('list', {}));
            const rows = Array.isArray(res.children) ? res.children : [];
            children = rows.map((row) => normalizeChild(row)).filter(Boolean);
          } catch (err) {
            console.warn('fetchFamilyOverview anon child list failed', err);
          }
          if (!children.length) {
            const fallbackSources = [
              Array.isArray(settingsState.children) ? settingsState.children : [],
              (() => { try { return store.get(K.children) || []; } catch { return []; } })(),
            ];
            for (const source of fallbackSources) {
              if (Array.isArray(source) && source.length) {
                children = source.map((child) => normalizeChild(child)).filter(Boolean);
                if (children.length) break;
              }
            }
          }
          let parentUpdates = [];
          let familyContext = state.data?.familyContext || null;
          try {
            const parentAccess = dataProxy.parentUpdates();
            const updatesRes = await withRetry(() => parentAccess.callAnon('list', { limit: PARENT_UPDATES_LIMIT }));
            if (Array.isArray(updatesRes.parentUpdates)) {
              parentUpdates = updatesRes.parentUpdates;
            }
            const profileRow = updatesRes?.profile || null;
            if (profileRow) {
              const normalizedCtx = normalizeParentContext(profileRow, parentContext);
              parentContext.maritalStatus = normalizedCtx.maritalStatus;
              parentContext.numberOfChildren = normalizedCtx.numberOfChildren;
              parentContext.parentalEmployment = normalizedCtx.parentalEmployment;
              parentContext.parentalEmotion = normalizedCtx.parentalEmotion;
              parentContext.parentalStress = normalizedCtx.parentalStress;
              parentContext.parentalFatigue = normalizedCtx.parentalFatigue;
              parentInfo.pseudo = profileRow.full_name || parentInfo.pseudo;
              parentInfo.role = profileRow.parent_role || parentInfo.role;
              const nextProfile = { ...(activeProfile || {}) };
              if (profileRow.id) nextProfile.id = profileRow.id;
              if (Object.prototype.hasOwnProperty.call(profileRow, 'full_name')) {
                nextProfile.full_name = profileRow.full_name || parentInfo.pseudo;
              }
              if (Object.prototype.hasOwnProperty.call(profileRow, 'parent_role')) {
                nextProfile.parent_role = profileRow.parent_role;
              }
              if (Object.prototype.hasOwnProperty.call(profileRow, 'show_children_count')) {
                nextProfile.show_children_count = profileRow.show_children_count;
              }
              if (Object.prototype.hasOwnProperty.call(profileRow, 'code_unique')) {
                nextProfile.code_unique = profileRow.code_unique;
              }
              PARENT_FIELD_DEFS.forEach((def) => {
                if (Object.prototype.hasOwnProperty.call(profileRow, def.column)) {
                  nextProfile[def.column] = profileRow[def.column];
                }
              });
              if (Object.prototype.hasOwnProperty.call(profileRow, 'context_parental')) {
                nextProfile.context_parental = profileRow.context_parental;
              }
              nextProfile.isAnonymous = true;
              setActiveProfile(nextProfile);
            }
            if (updatesRes?.familyContext && typeof updatesRes.familyContext === 'object') {
              const fc = updatesRes.familyContext;
              const aiBilan = typeof fc.ai_bilan === 'string' ? fc.ai_bilan : '';
              const lastGeneratedAt = fc.last_generated_at || fc.lastGeneratedAt || null;
              const childrenIds = Array.isArray(fc.children_ids)
                ? fc.children_ids
                : Array.isArray(fc.childrenIds)
                    ? fc.childrenIds
                    : null;
              const childrenFactsText = typeof fc.children_facts_text === 'string'
                ? fc.children_facts_text
                : typeof fc.childrenFactsText === 'string'
                  ? fc.childrenFactsText
                  : '';
              familyContext = {
                ai_bilan: aiBilan,
                children_facts_text: childrenFactsText,
                last_generated_at: lastGeneratedAt,
                children_ids: childrenIds,
              };
            }
          } catch (err) {
            console.warn('fetchFamilyOverview anon parent list failed', err);
          }
          let growthAlerts = [];
          try {
            growthAlerts = await collectGrowthAlerts(children);
          } catch (err) {
            console.warn('collectGrowthAlerts anon failed', err);
          }
          const result = {
            parentContext,
            parentInfo,
            children,
            familyContext,
            parentUpdates,
            growthAlerts,
          };
          state.data = result;
          state.lastFetchedAt = Date.now();
          return result;
        } catch (err) {
          state.error = err;
          throw err;
        } finally {
          state.loading = false;
          state.inFlight = null;
        }
      })();
      state.inFlight = fetchPromise;
      return fetchPromise;
    }
    if (!force && state.data && Date.now() - state.lastFetchedAt < 15000) {
      return state.data;
    }
    if (state.inFlight) {
      try { return await state.inFlight; }
      catch (err) { throw err; }
    }
    const uid = getActiveProfileId();
    if (!uid) throw new Error('Profil introuvable');
    const fetchPromise = (async () => {
      state.loading = true;
      state.error = null;
      try {
        const [profileRes, childrenRes, familyRes, parentUpdatesRes] = await withRetry(() => Promise.all([
          supabase
            .from('profiles')
            .select('full_name,parent_role,marital_status,number_of_children,parental_employment,parental_emotion,parental_stress,parental_fatigue,context_parental')
            .eq('id', uid)
            .maybeSingle(),
          supabase
            .from('children')
            .select('id,first_name,sex,dob')
            .eq('user_id', uid)
            .order('created_at', { ascending: true }),
          supabase
            .from('family_context')
            .select('ai_bilan,last_generated_at,children_ids,children_facts_text')
            .eq('profile_id', uid)
            .order('last_generated_at', { ascending: false })
            .limit(1),
          supabase
            .from('parent_updates')
            .select('id,update_type,update_content,parent_comment,ai_commentaire,created_at')
            .eq('profile_id', uid)
            .order('created_at', { ascending: false })
            .limit(PARENT_UPDATES_LIMIT),
        ]));
        if (profileRes.error) throw profileRes.error;
        if (childrenRes.error) throw childrenRes.error;
        if (familyRes.error) throw familyRes.error;
        if (parentUpdatesRes.error) throw parentUpdatesRes.error;
        const parentContext = normalizeParentContext(profileRes.data || {});
        const storedUser = (() => { try { return store.get(K.user) || {}; } catch { return {}; } })();
        const parentInfo = {
          pseudo: profileRes.data?.full_name || settingsState.user?.pseudo || storedUser.pseudo || '',
          role: profileRes.data?.parent_role || settingsState.user?.role || storedUser.role || 'maman',
        };
        const children = Array.isArray(childrenRes.data)
          ? childrenRes.data.map((row) => ({
              id: row.id,
              firstName: row.first_name,
              sex: row.sex,
              dob: row.dob,
              ageText: row.dob ? formatAge(row.dob) : '',
            }))
          : [];
        const familyRow = Array.isArray(familyRes.data) ? (familyRes.data[0] || null) : (familyRes.data || null);
        const normalizedFamilyContext = (() => {
          if (!familyRow || typeof familyRow !== 'object') return null;
          const aiBilan = typeof familyRow.ai_bilan === 'string' ? familyRow.ai_bilan : '';
          const childrenFactsText = typeof familyRow.children_facts_text === 'string'
            ? familyRow.children_facts_text
            : typeof familyRow.childrenFactsText === 'string'
              ? familyRow.childrenFactsText
              : '';
          const lastGeneratedAt = familyRow.last_generated_at || familyRow.lastGeneratedAt || null;
          const childrenIds = Array.isArray(familyRow.children_ids)
            ? familyRow.children_ids
            : Array.isArray(familyRow.childrenIds)
              ? familyRow.childrenIds
              : null;
          return {
            ai_bilan: aiBilan,
            children_facts_text: childrenFactsText,
            last_generated_at: lastGeneratedAt,
            children_ids: childrenIds,
          };
        })();
        const parentUpdates = Array.isArray(parentUpdatesRes.data) ? parentUpdatesRes.data : [];
        let growthAlerts = [];
        try {
          growthAlerts = await collectGrowthAlerts(children);
        } catch (err) {
          console.warn('collectGrowthAlerts failed', err);
        }
        return {
          parentContext,
          parentInfo,
          children,
          familyContext: normalizedFamilyContext,
          parentUpdates,
          growthAlerts,
        };
      } finally {
        state.loading = false;
        state.inFlight = null;
      }
    })();
    state.inFlight = fetchPromise;
    try {
      const data = await fetchPromise;
      state.data = data;
      state.lastFetchedAt = Date.now();
      return data;
    } catch (err) {
      state.error = err;
      throw err;
    }
  }

  async function regenerateFamilyContext(profileId, codeOverride = '') {
    const candidateProfileId = profileId || dashboardState.profileId || getActiveProfileId();
    const normalizedProfileId = candidateProfileId ? String(candidateProfileId).trim() : '';
    let normalizedCode = '';
    if (!normalizedProfileId) {
      const overrideCode = codeOverride ? String(codeOverride).trim() : '';
      if (overrideCode) {
        normalizedCode = overrideCode.toUpperCase();
      } else if (isAnonProfile() && activeProfile?.code_unique) {
        normalizedCode = String(activeProfile.code_unique).trim().toUpperCase();
      }
    }
    if (!normalizedProfileId && !normalizedCode) throw new Error('Profil introuvable');
    const payload = {
      type: 'family-bilan',
      profileId: normalizedProfileId || null,
      code_unique: normalizedProfileId ? null : (normalizedCode || null),
    };
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => '');
    let data = {};
    if (text) {
      try { data = JSON.parse(text); } catch {}
    }
    if (!res.ok) {
      const message = (data && typeof data.error === 'string') ? data.error : 'Échec de génération du bilan familial.';
      throw new Error(message);
    }
    if (data?.status === 'unavailable') {
      const message = typeof data.message === 'string' && data.message
        ? data.message
        : 'Fonction IA désactivée.';
      throw new Error(message);
    }
    return data;
  }

  async function runFamilyContextRegeneration(profileId, { refreshDashboard = true, skipIfRunning = false } = {}) {
    const anon = isAnonProfile();
    if (!anon && !useRemote()) return null;
    const state = dashboardState.family;
    const targetProfileId = profileId || dashboardState.profileId || getActiveProfileId();
    const anonCode = anon && activeProfile?.code_unique
      ? String(activeProfile.code_unique).trim().toUpperCase()
      : '';
    if (!targetProfileId && !anonCode) throw new Error('Profil introuvable');
    if (state.regenerationPromise) {
      if (skipIfRunning) {
        state.pendingRefresh = true;
        return state.regenerationPromise;
      }
      try {
        await state.regenerationPromise;
      } catch {}
      return runFamilyContextRegeneration(targetProfileId || null, { refreshDashboard, skipIfRunning });
    }
    state.pendingRefresh = false;
    state.regenerating = true;
    state.error = null;
    const promise = (async () => {
      try {
        const result = await regenerateFamilyContext(targetProfileId || null, targetProfileId ? '' : anonCode);
        const bilan = typeof result?.bilan === 'string' ? result.bilan : '';
        const childrenFactsText = typeof result?.childrenFactsText === 'string'
          ? result.childrenFactsText
          : '';
        const generatedAt = result?.lastGeneratedAt || new Date().toISOString();
        const previousData = state.data && typeof state.data === 'object' ? state.data : {};
        const nextFamilyContext = {
          ...(previousData.familyContext || {}),
          ai_bilan: bilan,
          last_generated_at: generatedAt,
        };
        if (childrenFactsText || (previousData.familyContext && Object.prototype.hasOwnProperty.call(previousData.familyContext, 'children_facts_text'))) {
          nextFamilyContext.children_facts_text = childrenFactsText;
        }
        state.data = { ...previousData, familyContext: nextFamilyContext };
        state.lastFetchedAt = Date.now();
        if (refreshDashboard && dashboardState.viewMode === 'family') {
          try {
            await renderDashboard();
          } catch (renderErr) {
            console.warn('family dashboard render failed after regeneration', renderErr);
          }
        }
        return { bilan, lastGeneratedAt: generatedAt };
      } catch (err) {
        state.error = err;
        throw err;
      } finally {
        state.regenerating = false;
        state.regenerationPromise = null;
        if (state.pendingRefresh) {
          const shouldRunAgain = state.pendingRefresh;
          state.pendingRefresh = false;
          if (shouldRunAgain) {
            runFamilyContextRegeneration(targetProfileId || null, { refreshDashboard, skipIfRunning: true }).catch((err) => {
              console.warn('family context regeneration retry failed', err);
            });
          }
        }
      }
    })();
    state.regenerationPromise = promise;
    return promise;
  }

  function hasFamilyModeContext() {
    const profileId = dashboardState.profileId || getActiveProfileId();
    if (profileId) return true;
    if (isAnonProfile()) {
      const code = activeProfile?.code_unique;
      if (typeof code === 'string' && code.trim()) return true;
      if (code != null && typeof code !== 'string') {
        try {
          return String(code).trim().length > 0;
        } catch {
          return false;
        }
      }
    }
    return false;
  }

  async function scheduleFamilyContextRefresh() {
    try {
      const state = dashboardState.family;
      if (!state) return;
      state.needsManualRefresh = true;
      const refreshBtn = document.querySelector('#btn-refresh-family-bilan');
      if (refreshBtn) {
        refreshBtn.dataset.needsRefresh = '1';
      }
    } catch (err) {
      console.warn('scheduleFamilyContextRefresh failed', err);
    }
  }

  function normalizeMeasures(entries) {
    // les entrées peuvent ne contenir que la taille ou que le poids
    const byMonth = new Map();
    for (const e of entries) {
      const m = e.month ?? e.m ?? 0;
      const obj = byMonth.get(m) || { month: m };
      if (typeof e.height === 'number') obj.height = e.height;
      if (typeof e.weight === 'number') obj.weight = e.weight;
      if (typeof e.bmi === 'number') obj.bmi = e.bmi;
      if (e.measured_at && !obj.measured_at) obj.measured_at = e.measured_at;
      byMonth.set(m, obj);
    }
    for (const obj of byMonth.values()) {
      if (typeof obj.bmi !== 'number' && Number.isFinite(obj.height) && Number.isFinite(obj.weight)) {
        obj.bmi = obj.weight / Math.pow(obj.height / 100, 2);
      }
    }
    return Array.from(byMonth.values()).sort((a,b)=>a.month-b.month);
  }

  // Communauté
  function renderCommunity() {
    // Garde d’instance pour éviter les courses et les doublons DOM
    const rid = (renderCommunity._rid = (renderCommunity._rid || 0) + 1);
    const list = $('#forum-list');
    if (!list) {
      console.warn('Forum list container introuvable');
      return;
    }
    const isListActive = () => document.body.contains(list) && renderCommunity._rid === rid;
    list.innerHTML = '';
    const refreshBtn = $('#btn-refresh-community');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', () => location.reload());
    }
    // Gestionnaires du filtre de catégories
    const cats = $('#forum-cats');
    if (cats && !cats.dataset.bound) {
      cats.addEventListener('click', (e)=>{
        const b = e.target.closest('.cat'); if (!b) return;
        const all = cats.querySelectorAll('.cat'); all.forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        cats.setAttribute('data-active', b.dataset.cat || 'all');
        renderCommunity();
      });
      cats.dataset.bound='1';
    }
    if (cats && !cats.hasAttribute('data-active')) {
      cats.setAttribute('data-active', 'all');
    }
    if (cats) {
      const activeValue = cats.getAttribute('data-active') || 'all';
      cats.querySelectorAll('.cat').forEach((btn) => {
        btn.classList.toggle('active', (btn.dataset.cat || 'all') === activeValue);
      });
    }
    const activeCat = cats?.getAttribute('data-active') || 'all';
    const topicDialog = $('#dialog-topic');
    const topicForm = $('#form-topic');
    const topicCancelBtn = $('#btn-cancel-topic');
    const topicNewBtn = $('#btn-new-topic');
    const resetTopicForm = () => {
      if (!topicForm) return;
      try { topicForm.reset(); } catch {}
      topicForm.dataset.busy = '0';
      const submit = topicForm.querySelector('button[value="submit"], button[type="submit"]');
      if (submit) submit.disabled = false;
    };
    const closeTopicDialog = () => {
      if (!topicDialog) return;
      try {
        if (typeof topicDialog.close === 'function') topicDialog.close();
        else topicDialog.removeAttribute('open');
      } catch {
        topicDialog.removeAttribute('open');
      }
    };
    const focusTopicTitle = () => {
      if (!topicForm) return;
      const titleEl = topicForm.elements?.namedItem?.('title');
      if (titleEl && typeof titleEl.focus === 'function') {
        setTimeout(() => { try { titleEl.focus(); } catch {} }, 30);
      }
    };
    const openTopicDialog = () => {
      if (!topicDialog) return;
      resetTopicForm();
      try {
        if (typeof topicDialog.showModal === 'function') topicDialog.showModal();
        else topicDialog.setAttribute('open', '');
      } catch {
        topicDialog.setAttribute('open', '');
      }
      focusTopicTitle();
    };
    if (topicDialog && !topicDialog.dataset.resetBound) {
      topicDialog.addEventListener('close', resetTopicForm);
      topicDialog.dataset.resetBound = '1';
    }
    if (topicNewBtn && topicDialog && !topicNewBtn.dataset.bound) {
      topicNewBtn.dataset.bound = '1';
      topicNewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openTopicDialog();
      });
    }
    if (topicCancelBtn && !topicCancelBtn.dataset.bound) {
      topicCancelBtn.dataset.bound = '1';
      topicCancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeTopicDialog();
      });
    }
    if (topicForm && !topicForm.dataset.bound) {
      topicForm.dataset.bound = '1';
      topicForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (topicForm.dataset.busy === '1') return;
        if (typeof topicForm.reportValidity === 'function' && !topicForm.reportValidity()) return;
        topicForm.dataset.busy = '1';
        const submit = topicForm.querySelector('button[value="submit"], button[type="submit"]');
        if (submit) submit.disabled = true;
        const fd = new FormData(topicForm);
        const catRaw = (fd.get('category') || '').toString().trim();
        const cat = catRaw || 'Divers';
        const titleRaw = (fd.get('title') || '').toString();
        const titleClean = titleRaw.replace(/^\s*\[[^\]]*\]\s*/,'').trim();
        const content = (fd.get('content') || '').toString().trim();
        if (!titleClean || !content) {
          topicForm.dataset.busy = '0';
          if (submit) submit.disabled = false;
          return;
        }
        const fullTitle = `[${cat}] ${titleClean}`;
        let newTopicId = '';
        try {
          if (useRemote()) {
            if (isAnonProfile()) {
              const res = await anonCommunityRequest('create-topic', { title: fullTitle, content });
              newTopicId = res?.topic?.id != null ? String(res.topic.id) : '';
            } else {
              const uid = getActiveProfileId();
              if (!uid) throw new Error('Pas de user_id');
              const { data, error } = await supabase
                .from('forum_topics')
                .insert([{ user_id: uid, title: fullTitle, content }])
                .select('id')
                .single();
              if (error) throw error;
              if (data?.id != null) newTopicId = String(data.id);
            }
          } else {
            const forum = store.get(K.forum, { topics: [] });
            const user = store.get(K.user);
            const children = store.get(K.children, []);
            const child = children.find(c=>c.id===user?.primaryChildId) || children[0];
            const whoAmI = user?.pseudo || (user ? `${user.role} de ${child? child.firstName : '—'}` : 'Anonyme');
            const id = genId();
            forum.topics.push({ id, title: fullTitle, content, author: whoAmI, createdAt: Date.now(), replies: [] });
            store.set(K.forum, forum);
            newTopicId = id;
          }
        } catch (err) {
          console.error('create-topic failed', err);
          alert('Impossible de publier le sujet pour le moment. Veuillez réessayer.');
          topicForm.dataset.busy = '0';
          if (submit) submit.disabled = false;
          return;
        } finally {
          topicForm.dataset.busy = '0';
          if (submit) submit.disabled = false;
        }
        if (newTopicId) {
          const openSet = (renderCommunity._open = renderCommunity._open || new Set());
          openSet.add(String(newTopicId));
        }
        closeTopicDialog();
        renderCommunity();
      });
    }
    const showEmpty = () => {
      if (rid !== renderCommunity._rid || !isListActive()) return;
      const empty = document.createElement('div');
      empty.className = 'card';
      empty.textContent = 'Aucun sujet pour le moment. Lancez la discussion !';
      list.appendChild(empty);
    };


    const bindReplyForms = (root = document) => {
      root.querySelectorAll('.form-reply').forEach((form) => {
        if (form.dataset.bound) return;
        form.dataset.bound = '1';
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const currentForm = e.currentTarget;
          if (currentForm.dataset.busy === '1') return;
          currentForm.dataset.busy = '1';
          const submitBtn = currentForm.querySelector('button[type="submit"],input[type="submit"]');
          if (submitBtn) submitBtn.disabled = true;
          try {
            const id = currentForm.getAttribute('data-id');
            const fd = new FormData(currentForm);
            const rawContent = fd.get('content');
            const content = rawContent == null ? '' : rawContent.toString().trim();
            if (!content) return;
            if (useRemote()) {
              try {
                if (isAnonProfile()) {
                  await anonCommunityRequest('reply', { topicId: id, content });
                  renderCommunity();
                  return;
                }
                const uid = getActiveProfileId();
                if (!uid) { console.warn('Aucun user_id disponible pour forum_replies'); throw new Error('Pas de user_id'); }
                await supabase.from('forum_replies').insert([{ topic_id: id, user_id: uid, content }]);
                renderCommunity();
                return;
              } catch {}
            }
            // Repli local
            const forum = store.get(K.forum);
            const topic = forum.topics.find(x=>x.id===id);
            const user = store.get(K.user);
            const children = store.get(K.children, []);
            const child = children.find(c=>c.id===user?.primaryChildId) || children[0];
            const whoAmI = user?.pseudo || (user ? `${user.role} de ${child? child.firstName : '—'}` : 'Anonyme');
            topic.replies.push({ content, author: whoAmI, createdAt: Date.now() });
            store.set(K.forum, forum);
            renderCommunity();
          } finally {
            currentForm.dataset.busy='0';
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      });
    };

    const normalizeAuthorMeta = (raw) => {
      if (!raw) return null;
      if (typeof raw === 'string') {
        return { name: raw, childCount: null, showChildCount: false };
      }
      if (typeof raw === 'object') {
        const name = raw.name || raw.full_name || raw.fullName || '';
        let rawCount = raw.child_count ?? raw.childCount ?? raw.children_count ?? raw.childrenCount ?? null;
        if (Array.isArray(raw.children)) {
          rawCount = raw.children.length;
        }
        const count = Number(rawCount);
        const childCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : null;
        const rawShow = raw.show_children_count ?? raw.showChildCount ?? raw.show_stats ?? raw.showStats;
        const showChildCount = typeof rawShow === 'string' ? rawShow === 'true' : !!rawShow;
        return { name: name || 'Utilisateur', childCount, showChildCount };
      }
      return null;
    };

    const renderTopics = (topics, replies, authorsMap) => {
      const activeId = getActiveProfileId();
      if (!topics.length) return showEmpty();
      if (rid !== renderCommunity._rid) return;
      if (!isListActive()) return;
      const openSet = (renderCommunity._open = renderCommunity._open || new Set());
      if (openSet.size) {
        const validTopicIds = new Set(
          topics
            .map((topic) => {
              const value = topic?.id;
              return value != null ? String(value) : '';
            })
            .filter(Boolean)
        );
        Array.from(openSet).forEach((id) => {
          if (!validTopicIds.has(id)) openSet.delete(id);
        });
      }
      const formatDateParts = (value) => {
        if (!value) return { label: '', iso: '' };
        const date = new Date(value);
        const time = date.getTime();
        if (!Number.isFinite(time)) return { label: '', iso: '' };
        let label = '';
        try {
          label = date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
        } catch {
          label = date.toLocaleString('fr-FR');
        }
        return { label, iso: date.toISOString() };
      };
      const initialsFrom = (name) => {
        const words = (name || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return '✦';
        const letters = words.slice(0, 2).map((w) => (w[0] || '').toUpperCase()).join('');
        return letters || '✦';
      };
      const normalizeContent = (text) => escapeHtml(text || '').replace(/\n/g, '<br>');
      const timestampOf = (value) => {
        const date = new Date(value || 0);
        const time = date.getTime();
        return Number.isFinite(time) ? time : 0;
      };
      const formatAuthorName = (rawName) => {
        const baseName = (rawName == null ? '' : String(rawName)).trim();
        const safeName = baseName || 'Anonyme';
        return safeName;
      };
      const renderAuthorMetaInfo = (meta) => {
        if (!meta) return '';
        const normalized = (typeof meta === 'object' && meta !== null && 'childCount' in meta && 'showChildCount' in meta)
          ? meta
          : normalizeAuthorMeta(meta);
        if (!normalized || !normalized.showChildCount) return '';
        if (!Number.isFinite(normalized.childCount)) return '';
        const count = normalized.childCount;
        const suffix = count > 1 ? 'enfants' : 'enfant';
        const label = `Parent de ${count} ${suffix}`;
        return `<span class="author-meta">${escapeHtml(label)}</span>`;
      };
      const isAiAuthor = (name) => {
        if (!name) return false;
        const raw = String(name);
        const base = typeof raw.normalize === 'function' ? raw.normalize('NFKD') : raw;
        const normalized = base
          .toLowerCase()
          .replace(/[\u2010-\u2015]/g, '-')
          .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`´']/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
        return normalized.includes("ped'ia")
          || normalized.includes('ped ia')
          || normalized.includes('ped-ia');
      };
      const renderThreadEntry = ({
        authorName,
        authorMetaHtml,
        initials,
        timeLabel,
        timeIso,
        contentHtml,
        messageBtn,
        label,
        isAi,
      }) => {
        const noteClass = isAi ? 'timeline-ai-note' : 'timeline-parent-note';
        const labelClass = isAi ? 'timeline-ai-note__label' : 'timeline-parent-note__label';
        const textClass = isAi ? 'timeline-ai-note__text' : 'timeline-parent-note__text';
        const safeInitials = escapeHtml(initials || '✦');
        const safeAuthor = escapeHtml(authorName || 'Anonyme');
        const safeLabel = escapeHtml(label || (isAi ? `Réponse de ${authorName}` : `Commentaire de ${authorName}`));
        const timeHtml = timeLabel
          ? `<time datetime="${escapeHtml(timeIso || '')}">${escapeHtml(timeLabel)}</time>`
          : '';
        const actionsHtml = messageBtn
          ? `<div class="topic-entry__actions">${messageBtn}</div>`
          : '';
        return `
          <article class="topic-entry${isAi ? ' topic-entry--ai' : ''}">
            <div class="topic-entry__head">
              <div class="topic-entry__avatar" aria-hidden="true">${safeInitials}</div>
              <div class="topic-entry__meta">
                <div class="topic-entry__author">
                  <span class="topic-entry__author-name">${safeAuthor}</span>
                  ${authorMetaHtml || ''}
                </div>
                ${timeHtml}
              </div>
              ${actionsHtml}
            </div>
            <div class="${noteClass}">
              <span class="${labelClass}">${safeLabel}</span>
              <div class="${textClass}">${contentHtml}</div>
            </div>
          </article>
        `;
      };
      topics.slice().forEach(t => {
        let title = t.title || '';
        let cat = 'Divers';
        const m = title.match(/^\[(.*?)\]\s*(.*)$/);
        if (m) { cat = m[1]; title = m[2]; }
        if (activeCat !== 'all' && cat !== activeCat) return;
        const el = document.createElement('div');
        el.className = 'topic';
        const authorMeta = authorsMap.get(String(t.user_id)) || authorsMap.get(t.user_id) || null;
        const normalizedAuthor = normalizeAuthorMeta(authorMeta);
        const rawAuthorName = (normalizedAuthor && normalizedAuthor.name)
          || (typeof authorMeta === 'string' ? authorMeta : authorMeta?.full_name || authorMeta?.name)
          || t.author
          || 'Anonyme';
        const rs = (replies.get(t.id) || []).slice().sort((a,b)=> timestampOf(a.created_at || a.createdAt) - timestampOf(b.created_at || b.createdAt));
        const tid = String(t.id);
        const isOpen = openSet.has(tid);
        const toggleLabel = isOpen ? 'Réduire la publication' : 'Afficher les commentaires';
        const repliesCount = rs.length;
        const toggleCount = repliesCount ? ` (${repliesCount})` : '';
        const isMobile = document.body.classList.contains('force-mobile');
        const { label: createdLabel, iso: createdIso } = formatDateParts(t.created_at || t.createdAt);
        const displayAuthor = formatAuthorName(rawAuthorName);
        const topicAuthorMetaHtml = renderAuthorMetaInfo(normalizedAuthor || authorMeta);
        const topicAuthorBlock = `
          <span class="topic-author">
            <span class="topic-author-name">${escapeHtml(displayAuthor)}</span>
            ${topicAuthorMetaHtml}
          </span>
        `.trim();
        const initials = initialsFrom(rawAuthorName);
        const messageLabel = isMobile ? '💬' : '💬 Message privé';
        const messageAttrs = isMobile ? ' aria-label="Envoyer un message privé" title="Envoyer un message privé"' : ' title="Envoyer un message privé"';
        const topicMessageBtn = t.user_id ? `<a href="messages.html?user=${encodeURIComponent(String(t.user_id))}" class="btn btn-secondary btn-message"${messageAttrs}>${messageLabel}</a>` : '';
        const topicIsAi = isAiAuthor(displayAuthor);
        const topicEntryHtml = renderThreadEntry({
          authorName: displayAuthor,
          authorMetaHtml: topicAuthorMetaHtml,
          initials,
          timeLabel: createdLabel,
          timeIso: createdIso,
          contentHtml: normalizeContent(t.content),
          messageBtn: '',
          label: topicIsAi ? 'Message de Ped’IA' : 'Publication initiale',
          isAi: topicIsAi,
        });
        const repliesHtml = rs.map(r=>{
          const replyMeta = authorsMap.get(String(r.user_id)) || authorsMap.get(r.user_id) || null;
          const normalizedReply = normalizeAuthorMeta(replyMeta);
          const rawReplyAuthor = (normalizedReply && normalizedReply.name)
            || (typeof replyMeta === 'string' ? replyMeta : replyMeta?.full_name || replyMeta?.name)
            || r.author
            || 'Anonyme';
          const replyAuthor = formatAuthorName(rawReplyAuthor);
          const replyAuthorMetaHtml = renderAuthorMetaInfo(normalizedReply || replyMeta);
          const replyInitials = initialsFrom(rawReplyAuthor);
          const { label: replyTimeLabel, iso: replyIso } = formatDateParts(r.created_at || r.createdAt);
          const replyMessageBtn = r.user_id ? `<a href="messages.html?user=${encodeURIComponent(String(r.user_id))}" class="btn btn-secondary btn-message btn-message--small"${messageAttrs}>${messageLabel}</a>` : '';
          const isReplyAi = isAiAuthor(replyAuthor);
          const replyLabel = isReplyAi ? 'Réponse de Ped’IA' : `Réponse de ${replyAuthor}`;
          return renderThreadEntry({
            authorName: replyAuthor,
            authorMetaHtml: replyAuthorMetaHtml,
            initials: replyInitials,
            timeLabel: replyTimeLabel,
            timeIso: replyIso,
            contentHtml: normalizeContent(r.content),
            messageBtn: replyMessageBtn,
            label: replyLabel,
            isAi: isReplyAi,
          });
        }).join('');
        const repliesBlock = repliesCount
          ? repliesHtml
          : '<p class="topic-empty topic-empty--thread">Aucune réponse pour le moment. Lancez la conversation !</p>';
        const threadHtml = `
          <div class="topic-thread">
            ${topicEntryHtml}
            ${repliesBlock}
          </div>
        `;
        const timeMeta = createdLabel ? `<time datetime="${createdIso}">${escapeHtml(createdLabel)}</time>` : '';
        const pillText = repliesCount ? `${repliesCount} ${repliesCount>1?'réponses':'réponse'}` : 'Nouvelle discussion';
        const pillClass = repliesCount ? 'topic-pill' : 'topic-pill topic-pill--empty';
        const deleteBtn = (activeId && String(t.user_id) === String(activeId)) ? `<div class="topic-manage"><button class="btn btn-danger" data-del-topic="${tid}">Supprimer le sujet</button></div>` : '';
        const bodyStyle = isOpen ? '' : ' style="display:none"';
        el.setAttribute('data-open', isOpen ? '1' : '0');
        el.innerHTML = `
          <header class="topic-header">
            <div class="topic-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
            <div class="topic-heading">
              <div class="topic-meta">
                <span class="topic-cat">${escapeHtml(cat)}</span>
                ${topicAuthorBlock}
                ${timeMeta}
              </div>
              <h3 class="topic-title">${escapeHtml(title)}</h3>
            </div>
            <div class="topic-actions">
              <span class="${pillClass}">${escapeHtml(pillText)}</span>
              ${topicMessageBtn}
              <button class="btn btn-secondary topic-toggle" data-toggle-comments="${tid}" aria-expanded="${isOpen?'true':'false'}" data-label-open="Réduire la publication" data-label-closed="Afficher les commentaires" data-count="${repliesCount}">${toggleLabel}${toggleCount}</button>
            </div>
          </header>
          <div class="topic-body" data-body="${tid}"${bodyStyle}>
            ${threadHtml}
            <form data-id="${tid}" class="form-reply form-grid">
              <label>Réponse<textarea name="content" rows="2" required></textarea></label>
              <div class="topic-form-actions">
                <button class="btn btn-secondary" type="submit">Répondre</button>
              </div>
            </form>
            ${deleteBtn}
          </div>
        `;
        if (!isListActive()) return;
        list.appendChild(el);
      });
      bindReplyForms(list);
    };
    // Actions déléguées : pliage/dépliage et suppression (avec garde d’occupation)
    if (!list.dataset.delBound) {
      list.addEventListener('click', async (e)=>{
        // Ouvrir/fermer le sujet
        const tgl = e.target.closest('[data-toggle-comments]');
        if (tgl) {
          e.preventDefault();
          const id = tgl.getAttribute('data-toggle-comments');
          const body = list.querySelector(`[data-body="${id}"]`);
          const openSet = (renderCommunity._open = renderCommunity._open || new Set());
          const isOpen = openSet.has(id);
          const labelOpen = tgl.getAttribute('data-label-open') || 'Réduire la publication';
          const labelClosed = tgl.getAttribute('data-label-closed') || 'Afficher les commentaires';
          const countAttr = tgl.getAttribute('data-count') || '';
          const suffix = countAttr && countAttr !== '0' ? ` (${countAttr})` : '';
          const topic = tgl.closest('.topic');
          if (body) {
            if (isOpen) {
              body.style.display = 'none';
              openSet.delete(id);
              tgl.setAttribute('aria-expanded', 'false');
              tgl.textContent = labelClosed + suffix;
              if (topic) topic.setAttribute('data-open', '0');
            } else {
              body.style.display = '';
              openSet.add(id);
              tgl.setAttribute('aria-expanded', 'true');
              tgl.textContent = labelOpen + suffix;
              if (topic) topic.setAttribute('data-open', '1');
            }
          }
          return;
        }
        // Supprimer le sujet
        const btn = e.target.closest('[data-del-topic]'); if (!btn) return;
        if (btn.dataset.busy === '1') return; btn.dataset.busy='1'; btn.disabled = true;
        const id = btn.getAttribute('data-del-topic');
        if (!confirm('Supprimer ce sujet ?')) { btn.dataset.busy='0'; btn.disabled=false; return; }
        if (useRemote()) {
          try {
            if (isAnonProfile()) {
              await anonCommunityRequest('delete-topic', { topicId: id });
              renderCommunity();
              return;
            }
            const uid = getActiveProfileId();
            if (!uid) { console.warn('Aucun user_id disponible pour forum_topics (delete)'); throw new Error('Pas de user_id'); }
            await supabase.from('forum_topics').delete().eq('id', id);
            renderCommunity();
            return;
          } catch {}
        }
        // Repli local
        const forum = store.get(K.forum);
        forum.topics = forum.topics.filter(t=>t.id!==id);
        store.set(K.forum, forum);
        renderCommunity();
      });
      list.dataset.delBound = '1';
    }
    if (useRemote()) {
      (async () => {
        try {
          if (isAnonProfile()) {
            const res = await withRetry(() => anonCommunityRequest('list', {}));
            const topics = Array.isArray(res.topics) ? res.topics : [];
            const repliesArr = Array.isArray(res.replies) ? res.replies : [];
            const authorsRaw = res.authors || {};
            const authorsMap = new Map();
            Object.entries(authorsRaw).forEach(([id, value]) => {
              const meta = normalizeAuthorMeta(value);
              const entry = meta || { name: (value == null ? '' : String(value)) || 'Utilisateur', childCount: null, showChildCount: false };
              authorsMap.set(String(id), entry);
            });
            const repliesMap = new Map();
            repliesArr.forEach((r) => {
              if (!r || !r.topic_id) return;
              const key = String(r.topic_id);
              const arr = repliesMap.get(key) || [];
              arr.push(r);
              repliesMap.set(key, arr);
            });
            renderTopics(topics, repliesMap, authorsMap);
            return;
          }
          const uid = getActiveProfileId();
          if (!uid) {
            console.warn('Aucun user_id disponible pour forum_topics/forum_replies/profiles (fetch)');
            const forum = store.get(K.forum, { topics: [] });
            const repliesMap = new Map();
            forum.topics.forEach((t) => repliesMap.set(t.id, t.replies || []));
            const authors = new Map();
            renderTopics(forum.topics.slice().reverse(), repliesMap, authors);
            return;
          }
          const loadTopics = async () => {
            const { data, error } = await supabase
              .from('forum_topics')
              .select('id,user_id,title,content,created_at')
              .order('created_at', { ascending: false });
            if (error) throw error;
            return Array.isArray(data) ? data : [];
          };
          const topics = await withRetry(() => loadTopics());
          const topicIds = topics.map((t) => t?.id).filter((id) => id != null);
          const loadMessages = async () => {
            if (!topicIds.length) return [];
            const { data, error } = await supabase
              .from('forum_replies')
              .select('id,topic_id,user_id,content,created_at')
              .in('topic_id', topicIds);
            if (error) throw error;
            return Array.isArray(data) ? data : [];
          };
          const replies = await withRetry(() => loadMessages());
          const userIds = new Set([
            ...topics.map((t) => t?.user_id).filter((id) => id != null),
            ...replies.map((r) => r?.user_id).filter((id) => id != null),
          ]);
          let authorsMap = new Map();
          if (userIds.size) {
            const loadCommunityProfiles = async () => {
              const idArray = Array.from(userIds)
                .map((value) => (value != null ? String(value) : ''))
                .filter(Boolean);
              if (!idArray.length) return new Map();
              const viewCandidates = ['community_profiles_meta', 'community_profiles_public', 'profiles_public_meta'];
              for (const viewName of viewCandidates) {
                if (!viewName) continue;
                try {
                  const { data: rows, error: viewError } = await supabase
                    .from(viewName)
                    .select('id,full_name,name,children_count,child_count,show_children_count,showChildCount,show_stats,showStats')
                    .in('id', idArray);
                  if (viewError) throw viewError;
                  if (Array.isArray(rows) && rows.length) {
                    return new Map(
                      rows
                        .map((row) => {
                          const id = row?.id != null ? String(row.id) : '';
                          if (!id) return null;
                          const entry = normalizeAuthorMeta({
                            name: row.full_name || row.name || 'Utilisateur',
                            child_count: row.children_count ?? row.child_count ?? row.childCount ?? null,
                            show_children_count:
                              row.show_children_count ?? row.showChildCount ?? row.show_stats ?? row.showStats,
                          }) || { name: row.full_name || row.name || 'Utilisateur', childCount: null, showChildCount: false };
                          return [id, entry];
                        })
                        .filter(Boolean)
                    );
                  }
                } catch (err) {
                  console.warn('community profiles view load failed', err);
                }
              }
              try {
                const { data: authData } = await supabase.auth.getSession();
                const token = authData?.session?.access_token || '';
                if (token) {
                  const response = await fetch('/api/profiles/by-ids', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ ids: idArray }),
                  });
                  if (response.ok) {
                    const payload = await response.json().catch(() => null);
                    if (payload?.profiles) {
                      const entries = payload.profiles
                        .map((profile) => {
                          const id = profile?.id != null ? String(profile.id) : '';
                          if (!id) return null;
                          const entry = normalizeAuthorMeta({
                            name: profile.full_name || profile.name || 'Utilisateur',
                            child_count: profile.child_count ?? profile.children_count ?? null,
                            show_children_count:
                              profile.show_children_count ?? profile.showChildCount ?? profile.show_stats ?? profile.showStats,
                          }) || { name: profile.full_name || 'Utilisateur', childCount: null, showChildCount: false };
                          return [id, entry];
                        })
                        .filter(Boolean);
                      if (entries.length) {
                        return new Map(entries);
                      }
                    }
                  }
                }
              } catch (err) {
                console.warn('community profiles API fallback failed', err);
              }
              const { data: profs, error: profsError } = await supabase
                .from('profiles')
                .select('id,full_name,show_children_count')
                .in('id', idArray);
              if (profsError) throw profsError;
              let childRows = [];
              try {
                const { data: rows, error: childrenError } = await supabase
                  .from('children')
                  .select('user_id')
                  .in('user_id', idArray);
                if (childrenError) throw childrenError;
                childRows = Array.isArray(rows) ? rows : [];
              } catch (err) {
                console.warn('community profiles children fetch failed', err);
                childRows = [];
              }
              const counts = new Map();
              childRows.forEach((row) => {
                const key = row?.user_id != null ? String(row.user_id) : '';
                if (!key) return;
                counts.set(key, (counts.get(key) || 0) + 1);
              });
              return new Map(
                (Array.isArray(profs) ? profs : [])
                  .map((profile) => {
                    const id = profile?.id != null ? String(profile.id) : '';
                    if (!id) return null;
                    const entry = normalizeAuthorMeta({
                      name: profile.full_name || 'Utilisateur',
                      child_count: counts.get(id) ?? null,
                      show_children_count: profile.show_children_count,
                    }) || { name: profile.full_name || 'Utilisateur', childCount: null, showChildCount: false };
                    return [id, entry];
                  })
                  .filter(Boolean)
              );
            };
            authorsMap = await withRetry(() => loadCommunityProfiles());
          }
          const repliesMap = new Map();
          replies.forEach((reply) => {
            const key = reply?.topic_id != null ? String(reply.topic_id) : '';
            if (!key) return;
            const arr = repliesMap.get(key) || [];
            arr.push(reply);
            repliesMap.set(key, arr);
          });
          renderTopics(topics, repliesMap, authorsMap);
        } catch (e) {
          console.error('renderCommunity load failed', e);
          showEmpty();
          showError('Impossible de charger la communauté. Vérifiez votre connexion ou réessayez plus tard.');
        }
      })();
    } else {
      const forum = store.get(K.forum, { topics: [] });
      const repliesMap = new Map();
      forum.topics.forEach(t=> repliesMap.set(t.id, t.replies||[]));
      const authors = new Map();
      renderTopics(forum.topics.slice().reverse(), repliesMap, authors);
    }

    const btnExport = $('#btn-export');
    if (btnExport) btnExport.onclick = () => {
      const data = {
        user: store.get(K.user),
        children: store.get(K.children, []),
        forum: store.get(K.forum, { topics: [] }),
        privacy: store.get(K.privacy, {}),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pedia_export.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const btnDelete = $('#btn-delete-account');
    if (btnDelete && !btnDelete.dataset.bound) {
      btnDelete.dataset.bound='1';
      btnDelete.onclick = () => {
        if (btnDelete.dataset.busy==='1') return; btnDelete.dataset.busy='1'; btnDelete.disabled=true;
        if (!confirm('Supprimer le compte et toutes les données locales ?')) { btnDelete.dataset.busy='0'; btnDelete.disabled=false; return; }
        localStorage.removeItem(K.user);
        localStorage.removeItem(K.children);
        localStorage.removeItem(K.forum);
        localStorage.removeItem(K.privacy);
        localStorage.removeItem(K.session);
        bootstrap();
        alert('Compte supprimé (localement).');
        location.hash = '#/';
      };
    }
    const inputImport = $('#input-import');
    const btnImport = $('#btn-import');
    if (btnImport && inputImport) {
      btnImport.onclick = () => inputImport.click();
      inputImport.addEventListener('change', async (e) => {
        const f = inputImport.files?.[0]; if (!f) return;
        try {
          const text = await f.text();
          const data = JSON.parse(text);
          if (!confirm('Importer ces données et écraser les actuelles ?')) return;
          if (data.user) localStorage.setItem(K.user, JSON.stringify(data.user));
          if (data.children) localStorage.setItem(K.children, JSON.stringify(data.children));
          if (data.forum) localStorage.setItem(K.forum, JSON.stringify(data.forum));
          if (data.privacy) localStorage.setItem(K.privacy, JSON.stringify(data.privacy));
          alert('Import terminé.');
          renderSettings();
        } catch (e) {
          alert('Fichier invalide.');
        } finally {
          inputImport.value = '';
        }
      });
    }
  }

  // Fonctions utilitaires
  function genId() { return Math.random().toString(36).slice(2, 10); }
  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }
  function ageInDays(dob) {
    if (!dob) return 0;
    const birth = new Date(dob);
    if (Number.isNaN(birth.getTime())) return 0;
    const now = new Date();
    const diff = now.getTime() - birth.getTime();
    return Math.max(0, Math.floor(diff / 86400000));
  }
  function ageInMonths(dob) {
    const d = new Date(dob);
    const now = new Date();
    return Math.max(0, (now.getFullYear()-d.getFullYear())*12 + (now.getMonth()-d.getMonth()));
  }
  function formatAge(dob) {
    const m = ageInMonths(dob);
    const y = Math.floor(m/12); const rm = m%12;
    return y ? `${y} an${y>1?'s':''} ${rm?`• ${rm} mois`:''}` : `${rm} mois`;
  }
  function labelFeedingType(v){
    const map = {
      '': '—',
      'allaitement_exclusif': 'Allaitement exclusif',
      'mixte_allaitement_biberon': 'Mixte',
      'allaitement_diversification': 'Diversification + allaitement',
      'biberon_diversification': 'Biberon + diversification',
      'lait_poudre_vache': 'Lait en poudre / vache'
    }; return map[v] || '—';
  }
  function labelEatingStyle(v){
    const map = {
      '': '—',
      'mange_tres_bien':'Mange très bien',
      'appetit_variable':'Appétit variable',
      'selectif_difficile':'Sélectif / difficile',
      'petites_portions':'Petites portions'
    }; return map[v] || '—';
  }
  function summarizeSleep(s){
    if (!s) return '—';
    const parts = [];
    if (s.falling) parts.push(`endormissement ${s.falling}`);
    if (typeof s.sleepsThrough === 'boolean') parts.push(s.sleepsThrough? 'nuits complètes' : 'réveils');
    if (s.nightWakings) parts.push(`${s.nightWakings} réveil(s)`);
    if (s.wakeDuration) parts.push(`${s.wakeDuration}`);
    return parts.join(' • ') || '—';
  }
  function escapeHtml(value){
    if (value == null) return '';
    const str = typeof value === 'string' ? value : String(value);
    return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  function build1000DaysTimeline(child, ageDays) {
    const safeName = escapeHtml(child?.firstName || 'votre enfant');
    const header = `
      <section class="card stack timeline-1000" id="timeline-1000-days">
        <div class="card-header timeline-1000__header">
          <h3>Frise des 1000 jours</h3>
          <p class="page-subtitle">Visualisez les grands jalons de la naissance jusqu’à 1000 jours.</p>
        </div>`;
    if (!child || !child.dob) {
      return `
        ${header}
        <p class="muted">Ajoutez la date de naissance de ${safeName} pour activer la frise personnalisée.</p>
      </section>`;
    }
    const milestonesArray = Array.isArray(child.milestones) ? child.milestones : [];
    const milestoneStatus = new Map();
    DEV_QUESTIONS.forEach((q, idx) => {
      if (q?.key) milestoneStatus.set(q.key, !!milestonesArray[idx]);
    });
    const rawAgeDays = Number.isFinite(ageDays) ? ageDays : ageInDays(child.dob);
    const clampedDays = clamp(rawAgeDays, 0, 1000);
    const progressPercent = clamp((clampedDays / 1000) * 100, 0, 100);
    const daysDisplay = rawAgeDays > 1000 ? '1000+ jours' : `${Math.round(Math.max(0, rawAgeDays))} jours`;
    const currentAlign = progressPercent <= 8 ? ' is-start' : (progressPercent >= 92 ? ' is-end' : '');

    const stageHtml = TIMELINE_STAGES.map((stage, idx) => {
      const stagePercent = clamp((stage.day / 1000) * 100, 0, 100);
      const alignClass = idx === 0 ? ' is-start' : (idx === TIMELINE_STAGES.length - 1 ? ' is-end' : '');
      const subtitle = stage.subtitle ? `<span>${escapeHtml(stage.subtitle)}</span>` : '';
      return `
        <div class="timeline-1000__stage${alignClass}" style="left:${stagePercent}%">
          <div class="timeline-1000__stage-label"><strong>${escapeHtml(stage.label)}</strong>${subtitle}</div>
          <span class="timeline-1000__tick" aria-hidden="true"></span>
        </div>
      `;
    }).join('');

    const pointsHtml = TIMELINE_MILESTONES.map((m) => {
      const percent = clamp((m.day / 1000) * 100, 0, 100);
      const isDone = milestoneStatus.get(m.key) === true;
      const state = isDone ? 'done' : 'upcoming';
      const stateClass = isDone ? 'is-done' : 'is-upcoming';
      const statusLabel = isDone ? 'Atteint' : 'À venir';
      const approxMonths = m.day ? Math.round(m.day / 30) : 0;
      const metaParts = [];
      if (m.day) metaParts.push(`${m.day} j`);
      if (approxMonths) metaParts.push(`≈ ${approxMonths} mois`);
      const metaText = metaParts.join(' • ');
      const predictionText = m.range ? `La plupart des enfants atteignent ce jalon entre ${m.range}.` : '';
      const ariaParts = [m.label, statusLabel, metaText].filter(Boolean).join(' • ');
      return `
        <button type="button" class="timeline-1000__point ${stateClass}" style="left:${percent}%"
          data-title="${escapeHtml(m.label)}"
          data-meta="${escapeHtml(metaText)}"
          data-pred="${escapeHtml(predictionText)}"
          data-status="${escapeHtml(statusLabel)}"
          data-state="${state}">
          <span aria-hidden="true"></span>
          <span class="sr-only">${escapeHtml(ariaParts || m.label)}</span>
        </button>
      `;
    }).join('');

    return `
      ${header}
        <div class="timeline-1000__scroll" role="region" aria-label="Frise des 1000 jours">
          <div class="timeline-1000__track">
            <span class="timeline-1000__line" aria-hidden="true"></span>
            <span class="timeline-1000__progress" style="width:${progressPercent}%" aria-hidden="true"></span>
            ${stageHtml}
            ${pointsHtml}
            <div class="timeline-1000__current${currentAlign}" style="left:${progressPercent}%">
              <span class="timeline-1000__current-dot" aria-hidden="true"></span>
              <span class="timeline-1000__current-label">${safeName} • ${daysDisplay}</span>
            </div>
            <div class="timeline-1000__tooltip" role="dialog" aria-live="polite" hidden></div>
          </div>
        </div>
        <div class="timeline-1000__nav-bar" role="note" aria-label="Astuce de défilement de la frise">
          <span class="timeline-1000__nav-hint" aria-hidden="true">
            <span class="timeline-1000__nav-hint-icon">⇆</span>
          </span>
        </div>
      </section>
    `;
  }

  function setupTimelineScroller(root) {
    if (!root) return;
    const scroller = root.querySelector('.timeline-1000__scroll');
    const track = scroller?.querySelector('.timeline-1000__track');
    const current = track?.querySelector('.timeline-1000__current');
    if (!scroller || !track || !current) return;
    requestAnimationFrame(() => {
      const target = current.offsetLeft + current.offsetWidth / 2;
      const desired = target - scroller.clientWidth / 2;
      const maxScroll = Math.max(0, track.scrollWidth - scroller.clientWidth);
      const nextLeft = clamp(desired, 0, maxScroll);
      try {
        scroller.scrollTo({ left: nextLeft, behavior: 'smooth' });
      } catch {
        scroller.scrollLeft = nextLeft;
      }
    });

    const tooltip = track.querySelector('.timeline-1000__tooltip');
    const points = Array.from(track.querySelectorAll('.timeline-1000__point'));
    if (!tooltip || !points.length) return;

    const navPrev = root.querySelector('.timeline-1000__nav--prev');
    const navNext = root.querySelector('.timeline-1000__nav--next');
    let updateNavState = null;

    if (navPrev || navNext) {
      const scrollByDelta = (delta) => {
        const target = scroller.scrollLeft + delta;
        const maxScroll = track.scrollWidth - scroller.clientWidth;
        const next = clamp(target, 0, Math.max(0, maxScroll));
        scroller.scrollTo({ left: next, behavior: 'smooth' });
      };

      const step = () => Math.max(200, Math.round(scroller.clientWidth * 0.6));

      navPrev?.addEventListener('click', () => scrollByDelta(-step()));
      navNext?.addEventListener('click', () => scrollByDelta(step()));

      updateNavState = () => {
        const maxScroll = track.scrollWidth - scroller.clientWidth;
        if (navPrev) navPrev.disabled = scroller.scrollLeft <= 8;
        if (navNext) navNext.disabled = scroller.scrollLeft >= maxScroll - 8;
      };

      updateNavState();
    }

    let activePoint = null;
    let hideTimer = null;

    const positionTooltip = () => {
      if (!activePoint || tooltip.hidden) return;
      const center = activePoint.offsetLeft + (activePoint.offsetWidth / 2);
      tooltip.style.left = `${center}px`;
      tooltip.style.setProperty('--timeline-tooltip-shift', '0px');
      tooltip.style.setProperty('--timeline-tooltip-shift-y', '0px');
      const tooltipRect = tooltip.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const containerRect = root.getBoundingClientRect();
      let shift = 0;
      const edgePad = 36;
      if (tooltipRect.left < scrollerRect.left + edgePad) {
        shift = (scrollerRect.left + edgePad) - tooltipRect.left;
      } else if (tooltipRect.right > scrollerRect.right - edgePad) {
        shift = (scrollerRect.right - edgePad) - tooltipRect.right;
      }
      tooltip.style.setProperty('--timeline-tooltip-shift', `${shift}px`);
      let shiftY = 0;
      const topPad = 16;
      if (tooltipRect.top < containerRect.top + topPad) {
        shiftY = (containerRect.top + topPad) - tooltipRect.top;
        tooltip.style.setProperty('--timeline-tooltip-shift-y', `${shiftY}px`);
      }
    };

    const showTooltip = (btn) => {
      if (!btn) return;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      activePoint = btn;
      const title = btn.dataset.title || '';
      const meta = btn.dataset.meta || '';
      const pred = btn.dataset.pred || '';
      const status = btn.dataset.status || '';
      const state = btn.dataset.state || 'upcoming';
      tooltip.dataset.state = state;
      const statusClass = state === 'done' ? 'is-done' : '';
      const metaHtml = meta ? `<p class="timeline-1000__tooltip-meta">${escapeHtml(meta)}</p>` : '';
      const predHtml = pred ? `<p class="timeline-1000__tooltip-pred">${escapeHtml(pred)}</p>` : '';
      tooltip.innerHTML = `
        <div class="timeline-1000__tooltip-header">
          <span class="timeline-1000__status ${statusClass}">${escapeHtml(status)}</span>
          <h4>${escapeHtml(title)}</h4>
        </div>
        ${metaHtml}
        ${predHtml}
      `;
      tooltip.hidden = false;
      positionTooltip();
      requestAnimationFrame(positionTooltip);
    };

    const scheduleHide = () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        tooltip.hidden = true;
        activePoint = null;
      }, 160);
    };

    const cancelHide = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    };

    points.forEach((btn) => {
      btn.addEventListener('mouseenter', () => showTooltip(btn));
      btn.addEventListener('focus', () => showTooltip(btn));
      btn.addEventListener('click', (evt) => {
        evt.preventDefault();
        showTooltip(btn);
      });
      btn.addEventListener('mouseleave', scheduleHide);
      btn.addEventListener('blur', scheduleHide);
    });

    tooltip.addEventListener('mouseenter', cancelHide);
    tooltip.addEventListener('mouseleave', scheduleHide);

    scroller.addEventListener('scroll', () => {
      if (typeof updateNavState === 'function') updateNavState();
      if (!tooltip.hidden) positionTooltip();
    }, { passive: true });

    scroller.addEventListener('mouseleave', scheduleHide);
  }

  function milestonesInputsHtml(values = []) {
    const groups = [
      { title: '0 – 12 mois', start: 0, end: 9 },
      { title: '12 – 24 mois', start: 10, end: 19 },
      { title: '24 – 36 mois', start: 20, end: 29 },
    ];
    return groups.map(g => {
      const items = [];
      for (let i = g.start; i <= g.end; i++) {
        const q = DEV_QUESTIONS[i];
        const id = `ms_edit_${i}`;
        const checked = values[i] ? 'checked' : '';
        items.push(`<div class="qitem"><input type="checkbox" id="${id}" name="milestones[]" data-index="${i}" ${checked}/><label for="${id}">${escapeHtml(q.label)}</label></div>`);
      }
      return `<section class="dev-group"><h4>${g.title}</h4><div class="qgrid">${items.join('')}</div></section>`;
    }).join('');
  }

  // --- Update history helpers ---
  function normalizeUpdateContentForLog(updateContent) {
    if (typeof updateContent === 'string') {
      const trimmed = updateContent.trim();
      return trimmed ? { summary: trimmed } : {};
    }
    if (!updateContent || typeof updateContent !== 'object') return {};
    let clone;
    try {
      clone = JSON.parse(JSON.stringify(updateContent));
    } catch {
      clone = { ...updateContent };
    }
    if (typeof clone.summary === 'string') {
      const trimmedSummary = clone.summary.trim();
      if (trimmedSummary) clone.summary = trimmedSummary;
      else delete clone.summary;
    }
    if (typeof clone.userComment === 'string') {
      const trimmedComment = clone.userComment.trim().slice(0, 600);
      if (trimmedComment) clone.userComment = trimmedComment;
      else delete clone.userComment;
    }
    return clone;
  }

  function makeUpdateSnapshot(childLike) {
    if (!childLike) return {};
    const measures = normalizeMeasures(Array.isArray(childLike?.growth?.measurements) ? childLike.growth.measurements : []);
    const latestHeight = [...measures].reverse().find((m) => Number.isFinite(m.height))?.height;
    const latestWeight = [...measures].reverse().find((m) => Number.isFinite(m.weight))?.weight;
    const lastTeethEntry = Array.isArray(childLike?.growth?.teeth)
      ? [...childLike.growth.teeth].sort((a, b) => Number(a?.month ?? 0) - Number(b?.month ?? 0)).slice(-1)[0]
      : null;
    const latestTeeth = lastTeethEntry != null
      ? Number(lastTeethEntry.count ?? lastTeethEntry.value ?? lastTeethEntry.teeth)
      : NaN;
    return {
      firstName: childLike.firstName || '',
      dob: childLike.dob || '',
      milestones: Array.isArray(childLike.milestones) ? childLike.milestones.slice() : [],
      context: {
        allergies: childLike.context?.allergies || '',
        history: childLike.context?.history || '',
        care: childLike.context?.care || '',
        languages: childLike.context?.languages || '',
        feedingType: childLike.context?.feedingType || '',
        eatingStyle: childLike.context?.eatingStyle || '',
        sleep: {
          falling: childLike.context?.sleep?.falling || '',
          sleepsThrough: typeof childLike.context?.sleep?.sleepsThrough === 'boolean' ? childLike.context.sleep.sleepsThrough : null,
          nightWakings: childLike.context?.sleep?.nightWakings || '',
          wakeDuration: childLike.context?.sleep?.wakeDuration || '',
          bedtime: childLike.context?.sleep?.bedtime || ''
        }
      },
      growth: {
        heightCm: Number.isFinite(latestHeight) ? Number(latestHeight) : null,
        weightKg: Number.isFinite(latestWeight) ? Number(latestWeight) : null,
        teethCount: Number.isFinite(latestTeeth) ? Math.max(0, Math.round(latestTeeth)) : null,
      }
    };
  }

  async function logChildUpdate(childId, updateType, updateContent) {
    if (!childId || !useRemote()) return;
    const remoteChildId = assertValidChildId(childId);
    const normalizedContent = normalizeUpdateContentForLog(updateContent);
    const content = JSON.stringify(normalizedContent);
    const childAccess = dataProxy.children();
    const shouldRefreshFamilyContext = hasFamilyModeContext();
    if (childAccess.isAnon) {
      await childAccess.callAnon('log-update', {
        childId: remoteChildId,
        updateType,
        updateContent: content
      });
      if (shouldRefreshFamilyContext) {
        scheduleFamilyContextRefresh();
      }
      return;
    }
    const supaClient = await childAccess.getClient();
    const historySummaries = await fetchChildUpdateSummaries(remoteChildId);
    const { summary: aiSummary, comment: aiCommentaire } = await generateAiSummaryAndComment(remoteChildId, updateType, normalizedContent, historySummaries);
    const payload = { child_id: remoteChildId, update_type: updateType, update_content: content };
    if (aiSummary) payload.ai_summary = aiSummary;
    if (aiCommentaire) payload.ai_commentaire = aiCommentaire;
    try {
      const { error } = await supaClient
        .from('child_updates')
        .insert([payload]);
      if (error) throw error;
    } catch (err) {
      console.error('Supabase child_updates insert failed', { error: err, payload });
      try {
        await logChildUpdateViaApi({
          childId: remoteChildId,
          updateType,
          updateContent: content,
          aiSummary,
          aiCommentaire,
        });
      } catch (fallbackErr) {
        console.error('Fallback child_updates API insert failed', fallbackErr);
        throw fallbackErr;
      }
    }
    invalidateGrowthStatus(remoteChildId);
    if (shouldRefreshFamilyContext) {
      scheduleFamilyContextRefresh();
    }
  }

  async function logChildUpdateViaApi({ childId, updateType, updateContent, aiSummary, aiCommentaire }) {
    const remoteChildId = assertValidChildId(childId);
    const body = {
      childId: remoteChildId,
      updateType,
      updateContent,
    };
    body.child_id = remoteChildId;
    if (aiSummary) body.aiSummary = aiSummary;
    if (aiCommentaire) body.aiCommentaire = aiCommentaire;
    let token = authSession?.access_token || '';
    if (!token && supabase?.auth) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token || '';
      } catch {}
    }
    if (!token) throw new Error('Missing access token for child update logging');
    const res = await fetch('/api/child-updates', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let details = '';
      try {
        const text = await res.text();
        if (text) {
          try {
            const parsed = JSON.parse(text);
            details = parsed?.details || parsed?.error || text;
          } catch {
            details = text;
          }
        }
      } catch {}
      throw new Error(details || `HTTP ${res.status}`);
    }
  }

  async function fetchChildUpdateSummaries(childId) {
    if (!childId) return [];
    try {
      const childAccess = dataProxy.children();
      if (childAccess.isAnon) return [];
      const remoteChildId = assertValidChildId(childId);
      const supaClient = await childAccess.getClient();
      const { data, error } = await supaClient
        .from('child_updates')
        .select('ai_summary')
        .eq('child_id', remoteChildId)
        .not('ai_summary', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return rows
        .map((row) => (typeof row?.ai_summary === 'string' ? row.ai_summary.trim() : ''))
        .filter(Boolean);
    } catch (err) {
      console.warn('Supabase child_updates summary fetch failed', err);
      return [];
    }
  }

  async function fetchChildFullReport(childId, { growthStatus: providedGrowthStatus = null } = {}) {
    if (!childId) throw new Error('Profil enfant introuvable.');
    if (!useRemote()) throw new Error('Connectez-vous pour générer un bilan complet.');
    const remoteChildId = assertValidChildId(childId);
    let growthStatusForPayload = providedGrowthStatus;
    if (!growthStatusForPayload) {
      try {
        growthStatusForPayload = await renderGrowthStatus(remoteChildId);
      } catch (err) {
        console.warn('fetchChildFullReport growth status fallback failed', err);
      }
    }
    try {
      const payload = { childId: remoteChildId, child_id: remoteChildId };
      if (growthStatusForPayload) {
        try {
          const statusEntries = growthStatusForPayload.toPromptPayload(10);
          if (statusEntries.length) {
            payload.growthStatus = statusEntries;
            const summaryText = growthStatusForPayload.describeLatestSummary();
            if (summaryText) payload.growthStatusSummary = summaryText;
          }
        } catch (err) {
          console.warn('Unable to attach growthStatus to child-full-report payload', err);
        }
      }
      const res = await fetch('/api/ai?type=child-full-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch {}
      }
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Pas assez de données pour générer un bilan complet.');
        }
        const errorText = data && typeof data === 'object'
          ? `${data.error || ''} ${data.details || ''}`.trim()
          : text;
        if (errorText) {
          console.warn('child-full-report failed', res.status, errorText);
        } else {
          console.warn('child-full-report failed', res.status);
        }
        throw new Error('Bilan indisponible pour le moment. Réessayez plus tard.');
      }
      const report = typeof data?.report === 'string' ? data.report.trim() : '';
      if (!report) {
        throw new Error('Pas assez de données pour générer un bilan complet.');
      }
      return report;
    } catch (err) {
      if (err instanceof Error) throw err;
      console.warn('child-full-report request error', err);
      throw new Error('Bilan indisponible pour le moment. Réessayez plus tard.');
    }
  }

  async function generateAiSummaryAndComment(childId, updateType, contentObj, historySummaries) {
    const remoteChildId = assertValidChildId(childId);
    try {
      const payload = {
        type: 'child-update',
        childId: remoteChildId,
        child_id: remoteChildId,
        updateType,
        update: contentObj,
        parentComment: typeof contentObj?.userComment === 'string' ? contentObj.userComment : '',
        historySummaries: Array.isArray(historySummaries) ? historySummaries.slice(0, 10) : [],
      };
      const contextParts = [];
      if (updateType === 'measure') {
        try {
          const growthStatus = await renderGrowthStatus(remoteChildId);
          const growthInputs = extractGrowthInputsFromUpdate(contentObj);
          if (growthStatus && growthInputs.hasMeasurements) {
            const matched = growthStatus.matchUpdate(null, growthInputs);
            if (matched) {
              const serialized = growthStatus.serializeEntry(matched);
              if (serialized) {
                contentObj.growthStatus = serialized;
                const growthSummary = summarizeGrowthStatus(serialized);
                if (growthSummary) {
                  contentObj.growthStatusSummary = growthSummary;
                  payload.growthStatus = growthStatus.toPromptPayload(5, matched);
                  payload.growthStatusSummary = growthSummary;
                  contextParts.push(growthSummary);
                }
              }
            }
          }
        } catch (err) {
          console.warn('generateAiSummaryAndComment growth status enrich failed', err);
        }
      }
      if (contextParts.length) {
        payload.contextParts = contextParts;
      }
      if (activeProfile?.id) {
        payload.profileId = String(activeProfile.id);
        payload.profile_id = String(activeProfile.id);
      }
      if (activeProfile?.code_unique) {
        payload.code_unique = String(activeProfile.code_unique).trim().toUpperCase();
      }
      payload.parentContext = buildParentContextForPrompt();
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return { summary: '', comment: '' };
      const j = await res.json();
      if (j?.status === 'unavailable') {
        showNotification({ title: 'IA indisponible', text: j.message || 'Fonction IA désactivée.' });
        return { summary: '', comment: '' };
      }
      return {
        summary: typeof j.summary === 'string' ? j.summary.trim().slice(0, 500) : '',
        comment: typeof j.comment === 'string' ? j.comment.trim().slice(0, 2000) : '',
      };
    } catch (err) {
      console.warn('generateAiSummaryAndComment failed', err);
      return { summary: '', comment: '' };
    }
  }

  async function getChildUpdates(childId) {
    if (!useRemote()) return [];
    try {
      const childAccess = dataProxy.children();
      if (childAccess.isAnon) {
        const res = await withRetry(() => childAccess.callAnon('list-updates', { childId }));
        return Array.isArray(res.updates) ? res.updates : [];
      }
      const supaClient = await childAccess.getClient();
      const { data, error } = await withRetry(() =>
        supaClient
          .from('child_updates')
          .select('*')
          .eq('child_id', childId)
          .order('created_at', { ascending: false })
      );
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('Supabase child_updates select failed', e);
      return [];
    }
  }

  function summarizeUpdate(prev, next) {
    try {
      const parts = [];
      if ((prev.firstName||'') !== (next.firstName||'')) parts.push(`Prénom: ${escapeHtml(prev.firstName||'—')} → ${escapeHtml(next.firstName||'—')}`);
      if ((prev.dob||'') !== (next.dob||'')) parts.push(`Naissance: ${prev.dob||'—'} → ${next.dob||'—'}`);
      if ((prev.context?.allergies||'') !== (next.context?.allergies||'')) parts.push(`Allergies: ${escapeHtml(prev.context?.allergies||'—')} → ${escapeHtml(next.context?.allergies||'—')}`);
      if ((prev.context?.history||'') !== (next.context?.history||'')) parts.push(`Antécédents: ${escapeHtml(prev.context?.history||'—')} → ${escapeHtml(next.context?.history||'—')}`);
      if ((prev.context?.care||'') !== (next.context?.care||'')) parts.push(`Mode de garde: ${escapeHtml(prev.context?.care||'—')} → ${escapeHtml(next.context?.care||'—')}`);
      if ((prev.context?.languages||'') !== (next.context?.languages||'')) parts.push(`Langues: ${escapeHtml(prev.context?.languages||'—')} → ${escapeHtml(next.context?.languages||'—')}`);
      if ((prev.context?.feedingType||'') !== (next.context?.feedingType||'')) parts.push(`Alimentation: ${labelFeedingType(prev.context?.feedingType||'')} → ${labelFeedingType(next.context?.feedingType||'')}`);
      if ((prev.context?.eatingStyle||'') !== (next.context?.eatingStyle||'')) parts.push(`Appétit: ${labelEatingStyle(prev.context?.eatingStyle||'')} → ${labelEatingStyle(next.context?.eatingStyle||'')}`);
      const prevGrowth = prev.growth || {};
      const nextGrowth = next.growth || {};
      const prevHeight = Number.isFinite(prevGrowth.heightCm) ? Number(prevGrowth.heightCm) : null;
      const nextHeight = Number.isFinite(nextGrowth.heightCm) ? Number(nextGrowth.heightCm) : null;
      const prevWeight = Number.isFinite(prevGrowth.weightKg) ? Number(prevGrowth.weightKg) : null;
      const nextWeight = Number.isFinite(nextGrowth.weightKg) ? Number(nextGrowth.weightKg) : null;
      const prevTeeth = Number.isFinite(prevGrowth.teethCount) ? Math.max(0, Math.round(prevGrowth.teethCount)) : null;
      const nextTeeth = Number.isFinite(nextGrowth.teethCount) ? Math.max(0, Math.round(nextGrowth.teethCount)) : null;
      const formatMeasure = (value, unit) => (value != null ? `${escapeHtml(String(value))}${unit ? ` ${unit}` : ''}` : '—');
      if (prevHeight !== nextHeight) parts.push(`Taille: ${formatMeasure(prevHeight, 'cm')} → ${formatMeasure(nextHeight, 'cm')}`);
      if (prevWeight !== nextWeight) parts.push(`Poids: ${formatMeasure(prevWeight, 'kg')} → ${formatMeasure(nextWeight, 'kg')}`);
      if (prevTeeth !== nextTeeth) parts.push(`Dents: ${formatMeasure(prevTeeth, 'dents')} → ${formatMeasure(nextTeeth, 'dents')}`);
      const pS = prev.context?.sleep || {}; const nS = next.context?.sleep || {};
      const sleepChanges = [];
      if ((pS.falling||'') !== (nS.falling||'')) sleepChanges.push(`endormissement ${pS.falling||'—'} → ${nS.falling||'—'}`);
      if (typeof pS.sleepsThrough === 'boolean' || typeof nS.sleepsThrough === 'boolean') {
        const a = typeof pS.sleepsThrough==='boolean' ? (pS.sleepsThrough?'oui':'non') : '—';
        const b = typeof nS.sleepsThrough==='boolean' ? (nS.sleepsThrough?'oui':'non') : '—';
        if (a !== b) sleepChanges.push(`nuits complètes ${a} → ${b}`);
      }
      if ((pS.nightWakings||'') !== (nS.nightWakings||'')) sleepChanges.push(`réveils ${pS.nightWakings||'—'} → ${nS.nightWakings||'—'}`);
      if ((pS.wakeDuration||'') !== (nS.wakeDuration||'')) sleepChanges.push(`éveils ${pS.wakeDuration||'—'} → ${nS.wakeDuration||'—'}`);
      if ((pS.bedtime||'') !== (nS.bedtime||'')) sleepChanges.push(`coucher ${pS.bedtime||'—'} → ${nS.bedtime||'—'}`);
      if (sleepChanges.length) parts.push(`Sommeil: ${sleepChanges.join(' • ')}`);
      const prevMs = Array.isArray(prev.milestones) ? prev.milestones : [];
      const nextMs = Array.isArray(next.milestones) ? next.milestones : [];
      const msChanges = [];
      for (let i = 0; i < DEV_QUESTIONS.length; i++) {
        const a = !!prevMs[i];
        const b = !!nextMs[i];
        if (a !== b) {
          const label = escapeHtml(DEV_QUESTIONS[i]?.label || '');
          msChanges.push(`${b ? '+' : '-'} ${label}`);
        }
      }
      if (msChanges.length) parts.push(`Jalons: ${msChanges.join(', ')}`);
      return parts.join(' ; ');
    } catch { return ''; }
  }

  // --- Shared child selection helpers (sync across pages) ---
  async function listChildrenSlim() {
    if (useRemote()) {
      try {
        const childAccess = dataProxy.children();
        if (childAccess.isAnon) {
          const res = await withRetry(() => childAccess.callAnon('list', {}));
          const rows = Array.isArray(res.children) ? res.children : [];
          return rows.map(r => ({ id: r.id, firstName: r.first_name, dob: r.dob, isPrimary: !!r.is_primary }));
        }
        const uid = getActiveProfileId();
        if (!uid) {
          console.warn('Aucun user_id disponible pour children (listChildrenSlim)');
          throw new Error('Pas de user_id');
        }
        const supaClient = await childAccess.getClient();
        const { data: rows } = await withRetry(() =>
          supaClient
            .from('children')
            .select('id,first_name,dob,is_primary')
            .eq('user_id', uid)
            .order('created_at', { ascending: true })
        );
        return (rows || []).map(r => ({ id: r.id, firstName: r.first_name, dob: r.dob, isPrimary: !!r.is_primary }));
      } catch { /* fallback local below */ }
    }
    const children = store.get(K.children, []);
    const user = store.get(K.user) || {};
    return children.map(c => ({ id: c.id, firstName: c.firstName, dob: c.dob, isPrimary: c.id === user.primaryChildId }));
  }

  async function setPrimaryChild(id) {
    if (!id) return;
    if (useRemote()) {
      try {
        const childAccess = dataProxy.children();
        const remoteChildId = assertValidChildId(id);
        if (childAccess.isAnon) {
          await childAccess.callAnon('set-primary', { childId: remoteChildId });
        } else {
          const uid = getActiveProfileId();
          if (!uid) { console.warn('Aucun user_id disponible pour children (setPrimaryChild)'); throw new Error('Pas de user_id'); }
          const supaClient = await childAccess.getClient();
          await supaClient.from('children').update({ is_primary: false }).eq('user_id', uid);
          await supaClient.from('children').update({ is_primary: true }).eq('id', remoteChildId);
        }
      } catch {}
      invalidateSettingsRemoteCache();
      return;
    }
    const user = store.get(K.user) || {};
    store.set(K.user, { ...user, primaryChildId: id });
    invalidateSettingsRemoteCache();
  }

  function renderChildSwitcher(container, items, selectedId, onChange) {
    if (!container) return;
    let box = container.querySelector('#child-switcher-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'child-switcher-box';
      box.className = 'stack';
      // Insérer juste après l’en-tête de page si présent (les titres restent avant le sélecteur)
      const header = container.querySelector('.page-header') || container.firstElementChild;
      if (header && header.nextSibling) {
        header.parentNode.insertBefore(box, header.nextSibling);
      } else if (header) {
        header.parentNode.appendChild(box);
      } else {
        container.insertBefore(box, container.firstChild);
      }
    }
    const options = items.map(c => `<option value="${c.id}" ${c.id===selectedId?'selected':''}>${escapeHtml(c.firstName)}${c.dob?` • ${formatAge(c.dob)}`:''}</option>`).join('');
    box.innerHTML = `
      <label>Enfant
        <select id="child-switcher">${options}</select>
      </label>
      <a class="btn btn-primary" href="#/onboarding">Ajouter</a>
    `;
    const sel = box.querySelector('#child-switcher');
    if (sel && !sel.dataset.bound) {
      sel.addEventListener('change', async (e) => {
        const id = e.currentTarget.value;
        await setPrimaryChild(id);
        if (typeof onChange === 'function') onChange(id);
      });
      sel.dataset.bound = '1';
    }
  }

  // Générateur de conseils (simulation d’IA)
  function renderAdvice(ageM){
    const sleep = sleepRecommendation(ageM);
    const tips = [];
    tips.push(`<div>🛏️ Sommeil recommandé: <strong>${sleep.min}–${sleep.max}h</strong> / 24h</div>`);
    if (ageM < 6) tips.push('<div>🍼 Alimentation: lait maternel ou infantile à la demande.</div>');
    else if (ageM < 12) tips.push('<div>🥣 Diversification progressive, textures adaptées, surveiller les allergies.</div>');
    else if (ageM < 36) tips.push('<div>🍽️ 3 repas + 2 collations, proposer fruits/légumes variés.</div>');
    else tips.push('<div>🍽️ Favoriser équilibre: légumes, protéines, féculents, limiter sucres.</div>');

    if (ageM < 18) tips.push('<div>🧩 Dépistage: contact visuel, babillage, interactions sociales.</div>');
    else if (ageM < 36) tips.push('<div>🧩 Dépistage: vocabulaire, compréhension consignes simples, motricité.</div>');
    else tips.push('<div>🧩 Dépistage: langage clair, autonomie habillage, motricité fine.</div>');

    tips.push('<div class="muted">Ces conseils sont indicatifs et ne remplacent pas un avis médical.</div>');
    return tips.map(t=>`<div>${t}</div>`).join('');
  }

  function sleepRecommendation(ageM){
    if (ageM<=3) return {min:14,max:17};
    if (ageM<=11) return {min:12,max:15};
    if (ageM<=24) return {min:11,max:14};
    if (ageM<=60) return {min:10,max:13};
    return {min:9,max:12};
  }
  function sleepRecommendedSeries(){
    const arr=[]; for(let m=0;m<=60;m+=3){const r=sleepRecommendation(m);arr.push({x:m,y:(r.min+r.max)/2});} return arr;
  }

  // Rendu des courbes OMS en SVG (sans dépendance externe)
  function renderWhoChart(id, childData, curve = {}, unit){
    const svg = document.getElementById(id);
    if (!svg) return;
    const buildCurve = (key, color, dash='', width=1) => ({
      color,
      dash,
      width,
      data: Array.from({length:61}, (_,m)=>({x:m, y: curve?.[m]?.[key]}))
                .filter(p=>Number.isFinite(p.y))
    });
    const childSeries = {
      color: 'var(--turquoise)',
      data: childData.map(p=>({x:p.month, y:p.value})),
      isChild: true,
      width: 2
    };
    const series = [
      buildCurve('P3', 'var(--border)', '4 2', 1),
      buildCurve('P15', 'var(--violet)', '', 1),
      buildCurve('P50', 'var(--violet-strong)', '', 1.5),
      buildCurve('P85', 'var(--violet)', '', 1),
      buildCurve('P97', 'var(--border)', '4 2', 1),
      childSeries
    ];
    drawMulti(svg, series);
    const latest = childData[childData.length - 1];
    const note = document.createElement('div'); note.className = 'chart-note';
    const val = latest ? latest.value.toFixed(1) : '—';
    const unitTxt = unit ? ` ${unit}` : '';
    note.textContent = `Courbes OMS (P3 à P97). La zone entre P3 et P97 correspond à la normale. Dernière valeur enregistrée : ${val}${unitTxt}.`;
    svg.parentElement.appendChild(note);
  }

  // Utilitaires de graphiques SVG (léger)
  // Helper pour construire une série unique de données enfant pour les graphiques génériques.
  // L’option `isChild` garantit que les points (dont le dernier marqué) sont rendus comme sur les courbes OMS.
  function buildSeries(list){
    return [{
      color: 'var(--turquoise)',
      data: list.filter(p => Number.isFinite(p.y)),
      isChild: true
    }];
  }
  function drawChart(svg, seriesA, seriesB){ drawMulti(svg, [...(seriesA||[]), ...(seriesB?[{color:'var(--violet)', data:seriesB[0].data}]:[])]); }

  function drawMulti(svg, series){
    if (!svg) return;
    const W = svg.clientWidth || 600; const H = svg.clientHeight || 240;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML='';
    // Calculer les bornes des axes
    const allPoints = series.flatMap(s=>s.data);
    const xs = allPoints.map(p=>p.x);
    const ys = allPoints.map(p=>p.y);
    const minX = Math.min(0, ...xs, 0), maxX = Math.max(60, ...xs, 60);
    const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 10);
    const pad = 28; const left=36, right=12, top=12, bottom=24;
    const innerW = W-left-right, innerH = H-top-bottom;
    const xScale = x => left + (x-minX)/(maxX-minX||1)*innerW;
    const yScale = y => top + (1-(y-minY)/(maxY-minY||1))*innerH;

    // Grille + graduations Y
    const grid = document.createElementNS('http://www.w3.org/2000/svg','g');
    grid.setAttribute('stroke', '#1f2447');
    grid.setAttribute('stroke-width', '1');
    grid.setAttribute('opacity', '0.4');
    grid.setAttribute('stroke-dasharray', '2,4');
    const stepY = (maxY - minY) / 6;
    for(let i=0;i<=6;i++){
      const y = top + i*(innerH/6);
      const l = line(left,y, left+innerW, y);
      grid.appendChild(l);
      // Étiquettes de l’axe Y
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x', left - 4);
      t.setAttribute('y', y);
      t.setAttribute('text-anchor','end');
      t.setAttribute('dominant-baseline','middle');
      t.setAttribute('font-size','10');
      t.setAttribute('fill','#aab0c0');
      const val = maxY - stepY * i;
      t.textContent = stepY < 1 ? val.toFixed(1) : Math.round(val);
      svg.appendChild(t);
    }
    svg.appendChild(grid);
    // Axes
    svg.appendChild(line(left, top, left, top+innerH, 'var(--border)'));
    svg.appendChild(line(left, top+innerH, left+innerW, top+innerH, 'var(--border)'));

    // Tracé des séries
    series.forEach((s) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      const pts = s.data.sort((a,b)=>a.x-b.x);
      if (!pts.length) return;
      const d = pts.map((p,i)=>`${i?'L':'M'}${xScale(p.x)},${yScale(p.y)}`).join(' ');
      path.setAttribute('d', d);
      path.setAttribute('fill','none');
      const strokeColor = getComputedStyle(document.documentElement).getPropertyValue(s.color?.match(/^var/)? s.color.slice(4,-1):'') || s.color || '#0ff';
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', s.width || (s.isChild ? '2' : '1'));
      if (s.dash) path.setAttribute('stroke-dasharray', s.dash);
      if (!s.isChild) path.setAttribute('opacity','0.8');
      path.setAttribute('stroke-linecap','round');
      path.setAttribute('stroke-linejoin','round');
      svg.appendChild(path);
      // Points uniquement pour la série enfant
      if (s.isChild) {
        pts.forEach((p,i)=>{
          const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
          const isLatest = i === pts.length - 1;
          c.setAttribute('cx', xScale(p.x));
          c.setAttribute('cy', yScale(p.y));
          c.setAttribute('r', isLatest ? '5' : '3');
          c.setAttribute('fill', s.color || 'cyan');
          c.setAttribute('stroke', '#fff');
          c.setAttribute('stroke-width', '1');
          c.classList.add('child-point');
          if (isLatest) c.classList.add('child-point-latest');
          svg.appendChild(c);
        });
      }
    });

    // Graduations intermédiaires sur l’axe X (tous les 12 mois)
    for (let m=12;m<=60;m+=12){
      const x = xScale(m);
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x', x);
      t.setAttribute('y', top+innerH+16);
      t.setAttribute('text-anchor','middle');
      t.setAttribute('font-size','10');
      t.setAttribute('fill','#aab0c0');
      t.textContent = `${Math.round(m/12)}a`;
      svg.appendChild(t);
    }
  }

  function line(x1,y1,x2,y2,stroke='#263169'){
    const l = document.createElementNS('http://www.w3.org/2000/svg','line');
    l.setAttribute('x1',x1); l.setAttribute('y1',y1); l.setAttribute('x2',x2); l.setAttribute('y2',y2);
    l.setAttribute('stroke',stroke); return l;
  }

  function parseFiniteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function formatMeasurement(value, unit, decimals = 1) {
    if (!Number.isFinite(value)) return '';
    const safeDecimals = Math.max(0, Math.min(3, Number(decimals) || 0));
    const formatted = value.toLocaleString('fr-FR', {
      minimumFractionDigits: safeDecimals,
      maximumFractionDigits: safeDecimals,
    });
    return `${formatted} ${unit}`.trim();
  }

  function formatPercentDiff(value) {
    if (!Number.isFinite(value)) return '';
    const formatted = Math.abs(value).toLocaleString('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${sign}${formatted} %`;
  }

  function cleanStatusText(status) {
    if (!status) return '';
    const str = String(status).trim();
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function statusIsAlert(status) {
    if (!status) return false;
    const normalized = String(status).toLowerCase();
    if (normalized.includes('normal')) return false;
    if (normalized.includes('ok')) return false;
    if (normalized.includes('dans la norme')) return false;
    return true;
  }

  function showButtonLoading(button, spinner) {
    if (spinner) spinner.hidden = false;
    if (button) {
      button.disabled = true;
      button.hidden = true;
    }
  }

  function resolveButtonLoading(button, spinner, { failed = false, defaultLabel = '', failureLabel = 'Réessayer' } = {}) {
    if (spinner) spinner.hidden = true;
    if (button) {
      button.hidden = false;
      button.disabled = false;
      if (failed) {
        if (failureLabel) button.textContent = failureLabel;
      } else if (defaultLabel) {
        button.textContent = defaultLabel;
      }
    }
  }

  function createLoadingSpinnerNode({ className = '', hidden = true } = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = ['loading-spinner', className].filter(Boolean).join(' ');
    if (hidden) wrapper.hidden = true;
    wrapper.setAttribute('aria-hidden', 'true');
    const core = document.createElement('div');
    core.className = 'loading-spinner-core';
    wrapper.appendChild(core);
    return wrapper;
  }

  function buildGrowthCompositeKey(month, height, weight) {
    const parts = [];
    parts.push(Number.isFinite(month) ? String(Math.round(month)) : 'x');
    parts.push(Number.isFinite(height) ? height.toFixed(1) : 'x');
    parts.push(Number.isFinite(weight) ? weight.toFixed(2) : 'x');
    return parts.join(':');
  }

  function normalizeDateInput(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  function renderGrowthLine(label, valueText, rangeText, statusText, diffText) {
    const chunks = [];
    if (valueText) chunks.push(`<span class="timeline-growth-status__value">${escapeHtml(valueText)}</span>`);
    if (rangeText) chunks.push(`<span class="timeline-growth-status__range">${escapeHtml(rangeText)}</span>`);
    if (statusText) chunks.push(`<span class="timeline-growth-status__status">${escapeHtml(cleanStatusText(statusText))}</span>`);
    if (diffText) chunks.push(`<span class="timeline-growth-status__diff">${escapeHtml(diffText)}</span>`);
    if (!chunks.length) return '';
    const alertClass = statusIsAlert(statusText) ? ' is-alert' : ' is-ok';
    return `
      <div class="timeline-growth-status__item${alertClass}">
        <span class="timeline-growth-status__label">${escapeHtml(label)}</span>
        ${chunks.join('')}
      </div>
    `;
  }

  function normalizeGrowthStatusRow(row, childId) {
    if (!row || typeof row !== 'object') return null;
    const entry = {
      childId,
      updateId: row.child_update_id ?? row.update_id ?? row.updateId ?? null,
      measurementId: row.measurement_id ?? row.measurementId ?? null,
      month: parseFiniteNumber(row.agemos ?? row.age_month ?? row.age_months ?? row.month),
      height: parseFiniteNumber(row.height_cm ?? row.height),
      weight: parseFiniteNumber(row.weight_kg ?? row.weight),
      heightRange: {
        p3: parseFiniteNumber(row.height_p3 ?? row.p3_height ?? row.height_p03),
        p97: parseFiniteNumber(row.height_p97 ?? row.p97_height ?? row.height_p97_cm),
        median: parseFiniteNumber(row.height_median ?? row.height_p50 ?? row.median_height),
      },
      weightRange: {
        p3: parseFiniteNumber(row.weight_p3 ?? row.p3_weight ?? row.weight_p03),
        p97: parseFiniteNumber(row.weight_p97 ?? row.p97_weight ?? row.weight_p97_kg),
        median: parseFiniteNumber(row.weight_median ?? row.weight_p50 ?? row.median_weight),
      },
      heightDiffPct: parseFiniteNumber(row.height_diff_pct ?? row.diff_height_pct ?? row.height_diff_percent),
      weightDiffPct: parseFiniteNumber(row.weight_diff_pct ?? row.diff_weight_pct ?? row.weight_diff_percent),
      statusHeight: cleanStatusText(row.status_height ?? row.height_status ?? row.statusHeight ?? ''),
      statusWeight: cleanStatusText(row.status_weight ?? row.weight_status ?? row.statusWeight ?? ''),
      statusGlobal: cleanStatusText(row.status_global ?? row.statusGlobal ?? ''),
      measuredAt: normalizeDateInput(row.measured_at ?? row.recorded_at ?? row.created_at ?? row.updated_at ?? row.measuredAt),
      raw: row,
    };
    entry.sortIndex = entry.measuredAt ? new Date(entry.measuredAt).getTime() : 0;
    entry.comboKey = buildGrowthCompositeKey(entry.month, entry.height, entry.weight);
    return entry;
  }

  function createGrowthStatusHelper(childId, rows) {
    const normalized = Array.isArray(rows)
      ? rows.map((row) => normalizeGrowthStatusRow(row, childId)).filter(Boolean)
      : [];
    normalized.sort((a, b) => (b.sortIndex - a.sortIndex));
    const map = new Map();
    const unique = [];
    const seen = new Set();
    normalized.forEach((entry) => {
      const signature = [entry.measuredAt || '', entry.comboKey || '', entry.updateId ?? '', entry.measurementId ?? ''].join('|');
      if (seen.has(signature)) return;
      seen.add(signature);
      unique.push(entry);
      if (entry.updateId != null) map.set(`update:${entry.updateId}`, entry);
      if (entry.measurementId != null) map.set(`measurement:${entry.measurementId}`, entry);
      if (entry.comboKey) map.set(`combo:${entry.comboKey}`, entry);
      if (entry.measuredAt) map.set(`date:${entry.measuredAt}`, entry);
    });
    const helper = {
      childId,
      entries: unique,
      matchUpdate(updateRow, growthInputs = {}) {
        const keys = [];
        if (updateRow && typeof updateRow === 'object') {
          const updateId = updateRow.id ?? updateRow.update_id ?? updateRow.child_update_id;
          if (updateId != null) keys.push(`update:${updateId}`);
        }
        if (growthInputs && typeof growthInputs === 'object') {
          const measurementId = growthInputs.measurementId ?? growthInputs.measurement_id;
          if (measurementId != null) keys.push(`measurement:${measurementId}`);
          const month = Number.isFinite(growthInputs.month) ? Number(growthInputs.month) : null;
          const height = Number.isFinite(growthInputs.height) ? Number(growthInputs.height) : null;
          const weight = Number.isFinite(growthInputs.weight) ? Number(growthInputs.weight) : null;
          if (month != null && (height != null || weight != null)) {
            keys.push(`combo:${buildGrowthCompositeKey(month, height, weight)}`);
          }
          if (growthInputs.measuredAt) {
            const iso = normalizeDateInput(growthInputs.measuredAt);
            if (iso) keys.push(`date:${iso}`);
          }
        }
        for (const key of keys) {
          if (!key) continue;
          const entry = map.get(key);
          if (entry) return entry;
        }
        return unique[0] || null;
      },
      renderHtml(entry) {
        if (!entry) return '';
        const lines = [];
        if (Number.isFinite(entry.height)) {
          const range = entry.heightRange.p3 != null && entry.heightRange.p97 != null
            ? `OMS P3–P97 : ${formatMeasurement(entry.heightRange.p3, 'cm')} – ${formatMeasurement(entry.heightRange.p97, 'cm')}`
            : '';
          const diff = formatPercentDiff(entry.heightDiffPct);
          lines.push(renderGrowthLine('Taille', formatMeasurement(entry.height, 'cm'), range, entry.statusHeight, diff));
        }
        if (Number.isFinite(entry.weight)) {
          const range = entry.weightRange.p3 != null && entry.weightRange.p97 != null
            ? `OMS P3–P97 : ${formatMeasurement(entry.weightRange.p3, 'kg', 2)} – ${formatMeasurement(entry.weightRange.p97, 'kg', 2)}`
            : '';
          const diff = formatPercentDiff(entry.weightDiffPct);
          lines.push(renderGrowthLine('Poids', formatMeasurement(entry.weight, 'kg', 2), range, entry.statusWeight, diff));
        }
        const metaParts = [];
        if (Number.isFinite(entry.month)) {
          metaParts.push(`Âge: ${Number(entry.month).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} mois`);
        }
        if (entry.measuredAt) {
          const d = new Date(entry.measuredAt);
          if (!Number.isNaN(d.getTime())) {
            metaParts.push(`Mesure du ${d.toLocaleDateString('fr-FR', { dateStyle: 'medium' })}`);
          }
        }
        const metaHtml = metaParts.length
          ? `<div class="timeline-growth-status__meta">${metaParts.map((part) => escapeHtml(part)).join(' • ')}</div>`
          : '';
        const globalHtml = entry.statusGlobal
          ? `<div class="timeline-growth-status__global${statusIsAlert(entry.statusGlobal) ? ' is-alert' : ' is-ok'}">${escapeHtml(cleanStatusText(entry.statusGlobal))}</div>`
          : '';
        if (!lines.length && !globalHtml && !metaHtml) return '';
        return `<div class="timeline-growth-status">${metaHtml}${lines.join('')}${globalHtml}</div>`;
      },
      describeEntry(entry, { short = false } = {}) {
        if (!entry) return '';
        const parts = [];
        const globalText = cleanStatusText(entry.statusGlobal);
        if (short && globalText) parts.push(globalText);
        if (Number.isFinite(entry.height)) {
          const components = [];
          if (entry.statusHeight) components.push(cleanStatusText(entry.statusHeight));
          const diff = formatPercentDiff(entry.heightDiffPct);
          if (diff) components.push(`écart ${diff}`);
          if (!short && entry.heightRange.p3 != null && entry.heightRange.p97 != null) {
            components.push(`attendu ${formatMeasurement(entry.heightRange.p3, 'cm')} – ${formatMeasurement(entry.heightRange.p97, 'cm')}`);
          }
          const valueText = formatMeasurement(entry.height, 'cm');
          const summary = components.length ? `${valueText} (${components.join(', ')})` : valueText;
          if (summary) parts.push(`Taille ${summary}`.trim());
        }
        if (Number.isFinite(entry.weight)) {
          const components = [];
          if (entry.statusWeight) components.push(cleanStatusText(entry.statusWeight));
          const diff = formatPercentDiff(entry.weightDiffPct);
          if (diff) components.push(`écart ${diff}`);
          if (!short && entry.weightRange.p3 != null && entry.weightRange.p97 != null) {
            components.push(`attendu ${formatMeasurement(entry.weightRange.p3, 'kg', 2)} – ${formatMeasurement(entry.weightRange.p97, 'kg', 2)}`);
          }
          const valueText = formatMeasurement(entry.weight, 'kg', 2);
          const summary = components.length ? `${valueText} (${components.join(', ')})` : valueText;
          if (summary) parts.push(`Poids ${summary}`.trim());
        }
        if (!short && globalText) parts.push(globalText);
        if (!parts.length && globalText) return globalText;
        return parts.join(short ? ' / ' : ' • ');
      },
      serializeEntry(entry) {
        if (!entry) return null;
        return {
          month: Number.isFinite(entry.month) ? entry.month : null,
          measured_at: entry.measuredAt || null,
          height_cm: Number.isFinite(entry.height) ? entry.height : null,
          weight_kg: Number.isFinite(entry.weight) ? entry.weight : null,
          status_height: entry.statusHeight || null,
          status_weight: entry.statusWeight || null,
          status_global: entry.statusGlobal || null,
          height_diff_pct: Number.isFinite(entry.heightDiffPct) ? entry.heightDiffPct : null,
          weight_diff_pct: Number.isFinite(entry.weightDiffPct) ? entry.weightDiffPct : null,
          height_p3: Number.isFinite(entry.heightRange.p3) ? entry.heightRange.p3 : null,
          height_p97: Number.isFinite(entry.heightRange.p97) ? entry.heightRange.p97 : null,
          height_median: Number.isFinite(entry.heightRange.median) ? entry.heightRange.median : null,
          weight_p3: Number.isFinite(entry.weightRange.p3) ? entry.weightRange.p3 : null,
          weight_p97: Number.isFinite(entry.weightRange.p97) ? entry.weightRange.p97 : null,
          weight_median: Number.isFinite(entry.weightRange.median) ? entry.weightRange.median : null,
        };
      },
      toPromptPayload(limit = 5, primaryEntry = null) {
        const items = [];
        if (primaryEntry) items.push(primaryEntry);
        for (const entry of unique) {
          if (!items.includes(entry)) items.push(entry);
        }
        return items.slice(0, Math.max(1, limit)).map((entry) => helper.serializeEntry(entry)).filter(Boolean);
      },
      getAnomalies(limit = 5) {
        return unique
          .filter((entry) => statusIsAlert(entry.statusGlobal) || statusIsAlert(entry.statusHeight) || statusIsAlert(entry.statusWeight))
          .slice(0, Math.max(1, limit));
      },
      describeLatestSummary() {
        const first = unique[0];
        if (!first) return '';
        return helper.describeEntry(first, { short: false }) || '';
      },
    };
    return helper;
  }

  async function fetchGrowthStatusRows(childId) {
    const unavailableNotice = {
      status: 'unavailable',
      message: 'Impossible de récupérer les repères OMS pour le moment. Réessayez plus tard ou contactez le support.'
    };
    if (!useRemote() || !childId) return { rows: [], notice: null };
    const childAccess = dataProxy.children();
    if (childAccess.isAnon) {
      try {
        const res = await withRetry(() => childAccess.callAnon('growth-status', { childId, limit: 20 }));
        const rows = Array.isArray(res?.rows) ? res.rows : [];
        const notice = res?.notice && typeof res.notice === 'object' ? res.notice : null;
        return { rows, notice };
      } catch (err) {
        console.warn('anon growth-status fetch failed', err);
        return { rows: [], notice: unavailableNotice };
      }
    }
    if (!supabase) return { rows: [], notice: null };
    const remoteChildId = assertValidChildId(childId);
    const supaClient = await childAccess.getClient();
    try {
      const { data, error } = await withRetry(() =>
        supaClient
          .from('child_growth_with_status')
          .select('agemos,height_cm,weight_kg,status_weight,status_height,status_global')
          .eq('child_id', remoteChildId)
          .order('agemos', { ascending: false, nullsFirst: false })
          .limit(1)
      );
      if (error) {
        console.error('Erreur fetch child_growth_with_status', error);
        return { rows: [], notice: unavailableNotice };
      }
      const rows = Array.isArray(data) ? data : [];
      return { rows, notice: null };
    } catch (err) {
      console.error('Erreur fetch child_growth_with_status', err);
      return { rows: [], notice: unavailableNotice };
    }
  }

  function invalidateGrowthStatus(childId) {
    const key = childId != null ? String(childId) : '';
    if (!key) return;
    growthStatusState.cache.delete(key);
    growthStatusState.pending.delete(key);
  }

  async function renderGrowthStatus(childId) {
    const key = childId != null ? String(childId) : '';
    if (!key || !useRemote()) {
      return createGrowthStatusHelper(key, []);
    }
    if (growthStatusState.cache.has(key)) {
      return growthStatusState.cache.get(key);
    }
    if (growthStatusState.pending.has(key)) {
      return growthStatusState.pending.get(key);
    }
    const promise = (async () => {
      try {
        const { rows, notice } = await fetchGrowthStatusRows(childId);
        const helper = createGrowthStatusHelper(key, rows);
        if (notice) helper.notice = notice;
        growthStatusState.cache.set(key, helper);
        return helper;
      } catch (err) {
        console.warn('renderGrowthStatus error', err);
        const helper = createGrowthStatusHelper(key, []);
        helper.notice = {
          status: 'unavailable',
          message: 'Impossible de récupérer les repères OMS pour le moment.'
        };
        growthStatusState.cache.set(key, helper);
        return helper;
      } finally {
        growthStatusState.pending.delete(key);
      }
    })();
    growthStatusState.pending.set(key, promise);
    return promise;
  }

  function extractGrowthInputsFromUpdate(parsed) {
    const result = {
      month: null,
      height: null,
      weight: null,
      measurementId: null,
      measuredAt: null,
      hasMeasurements: false,
    };
    if (!parsed || typeof parsed !== 'object') return result;
    const sources = [parsed];
    if (parsed.growthInputs && typeof parsed.growthInputs === 'object') sources.push(parsed.growthInputs);
    if (parsed.growth && typeof parsed.growth === 'object') sources.push(parsed.growth);
    if (parsed.next && typeof parsed.next === 'object') {
      if (parsed.next.growth && typeof parsed.next.growth === 'object') sources.push(parsed.next.growth);
    }
    if (parsed.snapshot && typeof parsed.snapshot === 'object') {
      if (parsed.snapshot.growth && typeof parsed.snapshot.growth === 'object') sources.push(parsed.snapshot.growth);
    }
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;
      if (result.measurementId == null && source.measurementId != null) result.measurementId = source.measurementId;
      if (result.measurementId == null && source.measurement_id != null) result.measurementId = source.measurement_id;
      if (!Number.isFinite(result.month) && Number.isFinite(Number(source.month))) result.month = Number(source.month);
      if (!Number.isFinite(result.height) && Number.isFinite(Number(source.height ?? source.heightCm ?? source.height_cm))) {
        result.height = Number(source.height ?? source.heightCm ?? source.height_cm);
      }
      if (!Number.isFinite(result.weight) && Number.isFinite(Number(source.weight ?? source.weightKg ?? source.weight_kg))) {
        result.weight = Number(source.weight ?? source.weightKg ?? source.weight_kg);
      }
      if (!result.measuredAt && source.measuredAt) result.measuredAt = source.measuredAt;
      if (!result.measuredAt && source.measured_at) result.measuredAt = source.measured_at;
    }
    result.hasMeasurements = Number.isFinite(result.height) || Number.isFinite(result.weight);
    return result;
  }

  function updateReportHighlights(container, growthStatus) {
    if (!container) return;
    if (growthStatus?.notice?.message) {
      container.innerHTML = `<div class="empty-state muted">${escapeHtml(growthStatus.notice.message)}</div>`;
      return;
    }
    const helper = growthStatus || createGrowthStatusHelper('', []);
    const latestEntry = helper.entries[0] || null;
    const hasAlert = latestEntry
      ? (statusIsAlert(latestEntry.statusGlobal) || statusIsAlert(latestEntry.statusHeight) || statusIsAlert(latestEntry.statusWeight))
      : false;
    const toneClass = hasAlert ? 'is-alert' : 'is-ok';
    const statusLabel = latestEntry?.statusGlobal ? cleanStatusText(latestEntry.statusGlobal) : '';
    const anomalies = helper.getAnomalies(3);
    const entries = hasAlert
      ? (anomalies.length ? anomalies : (latestEntry ? [latestEntry] : []))
      : helper.entries.slice(0, 1);
    const listHtml = entries.length
      ? `<ul class="report-highlight-card__list">${entries.map((entry) => `<li>${escapeHtml(helper.describeEntry(entry, { short: true }))}</li>`).join('')}</ul>`
      : '<p class="report-highlight-card__text">Aucune mesure récente disponible.</p>';
    const icon = hasAlert
      ? (statusLabel && statusLabel.toLowerCase().includes('trop') ? '🚨' : '⚠️')
      : '✅';
    const intro = statusLabel
      ? `Analyse OMS : ${statusLabel}.`
      : hasAlert
        ? 'Analyse OMS : vigilance recommandée.'
        : 'Analyse OMS : les dernières mesures sont dans la norme.';
    container.innerHTML = `
      <div class="report-highlight-card ${toneClass}">
        <div class="report-highlight-card__header">
          <span class="report-highlight-card__icon">${icon}</span>
          <h4>Croissance</h4>
        </div>
        <p class="report-highlight-card__text">${escapeHtml(intro)}</p>
        ${listHtml}
      </div>
    `;
  }

  async function collectGrowthAlerts(children = []) {
    if (!useRemote()) return [];
    const list = Array.isArray(children) ? children.filter((child) => child && child.id != null) : [];
    if (!list.length) return [];
    const results = await Promise.all(list.map(async (child) => {
      try {
        const helper = await renderGrowthStatus(child.id);
        const anomalies = helper.getAnomalies(2);
        const latest = helper.entries[0] || null;
        const baseEntries = anomalies.length ? anomalies : (latest ? [latest] : []);
        const summaries = baseEntries.map((entry) => helper.describeEntry(entry, { short: true })).filter(Boolean);
        return {
          childId: child.id,
          childName: child.firstName || child.name || 'Enfant',
          hasAnomaly: anomalies.length > 0,
          summaries,
          latestEntry: latest,
        };
      } catch (err) {
        console.warn('collectGrowthAlerts child error', err);
        return {
          childId: child.id,
          childName: child.firstName || child.name || 'Enfant',
          hasAnomaly: false,
          summaries: [],
          latestEntry: null,
        };
      }
    }));
    return results;
  }

  function renderFamilyGrowthAlertsCard(alerts = [], children = []) {
    if (!useRemote()) return '';
    const list = Array.isArray(alerts) ? alerts.filter(Boolean) : [];
    if (!list.length) {
      const hasChildren = Array.isArray(children) && children.length > 0;
      const emptyText = hasChildren
        ? 'Mesures insuffisantes pour analyser la croissance.'
        : 'Ajoutez un profil enfant pour suivre la croissance.';
      return `
        <div class="card stack family-growth-alerts">
          <div class="card-header">
            <h3>Anomalies de croissance</h3>
            <p class="page-subtitle">Synthèse des mesures OMS.</p>
          </div>
          <div class="empty-state muted">${escapeHtml(emptyText)}</div>
        </div>
      `;
    }
    const items = list.map((entry) => {
      const name = escapeHtml(entry.childName || 'Enfant');
      const icon = entry.hasAnomaly ? '⚠️' : '✅';
      const text = entry.summaries && entry.summaries.length
        ? entry.summaries.map((line) => escapeHtml(line)).join('<br>')
        : 'Aucune anomalie détectée sur les dernières mesures.';
      let meta = '';
      if (entry.latestEntry?.measuredAt) {
        const d = new Date(entry.latestEntry.measuredAt);
        if (!Number.isNaN(d.getTime())) {
          meta = `<span class="family-growth-alerts__meta">${escapeHtml(d.toLocaleDateString('fr-FR', { dateStyle: 'medium' }))}</span>`;
        }
      }
      const statusClass = entry.hasAnomaly ? 'is-alert' : 'is-ok';
      return `
        <li class="family-growth-alerts__item ${statusClass}">
          <div class="family-growth-alerts__head">
            <span class="family-growth-alerts__icon">${icon}</span>
            <strong class="family-growth-alerts__name">${name}</strong>
            ${meta}
          </div>
          <p class="family-growth-alerts__text">${text}</p>
        </li>
      `;
    }).join('');
    const hasAlert = list.some((entry) => entry.hasAnomaly);
    const footer = hasAlert
      ? '<p class="family-growth-alerts__hint">⚠️ Parlez-en à votre professionnel de santé si les écarts se confirment.</p>'
      : '<p class="family-growth-alerts__hint">✅ RAS : la croissance suit les repères OMS récents.</p>';
    return `
      <div class="card stack family-growth-alerts">
        <div class="card-header">
          <h3>Anomalies de croissance</h3>
          <p class="page-subtitle">Synthèse automatique des 20 dernières mesures.</p>
        </div>
        <ul class="family-growth-alerts__list">${items}</ul>
        ${footer}
      </div>
    `;
  }

  // Initialisation
  bootstrap();
  if (!location.hash) location.hash = '#/';
  setActiveRoute(location.hash);
  // Vérifier l’adaptation de l’en-tête au chargement
  evaluateHeaderFit();
  // Année du pied de page (remplace un script inline pour respecter la CSP)
  try {
    const yEl = document.getElementById('y');
    if (yEl) yEl.textContent = String(new Date().getFullYear());
  } catch {}

  // --- Helpers d’appels IA ---
  async function askAI(question, child, history){
    const payload = { question, child, history, type: 'advice' };
    const res = await fetch('/api/ai', {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    const raw = await res.text();
    if (!res.ok) {
      try { const j = JSON.parse(raw); throw new Error(j.error || j.details || raw || 'AI backend error'); }
      catch { throw new Error(raw || 'AI backend error'); }
    }
    let data; try { data = JSON.parse(raw); } catch { data = { text: raw }; }
    if (data?.status === 'unavailable') {
      throw new Error(data.message || 'Fonction IA désactivée.');
    }
    return data.text || 'Aucune réponse.';
  }

  async function askAIRecipes(child, prefs){
    const payload = { child, prefs, type: 'recipes' };
    const res = await fetch('/api/ai', {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('AI backend error');
    const data = await res.json();
    if (data?.status === 'unavailable') {
      throw new Error(data.message || 'Fonction IA désactivée.');
    }
    return data.text || '';
  }

  async function askAIStory(child, opts){
    const payload = { child, ...opts, type: 'story' };
    const res = await fetch('/api/ai', {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('AI backend error');
    const data = await res.json();
    if (data?.status === 'unavailable') {
      throw new Error(data.message || 'Fonction IA désactivée.');
    }
    return data.text || '';
  }

  // Animations révélées au scroll
  function setupScrollAnimations(){
    try { revealObserver?.disconnect(); } catch {}
    revealObserver = null;
    const root = document.querySelector('.route.active') || document;
    const targets = [
      ...$$('.card', root),
      ...$$('.feature', root),
      ...$$('.step', root),
      ...$$('.testimonial', root),
      ...$$('.faq-item', root),
      ...$$('.pillar', root),
      ...$$('.chart-card', root),
      ...$$('section', root),
      ...$$('.section', root)
    ];
    const uniqueTargets = Array.from(new Set(targets));
    uniqueTargets.forEach((el) => {
      el.classList.remove('reveal', 'fade-right', 'fade-in', 'in-view');
      el.removeAttribute('data-delay');
    });
  }
})();
