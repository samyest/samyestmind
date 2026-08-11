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

-- 1. A coluna ------------------------------------------------------------------

alter table public.tasks
  add column if not exists color_id text;


-- 2. Atualiza o cache de esquema -----------------------------------------------
--    O PostgREST (camada de API do Supabase) guarda um cache do esquema e nem
--    sempre percebe a coluna nova na hora. Sem isto, salvar a tarefa falha com
--    "Could not find the 'color_id' column of 'tasks' in the schema cache".

notify pgrst, 'reload schema';


-- 3. Verificação ---------------------------------------------------------------
--    Deve retornar UMA linha: color_id | text | YES
--    Se voltar vazio, o ALTER TABLE acima não chegou a rodar.

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'tasks'
  and column_name  = 'color_id';
