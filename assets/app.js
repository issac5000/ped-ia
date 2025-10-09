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

const DASHBOARD_BADGES = [
  { key: '0_12_sit_unaided', label: 'Stabilité', milestoneLabel: 'Se tient assis sans aide', icon: '🧘' },
  { key: '0_12_pull_to_stand', label: 'Appuis', milestoneLabel: 'Se met debout en s’appuyant', icon: '🪜' },
  { key: '12_24_walk_alone', label: 'Explorateur', milestoneLabel: 'Marche seul', icon: '🧭' },
  { key: '12_24_follow_one_step', label: 'Compréhension', milestoneLabel: 'Suit une consigne simple', icon: '🧠' },
  { key: '24_36_phrase_3_4', label: 'Petit bavard', milestoneLabel: 'Forme des phrases de 3-4 mots', icon: '💬' },
  { key: '24_36_start_toilet_training', label: 'Autonomie', milestoneLabel: 'Commence l’apprentissage de la propreté', icon: '🚽' }
];

const PARENT_BADGE_DEFS = [
  {
    level: 2,
    name: 'Parent attentif',
    icon: '👀',
    tooltip: 'Vous avez commencé à suivre activement le développement de votre enfant.',
  },
  {
    level: 5,
    name: 'Parent impliqué',
    icon: '🤝',
    tooltip: 'Votre régularité inspire confiance. Continuez comme ça !',
  },
  {
    level: 8,
    name: 'Parent engagé',
    icon: '🔗',
    tooltip: 'Votre implication crée un lien fort avec votre enfant.',
  },
  {
    level: 10,
    name: 'Parent dévoué',
    icon: '❤️',
    tooltip: 'Votre constance est un exemple de dévouement.',
  },
  {
    level: 15,
    name: 'Parent exemplaire',
    icon: '🌟',
    tooltip: 'Votre suivi dépasse les attentes. Vous êtes un modèle !',
  },
  {
    level: 20,
    name: 'Parent légendaire',
    icon: '👑',
    tooltip: 'Votre engagement est légendaire. Vous méritez tous les honneurs !',
  },
];

