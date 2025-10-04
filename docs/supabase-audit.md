# Audit Supabase — Synap’Kids (commit stable)

## (A) Schéma Supabase attendu

### Tables & vues principales

- **`public.profiles`** — stocke les parents (authentifiés ou anonymes). Champs attendus : `id` (UUID, = `auth.uid()` pour les comptes connectés), `user_id` (UUID nullable), `code_unique` (texte unique pour les anonymes), `full_name`, `avatar_url`, `parent_role`, `show_children_count`, `marital_status`, `number_of_children`, `parental_employment`, `parental_emotion`, `parental_stress`, `parental_fatigue`, `context_parental`, `created_at`, `updated_at`. Les mises à jour anonymes utilisent ces colonnes via `PROFILE_SELECT` et `buildProfileUpdatePayload`.【F:lib/anon-parent-updates.js†L14-L149】【F:lib/anon-profile.js†L1-L109】
- **`public.children`** — profils enfants reliés à `profiles`. Champs requis : `id` (UUID défaut), `user_id` (UUID → `profiles.id`), `first_name`, `sex` (smallint), `dob` (date), `photo_url`, `context_allergies`, `context_history`, `context_care`, `context_languages`, `feeding_type`, `eating_style`, `sleep_sleeps_through`, `sleep_bedtime`, `sleep_falling`, `sleep_night_wakings`, `sleep_wake_duration`, `milestones` (bool[]), `is_primary` (bool), `created_at`, `updated_at`. Les helpers `sanitizeChildInsert`/`sanitizeChildUpdate` normalisent précisément ces colonnes.【F:lib/anon-children.js†L483-L557】 Les actions anonymes consomment ce schéma pour listage, lecture, création, mise à jour et suppression.【F:lib/anon-children.js†L722-L919】
- **`public.growth_measurements`** — suivi mensuel taille/poids : colonnes `child_id`, `month` (int), `height_cm`, `weight_kg`, `created_at`. Upsert sur `(child_id, month)` utilisé lors des créations/mises à jour enfants.【F:lib/anon-children.js†L572-L881】
- **`public.growth_sleep`** — heures de sommeil mensuelles (`child_id`, `month`, `hours`, `created_at`).【F:lib/anon-children.js†L616-L903】
- **`public.growth_teeth`** — nombre de dents par mois (`child_id`, `month`, `count`, `created_at`).【F:lib/anon-children.js†L600-L893】
- **`public.child_updates`** — journal IA enfant : `id`, `child_id`, `update_type`, `update_content` (JSON texte), `ai_summary`, `ai_commentaire`, `created_at`. Consommé par le front et les Edge Functions (`child-updates`).【F:CHANGES.md†L4-L8】【F:supabase/functions/child-updates/index.ts†L76-L115】
- **`public.parent_updates`** — journal parent : `id`, `profile_id`, `child_id` (nullable), `update_type`, `update_content`, `parent_comment`, `ai_commentaire`, `created_at`. Listé/inséré par les helpers anonymes et par le front connecté.【F:lib/anon-parent-updates.js†L39-L149】【F:assets/app.js†L4528-L4609】
- **`public.family_context`** — cache des bilans IA : `profile_id`, `ai_bilan`, `children_ids` (uuid[]), `last_generated_at`. Récupéré côté parent updates.【F:lib/anon-parent-updates.js†L48-L64】【F:assets/app.js†L6736-L6753】
- **`public.messages`** — messagerie privée : `id`, `sender_id`, `receiver_id`, `content`, `created_at`. L’anonyme comme le connecté listent, insèrent et suppriment via les helpers et Edge Function `messages-delete-conversation`.【F:lib/anon-messages.js†L100-L233】【F:supabase/functions/messages-delete-conversation/index.ts†L48-L82】
- **`public.forum_topics`** — fils communautaires : `id`, `user_id`, `title`, `content`, `created_at`. Utilisé pour listage, création, suppression.【F:lib/anon-community.js†L87-L219】【F:assets/app.js†L8059-L8074】
- **`public.forum_replies`** — réponses : `id`, `topic_id`, `user_id`, `content`, `created_at`. Filtres `order`, `in()` et suppression en cascade attendus.【F:lib/anon-community.js†L95-L209】【F:assets/app.js†L8067-L8087】
- **`public.forum_reply_likes`** — likes : `reply_id`, `user_id`, `created_at`. Doit avoir contrainte d’unicité `(reply_id, user_id)` pour l’option `Prefer: resolution=merge-duplicates` utilisée dans `likes-add`.【F:supabase/functions/likes-add/index.ts†L63-L70】【F:supabase/functions/_shared/likes-helpers.ts†L141-L148】
- **Vue `public.profiles_with_children`** — expose `id`, `full_name`, `children_count`, `show_children_count` pour l’affichage communautaire, avec fallback vers l’Edge `profiles-by-ids` si la vue échoue.【F:assets/app.js†L8081-L8178】
- **Vue `public.child_growth_with_status`** — retourne `child_id`, `agemos`, `height_cm`, `weight_kg`, `status_weight`, `status_height`, `status_global`, `recorded_at`, `created_at` pour les graphiques OMS et les prompts IA.【F:lib/anon-children.js†L140-L178】【F:api/ai.js†L2472-L2505】

