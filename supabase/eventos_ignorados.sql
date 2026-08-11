-- ============================================================================
--  samyest.mind — não reimportar eventos que o usuário já descartou
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
--  Pode rodar mais de uma vez sem problema.
--
--  O PROBLEMA QUE ISTO RESOLVE
--    A sincronização completa relista todos os eventos da janela. Um evento sem
--    tarefa correspondente parecia novidade, então tarefas apagadas voltavam na
--    sincronização seguinte. Agora cada tarefa apagada que veio do Google deixa
--    uma "lápide" aqui, e o sync passa por ela sem recriar.
--
--  POR QUE 'from_google'
--    Apagar uma tarefa criada no app deve apagar o evento espelho no Google.
--    Mas apagar uma tarefa que VEIO do Google não pode apagar o compromisso
--    real da agenda da pessoa — some uma reunião de verdade. A coluna diz de
--    onde a tarefa veio para o app tratar cada caso corretamente.
-- ============================================================================


-- 1. Lápides -------------------------------------------------------------------

create table if not exists public.google_ignored_events (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  event_id   text        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.google_ignored_events enable row level security;

-- Aqui, ao contrário de google_credentials, o navegador precisa de acesso —
-- mas só às próprias linhas.
drop policy if exists "own ignored events" on public.google_ignored_events;
create policy "own ignored events"
  on public.google_ignored_events
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- 2. Origem da tarefa ----------------------------------------------------------

alter table public.tasks
  add column if not exists from_google boolean not null default false;


-- 3. Atualiza o cache de esquema -----------------------------------------------

notify pgrst, 'reload schema';


-- 4. Verificação ---------------------------------------------------------------
--    Deve retornar DUAS linhas: a tabela com rls ligado, e a coluna from_google.

select 'tabela google_ignored_events' as item,
       (c.relrowsecurity)::text       as detalhe
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname='google_ignored_events'
union all
select 'coluna tasks.from_google', data_type
from information_schema.columns
where table_schema='public' and table_name='tasks' and column_name='from_google';
