-- Migration: add placement-style filter (رومیزی / کنار سالنی) and real
-- size variants (for the product-page size picker). Safe to re-run.

alter table products add column if not exists style text;
alter table products add column if not exists variants jsonb not null default '[]';
