-- Migration: add subcategory + multi-photo gallery support
-- Run this once in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS guards).

alter table products add column if not exists subcategory text;
alter table products add column if not exists photos text[] not null default '{}';