### Fonctions & Edge requirements

- **Edge `profiles-create-anon`** dépend d’un insert direct dans `public.profiles` avec un code unique et gère les collisions (`23505`).【F:supabase/functions/profiles-create-anon/index.ts†L108-L140】 Nécessite que l’insert soit autorisé via la clé service et que `code_unique` soit unique + non nullable.
- **Edge `child-updates`** insère dans `public.child_updates` après contrôle du propriétaire (`children.user_id = resolveUserContext.userId`).【F:supabase/functions/child-updates/index.ts†L76-L115】
- **Helpers anonymes (`lib/anon-*.js`)** requièrent un accès service (bypass RLS) mais supposent l’existence des tables/colonnes ci-dessus et de relations FK cohérentes (enfants → profils, likes/messages → profils, etc.).
- **`resolveUserContext`** s’appuie sur `public.profiles(code_unique)` pour retrouver un profil anonyme et sur `auth.getUser(token)` pour les comptes connectés.【F:supabase/functions/_shared/likes-helpers.ts†L38-L133】

### Triggers attendus

- **`touch_updated_at`** sur `profiles`, `children`, `messages`, `forum_topics`, `forum_replies`, `parent_updates`, `child_updates` pour rafraîchir `updated_at` à chaque modification (le front se base sur ces timestamps pour trier).【F:assets/app.js†L7020-L7057】【F:assets/app.js†L9418-L9430】
- **`set_primary_child_guard`** (ou équivalent) pour garantir qu’un seul enfant est `is_primary=true` par profil ; le code anonyme présuppose qu’un premier enfant devient primaire automatiquement puis que les flips se font via `set-primary`.【F:lib/anon-children.js†L795-L907】【F:assets/app.js†L9045-L9071】
- **`update_child_summary`** (ou fonction équivalente) pour recalculer les champs synthétiques enfant/IA lors d’inserts `child_updates` ; les modules `api/ai.js` et `lib/anon-children.js` attendent des résumés IA récents via `ai_summary`.【F:lib/anon-children.js†L121-L139】【F:api/ai.js†L2953-L3007】

### RLS (Row Level Security) requis

- **`public.profiles`** :
  - Lecture minimale autorisée à tout utilisateur authentifié (y compris anonymes) pour `id`, `full_name`, `show_children_count` et `children_count` (via vue) afin d’afficher la communauté.【F:assets/app.js†L8081-L8185】
  - Insert/update autorisés pour :
    - Comptes anonymes via Edge (clé service ⇒ bypass),
    - Comptes authentifiés avec `auth.uid() = id` pour gérer leur profil et journal parent.【F:assets/app.js†L4594-L4610】
