document.body.classList.remove('no-js');
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function setupHeader(){
  const navBtn = $('#nav-toggle');
  const mainNav = $('#main-nav');
  const navBackdrop = $('#nav-backdrop');
  navBtn?.addEventListener('click', ()=>{
    const isOpen = mainNav?.classList.toggle('open');
    navBtn.setAttribute('aria-expanded', String(!!isOpen));
    if(isOpen) navBackdrop?.classList.add('open'); else navBackdrop?.classList.remove('open');
  });
  $$('#main-nav .nav-link').forEach(a=>a.addEventListener('click', ()=>{
    if(mainNav?.classList.contains('open')){
      mainNav.classList.remove('open');
      navBtn?.setAttribute('aria-expanded','false');
      navBackdrop?.classList.remove('open');
    }
  }));
  navBackdrop?.addEventListener('click', ()=>{
    mainNav?.classList.remove('open');
    navBtn?.setAttribute('aria-expanded','false');
    navBackdrop?.classList.remove('open');
  });
}

function evaluateHeaderFit(){
  try{
    const header = document.querySelector('.header-inner');
    const brand = header?.querySelector('.brand');
    const nav = header?.querySelector('#main-nav');
    const auth = header?.querySelector('.auth-actions');
    if(!header || !brand || !nav || !auth) return;
    const padding = 40;
    const cs = getComputedStyle(header);
    const areas = (cs.gridTemplateAreas || '').toString();
    const twoRowLayout = areas.includes('nav');
    let needMobile = false;
    if(twoRowLayout){
      needMobile = nav.scrollWidth > header.clientWidth;
    } else {
      const total = brand.offsetWidth + nav.scrollWidth + auth.offsetWidth + padding;
      needMobile = total > header.clientWidth;
    }
    document.body.classList.toggle('force-mobile', needMobile);
  }catch(e){}
}

function onViewportChange(){
  if(window.innerWidth >= 900) document.body.classList.remove('force-mobile');
  evaluateHeaderFit();
  const isMobile = document.body.classList.contains('force-mobile');
  const mainNav = $('#main-nav');
  const navBtn = $('#nav-toggle');
  const navBackdrop = $('#nav-backdrop');
  if(!isMobile){
    mainNav?.classList.remove('open');
    navBtn?.setAttribute('aria-expanded','false');
    navBackdrop?.classList.remove('open');
    if(mainNav) mainNav.style.removeProperty('display');
  }
}

window.addEventListener('resize', onViewportChange);
window.addEventListener('orientationchange', onViewportChange);
let resizeRaf=null;
window.addEventListener('resize', ()=>{
  if(resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(onViewportChange);
});
window.addEventListener('load', evaluateHeaderFit);

// Soft pastel particles over entire page
let routeParticles = { cvs: null, ctx: null, parts: [], raf: 0, resize: null, W: 0, H: 0 };
function startRouteParticles(){
  try{
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cvs = document.createElement('canvas');
    cvs.className = 'route-canvas route-canvas-fixed';
    cvs.style.pointerEvents = 'none';
    document.body.prepend(cvs);
    const ctx = cvs.getContext('2d');
    const state = routeParticles;
    state.cvs = cvs; state.ctx = ctx; state.parts = [];
    function resize(){
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio||1));
      state.W = window.innerWidth; state.H = window.innerHeight;
      cvs.width = Math.floor(state.W*dpr); cvs.height = Math.floor(state.H*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
    }
    resize();
    state.resize = resize;
    window.addEventListener('resize', resize);
    const cs = getComputedStyle(document.documentElement);
    const palette = [
      cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
      cs.getPropertyValue('--orange').trim()||'#ffcba4',
      cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
      '#ffd9e6'
    ];
    const area = Math.max(1, state.W*state.H);
    const N = Math.max(14, Math.min(40, Math.round(area/52000)));
    for(let i=0;i<N;i++){
      const u=Math.random();
      const r = u<.5 ? (4+Math.random()*7) : (u<.85 ? (10+Math.random()*10) : (20+Math.random()*18));
      state.parts.push({
        x:Math.random()*state.W,
        y:Math.random()*state.H,
        r,
        vx:(Math.random()*.28-.14),
        vy:(Math.random()*.28-.14),
        hue:palette[Math.floor(Math.random()*palette.length)],
        alpha:.10+Math.random()*.20,
        drift:Math.random()*Math.PI*2,
        spin:.001+Math.random()*.003
      });
    }
    const step=()=>{
      ctx.clearRect(0,0,state.W,state.H);
      for(const p of state.parts){
        p.drift += p.spin;
        p.x += p.vx + Math.cos(p.drift)*.04;
        p.y += p.vy + Math.sin(p.drift)*.04;
        if(p.x<-20) p.x=state.W+20; if(p.x>state.W+20) p.x=-20;
        if(p.y<-20) p.y=state.H+20; if(p.y>state.H+20) p.y=-20;
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.hue;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      }
      state.raf = requestAnimationFrame(step);
    };
    step();
  }catch(e){}
}

