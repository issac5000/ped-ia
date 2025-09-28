# Ped’IA — Mémo rapide pour l’agent

## Vision d’ensemble
- Prototype SPA livré sous forme de fichiers statiques (`index.html`, pages thématiques, assets) servis par un serveur HTTP Node maison (`api/server.js`).
- Le serveur gère aussi toutes les API côté back :
  - Proxy IA (OpenAI pour textes, Gemini pour images) avec validation d’API key et garde-fous (troncature d’entrée, limite historique, fallback quand l’IA est désactivée).
  - Routes Supabase orientées “mode invité” pour profils anonymes (création, listing, messagerie, forum, journaux parentaux).
  - Quelques services authentifiés (suppression de conversations, lookup de profils) qui exigent un JWT Supabase Bearer.
- Les tables Supabase manipulées incluent `profiles`, `children`, `child_updates`, `child_growth_*`, `parent_updates`, `family_context`, `messages`, `forum_topics`, `forum_replies`.

## Authentification & modèles d’accès
- **Profils anonymes** : identification par `code_unique` généré côté serveur (`generateAnonCode`, `MAX_ANON_ATTEMPTS`). Toute route `processAnon*` commence par `normalizeCode` + `fetchAnonProfile` qui refuse les profils déjà liés à `user_id` (donc pas utilisables si le parent s’est connecté via Supabase Auth).
- **Utilisateurs connectés** : certaines routes (`/api/messages/delete-conversation`, `/api/profiles/by-ids`) exigent un token Bearer Supabase et valident l’utilisateur via `/auth/v1/user` avant de manipuler les données.
- **Clés et configuration** :
  - `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_SERVICE_KEY`) obligatoire côté serveur pour les routes anonymes.
  - `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` utilisés côté front, avec fallback sur `assets/supabase-env.json` si les variables ne sont pas injectées (`resolveSupabaseEnv`).
  - `.env.local`/`.env` peuvent être chargés automatiquement en local (`loadLocalEnv`).

## Flux fonctionnels clés
- **Gestion enfants anonymes** (`processAnonChildrenRequest`) :
  - Actions `list`, `get`, `create`, `update`, `delete`, etc. Toutes valident l’appartenance du profil via `child.user_id === profileId`.
  - Lors de la création, insertion d’un “welcome update” automatique dans `child_updates`.
  - Les prompts IA enfant réutilisent `fetchRecentSummaries` + données de croissance (mesures OMS) pour contextualiser.
- **Messagerie anonyme** (`processAnonMessagesRequest`) :
  - Liste des conversations via un `Map` de derniers messages, récupération paresseuse des profils correspondants.
  - Actions `send`, `delete`, `recent-activity`, `get-conversation`, etc., avec sanitation stricte des contenus.
- **Forum anonyme** (`processAnonCommunityRequest`) :
  - `list` agrège topics, replies et profils (avec fallback si `show_children_count` non disponible).
  - `create-topic`, `reply` utilisent `randomUUID` côté back pour éviter la dépendance au client.
- **Journal & profil parent** (`processAnonParentUpdatesRequest`) :
  - `list` renvoie profil + updates + contexte familial pré-calculé.
  - `update-profile` autorise une mise à jour partielle + enregistrement facultatif d’une entrée `parent_updates`.
  - `buildProfileUpdatePayload` filtre/sanctionne les champs (ex. mapping camelCase → snake_case, whitelist stricte).
- **Vue synthèse famille** (`processAnonFamilyRequest`) :
  - Combine `children` + résultat de `processAnonParentUpdatesRequest` pour fournir un snapshot global.
- **Services IA** (`/api/ai`) :
  - Types : `advice`, `recipes`, `story`, `comment`, `parent-update`.
  - Chaque payload est tronqué, reformaté (`safeChildSummary`, `formatParentContextPromptLines`, `enforceWordLimit`).
  - `aiParentUpdate` applique une détection de similarité pour éviter d’écho le commentaire du parent, sinon fallback texte statique.
  - Image generation via Gemini (`generateImage`) -> extraction base64 (`extractGeminiImage`).

## Dossiers & fichiers importants
- `api/server.js` : point d’entrée HTTP + définition des routes, CORS + CSP strictes, fallback statique.
- `lib/anon-children.js` : noyau logique pour profils enfants + exports utilitaires (HttpError, supabaseRequest, etc.) réutilisés par les autres modules.
- `lib/anon-community.js`, `lib/anon-messages.js`, `lib/anon-parent-updates.js`, `lib/anon-family.js` : couches métier spécialisées, toutes basées sur les helpers de `anon-children`.
- `lib/anon-profile.js` : sanitation/formatage des mises à jour profil et utilitaires (ex. `extractAnonCode`, `sanitizeParentUpdateRow`).
- `src/data/who-curves.js` : courbes de croissance OMS (P3 → P97) utilisées pour analyses/visualisations.
- `scripts/generate-supabase-env.cjs` : utilitaire pour générer `public/assets/supabase-env.json` à partir des variables d’environnement publiques.
- Racine (`index.html`, `blog.html`, etc.) : front statique (non bundlé) consommant les APIs ci-dessus.

## Dépendances & runtime
- Runtime Node ≥ 18 (ESM natif).
- Aucune librairie côté serveur hormis `dotenv` (facultatif) ; tout repose sur les modules natifs (`http`, `crypto`, `fs/promises`).
- Appel HTTP sortant via `fetch` global Node 18.
- IA : `OPENAI_API_KEY` pour GPT-4.1-nano ; `GOOGLE_API_KEY` pour Gemini 2.5 image.

## Points d’attention / pièges
- Toujours renvoyer les en-têtes de sécurité/CORS via `send` pour éviter d’introduire un comportement divergent.
- Les routes anonymes échouent si `SUPABASE_SERVICE_ROLE_KEY` est absent — vérifier l’init de l’environnement avant tests.
- `fetchAnonProfile` rejette les comptes liés (`user_id` défini) : un code anonyme “converti” n’a plus accès aux routes invitées.
- `shouldRetryDuplicate` se déclenche sur statut 409 **ou** message contenant `duplicate key value` + `code_unique`; boucle limitée à 5 tentatives.
- `generateAnonCode` alterne lettres/chiffres sans caractères ambigus — ne pas modifier sans ajuster la validation front.
- `processAnonParentUpdatesRequest` exige `full_name` présent après mise à jour (sinon 400) ; penser à le fournir lors d’une création.
- Les filtres `in.(...)` sont construits manuellement : toujours passer par les helpers pour éviter les injections.
- Les prompts IA appliquent une troncature agressive (400–800 caractères selon champ) pour contenir la facture et respecter la politique de confidentialité.
- Gemini image : si `GOOGLE_API_KEY` absent, la route renvoie une erreur 500 explicite ; aucun fallback automatique.

## Checklist avant intervention
- Vérifier/mettre à jour `README_codex.md` si une nouvelle route ou table Supabase est introduite.
- Confirmer que les nouvelles données anonymes passent par les helpers (normalisation, sanitation, filtrage).
- Tenir compte de la CSP stricte (`script-src 'self' https://cdn.jsdelivr.net`) si ajout de scripts externes.
- Préserver la compatibilité ESM (pas de `require` côté `api/` sauf dans scripts Node CommonJS dédiés).
- Respecter la limite de taille des payloads JSON (1 Mo) pour ne pas faire échouer `parseJson`.
