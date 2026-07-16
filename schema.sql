-- ============================================================
-- SkillTracker (Suivi de compétences) — schéma Supabase
-- À coller dans : Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- Une seule table : une ligne par utilisateur, toutes ses données
-- (compétences, sous-tâches, journal, tags...) dans une colonne JSONB.
-- Simple, rapide à mettre en place, et ça correspond exactement à la
-- structure déjà utilisée côté JS (state.skills / state.settings).

create table if not exists public.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Active la Row Level Security : sans ça, personne ne peut rien lire/écrire.
alter table public.user_data enable row level security;

-- Chaque utilisateur ne peut voir que SA propre ligne.
create policy "select_own_data"
  on public.user_data for select
  using (auth.uid() = user_id);

-- Chaque utilisateur ne peut créer que SA propre ligne.
create policy "insert_own_data"
  on public.user_data for insert
  with check (auth.uid() = user_id);

-- Chaque utilisateur ne peut modifier que SA propre ligne.
create policy "update_own_data"
  on public.user_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- (Optionnel) Chaque utilisateur peut supprimer SA propre ligne.
create policy "delete_own_data"
  on public.user_data for delete
  using (auth.uid() = user_id);

-- ============================================================
-- Notes :
-- - "upsert" côté JS (voir persist() dans script.js) fait l'insert
--   ou l'update selon que la ligne existe déjà ou non.
-- - Si tu veux désactiver la confirmation par email obligatoire pour
--   les nouveaux comptes (pratique en dev/perso) :
--   Authentication → Providers → Email → décoche "Confirm email"
-- ============================================================
