-- ============================================================================
--  samyest.mind — tags nas tarefas
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
--  Pode rodar mais de uma vez sem problema (usa IF NOT EXISTS).
--  Não apaga nada: só acrescenta uma coluna em tasks.
--
--  O QUE É
--    Cada tarefa ganha uma lista de tags (ex.: Marketing, Comercial). Não há
--    tabela de tags: as tags de um projeto são as que já aparecem nas tarefas
--    dele, então todo mundo do projeto enxerga e reaproveita as mesmas. A cor
--    de cada tag sai do próprio nome, igual para todos.
--
--    As permissões continuam as de tasks: quem vê a tarefa vê as tags dela.
-- ============================================================================

alter table public.tasks
  add column if not exists tags text[] not null default '{}';

create index if not exists tasks_tags_idx on public.tasks using gin (tags);

notify pgrst, 'reload schema';

-- Verificação: deve retornar UMA linha com tipo ARRAY.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'tasks' and column_name = 'tags';
