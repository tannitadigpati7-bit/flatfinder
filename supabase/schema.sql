-- FlatFinder — Supabase schema.
-- Run this once in your Supabase project's SQL Editor (Dashboard -> SQL
-- Editor -> New query -> paste -> Run). Safe to re-run: uses IF NOT EXISTS
-- / CREATE OR REPLACE throughout.
--
-- Mirrors pipeline/listing_schema.py's Listing dataclass field-for-field so
-- a row written by the Python pipeline and a row written by the browser
-- (manual capture) are shaped identically.

create table if not exists public.listings (
  id                 text primary key default gen_random_uuid()::text,

  -- provenance
  source             text not null,
  source_listing_id  text not null,
  url                text,
  title              text,
  raw_text           text,

  -- freshness
  first_seen         timestamptz,
  last_seen          timestamptz,
  last_verified      timestamptz,
  source_status      text not null default 'active',

  -- extracted fields (null = UNKNOWN, never assumed)
  bhk                numeric,
  rent               numeric,
  deposit            numeric,
  furnishing         text,
  lift               boolean,
  brokerage_amount   numeric,
  brokerage_status   text,
  owner_status       text,
  location           text,
  address            text,
  available_from     text,

  -- geocoding
  lat                double precision,
  lng                double precision,
  geocode_source     text,
  geocode_query      text,

  -- commute
  commute_minutes    numeric,
  commute_source     text,

  -- hard filtering
  match_status       text not null default 'needs_verification',
  fail_reasons       jsonb not null default '[]'::jsonb,
  unknown_fields     jsonb not null default '[]'::jsonb,

  -- dedup
  dedup_key          text,
  merged_sources     jsonb not null default '[]'::jsonb,

  -- scoring
  score              numeric,
  score_reasons      jsonb not null default '[]'::jsonb,

  created_at         timestamptz not null default now(),

  -- one row per real-world source listing; the pipeline upserts on this
  constraint listings_source_unique unique (source, source_listing_id)
);

-- Personal tracking (yours to edit from the "All Listings" table view —
-- separate from match_status, which stays pipeline-owned and untouched by
-- this). Added via ALTER rather than inside the CREATE TABLE above so
-- re-running this file adds them to a database that already has the
-- `listings` table from an earlier run (CREATE TABLE IF NOT EXISTS is a
-- no-op once the table exists, so new columns must be added this way to
-- actually reach it). Status is free text on purpose, e.g. "Not
-- contacted", "Contacted", "Visited", "Not interested", or anything else.
alter table public.listings add column if not exists notes text;
alter table public.listings add column if not exists personal_status text;

create index if not exists listings_match_status_idx on public.listings (match_status);
create index if not exists listings_commute_idx on public.listings (commute_minutes);
create index if not exists listings_first_seen_idx on public.listings (first_seen desc);

alter table public.listings enable row level security;

-- Anyone can read (the site, extension, and share target all need this,
-- and rental listings aren't sensitive data) — same openness the old
-- Firebase rules had, called out here rather than left implicit.
drop policy if exists "Public read access" on public.listings;
create policy "Public read access"
  on public.listings for select
  to anon
  using (true);

-- The browser-based manual-capture path (site paste box, extension,
-- mobile share target) inserts using the public anon key. There is no
-- public UPDATE or DELETE policy — once inserted, a listing can only be
-- changed by the pipeline itself, which uses the service_role key and
-- bypasses RLS entirely. This mirrors the old Firebase setup's openness
-- (anyone with the anon key can add a row) without also allowing anyone
-- to edit or delete existing rows, which Firebase's rules did allow.
drop policy if exists "Public insert for manual capture" on public.listings;
create policy "Public insert for manual capture"
  on public.listings for insert
  to anon
  with check (true);

-- The "All Listings" table view on the frontend lets you track your own
-- progress per listing (notes, a status like "Contacted"/"Visited") —
-- this needs UPDATE, which nothing above grants. Rather than opening
-- UPDATE on the whole row (which would let a client overwrite the
-- pipeline's own match_status/score/fail_reasons — fields that must stay
-- authoritative and untouched by anything but the pipeline), grant it at
-- the column level: the RLS policy allows updating any row, but the table
-- privilege restricts *which columns* an UPDATE statement may touch to
-- exactly these two. Supabase enforces both checks on every UPDATE.
drop policy if exists "Public update of personal notes/status" on public.listings;
create policy "Public update of personal notes/status"
  on public.listings for update
  to anon
  using (true)
  with check (true);

revoke update on public.listings from anon;
grant update (notes, personal_status) on public.listings to anon;
