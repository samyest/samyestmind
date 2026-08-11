-- ============================================================================
--  samyest.mind — cor por tarefa
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar -> Run
--
--  Pode rodar mais de uma vez sem problema.
--
--  POR QUE GUARDAR O ID E NÃO O HEX
--    O Google Calendar só aceita 11 cores fixas, identificadas por um id de "1"
--    a "11". Guardando o id, a cor sobrevive à ida e volta entre o app e o
--    Google sem se degradar. Se guardássemos hex livre, cada sincronização
--    arredondaria para a cor mais próxima e a cor iria mudando sozinha.
--
--    NULL = sem cor própria (a tarefa herda a cor da coluna do Kanban).
-- ============================================================================

alter table public.tasks
  add column if not exists color_id text;


-- Verificação: deve retornar uma linha com a coluna color_id.

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'tasks'
  and column_name  = 'color_id';
