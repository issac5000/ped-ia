# Ped’IA — Mémo rapide pour l’agent

## Ce qui a changé avec la dernière mise à jour
- **Bilan familial IA** : nouvelle action `/api/ai?type=family-bilan` qui agrège enfants, mises à jour parentales et mesures OMS pour produire un résumé structuré, puis l’archive dans `family_context` (mise en cache locale côté front).【F:api/ai.js†L2070-L2412】【F:assets/app.js†L6322-L6874】
- **Rapport complet enfant** : endpoint `/api/ai?type=child-full-report` (timeout 20 s avec `AbortController`) combinant `child_updates`, `parent_updates`, `child_growth_with_status` et `growth_teeth` pour livrer un rapport unique par enfant.【F:api/ai.js†L2413-L2618】【F:CHANGES.md†L1-L13】
- **Likes sur le forum** : Edge Functions Supabase `likes-get|add|remove` + helper `resolveUserContext` (gère token Supabase, code unique ou `anonCode`). Le front appelle ces fonctions via `/api/edge/...` et gère l’état optimiste des boutons « 👍 ».【F:supabase/functions/_shared/likes-helpers.ts†L1-L120】【F:assets/app.js†L7195-L7307】
- **Proxy Supabase Edge & auto-discovery env** : 
  - `/api/env` va chercher l’anon key via `functions/v1/env` côté Supabase puis renvoie `{ url: '/api/edge', anonKey }` au front.【F:api/env.js†L1-L45】
  - `/api/edge/[...slug]` proxifie n’importe quelle Edge Function Supabase, choisit automatiquement clé service vs anonyme et journalise les entêtes pour debug.【F:api/edge/[...slug].js†L1-L62】
- **Génération d’images Gemini** : nouvel endpoint `/api/image` avec parse JSON tolérant, contrôle 1 Mo et extraction intelligente du base64 Gemini 2.5.【F:api/image.js†L1-L82】

Garde cette section synchronisée avec les futurs ajouts pour gagner du temps lors d’une prise en main.

## Vision d’ensemble
- Front : SPA statique (`index.html`, `assets/app.js`, pages thématiques) manipulant uniquement DOM natif + Supabase JS.
- Back Node ESM (`api/server.js`) : sert les assets, sécurise les entêtes (CSP miroir de prod) et expose les proxys IA/Supabase.
- Edge Functions Supabase (`supabase/functions`) : toutes les routes anonymes et nouvelles features communautaires vivent côté Supabase et sont appelées via `/api/edge`.
- Données clefs : `profiles`, `children`, `child_updates`, `child_growth_with_status`, `growth_teeth`, `parent_updates`, `family_context`, `messages`, `forum_topics`, `forum_replies`, `forum_reply_likes`.

## Authentification & modèles d’accès
- **Profils anonymes** :
  - Codes générés via `generateAnonCode` (alternance lettres/chiffres, pas de caractères ambigus) + retries `shouldRetryDuplicate` sur collisions.【F:api/server.js†L18-L60】
  - Tous les handlers anonymes (`processAnon*`) commencent par `normalizeCode` + `fetchAnonProfile` et rejettent les comptes liés (`user_id` renseigné).【F:lib/anon-children.js†L24-L88】
- **Utilisateurs connectés** :
  - Les actions sensibles (`messages/delete-conversation`, `profiles/by-ids`, likes) exigent un Bearer JWT Supabase validé via `auth.getUser` côté Edge (`resolveUserContext`).【F:supabase/functions/_shared/likes-helpers.ts†L18-L66】
- **Résolution des credentials** :
  - `getServiceConfig` centralise `SUPABASE_URL`/`SERVICE_ROLE_KEY` et logge toute absence avant de lever `HttpError`.
  - `/api/env` fournit l’anon key au front ; `/api/edge` choisit service vs anon suivant le slug (`anon-*` ⇒ clé publique, sinon service).【F:api/env.js†L14-L45】【F:api/edge/[...slug].js†L18-L47】
  - `loadLocalEnv` dans `api/server.js` charge `.env.local`/`.env` si disponibles pour un setup local rapide.【F:api/server.js†L62-L79】

## Flux fonctionnels clés
- **Gestion enfants anonymes** (`processAnonChildrenRequest`) : CRUD complet + welcome update, prompts IA alimentés par historiques (`fetchRecentSummaries`) et mesures OMS (`fetchGrowthDataForAnonPrompt`).【F:lib/anon-children.js†L90-L188】
- **Messagerie anonyme** (`processAnonMessagesRequest`) : Map des conversations, sanitation stricte et suppression protégée par token service.【F:lib/anon-messages.js†L1-L200】
- **Forum** :
  - Edge `anon-community` pour la création/réponse (UUID serveur).
  - Likes : `likes-get` fournit `count` + état `liked` pour un set de reply IDs, `likes-add/remove` basculent via `Prefer: resolution=merge-duplicates` et recalculent le total.【F:supabase/functions/likes-add/index.ts†L1-L72】【F:supabase/functions/likes-remove/index.ts†L1-L78】
