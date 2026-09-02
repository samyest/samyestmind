-- ============================================================================
--  samyest.mind — rotinas semanais (tarefas que se repetem em dias fixos)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
--  Pode rodar mais de uma vez sem problema (usa IF NOT EXISTS).
--
--  O QUE É
--    Uma rotina é um "molde": título, coluna, horário opcional e os dias da
--    semana em que ela deve aparecer (0=domingo ... 6=sábado). Toda vez que
--    o app carrega num dia marcado, ele cria (se ainda não existir) uma
--    tarefa normal pra aquele dia, ligada à rotina por routine_id. Concluir
--    ou apagar essa tarefa não mexe na rotina — ela volta a gerar tarefa no
--    próximo dia certo.
--
--    last_generated_date guarda o último dia em que já foi gerada uma
--    tarefa, pra não gerar duas vezes no mesmo dia nem regenerar se a
--    pessoa apagou a tarefa de hoje de propósito.
-- ============================================================================


-- 1. A tabela --------------------------------------------------------------

create table if not exists public.routines (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  title               text not null,
  client              text,
  status              text not null default 'todo',
  priority            text not null default 'normal',
  time                text,
  weekdays            int[] not null,
  active              boolean not null default true,
  last_generated_date date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.routines enable row level security;

drop policy if exists "own routines" on public.routines;
create policy "own routines"
  on public.routines
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- 2. Liga cada tarefa gerada à rotina que a criou ---------------------------

alter table public.tasks
  add column if not exists routine_id uuid references public.routines(id) on delete set null;


-- 3. Atualiza o cache de esquema ---------------------------------------------

notify pgrst, 'reload schema';


-- 4. Verificação --------------------------------------------------------------
--    Deve retornar DUAS linhas: a tabela com rls ligado, e a coluna routine_id.

select 'tabela routines' as item,
       (c.relrowsecurity)::text as detalhe
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname='routines'
union all
select 'coluna tasks.routine_id', data_type
from information_schema.columns
where table_schema='public' and table_name='tasks' and column_name='routine_id';
