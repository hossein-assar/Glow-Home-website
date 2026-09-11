alter table products add column if not exists colors text[] not null default '{}';