- **Journal & profil parent** (`processAnonParentUpdatesRequest`) : renvoie profil + updates + dernier `family_context`. `buildProfileUpdatePayload` sécurise camelCase → snake_case et whitelists les champs.【F:lib/anon-parent-updates.js†L1-L220】
- **Vue synthèse famille** (`processAnonFamilyRequest`) : combine enfants + réponse parent updates ; requête Edge accessible via `/api/edge/anon-family`.【F:supabase/functions/_shared/anon-family.ts†L1-L54】
- **Bilan familial IA** : collecte parent/children/growth, construit prompt `family-bilan`, appelle GPT-4.1-nano, tronque à 4 000 caractères, enregistre dans `family_context` (avec journalisation tokens/temps).【F:api/ai.js†L2070-L2412】
- **Rapport complet enfant** : agrège jusqu’à 15 `child_updates`, 5 `parent_updates`, dernières mesures + dents, applique timeout 20 s, log par étape (`config`, `updates`, `parent-updates`, `growth`, `openai`).【F:api/ai.js†L2413-L2618】【F:CHANGES.md†L1-L13】
- **Services IA existants** : `advice`, `recipes`, `story`, `comment`, `parent-update` conservent les mêmes garde-fous (`safeChildSummary`, `enforceWordLimit`).【F:api/ai.js†L1-L2069】
- **Images Gemini** : `/api/image` lit le corps brut, limite à 1 Mo, journalise les erreurs et retourne `image` + `mime`. Aucun fallback si `GOOGLE_API_KEY` manquant.【F:api/image.js†L1-L82】

## Dossiers & fichiers importants
- `api/server.js` : serveur HTTP + routes, CSP stricte, parsing JSON limité à 1 Mo, extraction Gemini (`extractGeminiImage`).【F:api/server.js†L1-L188】
- `api/ai.js` : cœur IA (tous les prompts + orchestrations Supabase/AI, dont `family-bilan` et `child-full-report`).
- `api/env.js`, `api/edge/[...slug].js`, `api/image.js` : nouveaux proxys (env, Edge Functions, Gemini).
- `lib/anon-*.js` : logique métier réutilisable, exporte `HttpError`, `supabaseRequest`, helpers growth/prompt.
- `supabase/functions/**` : Edge Functions déployées (anonymes, likes, env, messages, profils) — code TypeScript Deno.
- `assets/app.js` : front (≈9k lignes) — binding UI, caches `family_context`, orchestrations likes, appels `/api/edge`.
- `src/data/who-curves.js` : courbes OMS utilisées pour growth status dans les prompts.

## Dépendances & runtime
- Node ≥ 18 (ESM natif, `fetch` global) côté serveur.
- Côté Edge : Deno 1.37 (std@0.208.0) + `@supabase/supabase-js@2` importé via `esm.sh`.
- Pas de dépendances Node additionnelles (hors `dotenv` optionnel). IA = `OPENAI_API_KEY` (GPT-4.1-nano) + `GOOGLE_API_KEY` pour Gemini 2.5 image.

## Points d’attention / pièges
- Toujours passer par `send`/en-têtes CORS (`api/server.js`) pour rester aligné sur la prod (CSP stricte : `script-src 'self' https://cdn.jsdelivr.net`).
- Les routes anonymes/Edge échouent sans `SUPABASE_SERVICE_ROLE_KEY` ⇒ vérifier l’environnement avant tests. `resolveUserContext` retourne 401/400 si le code/token manque ou est invalide.
- `fetchAnonProfile` rejette les comptes où `user_id` est défini : un compte anonyme « converti » perd l’accès aux routes invitées.
- `shouldRetryDuplicate` boucle max 5 tentatives sur 409/`duplicate key value` (case `code_unique`).
- `processAnonParentUpdatesRequest` exige `full_name` non vide lors d’une update — sinon 400.
- Les prompts IA tronquent agressivement (400–800 caractères selon champ) → surveiller lors de nouveaux champs texte.
- `child-full-report` a un timeout 20 s : ne pas bloquer la boucle d’event, éviter les fetchs séquentiels inutiles.
- `/api/image` détruit la connexion si payload > 1 Mo ; log explicite si `GOOGLE_API_KEY` absent.
- Likes : penser à fournir soit un Bearer token Supabase, soit `anonCode`/`code` lors des appels Edge sinon 401.

## Checklist avant intervention
- Tenir ce `README_codex.md` à jour dès qu’une nouvelle route, table ou Edge Function est introduite.
- Confirmer que toute donnée anonyme passe par les helpers `lib/anon-*` (normalisation/sanitation) ou par les Edge Functions partagées.
- Vérifier la cohérence CSP/headers si ajout de scripts externes ou modifications `api/server.js`.
- Préserver la compatibilité ESM (pas de `require` côté `api/` ; CommonJS autorisé seulement dans `scripts/`).
- Respecter la limite 1 Mo des payloads JSON (`parseJson`, `/api/image`).
- Tester les nouveautés IA en environnement disposant des clés (`OPENAI_API_KEY`, `GOOGLE_API_KEY`) + service key Supabase.