// Particles around page logo
let logoParticles = { cvs:null, ctx:null, parts:[], raf:0, resize:null, W:0, H:0 };
function startLogoParticles(){
  try{
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const wrap = document.querySelector('#page-logo .container');
    if(!wrap) return;
    const cvs = document.createElement('canvas');
    cvs.className='logo-canvas';
    cvs.style.pointerEvents = 'none';
    wrap.prepend(cvs);
    const ctx = cvs.getContext('2d');
    const state = logoParticles;
    state.cvs=cvs; state.ctx=ctx; state.parts=[];
    function resize(){
      const dpr=Math.max(1, Math.min(2, window.devicePixelRatio||1));
      state.W=wrap.clientWidth; state.H=wrap.clientHeight;
      cvs.width=Math.floor(state.W*dpr); cvs.height=Math.floor(state.H*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
    }
    resize();
    state.resize=resize;
    window.addEventListener('resize', resize);
    const cs = getComputedStyle(document.documentElement);
    const palette=[
      cs.getPropertyValue('--orange-soft').trim()||'#ffe1c8',
      cs.getPropertyValue('--orange').trim()||'#ffcba4',
      cs.getPropertyValue('--blue-pastel').trim()||'#b7d3ff',
      '#ffd9e6'
    ];
    const area=Math.max(1,state.W*state.H);
    const N=Math.max(6, Math.min(16, Math.round(area/20000)));
    for(let i=0;i<N;i++){
      const u=Math.random();
      const r=u<.5?(3+Math.random()*5):(u<.85?(8+Math.random()*8):(16+Math.random()*12));
      state.parts.push({
        x:Math.random()*state.W,
        y:Math.random()*state.H,
        r,
        vx:(Math.random()*.25-.125),
        vy:(Math.random()*.25-.125),
        hue:palette[Math.floor(Math.random()*palette.length)],
        alpha:.10+Math.random()*.20,
        drift:Math.random()*Math.PI*2,
        spin:.001+Math.random()*.003
      });
    }
    const step=()=>{
      ctx.clearRect(0,0,state.W,state.H);
      for(const p of state.parts){
        p.drift+=p.spin;
        p.x+=p.vx+Math.cos(p.drift)*.03;
        p.y+=p.vy+Math.sin(p.drift)*.03;
        if(p.x<-20) p.x=state.W+20; if(p.x>state.W+20) p.x=-20;
        if(p.y<-20) p.y=state.H+20; if(p.y>state.H+20) p.y=-20;
        ctx.globalAlpha=p.alpha; ctx.fillStyle=p.hue;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      }
      state.raf=requestAnimationFrame(step);
    };
    step();
  }catch(e){}
}

function init(){
  setupHeader();
  evaluateHeaderFit();
  const yEl = document.getElementById('y');
  if(yEl) yEl.textContent = new Date().getFullYear();
  const pl = document.getElementById('page-logo');
  if(pl) pl.hidden = false;
  startRouteParticles();
  startLogoParticles();
}

window.addEventListener('load', init);

