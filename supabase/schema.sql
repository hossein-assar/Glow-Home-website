-- Glow Home Decor — database schema
-- Run this in Supabase: left sidebar -> SQL Editor -> New query -> paste -> Run

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profiles (extends Supabase's built-in auth.users with our own fields)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Automatically create a profile row whenever someone signs up
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Products (replaces the static data.js catalog)
-- ---------------------------------------------------------------------------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name_fa text not null,
  name_en text,
  collection text not null,          -- 'lamps' | 'candles' | 'decor' | 'shades'
  subcategory text,                  -- material-based grouping, e.g. 'سفالی' | 'پلی استر'
  style text,                        -- placement-based grouping (lamps only): 'رومیزی' | 'کنار سالنی'
  material text,
  height_cm integer,                 -- the DEFAULT/base size shown before a variant is picked
  price bigint not null default 0,   -- price for the default size above
  variants jsonb not null default '[]', -- other sizes: [{"height": 140, "price": 12980000}, ...]
  colors text[] not null default '{}', -- e.g. ['یاسی', 'سبز', 'آبی'] — same price, just a choice
  price_provisional boolean not null default true,
  photo_url text,                    -- cover photo, shown on cards/grids
  photos text[] not null default '{}', -- full gallery — every photo, shown in the lightbox popup. photo_url should also be photos[1].
  description text,
  in_stock boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                 -- e.g. GH-140001, shown to the customer
  user_id uuid references auth.users (id),   -- null allowed = guest checkout
  customer_name text not null,
  phone text not null,
  city text,
  address text,
  postcode text,
  note text,
  shipping_method text,
  shipping_cost bigint not null default 0,
  discount_code text,
  subtotal bigint not null default 0,
  total bigint not null default 0,
  status text not null default 'pending',    -- pending | paid | preparing | shipped | delivered | cancelled
  payment_authority text,                    -- ZarinPal Authority token
  payment_ref_id text,                       -- ZarinPal RefID once verified
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  product_id uuid references products (id),
  name_fa text not null,        -- snapshot of the name at time of purchase
  qty integer not null default 1,
  unit_price bigint not null default 0
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

-- Profiles: a user can see and edit only their own row, but they can never
-- change their own is_admin flag through this policy — the WITH CHECK below
-- forces is_admin to stay exactly what it already was, no matter what value
-- is sent in the update. Only a project owner running SQL directly in
-- Supabase can grant admin (see the bottom of this file).
create policy "profiles: read own" on profiles for select using (auth.uid() = id);
create policy "profiles: update own" on profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_admin = (select p.is_admin from profiles p where p.id = auth.uid())
  );

-- Products: anyone can read; only admins can write
create policy "products: public read" on products for select using (true);
create policy "products: admin write" on products for insert
  with check (exists (select 1 from profiles where id = auth.uid() and is_admin));
create policy "products: admin update" on products for update
  using (exists (select 1 from profiles where id = auth.uid() and is_admin));
create policy "products: admin delete" on products for delete
  using (exists (select 1 from profiles where id = auth.uid() and is_admin));

-- Orders: a signed-in user can see their own orders; admins can see all.
-- Order CREATION happens through the /api/orders serverless function using
-- the service-role key, not directly from the browser, so guest checkout
-- (no account) still works without needing a public insert policy here.
create policy "orders: read own" on orders for select
  using (auth.uid() = user_id or exists (select 1 from profiles where id = auth.uid() and is_admin));
create policy "orders: admin update" on orders for update
  using (exists (select 1 from profiles where id = auth.uid() and is_admin));

create policy "order_items: read via parent order" on order_items for select
  using (exists (
    select 1 from orders
    where orders.id = order_items.order_id
      and (orders.user_id = auth.uid() or exists (select 1 from profiles where id = auth.uid() and is_admin))
  ));

-- ---------------------------------------------------------------------------
-- Make yourself an admin (run this AFTER you sign up once on the live site)
-- ---------------------------------------------------------------------------
-- update profiles set is_admin = true where id = 'PASTE-YOUR-USER-ID-HERE';
-- (find your user id in Supabase: Authentication -> Users)
