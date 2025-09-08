// Ped’IA SPA — Front-only prototype with localStorage + Supabase Auth (Google)
(async () => {
  const DEBUG_AUTH = (typeof localStorage !== 'undefined' && localStorage.getItem('debug_auth') === '1');
  // Load Supabase env and client
  let supabase = null; let authSession = null;
  try {
    const env = await fetch('/api/env').then(r=>r.json());
    if (DEBUG_AUTH) console.log('ENV', env);
    if (env?.url && env?.anonKey) {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      supabase = createClient(env.url, env.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      if (DEBUG_AUTH) console.log('Supabase client created');
  
      // Vérifier si un utilisateur est déjà connecté après redirection OAuth
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        authSession = { user };
        if (DEBUG_AUTH) console.log("Utilisateur connecté après retour Google:", user.email);
        updateHeaderAuth();
        setActiveRoute(location.hash);
      }
  
      // Récupérer la session en cours (utile si pas d'user direct)
      const { data: { session } } = await supabase.auth.getSession();
      authSession = session || authSession;
      supabase.auth.onAuthStateChange((_event, session) => {
        authSession = session || null;
        updateHeaderAuth();
        setActiveRoute(location.hash);
      });
    }
  } catch (e) {
    console.warn('Supabase init failed (env or import)', e);
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const routes = [
    "/", "/signup", "/login", "/onboarding", "/dashboard",
    "/community", "/settings", "/about", "/ai", "/contact", "/legal"
  ];

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
    del(k) { localStorage.removeItem(k); },
  };

  // Data model keys
  const K = {
    user: 'pedia_user',
    children: 'pedia_children',
    forum: 'pedia_forum',
    privacy: 'pedia_privacy',
    session: 'pedia_session',
    messages: 'pedia_messages'
  };

  // Bootstrap defaults
  function bootstrap() {
    if (!store.get(K.forum)) store.set(K.forum, { topics: [] });
    if (!store.get(K.children)) store.set(K.children, []);
    if (!store.get(K.privacy)) store.set(K.privacy, { showStats: true, allowMessages: true });
    if (!store.get(K.session)) store.set(K.session, { loggedIn: false });
  }

  // Routing
  function setActiveRoute(hash) {
    const path = (hash.replace('#', '') || '/');
    $$('.route').forEach(s => s.classList.remove('active'));
    const route = $(`section[data-route="${path}"]`);
    if (route) route.classList.add('active');
    updateHeaderAuth();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Guard routes
    const authed = !!authSession?.user;
    const needAuth = ['/dashboard','/community','/settings','/onboarding'];
    if (needAuth.includes(path) && !authed) {
      location.hash = '#/login';
      return;
    }
    if ((path === '/login' || path === '/signup') && authed) {
      location.hash = '#/dashboard';
      return;
    }
    // Page hooks
    if (path === '/onboarding') renderOnboarding();
    if (path === '/dashboard') renderDashboard();
    if (path === '/community') renderCommunity();
    
    if (path === '/settings') renderSettings();
    if (path === '/ai') setupAIPage();
    if (path === '/contact') setupContact();
    // prepare and trigger scroll-based reveals
    setTimeout(setupScrollAnimations, 0);
  }

  window.addEventListener('hashchange', () => setActiveRoute(location.hash));
  // Close mobile menu on route change
  window.addEventListener('hashchange', () => {
    const nav = document.getElementById('main-nav');
    const btn = document.getElementById('nav-toggle');
    if (nav) nav.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded','false');
    const bd = document.getElementById('nav-backdrop');
    bd?.classList.remove('open');
  });

  // On resize to desktop, ensure menu closed
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      mainNav?.classList.remove('open');
      navBtn?.setAttribute('aria-expanded','false');
      navBackdrop?.classList.remove('open');
    }
  });

  // Header auth buttons
  function updateHeaderAuth() {
    $('#btn-login').hidden = !!authSession?.user;
    $('#btn-logout').hidden = !authSession?.user;
  }
  async function signInGoogle(){
    if (DEBUG_AUTH) console.log('signInGoogle clicked');
    try {
      if (!supabase) {
        const env = await fetch('/api/env').then(r=>r.json());
        if (DEBUG_AUTH) console.log('ENV (on click)', env);
        if (!env?.url || !env?.anonKey) throw new Error('Env manquante');
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        supabase = createClient(env.url, env.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
      }
      await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/#/dashboard' } });
    } catch (e) { alert('Connexion Google indisponible'); }
  }
  $('#btn-login').addEventListener('click', async (e) => { e.preventDefault(); await signInGoogle(); });
  // Buttons on /login and /signup pages (event delegation for robustness)
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest('.btn-google-login') : null;
    if (t) { e.preventDefault(); signInGoogle(); }
  });
  $('#btn-logout').addEventListener('click', async () => {
    try { await supabase?.auth.signOut(); } catch {}
    alert('Déconnecté.');
    updateHeaderAuth();
    location.hash = '#/login';
  });

  // Mobile nav toggle
  const navBtn = document.getElementById('nav-toggle');
  const mainNav = document.getElementById('main-nav');
  const navBackdrop = document.getElementById('nav-backdrop');
  navBtn?.addEventListener('click', () => {
    const isOpen = mainNav?.classList.toggle('open');
    navBtn.setAttribute('aria-expanded', String(!!isOpen));
    if (isOpen) navBackdrop?.classList.add('open'); else navBackdrop?.classList.remove('open');
  });
  // Close menu when clicking a link (mobile)
  $$('.main-nav .nav-link').forEach(a => a.addEventListener('click', () => {
    if (mainNav?.classList.contains('open')) {
      mainNav.classList.remove('open');
      navBtn?.setAttribute('aria-expanded','false');
      navBackdrop?.classList.remove('open');
    }
  }));

  // Close when tapping backdrop
  navBackdrop?.addEventListener('click', () => {
    mainNav?.classList.remove('open');
    navBtn?.setAttribute('aria-expanded','false');
    navBackdrop?.classList.remove('open');
  });

  // Auth flows
  $('#form-signup')?.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('Veuillez utiliser "Se connecter avec Google".');
    location.hash = '#/login';
  });

  $('#form-login')?.addEventListener('submit', async (e) => { e.preventDefault(); await signInGoogle(); });

  function logout() { /* replaced by supabase signOut above */ }

  // Contact (demo: save locally)
  function setupContact(){
    const form = $('#form-contact');
    const status = $('#contact-status');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
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
    }, { once: true });
  }

  // --- AI page handlers ---
  function setupAIPage(){
    const session = store.get(K.session);
    const user = store.get(K.user);
    const children = store.get(K.children, []);
    const child = children.find(c => c.id === user?.primaryChildId) || children[0];

    // Recipes
    const fRecipes = document.getElementById('form-ai-recipes');
    const sRecipes = document.getElementById('ai-recipes-status');
    const outRecipes = document.getElementById('ai-recipes-result');
    fRecipes?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!child) { outRecipes.innerHTML = '<div class="muted">Ajoutez un profil enfant pour des recommandations personnalisées.</div>'; return; }
      const prefs = new FormData(fRecipes).get('prefs')?.toString() || '';
      sRecipes.textContent = 'Génération en cours…'; outRecipes.innerHTML='';
      try {
        const text = await askAIRecipes(child, prefs);
        outRecipes.innerHTML = `<div>${escapeHtml(text).replace(/\n/g,'<br/>')}</div>`;
      } catch (err){
        outRecipes.innerHTML = `<div class="muted">Serveur IA indisponible.</div>`;
      } finally { sRecipes.textContent=''; }
    });

    // Story
    const fStory = document.getElementById('form-ai-story');
    const sStory = document.getElementById('ai-story-status');
    const outStory = document.getElementById('ai-story-result');
    fStory?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!child) { outStory.innerHTML = '<div class="muted">Ajoutez un profil enfant pour générer une histoire personnalisée.</div>'; return; }
      const fd = new FormData(fStory);
      const theme = fd.get('theme')?.toString() || '';
      const duration = parseInt(fd.get('duration')?.toString() || '3');
      const sleepy = !!fd.get('sleepy');
      sStory.textContent = 'Génération en cours…'; outStory.innerHTML='';
      try {
        const text = await askAIStory(child, { theme, duration, sleepy });
        outStory.innerHTML = `<div>${escapeHtml(text).replace(/\n/g,'<br/>')}</div>`;
      } catch (err){
        outStory.innerHTML = `<div class="muted">Serveur IA indisponible.</div>`;
      } finally { sStory.textContent=''; }
    });

    // Chat
    const fChat = document.getElementById('form-ai-chat');
    const sChat = document.getElementById('ai-chat-status');
    const outChat = document.getElementById('ai-chat-result');
    fChat?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = new FormData(fChat).get('q')?.toString().trim();
      if (!q) return;
      sChat.textContent = 'Réflexion en cours…'; outChat.innerHTML='';
      try {
        const text = await askAI(q, child);
        outChat.innerHTML = `<div>${text.replace(/\n/g,'<br/>')}</div>`;
      } catch (err){
        outChat.innerHTML = `<div class="muted">Serveur IA indisponible.</div>`;
      } finally { sChat.textContent=''; }
    });
  }

  // Onboarding
  const DEV_QUESTIONS = [
    'Sourit socialement',
    'Tient sa tête',
    'Se retourne',
    'S’assoit sans aide',
    'Rampe',
    'Marche quelques pas',
    'Dit quelques mots',
    'Fait des phrases simples',
    'Propreté en journée',
    'Brosse les dents avec aide'
  ];

  function renderOnboarding() {
    const grid = $('#dev-questions');
    if (!grid) return;
    grid.innerHTML = '';
    DEV_QUESTIONS.forEach((q, i) => {
      const id = `q_${i}`;
      const div = document.createElement('div');
      div.className = 'qitem';
      div.innerHTML = `
        <div class="qtitle">${q}</div>
        <label class="switch">
          <input type="checkbox" name="dev_${i}">
          <span>Oui</span>
        </label>`;
      grid.appendChild(div);
    });

    const form = $('#form-child');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const file = fd.get('photo');
      let photoDataUrl = null;
      if (file instanceof File && file.size > 0) {
        photoDataUrl = await fileToDataUrl(file);
      }
      const dobStr = fd.get('dob').toString();
      const ageMAtCreation = ageInMonths(dobStr);
      const child = {
        id: genId(),
        firstName: fd.get('firstName').toString().trim(),
        sex: fd.get('sex').toString(),
        dob: dobStr,
        photo: photoDataUrl,
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
        milestones: DEV_QUESTIONS.map((_, i) => !!fd.get(`dev_${i}`)),
        growth: {
          measurements: [], // {month, height, weight}
          sleep: [], // {month, hours}
          teeth: [], // {month, count}
        },
        createdAt: Date.now(),
      };
      // Initial measures if provided
      const h = parseFloat(fd.get('height'));
      const w = parseFloat(fd.get('weight'));
      const t = parseInt(fd.get('teeth'));
      if (Number.isFinite(h)) child.growth.measurements.push({ month: ageMAtCreation, height: h });
      if (Number.isFinite(w)) child.growth.measurements.push({ month: ageMAtCreation, weight: w });
      if (Number.isFinite(t)) child.growth.teeth.push({ month: ageMAtCreation, count: t });
      const children = store.get(K.children, []);
      children.push(child);
      store.set(K.children, children);
      const user = store.get(K.user);
      user.childIds.push(child.id);
      if (!user.primaryChildId) user.primaryChildId = child.id;
      store.set(K.user, user);
      alert('Profil enfant créé.');
      location.hash = '#/dashboard';
    }, { once: true });
  }

  function fileToDataUrl(file) {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result.toString());
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
  }

  // Dashboard
  function renderDashboard() {
    const user = store.get(K.user);
    const all = store.get(K.children, []);
    const child = all.find(c => c.id === user?.primaryChildId) || all[0];
    const dom = $('#dashboard-content');
    if (!child) {
      dom.innerHTML = `<div class="card stack"><p>Aucun profil enfant. Créez‑en un.</p><a class="btn btn-primary" href="#/onboarding">Ajouter un enfant</a></div>`;
      return;
    }
    const ageM = ageInMonths(child.dob);
    const ageTxt = formatAge(child.dob);
    // Compute latest health snapshot values
    const msAll = normalizeMeasures(child.growth.measurements);
    const latestH = [...msAll].reverse().find(m=>Number.isFinite(m.height))?.height;
    const latestW = [...msAll].reverse().find(m=>Number.isFinite(m.weight))?.weight;
    const lastTeeth = [...(child.growth.teeth||[])].sort((a,b)=> (a.month??0)-(b.month??0)).slice(-1)[0]?.count;
    const lastSleepHours = [...(child.growth.sleep||[])].sort((a,b)=> (a.month??0)-(b.month??0)).slice(-1)[0]?.hours;
    dom.innerHTML = `
      <div class="grid-2">
        <div class="card stack">
          <div class="hstack">
            ${child.photo ? `<img src="${child.photo}" alt="${child.firstName}" style="width:64px;height:64px;object-fit:cover;border-radius:12px;border:1px solid #2a3161;"/>` :
            `<div style="width:64px;height:64px;border-radius:12px;border:1px solid #2a3161;display:grid;place-items:center;background:#111845">👶</div>`}
            <div>
              <h2 style="margin:0">${child.firstName}</h2>
              <div class="muted">${child.sex} • ${ageTxt}</div>
            </div>
          </div>
          <div class="hstack">
            <span class="chip">Allergies: ${child.context.allergies || '—'}</span>
            <span class="chip">Mode de garde: ${child.context.care || '—'}</span>
            <span class="chip">Langues: ${child.context.languages || '—'}</span>
            <span class="chip">Alimentation: ${labelFeedingType(child.context.feedingType)}</span>
            <span class="chip">Appétit: ${labelEatingStyle(child.context.eatingStyle)}</span>
            <span class="chip">Sommeil: ${summarizeSleep(child.context.sleep)}</span>
          </div>
          <div class="hstack">
            ${child.milestones.map((v,i)=> v?`<span class="badge">✅ ${DEV_QUESTIONS[i]}</span>`: '').join('') || '<span class="muted">Pas encore de badges — cochez des étapes dans le profil.</span>'}
          </div>
        </div>

        <form id="form-measure" class="card form-grid">
          <h3>Ajouter une mesure</h3>
          <label>Mois
            <input type="number" name="month" min="0" max="84" value="${ageM}" />
          </label>
          <label>Taille (cm)
            <input type="number" step="0.1" name="height" />
          </label>
          <label>Poids (kg)
            <input type="number" step="0.01" name="weight" />
          </label>
          <label>Sommeil (h/24h)
            <input type="number" step="0.1" name="sleep" />
          </label>
          <label>Dents (nb)
            <input type="number" step="1" name="teeth" />
          </label>
          <button class="btn btn-primary" type="submit">Enregistrer</button>
        </form>
      </div>

      <div class="grid-2" style="margin-top:12px">
        <div class="card chart-card">
          <div class="chart-header">
            <h3>Taille (cm)</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>Enfant</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet)"></span>OMS (médiane)</span>
            </div>
          </div>
          <svg class="chart" id="chart-height"></svg>
        </div>
        <div class="card chart-card">
          <div class="chart-header">
            <h3>Poids (kg)</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>Enfant</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet)"></span>OMS (médiane)</span>
            </div>
          </div>
          <svg class="chart" id="chart-weight"></svg>
        </div>
        <div class="card chart-card">
          <div class="chart-header">
            <h3>Sommeil (h)</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>Enfant</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--orange)"></span>Recommandé</span>
            </div>
          </div>
          <svg class="chart" id="chart-sleep"></svg>
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

      <div class="grid-2" style="margin-top:12px">
        <div class="card stack">
          <h3>Conseils IA (indicatifs)</h3>
          ${renderAdvice(ageM)}
        </div>
        <div class="card stack">
          <h3>Actions rapides</h3>
          <div class="hstack">
            <a class="btn btn-secondary" href="#/ai">Fonctionnalité IA</a>
            <a class="btn btn-secondary" href="#/community">Communauté</a>
          </div>
        </div>
      </div>

      
    `;

    // Inject Profil santé card after main content
    const healthBlock = document.createElement('div');
    healthBlock.className = 'grid-2';
    healthBlock.style.marginTop = '12px';
    healthBlock.innerHTML = `
      <div class="card stack">
        <h3>Profil santé</h3>
        <div class="hstack">
          <span class="chip">Taille: ${Number.isFinite(latestH)? `${latestH} cm` : '—'}</span>
          <span class="chip">Poids: ${Number.isFinite(latestW)? `${latestW} kg` : '—'}</span>
          <span class="chip">Dents: ${Number.isFinite(lastTeeth)? `${lastTeeth}` : '—'}</span>
          <span class="chip">Sommeil (dernier): ${Number.isFinite(lastSleepHours)? `${lastSleepHours} h/24h` : '—'}</span>
        </div>
        <div class="hstack">
          <span class="chip">Endormissement: ${child.context.sleep?.falling || '—'}</span>
          <span class="chip">Nuits complètes: ${typeof child.context.sleep?.sleepsThrough==='boolean' ? (child.context.sleep.sleepsThrough?'Oui':'Non') : '—'}</span>
          <span class="chip">Réveils: ${child.context.sleep?.nightWakings || '—'}</span>
          <span class="chip">Éveils: ${child.context.sleep?.wakeDuration || '—'}</span>
          <span class="chip">Coucher: ${child.context.sleep?.bedtime || '—'}</span>
        </div>
        <div class="hstack">
          <span class="chip">Alimentation: ${labelFeedingType(child.context.feedingType)}</span>
          <span class="chip">Appétit: ${labelEatingStyle(child.context.eatingStyle)}</span>
          <span class="chip">Allergies: ${child.context.allergies || '—'}</span>
        </div>
      </div>`;
    dom.appendChild(healthBlock);

    // Handle measure form
    $('#form-measure').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const month = +fd.get('month');
      const height = parseFloat(fd.get('height'));
      const weight = parseFloat(fd.get('weight'));
      const sleep = parseFloat(fd.get('sleep'));
      const teeth = parseInt(fd.get('teeth'));
      const children = store.get(K.children, []);
      const c = children.find(x => x.id === child.id);
      if (Number.isFinite(height)) c.growth.measurements.push({ month, height });
      if (Number.isFinite(weight)) c.growth.measurements.push({ month, weight });
      if (Number.isFinite(sleep)) c.growth.sleep.push({ month, hours: sleep });
      if (Number.isFinite(teeth)) c.growth.teeth.push({ month, count: teeth });
      // Normalize combined height/weight arrays into paired entries for charting convenience
      store.set(K.children, children);
      renderDashboard();
    });

    // Charts
    const ms = normalizeMeasures(child.growth.measurements);
    drawChart($('#chart-height'), buildSeries(ms.map(m=>({x:m.month,y:m.height}))), buildSeries(whoSeries('height')));
    drawChart($('#chart-weight'), buildSeries(ms.map(m=>({x:m.month,y:m.weight}))), buildSeries(whoSeries('weight')));
    drawChart($('#chart-sleep'), buildSeries(child.growth.sleep.map(s=>({x:s.month,y:s.hours}))), buildSeries(sleepRecommendedSeries()));
    drawChart($('#chart-teeth'), buildSeries(child.growth.teeth.map(t=>({x:t.month,y:t.count}))));

    // Plain-language chart notes for parents
    try {
      const latestHPoint = [...ms].reverse().find(m=>Number.isFinite(m.height));
      const hMed = latestHPoint? medianAt('height', latestHPoint.month) : undefined;
      const noteH = document.createElement('div'); noteH.className='muted';
      if (latestHPoint && Number.isFinite(hMed)) {
        const diff = latestHPoint.height - hMed; const pos = diff>1? 'au‑dessus' : diff<-1? 'en‑dessous' : 'autour';
        noteH.textContent = `Dernière taille: ${latestHPoint.height} cm (${pos} de la médiane OMS ~ ${hMed.toFixed(1)} cm).`;
      } else { noteH.textContent = 'Ajoutez une taille pour voir la comparaison à la médiane OMS.'; }
      document.getElementById('chart-height')?.parentElement?.appendChild(noteH);

      const latestWPoint = [...ms].reverse().find(m=>Number.isFinite(m.weight));
      const wMed = latestWPoint? medianAt('weight', latestWPoint.month) : undefined;
      const noteW = document.createElement('div'); noteW.className='muted';
      if (latestWPoint && Number.isFinite(wMed)) {
        const diff = latestWPoint.weight - wMed; const pos = diff>0.2? 'au‑dessus' : diff<-0.2? 'en‑dessous' : 'autour';
        noteW.textContent = `Dernier poids: ${latestWPoint.weight} kg (${pos} de la médiane OMS ~ ${wMed.toFixed(2)} kg).`;
      } else { noteW.textContent = 'Ajoutez un poids pour voir la comparaison à la médiane OMS.'; }
      document.getElementById('chart-weight')?.parentElement?.appendChild(noteW);

      const latestS = [...(child.growth.sleep||[])].sort((a,b)=> (a.month??0)-(b.month??0)).slice(-1)[0];
      const rec = sleepRecommendation(ageM);
      const noteS = document.createElement('div'); noteS.className='muted';
      if (latestS) noteS.textContent = `Dernier sommeil: ${latestS.hours} h/24h. Recommandé: ${rec.min}–${rec.max} h.`;
      else noteS.textContent = `Recommandé à ${Math.round(ageM/12)} an(s): ${rec.min}–${rec.max} h/24h.`;
      document.getElementById('chart-sleep')?.parentElement?.appendChild(noteS);

      const latestT = [...(child.growth.teeth||[])].sort((a,b)=> (a.month??0)-(b.month??0)).slice(-1)[0];
      const noteT = document.createElement('div'); noteT.className='muted';
      if (latestT) noteT.textContent = `Dernier relevé: ${latestT.count} dent(s). Le calendrier d’éruption varie beaucoup — comparez surtout avec les observations précédentes.`;
      else noteT.textContent = 'Ajoutez un relevé de dents pour suivre l’évolution.';
      document.getElementById('chart-teeth')?.parentElement?.appendChild(noteT);
    } catch {}

    // Assistant IA retiré du dashboard (disponible dans /ai)
  }

  function normalizeMeasures(entries) {
    // entries may contain objects with either height or weight keyed
    const byMonth = new Map();
    for (const e of entries) {
      const m = e.month ?? e.m ?? 0;
      const obj = byMonth.get(m) || { month: m };
      if (typeof e.height === 'number') obj.height = e.height;
      if (typeof e.weight === 'number') obj.weight = e.weight;
      byMonth.set(m, obj);
    }
    return Array.from(byMonth.values()).sort((a,b)=>a.month-b.month);
  }

  // Community
  function renderCommunity() {
    const forum = store.get(K.forum, { topics: [] });
    const user = store.get(K.user);
    const children = store.get(K.children, []);
    const child = children.find(c=>c.id===user?.primaryChildId) || children[0];
    const whoAmI = user ? `${user.role} de ${child? child.firstName : '—'}` : 'Anonyme';
    const list = $('#forum-list');
    list.innerHTML = '';
    if (!forum.topics.length) {
      const empty = document.createElement('div');
      empty.className = 'card';
      empty.textContent = 'Aucun sujet pour le moment. Lancez la discussion !';
      list.appendChild(empty);
    } else {
      forum.topics.slice().reverse().forEach(t => {
        const el = document.createElement('div');
        el.className = 'topic';
        el.innerHTML = `
          <div class="flex-between">
            <h3 style="margin:0">${escapeHtml(t.title)}</h3>
            <span class="muted" title="Auteur">${t.author}</span>
          </div>
          <p>${escapeHtml(t.content)}</p>
          <div class="stack">
            ${t.replies.map(r=>`<div class="reply"><div class="muted">${r.author} • ${new Date(r.createdAt).toLocaleString()}</div><div>${escapeHtml(r.content)}</div></div>`).join('')}
          </div>
          <form data-id="${t.id}" class="form-reply form-grid" style="margin-top:8px">
            <label>Réponse<textarea name="content" rows="2" required></textarea></label>
            <button class="btn btn-secondary" type="submit">Répondre</button>
          </form>
        `;
        list.appendChild(el);
      });
      $$('.form-reply').forEach(f => f.addEventListener('submit', (e)=>{
        e.preventDefault();
        const id = e.currentTarget.getAttribute('data-id');
        const fd = new FormData(e.currentTarget);
        const content = fd.get('content').toString().trim();
        if (!content) return;
        const forum = store.get(K.forum);
        const topic = forum.topics.find(x=>x.id===id);
        topic.replies.push({ content, author: whoAmI, createdAt: Date.now() });
        store.set(K.forum, forum);
        renderCommunity();
      }));
    }

    // New topic dialog
    const dlg = $('#dialog-topic');
    $('#btn-new-topic').onclick = () => { if (dlg) dlg.showModal(); };
    $('#form-topic')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const title = fd.get('title').toString().trim();
      const content = fd.get('content').toString().trim();
      if (!title || !content) return;
      const forum = store.get(K.forum);
      forum.topics.push({ id: genId(), title, content, author: whoAmI, createdAt: Date.now(), replies: [] });
      store.set(K.forum, forum);
      dlg.close();
      renderCommunity();
    }, { once: true });
  }

  // (Comparateur retiré — les courbes sont dans le Dashboard)

  // Settings
  function renderSettings() {
    const user = store.get(K.user);
    const privacy = store.get(K.privacy);
    const children = store.get(K.children, []);
    const form = $('#form-settings');
    form.role.value = user?.role || 'maman';
    form.showStats.checked = !!privacy.showStats;
    form.allowMessages.checked = !!privacy.allowMessages;
    form.onsubmit = (e)=>{
      e.preventDefault();
      const fd = new FormData(form);
      const role = fd.get('role').toString();
      const showStats = !!fd.get('showStats');
      const allowMessages = !!fd.get('allowMessages');
      store.set(K.user, { ...user, role });
      store.set(K.privacy, { showStats, allowMessages });
      alert('Paramètres enregistrés');
    };

    const list = $('#children-list');
    list.innerHTML = '';
    children.forEach(c => {
      const row = document.createElement('div');
      row.className = 'hstack';
      row.innerHTML = `
        <span class="chip">${c.firstName} (${formatAge(c.dob)})</span>
        <button class="btn btn-secondary" data-edit="${c.id}">Modifier</button>
        <button class="btn btn-secondary" data-primary="${c.id}">Définir comme principal</button>
        <button class="btn btn-danger" data-del="${c.id}">Supprimer</button>
      `;
      list.appendChild(row);
    });
    list.addEventListener('click', (e)=>{
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const idE = target.getAttribute('data-edit');
      const idP = target.getAttribute('data-primary');
      const idD = target.getAttribute('data-del');
      if (idE) {
        const editBox = document.getElementById('child-edit');
        editBox?.setAttribute('data-edit-id', idE);
        renderSettings();
        return;
      }
      if (idP) {
        store.set(K.user, { ...user, primaryChildId: idP });
        renderSettings();
      }
      if (idD) {
        if (!confirm('Supprimer ce profil enfant ?')) return;
        let children = store.get(K.children, []);
        children = children.filter(c=>c.id!==idD);
        store.set(K.children, children);
        const u = { ...user, childIds: user.childIds.filter(x=>x!==idD) };
        if (u.primaryChildId===idD) u.primaryChildId = u.childIds[0] ?? null;
        store.set(K.user, u);
        renderSettings();
      }
    });

    // Child edit form render
    const editBox = document.getElementById('child-edit');
    const currentEditId = editBox?.getAttribute('data-edit-id') || user?.primaryChildId || children[0]?.id || null;
    const child = children.find(c=>c.id===currentEditId);
    if (editBox) {
      if (!child) {
        editBox.innerHTML = '<div class="muted">Sélectionnez un enfant pour modifier son profil.</div>';
      } else {
        editBox.innerHTML = `
          <h3>Modifier le profil enfant</h3>
          <form id="form-child-edit" class="form-grid" autocomplete="on">
            <input type="hidden" name="id" value="${child.id}" />
            <label>Prénom<input type="text" name="firstName" value="${escapeHtml(child.firstName)}" required /></label>
            <label>Sexe
              <select name="sex" required>
                <option value="fille" ${child.sex==='fille'?'selected':''}>Fille</option>
                <option value="garçon" ${child.sex==='garçon'?'selected':''}>Garçon</option>
              </select>
            </label>
            <label>Date de naissance<input type="date" name="dob" value="${child.dob}" required /></label>
            <h4>Mesures actuelles (optionnel)</h4>
            <div class="grid-2">
              <label>Taille (cm)<input type="number" step="0.1" name="height" /></label>
              <label>Poids (kg)<input type="number" step="0.01" name="weight" /></label>
            </div>
            <label>Dents (nb)<input type="number" step="1" name="teeth" /></label>
            <label>Photo/avatar<input type="file" name="photo" accept="image/*" /></label>
            <h4>Contexte</h4>
            <label>Allergies<input type="text" name="allergies" value="${escapeHtml(child.context.allergies||'')}" /></label>
            <label>Antécédents<input type="text" name="history" value="${escapeHtml(child.context.history||'')}" /></label>
            <label>Mode de garde<input type="text" name="care" value="${escapeHtml(child.context.care||'')}" /></label>
            <label>Langues parlées<input type="text" name="languages" value="${escapeHtml(child.context.languages||'')}" /></label>
            <h4>Habitudes alimentaires</h4>
            <label>Type d’alimentation
              <select name="feedingType">
                ${['','allaitement_exclusif','mixte_allaitement_biberon','allaitement_diversification','biberon_diversification','lait_poudre_vache'].map(v=>`<option value="${v}" ${ (child.context.feedingType||'')===v?'selected':'' }>${({
                  '':'—',
                  'allaitement_exclusif':'Allaitement exclusif',
                  'mixte_allaitement_biberon':'Mixte (allaitement + biberon)',
                  'allaitement_diversification':'Diversification + allaitement',
                  'biberon_diversification':'Biberon + diversification',
                  'lait_poudre_vache':'Lait en poudre / lait de vache'
                })[v]}</option>`).join('')}
              </select>
            </label>
            <label>Appétit / façon de manger
              <select name="eatingStyle">
                ${['','mange_tres_bien','appetit_variable','selectif_difficile','petites_portions'].map(v=>`<option value="${v}" ${ (child.context.eatingStyle||'')===v?'selected':'' }>${({
                  '':'—',
                  'mange_tres_bien':'Mange très bien',
                  'appetit_variable':'Appétit variable',
                  'selectif_difficile':'Sélectif / difficile',
                  'petites_portions':'Petites portions'
                })[v]}</option>`).join('')}
              </select>
            </label>
            <h4>Sommeil</h4>
            <div class="grid-2">
              <label>Endormissement
                <select name="sleep_falling">
                  ${['','facile','moyen','difficile'].map(v=>`<option value="${v}" ${ (child.context.sleep?.falling||'')===v?'selected':'' }>${({
                    '':'—','facile':'Facile','moyen':'Moyen','difficile':'Difficile'
                  })[v]}</option>`).join('')}
                </select>
              </label>
              <label>Nuits complètes
                <select name="sleep_through">
                  ${['','oui','non'].map(v=>`<option value="${v}" ${ ((child.context.sleep?.sleepsThrough?'oui':'non')===v)?'selected':'' }>${({
                    '':'—','oui':'Oui','non':'Non'
                  })[v]}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="grid-2">
              <label>Réveils nocturnes
                <select name="sleep_wakings">
                  ${['','0','1','2','3+'].map(v=>`<option value="${v}" ${ (child.context.sleep?.nightWakings||'')===v?'selected':'' }>${v||'—'}</option>`).join('')}
                </select>
              </label>
              <label>Durée des éveils
                <select name="sleep_wake_duration">
                  ${['','<5min','5-15min','15-30min','30-60min','>60min'].map(v=>`<option value="${v}" ${ (child.context.sleep?.wakeDuration||'')===v?'selected':'' }>${v||'—'}</option>`).join('')}
                </select>
              </label>
            </div>
            <label>Heure du coucher (approx.)
              <input type="time" name="sleep_bedtime" value="${child.context.sleep?.bedtime||''}" />
            </label>
            <div class="hstack">
              <button class="btn btn-primary" type="submit">Enregistrer</button>
              <button class="btn btn-secondary" type="button" id="btn-cancel-edit">Annuler</button>
            </div>
          </form>
        `;
        // Bind submit
        const f = document.getElementById('form-child-edit');
        f?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(f);
          const id = fd.get('id').toString();
          const childrenAll = store.get(K.children, []);
          const c = childrenAll.find(x=>x.id===id);
          if (!c) return;
          let photoDataUrl = c.photo;
          const file = fd.get('photo');
          if (file instanceof File && file.size > 0) {
            try { photoDataUrl = await fileToDataUrl(file); } catch {}
          }
          c.firstName = fd.get('firstName').toString().trim();
          c.sex = fd.get('sex').toString();
          const newDob = fd.get('dob').toString();
          const ageMNow = ageInMonths(newDob);
          c.dob = newDob;
          c.photo = photoDataUrl;
          c.context = {
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
          };
          // Optional new measures
          const eh = parseFloat(fd.get('height'));
          const ew = parseFloat(fd.get('weight'));
          const et = parseInt(fd.get('teeth'));
          if (Number.isFinite(eh)) c.growth.measurements.push({ month: ageMNow, height: eh });
          if (Number.isFinite(ew)) c.growth.measurements.push({ month: ageMNow, weight: ew });
          if (Number.isFinite(et)) c.growth.teeth.push({ month: ageMNow, count: et });
          store.set(K.children, childrenAll);
          alert('Profil enfant mis à jour.');
          renderSettings();
        }, { once: true });
        document.getElementById('btn-cancel-edit')?.addEventListener('click', ()=>{
          editBox.removeAttribute('data-edit-id');
          renderSettings();
        });
      }
    }

    $('#btn-export').onclick = () => {
      const data = {
        user: store.get(K.user),
        children: store.get(K.children, []),
        forum: store.get(K.forum, {topics:[]}),
        privacy: store.get(K.privacy, {}),
      };
      const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'pedia_export.json'; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    };
    $('#btn-delete-account').onclick = () => {
      if (!confirm('Supprimer le compte et toutes les données locales ?')) return;
      localStorage.removeItem(K.user);
      localStorage.removeItem(K.children);
      localStorage.removeItem(K.forum);
      localStorage.removeItem(K.privacy);
      localStorage.removeItem(K.session);
      bootstrap();
      alert('Compte supprimé (localement).');
      location.hash = '#/';
    };
    const inputImport = $('#input-import');
    $('#btn-import').onclick = () => inputImport.click();
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

  // Helpers
  function genId() { return Math.random().toString(36).slice(2, 10); }
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

  // Advice generator (fake IA)
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
    const arr=[]; for(let m=0;m<=84;m+=3){const r=sleepRecommendation(m);arr.push({x:m,y:(r.min+r.max)/2});} return arr;
  }

  // WHO approximate series
  const WHO_KEYS = {
    height: [
      [0,50],[6,67],[12,75],[24,87],[36,96],[48,103],[60,111],[72,118],[84,125]
    ],
    weight: [
      [0,3.3],[6,7.6],[12,9.5],[24,12.2],[36,14.3],[48,16.0],[60,18.3],[72,20.5],[84,22.5]
    ]
  };
  function interp(points, x){
    for(let i=0;i<points.length-1;i++){
      const [x1,y1]=points[i], [x2,y2]=points[i+1];
      if (x>=x1 && x<=x2){
        const t = (x-x1)/(x2-x1);
        return y1 + t*(y2-y1);
      }
    }
    if (x<points[0][0]) return points[0][1];
    return points[points.length-1][1];
  }
  function whoSeries(kind){
    const pts = WHO_KEYS[kind];
    const arr=[]; for(let m=0;m<=84;m+=3){arr.push({x:m,y:interp(pts,m)});} return arr;
  }

  // SVG Chart utils (lightweight)
  function buildSeries(list){ return [{color:'var(--turquoise)', data:list.filter(p=>Number.isFinite(p.y))}]; }
  function drawChart(svg, seriesA, seriesB){ drawMulti(svg, [...(seriesA||[]), ...(seriesB?[{color:'var(--violet)', data:seriesB[0].data}]:[])]); }
  function medianAt(kind, m){
    const arr = whoSeries(kind);
    if (!arr || !arr.length) return undefined;
    if (m <= arr[0].x) return arr[0].y;
    if (m >= arr[arr.length-1].x) return arr[arr.length-1].y;
    for (let i=1;i<arr.length;i++){
      const a = arr[i-1], b = arr[i];
      if (m>=a.x && m<=b.x){ const t = (m-a.x)/((b.x-a.x)||1); return a.y + t*(b.y-a.y); }
    }
    return arr[arr.length-1].y;
  }

  function drawMulti(svg, series){
    if (!svg) return;
    const W = svg.clientWidth || 600; const H = svg.clientHeight || 240;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML='';
    // Gather extents
    const allPoints = series.flatMap(s=>s.data);
    const xs = allPoints.map(p=>p.x);
    const ys = allPoints.map(p=>p.y);
    const minX = Math.min(0, ...xs, 0), maxX = Math.max(84, ...xs, 84);
    const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 10);
    const pad = 28; const left=36, right=12, top=12, bottom=24;
    const innerW = W-left-right, innerH = H-top-bottom;
    const xScale = x => left + (x-minX)/(maxX-minX||1)*innerW;
    const yScale = y => top + (1-(y-minY)/(maxY-minY||1))*innerH;

    // Grid
    const grid = document.createElementNS('http://www.w3.org/2000/svg','g');
    grid.setAttribute('stroke', '#223'); grid.setAttribute('stroke-width','1'); grid.setAttribute('opacity','0.6');
    for(let i=0;i<=6;i++){
      const y = top + i*(innerH/6);
      const l = line(left,y, left+innerW, y); l.setAttribute('stroke','#1f2447'); grid.appendChild(l);
    }
    svg.appendChild(grid);
    // Axes
    svg.appendChild(line(left, top, left, top+innerH, '#2a3161'));
    svg.appendChild(line(left, top+innerH, left+innerW, top+innerH, '#2a3161'));

    // Series paths
    series.forEach((s, idx) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      const pts = s.data.sort((a,b)=>a.x-b.x);
      if (!pts.length) return;
      const d = pts.map((p,i)=>`${i?'L':'M'}${xScale(p.x)},${yScale(p.y)}`).join(' ');
      path.setAttribute('d', d);
      path.setAttribute('fill','none');
      path.setAttribute('stroke', getComputedStyle(document.documentElement).getPropertyValue(s.color?.match(/^var/)? s.color.slice(4,-1):'') || s.color || '#0ff');
      path.setAttribute('stroke-width','2.5');
      svg.appendChild(path);
      // Points
      pts.forEach(p=>{
        const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
        c.setAttribute('cx', xScale(p.x));
        c.setAttribute('cy', yScale(p.y));
        c.setAttribute('r','2.5');
        c.setAttribute('fill', s.color || 'cyan');
        svg.appendChild(c);
      });
    });

    // Minor ticks on X (every 12 months)
    for (let m=12;m<=84;m+=12){
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

  // Init
  bootstrap();
  if (!location.hash) location.hash = '#/';
  setActiveRoute(location.hash);
  // Footer year (replaces inline script to satisfy CSP)
  try {
    const yEl = document.getElementById('y');
    if (yEl) yEl.textContent = String(new Date().getFullYear());
  } catch {}

  // --- AI request helper ---
  async function askAI(question, child){
    const payload = { question, child };
    const res = await fetch('/api/ai/advice', {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('AI backend error');
    const data = await res.json();
    return data.text || 'Aucune réponse.';
  }

  async function askAIRecipes(child, prefs){
    const payload = { child, prefs };
    const res = await fetch('/api/ai/recipes', {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('AI backend error');
    const data = await res.json();
    return data.text || '';
  }

  async function askAIStory(child, opts){
    const payload = { child, ...opts };
    const res = await fetch('/api/ai/story', {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('AI backend error');
    const data = await res.json();
    return data.text || '';
  }

  // Reveal on scroll animations
  let revealObserver;
  function setupScrollAnimations(){
    try { revealObserver?.disconnect(); } catch {}
    const root = document.querySelector('.route.active') || document;
    const targets = [
      ...$$('.card', root),
      ...$$('.feature', root),
      ...$$('.step', root),
      ...$$('.testimonial', root),
      ...$$('.faq-item', root),
      ...$$('.pillar', root),
      ...$$('.chart-card', root)
    ];
    targets.forEach((el, i) => {
      if (!el.classList.contains('reveal')) {
        el.classList.add('reveal');
        if (el.classList.contains('feature') || el.classList.contains('step')) el.classList.add('fade-right');
        el.setAttribute('data-delay', String(Math.min(4, (i % 5))));
      }
    });
    revealObserver = new IntersectionObserver((entries) => {
      for (const e of entries){
        if (e.isIntersecting) e.target.classList.add('in-view');
        else e.target.classList.remove('in-view');
      }
    }, { threshold: 0.01, rootMargin: '0px 0px -10% 0px' });
    targets.forEach(t => revealObserver.observe(t));
    // ensure above-the-fold elements are visible immediately
    targets.forEach(t => {
      const r = t.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const vw = window.innerWidth || document.documentElement.clientWidth;
      if (r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0) t.classList.add('in-view');
    });
  }
})();
