const ARTICLES = [
  {
    slug: 'les-1000-premiers-jours',
    title: 'Les 1000 premiers jours',
    excerpt: "Comprendre l’importance des débuts de la vie.",
    cover: 'jours1000.png',
    coverAlt: 'Les 1000 premiers jours',
    source: '/les-1000-premiers-jours.html',
  },
  {
    slug: 'la-theorie-de-l-esprit',
    title: 'La théorie de l’esprit',
    excerpt: 'Explorer comment les enfants comprennent les autres.',
    cover: 'esprit.png',
    coverAlt: 'La théorie de l’esprit',
    source: '/la-theorie-de-l-esprit.html',
  },
  {
    slug: 'la-theorie-de-l-attachement',
    title: 'La théorie de l’attachement',
    excerpt: 'Explorer les fondements du lien affectif.',
    cover: 'attachement.png',
    coverAlt: 'La théorie de l’attachement',
    source: '/la-theorie-de-l-attachement.html',
  },
];

const articleCache = new Map();

const normalizeSlug = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  return trimmed.toLowerCase();
};

export function getArticlesList() {
  return ARTICLES.map(({ slug, title, excerpt, cover, coverAlt }) => ({
    slug,
    title,
    excerpt,
    cover,
    coverAlt,
  }));
}

export function getArticleMetadata(slug) {
  const safeSlug = normalizeSlug(slug);
  return ARTICLES.find(article => article.slug === safeSlug) || null;
}

function extractMainContent(html) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const main = doc.querySelector('main');
    const content = main ? main.innerHTML : doc.body?.innerHTML || '';
    return content.trim();
  } catch (err) {
    console.warn('Impossible d’extraire le contenu de l’article', err);
    return '';
  }
}

export async function loadArticleContent(slug) {
  const safeSlug = normalizeSlug(slug);
  if (!safeSlug) return null;
  if (articleCache.has(safeSlug)) {
    return articleCache.get(safeSlug);
  }
  const meta = getArticleMetadata(safeSlug);
  if (!meta) return null;
  const source = meta.source || `/${safeSlug}.html`;
  try {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Article introuvable (${response.status})`);
    }
    const text = await response.text();
    const content = extractMainContent(text);
    const payload = { ...meta, content };
    articleCache.set(safeSlug, payload);
    return payload;
  } catch (err) {
    console.warn('loadArticleContent failed', err);
    const payload = { ...meta, content: '', error: err?.message || 'Chargement impossible.' };
    articleCache.set(safeSlug, payload);
    return payload;
  }
}

function renderStandaloneList(root) {
  if (!root) return;
  const articles = getArticlesList();
  const fragment = document.createDocumentFragment();
  for (const article of articles) {
    const li = document.createElement('li');
    li.className = 'card blog-card';
    const link = document.createElement('a');
    link.className = 'blog-card-link';
    link.href = `#/articles/${article.slug}`;
    const img = document.createElement('img');
    img.className = 'blog-card-img';
    img.src = article.cover;
    img.alt = article.coverAlt || article.title;
    img.loading = 'lazy';
    img.decoding = 'async';
    const content = document.createElement('div');
    content.className = 'blog-card-content';
    const title = document.createElement('h3');
    title.textContent = article.title;
    const excerpt = document.createElement('p');
    excerpt.textContent = article.excerpt;
    content.appendChild(title);
    content.appendChild(excerpt);
    link.appendChild(img);
    link.appendChild(content);
    li.appendChild(link);
    fragment.appendChild(li);
  }
  root.innerHTML = '';
  root.appendChild(fragment);
}

function updateFooterYear() {
  const target = document.getElementById('y');
  if (target) {
    target.textContent = new Date().getFullYear();
  }
}

function mountStandalonePage() {
  const list = document.querySelector('[data-blog-list]');
  if (list) {
    renderStandaloneList(list);
  }
  updateFooterYear();
}

if (typeof window !== 'undefined' && document.readyState !== 'loading') {
  mountStandalonePage();
} else if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', mountStandalonePage, { once: true });
}

export function prefetchArticle(slug) {
  const safeSlug = normalizeSlug(slug);
  if (!safeSlug || articleCache.has(safeSlug)) return;
  loadArticleContent(safeSlug).catch(() => {});
}
