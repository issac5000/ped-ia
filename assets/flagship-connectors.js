const BREAKPOINT_QUERY = '(min-width: 1100px)';
const ROOT_SELECTOR = '.flagship-content';
const IMAGE_SELECTOR = '.flagship-image-wrap';
const CARDS_SELECTOR = '.flagship-cards';
const CONNECTORS_SELECTOR = '.flagship-connectors';
const PATH_SELECTOR = '.flagship-connector-path';

const activeObservers = [];
let fallbackResizeListenerAttached = false;

function initFlagshipConnectors() {
  const root = document.querySelector(ROOT_SELECTOR);
  if (!root) return;

  const connectors = root.querySelector(CONNECTORS_SELECTOR);
  const svg = connectors?.querySelector('svg');
  const imageWrap = root.querySelector(IMAGE_SELECTOR);
  const cardsWrap = root.querySelector(CARDS_SELECTOR);
  if (!connectors || !svg || !imageWrap || !cardsWrap) return;

  const paths = Array.from(svg.querySelectorAll(PATH_SELECTOR));
  if (!paths.length) return;

  const mediaQuery = window.matchMedia ? window.matchMedia(BREAKPOINT_QUERY) : null;
  let rafId = null;

  const scheduleUpdate = () => {
    connectors.classList.remove('flagship-connectors--ready');
    if (rafId != null) return;
    rafId = window.requestAnimationFrame(runUpdate);
  };

  const runUpdate = () => {
    rafId = null;
    const isDesktop = mediaQuery ? mediaQuery.matches : window.innerWidth >= 1100;
    if (!isDesktop) {
      connectors.classList.remove('flagship-connectors--visible');
      svg.setAttribute('aria-hidden', 'true');
      return;
    }

    const contentRect = root.getBoundingClientRect();
    const imageRect = imageWrap.getBoundingClientRect();
    const cards = Array.from(cardsWrap.querySelectorAll('.flagship-card'));

    if (!contentRect.width || !imageRect.width || !cards.length) {
      connectors.classList.remove('flagship-connectors--visible');
      svg.setAttribute('aria-hidden', 'true');
      return;
    }

    connectors.classList.add('flagship-connectors--visible');
    svg.removeAttribute('aria-hidden');

    const width = Math.max(1, Math.round(contentRect.width));
    const height = Math.max(1, Math.round(contentRect.height));
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const startX = imageRect.left + imageRect.width / 2 - contentRect.left;
    const startY = imageRect.bottom - contentRect.top;

    const baseOffsets = [-32, -10, 10, 32];
    const spread = 18;

    paths.forEach((path, index) => {
      const card = cards[index];
      if (!card) {
        path.setAttribute('opacity', '0');
        path.setAttribute('d', '');
        return;
      }
      const cardRect = card.getBoundingClientRect();
      const endX = cardRect.left + cardRect.width / 2 - contentRect.left;
      const endY = cardRect.top - contentRect.top;

      const startShift = baseOffsets[index] ?? 0;
      const startAdjustedX = startX + startShift;
      const deltaX = endX - startAdjustedX;
      const deltaY = endY - startY;

      const midX = startAdjustedX + deltaX * 0.5;
      const curveWeight = Math.min(0.6, Math.max(0.25, Math.abs(deltaX) / (contentRect.width || 1)));
      const controlY1 = startY + deltaY * 0.35;
      const controlY2 = startY + deltaY * 0.82;
      const controlX1 = startAdjustedX + deltaX * 0.25 - spread * (index - (paths.length - 1) / 2) * curveWeight;
      const controlX2 = startAdjustedX + deltaX * 0.75 + spread * (index - (paths.length - 1) / 2) * curveWeight;

      const d = `M ${startAdjustedX.toFixed(2)} ${startY.toFixed(2)} C ${controlX1.toFixed(2)} ${controlY1.toFixed(2)}, ${controlX2.toFixed(2)} ${controlY2.toFixed(2)}, ${endX.toFixed(2)} ${endY.toFixed(2)}`;
      path.setAttribute('d', d);
      path.removeAttribute('opacity');
    });

    connectors.classList.add('flagship-connectors--ready');
  };

  const observeElements = (elements) => {
    if (!elements.length) return;
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(scheduleUpdate);
      elements.forEach((el) => observer.observe(el));
      activeObservers.push(observer);
    } else if (!fallbackResizeListenerAttached) {
      window.addEventListener('resize', scheduleUpdate);
      fallbackResizeListenerAttached = true;
    }
  };

  observeElements([root, imageWrap, cardsWrap, ...Array.from(cardsWrap.querySelectorAll('.flagship-card'))].filter(Boolean));

  if (mediaQuery) {
    mediaQuery.addEventListener('change', scheduleUpdate);
  } else {
    window.addEventListener('resize', scheduleUpdate);
  }

  window.addEventListener('load', scheduleUpdate, { once: true });
  window.addEventListener('hashchange', scheduleUpdate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleUpdate(); });

  scheduleUpdate();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFlagshipConnectors, { once: true });
} else {
  initFlagshipConnectors();
}