- **`public.children` & tables croissance** :
  - Sélecteur `user_id = auth.uid()` pour utilisateurs connectés ;
  - Insert/update/delete autorisés uniquement si `user_id = auth.uid()` (le front connecté fait les requêtes directes).【F:assets/app.js†L3272-L4873】
- **`public.child_updates` / `public.parent_updates`** :
  - Sélection autorisée lorsque `child.user_id = auth.uid()` ou `profile_id = auth.uid()` ;
  - Insert/update réservés au propriétaire (`auth.uid()`), Edge pour anonymes via service key.【F:assets/app.js†L8737-L8971】【F:assets/app.js†L4600-L4609】
- **`public.messages`** :
  - RLS lecture/écriture limitée aux lignes où `sender_id = auth.uid()` ou `receiver_id = auth.uid()` ;
  - Suppression conversation via Edge (service key) nécessite un fallback `auth.uid()` pour comptes connectés.【F:assets/app.js†L711-L1516】【F:supabase/functions/messages-delete-conversation/index.ts†L59-L80】
- **`public.forum_topics` / `public.forum_replies` / `public.forum_reply_likes`** :
  - Lecture ouverte aux utilisateurs connectés ;
  - Insert/update/delete autorisés si `user_id = auth.uid()` ;
  - `forum_reply_likes` doit autoriser insert/delete lorsqu’`auth.uid()` correspond, tout en laissant le service role gérer les anonymes via `resolveUserContext`.【F:lib/anon-community.js†L167-L233】【F:supabase/functions/likes-add/index.ts†L63-L70】

## (B) Incohérences / manques identifiés

1. **Génération de code unique impossible** — `profiles-create-anon` échoue si `code_unique` n’est plus `UNIQUE NOT NULL` ou si la colonne a changé de nom/type. L’Edge s’attend à un conflit `23505` sur `code_unique` pour relancer la génération.【F:supabase/functions/profiles-create-anon/index.ts†L108-L140】 Recréer l’index unique et s’assurer que la colonne est `text` en majuscules résout l’erreur.
2. **Mise à jour enfant refusée** — Les helpers anonymes et le front connecté patchent `children`, `growth_measurements`, `growth_sleep`, `growth_teeth` via `PATCH/POST` REST.【F:lib/anon-children.js†L855-L905】【F:assets/app.js†L4848-L4873】 Sans RLS alignée (`user_id = auth.uid()`) et triggers `touch_updated_at`/`set_primary_child_guard`, Supabase renvoie 401/403 ou ignore les updates. Restaurer les policies et le trigger primaire corrige le flux.
3. **Likes communautaires bloqués** — `likes-add/remove` et le front utilisent `Prefer: resolution=merge-duplicates` et comptent sur une contrainte unique `(reply_id, user_id)` + RLS autorisant `auth.uid()` à liker ses propres rows.【F:supabase/functions/likes-add/index.ts†L63-L70】【F:assets/app.js†L7210-L7415】 Si la contrainte ou la policy a disparu, l’Edge renvoie 401/409 et le front reste en erreur.

## (C) Scripts SQL de restauration

> L’ordre recommandé : fonctions utilitaires → tables/colonnes → vues → triggers → policies.

### 1. Fonctions utilitaires & triggers génériques
- **But** : fournir `touch_updated_at()` et garde primaire enfant.
- **SQL** :
```sql
-- Fonction générique pour mettre à jour updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

-- Fonction pour garantir un seul enfant primaire par profil
create or replace function public.ensure_single_primary_child()
returns trigger language plpgsql as $$
begin
  if new.is_primary then
    update public.children
       set is_primary = false,
           updated_at = timezone('utc', now())
     where user_id = new.user_id
       and id <> new.id
       and is_primary is true;
  end if;
  return new;
end;
$$;
```
- **Dépendances** : aucune (à exécuter avant les triggers).

