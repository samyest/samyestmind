-- ============================================================================
--  samyest.mind — escolher se a tarefa vai para o Google Calendar
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar -> Run
--
--  Pode rodar mais de uma vez sem problema.
--
--  O QUE MUDA
--    Até aqui, toda tarefa com data virava evento no Google Calendar de quem
--    tinha a conta conectada. Agora existe um interruptor por tarefa, no modal
--    de criar/editar.
--
--    true  (padrão) = espelha no Google Calendar, como sempre foi
--    false          = fica só no app; se já havia um evento, ele é apagado
--
--    O padrão é true justamente para as tarefas que já existem continuarem se
--    comportando do mesmo jeito depois da migração.
-- ============================================================================

-- 1. A coluna ------------------------------------------------------------------

alter table public.tasks
  add column if not exists sync_google boolean not null default true;


-- 2. Atualiza o cache de esquema -----------------------------------------------
--    O PostgREST (camada de API do Supabase) guarda um cache do esquema e nem
--    sempre percebe a coluna nova na hora. Sem isto, salvar a tarefa falha com
--    "Could not find the 'sync_google' column of 'tasks' in the schema cache".

notify pgrst, 'reload schema';


-- 3. Verificação ---------------------------------------------------------------
--    Deve retornar UMA linha: sync_google | boolean | NO | true
--    Se voltar vazio, o ALTER TABLE acima não chegou a rodar.

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'tasks'
  and column_name  = 'sync_google';
