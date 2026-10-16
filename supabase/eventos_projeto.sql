-- ============================================================================
--  samyest.mind — eventos nos projetos
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Rode ANTES de publicar o código. Sem isto o app continua funcionando, só
--    não oferece a opção "Evento" ao criar algo num projeto.
--
--  Pode rodar mais de uma vez sem problema (IF NOT EXISTS). Não apaga nada.
--
--  O QUE É
--    Dentro de um projeto, um item pode ser uma tarefa (vai para o quadro,
--    tem coluna e responsável) ou um evento (reunião, call: tem dia e hora,
--    aparece no Início e no Calendário do projeto, e NÃO vira cartão no
--    quadro). Tudo que já existe continua como tarefa: a regra vale para o
--    que for criado daqui em diante.
--
--    As permissões continuam as de tasks: quem vê o projeto vê os eventos.
-- ============================================================================

alter table public.tasks
  add column if not exists kind text not null default 'tarefa';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_kind_check') then
    alter table public.tasks
      add constraint tasks_kind_check check (kind in ('tarefa', 'evento'));
  end if;
end $$;

notify pgrst, 'reload schema';

-- Verificação: deve retornar UMA linha, com o padrão 'tarefa'::text.
select column_name, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'tasks' and column_name = 'kind';