### 2. Tables & contraintes critiques
- **But** : rétablir les colonnes/contraintes utilisées par le code.
- **SQL** :
```sql
-- Profils
alter table if exists public.profiles
  add column if not exists code_unique text,
  add column if not exists avatar_url text,
  add column if not exists parent_role text,
  add column if not exists show_children_count boolean default false,
  add column if not exists marital_status text,
  add column if not exists number_of_children integer,
  add column if not exists parental_employment text,
  add column if not exists parental_emotion text,
  add column if not exists parental_stress text,
  add column if not exists parental_fatigue text,
  add column if not exists context_parental jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());

-- Contrainte d’unicité sur code_unique
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_code_unique_key'
  ) then
    alter table public.profiles
      add constraint profiles_code_unique_key unique (code_unique);
  end if;
end;
$$;

-- Enfants
alter table if exists public.children
  add column if not exists photo_url text,
  add column if not exists context_allergies text,
  add column if not exists context_history text,
  add column if not exists context_care text,
  add column if not exists context_languages text,
  add column if not exists feeding_type text,
  add column if not exists eating_style text,
  add column if not exists sleep_sleeps_through boolean default false,
  add column if not exists sleep_bedtime text,
  add column if not exists sleep_falling text,
  add column if not exists sleep_night_wakings text,
  add column if not exists sleep_wake_duration text,
  add column if not exists milestones boolean[] default array[]::boolean[],
  add column if not exists is_primary boolean default false,
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());

-- Tables croissance
alter table if exists public.growth_measurements
  add column if not exists created_at timestamptz default timezone('utc', now());
alter table if exists public.growth_sleep
  add column if not exists created_at timestamptz default timezone('utc', now());
alter table if exists public.growth_teeth
  add column if not exists created_at timestamptz default timezone('utc', now());

-- Journaux IA
alter table if exists public.child_updates
  add column if not exists ai_summary text,
  add column if not exists ai_commentaire text,
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());
alter table if exists public.parent_updates
  add column if not exists parent_comment text,
  add column if not exists ai_commentaire text,
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());

-- Contrainte unique sur les likes
create unique index if not exists forum_reply_likes_reply_user_key
  on public.forum_reply_likes (reply_id, user_id);
```
- **Dépendances** : nécessite les tables existantes.

### 3. Vues materialisées
- **But** : remettre les vues consommées par le front.
- **SQL** :
```sql
create or replace view public.profiles_with_children as
select p.id,
       p.full_name,
       coalesce(p.show_children_count, false) as show_children_count,
       count(c.id) filter (where c.id is not null) as children_count
  from public.profiles p
  left join public.children c on c.user_id = p.id
 group by p.id;

create or replace view public.child_growth_with_status as
select gm.child_id,
       gm.month as agemos,
       gm.height_cm,
       gm.weight_kg,
       gm.recorded_at,
       gm.created_at,
       gm.status_weight,
       gm.status_height,
       gm.status_global
  from public.growth_measurements gm;
```
- **Dépendances** : tables `profiles`, `children`, `growth_measurements` déjà conformes.

### 4. Triggers d’horodatage et de garde primaire
- **But** : brancher les fonctions de la section 1.
- **SQL** :
```sql
-- Updated_at sur les tables critiques
create trigger set_updated_at_on_profiles
  before update on public.profiles
  for each row
  execute function public.touch_updated_at();

create trigger set_updated_at_on_children
  before update on public.children
  for each row
  execute function public.touch_updated_at();

create trigger ensure_single_primary_child_trg
  before insert or update on public.children
  for each row
  when (new.is_primary is true)
  execute function public.ensure_single_primary_child();

create trigger set_updated_at_on_child_updates
  before update on public.child_updates
  for each row
  execute function public.touch_updated_at();

create trigger set_updated_at_on_parent_updates
  before update on public.parent_updates
  for each row
  execute function public.touch_updated_at();

create trigger set_updated_at_on_messages
  before update on public.messages
  for each row
  execute function public.touch_updated_at();

create trigger set_updated_at_on_forum_topics
  before update on public.forum_topics
  for each row
  execute function public.touch_updated_at();

create trigger set_updated_at_on_forum_replies
  before update on public.forum_replies
  for each row
  execute function public.touch_updated_at();
```
- **Dépendances** : fonctions de la section 1.

