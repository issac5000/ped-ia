let notifCount = 0;
const NOTIF_LAST_KEY = 'pedia_notif_last';
const NOTIF_BOOT_FLAG = 'pedia_notif_booted';
// Synap'Kids SPA — Prototype 100 % front avec localStorage + authentification Supabase (Google)
import { DEV_QUESTIONS } from './questions-dev.js';
import { loadSupabaseEnv } from './supabase-env-loader.js';
import { ensureReactGlobals } from './react-shim.js';

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
  let pendingDashboardFocus = null;
  let dashboardFocusCleanupTimer = null;
  function maybeFocusDashboardSection(){
    if (!pendingDashboardFocus) return;
    if (pendingDashboardFocus === 'history') {
      const target = document.getElementById('dashboard-history');
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
          const res = await anonChildRequest('list', {});
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
        } else {
          const uid = getActiveProfileId();
          if (uid) {
            const [profileRes, childrenRes] = await Promise.all([
              supabase
                .from('profiles')
                .select('id,full_name,avatar_url,parent_role,code_unique,show_children_count')
                .eq('id', uid)
                .maybeSingle(),
              supabase
                .from('children')
                .select('*')
                .eq('user_id', uid)
                .order('created_at', { ascending: true }),
            ]);
            if (!profileRes.error && profileRes.data) {
              const profileRow = profileRes.data;
              const pseudo = profileRow.full_name || working.user.pseudo || '';
              working.user = {
                ...working.user,
                pseudo,
                role: profileRow.parent_role || working.user.role || 'maman',
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
  const isAnonProfile = () => !!activeProfile?.isAnonymous && !!activeProfile?.code_unique;

  restoreAnonSession();

  async function anonChildRequest(action, payload = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const code = (activeProfile.code_unique || '').toString().trim().toUpperCase();
    if (!code) throw new Error('Code unique manquant');
    const body = { action, code, ...payload };
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
      const err = new Error(json?.error || 'Service indisponible');
      if (json?.details) err.details = json.details;
      throw err;
    }
    return json || {};
  }

  async function anonMessagesRequest(code_unique) {
    const ok = await ensureSupabaseClient();
    if (!ok || !supabase) return [];
    if (code_unique == null || code_unique === '') return [];
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('receiver_code', code_unique)
        .eq('is_read', false)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Erreur lors de la récupération des messages anonymes:', error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.error('Erreur lors de la récupération des messages anonymes:', err);
      return [];
    }
  }

  async function anonCommunityRequest(action, payload = {}) {
    if (!isAnonProfile()) throw new Error('Profil anonyme requis');
    const code = (activeProfile.code_unique || '').toString().trim().toUpperCase();
    if (!code) throw new Error('Code unique manquant');
    const body = { action, code, ...payload };
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
      const err = new Error(json?.error || 'Service indisponible');
      if (json?.details) err.details = json.details;
      throw err;
    }
    return json || {};
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
    const env = await loadSupabaseEnv();
    if (!env?.url || !env?.anonKey) throw new Error('Missing Supabase environment variables');
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    if (typeof createClient !== 'function') throw new Error('Supabase SDK unavailable');
    supabase = createClient(env.url, env.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

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
    const focusParam = queryParams?.get('focus') || '';
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
      const res = await anonMessagesRequest(code);
      const messages = Array.isArray(res) ? res : [];
      for (const m of messages) {
        if (!m || m.id == null) continue;
        const senderRaw = m.sender_id ?? m.senderId ?? m.sender_code ?? m.senderCode;
        if (senderRaw == null) continue;
        const fromId = String(senderRaw);
        const notifId = `msg:${m.id}`;
        const fromName = m.sender_name ?? m.senderName ?? m.sender_full_name ?? m.senderFullName ?? 'Un parent';
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
      };
    } else {
      activeProfile = null;
    }
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
      if (!supabase) return;
      const uid = authSession?.user?.id || getActiveProfileId();
      if (!uid) return;
      const { data: prof, error } = await supabase
        .from('profiles')
        .select('id, full_name, code_unique, avatar_url, parent_role, show_children_count')
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
        const env = await loadSupabaseEnv();
        if (!env?.url || !env?.anonKey) throw new Error('Env manquante');
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        if (typeof createClient !== 'function') throw new Error('Supabase SDK unavailable');
        supabase = createClient(env.url, env.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        return true;
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
    const ok = await ensureSupabaseClient();
    if (!ok) {
      if (status) { status.classList.add('error'); status.textContent = 'Service indisponible pour le moment.'; }
      return;
    }
    try {
      if (btn) { btn.dataset.busy = '1'; btn.disabled = true; }
      const { data, error } = await supabase
        .from('profiles')
        .select('id, code_unique, full_name, user_id')
        .eq('code_unique', code)
        .single();
      if (error) {
        if (status && (error.code === 'PGRST116' || (error.message || '').includes('Row not found'))) {
          status.classList.add('error'); status.textContent = 'Code invalide.';
          return;
        }
        throw error;
      }
      if (!data) {
        if (status) { status.classList.add('error'); status.textContent = 'Code invalide.'; }
        return;
      }
      setActiveProfile({ ...data, isAnonymous: !data.user_id });
      authSession = null;
      const current = store.get(K.user) || {};
      const pseudo = data.full_name || '';
      if (pseudo !== current.pseudo) {
        store.set(K.user, { ...current, pseudo });
      }
      if (status) { status.classList.remove('error'); status.textContent = ''; }
      if (input) input.value = '';
      location.hash = '#/dashboard';
    } catch (e) {
      console.error('loginWithCode failed', e);
      if (status) { status.classList.add('error'); status.textContent = 'Connexion impossible pour le moment.'; }
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
    // Déterminer l’enfant courant via Supabase si connecté, sinon via le stockage local
    let currentChild = null;
    const loadChild = async () => {
      if (useRemote()) {
        try {
          if (isAnonProfile()) {
            const list = await anonChildRequest('list', {});
            const rows = Array.isArray(list.children) ? list.children : [];
            if (!rows.length) {
              const user = store.get(K.user);
              const children = store.get(K.children, []);
              return children.find(c => c.id === user?.primaryChildId) || children[0] || null;
            }
            const primaryRow = rows.find(x => x.is_primary) || rows[0];
            if (!primaryRow) return null;
            const detail = await anonChildRequest('get', { childId: primaryRow.id });
            const data = detail.child;
            if (!data) return null;
            const child = mapRowToChild(data);
            if (!child) return null;
            const growth = detail.growth || {};
            (growth.measurements || []).forEach(m => {
              const h = Number(m?.height_cm);
              const w = Number(m?.weight_kg);
              const heightValid = Number.isFinite(h);
              const weightValid = Number.isFinite(w);
              child.growth.measurements.push({
                month: m.month,
                height: heightValid ? h : null,
                weight: weightValid ? w : null,
                bmi: heightValid && weightValid && h ? w / Math.pow(h / 100, 2) : null,
                measured_at: m.created_at
              });
            });
            (growth.sleep || []).forEach(s => child.growth.sleep.push({ month: s.month, hours: s.hours }));
            (growth.teeth || []).forEach(t => child.growth.teeth.push({ month: t.month, count: t.count }));
            return child;
          }
          const uid = authSession?.user?.id || getActiveProfileId();
          if (!uid) {
            console.warn("Aucun user_id disponible pour la requête children (loadChild) — fallback local");
            const user = store.get(K.user);
            const children = store.get(K.children, []);
            return children.find(c => c.id === user?.primaryChildId) || children[0] || null;
          }
          const { data: rows } = await supabase.from('children').select('*').eq('user_id', uid).order('created_at', { ascending: true });
          const r = (rows||[]).find(x=>x.is_primary) || (rows||[])[0];
          if (r) {
            const child = mapRowToChild(r);
            if (!child) return null;
            try {
              const [{ data: gm }, { data: gs }, { data: gt }] = await Promise.all([
                supabase.from('growth_measurements').select('month,height_cm,weight_kg,created_at').eq('child_id', r.id),
                supabase.from('growth_sleep').select('month,hours').eq('child_id', r.id),
                supabase.from('growth_teeth').select('month,count').eq('child_id', r.id),
              ]);
              (gm||[])
                .map(m => {
                  const h = m.height_cm == null ? null : Number(m.height_cm);
                  const w = m.weight_kg == null ? null : Number(m.weight_kg);
                  return {
                    month: m.month,
                    height: h,
                    weight: w,
                    bmi: w && h ? w / Math.pow(h / 100, 2) : null,
                    measured_at: m.created_at
                  };
                })
                .forEach(m => child.growth.measurements.push(m));
              (gs||[]).forEach(s=> child.growth.sleep.push({ month: s.month, hours: s.hours }));
              (gt||[]).forEach(t=> child.growth.teeth.push({ month: t.month, count: t.count }));
            } catch {}
            return child;
          }
        } catch {}
      } else {
        const user = store.get(K.user);
        const children = store.get(K.children, []);
        const c = children.find(c => c.id === user?.primaryChildId) || children[0];
        if (c) return c;
      }
      return null;
    };

    const loadChildById = async (id) => {
      if (!id) return null;
      if (useRemote()) {
        try {
          if (isAnonProfile()) {
            const detail = await anonChildRequest('get', { childId: id });
            const data = detail.child;
            if (!data) return null;
            const ch = mapRowToChild(data);
            if (!ch) return null;
            const growth = detail.growth || {};
            (growth.measurements || []).forEach(m => {
              const h = Number(m?.height_cm);
              const w = Number(m?.weight_kg);
              const heightValid = Number.isFinite(h);
              const weightValid = Number.isFinite(w);
              ch.growth.measurements.push({
                month: m.month,
                height: heightValid ? h : null,
                weight: weightValid ? w : null,
                bmi: heightValid && weightValid && h ? w / Math.pow(h / 100, 2) : null,
                measured_at: m.created_at
              });
            });
            (growth.sleep || []).forEach(s => ch.growth.sleep.push({ month: s.month, hours: s.hours }));
            (growth.teeth || []).forEach(t => ch.growth.teeth.push({ month: t.month, count: t.count }));
            return ch;
          }
          const uid = getActiveProfileId();
          if (!uid) {
            console.warn("Aucun user_id disponible pour la requête children (loadChildById) — fallback local");
            const children = store.get(K.children, []);
            return children.find(c=>c.id===id) || null;
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
              (gm||[])
                .map(m => {
                  const h = m.height_cm == null ? null : Number(m.height_cm);
                  const w = m.weight_kg == null ? null : Number(m.weight_kg);
                  return {
                    month: m.month,
                    height: h,
                    weight: w,
                    bmi: w && h ? w / Math.pow(h / 100, 2) : null,
                    measured_at: m.created_at
                  };
                })
                .forEach(m => ch.growth.measurements.push(m));
            (gs||[]).forEach(s=> ch.growth.sleep.push({ month: s.month, hours: s.hours }));
            (gt||[]).forEach(t=> ch.growth.teeth.push({ month: t.month, count: t.count }));
          } catch {}
          return ch;
        } catch { return null; }
      }
      const children = store.get(K.children, []);
      return children.find(c=>c.id===id) || null;
    };

    // Helpers d’historique de chat (local, par enfant)
    const chatKey = (c) => `pedia_ai_chat_${c?.id||'anon'}`;
    const loadChat = (c) => { try { return JSON.parse(localStorage.getItem(chatKey(c))||'[]'); } catch { return []; } };
    const saveChat = (c, arr) => { try { localStorage.setItem(chatKey(c), JSON.stringify(arr.slice(-20))); } catch {} };
    const renderChat = (arr) => {
      const el = document.getElementById('ai-chat-messages');
      if (!el) return;
      const userRole = store.get(K.user)?.role;
      const userAvatar = userRole === 'papa' ? '👨' : '👩';
      el.innerHTML = arr.map(m=>{
        const role = m.role==='user' ? 'user' : 'assistant';
        const avatar = role==='user' ? userAvatar : '🤖';
        const label = role==='user' ? 'Vous' : 'Assistant';
        return `<div class=\"chat-line ${role}\"><div class=\"avatar\">${avatar}</div><div class=\"message\"><div class=\"meta\">${label}</div><div class=\"bubble ${role}\">${escapeHtml(m.content).replace(/\\n/g,'<br/>')}</div></div></div>`;
      }).join('');
      el.scrollTo({ top: el.scrollHeight, behavior:'smooth' });
    };

    // Recettes
    const fRecipes = document.getElementById('form-ai-recipes');
    const sRecipes = document.getElementById('ai-recipes-status');
    const outRecipes = document.getElementById('ai-recipes-result');
    if (fRecipes && !fRecipes.dataset.bound) fRecipes.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (fRecipes.dataset.busy === '1') return;
      fRecipes.dataset.busy = '1';
      const submitBtn = fRecipes.querySelector('button[type="submit"],input[type="submit"]'); if (submitBtn) submitBtn.disabled = true;
      if (!currentChild) { outRecipes.innerHTML = '<div class="muted">Ajoutez un profil enfant pour des recommandations personnalisées.</div>'; return; }
      const prefs = new FormData(fRecipes).get('prefs')?.toString() || '';
      sRecipes.textContent = 'Génération en cours…'; outRecipes.innerHTML='';
      try {
        const text = await askAIRecipes(currentChild, prefs);
        outRecipes.innerHTML = `<div>${escapeHtml(text).replace(/\n/g,'<br/>')}</div>`;
      } catch (err){
        outRecipes.innerHTML = `<div class="muted">Serveur IA indisponible.</div>`;
      } finally { sRecipes.textContent=''; fRecipes.dataset.busy='0'; if (submitBtn) submitBtn.disabled = false; }
    }); fRecipes && (fRecipes.dataset.bound='1');

    // Histoire
    const fStory = document.getElementById('form-ai-story');
    const sStory = document.getElementById('ai-story-status');
    const outStory = document.getElementById('ai-story-result');
    if (fStory && !fStory.dataset.bound) fStory.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (fStory.dataset.busy === '1') return;
      fStory.dataset.busy = '1';
      const submitBtn = fStory.querySelector('button[type="submit"],input[type="submit"]'); if (submitBtn) submitBtn.disabled = true;
      if (!currentChild) { outStory.innerHTML = '<div class="muted">Ajoutez un profil enfant pour générer une histoire personnalisée.</div>'; return; }
      const fd = new FormData(fStory);
      const theme = fd.get('theme')?.toString() || '';
      const duration = parseInt(fd.get('duration')?.toString() || '3');
      const sleepy = !!fd.get('sleepy');
      sStory.textContent = 'Génération en cours…'; outStory.innerHTML='';
      try {
        const text = await askAIStory(currentChild, { theme, duration, sleepy });
        outStory.innerHTML = `<div>${escapeHtml(text).replace(/\n/g,'<br/>')}</div>`;
      } catch (err){
        outStory.innerHTML = `<div class="muted">Serveur IA indisponible.</div>`;
      } finally { sStory.textContent=''; fStory.dataset.busy='0'; if (submitBtn) submitBtn.disabled = false; }
    }); fStory && (fStory.dataset.bound='1');

    // Générateur d'images
    const fImage = document.getElementById('form-ai-image');
    const sImage = document.getElementById('ai-image-status');
    const errorImage = document.getElementById('ai-image-error');
    const figureImage = document.getElementById('ai-image-result');
    const imgPreview = figureImage?.querySelector('img');
    const statusMessage = document.getElementById('generation-status');
    const spinnerImage = document.getElementById('ai-image-spinner');
    if (fImage && !fImage.dataset.bound) fImage.addEventListener('submit', async (e) => {
      e.preventDefault();
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
      const submitBtn = fImage.querySelector('button[type="submit"],input[type="submit"]'); if (submitBtn) submitBtn.disabled = true;
      if (sImage) sImage.textContent = '';
      if (errorImage) { errorImage.textContent = ''; errorImage.hidden = true; }
      if (figureImage) figureImage.hidden = true;
      if (imgPreview) imgPreview.removeAttribute('src');
      if (spinnerImage) spinnerImage.hidden = false;

      const statusTimers = [];
      let hideStatusTimeout = null;
      let statusActive = false;
      const clearStatusTimers = () => {
        statusTimers.forEach(clearTimeout);
        statusTimers.length = 0;
        if (hideStatusTimeout) { clearTimeout(hideStatusTimeout); hideStatusTimeout = null; }
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
        statusTimers.push(setTimeout(() => {
          if (statusActive) setStatusText('⌛ Ça prend quelques secondes, merci de ta patience 🙏');
        }, 4000));
        statusTimers.push(setTimeout(() => {
          if (statusActive) setStatusText('🎨 L’IA met les dernières touches à ton illustration…');
        }, 8000));
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

      try {
        const res = await fetch('/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
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
        const dataUrl = rawImage.startsWith('data:') ? rawImage : (rawImage ? `data:${mime.startsWith('image/') ? mime : 'image/png'};base64,${rawImage}` : '');
        if (!dataUrl) throw new Error('Réponse image invalide.');
        if (imgPreview) {
          imgPreview.src = dataUrl;
        }
        if (figureImage) figureImage.hidden = false;
        if (errorImage) { errorImage.textContent = ''; errorImage.hidden = true; }
        hideSpinner();
        showSuccessStatus();
        if (sImage) sImage.textContent = '';
      } catch (err) {
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
    }); fImage && (fImage.dataset.bound='1');

    // Discussion
    const fChat = document.getElementById('form-ai-chat');
    const sChat = document.getElementById('ai-chat-status');
    const msgsEl = document.getElementById('ai-chat-messages');
    const btnReset = document.getElementById('ai-chat-reset');
    const txtChat = fChat?.querySelector('textarea[name="q"]');
    if (txtChat) {
      const placeholders = ['Écris ici…','Pose ta question…','Dis-moi tout…'];
      let idx = 0;
      setInterval(() => {
        if (document.activeElement !== txtChat) {
          idx = (idx + 1) % placeholders.length;
          txtChat.placeholder = placeholders[idx];
        }
      }, 4000);
    }
    if (btnReset && !btnReset.dataset.bound) {
      btnReset.addEventListener('click', (e) => {
        e.preventDefault();
        const key = chatKey(currentChild);
        try { localStorage.removeItem(key); } catch {}
        renderChat([]);
        sChat.textContent = '';
      });
      btnReset.dataset.bound = '1';
    }
    if (fChat && !fChat.dataset.bound) fChat.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (fChat.dataset.busy === '1') return;
      fChat.dataset.busy = '1';
      const submitBtn = fChat.querySelector('button[type="submit"],input[type="submit"]'); if (submitBtn) submitBtn.disabled = true;
      const q = new FormData(fChat).get('q')?.toString().trim();
      if (!q) return;
      sChat.textContent = 'Réflexion en cours…';
      // Afficher immédiatement la bulle de l’utilisateur
      const history = loadChat(currentChild);
      history.push({ role:'user', content:q });
      saveChat(currentChild, history);
      renderChat(history);
      // Afficher l’indicateur de frappe
      document.getElementById('ai-typing')?.remove();
      const typing = document.createElement('div');
      typing.id='ai-typing';
      typing.className='chat-line assistant';
      typing.innerHTML='<div class="avatar">🤖</div><div class="message"><div class="bubble assistant"><span class="typing"><span></span><span></span><span></span></span></div></div>';
      msgsEl?.appendChild(typing);
      msgsEl?.scrollTo({ top: msgsEl.scrollHeight, behavior:"smooth" });
      try {
        const resp = await askAI(q, currentChild, history);
        const newH = loadChat(currentChild);
        newH.push({ role:'assistant', content:resp });
        saveChat(currentChild, newH);
        renderChat(newH);
      } catch (err){
        const msg = (err && err.message) ? err.message : String(err||'IA indisponible');
        const newH = loadChat(currentChild);
        newH.push({ role:'assistant', content:`[Erreur IA] ${msg}` });
        saveChat(currentChild, newH);
        renderChat(newH);
      } finally { sChat.textContent=''; document.getElementById('ai-typing')?.remove(); fChat.dataset.busy='0'; if (submitBtn) submitBtn.disabled = false; }
    }); fChat && (fChat.dataset.bound='1');

    // Charger l’enfant de façon asynchrone pour personnaliser l’IA
    const renderIndicator = async (child) => {
      const route = document.querySelector('section[data-route="/ai"]');
      if (!route) return;
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
      if (!child || !slim.length) {
        box.innerHTML = `<div class="muted">Aucun profil enfant chargé pour l’IA. <a href="#/onboarding">Créer un profil</a>.</div>`;
        return;
      }
      const ageTxt = formatAge(child.dob);
      const selectedId = child.id;
      const opts = slim.map(c => `<option value="${c.id}" ${c.id===selectedId?'selected':''}>${escapeHtml(c.firstName)}${c.dob?` • ${formatAge(c.dob)}`:''}</option>`).join('');
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
      if (sel && !sel.dataset.bound) {
        sel.addEventListener('change', async (e) => {
          const id = e.currentTarget.value;
          await setPrimaryChild(id);
          currentChild = await loadChildById(id);
          // Rafraîchir l’indicateur et les historiques pour cet enfant
          await renderIndicator(currentChild);
          renderChat(loadChat(currentChild));
          // Vider les textes générés précédemment pour éviter la confusion
          const outR = document.getElementById('ai-recipes-result'); if (outR) outR.innerHTML = '';
          const outS = document.getElementById('ai-story-result'); if (outS) outS.innerHTML = '';
        });
        sel.dataset.bound = '1';
      }
    };

    (async () => { currentChild = await loadChild(); await renderIndicator(currentChild); renderChat(loadChat(currentChild)); const m=document.getElementById('ai-chat-messages'); m?.scrollTo({top:m.scrollHeight, behavior:'smooth'}); })();
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
        if (!isAnonProfile()) {
          try {
            const { data: primaryRow, error: primaryError } = await supabase
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
        const measurementRecords = buildMeasurementPayloads(child.growth.measurements);
        const teethRecords = buildTeethPayloads(child.growth.teeth);
        const sleepRecords = buildSleepPayloads(child.growth.sleep);
        if (isAnonProfile()) {
          await anonChildRequest('create', {
            child: payload,
            growthMeasurements: measurementRecords,
            growthTeeth: teethRecords,
            growthSleep: sleepRecords
          });
          return;
        }
        const { data: insChild, error: errC } = await supabase
          .from('children')
          .insert([payload])
          .select('id')
          .single();
        if (errC) throw errC;
        const childId = insChild.id;
        const msPayload = measurementRecords.map(m => ({ ...m, child_id: childId }));
        if (msPayload.length) {
          await supabase
            .from('growth_measurements')
            .upsert(msPayload, { onConflict: 'child_id,month' });
        }
        const teethPayloads = teethRecords.map(t => ({ ...t, child_id: childId }));
        if (teethPayloads.length) {
          await supabase.from('growth_teeth').insert(teethPayloads);
        }
        const sleepPayloads = sleepRecords.map(s => ({ ...s, child_id: childId }));
        if (sleepPayloads.length) {
          await supabase.from('growth_sleep').insert(sleepPayloads);
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
        if (isAnonProfile()) {
          const detail = await anonChildRequest('get', { childId: idStr });
          if (detail?.child) {
            child = mapRowToChild(detail.child) || child;
          }
        } else {
          const { data: row } = await supabase.from('children').select('*').eq('id', idStr).maybeSingle();
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
        <div class="form-actions-center"><button type="submit" class="btn btn-primary">Mettre à jour</button></div>
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
    const submitBtn = form.querySelector('button[type="submit"],input[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const fd = new FormData(form);
      const pseudo = (fd.get('pseudo') || '').toString().trim();
      const role = (fd.get('role') || 'maman').toString();
      const showStats = !!fd.get('showStats');
      const allowMessages = !!fd.get('allowMessages');
      const nextPrivacy = { showStats, allowMessages };
      const nextUser = { ...settingsState.user, pseudo, role };
      store.set(K.user, nextUser);
      store.set(K.privacy, nextPrivacy);
      settingsState.user = nextUser;
      settingsState.privacy = nextPrivacy;

      if (useRemote()) {
        if (isAnonProfile()) {
          const code = activeProfile?.code_unique;
          if (code) {
            await fetch('/api/profiles/update-anon', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code,
                fullName: pseudo,
                role,
                showChildrenCount: showStats,
              }),
            });
          }
        } else {
          const uid = getActiveProfileId();
          if (uid) {
            try {
              await supabase
                .from('profiles')
                .update({
                  full_name: pseudo,
                  parent_role: role,
                  show_children_count: showStats,
                })
                .eq('id', uid);
            } catch (err) {
              console.warn('Profil: mise à jour complète impossible, tentative sans parent_role', err);
              try {
                await supabase
                  .from('profiles')
                  .update({
                    full_name: pseudo,
                    show_children_count: showStats,
                  })
                  .eq('id', uid);
              } catch (errFallback) {
                console.warn('Profil: mise à jour sans role impossible', errFallback);
                try {
                  await supabase
                    .from('profiles')
                    .update({ full_name: pseudo })
                    .eq('id', uid);
                } catch (err2) {
                  console.warn('Profil: mise à jour minimale impossible', err2);
                }
              }
            }
          }
        }
        setActiveProfile({
          ...activeProfile,
          full_name: pseudo,
          parent_role: role,
          show_children_count: showStats,
        });
      } else {
        setActiveProfile({
          ...activeProfile,
          full_name: pseudo,
          parent_role: role,
          show_children_count: showStats,
        });
      }

      invalidateSettingsRemoteCache();

      alert('Profil parent mis à jour.');
    } catch (err) {
      console.warn('handleSettingsSubmit failed', err);
      alert('Impossible de mettre à jour le profil parent.');
    } finally {
      delete form.dataset.busy;
      if (submitBtn) submitBtn.disabled = false;
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
        if (isAnonProfile()) {
          await anonChildRequest('delete', { childId });
        } else {
          await supabase.from('children').delete().eq('id', childId);
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
    const submitBtn = form.querySelector('button[type="submit"],input[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Mise à jour en cours…';
    }
    const childId = form.getAttribute('data-child-id');
    let hadError = false;
    try {
      const base = settingsState.childrenMap.get(childId);
      if (!base) throw new Error('Profil enfant introuvable');
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
          if (isAnonProfile()) {
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
            const requestBody = { childId, child: payload };
            if (measurementRecords.length) requestBody.growthMeasurements = measurementRecords;
            if (teethRecords.length) requestBody.growthTeeth = teethRecords;
            await anonChildRequest('update', requestBody);
          } else {
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
            await supabase.from('children').update(payload).eq('id', childId);
            if (measurementRecords.length || teethRecords.length) {
              const remoteUpdates = [];
              if (measurementRecords.length) {
                const upsertMeasurements = measurementRecords.map((rec) => {
                  const payload = { child_id: childId, month: rec.month };
                  if (Object.prototype.hasOwnProperty.call(rec, 'height_cm')) payload.height_cm = rec.height_cm;
                  if (Object.prototype.hasOwnProperty.call(rec, 'weight_kg')) payload.weight_kg = rec.weight_kg;
                  return payload;
                });
                remoteUpdates.push(
                  supabase.from('growth_measurements').upsert(upsertMeasurements, { onConflict: 'child_id,month' })
                );
              }
              if (teethRecords.length) {
                const upsertTeeth = teethRecords.map((rec) => ({
                  child_id: childId,
                  month: rec.month,
                  count: rec.count,
                }));
                remoteUpdates.push((async () => {
                  try {
                    await supabase.from('growth_teeth').upsert(upsertTeeth, { onConflict: 'child_id,month' });
                  } catch (errTeeth) {
                    console.warn('growth_teeth upsert failed, fallback to insert', errTeeth);
                    await supabase.from('growth_teeth').insert(upsertTeeth);
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
      await logChildUpdate(childId, 'profil', logPayload);
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
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = hadError ? 'Réessayer' : 'Mettre à jour';
      }
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
        if (isAnonProfile()) {
          const code = activeProfile?.code_unique;
          if (code) {
            await fetch('/api/profiles/update-anon', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code,
                showChildrenCount: checked,
              }),
            });
          }
        } else {
          const uid = getActiveProfileId();
          if (uid) {
            const { error } = await supabase
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
    // Local : afficher le sélecteur d’enfant si des profils existent
    if (!useRemote()) {
      const u = store.get(K.user) || {};
      const slimLocal = (all || []).map(c => ({ id: c.id, firstName: c.firstName, dob: c.dob, isPrimary: c.id === u.primaryChildId }));
      if (slimLocal.length) renderChildSwitcher(dom.parentElement || dom, slimLocal, (slimLocal.find(s=>s.isPrimary)||slimLocal[0]).id, () => renderDashboard());
    }
    if (!useRemote() && !child) {
      if (rid !== renderDashboard._rid) return;
      dom.innerHTML = `<div class="card stack"><p>Aucun profil enfant. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Ajouter un enfant</a></div>`;
      return;
    }
    // Placeholder pendant le chargement distant
    if (useRemote()) {
      if (rid !== renderDashboard._rid) return;
      dom.innerHTML = `<div class="card stack"><p>Chargement du profil…</p><button id="btn-refresh-profile" class="btn btn-secondary">Forcer le chargement</button></div>`;
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
      dom.innerHTML = `
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

    `;

    setupTimelineScroller(dom);

    // Section « Profil santé » retirée à la demande

    // Ajouter le bloc d’historique des mises à jour
    try {
      const updates = await getChildUpdates(safeChild.id);
      if (rid !== renderDashboard._rid) return;
      const hist = document.createElement('div');
      hist.className = 'card stack';
      hist.id = 'dashboard-history';
      hist.style.marginTop = '20px';
      const timelineHtml = updates.map(u => {
        const created = new Date(u.created_at);
        const hasValidDate = !Number.isNaN(created.getTime());
        const when = hasValidDate
          ? created.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
          : 'Date inconnue';
        const iso = hasValidDate ? created.toISOString() : '';
        let details = '';
        let parentNoteHtml = '';
        try {
          const parsed = JSON.parse(u.update_content || '');
          const summaryText = parsed.summary || summarizeUpdate(parsed.prev || {}, parsed.next || {});
          if (summaryText) details = escapeHtml(summaryText);
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
        } catch {
          details = escapeHtml(u.update_content || '');
        }
        const typeBadge = u.update_type ? `<span class="timeline-tag">${escapeHtml(u.update_type)}</span>` : '';
        const commentText = typeof u.ai_commentaire === 'string' && u.ai_commentaire
          ? u.ai_commentaire
          : (typeof u.ai_comment === 'string' ? u.ai_comment : '');
        const comment = commentText
          ? `<div class="timeline-comment"><strong><em>${escapeHtml(commentText)}</em></strong></div>`
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

      if (timelineEl && updates.length > 2) {
        const items = Array.from(timelineEl.children);
        items.forEach((el, idx) => {
          if (idx >= 2) el.style.display = 'none';
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
            items.forEach((el, idx) => { if (idx >= 2) el.style.display = 'none'; });
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
      actions.appendChild(reportBtn);
      hist.appendChild(actions);

      const reportContainer = document.createElement('div');
      reportContainer.className = 'timeline-report-block';
      reportContainer.style.marginTop = '12px';

      const reportMessage = document.createElement('div');
      reportMessage.className = 'muted';
      reportMessage.textContent = useRemote()
        ? 'Cliquez sur « Bilan complet » pour générer un rapport synthétique.'
        : 'Connectez-vous pour générer un bilan complet.';
      reportMessage.setAttribute('role', 'status');
      reportMessage.setAttribute('aria-live', 'polite');

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
        const originalText = reportBtn.textContent;
        reportBtn.disabled = true;
        reportBtn.textContent = 'Génération…';
        reportMessage.textContent = 'Génération du bilan en cours…';
        reportContent.hidden = true;
        reportContent.textContent = '';
        try {
          const report = await fetchChildFullReport(safeChild.id);
          reportMessage.textContent = 'Bilan généré ci-dessous.';
          reportContent.textContent = report;
          reportContent.hidden = false;
          reportContent.scrollTop = 0;
          if (typeof reportContent.focus === 'function') {
            try { reportContent.focus({ preventScroll: true }); } catch {}
          }
        } catch (err) {
          const msg = err && typeof err.message === 'string'
            ? err.message
            : 'Bilan indisponible pour le moment.';
          reportMessage.textContent = msg;
          reportContent.hidden = true;
          reportContent.textContent = '';
        } finally {
          reportBtn.dataset.loading = '0';
          reportBtn.disabled = false;
          reportBtn.textContent = originalText;
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
            if (isAnonProfile()) {
              const measurementInputs = [];
              if (Number.isFinite(height)) measurementInputs.push({ month, height });
              if (Number.isFinite(weight)) measurementInputs.push({ month, weight });
              const measurementRecords = buildMeasurementPayloads(measurementInputs);
              const sleepRecords = Number.isFinite(sleep) ? buildSleepPayloads([{ month, hours: sleep }]) : [];
              const teethRecords = Number.isFinite(teeth) ? buildTeethPayloads([{ month, count: teeth }]) : [];
              await anonChildRequest('add-growth', {
                childId: safeChild.id,
                growthMeasurements: measurementRecords,
                growthSleep: sleepRecords,
                growthTeeth: teethRecords
              });
              await logChildUpdate(safeChild.id, 'measure', { summary, month, height, weight, sleep, teeth });
              renderDashboard();
              handled = true;
            } else {
              const uid = getActiveProfileId();
              if (!uid) {
                console.warn('Aucun user_id disponible pour growth_measurements/growth_sleep/growth_teeth (form-measure)');
                throw new Error('Pas de user_id');
              }
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
                    supabase
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
                    const { data, error } = await supabase
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
                  supabase
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
            const listRes = await anonChildRequest('list', {});
            const rows = Array.isArray(listRes.children) ? listRes.children : [];
            if (!rows.length) {
              if (rid !== renderDashboard._rid) return;
              dom.innerHTML = `<div class="card stack"><p>Aucun profil. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Créer un profil enfant</a></div>`;
              return;
            }
            const slimRemote = rows.map(r => ({ id: r.id, firstName: r.first_name, dob: r.dob, isPrimary: !!r.is_primary }));
            const selId = (slimRemote.find(s=>s.isPrimary) || slimRemote[0]).id;
            if (rid !== renderDashboard._rid) return;
            renderChildSwitcher(dom.parentElement || dom, slimRemote, selId, () => renderDashboard());
            const primary = rows.find(r => r.id === selId) || rows[0];
            const detail = await anonChildRequest('get', { childId: primary.id });
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
                dom.innerHTML = `<div class="card stack"><p>Aucun profil. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Créer un profil enfant</a></div>`;
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
            const { data: rows, error: rowsErr } = await supabase.from('children').select('*').eq('user_id', uid).order('created_at', { ascending: true });
            if (rowsErr) throw rowsErr;
            if (!rows || !rows.length) {
              if (rid !== renderDashboard._rid) return;
              dom.innerHTML = `<div class="card stack"><p>Aucun profil. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Créer un profil enfant</a></div>`;
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
            const [{ data: gm, error: gmErrLocal }, { data: gs }, { data: gt }] = await Promise.all([
              supabase
                .from('growth_measurements')
                .select('month, height_cm, weight_kg, created_at')
                .eq('child_id', primary.id)
                .order('month', { ascending: true }),
              supabase.from('growth_sleep').select('month,hours').eq('child_id', primary.id),
              supabase.from('growth_teeth').select('month,count').eq('child_id', primary.id),
            ]);
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
          dom.innerHTML = `<div class="card">Erreur de chargement Supabase. Réessayez.</div>`;
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
      if (rid !== renderCommunity._rid) return;
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
        const repliesHtml = rs.map(r=>{
          const replyMeta = authorsMap.get(String(r.user_id)) || authorsMap.get(r.user_id) || null;
          const normalizedReply = normalizeAuthorMeta(replyMeta);
          const rawReplyAuthor = (normalizedReply && normalizedReply.name)
            || (typeof replyMeta === 'string' ? replyMeta : replyMeta?.full_name || replyMeta?.name)
            || r.author
            || 'Anonyme';
          const replyAuthor = formatAuthorName(rawReplyAuthor);
          const replyAuthorMetaHtml = renderAuthorMetaInfo(normalizedReply || replyMeta);
          const replyAuthorBlock = `
            <span class="reply-author">
              <span class="reply-author-name">${escapeHtml(replyAuthor)}</span>
              ${replyAuthorMetaHtml}
            </span>
          `.trim();
          const replyInitials = initialsFrom(rawReplyAuthor);
          const { label: replyLabel, iso: replyIso } = formatDateParts(r.created_at || r.createdAt);
          const replyMessageBtn = r.user_id ? `<a href="messages.html?user=${encodeURIComponent(String(r.user_id))}" class="btn btn-secondary btn-message btn-message--small"${messageAttrs}>${messageLabel}</a>` : '';
          const replyTime = replyLabel ? `<time datetime="${replyIso}">${escapeHtml(replyLabel)}</time>` : '';
          return `
            <article class="reply">
              <div class="reply-head">
                <div class="reply-avatar" aria-hidden="true">${escapeHtml(replyInitials)}</div>
                <div class="reply-meta">
                  ${replyAuthorBlock}
                  ${replyTime}
                </div>
                ${replyMessageBtn}
              </div>
              <div class="reply-body">${normalizeContent(r.content)}</div>
            </article>
          `;
        }).join('');
        const repliesBlock = repliesCount ? `<div class="topic-replies">${repliesHtml}</div>` : '<p class="topic-empty">Aucune réponse pour le moment. Lancez la conversation !</p>';
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
            <div class="topic-content">${normalizeContent(t.content)}</div>
            ${repliesBlock}
            <form data-id="${tid}" class="form-reply form-grid">
              <label>Réponse<textarea name="content" rows="2" required></textarea></label>
              <div class="topic-form-actions">
                <button class="btn btn-secondary" type="submit">Répondre</button>
              </div>
            </form>
            ${deleteBtn}
          </div>
        `;
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
            const res = await anonCommunityRequest('list', {});
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
            repliesArr.forEach(r => {
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
            forum.topics.forEach(t=> repliesMap.set(t.id, t.replies||[]));
            const authors = new Map();
            renderTopics(forum.topics.slice().reverse(), repliesMap, authors);
            return;
          }
          const { data: topics } = await supabase.from('forum_topics').select('id,user_id,title,content,created_at').order('created_at',{ascending:false});
          const ids = (topics||[]).map(t=>t.id);
          const { data: reps } = ids.length? await supabase.from('forum_replies').select('id,topic_id,user_id,content,created_at').in('topic_id', ids) : { data: [] };
          const userIds = new Set([...(topics||[]).map(t=>t.user_id), ...(reps||[]).map(r=>r.user_id)]);
          let authorsMap = new Map();
          if (userIds.size) {
            const idArray = Array.from(userIds);
            const viewCandidates = ['community_profiles_meta', 'community_profiles_public', 'profiles_public_meta'];
            let viewLoaded = false;
            for (const viewName of viewCandidates) {
              if (!viewName || viewLoaded) break;
              try {
                const { data: rows, error: viewError } = await supabase
                  .from(viewName)
                  .select('id,full_name,name,children_count,child_count,show_children_count,showChildCount,show_stats,showStats')
                  .in('id', idArray);
                if (viewError) throw viewError;
                if (Array.isArray(rows) && rows.length) {
                  authorsMap = new Map(rows.map((row) => {
                    const id = row?.id != null ? String(row.id) : '';
                    if (!id) return null;
                    const entry = normalizeAuthorMeta({
                      name: row.full_name || row.name || 'Utilisateur',
                      child_count: row.children_count ?? row.child_count ?? row.childCount ?? null,
                      show_children_count:
                        row.show_children_count ?? row.showChildCount ?? row.show_stats ?? row.showStats,
                    }) || { name: row.full_name || row.name || 'Utilisateur', childCount: null, showChildCount: false };
                    return [id, entry];
                  }).filter(Boolean));
                  viewLoaded = true;
                }
              } catch {
                continue;
              }
            }
            if (!viewLoaded || !authorsMap.size) {
              try {
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token || '';
                const r = await fetch('/api/profiles/by-ids', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body: JSON.stringify({ ids: idArray })
                });
                if (r.ok) {
                  const j = await r.json();
                  authorsMap = new Map((j.profiles||[]).map((p)=>{
                    const id = p?.id != null ? String(p.id) : '';
                    if (!id) return null;
                    const entry = normalizeAuthorMeta({
                      name: p.full_name || p.name || 'Utilisateur',
                      child_count: p.child_count ?? p.children_count ?? null,
                      show_children_count: p.show_children_count ?? p.showChildCount ?? p.show_stats ?? p.showStats
                    }) || { name: p.full_name || 'Utilisateur', childCount: null, showChildCount: false };
                    return [id, entry];
                  }).filter(Boolean));
                } else {
                  const { data: profs } = await supabase.from('profiles').select('id,full_name,show_children_count').in('id', idArray);
                  let childRows = [];
                  try {
                    const { data: rows } = await supabase.from('children').select('user_id').in('user_id', idArray);
                    childRows = rows || [];
                  } catch {}
                  const counts = new Map();
                  childRows.forEach((row)=>{
                    const key = row?.user_id != null ? String(row.user_id) : '';
                    if (!key) return;
                    counts.set(key, (counts.get(key)||0)+1);
                  });
                  authorsMap = new Map((profs||[]).map((p)=>{
                    const id = p?.id != null ? String(p.id) : '';
                    if (!id) return null;
                    const entry = normalizeAuthorMeta({
                      name: p.full_name || 'Utilisateur',
                      child_count: counts.get(id) ?? null,
                      show_children_count: p.show_children_count
                    }) || { name: p.full_name || 'Utilisateur', childCount: null, showChildCount: false };
                    return [id, entry];
                  }).filter(Boolean));
                }
              } catch {
                const { data: profs } = await supabase.from('profiles').select('id,full_name,show_children_count').in('id', idArray);
                let childRows = [];
                try {
                  const { data: rows } = await supabase.from('children').select('user_id').in('user_id', idArray);
                  childRows = rows || [];
                } catch {}
                const counts = new Map();
                childRows.forEach((row)=>{
                  const key = row?.user_id != null ? String(row.user_id) : '';
                  if (!key) return;
                  counts.set(key, (counts.get(key)||0)+1);
                });
                authorsMap = new Map((profs||[]).map((p)=>{
                  const id = p?.id != null ? String(p.id) : '';
                  if (!id) return null;
                  const entry = normalizeAuthorMeta({
                    name: p.full_name || 'Utilisateur',
                    child_count: counts.get(id) ?? null,
                    show_children_count: p.show_children_count
                  }) || { name: p.full_name || 'Utilisateur', childCount: null, showChildCount: false };
                  return [id, entry];
                }).filter(Boolean));
              }
            }
          }
          const repliesMap = new Map();
          (reps||[]).forEach(r=>{ const key = String(r.topic_id); const arr = repliesMap.get(key)||[]; arr.push(r); repliesMap.set(key, arr); });
          renderTopics(topics||[], repliesMap, authorsMap);
        } catch (e) { showEmpty(); }
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
  function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

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
    const normalizedContent = normalizeUpdateContentForLog(updateContent);
    const content = JSON.stringify(normalizedContent);
    if (isAnonProfile()) {
      await anonChildRequest('log-update', {
        childId,
        updateType,
        updateContent: content
      });
      return;
    }
    const historySummaries = await fetchChildUpdateSummaries(childId);
    const { summary: aiSummary, comment: aiCommentaire } = await generateAiSummaryAndComment(updateType, normalizedContent, historySummaries);
    const payload = { child_id: childId, update_type: updateType, update_content: content };
    if (aiSummary) payload.ai_summary = aiSummary;
    if (aiCommentaire) payload.ai_commentaire = aiCommentaire;
    try {
      const { error } = await supabase
        .from('child_updates')
        .insert([payload]);
      if (error) throw error;
    } catch (err) {
      console.error('Supabase child_updates insert failed', { error: err, payload });
      try {
        await logChildUpdateViaApi({
          childId,
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
  }

  async function logChildUpdateViaApi({ childId, updateType, updateContent, aiSummary, aiCommentaire }) {
    const body = {
      childId,
      updateType,
      updateContent,
    };
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
      const { data, error } = await supabase
        .from('child_updates')
        .select('ai_summary')
        .eq('child_id', childId)
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

  async function fetchChildFullReport(childId) {
    if (!childId) throw new Error('Profil enfant introuvable.');
    if (!useRemote()) throw new Error('Connectez-vous pour générer un bilan complet.');
    try {
      const res = await fetch('/api/ai?type=child-full-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childId, child_id: childId })
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

  async function generateAiSummaryAndComment(updateType, contentObj, historySummaries) {
    try {
      const payload = {
        type: 'child-update',
        updateType,
        update: contentObj,
        parentComment: typeof contentObj?.userComment === 'string' ? contentObj.userComment : '',
        historySummaries: Array.isArray(historySummaries) ? historySummaries.slice(0, 10) : [],
      };
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return { summary: '', comment: '' };
      const j = await res.json();
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
      if (isAnonProfile()) {
        const res = await anonChildRequest('list-updates', { childId });
        return Array.isArray(res.updates) ? res.updates : [];
      }
      const { data, error } = await supabase
        .from('child_updates')
        .select('*')
        .eq('child_id', childId)
        .order('created_at', { ascending: false });
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
        if (isAnonProfile()) {
          const res = await anonChildRequest('list', {});
          const rows = Array.isArray(res.children) ? res.children : [];
          return rows.map(r => ({ id: r.id, firstName: r.first_name, dob: r.dob, isPrimary: !!r.is_primary }));
        }
        const uid = getActiveProfileId();
        if (!uid) {
          console.warn('Aucun user_id disponible pour children (listChildrenSlim)');
          throw new Error('Pas de user_id');
        }
        const { data: rows } = await supabase
          .from('children')
          .select('id,first_name,dob,is_primary')
          .eq('user_id', uid)
          .order('created_at', { ascending: true });
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
        if (isAnonProfile()) {
          await anonChildRequest('set-primary', { childId: id });
        } else {
          const uid = getActiveProfileId();
          if (!uid) { console.warn('Aucun user_id disponible pour children (setPrimaryChild)'); throw new Error('Pas de user_id'); }
          await supabase.from('children').update({ is_primary: false }).eq('user_id', uid);
          await supabase.from('children').update({ is_primary: true }).eq('id', id);
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
    return data.text || 'Aucune réponse.';
  }

  async function askAIRecipes(child, prefs){
    const payload = { child, prefs, type: 'recipes' };
    const res = await fetch('/api/ai', {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('AI backend error');
    const data = await res.json();
    return data.text || '';
  }

  async function askAIStory(child, opts){
    const payload = { child, ...opts, type: 'story' };
    const res = await fetch('/api/ai', {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('AI backend error');
    const data = await res.json();
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
