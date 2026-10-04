-- ============================================================================
--  samyest.mind — aba Desafio (88 dias, 05/10 a 31/12/2026)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
--  Pode rodar mais de uma vez sem problema (usa IF NOT EXISTS).
--
--  O QUE É
--    challenge_days    — um registro por dia com os itens do checklist marcados.
--    challenge_entries — lançamentos avulsos: peso, freela (valor recebido) e
--                        vaga de dev (candidatura e status).
--
--    As políticas só deixam a conta samirahmadpour@gmail.com ler e escrever,
--    então mesmo quem abrir o console do navegador em outra conta não vê nada.
-- ============================================================================


-- 1. Checklist diário ---------------------------------------------------------

create table if not exists public.challenge_days (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  checks     text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.challenge_days enable row level security;

drop policy if exists "own challenge days" on public.challenge_days;
create policy "own challenge days"
  on public.challenge_days
  for all
  using (auth.uid() = user_id and (auth.jwt() ->> 'email') = 'samirahmadpour@gmail.com')
  with check (auth.uid() = user_id and (auth.jwt() ->> 'email') = 'samirahmadpour@gmail.com');


-- 2. Lançamentos: peso, freela, vaga ------------------------------------------

create table if not exists public.challenge_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('peso', 'freela', 'vaga')),
  date       date not null default current_date,
  label      text,
  value      numeric,
  status     text,
  created_at timestamptz not null default now()
);

create index if not exists challenge_entries_user_kind_idx
  on public.challenge_entries (user_id, kind, date);

alter table public.challenge_entries enable row level security;

drop policy if exists "own challenge entries" on public.challenge_entries;
create policy "own challenge entries"
  on public.challenge_entries
  for all
  using (auth.uid() = user_id and (auth.jwt() ->> 'email') = 'samirahmadpour@gmail.com')
  with check (auth.uid() = user_id and (auth.jwt() ->> 'email') = 'samirahmadpour@gmail.com');


-- 3. Atualiza o cache de esquema ----------------------------------------------

notify pgrst, 'reload schema';


-- 4. Verificação ---------------------------------------------------------------
--    Deve retornar DUAS linhas, ambas com detalhe = true (RLS ligado).

select c.relname as tabela, (c.relrowsecurity)::text as detalhe
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('challenge_days', 'challenge_entries');
