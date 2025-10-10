const DEFAULT_PALETTE = ['#ffe1c8', '#ffcba4', '#b7d3ff', '#ffd9e6'];

function getCssPalette() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const colors = [
      cs.getPropertyValue('--orange-soft').trim(),
      cs.getPropertyValue('--orange').trim(),
      cs.getPropertyValue('--blue-pastel').trim(),
    ].filter(Boolean);
    if (colors.length) {
      colors.push('#ffd9e6');
      return colors;
    }
  } catch {}
  return DEFAULT_PALETTE.slice();
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function createRadiusSampler(stops) {
  const sorted = Array.isArray(stops) ? stops.slice().sort((a, b) => a.threshold - b.threshold) : [];
  return () => {
    const u = Math.random();
    for (const stop of sorted) {
      if (u <= stop.threshold) {
        const max = stop.max ?? (stop.min + stop.range ?? 0);
        const hi = stop.max != null ? stop.max : stop.min + (stop.range ?? 0);
        return randomBetween(stop.min, hi);
      }
    }
    const last = sorted[sorted.length - 1];
    const hi = last?.max != null ? last.max : last?.min + (last?.range ?? 0) || last?.min || 0;
    return randomBetween(last?.min || 0, hi);
  };
}

function mountBubbleField(options = {}) {
  const {
    target = document.body,
    className = '',
    pointerEvents = 'none',
    dimensionSource = 'element',
    getDimensions,
    minCount = 14,
    maxCount = 40,
    density = 52000,
    alpha = [0.1, 0.3],
    smallScreenAlpha,
    smallScreenQuery = '(max-width: 900px)',
    velocity = 0.28,
    drift = 0.04,
    wrapMargin = 20,
    spinRange = [0.001, 0.003],
    radiusStops = [
      { threshold: 0.5, min: 4, max: 11 },
      { threshold: 0.85, min: 10, max: 20 },
      { threshold: 1, min: 20, max: 38 },
    ],
  } = options;

  if (!target) return null;

  const canvas = document.createElement('canvas');
  canvas.className = className;
  if (pointerEvents) canvas.style.pointerEvents = pointerEvents;
  target.prepend(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return null;
  }

  const state = {
    target,
    canvas,
    ctx,
    parts: [],
    raf: 0,
    resize: null,
    observer: null,
    destroy() {
      try { cancelAnimationFrame(state.raf); } catch {}
      if (state.resize && typeof state.resize === 'function') {
        window.removeEventListener('resize', state.resize);
      }
      if (state.observer) {
        try { state.observer.disconnect(); } catch {}
        state.observer = null;
      }
      state.parts = [];
      try { ctx.clearRect(0, 0, canvas.width, canvas.height); } catch {}
      canvas.remove();
    },
  };

  const dimsFn = typeof getDimensions === 'function'
    ? getDimensions
    : () => {
        if (dimensionSource === 'viewport') {
          return { width: window.innerWidth, height: window.innerHeight };
        }
        const rect = target.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      };

  const updateSize = () => {
    const { width, height } = dimsFn();
    state.W = Math.max(1, width || 0);
    state.H = Math.max(1, height || 0);
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(state.W * dpr);
    canvas.height = Math.floor(state.H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.dpr = dpr;
  };

  updateSize();

  const palette = getCssPalette();
  const radiusSample = createRadiusSampler(radiusStops);
  const area = Math.max(1, state.W * state.H);
  const count = Math.max(minCount, Math.min(maxCount, Math.round(area / Math.max(1, density))));
  const isSmall = smallScreenQuery && window.matchMedia
    ? window.matchMedia(smallScreenQuery).matches
    : false;
  const alphaRange = isSmall && Array.isArray(smallScreenAlpha) ? smallScreenAlpha : alpha;
  const alphaMin = alphaRange[0] ?? 0.1;
  const alphaMax = alphaRange[1] ?? alphaMin + 0.2;
  const spinMin = spinRange[0] ?? 0.001;
  const spinMax = spinRange[1] ?? spinMin + 0.002;

  for (let i = 0; i < count; i++) {
    state.parts.push({
      x: Math.random() * state.W,
      y: Math.random() * state.H,
      r: radiusSample(),
      vx: Math.random() * velocity - velocity / 2,
      vy: Math.random() * velocity - velocity / 2,
      hue: palette[Math.floor(Math.random() * palette.length)] || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
      alpha: alphaMin + Math.random() * (alphaMax - alphaMin),
      drift: Math.random() * Math.PI * 2,
      spin: spinMin + Math.random() * (spinMax - spinMin),
    });
  }

  const step = () => {
    ctx.clearRect(0, 0, state.W, state.H);
    for (const p of state.parts) {
      p.drift += p.spin;
      p.x += p.vx + Math.cos(p.drift) * drift;
      p.y += p.vy + Math.sin(p.drift) * drift;
      if (p.x < -wrapMargin) p.x = state.W + wrapMargin;
      if (p.x > state.W + wrapMargin) p.x = -wrapMargin;
      if (p.y < -wrapMargin) p.y = state.H + wrapMargin;
      if (p.y > state.H + wrapMargin) p.y = -wrapMargin;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      ctx.fillStyle = p.hue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    state.raf = requestAnimationFrame(step);
  };

  state.raf = requestAnimationFrame(step);

  const onResize = () => {
    updateSize();
  };

  window.addEventListener('resize', onResize);
  state.resize = onResize;

  if (dimensionSource === 'element' && window.ResizeObserver) {
    const ro = new ResizeObserver(updateSize);
    ro.observe(target);
    state.observer = ro;
  }

  return state;
}

export function startViewportBubbles(options = {}) {
  return mountBubbleField({
    dimensionSource: 'viewport',
    className: 'route-canvas route-canvas-fixed',
    pointerEvents: 'none',
    density: 52000,
    minCount: 14,
    maxCount: 40,
    alpha: [0.1, 0.34],
    smallScreenAlpha: [0.08, 0.32],
    drift: 0.04,
    velocity: 0.28,
    ...options,
  });
}

export function startElementBubbles(target, options = {}) {
  if (!target) return null;
  return mountBubbleField({
    target,
    dimensionSource: 'element',
    className: 'route-canvas',
    pointerEvents: 'none',
    density: 52000,
    minCount: 14,
    maxCount: 40,
    alpha: [0.1, 0.34],
    smallScreenAlpha: [0.08, 0.32],
    drift: 0.04,
    velocity: 0.28,
    ...options,
  });
}

export function startLogoBubbles(target, options = {}) {
  if (!target) return null;
  return mountBubbleField({
    target,
    dimensionSource: 'element',
    className: 'logo-canvas',
    pointerEvents: 'none',
    density: 20000,
    minCount: 6,
    maxCount: 16,
    alpha: [0.1, 0.3],
    smallScreenAlpha: options.smallScreenAlpha || [0.1, 0.3],
    drift: 0.03,
    velocity: 0.25,
    wrapMargin: 20,
    radiusStops: [
      { threshold: 0.5, min: 3, max: 8 },
      { threshold: 0.85, min: 8, max: 16 },
      { threshold: 1, min: 16, max: 28 },
    ],
    ...options,
  });
}

export function stopBubbles(controller) {
  if (!controller) return;
  try {
    controller.destroy?.();
  } catch {}
}

export { mountBubbleField };