### 5. Policies RLS
- **But** : réaligner les accès front / Edge.
- **SQL** :
```sql
alter table public.profiles enable row level security;
alter table public.children enable row level security;
alter table public.child_updates enable row level security;
alter table public.parent_updates enable row level security;
alter table public.messages enable row level security;
alter table public.forum_topics enable row level security;
alter table public.forum_replies enable row level security;
alter table public.forum_reply_likes enable row level security;

-- Profils
create policy profiles_select_minimal
  on public.profiles
  for select
  using (true);

create policy profiles_manage_self
  on public.profiles
  for update
  using (auth.uid() = id);

-- Enfants et croissance
create policy children_select_self
  on public.children
  for select
  using (auth.uid() = user_id);

create policy children_modify_self
  on public.children
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy growth_measurements_self
  on public.growth_measurements
  for all
  using (auth.uid() = child_id::uuid)
  with check (auth.uid() = child_id::uuid);

create policy growth_sleep_self
  on public.growth_sleep
  for all
  using (auth.uid() = child_id::uuid)
  with check (auth.uid() = child_id::uuid);

create policy growth_teeth_self
  on public.growth_teeth
  for all
  using (auth.uid() = child_id::uuid)
  with check (auth.uid() = child_id::uuid);

-- Journaux
create policy child_updates_owner
  on public.child_updates
  for select
  using (exists (
    select 1 from public.children c
     where c.id = child_id and c.user_id = auth.uid()
  ));

create policy child_updates_owner_write
  on public.child_updates
  for all
  using (exists (
    select 1 from public.children c
     where c.id = child_id and c.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.children c
     where c.id = child_id and c.user_id = auth.uid()
  ));

create policy parent_updates_owner
  on public.parent_updates
  for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- Messages
create policy messages_owner
  on public.messages
  for select
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy messages_write_owner
  on public.messages
  for all
  using (auth.uid() = sender_id or auth.uid() = receiver_id)
  with check (auth.uid() = sender_id or auth.uid() = receiver_id);

-- Forum
create policy forum_topics_all
  on public.forum_topics
  for select
  using (true);

create policy forum_topics_owner
  on public.forum_topics
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy forum_replies_all
  on public.forum_replies
  for select
  using (true);

create policy forum_replies_owner
  on public.forum_replies
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy forum_likes_all
  on public.forum_reply_likes
  for select
  using (true);

create policy forum_likes_owner
  on public.forum_reply_likes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```
- **Dépendances** : tables conformes ; adapter au besoin pour inclure les rôles de service si des policies explicites sont nécessaires (`auth.uid()` est `null` pour l’anon key, mais les Edge Functions utilisent la clé service donc contournent les policies).

### 6. Fonction d’aide pour créations anonymes (optionnel fallback RPC)
- **But** : offrir un équivalent SQL direct à l’Edge (`profiles_create_anon`) pour debug ou migration.
- **SQL** :
```sql
create or replace function public.profiles_create_anon(p_full_name text default null)
returns table(id uuid, code_unique text, full_name text)
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_code text;
  v_attempt int := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_code := (
      select string_agg(ch, '')
        from (
          select case when (row_number() over ()) % 2 = 1
                       then substr('ABCDEFGHJKLMNPQRSTUVWXYZ', (floor(random()*24)::int)+1, 1)
                       else substr('23456789', (floor(random()*8)::int)+1, 1)
                  end as ch
            from generate_series(1,12)
        ) s
    );
    begin
      insert into public.profiles (id, code_unique, full_name)
      values (v_id, v_code, coalesce(nullif(trim(p_full_name), ''), ''));
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;
  return query
    select p.id, p.code_unique, coalesce(nullif(p.full_name,''), '')
      from public.profiles p
     where p.id = v_id;
end;
$$;
```
- **Dépendances** : nécessite la contrainte `profiles_code_unique_key`.
