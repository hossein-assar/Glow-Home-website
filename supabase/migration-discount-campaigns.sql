-- Migration: discount campaigns («تخفیف‌ها» in the admin).
--
-- 1. discount_campaigns — one row per campaign (یلدا, نوروز…): a whole
--    percent (1–90) off every size and shade of the products it covers —
--    all of them (scope 'all'), some collections ('collections' +
--    collections[]), or chosen products by slug ('products' +
--    product_slugs[]) — between optional starts_at / ends_at (the admin
--    stores 00:00 Tehran time of the first day and of the day after the
--    last), with an on/off switch (enabled).
--    The payment server reads this table with the service-role key and
--    prices every order itself; the browser's prices are never used.
--
-- 2. order_items.list_price / order_items.campaign_name — on a line sold
--    under a campaign: the price before the discount and the campaign's
--    name (unit_price stays the price actually charged). Both nullable;
--    old orders and lines without a campaign keep them empty.
--
-- RLS:
--   * anyone (the storefront, anon key) may read ONLY active campaigns:
--     switched on, a valid percent, and now() between the dates;
--   * admins may read every campaign and insert / update / delete — the
--     same check as the products policies (profiles.is_admin).
--   order_items policies are unchanged (the new columns follow them).
--
-- Idempotent: safe to run more than once (create … if not exists, add
-- column if not exists, policies dropped and created again). Changes
-- nothing in products or orders, and no existing order line.
--
-- Run in Supabase -> SQL Editor as one script. Rollback: at the bottom.

begin;

create table if not exists public.discount_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  percent integer not null,
  scope text not null default 'all',
  collections text[] not null default '{}',
  product_slugs text[] not null default '{}',
  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Checks, added only when missing (so a re-run doesn't fail).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'discount_campaigns_name_check') then
    alter table public.discount_campaigns
      add constraint discount_campaigns_name_check check (char_length(btrim(name)) between 1 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'discount_campaigns_percent_check') then
    alter table public.discount_campaigns
      add constraint discount_campaigns_percent_check check (percent between 1 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'discount_campaigns_scope_check') then
    alter table public.discount_campaigns
      add constraint discount_campaigns_scope_check check (scope in ('all', 'collections', 'products'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'discount_campaigns_dates_check') then
    alter table public.discount_campaigns
      add constraint discount_campaigns_dates_check check (starts_at is null or ends_at is null or ends_at > starts_at);
  end if;
end $$;

alter table public.discount_campaigns enable row level security;

drop policy if exists "discount_campaigns: public read active" on public.discount_campaigns;
create policy "discount_campaigns: public read active" on public.discount_campaigns for select
  using (
    enabled
    and percent between 1 and 90
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );

drop policy if exists "discount_campaigns: admin read" on public.discount_campaigns;
create policy "discount_campaigns: admin read" on public.discount_campaigns for select
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

drop policy if exists "discount_campaigns: admin insert" on public.discount_campaigns;
create policy "discount_campaigns: admin insert" on public.discount_campaigns for insert
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

drop policy if exists "discount_campaigns: admin update" on public.discount_campaigns;
create policy "discount_campaigns: admin update" on public.discount_campaigns for update
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

drop policy if exists "discount_campaigns: admin delete" on public.discount_campaigns;
create policy "discount_campaigns: admin delete" on public.discount_campaigns for delete
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

alter table public.order_items add column if not exists list_price bigint;
alter table public.order_items add column if not exists campaign_name text;

commit;

-- Check (optional, after running):
--   select policyname, cmd from pg_policies where tablename = 'discount_campaigns' order by policyname;
--   select column_name from information_schema.columns
--     where table_name = 'order_items' and column_name in ('list_price', 'campaign_name');

-- ---------------------------------------------------------------------------
-- Rollback (only if no campaign should ever have existed). Turn every
-- campaign off in the admin first; then, in the SQL Editor:
--
--   begin;
--   drop table if exists public.discount_campaigns;
--   -- Only if no paid order used a campaign yet (these columns hold what
--   -- was charged vs. the list price — dropping them loses that record):
--   -- alter table public.order_items drop column if exists campaign_name;
--   -- alter table public.order_items drop column if exists list_price;
--   commit;
--
-- The payment server treats a missing table as "no campaigns", and stores
-- the two columns only on discounted lines, so it keeps working after this.
-- ---------------------------------------------------------------------------