const DEV_QUESTION_INDEX_BY_KEY = new Map(DEV_QUESTIONS.map((question, index) => [question.key, index]));
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
      const chatInput = document.querySelector('[data-chat-card] textarea[name="q"]');
      if (chatInput && chatInput._aiPlaceholderInterval) {
        clearInterval(chatInput._aiPlaceholderInterval);
        delete chatInput._aiPlaceholderInterval;
      }
    } catch {}
    try {
      const wrap = document.querySelector('[data-chat-child-indicator]');
      if (wrap && wrap._chatOutsideClickHandler) {
        document.removeEventListener('click', wrap._chatOutsideClickHandler);
        delete wrap._chatOutsideClickHandler;
      }
    } catch {}
  }

  function relocateChatCardForRoute(path){
    const card = document.querySelector('[data-chat-card]');
    if (!card) return;
    const homeSlot = document.querySelector('[data-chat-card-slot="home"]');
    const dedicatedSlot = document.querySelector('[data-chat-card-slot="dedicated"]');
    const targetSlot = path === '/ped-ia' ? dedicatedSlot : homeSlot;
    if (targetSlot && !targetSlot.contains(card)) {
      targetSlot.appendChild(card);
    } else if (!targetSlot && homeSlot && !homeSlot.contains(card)) {
      homeSlot.appendChild(card);
    }
    const isDedicated = path === '/ped-ia';
    card.classList.toggle('chat-card--immersive', isDedicated);
    const chatWindow = card.querySelector('.chat-window');
    if (chatWindow) chatWindow.classList.toggle('chat-window--immersive', isDedicated);
    const dedicatedResetBtn = document.querySelector('[data-chat-relocate-reset]');
    if (dedicatedResetBtn) {
      if (!dedicatedResetBtn._chatRelocateBound) {
        dedicatedResetBtn.addEventListener('click', (event) => {
          event.preventDefault();
          try { document.getElementById('ai-chat-reset')?.click(); }
          catch {}
        });
        dedicatedResetBtn._chatRelocateBound = true;
      }
      const mainReset = document.getElementById('ai-chat-reset');
      dedicatedResetBtn.hidden = !isDedicated;
      dedicatedResetBtn.disabled = !isDedicated || !mainReset || mainReset.disabled;
    }
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


  const communityLikes = new Map();
  const parentPreviewCache = new Map();
  const parentPreviewFetches = new Map();
  let parentPreviewCard = null;
  let parentPreviewBackdrop = null;
  var parentPreviewHideTimer = null;
  var parentPreviewRequestToken = 0;
  var parentPreviewLastPointerType = null;
  var parentPreviewGlobalHandlersBound = false;
  var parentPreviewSuppressClicksUntil = 0;
  var parentPreviewSuppressPointerUntil = 0;
  var parentPreviewTouchAnchor = null;
  var parentPreviewTouchStartX = 0;
  var parentPreviewTouchStartY = 0;
  var parentPreviewTouchStartTime = 0;
  var parentPreviewState = {
    profileId: null,
    anchor: null,
    isLoading: false,
  };

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
    del(k) { localStorage.removeItem(k); },
  };
  const normalizeAnonCode = (value) => {
    if (typeof value === 'string') return value.trim().toUpperCase();
    if (value == null) return '';
    return String(value).trim().toUpperCase();
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
  function getStoredAnonCode() {
    if (activeProfile?.isAnonymous && activeProfile?.code_unique) {
      const normalized = normalizeAnonCode(activeProfile.code_unique);
      if (normalized) return normalized;
    }
    let savedSession = null;
    try { savedSession = store.get(K.session) || null; } catch { savedSession = null; }
    if (savedSession?.type === 'anon' && savedSession?.code) {
      const normalized = normalizeAnonCode(savedSession.code);
      if (normalized) return normalized;
    }
    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem(K.session);
        if (raw) {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch { parsed = null; }
          if (parsed?.type === 'anon' && parsed?.code) {
            const normalized = normalizeAnonCode(parsed.code);
            if (normalized) return normalized;
          }
        }
      }
    } catch {}
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('anon_code');
        if (raw) {
          const normalized = normalizeAnonCode(raw);
          if (normalized) return normalized;
        }
      }
    } catch {}
    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem('anon_code');
        if (raw) {
          const normalized = normalizeAnonCode(raw);
          if (normalized) return normalized;
        }
      }
    } catch {}
    return '';
  }
  const DEBUG_AUTH = (typeof localStorage !== 'undefined' && localStorage.getItem('debug_auth') === '1');

  // Chargement des informations Supabase et du client JS
  let supabase = null;
  async function ensureSupabaseReady() {
    if (supabase) return supabase;
    while (!supabase) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return supabase;
  }
  if (typeof window !== 'undefined') {
    window.ensureSupabaseReady = ensureSupabaseReady;
  }
  const IS_IOS_SAFARI = (() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || navigator.vendor || '';
    const isIOS = /iP(hone|od|ad)/.test(ua);
    if (!isIOS) return false;
    const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua);
    return isSafari;
  })();
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
    privacy: { showStats: true },
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
    const text = parts.join(' • ');
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

  async function loadParentPreview(profileId) {
    const normalizedId = profileId != null ? String(profileId).trim() : '';
    if (!normalizedId) return null;
    if (!useRemote()) return null;
    if (isAnonProfile()) {
      try {
        const data = await anonCommunityRequest('parent-preview', { profileId: normalizedId });
        if (data && typeof data === 'object') {
          const payload = Array.isArray(data.preview)
            ? data.preview[0] || null
            : data.preview ?? data;
          if (payload && typeof payload === 'object') {
            const enriched = { ...payload };
            if (enriched.profile_id == null) enriched.profile_id = normalizedId;
            if (enriched.profileId == null) enriched.profileId = normalizedId;
            if (enriched.id == null) enriched.id = normalizedId;
            return enriched;
          }
        }
      } catch (err) {
        console.warn('loadParentPreview anon failed', err);
      }
      return null;
    }
    try {
      const client = await ensureSupabaseReady();
      if (!client?.rpc) return null;
      const { data, error } = await client.rpc('get_parent_preview', { pid: normalizedId });
      if (error) {
        console.warn('loadParentPreview rpc failed', error);
        return null;
      }
      if (Array.isArray(data) && data.length > 0) {
        const payload = data[0] || null;
        if (payload && typeof payload === 'object') {
          const enriched = { ...payload };
          if (enriched.profile_id == null) enriched.profile_id = normalizedId;
          if (enriched.profileId == null) enriched.profileId = normalizedId;
          if (enriched.id == null) enriched.id = normalizedId;
          return enriched;
        }
        return payload;
      }
      if (data && typeof data === 'object') {
        const enriched = { ...data };
        if (enriched.profile_id == null) enriched.profile_id = normalizedId;
        if (enriched.profileId == null) enriched.profileId = normalizedId;
        if (enriched.id == null) enriched.id = normalizedId;
        return enriched;
      }
    } catch (err) {
      console.warn('loadParentPreview failed', err);
    }
    return null;
  }

  function normalizeParentBadgeSummary(badge) {
    if (!badge || typeof badge !== 'object') return null;
    const rawLevel = badge.level ?? badge.badge_level;
    const levelNum = Number(rawLevel);
    if (!Number.isFinite(levelNum)) return null;
    const def = PARENT_BADGE_DEFS.find((item) => item.level === levelNum) || null;
    const unlockedRaw = badge.isUnlocked ?? badge.is_unlocked;
    const isUnlocked = unlockedRaw === true || unlockedRaw === 'true' || unlockedRaw === 1;
    const normalized = {
      level: levelNum,
      name: badge.name || badge.badge_name || def?.name || '',
      icon: badge.icon || badge.badge_icon || def?.icon || '',
      tooltip: badge.tooltip || badge.description || def?.tooltip || '',
      isUnlocked,
      unlockedAt: badge.unlockedAt || badge.unlocked_at || null,
    };
    return normalized;
  }

  function normalizeParentBadges(rows = []) {
    const byLevel = new Map();
    rows.forEach((row) => {
      const summary = normalizeParentBadgeSummary(row);
      if (!summary) return;
      byLevel.set(summary.level, summary);
    });
    return PARENT_BADGE_DEFS.map((def) => {
      const stored = byLevel.get(def.level) || null;
      return {
        level: def.level,
        name: stored?.name || def.name,
        icon: stored?.icon || def.icon,
        tooltip: def.tooltip,
        isUnlocked: stored?.isUnlocked === true,
        unlockedAt: stored?.unlockedAt || null,
      };
    });
  }

  async function loadParentBadges(profileId) {
    const hasSupabase = !!supabase;
    const candidate = profileId == null ? '' : String(profileId).trim();
    if (!hasSupabase || !candidate) {
      return normalizeParentBadges();
    }
    let filterValue = candidate;
    if (typeof profileId === 'number' && Number.isFinite(profileId)) {
      filterValue = profileId;
    }
    try {
      const { data, error } = await supabase
        .from('badges_parent')
        .select('badge_level,badge_name,badge_icon,is_unlocked,unlocked_at')
        .eq('profile_id', filterValue)
        .order('badge_level', { ascending: true });
      if (error) throw error;
      return normalizeParentBadges(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('loadParentBadges failed', err);
      return normalizeParentBadges();
    }
  }

  function highestUnlockedParentBadge(badges = []) {
    const source = Array.isArray(badges) ? badges : [];
    let best = null;
    for (const badge of source) {
      if (!badge || !badge.isUnlocked) continue;
      if (!best || (Number(badge.level) || 0) > (Number(best.level) || 0)) {
        best = badge;
      }
    }
    return best;
  }

  async function loadParentBadgeSummaries(profileIds = []) {
    if (!supabase || !Array.isArray(profileIds) || !profileIds.length) {
      return new Map();
    }
    const idSet = new Set();
    profileIds.forEach((value) => {
      const normalized = value == null ? '' : String(value).trim();
      if (!normalized || normalized === 'undefined' || normalized === 'null') return;
      idSet.add(normalized);
    });
    if (!idSet.size) return new Map();
    const filterValues = Array.from(idSet).map((value) => (/^-?\d+$/.test(value) ? Number(value) : value));
    try {
      const { data, error } = await supabase
        .from('badges_parent')
        .select('profile_id,badge_level,badge_name,badge_icon,is_unlocked,unlocked_at')
        .in('profile_id', filterValues)
        .eq('is_unlocked', true);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      const result = new Map();
      rows.forEach((row) => {
        if (!row || typeof row !== 'object') return;
        const rawId = row.profile_id ?? row.profileId;
        const idStr = rawId == null ? '' : String(rawId).trim();
        if (!idStr) return;
        const summary = normalizeParentBadgeSummary({ ...row, is_unlocked: true });
        if (!summary) return;
        const existing = result.get(idStr);
        if (!existing || summary.level > existing.level) {
          result.set(idStr, { ...summary, isUnlocked: true });
        }
      });
      return result;
    } catch (err) {
      console.warn('loadParentBadgeSummaries failed', err);
      return new Map();
    }
  }

  async function attachParentBadgesToAuthors(map) {
    if (!(map instanceof Map) || !map.size) return;
    if (!supabase) return;
    const ids = new Set();
    map.forEach((value, key) => {
      const candidate = value?.profileId ?? key;
      const normalized = candidate == null ? '' : String(candidate).trim();
      if (!normalized || normalized === 'undefined' || normalized === 'null') return;
      ids.add(normalized);
    });
    if (!ids.size) {
      map.forEach((value, key) => {
        if (!value || typeof value !== 'object' || Object.prototype.hasOwnProperty.call(value, 'parentBadge')) return;
        map.set(String(key), { ...value, parentBadge: null });
      });
      return;
    }
    const summaries = await loadParentBadgeSummaries(Array.from(ids));
    map.forEach((value, key) => {
      if (!value || typeof value !== 'object') return;
      const candidateKey = value?.profileId ?? key;
      const normalizedKey = candidateKey == null ? '' : String(candidateKey).trim();
      const lookupKey = normalizedKey && normalizedKey !== 'undefined' && normalizedKey !== 'null'
        ? normalizedKey
        : null;
      const badge = lookupKey ? summaries.get(lookupKey) || null : null;
      const nextValue = { ...value, parentBadge: badge || null };
      map.set(String(key), nextValue);
    });
  }

  async function resolveAccessToken() {
    let token = authSession?.access_token || '';
    if (!token) {
      let client = null;
      try {
        client = await ensureSupabaseReady();
      } catch (err) {
        console.warn('resolveAccessToken ensureSupabaseReady failed', err);
      }
      if (client?.auth) {
        try {
          const { data: { session } } = await client.auth.getSession();
          token = session?.access_token || '';
        } catch (err) {
          console.warn('resolveAccessToken getSession failed', err);
        }
      }
    }
    return token || '';
  }

  restoreAnonSession();

  const EDGE_FUNCTION_BASE_URL = '/api/edge';

  function resolveEdgeFunctionBase() {
    if (typeof window !== 'undefined') {
      const envUrl = window.__SUPABASE_ENV__?.url;
      if (typeof envUrl === 'string' && envUrl.trim()) {
        const trimmed = envUrl.trim().replace(/\/+$/, '');
        if (/\/functions\/v1$/i.test(trimmed)) {
          return trimmed;
        }
        if (trimmed === '/api/edge') {
          return trimmed;
        }
        return `/api/edge`;
      }
    }
    return EDGE_FUNCTION_BASE_URL;
  }

  async function callEdgeFunction(endpoint, { method = 'POST', body, includeAuth = true, headers = {} } = {}) {
    console.debug('[callEdgeFunction] →', endpoint, { method, body });
    const finalHeaders = { ...headers };
    if (body !== undefined && finalHeaders['Content-Type'] == null) {
      finalHeaders['Content-Type'] = 'application/json';
    }
    if (includeAuth) {
      const token = await resolveAccessToken();
      if (token) {
        finalHeaders['Authorization'] = `Bearer ${token}`;
      }
    }
    const requestInit = {
      method,
      headers: finalHeaders,
    };
    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }
    const response = await fetch(`${resolveEdgeFunctionBase()}/${endpoint}`, requestInit);
    if (response.status === 403) {
      console.warn('[callEdgeFunction] 403 ignored (anon call too early)');
      return null;
    }
    const payload = await response.json().catch(() => ({}));
    console.debug('[callEdgeFunction] ←', endpoint, { status: response.status, payload });
    if (!response.ok || !payload?.success) {
      const errorMessage = payload?.error || 'Service indisponible';
      const err = new Error(errorMessage);
      if (payload?.details != null) err.details = payload.details;
      console.error('[callEdgeFunction] Error response', { endpoint, status: response.status, payload });
      throw err;
    }
    return payload.data ?? null;
  }

  async function callAnonEdgeFunction(slug, options = {}) {
    const { body: originalBody, ...rest } = options || {};
    const normalizedBody = originalBody && typeof originalBody === 'object' ? { ...originalBody } : {};
    let code = normalizeAnonCode(normalizedBody.code);
    if (!code) {
      code = getStoredAnonCode();
    }
    if (code) {
      normalizedBody.code = code;
    }
    console.log('[Anon Debug] Sending anon code', code || '(none)', 'to', slug);
    return callEdgeFunction(slug, { ...rest, body: normalizedBody });
  }

  async function anonChildRequest(action, payload = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const code = getStoredAnonCode();
    if (!code) throw new Error('Code unique manquant');
    let normalizedPayload = payload;
    try {
      normalizedPayload = normalizeAnonChildPayload(action, payload);
    } catch (err) {
      throw err;
    }
    const body = { action, code, ...normalizedPayload };
    const data = await callAnonEdgeFunction('anon-children', { body });
    return data || {};
  }

  async function anonParentRequest(action, payload = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const code = getStoredAnonCode();
    if (!code) throw new Error('Code unique manquant');
    const body = { action, code, ...payload };
    const data = await callAnonEdgeFunction('anon-parent-updates', { body });
    return data || {};
  }

  async function anonFamilyRequest(action, payload = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const code = getStoredAnonCode();
    if (!code) throw new Error('Code unique manquant');
    const body = { action, code, ...payload };
    const data = await callAnonEdgeFunction('anon-family', { body });
    return data || {};
  }

  async function anonMessagesRequest(code_unique, { since = null } = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const explicitCode = normalizeAnonCode(code_unique);
    const code = explicitCode || getStoredAnonCode();
    if (!code) return { messages: [], senders: {} };
    try {
      const body = { action: 'recent-activity', code };
      if (since) body.since = since;
      const payload = await callAnonEdgeFunction('anon-messages', { body });
      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      const senders = payload?.senders && typeof payload.senders === 'object' ? payload.senders : {};
      return { messages, senders };
    } catch (err) {
      console.error('anonMessagesRequest failed', err);
      return { messages: [], senders: {} };
    }
  }

  async function anonCommunityRequest(action, payload = {}) {
    try {
      const anonCode =
        (typeof getStoredAnonCode === 'function' && getStoredAnonCode())
        || (typeof localStorage !== 'undefined' ? localStorage.getItem('anon_code') : null);

      if (!anonCode) {
        console.warn('[AnonCommunity Warning] Aucun code anonyme trouvé dans le stockage local.');
      }

      const body = {
        action,
        code: anonCode,
      };

      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        Object.keys(payload).forEach((key) => {
          if (key !== 'action') body[key] = payload[key];
        });
      }

      console.log('[AnonCommunity Debug] Final body sent to anon-community:', body);

      const response = await callEdgeFunction('anon-community', { body });
      return response;
    } catch (err) {
      console.error('[AnonCommunity Error]', err);
      throw err;
    }
  }

  anonChildRequest.__anonEndpoint = '/api/edge/anon-children';
  anonChildRequest.__expectsCode = true;
  anonChildRequest.__normalizePayload = normalizeAnonChildPayload;
  anonParentRequest.__anonEndpoint = '/api/edge/anon-parent-updates';
  anonParentRequest.__expectsCode = true;
  anonFamilyRequest.__anonEndpoint = '/api/edge/anon-family';
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
    const data = await callAnonEdgeFunction('anon-parent-updates', { body: { action: 'profile', code } });
    const profile = data?.profile || null;
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

 

  

  // Données démo locales pour pré-remplir le Carnet de suivi & la communauté
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
      store.set(K.privacy, { showStats: true });
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
    document.body.classList.toggle('ped-ia-chat-active', path === '/ped-ia');
    relocateChatCardForRoute(path);
    try {
      const pl = document.getElementById('page-logo');
      if (pl) pl.hidden = (path === '/' || path === '' || path === '/ped-ia');
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
    const isAiRoute = path === '/ai';
    const isAiChatRoute = path === '/ped-ia';
    if (isAiRoute) {
      setupAIPage(path);
      if (focusParam) {
        setTimeout(() => focusAIToolSection(focusParam), 60);
      }
    } else if (isAiChatRoute) {
      clearAiFocusHighlight();
      setupAIPage(path);
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
      if (!supabase || !user?.id) return null;
      const uid = user.id;
      const metaName = user.user_metadata?.full_name || user.email || '';

      const { data: profileByUser, error: selectErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();
      if (selectErr && selectErr.code !== 'PGRST116') throw selectErr;
      if (profileByUser) {
        console.log('[Auth Debug] Profile reused', { id: profileByUser.id, user_id: profileByUser.user_id });
        return profileByUser;
      }

      const { data: profileById, error: orphanErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .maybeSingle();
      if (orphanErr) throw orphanErr;
      if (profileById) {
        if (profileById.user_id == null) {
          const updatePayload = { user_id: uid };
          if ((!profileById.full_name || !profileById.full_name.trim()) && metaName) {
            updatePayload.full_name = metaName;
          }
          const { data: linkedProfile, error: linkErr } = await supabase
            .from('profiles')
            .update(updatePayload)
            .eq('id', uid)
            .select('*')
            .maybeSingle();
          if (linkErr) throw linkErr;
          console.log('[Auth Debug] Profile linked to user_id', { id: linkedProfile?.id, user_id: linkedProfile?.user_id });
          return linkedProfile;
        }
        console.log('[Auth Debug] Profile reused by id', { id: profileById.id, user_id: profileById.user_id });
        return profileById;
      }

      const insertPayload = { id: uid, user_id: uid };
      if (metaName) insertPayload.full_name = metaName;
      const { data: createdProfile, error: insertErr } = await supabase
        .from('profiles')
        .insert(insertPayload)
        .select('*')
        .maybeSingle();
      if (insertErr) throw insertErr;
      console.log('[Auth Debug] Profile created', { id: createdProfile?.id, user_id: createdProfile?.user_id });
      return createdProfile;
    } catch (e) {
      if (DEBUG_AUTH) console.warn('ensureProfile failed', e);
      return null;
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
      const currentUser = store.get(K.user) || {};
      const fullNameRaw = typeof currentUser?.pseudo === 'string' ? currentUser.pseudo.trim() : '';
      const requestBody = fullNameRaw ? { fullName: fullNameRaw } : {};
      const payload = await callEdgeFunction('profiles-create-anon', { body: requestBody });
      const data = payload?.profile;
      if (!data) {
        throw new Error('Création impossible pour le moment.');
      }
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
  function setupAIPage(routePath = '/ai'){
    const route = document.querySelector(`section[data-route="${routePath}"]`);
    if (!route) return;
    const instanceId = ++aiPageState.instance;
    aiPageState.currentChild = null;

    function resolveParentProfile() {
      try {
        const user = store.get(K.user) || {};
        const pseudo = typeof user?.pseudo === 'string' ? user.pseudo.trim() : '';
        const firstNameRaw = typeof user?.firstName === 'string' ? user.firstName.trim() : '';
        const firstNameAlt = typeof user?.first_name === 'string' ? user.first_name.trim() : '';
        const nameRaw = typeof user?.name === 'string' ? user.name.trim() : '';
        const firstName = firstNameRaw || firstNameAlt;
        const displaySource = [firstName, pseudo, nameRaw].find((val) => val && val.length > 0) || '';
        const displayName = displaySource ? displaySource.split(/\s+/)[0] : '';
        return {
          pseudo,
          firstName,
          name: nameRaw,
          displayName,
        };
      } catch {
        return { pseudo: '', firstName: '', name: '', displayName: '' };
      }
    }

    function resolveParentGreetingName() {
      const profile = resolveParentProfile();
      const candidates = [profile.displayName, profile.pseudo, profile.firstName, profile.name].filter(
        (val) => typeof val === 'string' && val.trim().length > 0,
      );
      const selected = candidates[0] || '';
      return selected.trim();
    }

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
    const autoSendChatSuggestions = true;
    const welcomeBaseText = '👋 Comment va la petite famille ? Envie de faire un point ?';
    const WELCOME_DELAY_MS = 800;
    const WELCOME_TYPE_DELAY_MS = 26;
    let welcomeTimeoutId = null;
    let welcomeTypingTimeoutId = null;
    const chatModes = { TEXT: 'text', IMAGE: 'image' };
    const chatTextPlaceholders = ['Écris ici…', 'Pose ta question…', 'Dis-moi tout…'];
    const chatImagePlaceholder = "Décris l'image que tu veux créer...";
    let chatPlaceholderIndex = 0;
    let chatPlaceholderIntervalId = null;
    let currentChatMode = chatModes.TEXT;
    let btnImageMode = null;
    let txtChat = null;
    let cancelChatTypewriter = null;
    const TYPEWRITER_DELAY_MS = 16;
    const setChatBubbleText = (node, text) => {
      if (!node) return;
      node.innerHTML = '';
      const str = typeof text === 'string' ? text : '';
      const segments = str.split('\n');
      segments.forEach((segment, idx) => {
        node.appendChild(document.createTextNode(segment));
        if (idx < segments.length - 1) {
          node.appendChild(document.createElement('br'));
        }
      });
    };
    const stopActiveChatTypewriter = () => {
      if (typeof cancelChatTypewriter === 'function') {
        cancelChatTypewriter();
        cancelChatTypewriter = null;
      }
    };
    const applyChatTypewriter = (bubble, text, container) => {
      stopActiveChatTypewriter();
      if (!bubble || !bubble.isConnected) return;
      const fullText = typeof text === 'string' ? text : '';
      const chars = Array.from(fullText);
      const total = chars.length;
      if (!total) {
        bubble.textContent = '';
        return;
      }
      const chunkSize = (() => {
        if (total > 900) return 12;
        if (total > 600) return 9;
        if (total > 400) return 7;
        if (total > 250) return 5;
        if (total > 120) return 3;
        if (total > 60) return 2;
        return 1;
      })();
      let index = 0;
      let timerId = null;
      const renderText = (value) => {
        setChatBubbleText(bubble, value);
        if (container && container.isConnected) {
          safeScrollTo(container, { top: container.scrollHeight, behavior: 'auto' });
        }
      };
      const cleanup = () => {
        if (timerId) clearTimeout(timerId);
        renderText(fullText);
        cancelChatTypewriter = null;
      };
      const step = () => {
        if (!bubble.isConnected) {
          cleanup();
          return;
        }
        index = Math.min(total, index + chunkSize);
        renderText(chars.slice(0, index).join(''));
        if (index < total) {
          timerId = setTimeout(step, TYPEWRITER_DELAY_MS);
        } else {
          cleanup();
        }
      };
      renderText('');
      step();
      cancelChatTypewriter = cleanup;
    };
    const chatSuggestionPresets = [
      { emoji: '🧠', label: 'Bilan de développement', template: 'Peux-tu me faire un bilan de développement pour {prenom_enfant} ?' },
      { emoji: '🚶', label: 'Jalons moteurs', template: 'Où en est {prenom_enfant} dans ses jalons moteurs ?' },
      { emoji: '🌙', label: 'Sommeil récent', template: 'As-tu remarqué une évolution du sommeil ces dernières semaines ?' }
    ];
    const isChatInImageMode = () => currentChatMode === chatModes.IMAGE;
    const applyChatPlaceholder = () => {
      if (!txtChat) return;
      if (isChatInImageMode()) {
        txtChat.placeholder = chatImagePlaceholder;
      } else {
        const count = chatTextPlaceholders.length;
        const idx = count ? chatPlaceholderIndex % count : 0;
        txtChat.placeholder = chatTextPlaceholders[idx] || chatImagePlaceholder;
      }
    };
    function setChatMode(mode) {
      const nextMode = mode === chatModes.IMAGE ? chatModes.IMAGE : chatModes.TEXT;
      currentChatMode = nextMode;
      if (fChat) fChat.dataset.mode = nextMode;
      if (txtChat) {
        txtChat.dataset.mode = nextMode;
      }
      if (btnImageMode) {
        btnImageMode.setAttribute('aria-pressed', nextMode === chatModes.IMAGE ? 'true' : 'false');
        btnImageMode.classList.toggle('active', nextMode === chatModes.IMAGE);
      }
      applyChatPlaceholder();
    }
    const getChatSuggestionsContainer = () => {
      if (!isRouteAttached()) return null;
      const container = document.getElementById('chat-suggestions');
      if (!container) return null;
      return container;
    };
    const getSuggestionChildName = () => {
      const child = getCurrentChild();
      const fromFirstName = child?.firstName || child?.first_name;
      const fromName = child?.name;
      const raw = (fromFirstName || fromName || '').toString().trim();
      return raw || 'votre enfant';
    };
    const formatSuggestionText = (template) => {
      const name = getSuggestionChildName();
      return template.replace(/\{prenom_enfant\}/g, name);
    };
    const buildChatSuggestionCards = () => {
      const container = getChatSuggestionsContainer();
      if (!container) return;
      container.innerHTML = '';
      const form = document.getElementById('form-ai-chat');
      const textarea = form?.querySelector('textarea[name="q"]');
      chatSuggestionPresets.forEach((preset) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'suggestion-card';
        const suggestionText = formatSuggestionText(preset.template);
        btn.innerHTML = `
          <span class="suggestion-emoji">${preset.emoji}</span>
          <span class="suggestion-text"><strong>${escapeHtml(preset.label)}</strong><span>${escapeHtml(suggestionText)}</span></span>`;
        btn.addEventListener('click', () => {
          const currentForm = form || document.getElementById('form-ai-chat');
          if (autoSendChatSuggestions && currentForm?.dataset.busy === '1') return;
          if (isChatInImageMode()) {
            setChatMode(chatModes.TEXT);
          }
          const currentTextarea = textarea || currentForm?.querySelector('textarea[name="q"]');
          if (currentTextarea) {
            currentTextarea.value = suggestionText;
            currentTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            try { currentTextarea.focus(); } catch {}
          }
          if (autoSendChatSuggestions && currentForm) {
            hideChatSuggestions();
            if (typeof currentForm.requestSubmit === 'function') currentForm.requestSubmit();
            else currentForm.submit();
          }
        });
        container.appendChild(btn);
      });
    };
    const showChatSuggestions = () => {
      const container = getChatSuggestionsContainer();
      if (!container) return;
      buildChatSuggestionCards();
      if (!container.hidden) {
        container.classList.remove('fade-in');
        void container.offsetWidth;
        container.classList.add('fade-in');
        container.addEventListener('animationend', () => container.classList.remove('fade-in'), { once: true });
        return;
      }
      container.hidden = false;
      container.classList.remove('fade-in');
      void container.offsetWidth;
      container.classList.add('fade-in');
      container.addEventListener('animationend', () => container.classList.remove('fade-in'), { once: true });
    };
    const hideChatSuggestions = () => {
      const container = getChatSuggestionsContainer();
      if (!container) return;
      if (!container.hidden) {
        container.hidden = true;
      }
      container.classList.remove('fade-in');
    };
    const updateChatSuggestions = (arr) => {
      if (!isRouteAttached()) return;
      const list = Array.isArray(arr) ? arr : [];
      const hasMeaningfulMessage = list.some((msg) => {
        if (!msg || typeof msg !== 'object') return false;
        if (msg.type === 'auto-greeting') return false;
        if (typeof msg.content === 'string' && msg.content.trim()) return true;
        return Boolean(msg.type && msg.type !== 'auto-greeting');
      });
      if (!hasMeaningfulMessage) showChatSuggestions();
      else hideChatSuggestions();
    };
    const requestChatImage = async (prompt) => {
      const res = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const raw = await res.text();
      if (!res.ok) {
        let message = 'Impossible de générer l’illustration pour le moment.';
        try {
          const payload = JSON.parse(raw || '{}');
          const basic = payload?.error || payload?.message;
          const detail = payload?.details || payload?.error?.message;
          message = [basic || message, detail].filter(Boolean).join(' — ');
        } catch {}
        throw new Error(message);
      }
      let payload = {};
      try {
        payload = JSON.parse(raw || '{}');
      } catch {
        payload = { image: raw };
      }
      const candidates = [
        payload?.imageUrl,
        payload?.url,
        payload?.image,
        payload?.base64,
        payload?.data,
        payload?.result,
      ];
      let source = '';
      candidates.forEach((candidate) => {
        if (typeof candidate !== 'string') return;
        const value = candidate.trim();
        if (!value) return;
        if (!source) source = value;
        if (value.startsWith('http')) {
          source = value;
        }
      });
      if (!source) throw new Error('Réponse image invalide.');
      if (!source.startsWith('http')) {
        const mime = typeof payload?.mime === 'string' ? payload.mime : 'image/png';
        const safeMime = mime.startsWith('image/') ? mime : 'image/png';
        source = source.startsWith('data:') ? source : `data:${safeMime};base64,${source}`;
      }
      return { imageUrl: source };
    };
    const clearWelcomeTyping = () => {
      if (welcomeTypingTimeoutId) {
        clearTimeout(welcomeTypingTimeoutId);
        welcomeTypingTimeoutId = null;
      }
    };
    const removeWelcomeMessage = () => {
      if (welcomeTimeoutId) {
        clearTimeout(welcomeTimeoutId);
        welcomeTimeoutId = null;
      }
      clearWelcomeTyping();
      const existing = document.getElementById('ai-chat-welcome');
      if (existing) existing.remove();
    };
    const buildWelcomeMessageText = () => {
      const parentName = resolveParentGreetingName();
      if (!parentName) return welcomeBaseText;
      return `👋 Hey ${parentName} Comment va la petite famille ? Envie de faire un point ?`;
    };
    const typeWelcomeText = (node, text, container) => {
      const chars = Array.from(text);
      let idx = 0;
      const step = () => {
        if (!isRouteAttached()) {
          clearWelcomeTyping();
          return;
        }
        if (!node || !node.isConnected) {
          clearWelcomeTyping();
          return;
        }
        node.textContent += chars[idx] ?? '';
        idx += 1;
        if (container && container.isConnected) {
          safeScrollTo(container, { top: container.scrollHeight, behavior: 'smooth' });
        }
        if (idx < chars.length) {
          const nextDelay = chars[idx - 1] === ' ' ? WELCOME_TYPE_DELAY_MS / 2 : WELCOME_TYPE_DELAY_MS;
          welcomeTypingTimeoutId = setTimeout(step, nextDelay);
        } else {
          welcomeTypingTimeoutId = null;
        }
      };
      step();
    };
    const showWelcomeMessage = () => {
      if (!isRouteAttached()) return;
      const container = document.getElementById('ai-chat-messages');
      if (!container || !document.body.contains(container)) return;
      const child = getCurrentChild();
      const history = loadChat(child);
      if (Array.isArray(history) && history.length) return;
      if (document.getElementById('ai-chat-welcome')) return;
      clearWelcomeTyping();
      const line = document.createElement('div');
      line.id = 'ai-chat-welcome';
      line.className = 'chat-line assistant';
      line.dataset.welcome = '1';
      line.innerHTML = `
        <div class="avatar">🤖</div>
        <div class="message">
          <div class="meta">Ped'IA</div>
          <div class="bubble assistant"><span class="welcome-text"></span></div>
        </div>`;
      container.appendChild(line);
      safeScrollTo(container, { top: container.scrollHeight, behavior: 'smooth' });
      const span = line.querySelector('.welcome-text');
      if (span) {
        span.textContent = '';
        const messageText = buildWelcomeMessageText();
        typeWelcomeText(span, messageText, container);
      }
    };
    const scheduleWelcomeMessage = () => {
      if (!isRouteAttached()) return;
      if (welcomeTimeoutId) return;
      if (document.getElementById('ai-chat-welcome')) return;
      const child = getCurrentChild();
      const history = loadChat(child);
      if (Array.isArray(history) && history.length) return;
      welcomeTimeoutId = setTimeout(() => {
        welcomeTimeoutId = null;
        showWelcomeMessage();
      }, WELCOME_DELAY_MS);
    };
    const renderChat = (arr, options = {}) => {
      if (!isRouteAttached()) return;
      const el = document.getElementById('ai-chat-messages');
      if (!el || !document.body.contains(el)) return;
      const list = Array.isArray(arr) ? arr : [];
      updateChatSuggestions(list);
      if (list.length) removeWelcomeMessage();
      const userRole = store.get(K.user)?.role;
      const userAvatar = userRole === 'papa' ? '👨' : '👩';
      stopActiveChatTypewriter();
      el.innerHTML = '';
      const { animateLatestAssistant = false } = options || {};
      let animateIndex = -1;
      if (animateLatestAssistant) {
        for (let i = list.length - 1; i >= 0; i -= 1) {
          const candidate = list[i];
          if (
            candidate
            && candidate.role === 'assistant'
            && typeof candidate.content === 'string'
            && candidate.type !== 'image-result'
          ) {
            animateIndex = i;
            break;
          }
        }
      }
      let typewriterBubble = null;
      let typewriterText = '';
      list.forEach((m, idx) => {
        const role = m?.role === 'user' ? 'user' : 'assistant';
        const avatar = role === 'user' ? userAvatar : '🤖';
        const label = role === 'user' ? 'Vous' : "Ped'IA";
        const line = document.createElement('div');
        line.className = `chat-line ${role}`;
        if (typeof m?.type === 'string' && m.type) {
          line.dataset.messageType = m.type;
        }
        const avatarEl = document.createElement('div');
        avatarEl.className = 'avatar';
        avatarEl.textContent = avatar;
        const messageWrap = document.createElement('div');
        messageWrap.className = 'message';
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = label;
        messageWrap.appendChild(meta);
        const bubble = document.createElement('div');
        bubble.className = `bubble ${role}`;
        if (m?.type === 'image-result' && m?.imageUrl) {
          const imageMessage = document.createElement('div');
          imageMessage.className = 'chat-image-message';
          const introText = typeof m.content === 'string' && m.content ? m.content : "🎨 Voici l'image que j'ai générée pour toi :";
          if (introText) {
            const paragraph = document.createElement('p');
            setChatBubbleText(paragraph, introText);
            imageMessage.appendChild(paragraph);
          }
          const figure = document.createElement('figure');
          const img = document.createElement('img');
          img.src = m.imageUrl;
          img.alt = typeof m.alt === 'string' && m.alt ? m.alt : "Illustration générée par Ped'IA";
          img.loading = 'lazy';
          img.decoding = 'async';
          figure.appendChild(img);
          imageMessage.appendChild(figure);
          bubble.appendChild(imageMessage);
        } else {
          const textContent = typeof m?.content === 'string' ? m.content : '';
          if (role === 'assistant' && idx === animateIndex && textContent) {
            setChatBubbleText(bubble, '');
            typewriterBubble = bubble;
            typewriterText = textContent;
          } else {
            setChatBubbleText(bubble, textContent);
          }
        }
        messageWrap.appendChild(bubble);
        line.appendChild(avatarEl);
        line.appendChild(messageWrap);
        el.appendChild(line);
      });
      if (!list.length) {
        scheduleWelcomeMessage();
      } else {
        safeScrollTo(el, { top: el.scrollHeight, behavior: 'smooth' });
      }
      if (typewriterBubble && typewriterBubble.isConnected) {
        applyChatTypewriter(typewriterBubble, typewriterText, el);
      }
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
    btnImageMode = document.getElementById('ai-chat-image-toggle');
    txtChat = fChat?.querySelector('textarea[name="q"]');
    if (btnImageMode) {
      btnImageMode.addEventListener('click', () => {
        if (fChat?.dataset.busy === '1') return;
        const nextMode = isChatInImageMode() ? chatModes.TEXT : chatModes.IMAGE;
        setChatMode(nextMode);
        try {
          txtChat?.focus();
        } catch {}
      });
    }
    setChatMode(currentChatMode);
    if (txtChat) {
      if (txtChat._aiPlaceholderInterval) {
        clearInterval(txtChat._aiPlaceholderInterval);
      }
      if (chatPlaceholderIntervalId) {
        clearInterval(chatPlaceholderIntervalId);
        chatPlaceholderIntervalId = null;
      }
      applyChatPlaceholder();
      chatPlaceholderIntervalId = setInterval(() => {
        if (!txtChat) return;
        if (document.activeElement === txtChat) return;
        if (isChatInImageMode()) return;
        const count = chatTextPlaceholders.length;
        if (!count) return;
        chatPlaceholderIndex = (chatPlaceholderIndex + 1) % count;
        applyChatPlaceholder();
      }, 4000);
      txtChat._aiPlaceholderInterval = chatPlaceholderIntervalId;
      if (!txtChat.dataset.enterSubmitBound) {
        txtChat.dataset.enterSubmitBound = '1';
        txtChat.addEventListener('keydown', (event) => {
          if (
            event.key === 'Enter'
            && !event.shiftKey
            && !event.ctrlKey
            && !event.metaKey
            && !event.altKey
          ) {
            if (fChat?.dataset.busy === '1') return;
            event.preventDefault();
            const form = fChat;
            if (!form) return;
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.submit();
          }
        });
      }
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
        removeWelcomeMessage();
        renderChat([]);
        if (sChat) sChat.textContent = '';
        setChatMode(chatModes.TEXT);
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
        if (txtChat) {
          txtChat.value = '';
          txtChat.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          fChat.reset();
        }
        const isImageModeSubmission = isChatInImageMode();
        if (sChat) sChat.textContent = isImageModeSubmission ? 'Génération en cours…' : 'Réflexion en cours…';
        const history = loadChat(child);
        history.push(
          isImageModeSubmission
            ? { role: 'user', content: q, type: 'image-prompt' }
            : { role: 'user', content: q }
        );
        saveChat(child, history);
        renderChat(history);

        if (isImageModeSubmission) {
          document.getElementById('ai-typing')?.remove();
          const pendingEntry = { role: 'assistant', content: '🎨 Je prépare ton image, ça peut prendre quelques secondes...', type: 'image-status' };
          history.push(pendingEntry);
          saveChat(child, history);
          renderChat(history);
          if (btnImageMode) btnImageMode.disabled = true;
          try {
            const { imageUrl } = await requestChatImage(q);
            const active = getCurrentChild();
            const activeId = active && active.id != null ? String(active.id) : 'anon';
            if (aiPageState.instance !== runId || activeId !== childId || !isRouteAttached()) return;
            const updatedHistory = loadChat(child);
            if (updatedHistory.length && updatedHistory[updatedHistory.length - 1]?.type === 'image-status') {
              updatedHistory.pop();
            }
            updatedHistory.push({
              role: 'assistant',
              content: "🎨 Voici l'image que j'ai générée pour toi :",
              type: 'image-result',
              imageUrl,
              alt: q,
            });
            saveChat(child, updatedHistory);
            renderChat(updatedHistory);
          } catch (err) {
            const active = getCurrentChild();
            const activeId = active && active.id != null ? String(active.id) : 'anon';
            if (aiPageState.instance !== runId || activeId !== childId || !isRouteAttached()) return;
            const message = err instanceof Error && err.message ? err.message : 'Illustration indisponible.';
            const updatedHistory = loadChat(child);
            if (updatedHistory.length && updatedHistory[updatedHistory.length - 1]?.type === 'image-status') {
              updatedHistory[updatedHistory.length - 1] = {
                role: 'assistant',
                content: `❌ ${message}`,
                type: 'image-error',
              };
            } else {
              updatedHistory.push({ role: 'assistant', content: `❌ ${message}`, type: 'image-error' });
            }
            saveChat(child, updatedHistory);
            renderChat(updatedHistory);
          } finally {
            if (aiPageState.instance === runId) {
              if (sChat) sChat.textContent = '';
              fChat.dataset.busy = '0';
              if (submitBtn) submitBtn.disabled = false;
              if (btnImageMode) btnImageMode.disabled = false;
              setChatMode(chatModes.TEXT);
            }
          }
          return;
        }

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
          const sanitizedHistory = history
            .filter((entry) => entry && !entry.type)
            .map((entry) => ({ role: entry.role, content: entry.content }));
          const parentProfile = resolveParentProfile();
          const resp = await askAI(q, child, sanitizedHistory, parentProfile);
          const active = getCurrentChild();
          const activeId = active && active.id != null ? String(active.id) : 'anon';
          if (aiPageState.instance !== runId || activeId !== childId || !isRouteAttached()) return;
          const newH = loadChat(child);
          newH.push({ role: 'assistant', content: resp });
          saveChat(child, newH);
          renderChat(newH, { animateLatestAssistant: true });
        } catch (err) {
          const active = getCurrentChild();
          const activeId = active && active.id != null ? String(active.id) : 'anon';
          if (aiPageState.instance !== runId || activeId !== childId || !isRouteAttached()) return;
          const msg = err instanceof Error && err.message ? err.message : String(err || 'IA indisponible');
          const newH = loadChat(child);
          newH.push({ role: 'assistant', content: `[Erreur IA] ${msg}` });
          saveChat(child, newH);
          renderChat(newH, { animateLatestAssistant: true });
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

    const applyChildSelection = async (id) => {
      if (!id) return;
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

    const renderIndicator = async (child) => {
      if (!isRouteAttached()) return;
      const slim = await listChildrenSlim();
      if (!isActiveInstance()) return;

      if (routePath === '/ped-ia') {
        const wrap = route.querySelector('[data-chat-child-indicator]');
        const toggle = wrap?.querySelector('[data-chat-child-toggle]');
        const label = wrap?.querySelector('[data-chat-child-label]');
        const menu = wrap?.querySelector('[data-chat-child-menu]');
        if (!wrap || !toggle || !label || !menu) return;

        if (!child || !slim.length || slim.length <= 1) {
          wrap.hidden = true;
          menu.hidden = true;
          menu.innerHTML = '';
          toggle.setAttribute('aria-expanded', 'false');
          if (wrap._chatOutsideClickHandler) {
            document.removeEventListener('click', wrap._chatOutsideClickHandler);
            delete wrap._chatOutsideClickHandler;
          }
          return;
        }

        wrap.hidden = false;
        const currentName = child.firstName || child.name || 'Enfant';
        label.textContent = currentName;

        menu.innerHTML = '';
        menu.setAttribute('role', 'listbox');
        slim.forEach((c) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'chat-child-menu-item';
          btn.dataset.childId = c.id;
          btn.setAttribute('role', 'option');
          const txt = c.dob ? `${c.firstName} • ${formatAge(c.dob)}` : c.firstName;
          btn.textContent = txt;
          const isActive = String(c.id) === String(child.id);
          if (isActive) btn.classList.add('is-active');
          btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
          menu.appendChild(btn);
        });

        const closeMenu = () => {
          menu.hidden = true;
          wrap.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        };
        const openMenu = () => {
          menu.hidden = false;
          wrap.classList.add('is-open');
          toggle.setAttribute('aria-expanded', 'true');
        };

        if (!wrap._chatMenuHandler) {
          menu.addEventListener('click', (event) => {
            const target = event.target.closest('.chat-child-menu-item');
            if (!target) return;
            event.preventDefault();
            closeMenu();
            applyChildSelection(target.dataset.childId);
          });
          wrap._chatMenuHandler = true;
        }

        if (!wrap._chatToggleHandler) {
          toggle.addEventListener('click', (event) => {
            event.preventDefault();
            if (menu.hidden) openMenu();
            else closeMenu();
          });
          toggle.setAttribute('aria-haspopup', 'listbox');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.setAttribute('aria-label', 'Sélectionner un enfant');
          toggle.setAttribute('title', 'Sélectionner un enfant');
          wrap._chatToggleHandler = true;
        }

        if (!wrap._chatOutsideClickHandler) {
          const handler = (event) => {
            if (!wrap.contains(event.target)) closeMenu();
          };
          document.addEventListener('click', handler);
          wrap._chatOutsideClickHandler = handler;
        }
        closeMenu();
        return;
      }

      const container = route.querySelector('.stack');
      if (!container) return;
      let box = document.getElementById('ai-profile-indicator');
      if (!box) {
        box = document.createElement('div');
        box.id = 'ai-profile-indicator';
        box.className = 'card';
      }
      container.insertBefore(box, container.firstChild);
      if (!child || !slim.length) {
        box.innerHTML = '<div class="muted">Aucun profil enfant chargé pour l’IA. <a href="#/onboarding">Créer un profil</a>.</div>';
        return;
      }
      const ageTxt = formatAge(child.dob);
      const selectedId = child.id;
      const opts = slim
        .map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.firstName)}${c.dob ? ` • ${escapeHtml(formatAge(c.dob))}` : ''}</option>`)
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
        const handleChange = (e) => {
          const id = e.currentTarget.value;
          applyChildSelection(id);
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
      const history = loadChat(child);
      renderChat(history);
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
    const storedPrivacyRaw = store.get(K.privacy, { showStats: true }) || {};
    const storedChildren = store.get(K.children, []);
    const baseSnapshot = {
      user: { role: 'maman', ...storedUser },
      privacy: {
        showStats: storedPrivacyRaw.showStats != null ? !!storedPrivacyRaw.showStats : true,
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
                <span class="muted">${escapeHtml(ageLabel)}</span>
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
        const remoteChild = await loadChildById(idStr);
        if (remoteChild) child = remoteChild;
      } catch (err) {
        console.warn('Chargement du profil enfant impossible', err);
      }
    }
    let latestMeasurementRow = null;
    let latestTeethRow = null;
    const canFetchLatestGrowth = useRemote() || isAnonProfile();
    if (canFetchLatestGrowth) {
      try {
        const childAccess = dataProxy.children();
        if (childAccess.isAnon) {
          const latest = await childAccess.callAnon('latest-growth', { childId: idStr });
          if (latest && typeof latest === 'object') {
            if (latest.measurement && typeof latest.measurement === 'object') {
              latestMeasurementRow = latest.measurement;
            }
            if (latest.teeth && typeof latest.teeth === 'object') {
              latestTeethRow = latest.teeth;
            }
          }
        } else if (useRemote()) {
          const supaClient = await childAccess.getClient();
          const [measurementRes, teethRes] = await Promise.all([
            supaClient
              .from('growth_measurements')
              .select('month,height_cm,weight_kg,created_at')
              .eq('child_id', idStr)
              .order('created_at', { ascending: false, nullsFirst: false })
              .limit(1)
              .maybeSingle(),
            supaClient
              .from('growth_teeth')
              .select('month,count,created_at')
              .eq('child_id', idStr)
              .order('created_at', { ascending: false, nullsFirst: false })
              .limit(1)
              .maybeSingle(),
          ]);
          if (measurementRes?.data) latestMeasurementRow = measurementRes.data;
          if (teethRes?.data) latestTeethRow = teethRes.data;
        }
      } catch (err) {
        console.warn('Dernières mesures indisponibles', err);
      }
    }
    if (!child) {
      container.innerHTML = '<p class="muted">Profil enfant introuvable.</p>';
      return;
    }
    if (ridRef && ridRef !== renderSettings._rid) return;

    settingsState.childrenMap.set(idStr, child);

    child.growth = child.growth && typeof child.growth === 'object' ? child.growth : {};
    if (!Array.isArray(child.growth.measurements)) child.growth.measurements = [];
    if (!Array.isArray(child.growth.sleep)) child.growth.sleep = [];
    if (!Array.isArray(child.growth.teeth)) child.growth.teeth = [];

    if (latestMeasurementRow) {
      const monthRaw = Number(latestMeasurementRow.month);
      const hasMonth = Number.isFinite(monthRaw);
      const heightVal = Number(latestMeasurementRow.height_cm ?? latestMeasurementRow.height);
      const weightVal = Number(latestMeasurementRow.weight_kg ?? latestMeasurementRow.weight);
      const hasHeight = Number.isFinite(heightVal);
      const hasWeight = Number.isFinite(weightVal);
      if (hasHeight || hasWeight) {
        const existingIndex = hasMonth
          ? child.growth.measurements.findIndex((entry) => Number(entry?.month ?? entry?.m) === monthRaw)
          : -1;
        const baseEntry = existingIndex >= 0
          ? { ...child.growth.measurements[existingIndex] }
          : (hasMonth ? { month: monthRaw } : {});
        if (hasHeight) baseEntry.height = heightVal;
        if (hasWeight) baseEntry.weight = weightVal;
        if (Number.isFinite(baseEntry.height) && Number.isFinite(baseEntry.weight) && baseEntry.height > 0) {
          baseEntry.bmi = baseEntry.weight / Math.pow(baseEntry.height / 100, 2);
        } else {
          delete baseEntry.bmi;
        }
        if (latestMeasurementRow.created_at) baseEntry.measured_at = latestMeasurementRow.created_at;
        if (existingIndex >= 0) child.growth.measurements.splice(existingIndex, 1, baseEntry);
        else child.growth.measurements.push(baseEntry);
        child.growth.measurements.sort((a, b) => Number(a?.month ?? a?.m ?? 0) - Number(b?.month ?? b?.m ?? 0));
      }
    }
    if (latestTeethRow) {
      const monthRaw = Number(latestTeethRow.month);
      const hasMonth = Number.isFinite(monthRaw);
      const rawCount = latestTeethRow.count ?? latestTeethRow.teeth ?? latestTeethRow.value;
      const countVal = Number(rawCount);
      if (Number.isFinite(countVal)) {
        const normalizedCount = Math.max(0, Math.round(countVal));
        const existingIndex = hasMonth
          ? child.growth.teeth.findIndex((entry) => Number(entry?.month ?? entry?.m) === monthRaw)
          : -1;
        const baseEntry = existingIndex >= 0
          ? { ...child.growth.teeth[existingIndex] }
          : (hasMonth ? { month: monthRaw } : {});
        baseEntry.count = normalizedCount;
        if (latestTeethRow.created_at) baseEntry.recorded_at = latestTeethRow.created_at;
        if (existingIndex >= 0) child.growth.teeth.splice(existingIndex, 1, baseEntry);
        else child.growth.teeth.push(baseEntry);
        child.growth.teeth.sort((a, b) => Number(a?.month ?? a?.m ?? 0) - Number(b?.month ?? b?.m ?? 0));
      }
    }

    const measures = normalizeMeasures(child.growth.measurements);
    const latestMeasurement = getLatestMeasurementEntry(measures);
    const latestTeethEntry = getLatestTeethEntry(child.growth.teeth);
    const heightInputValue = Number.isFinite(latestMeasurement?.height) ? String(latestMeasurement.height) : '';
    const weightInputValue = Number.isFinite(latestMeasurement?.weight) ? String(latestMeasurement.weight) : '';
    const teethInputValue = Number.isFinite(latestTeethEntry?.count)
      ? String(Math.max(0, Math.round(latestTeethEntry.count)))
      : '';

    settingsState.snapshots.set(idStr, makeUpdateSnapshot(child));

    const allergiesValue = child.context?.allergies ? String(child.context.allergies) : '';
    const historyValue = child.context?.history ? String(child.context.history) : '';
    const careValue = child.context?.care ? String(child.context.care) : '';
    const languagesValue = child.context?.languages ? String(child.context.languages) : '';
    const allergiesPlaceholder = allergiesValue ? '' : 'ex: pollen, lait de vache';
    const historyPlaceholder = historyValue ? '' : 'ex: asthme, prématurité';
    const languagesPlaceholder = languagesValue ? '' : 'ex: français, anglais';

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
        <label>Allergies<input type="text" name="allergies" value="${escapeHtml(allergiesValue)}"${allergiesPlaceholder ? ` placeholder="${escapeHtml(allergiesPlaceholder)}"` : ''} /></label>
        <label>Antécédents<input type="text" name="history" value="${escapeHtml(historyValue)}"${historyPlaceholder ? ` placeholder="${escapeHtml(historyPlaceholder)}"` : ''} /></label>
        <label>Mode de garde<input type="text" name="care" value="${escapeHtml(careValue)}" /></label>
        <label>Langues parlées<input type="text" name="languages" value="${escapeHtml(languagesValue)}"${languagesPlaceholder ? ` placeholder="${escapeHtml(languagesPlaceholder)}"` : ''} /></label>
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
      const parentContext = readParentContextFromForm(fd);
      const parentComment = sanitizeParentComment(fd.get('parent_comment'));
      const hasParentComment = !!parentComment;
      const previousUser = { ...(settingsState.user || {}) };
      const previousContext = normalizeParentContext(previousUser || {});
      const parentContextChanges = diffParentContexts(previousContext, parentContext);
      const pseudoChanged = (previousUser.pseudo || '') !== pseudo;
      const roleChanged = (previousUser.role || 'maman') !== role;
      const nextPrivacy = { showStats };
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
        text: 'Rendez-vous dans le Carnet de suivi à la section « Mises à jour parentales » vue famille, pour consulter toutes les mises à jour et lire les commentaires de votre assistant IA.',
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
      text: 'Rendez-vous dans le Carnet de suivi à la section « historique de l’évolution » pour consulter toutes les mises à jour et lire les commentaires de votre assistant IA.',
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
    const previousPrivacy = settingsState.privacy || { showStats: false };
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
      const teethEntries = Array.isArray(growth.teeth) ? growth.teeth : [];
      const milestones = Array.isArray(safeChild.milestones) ? safeChild.milestones : [];
      if (rid !== renderDashboard._rid) return;
      // Calculer le dernier état de santé (mesures récentes)
      const msAll = normalizeMeasures(measurements);
      const latestH = [...msAll].reverse().find(m=>Number.isFinite(m.height))?.height;
      const latestW = [...msAll].reverse().find(m=>Number.isFinite(m.weight))?.weight;
      const lastTeeth = [...teethEntries].sort((a,b)=> (a.month??0)-(b.month??0)).slice(-1)[0]?.count;
      const ageDays = ageInDays(dobValue);
      const timelineSection = build1000DaysTimeline(safeChild, ageDays);
      let growthStatusHelper = null;
      const growthStatusPromise = renderGrowthStatus(safeChild.id).catch((err) => {
        console.warn('renderGrowthStatus failed', err);
        return null;
      });
      const formatStatValue = (value, suffix = '') => {
        if (value == null) return '—';
        const num = Number(value);
        if (Number.isFinite(num)) {
          const rounded = Math.round(num * 10) / 10;
          const str = Number.isInteger(rounded) ? String(Math.round(rounded)) : rounded.toFixed(1);
          return `${str}${suffix}`;
        }
        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed ? `${trimmed}${suffix}` : '—';
        }
        return '—';
      };
      const formatChip = (label, rawValue) => {
        const safeLabel = escapeHtml(label);
        const raw = rawValue == null ? '' : String(rawValue).trim();
        const isEmpty = !raw || raw === '—';
        if (isEmpty) {
          return `${safeLabel} : <span class="chip-value chip-value-empty">—</span>`;
        }
        return `${safeLabel} : <strong class="chip-value">${escapeHtml(raw)}</strong>`;
      };
      let growthStatusMessage = 'Chargement…';
      let growthStatusClass = 'is-ok';
      if (rid !== renderDashboard._rid) return;
      setDashboardHtml(`
      <div class="grid-2 child-dashboard-grid">
        <div class="card child-hero-card">
          <div class="family-hero-header child-hero-header">
            ${safeChild.photo
              ? `<div class="family-avatar child-avatar-photo"><img src="${safeChild.photo}" alt="${escapeHtml(safeChild.firstName || '')}" loading="lazy" decoding="async"/></div>`
              : `<div class="family-avatar child-avatar-initial">${escapeHtml((safeChild.firstName||'?').slice(0,1).toUpperCase())}</div>`}
            <div class="family-hero-heading child-hero-heading">
              <h2 class="child-name">${escapeHtml(safeChild.firstName || 'Votre enfant')}<span class="child-age">${escapeHtml(ageTxt)}</span></h2>
              <p class="muted child-meta">Sexe : <strong>${escapeHtml(safeChild.sex || '—')}</strong></p>
            </div>
          </div>
          <div class="family-hero-stats child-hero-stats" aria-label="Dernières mesures connues">
            <div class="family-hero-stat child-stat">
              <span class="family-hero-stat-label">Taille</span>
              <strong class="family-hero-stat-value">${escapeHtml(formatStatValue(latestH, ' cm'))}</strong>
            </div>
            <div class="family-hero-stat child-stat">
              <span class="family-hero-stat-label">Poids</span>
              <strong class="family-hero-stat-value">${escapeHtml(formatStatValue(latestW, ' kg'))}</strong>
            </div>
            <div class="family-hero-stat child-stat">
              <span class="family-hero-stat-label">Dents</span>
              <strong class="family-hero-stat-value">${escapeHtml(formatStatValue(lastTeeth, ''))}</strong>
            </div>
            <div class="family-hero-stat child-stat child-growth-stat ${growthStatusClass}">
              <span class="family-hero-stat-label">Croissance</span>
              <strong class="family-hero-stat-value child-growth-value ${growthStatusClass}">${escapeHtml(growthStatusMessage)}</strong>
            </div>
          </div>
          <div class="family-hero-chips child-context-pills">
            <span class="chip chip-soft">${formatChip('Allergies', context.allergies || '—')}</span>
            <span class="chip chip-soft">${formatChip('Mode de garde', context.care || '—')}</span>
            <span class="chip chip-soft">${formatChip('Langues', context.languages || '—')}</span>
            <span class="chip chip-soft">${formatChip('Alimentation', labelFeedingType(context.feedingType))}</span>
            <span class="chip chip-soft">${formatChip('Appétit', labelEatingStyle(context.eatingStyle))}</span>
            <span class="chip chip-soft">${formatChip('Sommeil', summarizeSleep(sleepContext))}</span>
          </div>
          <div class="badges-container" id="dashboard-badges" role="list">
            ${renderDashboardBadges(milestones)}
          </div>
          <div class="child-hero-actions">
            <button class="btn btn-primary" type="button" id="btn-toggle-milestones">Afficher les jalons</button>
          </div>
          <div class="hstack child-milestones-list" id="milestones-list" hidden>
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

      growthStatusHelper = await growthStatusPromise;
      if (rid !== renderDashboard._rid) return;
      const applyGrowthStatus = (helper) => {
        const growthValueEl = dom.querySelector('.child-growth-value');
        const growthStatEl = dom.querySelector('.child-growth-stat');
        if (!growthValueEl || !growthStatEl) return;
        let message = 'Croissance indisponible pour le moment';
        let cssClass = 'is-ok';
        if (helper) {
          const entry = helper.entries?.[0] || null;
          if (entry) {
            const alert = statusIsAlert(entry.statusGlobal)
              || statusIsAlert(entry.statusHeight)
              || statusIsAlert(entry.statusWeight);
            message = alert ? 'À surveiller' : 'Conforme aux normes OMS';
            cssClass = alert ? 'is-alert' : 'is-ok';
          }
        }
        growthValueEl.textContent = message;
        growthValueEl.classList.remove('is-alert', 'is-ok');
        growthValueEl.classList.add(cssClass);
        growthStatEl.classList.remove('is-alert', 'is-ok');
        growthStatEl.classList.add(cssClass);
      };
      applyGrowthStatus(growthStatusHelper);

    // Section « Profil santé » retirée à la demande

    // Ajouter le bloc d’historique des mises à jour
    try {
      const updates = await getChildUpdates(safeChild.id);
      const growthStatus = growthStatusHelper || await renderGrowthStatus(safeChild.id).catch((err) => {
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
    const parentBadgesData = Array.isArray(data.parentBadges) && data.parentBadges.length
      ? data.parentBadges
      : normalizeParentBadges();
    const parentBadgesHtml = renderParentBadges(parentBadgesData);
    const parentBadgesSection = parentBadgesHtml
      ? `
        <div class="badges-container parent-badges" id="parent-badges" role="list">
          ${parentBadgesHtml}
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
        ${parentBadgesSection}
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
    const bilanRaw = typeof data.familyContext?.ai_bilan === 'string' ? data.familyContext.ai_bilan.trim() : '';
    const bilanText = bilanRaw
      ? `<div class="family-bilan-text"><p>${escapeHtml(bilanRaw).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>`
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
        parentBadges: normalizeParentBadges(),
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
      let resolvedProfileId = activeProfile?.id ?? null;
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
              if (profileRow.id != null) resolvedProfileId = profileRow.id;
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
              familyContext = {
                ai_bilan: aiBilan,
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
          const parentBadges = await loadParentBadges(resolvedProfileId);
          if (resolvedProfileId != null && !parentInfo.id) {
            parentInfo.id = resolvedProfileId;
          }
          const result = {
            parentContext,
            parentInfo,
            children,
            familyContext,
            parentUpdates,
            growthAlerts,
            parentBadges,
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
            .select('ai_bilan,last_generated_at,children_ids')
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
          id: uid,
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
        const parentUpdates = Array.isArray(parentUpdatesRes.data) ? parentUpdatesRes.data : [];
        let growthAlerts = [];
        try {
          growthAlerts = await collectGrowthAlerts(children);
        } catch (err) {
          console.warn('collectGrowthAlerts failed', err);
        }
        const parentBadges = await loadParentBadges(uid);
        return {
          parentContext,
          parentInfo,
          children,
          familyContext: familyRow,
          parentUpdates,
          growthAlerts,
          parentBadges,
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
        let bilan = typeof result?.bilan === 'string' ? result.bilan : '';
        let generatedAt = result?.lastGeneratedAt || new Date().toISOString();
        const refreshed = Boolean(result?.refreshed);
        if (refreshed) {
          if (typeof localStorage !== 'undefined') {
            try { localStorage.removeItem('family_context'); } catch {}
          }
          dashboardState.family.data = null;
          if (result?.profileId) {
            console.log('[AI DEBUG] family-bilan cache invalidated', { profileId: result.profileId });
          }
          try {
            const cacheKeyProfileId = result?.profileId || targetProfileId || null;
            const cacheKey = cacheKeyProfileId ? `family_context_${cacheKeyProfileId}` : null;
            if (cacheKey && typeof localStorage !== 'undefined') {
              try { localStorage.removeItem(cacheKey); } catch {}
            }
          } catch {}
          state.data = null;
          state.lastFetchedAt = 0;
          let refreshedOverview = null;
          try {
            refreshedOverview = await fetchFamilyOverview({ force: true });
          } catch (refreshErr) {
            console.warn('family overview refresh after regeneration failed', refreshErr);
          }
          if (refreshedOverview?.familyContext) {
            bilan = typeof refreshedOverview.familyContext.ai_bilan === 'string'
              ? refreshedOverview.familyContext.ai_bilan
              : bilan;
            generatedAt = refreshedOverview.familyContext.last_generated_at || generatedAt;
          } else {
            const previousData = state.data && typeof state.data === 'object' ? state.data : {};
            const fallbackContext = {
              ...(previousData.familyContext || {}),
              ai_bilan: bilan,
              last_generated_at: generatedAt,
            };
            state.data = { ...previousData, familyContext: fallbackContext };
            state.lastFetchedAt = Date.now();
          }
        } else {
          const previousData = state.data && typeof state.data === 'object' ? state.data : {};
          const nextFamilyContext = {
            ...(previousData.familyContext || {}),
            ai_bilan: bilan,
            last_generated_at: generatedAt,
          };
          state.data = { ...previousData, familyContext: nextFamilyContext };
          state.lastFetchedAt = Date.now();
        }
        if (refreshDashboard && dashboardState.viewMode === 'family') {
          try {
            await renderDashboard();
          } catch (renderErr) {
            console.warn('family dashboard render failed after regeneration', renderErr);
          }
        }
        return { bilan, lastGeneratedAt: generatedAt, refreshed };
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

  function parseGrowthTimestamp(value) {
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isNaN(ms) ? null : ms;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const ms = Date.parse(value);
      return Number.isNaN(ms) ? null : ms;
    }
    return null;
  }

  function parseGrowthNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function getLatestMeasurementEntry(entries) {
    const arr = Array.isArray(entries) ? entries : [];
    let best = null;
    let bestTs = null;
    let bestMonth = null;
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue;
      const height = parseGrowthNumber(entry.height ?? entry.height_cm);
      const weight = parseGrowthNumber(entry.weight ?? entry.weight_kg);
      if (height == null && weight == null) continue;
      const ts = parseGrowthTimestamp(entry.measured_at ?? entry.created_at ?? entry.recorded_at ?? entry.updated_at ?? null);
      const monthVal = parseGrowthNumber(entry.month ?? entry.m);
      if (ts != null) {
        if (bestTs == null || ts > bestTs || (ts === bestTs && monthVal != null && (bestMonth == null || monthVal > bestMonth))) {
          best = {
            height: height != null ? height : NaN,
            weight: weight != null ? weight : NaN,
            month: monthVal != null ? monthVal : null,
            measured_at: entry.measured_at ?? entry.created_at ?? null,
          };
          bestTs = ts;
          bestMonth = monthVal != null ? monthVal : bestMonth;
        }
      } else if (bestTs == null) {
        if (!best || (monthVal != null && (best.month == null || monthVal > best.month))) {
          best = {
            height: height != null ? height : NaN,
            weight: weight != null ? weight : NaN,
            month: monthVal != null ? monthVal : null,
            measured_at: entry.measured_at ?? entry.created_at ?? null,
          };
          bestMonth = monthVal != null ? monthVal : bestMonth;
        }
      }
    }
    return best;
  }

  function getLatestTeethEntry(entries) {
    const arr = Array.isArray(entries) ? entries : [];
    let best = null;
    let bestTs = null;
    let bestMonth = null;
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue;
      const count = parseGrowthNumber(entry.count ?? entry.teeth ?? entry.value);
      if (count == null) continue;
      const ts = parseGrowthTimestamp(entry.recorded_at ?? entry.measured_at ?? entry.created_at ?? entry.updated_at ?? null);
      const monthVal = parseGrowthNumber(entry.month ?? entry.m);
      if (ts != null) {
        if (bestTs == null || ts > bestTs || (ts === bestTs && monthVal != null && (bestMonth == null || monthVal > bestMonth))) {
          best = {
            count,
            month: monthVal != null ? monthVal : null,
            recorded_at: entry.recorded_at ?? entry.created_at ?? null,
          };
          bestTs = ts;
          bestMonth = monthVal != null ? monthVal : bestMonth;
        }
      } else if (bestTs == null) {
        if (!best || (monthVal != null && (best.month == null || monthVal > best.month))) {
          best = {
            count,
            month: monthVal != null ? monthVal : null,
            recorded_at: entry.recorded_at ?? entry.created_at ?? null,
          };
          bestMonth = monthVal != null ? monthVal : bestMonth;
        }
      }
    }
    return best;
  }

  function useParentPreviewModalMode() {
    if (IS_IOS_SAFARI) return true;
    if (typeof window === 'undefined') return false;
    try {
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)');
      if (coarse && coarse.matches) return true;
    } catch {
      /* ignore */
    }
    return 'ontouchstart' in window;
  }

  function ensureParentPreviewBackdrop() {
    if (parentPreviewBackdrop && document.body.contains(parentPreviewBackdrop)) {
      return parentPreviewBackdrop;
    }
    const backdrop = document.createElement('div');
    backdrop.className = 'parent-preview-backdrop';
    backdrop.dataset.parentPreviewBackdrop = '1';
    backdrop.addEventListener('click', () => {
      hideParentPreview();
    });
    document.body.appendChild(backdrop);
    parentPreviewBackdrop = backdrop;
    return backdrop;
  }

  function setParentPreviewModalState(isActive) {
    if (!useParentPreviewModalMode()) return;
    const backdrop = isActive ? ensureParentPreviewBackdrop() : parentPreviewBackdrop;
    if (!backdrop) {
      if (!isActive) document.body.classList.remove('parent-preview--modal-open');
      return;
    }
    if (isActive) {
      backdrop.classList.add('is-active');
      document.body.classList.add('parent-preview--modal-open');
    } else {
      backdrop.classList.remove('is-active');
      document.body.classList.remove('parent-preview--modal-open');
    }
  }

  function buildParentPreviewHtml(row) {
    if (!row || typeof row !== 'object') return '';
    const badgeIconRaw = row.badge_icon ?? row.badgeIcon ?? '';
    const badgeNameRaw = row.badge_name ?? row.badgeName ?? '';
    const fullNameRaw = row.full_name ?? row.fullName ?? 'Parent de la communauté';
    const childCountRaw = Number(row.number_of_children ?? row.children_count ?? row.child_count);
    const updatesCountRaw = Number(row.total_updates ?? row.totalUpdates ?? row.updates_total);
    const badgeIcon = badgeIconRaw ? `<span class="parent-preview-card__badge-icon" aria-hidden="true">${escapeHtml(badgeIconRaw)}</span>` : '';
    const badgeName = badgeNameRaw ? `<span class="parent-preview-card__badge-label">${escapeHtml(badgeNameRaw)}</span>` : '';
    const childLabel = Number.isFinite(childCountRaw)
      ? `${childCountRaw} enfant${childCountRaw === 1 ? '' : 's'}`
      : 'Nombre d’enfants non renseigné';
    const updatesLabel = Number.isFinite(updatesCountRaw)
      ? `${updatesCountRaw} mise${updatesCountRaw === 1 ? '' : 's'} à jour`
      : 'Mises à jour non renseignées';
    const lastUpdate = formatParentPreviewDate(row.last_update ?? row.lastUpdate ?? null);
    const lastUpdateLabel = lastUpdate ? `Dernière activité : ${escapeHtml(lastUpdate)}` : 'Dernière activité : —';
    const badgeBlock = (badgeIcon || badgeName)
      ? `<span class="parent-preview-card__badge">${badgeIcon}${badgeName}</span>`
      : '';
    const headerHtml = badgeBlock
      ? `<div class="parent-preview-card__header">${badgeBlock}</div>`
      : '';
    return `
      ${headerHtml}
      <div class="parent-preview-card__body">
        <p class="parent-preview-card__name"><strong>${escapeHtml(fullNameRaw)}</strong></p>
        <p>${escapeHtml(childLabel)}</p>
        <p>${escapeHtml(updatesLabel)}</p>
        <p>${lastUpdateLabel}</p>
      </div>
    `.trim();
  }

  function resolvePreviewMessageTarget(profileId, payload) {
    const normalize = (value) => {
      if (value == null) return '';
      const str = String(value).trim();
      if (!str) return '';
      if (str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') return '';
      return str;
    };
    const candidates = [];
    candidates.push(normalize(profileId));
    if (payload && typeof payload === 'object') {
      candidates.push(normalize(payload.profile_id ?? payload.profileId));
      candidates.push(normalize(payload.id));
      candidates.push(normalize(payload.user_id ?? payload.userId));
      candidates.push(normalize(payload.owner_id ?? payload.ownerId));
    }
    for (const candidate of candidates) {
      if (candidate) return candidate;
    }
    return '';
  }

  function renderParentPreviewActions(profileId, payload) {
    const targetId = resolvePreviewMessageTarget(profileId, payload);
    if (!targetId) return '';
    const href = `messages.html?user=${encodeURIComponent(targetId)}`;
    return `
      <div class="parent-preview-card__actions">
        <a class="btn btn-secondary" href="${href}">Envoyer un message</a>
      </div>
    `;
  }

  function formatParentPreviewDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    try {
      return date.toLocaleDateString('fr-FR', { dateStyle: 'medium' });
    } catch {
      return date.toLocaleDateString('fr-FR');
    }
  }

  function ensureParentPreviewCard() {
    if (parentPreviewCard && document.body.contains(parentPreviewCard)) {
      return parentPreviewCard;
    }
    if (useParentPreviewModalMode()) ensureParentPreviewBackdrop();
    const card = document.createElement('div');
    card.className = 'parent-preview-card';
    card.dataset.parentPreviewCard = '1';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-live', 'polite');
    card.addEventListener('pointerenter', () => {
      clearTimeout(parentPreviewHideTimer);
      parentPreviewHideTimer = null;
    });
    card.addEventListener('pointerleave', () => {
      scheduleParentPreviewHide();
    });
    card.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    if (!parentPreviewGlobalHandlersBound) {
      document.addEventListener('pointerdown', (event) => {
        if (!parentPreviewCard || !parentPreviewCard.classList.contains('is-active')) return;
        const target = event.target;
        if (parentPreviewCard.contains(target)) return;
        if (target && typeof target.closest === 'function' && target.closest('[data-parent-profile]')) return;
        hideParentPreview();
      }, true);
      window.addEventListener('resize', () => {
        if (parentPreviewCard && parentPreviewCard.classList.contains('is-active') && parentPreviewState.anchor) {
          positionParentPreview(parentPreviewState.anchor, parentPreviewCard);
        }
      });
      parentPreviewGlobalHandlersBound = true;
    }
    parentPreviewCard = card;
    document.body.appendChild(card);
    if (useParentPreviewModalMode()) {
      card.classList.add('parent-preview-card--modal');
    }
    return card;
  }

  function scheduleParentPreviewHide(delay = 120) {
    clearTimeout(parentPreviewHideTimer);
    parentPreviewHideTimer = window.setTimeout(() => {
      hideParentPreview();
    }, delay);
  }

  function hideParentPreview(immediate = false) {
    if (!parentPreviewState) {
      parentPreviewState = { profileId: null, anchor: null, isLoading: false };
    }
    clearTimeout(parentPreviewHideTimer);
    parentPreviewHideTimer = null;
    parentPreviewRequestToken += 1;
    parentPreviewState.profileId = null;
    parentPreviewState.anchor = null;
    parentPreviewState.isLoading = false;
    parentPreviewLastPointerType = null;
    parentPreviewTouchAnchor = null;
    parentPreviewTouchStartX = 0;
    parentPreviewTouchStartY = 0;
    parentPreviewTouchStartTime = 0;
    if (useParentPreviewModalMode()) {
      setParentPreviewModalState(false);
    }
    if (!parentPreviewCard) return;
    parentPreviewCard.dataset.profileId = '';
    if (immediate) {
      parentPreviewCard.classList.remove('is-visible');
      parentPreviewCard.classList.remove('is-active');
      parentPreviewCard.innerHTML = '';
      return;
    }
    if (!parentPreviewCard.classList.contains('is-active')) return;
    parentPreviewCard.classList.remove('is-visible');
    const handle = () => {
      parentPreviewCard.classList.remove('is-active');
      parentPreviewCard.innerHTML = '';
      parentPreviewCard.removeEventListener('transitionend', handle);
    };
    parentPreviewCard.addEventListener('transitionend', handle);
    window.setTimeout(() => {
      if (!parentPreviewCard?.classList.contains('is-visible')) {
        handle();
      }
    }, 220);
  }

  function positionParentPreview(anchor, card) {
    if (!anchor || !card) return;
    const anchorRect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!anchorRect.width && !anchorRect.height) return;
    card.style.top = '0px';
    card.style.left = '0px';
    const cardRect = card.getBoundingClientRect();
    const margin = 12;
    let top = anchorRect.bottom + margin;
    if (top + cardRect.height > viewportHeight - margin) {
      top = anchorRect.top - cardRect.height - margin;
    }
    top = Math.max(margin, Math.min(top, Math.max(margin, viewportHeight - cardRect.height - margin)));
    let left = anchorRect.left + (anchorRect.width / 2) - (cardRect.width / 2);
    const maxLeft = viewportWidth - cardRect.width - margin;
    left = Math.max(margin, Math.min(left, maxLeft < margin ? margin : maxLeft));
    card.style.top = `${Math.round(top)}px`;
    card.style.left = `${Math.round(left)}px`;
  }

  async function requestParentPreview(profileId) {
    const key = profileId;
    if (!key) return null;
    if (parentPreviewCache.has(key)) {
      return parentPreviewCache.get(key);
    }
    if (parentPreviewFetches.has(key)) {
      return parentPreviewFetches.get(key);
    }
    const promise = loadParentPreview(key)
      .then((data) => {
        if (data) parentPreviewCache.set(key, data);
        return data;
      })
      .finally(() => {
        parentPreviewFetches.delete(key);
      });
    parentPreviewFetches.set(key, promise);
    return promise;
  }

  async function showParentPreview(anchor, profileId) {
    const normalizedId = profileId != null ? String(profileId).trim() : '';
    if (!normalizedId) return;
    if (!useRemote()) return;
    clearTimeout(parentPreviewHideTimer);
    parentPreviewHideTimer = null;
    const card = ensureParentPreviewCard();
    const modalMode = useParentPreviewModalMode();
    if (modalMode) {
      setParentPreviewModalState(true);
      card.classList.add('parent-preview-card--modal');
      card.style.top = '';
      card.style.left = '';
    } else {
      card.classList.remove('parent-preview-card--modal');
    }
    const cached = parentPreviewCache.get(normalizedId) || null;
    if (
      parentPreviewState.profileId === normalizedId
      && card.classList.contains('is-active')
      && !parentPreviewState.isLoading
    ) {
      parentPreviewState.anchor = anchor || parentPreviewState.anchor;
      positionParentPreview(parentPreviewState.anchor || anchor, card);
      card.classList.add('is-visible');
      return;
    }
    if (cached) {
      const cachedPayload = typeof cached === 'object' ? { ...cached } : cached;
      parentPreviewState.profileId = normalizedId;
      parentPreviewState.anchor = anchor || null;
      parentPreviewState.isLoading = false;
      card.dataset.profileId = normalizedId;
      card.innerHTML = `${buildParentPreviewHtml(cachedPayload)}${renderParentPreviewActions(normalizedId, cachedPayload)}`;
      card.classList.add('is-active');
      card.classList.remove('is-visible');
      if (!modalMode) {
        positionParentPreview(parentPreviewState.anchor, card);
      }
      requestAnimationFrame(() => {
        if (parentPreviewState.profileId === normalizedId) {
          card.classList.add('is-visible');
        }
      });
      return;
    }
    parentPreviewState.profileId = normalizedId;
    parentPreviewState.anchor = anchor || null;
    parentPreviewState.isLoading = true;
    card.dataset.profileId = normalizedId;
    card.innerHTML = '<div class="parent-preview-card__loading">Chargement…</div>';
    card.classList.add('is-active');
    card.classList.remove('is-visible');
    if (!modalMode) {
      positionParentPreview(parentPreviewState.anchor, card);
    }
    requestAnimationFrame(() => {
      if (parentPreviewState.profileId === normalizedId) {
        card.classList.add('is-visible');
      }
    });
    parentPreviewRequestToken += 1;
    const token = parentPreviewRequestToken;
    const payload = await requestParentPreview(normalizedId);
    if (token !== parentPreviewRequestToken || parentPreviewState.profileId !== normalizedId) {
      return;
    }
    parentPreviewState.isLoading = false;
    const reusablePayload = payload && typeof payload === 'object' ? { ...payload } : payload;
    if (!payload) {
      card.innerHTML = `
        <div class="parent-preview-card__body">
          <p class="parent-preview-card__name"><strong>Profil indisponible</strong></p>
          <p>Nous n’avons pas pu charger les informations pour ce parent.</p>
          <p>Réessayez dans un instant.</p>
        </div>
        ${renderParentPreviewActions(normalizedId, reusablePayload)}
      `;
      if (!modalMode) {
        positionParentPreview(parentPreviewState.anchor, card);
      }
      return;
    }
    card.innerHTML = `${buildParentPreviewHtml(payload)}${renderParentPreviewActions(normalizedId, reusablePayload)}`;
    if (!modalMode) {
      positionParentPreview(parentPreviewState.anchor, card);
    }
  }

  function bindParentPreviewHandlers(list) {
    if (!list || list.dataset.previewBound === '1') return;
    const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    const resolvePreviewAnchor = (target) => {
      if (!target) return null;
      let node = target;
      if (node.nodeType === 3 && node.parentElement) {
        node = node.parentElement;
      }
      if (node && typeof node.closest === 'function') {
        return node.closest('[data-parent-profile]');
      }
      if (node && node.parentElement) {
        let current = node.parentElement;
        while (current) {
          if (current.matches?.('[data-parent-profile]')) return current;
          current = current.parentElement;
        }
      }
      return null;
    };
    const shouldSuppressPointer = () => parentPreviewSuppressPointerUntil && now() < parentPreviewSuppressPointerUntil;
    const togglePreviewFromAnchor = (anchor) => {
      if (!anchor) return;
      const profileId = anchor.getAttribute('data-parent-profile');
      if (!profileId) return;
      if (
        parentPreviewState.profileId === profileId
        && parentPreviewState.anchor === anchor
        && parentPreviewCard?.classList.contains('is-visible')
      ) {
        hideParentPreview();
        return;
      }
      showParentPreview(anchor, profileId);
    };
    list.addEventListener('pointerdown', (event) => {
      if (shouldSuppressPointer()) return;
      const pointerType = event.pointerType || (typeof event.pointerType === 'string' && event.pointerType.length ? event.pointerType : '');
      if (pointerType) {
        parentPreviewLastPointerType = pointerType;
      } else if (event.width && event.width > 1 && event.height && event.height > 1) {
        parentPreviewLastPointerType = 'touch';
      } else {
        parentPreviewLastPointerType = parentPreviewLastPointerType || 'mouse';
      }
    }, true);
    list.addEventListener('pointerenter', (event) => {
      if (shouldSuppressPointer()) return;
      const anchor = resolvePreviewAnchor(event.target);
      if (!anchor) return;
      const profileId = anchor.getAttribute('data-parent-profile');
      if (!profileId) return;
      parentPreviewLastPointerType = event.pointerType || parentPreviewLastPointerType || 'mouse';
      if (parentPreviewLastPointerType === 'touch') return;
      showParentPreview(anchor, profileId);
    }, true);
    list.addEventListener('pointerleave', (event) => {
      if (useParentPreviewModalMode()) return;
      if (shouldSuppressPointer()) return;
      const anchor = resolvePreviewAnchor(event.target);
      if (!anchor) return;
      if (event.pointerType === 'touch') return;
      scheduleParentPreviewHide();
    }, true);
    list.addEventListener('pointerup', (event) => {
      if (shouldSuppressPointer()) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        return;
      }
      const anchor = resolvePreviewAnchor(event.target);
      if (!anchor) return;
      const type = event.pointerType || parentPreviewLastPointerType || '';
      if (type !== 'touch' && type !== 'pen') return;
      parentPreviewLastPointerType = type || 'touch';
      const expiry = now() + 280;
      parentPreviewSuppressClicksUntil = expiry;
      parentPreviewSuppressPointerUntil = expiry;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      togglePreviewFromAnchor(anchor);
    }, true);
    const clearTouchTracking = () => {
      parentPreviewTouchAnchor = null;
      parentPreviewTouchStartX = 0;
      parentPreviewTouchStartY = 0;
      parentPreviewTouchStartTime = 0;
    };
    const handleTouchStart = (event) => {
      const anchor = resolvePreviewAnchor(event.target);
      if (!anchor) {
        clearTouchTracking();
        return;
      }
      parentPreviewLastPointerType = 'touch';
      const modalMode = useParentPreviewModalMode();
      const expiry = now() + 360;
      parentPreviewSuppressClicksUntil = expiry;
      parentPreviewSuppressPointerUntil = expiry;
      if (modalMode) {
        clearTouchTracking();
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        togglePreviewFromAnchor(anchor);
        return;
      }
      parentPreviewTouchAnchor = anchor;
      const touch = event.changedTouches && event.changedTouches[0];
      parentPreviewTouchStartX = touch ? touch.clientX : 0;
      parentPreviewTouchStartY = touch ? touch.clientY : 0;
      parentPreviewTouchStartTime = now();
    };
    const handleTouchMove = (event) => {
      if (useParentPreviewModalMode()) return;
      if (!parentPreviewTouchAnchor) return;
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      const dx = Math.abs(touch.clientX - parentPreviewTouchStartX);
      const dy = Math.abs(touch.clientY - parentPreviewTouchStartY);
      if (dx > 12 || dy > 12) {
        clearTouchTracking();
      }
    };
    const handleTouchEnd = (event) => {
      if (useParentPreviewModalMode()) return;
      if (!parentPreviewTouchAnchor) return;
      const anchor = parentPreviewTouchAnchor;
      const touch = event.changedTouches && event.changedTouches[0];
      const elapsed = now() - parentPreviewTouchStartTime;
      const dx = touch ? Math.abs(touch.clientX - parentPreviewTouchStartX) : 0;
      const dy = touch ? Math.abs(touch.clientY - parentPreviewTouchStartY) : 0;
      clearTouchTracking();
      if (dx > 12 || dy > 12 || elapsed > 800) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      togglePreviewFromAnchor(anchor);
    };
    const handleTouchCancel = () => {
      clearTouchTracking();
    };
    list.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
    list.addEventListener('touchmove', handleTouchMove, { passive: true, capture: true });
    list.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true });
    list.addEventListener('touchcancel', handleTouchCancel, { passive: true, capture: true });
    list.addEventListener('click', (event) => {
      if (parentPreviewSuppressClicksUntil && now() < parentPreviewSuppressClicksUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const anchor = resolvePreviewAnchor(event.target);
      if (!anchor) return;
      const profileId = anchor.getAttribute('data-parent-profile');
      if (!profileId) return;
      if (parentPreviewLastPointerType && parentPreviewLastPointerType !== 'touch' && parentPreviewLastPointerType !== 'pen') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      togglePreviewFromAnchor(anchor);
    });
    list.dataset.previewBound = '1';
  };

  // Communauté
  function renderCommunity() {
    // Garde d’instance pour éviter les courses et les doublons DOM
    const rid = (renderCommunity._rid = (renderCommunity._rid || 0) + 1);
    const list = $('#forum-list');
    if (!list) {
      console.warn('Forum list container introuvable');
      return;
    }
    hideParentPreview(true);
    bindParentPreviewHandlers(list);
    const isListActive = () => document.body.contains(list) && renderCommunity._rid === rid;
    list.innerHTML = '';
    renderCommunity._activeInline = null;

    const escapeSelectorValue = (value) => {
      const str = String(value ?? '');
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(str);
      }
      return str.replace(/"/g, '\"');
    };

    const closeActiveInlineReply = () => {
      const active = renderCommunity._activeInline;
      if (!active) return;
      const selector = `[data-inline-reply="${escapeSelectorValue(active.parentId)}"]`;
      const container = list.querySelector(selector);
      if (container) {
        container.classList.remove('is-open');
        container.hidden = true;
        container.innerHTML = '';
      }
      renderCommunity._activeInline = null;
    };

    const openInlineReply = (button) => {
      const parentId = button.getAttribute('data-reply-trigger');
      const topicId = button.getAttribute('data-topic-id');
      const authorName = (button.getAttribute('data-reply-author') || '').trim();
      if (!parentId || !topicId) return;
      const active = renderCommunity._activeInline;
      if (active && active.parentId === parentId) {
        closeActiveInlineReply();
        return;
      }
      closeActiveInlineReply();
      const selector = `[data-inline-reply="${escapeSelectorValue(parentId)}"]`;
      const container = list.querySelector(selector);
      if (!container) return;
      const mentionBase = authorName ? `@${authorName.replace(/\s+/g, ' ')} ` : '';
      const safeTopicId = escapeHtml(topicId);
      const safeParentId = escapeHtml(parentId);
      const safeMention = escapeHtml(mentionBase);
      container.innerHTML = `
        <form class="community-inline-reply form-reply" data-id="${safeTopicId}" data-parent-reply="${safeParentId}">
          <label class="sr-only" for="inline-reply-${safeParentId}">Réponse</label>
          <textarea id="inline-reply-${safeParentId}" name="content" rows="2">${safeMention}</textarea>
          <div class="community-inline-reply__actions">
            <button class="btn btn-secondary" type="submit">Envoyer</button>
          </div>
        </form>
      `;
      container.hidden = false;
      requestAnimationFrame(() => container.classList.add('is-open'));
      bindReplyForms(container);
      const textarea = container.querySelector('textarea');
      if (textarea) {
        if (!textarea.value) textarea.value = mentionBase;
        textarea.focus();
        const end = textarea.value.length;
        try { textarea.setSelectionRange(end, end); } catch {}
      }
      renderCommunity._activeInline = { parentId, topicId };
    };

    const deleteReply = async (button) => {
      if (!button || button.dataset.busy === '1') return;
      const replyId = button.getAttribute('data-del-reply');
      const topicId = button.getAttribute('data-topic-id');
      if (!replyId || !topicId) return;
      if (!confirm('Supprimer ce commentaire ?')) return;
      button.dataset.busy = '1';
      button.disabled = true;
      try {
        let deleted = false;
        let errorMessage = '';
        if (useRemote()) {
          if (isAnonProfile()) {
            const anonCode = getActiveAnonCode() || getStoredAnonCode();
            if (!anonCode) throw new Error('Code unique manquant');
            const replyPayload = { reply_id: replyId, anon_code: anonCode };
            console.debug('[Delete Debug] Payload envoyé vers anon-community:', replyPayload);
            const res = await anonCommunityRequest('delete-reply', { payload: replyPayload });
            if (res && res.reply_id) {
              deleted = true;
              console.debug('[Delete Debug] Commentaire supprimé avec succès ✅', replyId);
            } else {
              errorMessage = res?.error || 'Suppression impossible.';
            }
          } else {
            const uid = getActiveProfileId();
            if (!uid) throw new Error('Pas de user_id');
            const { data, error } = await supabase
              .from('forum_replies')
              .delete()
              .eq('id', replyId)
              .eq('user_id', uid)
              .select();
            if (error) {
              errorMessage = error.message || 'Suppression impossible.';
            } else if (Array.isArray(data) && data.length) {
              deleted = true;
            } else {
              errorMessage = 'Suppression impossible.';
            }
          }
        } else {
          const forum = store.get(K.forum);
          const topic = forum.topics.find((item) => String(item.id) === String(topicId));
          if (topic && Array.isArray(topic.replies)) {
            const initialLength = topic.replies.length;
            topic.replies = topic.replies.filter((reply) => String(reply.id) !== String(replyId));
            if (topic.replies.length !== initialLength) {
              store.set(K.forum, forum);
              deleted = true;
            }
          }
        }
        if (!deleted && errorMessage) throw new Error(errorMessage);
        if (deleted) {
          const selector = `[data-reply-id="${escapeSelectorValue(replyId)}"]`;
          const replyEl = list.querySelector(selector);
          const finalizeRemoval = () => {
            if (renderCommunity._activeInline && renderCommunity._activeInline.parentId === replyId) {
              closeActiveInlineReply();
            }
            handleReplyDeleted(topicId, replyId);
          };
          if (replyEl) {
            replyEl.style.transition = replyEl.style.transition ? `${replyEl.style.transition}, opacity .25s ease` : 'opacity .25s ease';
            replyEl.style.opacity = '0';
            window.setTimeout(() => {
              replyEl.remove();
              finalizeRemoval();
            }, 260);
          } else {
            finalizeRemoval();
          }
        }
      } catch (error) {
        console.error('deleteReply failed', error);
        alert(error?.message || 'Suppression impossible pour le moment.');
      } finally {
        button.dataset.busy = '0';
        button.disabled = false;
      }
    };

    const refreshBtn = $('#btn-refresh-community');
    const setRefreshVisible = (visible) => {
      if (!refreshBtn) return;
      const show = !!visible;
      if (!refreshBtn.dataset.defaultDisplay && typeof window !== 'undefined') {
        try {
          const computed = window.getComputedStyle(refreshBtn).display;
          refreshBtn.dataset.defaultDisplay = (computed && computed !== 'none') ? computed : 'inline-flex';
        } catch {
          refreshBtn.dataset.defaultDisplay = 'inline-flex';
        }
      }
      const defaultDisplay = refreshBtn.dataset.defaultDisplay || '';
      refreshBtn.style.display = show ? defaultDisplay : 'none';
      refreshBtn.setAttribute('aria-hidden', show ? 'false' : 'true');
    };
    setRefreshVisible(false);
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
            const uid = getActiveProfileId();
            forum.topics.push({ id, title: fullTitle, content, author: whoAmI, createdAt: Date.now(), replies: [], user_id: uid || null });
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
    const getActiveAnonCode = () => {
      if (!isAnonProfile()) return '';
      const raw = activeProfile?.code_unique;
      return raw ? String(raw).trim().toUpperCase() : '';
    };

    async function buildLikeRequestPayload(extra = {}) {
      const payload = { ...extra };
      if (isAnonProfile()) {
        const code = getActiveAnonCode();
        if (!code) throw new Error('Code unique requis');
        payload.code = code;
      }
      return payload;
    }

    async function fetchReplyLikesByIds(replyIds = []) {
      if (!useRemote()) return new Map();
      const ids = Array.from(
        new Set(
          (Array.isArray(replyIds) ? replyIds : [])
            .map((value) => (value != null ? String(value).trim() : ''))
            .filter(Boolean)
        )
      );
      if (!ids.length) return new Map();
      try {
        const payload = await buildLikeRequestPayload({ replyIds: ids });
        const data = await callEdgeFunction('likes-get', { body: payload });
        const map = new Map();
        if (data && typeof data === 'object') {
          Object.entries(data).forEach(([key, value]) => {
            const id = key != null ? String(key) : '';
            if (!id) return;
            const count = Number(value?.count ?? 0);
            const liked = !!value?.liked;
            map.set(id, {
              count: Number.isFinite(count) ? count : 0,
              liked,
            });
          });
        }
        ids.forEach((id) => {
          if (!map.has(id)) {
            map.set(id, { count: 0, liked: false });
          }
        });
        return map;
      } catch (err) {
        console.warn('fetchReplyLikes failed', err);
        return new Map();
      }
    }

    function buildLikeButton(replyId, state) {
      if (!replyId) return '';
      const current = state || communityLikes.get(replyId) || { count: 0, liked: false };
      const countRaw = Number(current.count ?? 0);
      const count = Number.isFinite(countRaw) ? countRaw : 0;
      const liked = !!current.liked;
      const classList = ['btn', 'btn-ghost', 'btn-like'];
      if (liked) classList.push('btn-like--active');
      const label = liked ? 'Retirer le like' : 'Aimer cette réponse';
      return `
        <button type="button"
                class="${classList.join(' ')}"
                data-like-reply="${escapeHtml(replyId)}"
                data-liked="${liked ? '1' : '0'}"
                aria-pressed="${liked ? 'true' : 'false'}"
                aria-label="${escapeHtml(label)}"
                title="${escapeHtml(label)}">
          <span class="btn-like__icon" aria-hidden="true">👍</span>
          <span class="btn-like__count" data-like-count>${count}</span>
        </button>
      `.trim();
    }

    const COMMUNITY_INLINE_REPLY_KEY = 'communityNestedReplies';
    const COMMUNITY_NESTED_OPEN_KEY = 'communityNestedOpen';
    let cachedNestedReplies = null;
    let nestedRepliesLoaded = false;
    let cachedNestedOpen = null;
    let nestedOpenLoaded = false;

    const loadNestedReplies = () => {
      if (!nestedRepliesLoaded) {
        cachedNestedReplies = new Map();
        if (typeof sessionStorage !== 'undefined') {
          try {
            const raw = sessionStorage.getItem(COMMUNITY_INLINE_REPLY_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object') {
                Object.entries(parsed).forEach(([topicId, parents]) => {
                  const topicMap = new Map();
                  if (parents && typeof parents === 'object') {
                    Object.entries(parents).forEach(([parentId, children]) => {
                      if (Array.isArray(children) && children.length) {
                        topicMap.set(parentId, new Set(children.map(String)));
                      }
                    });
                  }
                  if (topicMap.size) cachedNestedReplies.set(topicId, topicMap);
                });
              }
            }
          } catch {}
        }
        nestedRepliesLoaded = true;
      }
      return cachedNestedReplies;
    };

    const persistNestedReplies = () => {
      if (!nestedRepliesLoaded || !cachedNestedReplies || typeof sessionStorage === 'undefined') {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem(COMMUNITY_INLINE_REPLY_KEY);
        }
        return;
      }
      const payload = {};
      cachedNestedReplies.forEach((topicMap, topicId) => {
        const topicEntries = {};
        topicMap.forEach((childSet, parentId) => {
          if (childSet.size) topicEntries[parentId] = Array.from(childSet);
        });
        if (Object.keys(topicEntries).length) payload[topicId] = topicEntries;
      });
      if (Object.keys(payload).length) sessionStorage.setItem(COMMUNITY_INLINE_REPLY_KEY, JSON.stringify(payload));
      else sessionStorage.removeItem(COMMUNITY_INLINE_REPLY_KEY);
    };

    const getTopicNestedReplies = (topicId) => {
      const store = loadNestedReplies();
      const key = String(topicId);
      let topicMap = store.get(key);
      if (!topicMap) {
        topicMap = new Map();
        store.set(key, topicMap);
      }
      return topicMap;
    };

    const sanitizeNestedRepliesForTopic = (topicId, validIds) => {
      const topicMap = getTopicNestedReplies(topicId);
      let changed = false;
      topicMap.forEach((childSet, parentId) => {
        if (!validIds.has(parentId)) {
          topicMap.delete(parentId);
          changed = true;
          return;
        }
        const filtered = Array.from(childSet).filter((id) => validIds.has(id));
        if (filtered.length !== childSet.size) {
          if (filtered.length) topicMap.set(parentId, new Set(filtered));
          else topicMap.delete(parentId);
          changed = true;
        }
      });
      if (changed) persistNestedReplies();
      return topicMap;
    };

    const registerNestedReply = (topicId, parentReplyId, replyId) => {
      if (!parentReplyId || !replyId) return;
      const topicMap = getTopicNestedReplies(topicId);
      const parentKey = String(parentReplyId);
      const childKey = String(replyId);
      let childSet = topicMap.get(parentKey);
      if (!childSet) {
        childSet = new Set();
        topicMap.set(parentKey, childSet);
      }
      childSet.add(childKey);
      topicMap.forEach((set, key) => {
        if (key !== parentKey) set.delete(childKey);
        if (!set.size) topicMap.delete(key);
      });
      persistNestedReplies();
      ensureNestedOpen(topicId, parentReplyId, true);
    };

    const sanitizeNestedOpenForTopic = (topicId, validParents) => {
      const set = getTopicNestedOpen(topicId);
      let changed = false;
      Array.from(set).forEach((parentId) => {
        if (!validParents.has(parentId)) {
          set.delete(parentId);
          changed = true;
        }
      });
      if (changed) persistNestedOpen();
      return set;
    };

    const loadNestedOpen = () => {
      if (!nestedOpenLoaded) {
        cachedNestedOpen = new Map();
        if (typeof sessionStorage !== 'undefined') {
          try {
            const raw = sessionStorage.getItem(COMMUNITY_NESTED_OPEN_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object') {
                Object.entries(parsed).forEach(([topicId, parents]) => {
                  if (Array.isArray(parents) && parents.length) {
                    cachedNestedOpen.set(topicId, new Set(parents.map(String)));
                  }
                });
              }
            }
          } catch {}
        }
        nestedOpenLoaded = true;
      }
      return cachedNestedOpen;
    };

    const persistNestedOpen = () => {
      if (!nestedOpenLoaded || !cachedNestedOpen || typeof sessionStorage === 'undefined') {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem(COMMUNITY_NESTED_OPEN_KEY);
        }
        return;
      }
      const payload = {};
      cachedNestedOpen.forEach((set, topicId) => {
        if (set && set.size) payload[topicId] = Array.from(set);
      });
      if (Object.keys(payload).length) sessionStorage.setItem(COMMUNITY_NESTED_OPEN_KEY, JSON.stringify(payload));
      else sessionStorage.removeItem(COMMUNITY_NESTED_OPEN_KEY);
    };

    const getTopicNestedOpen = (topicId) => {
      const store = loadNestedOpen();
      const key = String(topicId);
      let openSet = store.get(key);
      if (!openSet) {
        openSet = new Set();
        store.set(key, openSet);
      }
      return openSet;
    };

    const ensureNestedOpen = (topicId, parentReplyId, open) => {
      if (!parentReplyId) return;
      const set = getTopicNestedOpen(topicId);
      const key = String(parentReplyId);
      if (open) {
        if (!set.has(key)) {
          set.add(key);
          persistNestedOpen();
        }
      } else if (set.has(key)) {
        set.delete(key);
        persistNestedOpen();
      }
    };

    const toggleNestedOpen = (topicId, parentReplyId) => {
      if (!parentReplyId) return false;
      const set = getTopicNestedOpen(topicId);
      const key = String(parentReplyId);
      let isOpen;
      if (set.has(key)) {
        set.delete(key);
        isOpen = false;
      } else {
        set.add(key);
        isOpen = true;
      }
      persistNestedOpen();
      return isOpen;
    };

    const removeNestedReplyMapping = (topicId, replyId) => {
      if (!replyId) return;
      const topicMap = getTopicNestedReplies(topicId);
      const key = String(replyId);
      let changed = false;
      if (topicMap.delete(key)) changed = true;
      topicMap.forEach((set, parentId) => {
        if (set.delete(key)) changed = true;
        if (!set.size) {
          topicMap.delete(parentId);
          changed = true;
        }
      });
      if (changed) persistNestedReplies();
      const openSet = getTopicNestedOpen(topicId);
      if (openSet.delete(key)) persistNestedOpen();
    };

    function updateLikeButton(button, state) {
      if (!button) return;
      const liked = !!state?.liked;
      const countRaw = Number(state?.count ?? 0);
      const count = Number.isFinite(countRaw) ? countRaw : 0;
      button.dataset.liked = liked ? '1' : '0';
      button.setAttribute('aria-pressed', liked ? 'true' : 'false');
      const label = liked ? 'Retirer le like' : 'Aimer cette réponse';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.classList.toggle('btn-like--active', liked);
      const countTarget = button.querySelector('[data-like-count]');
      if (countTarget) countTarget.textContent = String(count);
    }

    async function toggleReplyLike(button) {
      if (!button || button.dataset.busy === '1') return;
      if (!useRemote()) {
        alert('Connectez-vous pour aimer cette réponse.');
        return;
      }
      const replyId = button.getAttribute('data-like-reply');
      if (!replyId) return;
      const current = communityLikes.get(replyId) || { count: 0, liked: false };
      const action = current.liked ? 'remove' : 'add';
      let payload;
      try {
        payload = await buildLikeRequestPayload({ replyId });
      } catch (err) {
        console.warn('toggleReplyLike build payload failed', err);
        alert('Connectez-vous pour aimer cette réponse.');
        return;
      }
      button.dataset.busy = '1';
      button.disabled = true;
      try {
        const endpoint = action === 'add' ? 'likes-add' : 'likes-remove';
        const data = await callEdgeFunction(endpoint, { body: payload });
        const countRaw = Number(data?.count ?? 0);
        const normalized = {
          count: Number.isFinite(countRaw) ? countRaw : 0,
          liked: !!data?.liked,
        };
        communityLikes.set(replyId, normalized);
        updateLikeButton(button, normalized);
      } catch (err) {
        console.error('toggleReplyLike failed', err);
        alert(err?.message || 'Action impossible pour le moment.');
      } finally {
        button.dataset.busy = '0';
        button.disabled = false;
      }
    }

    const handleReplyInserted = (topicId, replyRecord, parentReplyId) => {
      const replyId = replyRecord?.id != null ? String(replyRecord.id) : null;
      if (parentReplyId && replyId) {
        registerNestedReply(topicId, parentReplyId, replyId);
      }
      renderCommunity._activeInline = null;
      renderCommunity();
    };

    const handleReplyDeleted = (topicId, replyId) => {
      removeNestedReplyMapping(topicId, replyId);
      renderCommunity();
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
            const parentReplyId = currentForm.getAttribute('data-parent-reply') || '';
            const fd = new FormData(currentForm);
            const rawContent = fd.get('content');
            const content = rawContent == null ? '' : rawContent.toString().trim();
            if (!content) return;
            if (useRemote()) {
              try {
                if (isAnonProfile()) {
                  const anonCode = getActiveAnonCode() || getStoredAnonCode();
                  const replyPayload = {
                    topicId: id,
                    content,
                    anon_code: anonCode,
                  };
                  const res = await anonCommunityRequest('reply', { payload: replyPayload });
                  handleReplyInserted(id, res?.reply || null, parentReplyId);
                  return;
                }
                const uid = getActiveProfileId();
                if (!uid) { console.warn('Aucun user_id disponible pour forum_replies'); throw new Error('Pas de user_id'); }
                const { data: insertedRows, error } = await supabase
                  .from('forum_replies')
                  .insert([{ topic_id: id, user_id: uid, content }])
                  .select()
                  .single();
                if (error) throw error;
                handleReplyInserted(id, insertedRows, parentReplyId);
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
            const uid = getActiveProfileId();
            const anonCode = getActiveAnonCode() || getStoredAnonCode() || null;
            const localReply = {
              id: genId(),
              topic_id: id,
              user_id: uid || null,
              content,
              created_at: new Date().toISOString(),
              author: whoAmI,
              anon_code: anonCode,
            };
            topic.replies.push(localReply);
            store.set(K.forum, forum);
            handleReplyInserted(id, localReply, parentReplyId);
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
        const authorMeta = { name: raw, childCount: null, showChildCount: null, parentBadge: null };
        console.debug('normalizeAuthorMeta', {
          id: null,
          showChildCount: authorMeta.showChildCount,
          childCount: authorMeta.childCount,
        });
        return authorMeta;
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
        let showChildCount = null;
        if (rawShow === undefined || rawShow === null) {
          showChildCount = null;
        } else if (typeof rawShow === 'string') {
          showChildCount = rawShow === 'true';
        } else {
          showChildCount = !!rawShow;
        }
        let badgeCandidate = raw.parentBadge ?? raw.parent_badge ?? null;
        if (Array.isArray(badgeCandidate)) {
          const normalized = normalizeParentBadges(badgeCandidate);
          badgeCandidate = highestUnlockedParentBadge(normalized);
        }
        const parentBadge = normalizeParentBadgeSummary(badgeCandidate) || null;
        const authorMeta = { name: name || 'Utilisateur', childCount, showChildCount, parentBadge };
        console.debug('normalizeAuthorMeta', {
          id: raw.id ?? null,
          showChildCount: authorMeta.showChildCount,
          childCount: authorMeta.childCount,
        });
        return authorMeta;
      }
      return null;
    };

    const resolveLocalChildCount = () => {
      if (Array.isArray(settingsState.children) && settingsState.children.length) {
        return settingsState.children.length;
      }
      try {
        const storedChildren = store.get(K.children, []);
        if (Array.isArray(storedChildren) && storedChildren.length) {
          return storedChildren.length;
        }
      } catch {
        /* ignore */
      }
      if (Array.isArray(settingsState.children)) {
        return settingsState.children.length;
      }
      return null;
    };

    const resolveLocalShowChildrenPref = () => {
      if (settingsState.privacy && settingsState.privacy.showStats != null) {
        return !!settingsState.privacy.showStats;
      }
      if (activeProfile && Object.prototype.hasOwnProperty.call(activeProfile, 'show_children_count')) {
        return !!activeProfile.show_children_count;
      }
      try {
        const storedPrivacy = store.get(K.privacy, {});
        if (storedPrivacy && storedPrivacy.showStats != null) {
          return !!storedPrivacy.showStats;
        }
      } catch {
        /* ignore */
      }
      return null;
    };

    const normalizeAuthorMetaForId = (raw, profileId) => {
      const normalized = normalizeAuthorMeta(raw) || { name: 'Utilisateur', childCount: null, showChildCount: null };
      const activeId = getActiveProfileId();
      const profileIdStr = profileId != null ? String(profileId) : '';
      const activeIdStr = activeId != null ? String(activeId) : '';
      const isSelf = profileIdStr && activeIdStr && profileIdStr === activeIdStr;
      const rawFullName =
        raw && typeof raw === 'object'
          ? raw.full_name ?? raw.fullName ?? raw.name ?? ''
          : '';
      const sanitizedFullName = typeof rawFullName === 'string' ? rawFullName.trim() : '';
      const normalizedName = sanitizedFullName || normalized.name || 'Utilisateur';
      const authorMeta = {
        ...normalized,
        name: normalizedName,
        fullName: sanitizedFullName,
      };
      if (isSelf) {
        const localCount = resolveLocalChildCount();
        if (
          Number.isFinite(localCount)
          && (localCount > 0 || !Number.isFinite(authorMeta.childCount))
        ) {
          authorMeta.childCount = Math.max(0, Math.trunc(localCount));
        }
        const localShow = resolveLocalShowChildrenPref();
        if (localShow != null) {
          authorMeta.showChildCount = localShow;
        }
      }
      return {
        ...authorMeta,
        profileId: profileIdStr || null,
        isSelf,
      };
    };

    const enrichAuthorsMapWithProfiles = async (map, anonCode) => {
      if (!(map instanceof Map) || !map.size) return;
      const missing = [];
      map.forEach((value, key) => {
        const normalized = normalizeAuthorMetaForId(value, key);
        if (!normalized) return;
        map.set(String(key), normalized);
        console.debug('enrichAuthorsMapWithProfiles check', {
          id: normalized.profileId || String(key),
          showChildCount: normalized.showChildCount,
        });
        if (
          (normalized.showChildCount === true || normalized.showChildCount === null)
          && !Number.isFinite(normalized.childCount)
        ) {
          missing.push(String(key));
        }
      });
      if (!missing.length) return;
      const payload = { ids: missing.slice(0, 200) };
      const isAnon = typeof anonCode === 'string' && anonCode.trim().length > 0;
      if (isAnon) {
        const normalizedCode = anonCode.trim().toUpperCase();
        payload.anonCode = normalizedCode;
        payload.code = normalizedCode;
      }
      try {
        const data = await callEdgeFunction('profiles-by-ids', {
          body: payload,
          includeAuth: !isAnon,
        });
        const profiles = data?.profiles;
        if (!Array.isArray(profiles) || !profiles.length) return;
        profiles.forEach((profile) => {
          const id = profile?.id != null ? String(profile.id) : '';
          if (!id || !map.has(id)) return;
          const entry = normalizeAuthorMetaForId(profile, id);
          if (!entry) return;
          map.set(id, entry);
        });
      } catch (err) {
        console.warn('enrichAuthorsMapWithProfiles failed', err);
      }
    };

    const renderTopics = (topics, replies, authorsMap, replyLikes = new Map()) => {
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
      const buildTopicPreview = (text, maxLength = 240) => {
        const plain = (text == null ? '' : String(text))
          .replace(/\r?\n+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!plain) return '';
        if (plain.length <= maxLength) return escapeHtml(plain);
        return escapeHtml(plain.slice(0, maxLength).trim()) + '...';
      };
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
      const renderAuthorBadgeInline = (meta) => {
        if (!meta) return '';
        const normalized = (typeof meta === 'object' && meta !== null && Object.prototype.hasOwnProperty.call(meta, 'parentBadge'))
          ? meta
          : normalizeAuthorMeta(meta);
        if (!normalized) return '';
        const badge = normalized.parentBadge;
        if (!badge || !badge.isUnlocked) return '';
        const profileIdRaw = normalized.profileId != null ? String(normalized.profileId).trim() : '';
        const profileAttr = profileIdRaw ? ` data-parent-profile="${escapeHtml(profileIdRaw)}"` : '';
        const nameRaw = badge.name || '';
        const tooltipRaw = badge.tooltip || '';
        const ariaParts = [nameRaw, tooltipRaw].filter(Boolean).join(' – ');
        const ariaAttr = ariaParts ? ` aria-label="${escapeHtml(ariaParts)}"` : '';
        const titleValue = tooltipRaw || nameRaw;
        const titleAttr = titleValue ? ` title="${escapeHtml(titleValue)}"` : '';
        const iconHtml = badge.icon ? `<span class="author-parent-badge__icon" aria-hidden="true">${escapeHtml(badge.icon)}</span>` : '';
        const labelHtml = nameRaw ? `<span class="author-parent-badge__label">${escapeHtml(nameRaw)}</span>` : '';
        return `<span class="author-parent-badge"${titleAttr}${ariaAttr}${profileAttr}>${iconHtml}${labelHtml}</span>`;
      };
      const renderAuthorMetaInfo = () => {
        // Child counts stay hidden in the community to leave room for the full badge label.
        return '';
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
      const resolveAuthorId = (item) => {
        if (!item || typeof item !== 'object') return null;
        const candidates = [
          item.user_id,
          item.userId,
          item.profile_id,
          item.profileId,
          item.author_id,
          item.authorId,
        ];
        for (const candidate of candidates) {
          if (candidate == null) continue;
          const str = String(candidate).trim();
          if (str) return str;
        }
        return null;
      };
      const likesMap = replyLikes instanceof Map ? replyLikes : new Map();
      const renderThreadEntry = ({
        authorName,
        authorMetaHtml,
        authorBadgeHtml = '',
        profileId = null,
        initials,
        timeLabel,
        timeIso,
        contentHtml,
        messageBtn,
        actions = [],
        label,
        isAi,
        isSelf,
        isInitial,
      }) => {
        const highlight = !!(isAi || isSelf);
        const safeInitials = escapeHtml(initials || '✦');
        const safeAuthor = escapeHtml(authorName || 'Anonyme');
        const badgeInline = authorBadgeHtml ? authorBadgeHtml.trim() : '';
        const profileIdRaw = profileId != null ? String(profileId).trim() : '';
        const previewAttr = profileIdRaw ? ` data-parent-profile="${escapeHtml(profileIdRaw)}"` : '';
        const avatarAttr = profileIdRaw ? ` data-parent-profile="${escapeHtml(profileIdRaw)}"` : '';
        const hasLabel = label != null && String(label).trim() !== '';
        const fallbackLabel = escapeHtml(
          isAi ? `Réponse de ${authorName}` : `Commentaire de ${authorName}`
        );
        const safeLabel = hasLabel ? escapeHtml(String(label).trim()) : fallbackLabel;
        const shouldDisplayLabel = hasLabel || !isInitial;
        const timeHtml = timeLabel
          ? `<time datetime="${escapeHtml(timeIso || '')}">${escapeHtml(timeLabel)}</time>`
          : '';
        const actionItems = [];
        if (messageBtn) actionItems.push(messageBtn);
        if (Array.isArray(actions) && actions.length) {
          actions.forEach((item) => { if (item) actionItems.push(item); });
        }
        const actionsHtml = actionItems.length
          ? `<div class="topic-entry__actions">${actionItems.join('')}</div>`
          : '';
        let entryClass = 'topic-entry';
        if (highlight) entryClass += ' topic-entry--highlight';
        if (isAi) entryClass += ' topic-entry--ai';
        if (isSelf) entryClass += ' topic-entry--self';
        if (isInitial) entryClass += ' topic-entry--origin';
        if (isInitial) {
          return `
            <article class="${entryClass}">
              <div class="topic-entry__head">
                <div class="topic-entry__avatar" aria-hidden="true"${avatarAttr}>${safeInitials}</div>
                <div class="topic-entry__meta">
                  <div class="topic-entry__author">
                    <span class="topic-entry__author-name"${previewAttr}>
                      <span class="author-name-text">${safeAuthor}</span>
                      ${badgeInline}
                    </span>
                    ${authorMetaHtml || ''}
                  </div>
                  ${timeHtml}
                </div>
              </div>
              <div class="topic-initial">
                ${shouldDisplayLabel ? `<span class="topic-initial__badge">${safeLabel}</span>` : ''}
                <div class="topic-initial__content">${contentHtml}</div>
              </div>
              ${actionsHtml}
            </article>
          `;
        }
        const noteClass = highlight ? 'timeline-ai-note' : 'timeline-parent-note';
        const labelClass = highlight ? 'timeline-ai-note__label' : 'timeline-parent-note__label';
        const textClass = highlight ? 'timeline-ai-note__text' : 'timeline-parent-note__text';
        return `
          <article class="${entryClass}">
            <div class="topic-entry__head">
              <div class="topic-entry__avatar" aria-hidden="true"${avatarAttr}>${safeInitials}</div>
              <div class="topic-entry__meta">
                <div class="topic-entry__author">
                  <span class="topic-entry__author-name"${previewAttr}>
                    <span class="author-name-text">${safeAuthor}</span>
                    ${badgeInline}
                  </span>
                  ${authorMetaHtml || ''}
                </div>
                ${timeHtml}
              </div>
            </div>
            <div class="${noteClass}">
              ${shouldDisplayLabel ? `<span class="${labelClass}">${safeLabel}</span>` : ''}
              <div class="${textClass}">${contentHtml}</div>
            </div>
            ${actionsHtml}
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
        el.className = 'topic community-topic';
        const authorMeta = authorsMap.get(String(t.user_id)) || authorsMap.get(t.user_id) || null;
        const normalizedAuthor = normalizeAuthorMetaForId(authorMeta, t.user_id);
        const rawAuthorName = (normalizedAuthor && normalizedAuthor.name)
          || (typeof authorMeta === 'string' ? authorMeta : authorMeta?.full_name || authorMeta?.name)
          || t.author
          || 'Anonyme';
        const topicProfileId = normalizedAuthor?.profileId ?? null;
        const rs = (replies.get(t.id) || []).slice().sort((a,b)=> timestampOf(a.created_at || a.createdAt) - timestampOf(b.created_at || b.createdAt));
        const tid = String(t.id);
        const isOpen = openSet.has(tid);
        const toggleLabel = isOpen ? 'Réduire la publication' : 'Afficher les commentaires';
        const repliesCount = rs.length;
        const toggleCount = repliesCount ? ` (${repliesCount})` : '';
        const isMobile = document.body.classList.contains('force-mobile');
        const { label: createdLabel, iso: createdIso } = formatDateParts(t.created_at || t.createdAt);
        const displayAuthor = formatAuthorName(rawAuthorName);
        const topicAuthorBadgeHtml = renderAuthorBadgeInline(normalizedAuthor || authorMeta);
        const topicAuthorPreviewAttr = topicProfileId ? ` data-parent-profile="${escapeHtml(String(topicProfileId))}"` : '';
        const topicAvatarAttr = topicProfileId ? ` data-parent-profile="${escapeHtml(String(topicProfileId))}"` : '';
        const initials = initialsFrom(rawAuthorName);
        const messageLabel = isMobile ? '💬' : '💬 Message privé';
        const messageAttrs = isMobile ? ' aria-label="Envoyer un message privé" title="Envoyer un message privé"' : ' title="Envoyer un message privé"';
        const topicMessageBtn = (!isMobile && t.user_id)
          ? `<a href="messages.html?user=${encodeURIComponent(String(t.user_id))}" class="btn btn-secondary btn-message"${messageAttrs}>${messageLabel}</a>`
          : '';
        const topicIsAi = isAiAuthor(displayAuthor);
        const topicOwnerId = resolveAuthorId(t);
        const topicIsSelf = activeId && topicOwnerId ? String(topicOwnerId) === String(activeId) : false;
        const fullContentHtml = normalizeContent(t.content);
        const topicBadgeLabel = topicIsAi
          ? 'Message de Ped’IA'
          : (topicIsSelf ? 'Votre publication' : '');
        const topicBadgeChip = topicBadgeLabel
          ? `<span class="community-topic-card__badge">${escapeHtml(topicBadgeLabel)}</span>`
          : '';
        const buildToggleButton = (extraClass = '') => {
          const classSuffix = extraClass ? ` ${extraClass}` : '';
          return `<button class="btn btn-secondary topic-toggle community-topic-card__toggle${classSuffix}"
            data-toggle-comments="${tid}"
            aria-expanded="${isOpen ? 'true' : 'false'}"
            data-label-open="Réduire la publication"
            data-label-closed="Afficher les commentaires"
            data-count="${repliesCount}">${toggleLabel}${toggleCount}</button>`;
        };
        const collapseButton = `<button type="button" class="topic-toggle community-topic-card__collapse" data-toggle-comments="${tid}" aria-expanded="${isOpen ? 'true' : 'false'}" data-label-open="Réduire la publication" data-label-closed="Afficher les commentaires" data-count="${repliesCount}">${toggleLabel}${toggleCount}</button>`;
        const storyBlock = `
          <div class="community-topic-card__story">
            <div class="community-topic-card__story-bar">
              ${topicBadgeChip || '<span class="community-topic-card__badge-placeholder" aria-hidden="true"></span>'}
              ${collapseButton}
            </div>
            ${fullContentHtml ? `<div class="community-topic-card__story-text">${fullContentHtml}</div>` : ''}
          </div>
        `;
        const repliesById = new Map();
        rs.forEach((reply) => {
          const key = reply?.id != null ? String(reply.id) : '';
          if (key) repliesById.set(key, reply);
        });
        const validReplyIds = new Set(repliesById.keys());
        const topicNestedMap = sanitizeNestedRepliesForTopic(tid, validReplyIds);
        const nestedChildIds = new Set();
        topicNestedMap.forEach((childSet) => childSet.forEach((childId) => nestedChildIds.add(childId)));
        const toggleableParents = new Set();
        topicNestedMap.forEach((childSet, parentId) => {
          if (childSet && childSet.size && !nestedChildIds.has(parentId)) {
            toggleableParents.add(String(parentId));
          }
        });
        const topicOpenSet = sanitizeNestedOpenForTopic(tid, toggleableParents);

        const renderReplyBlock = (reply, depth = 0) => {
          const replyMeta = authorsMap.get(String(reply.user_id)) || authorsMap.get(reply.user_id) || null;
          const normalizedReply = normalizeAuthorMetaForId(replyMeta, reply.user_id);
          const rawReplyAuthor = (normalizedReply && normalizedReply.name)
            || (typeof replyMeta === 'string' ? replyMeta : replyMeta?.full_name || replyMeta?.name)
            || reply.author
            || 'Anonyme';
          const replyProfileId = normalizedReply?.profileId ?? null;
          const replyAuthor = formatAuthorName(rawReplyAuthor);
          const replyAuthorMetaHtml = renderAuthorMetaInfo(normalizedReply || replyMeta);
          const replyAuthorBadgeHtml = renderAuthorBadgeInline(normalizedReply || replyMeta);
          const replyInitials = initialsFrom(rawReplyAuthor);
          const { iso: replyIso } = formatDateParts(reply.created_at || reply.createdAt);
          const replyMessageBtn = (!isMobile && reply.user_id)
            ? `<a href="messages.html?user=${encodeURIComponent(String(reply.user_id))}" class="btn btn-secondary btn-message btn-message--small"${messageAttrs}>${messageLabel}</a>`
            : '';
          const isReplyAi = isAiAuthor(replyAuthor);
          const replyOwnerId = resolveAuthorId(reply);
          const replyIsSelf = activeId && replyOwnerId ? String(replyOwnerId) === String(activeId) : false;
          const replyId = reply?.id != null ? String(reply.id) : '';
          if (replyId && !communityLikes.has(replyId)) {
            const fetched = likesMap.get(replyId);
            if (fetched) {
              const fetchedCount = Number(fetched.count ?? 0);
              communityLikes.set(replyId, {
                count: Number.isFinite(fetchedCount) ? fetchedCount : 0,
                liked: !!fetched.liked,
              });
            } else {
              communityLikes.set(replyId, { count: 0, liked: false });
            }
          }
          const replyButtonHtml = replyId
            ? `<button type="button" class="community-reply-button" data-reply-trigger="${escapeHtml(replyId)}" data-topic-id="${escapeHtml(tid)}" data-reply-author="${escapeHtml(replyAuthor)}">↩️ Répondre</button>`
            : '';
          const likeButton = replyId ? buildLikeButton(replyId, communityLikes.get(replyId)) : '';
          const replyActions = [];
          if (likeButton) replyActions.push(likeButton);
          if (replyButtonHtml) replyActions.push(replyButtonHtml);
          if (replyMessageBtn) replyActions.push(replyMessageBtn);
          const replyEntryHtml = renderThreadEntry({
            authorName: replyAuthor,
            authorMetaHtml: replyAuthorMetaHtml,
            authorBadgeHtml: replyAuthorBadgeHtml,
            initials: replyInitials,
            timeLabel: '',
            timeIso: replyIso,
            contentHtml: normalizeContent(reply.content),
            messageBtn: null,
            actions: replyActions,
            label: '',
            isAi: isReplyAi,
            isSelf: replyIsSelf,
            profileId: replyProfileId,
          });
          const deleteButtonHtml = (replyIsSelf && replyId)
            ? `<button type="button" class="btn btn-danger community-delete-reply" data-del-reply="${escapeHtml(replyId)}" data-topic-id="${escapeHtml(tid)}">Supprimer</button>`
            : '';
          const childSet = replyId ? topicNestedMap.get(replyId) : null;
          let childrenHtml = '';
          let nestedToggleHtml = '';
          if (childSet && childSet.size) {
            const allowToggle = toggleableParents.has(replyId);
            const orderedChildren = Array.from(childSet)
              .map((childId) => repliesById.get(childId))
              .filter(Boolean)
              .sort((a, b) => timestampOf(a.created_at || a.createdAt) - timestampOf(b.created_at || b.createdAt));
            const childrenContent = orderedChildren.map((child) => renderReplyBlock(child, depth + 1)).join('');
            if (allowToggle) {
              const isChildrenOpen = topicOpenSet.has(replyId);
              const toggleLabelBase = isChildrenOpen ? 'Réduire les réponses' : 'Afficher les réponses';
              const toggleSuffix = childSet.size ? ` (${childSet.size})` : '';
              nestedToggleHtml = `<button type="button" class="community-nested-toggle" data-toggle-nested="${escapeHtml(replyId)}" data-topic-id="${escapeHtml(tid)}" data-child-count="${childSet.size}">${escapeHtml(toggleLabelBase + toggleSuffix)}</button>`;
              const hiddenAttr = isChildrenOpen ? '' : ' hidden';
              const wrapperClass = `community-comment-children${isChildrenOpen ? ' is-open' : ''}`;
              childrenHtml = `<div class="${wrapperClass}" data-nested-children="${escapeHtml(replyId)}"${hiddenAttr}>${childrenContent}</div>`;
            } else {
              const wrapperClass = 'community-comment-children is-open';
              childrenHtml = `<div class="${wrapperClass}">${childrenContent}</div>`;
            }
          }
          const controlItems = [];
          if (nestedToggleHtml) controlItems.push(nestedToggleHtml);
          if (deleteButtonHtml) controlItems.push(deleteButtonHtml);
          const controlsHtml = controlItems.length ? `<div class="community-comment-controls">${controlItems.join('')}</div>` : '';
          const inlineContainer = replyId ? `<div class="community-reply-inline" data-inline-reply="${escapeHtml(replyId)}" hidden></div>` : '';
          const blockAttr = replyId
            ? ` data-reply-block="${escapeHtml(replyId)}" data-reply-id="${escapeHtml(replyId)}"`
            : '';
          return `
            <div class="community-comment-block${depth ? ' community-comment-block--nested' : ''}"${blockAttr}>
              ${replyEntryHtml}
              ${controlsHtml}
              ${inlineContainer}
              ${childrenHtml}
            </div>
          `;
        };

        const topLevelReplies = rs.filter((reply) => {
          const rid = reply?.id != null ? String(reply.id) : '';
          return !nestedChildIds.has(rid);
        });
        const repliesHtml = topLevelReplies.map((reply) => renderReplyBlock(reply, 0)).join('');
        const repliesBlock = repliesHtml
          ? `<div class="community-topic-card__comments">${repliesHtml}</div>`
          : '<p class="community-topic-card__empty">Aucune réponse pour le moment. Lancez la conversation !</p>';
        const commentsTitle = repliesCount
          ? `${repliesCount} ${repliesCount > 1 ? 'commentaires' : 'commentaire'}`
          : 'Commentaires';
        const commentsSection = `
          <div class="community-topic-card__comments-wrapper">
            <div class="community-topic-card__comments-header">${escapeHtml(commentsTitle)}</div>
            ${repliesBlock}
          </div>
        `;
        const dividerHtml = (fullContentHtml || repliesCount)
          ? '<div class="community-topic-card__divider" aria-hidden="true"></div>'
          : '';
        const previewText = buildTopicPreview(t.content);
        const deleteBtn = (activeId && String(t.user_id) === String(activeId)) ? `<div class="topic-manage"><button class="btn btn-danger" data-del-topic="${tid}">Supprimer le sujet</button></div>` : '';
        const bodyOpenClass = isOpen ? ' is-open' : '';
        const bodyAria = isOpen ? 'false' : 'true';
        el.setAttribute('data-open', isOpen ? '1' : '0');
        if (isOpen) el.classList.add('community-topic--open');
        const headerActions = [];
        if (topicMessageBtn) headerActions.push(topicMessageBtn);
        if (!isOpen) headerActions.push(buildToggleButton('community-topic-card__toggle--header'));
        const headerActionsHtml = headerActions.length
          ? `<div class="community-topic-card__header-actions">${headerActions.join('')}</div>`
          : '';
        el.innerHTML = `
          <article class="community-topic-card">
            <header class="community-topic-card__header">
              <div class="community-topic-card__identity">
                <div class="community-topic-card__avatar" aria-hidden="true"${topicAvatarAttr}>${escapeHtml(initials)}</div>
                <div class="community-topic-card__user">
                  <span class="community-topic-card__author"${topicAuthorPreviewAttr}>
                    <span class="author-name-text">${escapeHtml(displayAuthor)}</span>
                    ${topicAuthorBadgeHtml}
                  </span>
                  <div class="community-topic-card__meta">
                    ${createdLabel ? `<time datetime="${createdIso}">${escapeHtml(createdLabel)}</time>` : ''}
                    <span class="community-topic-card__category">${escapeHtml(cat)}</span>
                  </div>
                </div>
              </div>
              ${headerActionsHtml}
            </header>
            <div class="community-topic-card__content">
              <h3 class="community-topic-card__title">${escapeHtml(title)}</h3>
              ${previewText ? `<p class="community-topic-card__preview">${previewText}</p>` : ''}
            </div>
            <footer class="community-topic-card__footer">
              <div class="community-topic-card__footer-actions">
                ${buildToggleButton('community-topic-card__toggle--footer')}
              </div>
            </footer>
            <div class="topic-body community-topic-card__expanded${bodyOpenClass}" data-body="${tid}" aria-hidden="${bodyAria}">
              ${storyBlock}
              ${dividerHtml}
              ${commentsSection}
              <form data-id="${tid}" class="form-reply form-grid">
                <label>Réponse<textarea name="content" rows="2" required></textarea></label>
                <div class="topic-form-actions">
                  <button class="btn btn-secondary" type="submit">Répondre</button>
                </div>
              </form>
              ${deleteBtn}
            </div>
          </article>
        `;
        if (!isListActive()) return;
        list.appendChild(el);
      });
      bindReplyForms(list);
    };
    // Actions déléguées : pliage/dépliage et suppression (avec garde d’occupation)
    if (!list.dataset.delBound) {
      list.addEventListener('click', async (e)=>{
        const replyTrigger = e.target.closest('[data-reply-trigger]');
        if (replyTrigger) {
          e.preventDefault();
          openInlineReply(replyTrigger);
          return;
        }
        const nestedToggle = e.target.closest('[data-toggle-nested]');
        if (nestedToggle) {
          e.preventDefault();
          const parentId = nestedToggle.getAttribute('data-toggle-nested');
          const topicId = nestedToggle.getAttribute('data-topic-id');
          const childCount = Number(nestedToggle.getAttribute('data-child-count') || '0');
          if (!parentId || !topicId) return;
          const isOpen = toggleNestedOpen(topicId, parentId);
          const selector = `[data-nested-children="${escapeSelectorValue(parentId)}"]`;
          const container = list.querySelector(selector);
          if (container) {
            if (isOpen) {
              container.hidden = false;
              requestAnimationFrame(() => container.classList.add('is-open'));
            } else {
              container.classList.remove('is-open');
              container.hidden = true;
            }
          }
          const labelBase = isOpen ? 'Réduire les réponses' : 'Afficher les réponses';
          const suffix = childCount ? ` (${childCount})` : '';
          nestedToggle.textContent = labelBase + suffix;
          if (!isOpen && renderCommunity._activeInline && renderCommunity._activeInline.parentId === parentId) {
            closeActiveInlineReply();
          }
          return;
        }
        const deleteBtn = e.target.closest('[data-del-reply]');
        if (deleteBtn) {
          e.preventDefault();
          await deleteReply(deleteBtn);
          return;
        }
        const likeBtn = e.target.closest('[data-like-reply]');
        if (likeBtn) {
          e.preventDefault();
          await toggleReplyLike(likeBtn);
          return;
        }
        // Ouvrir/fermer le sujet
        const tgl = e.target.closest('[data-toggle-comments]');
        if (tgl) {
          e.preventDefault();
          closeActiveInlineReply();
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
            const toggles = Array.from(list.querySelectorAll(`[data-toggle-comments="${id}"]`));
            const applyState = (open) => {
              if (open) {
                body.classList.add('is-open');
                body.setAttribute('aria-hidden', 'false');
                openSet.add(id);
              } else {
                body.classList.remove('is-open');
                body.setAttribute('aria-hidden', 'true');
                openSet.delete(id);
              }
              toggles.forEach((btn) => {
                btn.setAttribute('aria-expanded', open ? 'true' : 'false');
                btn.textContent = (open ? labelOpen : labelClosed) + suffix;
              });
              if (topic) {
                topic.setAttribute('data-open', open ? '1' : '0');
                topic.classList.toggle('community-topic--open', open);
              }
            };
            applyState(!isOpen);
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
            const { error } = await supabase
              .from('forum_topics')
              .delete()
              .eq('id', id)
              .eq('user_id', uid);
            if (error) throw error;
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
              const entry = normalizeAuthorMetaForId(value, id) || {
                name: (value == null ? '' : String(value)) || 'Utilisateur',
                childCount: null,
                showChildCount: false,
              };
              authorsMap.set(String(id), entry);
            });
            await enrichAuthorsMapWithProfiles(authorsMap, getActiveAnonCode());
            await attachParentBadgesToAuthors(authorsMap);
            const repliesMap = new Map();
            const replyIds = [];
            repliesArr.forEach((r) => {
              if (!r || !r.topic_id) return;
              const key = String(r.topic_id);
              const arr = repliesMap.get(key) || [];
              arr.push(r);
              repliesMap.set(key, arr);
              if (r?.id != null) {
                const rid = String(r.id);
                if (rid) replyIds.push(rid);
              }
            });
            const likesMap = await fetchReplyLikesByIds(replyIds);
            communityLikes.clear();
            if (likesMap.size) {
              likesMap.forEach((value, key) => {
                const countRaw = Number(value?.count ?? 0);
                communityLikes.set(String(key), {
                  count: Number.isFinite(countRaw) ? countRaw : 0,
                  liked: !!value?.liked,
                });
              });
            }
            renderTopics(topics, repliesMap, authorsMap, likesMap);
            return;
          }
          const uid = getActiveProfileId();
          if (!uid) {
            console.warn('Aucun user_id disponible pour forum_topics/forum_replies/profiles (fetch)');
            const forum = store.get(K.forum, { topics: [] });
            const repliesMap = new Map();
            forum.topics.forEach((t) => repliesMap.set(t.id, t.replies || []));
            const authors = new Map();
            renderTopics(forum.topics.slice().reverse(), repliesMap, authors, new Map());
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
              const buildProfileEntry = (profile, explicitId) => {
                const fallbackName = profile?.full_name || profile?.name || 'Utilisateur';
                const rawMeta = {
                  name: fallbackName,
                  child_count:
                    profile?.child_count ?? profile?.children_count ?? profile?.childrenCount ?? null,
                  show_children_count:
                    profile?.show_children_count ??
                    profile?.showChildCount ??
                    profile?.show_stats ??
                    profile?.showStats ??
                    null,
                };
                const profileId = explicitId != null ? String(explicitId) : profile?.id != null ? String(profile.id) : '';
                return normalizeAuthorMetaForId(rawMeta, profileId);
              };
              try {
                const { data: rows, error: viewError } = await supabase
                  .from('profiles_with_children')
                  .select('id,full_name,children_count,show_children_count')
                  .in('id', idArray);
                if (!viewError && Array.isArray(rows) && rows.length) {
                  const entries = rows
                    .map((row) => {
                      const id = row?.id != null ? String(row.id) : '';
                      if (!id) return null;
                      return [id, buildProfileEntry(row, id)];
                    })
                    .filter(Boolean);
                  const missingIds = entries
                    .filter(([, entry]) => entry.showChildCount && !Number.isFinite(entry.childCount))
                    .map(([id]) => id);
                  if (missingIds.length) {
                    try {
                      const payload = await callEdgeFunction('profiles-by-ids', { body: { ids: missingIds } });
                      if (payload?.profiles) {
                        const fallbackMap = new Map(
                          payload.profiles
                            .map((profile) => {
                              const pid = profile?.id != null ? String(profile.id) : '';
                              if (!pid) return null;
                              return [pid, buildProfileEntry(profile, pid)];
                            })
                            .filter(Boolean)
                        );
                        if (fallbackMap.size) {
                          const missingSet = new Set(missingIds);
                          entries.forEach((pair, index) => {
                            const [id, entry] = pair;
                            if (!missingSet.has(id)) return;
                            const fallbackEntry = fallbackMap.get(id);
                            if (!fallbackEntry) return;
                            entries[index] = [
                              id,
                              {
                                ...entry,
                                childCount: Number.isFinite(fallbackEntry.childCount)
                                  ? fallbackEntry.childCount
                                  : entry.childCount,
                                showChildCount:
                                  fallbackEntry.showChildCount != null
                                    ? fallbackEntry.showChildCount
                                    : entry.showChildCount,
                              },
                            ];
                          });
                        }
                      }
                    } catch (err) {
                      console.warn('profiles-by-ids enrichment failed', err);
                    }
                  }
                  return new Map(entries);
                }
                if (viewError) throw viewError;
              } catch (err) {
                console.warn('profiles_with_children fetch failed', err);
              }
              try {
                const payload = await callEdgeFunction('profiles-by-ids', { body: { ids: idArray } });
                if (payload?.profiles) {
                  const entries = payload.profiles
                    .map((profile) => {
                      const id = profile?.id != null ? String(profile.id) : '';
                      if (!id) return null;
                      return [id, buildProfileEntry(profile, id)];
                    })
                    .filter(Boolean);
                  if (entries.length) {
                    return new Map(entries);
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
                    return [
                      id,
                      buildProfileEntry(
                        {
                          id: profile.id,
                          full_name: profile.full_name,
                          child_count: counts.get(id) ?? null,
                          show_children_count: profile.show_children_count,
                        },
                        id
                      ),
                    ];
                  })
                  .filter(Boolean)
              );
            };
            authorsMap = await withRetry(() => loadCommunityProfiles());
          }
          await enrichAuthorsMapWithProfiles(authorsMap, getActiveAnonCode());
          await attachParentBadgesToAuthors(authorsMap);
          const repliesMap = new Map();
          const replyIds = [];
          replies.forEach((reply) => {
            const key = reply?.topic_id != null ? String(reply.topic_id) : '';
            if (!key) return;
            const arr = repliesMap.get(key) || [];
            arr.push(reply);
            repliesMap.set(key, arr);
            if (reply?.id != null) {
              const rid = String(reply.id);
              if (rid) replyIds.push(rid);
            }
          });
          const likesMap = await fetchReplyLikesByIds(replyIds);
          communityLikes.clear();
          if (likesMap.size) {
            likesMap.forEach((value, key) => {
              const countRaw = Number(value?.count ?? 0);
              communityLikes.set(String(key), {
                count: Number.isFinite(countRaw) ? countRaw : 0,
                liked: !!value?.liked,
              });
            });
          }
          renderTopics(topics, repliesMap, authorsMap, likesMap);
          setRefreshVisible(false);
        } catch (e) {
          console.error('renderCommunity load failed', e);
          showEmpty();
          showError('Impossible de charger la communauté. Vérifiez votre connexion ou réessayez plus tard.');
          setRefreshVisible(true);
        }
      })();
    } else {
      const forum = store.get(K.forum, { topics: [] });
      const repliesMap = new Map();
      forum.topics.forEach(t=> repliesMap.set(t.id, t.replies||[]));
      const authors = new Map();
      renderTopics(forum.topics.slice().reverse(), repliesMap, authors, new Map());
      setRefreshVisible(false);
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
  function escapeAttribute(value){
    if (value == null) return '';
    const str = typeof value === 'string' ? value : String(value);
    return str.replace(/[&<>"'`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;','`':'&#96;'}[c]));
  }
  function renderParentBadges(badges = []) {
    const list = Array.isArray(badges) ? badges : [];
    if (!list.length) return '';
    const lockIcon = '<div class="badge-lock" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><use xlink:href="#icon-lock" href="#icon-lock"></use></svg></div>';
    return list
      .map((badge) => {
        if (!badge || typeof badge !== 'object') return '';
        const stateClass = badge.isUnlocked ? 'badge-unlocked' : 'badge-locked';
        const safeLabel = escapeHtml(badge.name || `Badge niveau ${badge.level || ''}`);
        const safeDescription = escapeHtml(badge.tooltip || '');
        const safeIcon = escapeHtml(badge.icon || '✨');
        const ariaParts = [
          `Badge ${badge.name || badge.level || ''}`.trim(),
          badge.isUnlocked ? 'débloqué' : 'verrouillé',
          badge.tooltip || '',
        ].filter(Boolean);
        const ariaLabel = ariaParts.join(' – ');
        return `
          <div class="badge ${stateClass} parent-badge" role="listitem" tabindex="0" aria-label="${escapeHtml(ariaLabel)}" data-level="${escapeHtml(String(badge.level ?? ''))}">
            <div class="badge-icon" aria-hidden="true">
              <span class="badge-emoji">${safeIcon}</span>
            </div>
            <div class="badge-label-group">
              <div class="badge-label">${safeLabel}</div>
              ${safeDescription ? `<div class="badge-description">${safeDescription}</div>` : ''}
            </div>
            ${badge.isUnlocked ? '' : lockIcon}
          </div>
        `;
      })
      .join('');
  }

  function renderDashboardBadges(milestones){
    const safeMilestones = Array.isArray(milestones) ? milestones : [];
    return DASHBOARD_BADGES.map((badge) => {
      const questionIndex = DEV_QUESTION_INDEX_BY_KEY.get(badge.key);
      const isUnlocked = typeof questionIndex === 'number' && !!safeMilestones[questionIndex];
      const tooltipLabel = `${badge.label} • ${badge.milestoneLabel}`;
      const stateClass = isUnlocked ? 'badge-unlocked' : 'badge-locked';
      const accessibilityLabel = `Badge ${badge.label} – ${isUnlocked ? 'débloqué' : 'verrouillé'} (${badge.milestoneLabel})`;
      const lockIcon = '<div class="badge-lock" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><use xlink:href="#icon-lock" href="#icon-lock"></use></svg></div>';
      return `
        <div class="badge ${stateClass}" role="listitem" tabindex="0" data-tooltip="${escapeHtml(tooltipLabel)}" aria-label="${escapeHtml(accessibilityLabel)}">
          <div class="badge-icon" aria-hidden="true">
            <span class="badge-emoji">${escapeHtml(badge.icon)}</span>
          </div>
          <div class="badge-label">${escapeHtml(badge.label)}</div>
          ${isUnlocked ? '' : lockIcon}
        </div>
      `;
    }).join('');
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
    const latestMeasurement = getLatestMeasurementEntry(measures);
    const latestHeight = Number.isFinite(latestMeasurement?.height) ? latestMeasurement.height : NaN;
    const latestWeight = Number.isFinite(latestMeasurement?.weight) ? latestMeasurement.weight : NaN;
    const latestTeethEntry = getLatestTeethEntry(Array.isArray(childLike?.growth?.teeth) ? childLike.growth.teeth : []);
    const latestTeeth = Number.isFinite(latestTeethEntry?.count)
      ? Number(latestTeethEntry.count)
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
    const isAnon = childAccess.isAnon;
    let historySummaries = [];
    if (isAnon) {
      historySummaries = await fetchAnonChildUpdateSummaries(childAccess, remoteChildId);
    } else {
      historySummaries = await fetchChildUpdateSummaries(remoteChildId);
    }
    const { summary: aiSummary, comment: aiCommentaire } = await generateAiSummaryAndComment(remoteChildId, updateType, normalizedContent, historySummaries);
    if (isAnon) {
      await childAccess.callAnon('log-update', {
        childId: remoteChildId,
        updateType,
        updateContent: content,
        aiSummary,
        aiCommentaire,
      });
      invalidateGrowthStatus(remoteChildId);
      scheduleFamilyContextRefresh();
      return;
    }
    const supaClient = await childAccess.getClient();
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
    scheduleFamilyContextRefresh();
  }

  async function fetchAnonChildUpdateSummaries(childAccess, childId) {
    if (!childId || !childAccess || !childAccess.isAnon) return [];
    try {
      const res = await childAccess.callAnon('list-updates', { childId, limit: 10 });
      const updates = Array.isArray(res?.updates) ? res.updates : [];
      return updates
        .map((row) => (typeof row?.ai_summary === 'string' ? row.ai_summary.trim() : ''))
        .filter(Boolean);
    } catch (err) {
      console.warn('anon child update summaries fetch failed', err);
      return [];
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
    const token = await resolveAccessToken();
    if (!token) throw new Error('Missing access token for child update logging');
    await callEdgeFunction('child-updates', {
      body,
      includeAuth: false,
      headers: { Authorization: `Bearer ${token}` },
    });
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
    const normalized = String(status)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '');
    const safeStatuses = new Set(['normeoms', 'poidsnormal', 'taillenormale', 'danslanorme', 'normal', 'normale', 'ok']);
    if (safeStatuses.has(normalized)) return false;
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
  async function askAI(question, child, history, parent){
    const payload = { question, child, history, type: 'advice' };
    if (parent && typeof parent === 'object') {
      payload.parent = parent;
    }
    if (activeProfile?.id != null) {
      const profileId = String(activeProfile.id).trim();
      if (profileId) {
        payload.profileId = profileId;
        payload.profile_id = profileId;
      }
    }
    if (activeProfile?.code_unique) {
      const code = String(activeProfile.code_unique).trim().toUpperCase();
      if (code) {
        payload.code_unique = code;
      }
    }
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
