# Changelog - child-full-report

- Colonnes Supabase utilisées :
  - `public.child_updates` → `id`, `child_id`, `update_type`, `update_content`, `created_at`, `ai_summary`, `ai_commentaire`.
  - `public.parent_updates` → `id`, `profile_id`, `child_id`, `update_type`, `update_content`, `parent_comment`, `ai_commentaire`, `created_at`.
  - `public.child_growth_with_status` → `agemos`, `height_cm`, `weight_kg`, `status_weight`, `status_height`, `status_global`.
  - `public.growth_teeth` → `month`, `count`, `created_at`.
- Limites appliquées : 15 mises à jour enfant et 5 mises à jour parent pour le rapport.
- Croissance : récupération ordonnée sur `agemos` et exposition directe des champs requis (mesures + dents).
- Appel IA protégé par try/catch avec `AbortController` et timeout fixé à 20 secondes.
- Journaux ajoutés : démarrage de la route, compte des updates, disponibilité croissance, taille du prompt, succès (tokens/temps) et erreurs structurées par étape (`config`, `updates`, `parent-updates`, `growth`, `openai`).
