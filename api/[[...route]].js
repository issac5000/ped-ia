import handleAi from '../lib/api-handlers/ai.js';
import handleChildUpdates from '../lib/api-handlers/child-updates.js';
import handleEnv from '../lib/api-handlers/env.js';
import handleProfileEnsure from '../lib/api-handlers/profile-ensure.js';
import handleImage from '../lib/api-handlers/image.js';
import handleAnonChildren from '../lib/api-handlers/anon/children.js';
import handleAnonCommunity from '../lib/api-handlers/anon/community.js';
import handleAnonFamily from '../lib/api-handlers/anon/family.js';
import handleAnonMessages from '../lib/api-handlers/anon/messages.js';
import handleAnonParentUpdates from '../lib/api-handlers/anon/parent-updates.js';
import handleMessagesDeleteConversation from '../lib/api-handlers/messages/delete-conversation.js';
import handleProfilesCreateAnon from '../lib/api-handlers/profiles/create-anon.js';
import handleProfilesByIds from '../lib/api-handlers/profiles/by-ids.js';

// Routeur unique pour le plan Hobby Vercel.
// Les anciens fichiers fusionnés conservent leurs URLs publiques :
//   • /api/ai                (ancien api/ai.js)
//   • /api/child-updates     (ancien api/child-updates.js)
//   • /api/env               (ancien api/env.js)
//   • /api/profile-ensure    (nouvelle route garantissant un profil Supabase)
//   • /api/image             (ancien api/image.js)
//   • /api/messages/delete-conversation (ancien api/messages/delete-conversation.js)
//   • /api/profiles/create-anon         (ancien api/profiles/create-anon.js)
//   • /api/profiles/by-ids             (ancien api/profiles/by-ids.js)
//   • /api/anon/children               (ancien api/anon/children.js)
//   • /api/anon/community              (ancien api/anon/community.js)
//   • /api/anon/family                 (ancien api/anon/family.js)
//   • /api/anon/messages               (ancien api/anon/messages.js)
//   • /api/anon/parent-updates         (ancien api/anon/parent-updates.js)
// Chaque handler est délégué à la logique d’origine et un 404 explicite est renvoyé quand aucune sous-route ne correspond.

export default async function unifiedApiRouter(req, res) {
  const pathname = normalizePath(extractPathname(req));

  if (pathname === '/api/ai') return handleAi(req, res);
  if (pathname === '/api/child-updates') return handleChildUpdates(req, res);
  if (pathname === '/api/env') return handleEnv(req, res);
  if (pathname === '/api/profile-ensure') return handleProfileEnsure(req, res);
  if (pathname === '/api/image') return handleImage(req, res);

  if (pathname.startsWith('/api/anon')) {
    const subPath = stripTrailingSlash(pathname.slice('/api/anon'.length));
    switch (subPath) {
      case '/children':
        return handleAnonChildren(req, res);
      case '/community':
        return handleAnonCommunity(req, res);
      case '/family':
        return handleAnonFamily(req, res);
      case '/messages':
        return handleAnonMessages(req, res);
      case '/parent-updates':
        return handleAnonParentUpdates(req, res);
      case '':
        return sendNotFound(res);
      default:
        return sendNotFound(res);
    }
  }

  if (pathname.startsWith('/api/messages')) {
    const subPath = stripTrailingSlash(pathname.slice('/api/messages'.length));
    switch (subPath) {
      case '/delete-conversation':
        return handleMessagesDeleteConversation(req, res);
      case '':
        return sendNotFound(res);
      default:
        return sendNotFound(res);
    }
  }

  if (pathname.startsWith('/api/profiles')) {
    const subPath = stripTrailingSlash(pathname.slice('/api/profiles'.length));
    switch (subPath) {
      case '/create-anon':
        return handleProfilesCreateAnon(req, res);
      case '/by-ids':
        return handleProfilesByIds(req, res);
      case '':
        return sendNotFound(res);
      default:
        return sendNotFound(res);
    }
  }

  if (pathname === '/api' || pathname === '/api/') {
    return sendNotFound(res);
  }

  return sendNotFound(res);
}

function extractPathname(req) {
  try {
    return new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  } catch {
    return typeof req.url === 'string' ? req.url : '';
  }
}

function normalizePath(pathname) {
  if (!pathname) return '';
  const collapsed = pathname.replace(/\/+/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.replace(/\/+$/, '');
  }
  return collapsed;
}

function stripTrailingSlash(path) {
  if (!path) return '';
  if (path === '/') return '/';
  return path.endsWith('/') ? path.replace(/\/+$/, '') : path;
}

function sendNotFound(res) {
  if (!res.headersSent) {
    try {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    } catch {}
  }
  res.statusCode = 404;
  if (typeof res.status === 'function') {
    return res.status(404).json({ error: 'Not Found' });
  }
  res.end(JSON.stringify({ error: 'Not Found' }));
  return undefined;
}
