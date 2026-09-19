-- Schema for the Maritime Trading Game backend.
--
-- Safe to re-run: every statement is idempotent.
--
-- NOTE: this mirrors what is already deployed in Supabase, which previously
-- lived in the frontend repo as "create table public.sql". The old `items`
-- table this file used to create was never deployed and the API no longer
-- has endpoints for it.
--
-- ID TYPES: vessel/port only store an id. The DB declares them as uuid, but
-- the game catalogs (src/assets/*.json in the frontend) use integer ids
-- (id_port: 1, id_vessel: 2, ...). The API bridges this by having the client
-- send a deterministic uuid per catalog id (see README "Catalog id mapping").
-- If you would rather store the integer directly, change these two columns to
-- `integer` in a migration and drop the uuid helper in the frontend.

create table if not exists public.player (
  id_player uuid primary key default gen_random_uuid(),
  money integer not null default 0 check (money >= 0),
  user_name varchar(255) not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vessel (
  id_vessel uuid primary key default gen_random_uuid()
);

create table if not exists public.port (
  id_port uuid primary key default gen_random_uuid()
);

create table if not exists public.player_vessel (
  player_id uuid not null references public.player(id_player) on delete cascade,
  vessel_id uuid not null references public.vessel(id_vessel) on delete cascade,
  primary key (player_id, vessel_id)
);

create table if not exists public.player_port (
  player_id uuid not null references public.player(id_player) on delete cascade,
  port_id uuid not null references public.port(id_port) on delete cascade,
  primary key (player_id, port_id)
);
