-- ============================================================================
--  samyest.mind — Metas (seção da barra lateral)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
--  Pode rodar mais de uma vez sem problema (usa IF NOT EXISTS).
--
--  O QUE É
--    Uma meta tem um de quatro tipos:
--      numero  — ir de um valor a outro (start_value -> target_value, unit)
--      habito  — dias da semana (weekdays); pode ter uma rotina ligada
--                (routine_id), e as tarefas concluídas dela contam na meta
--      etapas  — lista de etapas em steps (jsonb: [{id, t, ok}])
--      unica   — feito ou não feito, com prazo
--    goal_entries guarda um registro por meta por dia: o valor do dia (numero)
--    ou o dia marcado como feito (habito).
--
--  QUEM VÊ
--    Cada conta só as próprias metas (policies pelo user_id). No começo era
--    só da conta dona; supabase/metas_para_todos.sql abriu para todo mundo
--    num banco que já tinha rodado a versão antiga deste arquivo.
-- ============================================================================


-- 1. Metas -------------------------------------------------------------------

create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('numero', 'habito', 'etapas', 'unica')),
  title         text not null check (char_length(title) between 1 and 120),
  area          text,
  why           text,
  unit          text,
  start_value   numeric,
  target_value  numeric,
  weekdays      int[],
  routine_id    uuid references public.routines(id) on delete set null,
  steps         jsonb not null default '[]'::jsonb,
  due_date      date,
  status        text not null default 'ativa' check (status in ('ativa', 'concluida')),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.goals enable row level security;

drop policy if exists "own goals" on public.goals;
create policy "own goals"
  on public.goals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- 2. Registros (um por meta por dia) -----------------------------------------

create table if not exists public.goal_entries (
  id          uuid primary key default gen_random_uuid(),
  goal_id     uuid not null references public.goals(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null default current_date,
  value       numeric,
  created_at  timestamptz not null default now(),
  unique (goal_id, date)
);

alter table public.goal_entries enable row level security;

-- Além da conta, o registro só pode apontar para uma meta que também é dela:
-- sem o exists, daria para pendurar registros na meta de outra conta.
drop policy if exists "own goal entries" on public.goal_entries;
create policy "own goal entries"
  on public.goal_entries
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid())
  );


-- 3. Atualiza o cache de esquema ---------------------------------------------

notify pgrst, 'reload schema';


-- 4. Verificação -------------------------------------------------------------
--    Deve retornar DUAS linhas, as duas com rls ligado = true.

select c.relname as tabela, (c.relrowsecurity)::text as rls_ligado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('goals', 'goal_entries');
