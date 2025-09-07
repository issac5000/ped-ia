// Ped’IA SPA — Front‑only prototype with localStorage
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const routes = ["/", "/signup", "/login", "/onboarding", "/dashboard", "/community", "/compare", "/settings"];

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
    session: 'pedia_session'
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
    // Guard routes
    const session = store.get(K.session);
    const authed = !!session?.loggedIn;
    const needAuth = ['/dashboard','/community','/compare','/settings','/onboarding'];
    if (needAuth.includes(path) && !authed) {
      location.hash = '#/signup';
      return;
    }
    // Page hooks
    if (path === '/onboarding') renderOnboarding();
    if (path === '/dashboard') renderDashboard();
    if (path === '/community') renderCommunity();
    if (path === '/compare') renderCompare();
    if (path === '/settings') renderSettings();
  }

  window.addEventListener('hashchange', () => setActiveRoute(location.hash));

  // Header auth buttons
  function updateHeaderAuth() {
    const session = store.get(K.session);
    $('#btn-login').hidden = !!session?.loggedIn;
    $('#btn-logout').hidden = !session?.loggedIn;
  }
  $('#btn-login').addEventListener('click', () => { location.hash = '#/login'; });
  $('#btn-logout').addEventListener('click', () => { logout(); });

  // Auth flows
  $('#form-signup')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const user = {
      email: fd.get('email').toString().trim().toLowerCase(),
      password: fd.get('password').toString(),
      role: fd.get('role').toString(),
      childIds: [],
      primaryChildId: null,
    };
    store.set(K.user, user);
    store.set(K.session, { loggedIn: true });
    alert('Compte créé. Créons le profil de votre enfant.');
    location.hash = '#/onboarding';
  });

  $('#form-login')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = fd.get('email').toString().trim().toLowerCase();
    const pass = fd.get('password').toString();
    const saved = store.get(K.user);
    if (saved && saved.email === email && saved.password === pass) {
      store.set(K.session, { loggedIn: true });
      alert('Connexion réussie.');
      location.hash = '#/dashboard';
    } else {
      alert('Identifiants incorrects ou compte inexistant.');
    }
  });

  function logout() {
    store.set(K.session, { loggedIn: false });
    alert('Déconnecté.');
    updateHeaderAuth();
    location.hash = '#/login';
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
      const child = {
        id: genId(),
        firstName: fd.get('firstName').toString().trim(),
        sex: fd.get('sex').toString(),
        dob: fd.get('dob').toString(),
        photo: photoDataUrl,
        context: {
          allergies: fd.get('allergies').toString(),
          history: fd.get('history').toString(),
          care: fd.get('care').toString(),
          languages: fd.get('languages').toString(),
        },
        milestones: DEV_QUESTIONS.map((_, i) => !!fd.get(`dev_${i}`)),
        growth: {
          measurements: [], // {month, height, weight}
          sleep: [], // {month, hours}
          teeth: [], // {month, count}
        },
        createdAt: Date.now(),
      };
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
            <a class="btn btn-secondary" href="#/compare">Voir le comparateur</a>
            <a class="btn btn-secondary" href="#/community">Aller à la communauté</a>
          </div>
        </div>
      </div>

      <div class="grid-2" style="margin-top:12px">
        <div class="card stack">
          <h3>Assistant IA</h3>
          <p class="muted">Posez une question (sommeil, alimentation, repères…). Réponse non médicale.</p>
          <form id="form-ai" class="form-grid">
            <label>Votre question
              <textarea name="q" rows="3" placeholder="Ex: Mon enfant de ${ageTxt} se réveille la nuit, que faire ?" required></textarea>
            </label>
            <div class="hstack">
              <button class="btn btn-primary" type="submit">Demander à l’IA</button>
              <span id="ai-status" class="muted"></span>
            </div>
          </form>
          <div id="ai-answer" class="card"></div>
        </div>
      </div>
    `;

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

    // Assistant IA
    const formAI = $('#form-ai');
    const elStatus = $('#ai-status');
    const elAnswer = $('#ai-answer');
    formAI?.addEventListener('submit', async (e) => {
      e.preventDefault();
      elStatus.textContent = 'Réflexion en cours…';
      elAnswer.textContent = '';
      const q = new FormData(formAI).get('q').toString().trim();
      try {
        const res = await askAI(q, child);
        elAnswer.innerHTML = `<div>${res.replace(/\n/g,'<br/>')}</div>`;
        elStatus.textContent = '';
      } catch (err) {
        elStatus.textContent = '';
        elAnswer.innerHTML = `<div class="muted">Serveur IA indisponible. ${renderAdvice(ageM)}</div>`;
      }
    });
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

  // Compare
  function renderCompare() {
    const user = store.get(K.user);
    const children = store.get(K.children, []);
    const child = children.find(c=>c.id===user?.primaryChildId) || children[0];
    const dom = $('#compare-content');
    if (!child) { dom.innerHTML = '<div class="card">Ajoutez un enfant pour comparer.</div>'; return; }

    // Community mean: across local children
    const msChild = normalizeMeasures(child.growth.measurements);
    const monthly = new Map();
    children.forEach(c => {
      normalizeMeasures(c.growth.measurements).forEach(m => {
        const k = m.month;
        const v = monthly.get(k) || {month:k, h:[], w:[]};
        if (typeof m.height==='number') v.h.push(m.height);
        if (typeof m.weight==='number') v.w.push(m.weight);
        monthly.set(k, v);
      })
    });
    const avg = (arr)=> arr.length? arr.reduce((a,b)=>a+b,0)/arr.length : undefined;
    const communityH = Array.from(monthly.values()).map(v=>({x:v.month,y:avg(v.h)})).filter(p=>Number.isFinite(p.y)).sort((a,b)=>a.x-b.x);
    const communityW = Array.from(monthly.values()).map(v=>({x:v.month,y:avg(v.w)})).filter(p=>Number.isFinite(p.y)).sort((a,b)=>a.x-b.x);

    dom.innerHTML = `
      <div class="grid-2">
        <div class="card chart-card">
          <div class="chart-header">
            <h3>Taille (cm)</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>${child.firstName}</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--orange)"></span>Moy. communauté</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet)"></span>OMS médiane</span>
            </div>
          </div>
          <svg class="chart" id="cmp-h"></svg>
        </div>
        <div class="card chart-card">
          <div class="chart-header">
            <h3>Poids (kg)</h3>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot" style="background:var(--turquoise)"></span>${child.firstName}</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--orange)"></span>Moy. communauté</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--violet)"></span>OMS médiane</span>
            </div>
          </div>
          <svg class="chart" id="cmp-w"></svg>
        </div>
      </div>
    `;

    drawMulti($('#cmp-h'), [
      { color: 'var(--turquoise)', data: msChild.map(m=>({x:m.month,y:m.height})).filter(p=>Number.isFinite(p.y)) },
      { color: 'var(--orange)', data: communityH },
      { color: 'var(--violet)', data: whoSeries('height') },
    ]);

    drawMulti($('#cmp-w'), [
      { color: 'var(--turquoise)', data: msChild.map(m=>({x:m.month,y:m.weight})).filter(p=>Number.isFinite(p.y)) },
      { color: 'var(--orange)', data: communityW },
      { color: 'var(--violet)', data: whoSeries('weight') },
    ]);
  }

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
        <button class="btn btn-secondary" data-primary="${c.id}">Définir comme principal</button>
        <button class="btn btn-danger" data-del="${c.id}">Supprimer</button>
      `;
      list.appendChild(row);
    });
    list.addEventListener('click', (e)=>{
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const idP = target.getAttribute('data-primary');
      const idD = target.getAttribute('data-del');
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
})();
