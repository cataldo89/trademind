create table if not exists public.alpaca_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null default 'paper' check (environment in ('paper', 'live')),
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  alpaca_account_id text,
  scope text,
  token_type text,
  access_token_encrypted text,
  raw_account jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, environment)
);

create index if not exists alpaca_connections_user_id_idx
  on public.alpaca_connections (user_id);

alter table public.alpaca_connections enable row level security;

revoke all on table public.alpaca_connections from anon, authenticated;
grant all privileges on table public.alpaca_connections to service_role;
