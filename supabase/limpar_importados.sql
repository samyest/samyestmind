-- ============================================================================
--  samyest.mind — limpar tarefas importadas indevidamente do Google
-- ============================================================================
--
--  Para quando o sync trouxe aniversários de contatos e outros eventos que não
--  são tarefas. O filtro por eventType já impede isso de acontecer de novo;
--  este arquivo serve para apagar o que entrou antes da correção.
--
--  ⚠️  APAGA DADOS. Rode o passo 1 primeiro e confira a lista.
--      Só rode o passo 2 se o resultado do passo 1 for exatamente o que você
--      quer perder. Não tem desfazer.
-- ============================================================================


-- 1. PREVIEW — o que seria apagado ---------------------------------------------
--    Rode SOZINHO primeiro e leia a lista com atenção.

select id, title, date, created_at
from public.tasks
where google_event_id is not null
  and title ilike 'happy birthday%'
order by created_at desc;


-- 2. APAGAR --------------------------------------------------------------------
--    Só depois de conferir o passo 1. Selecione da linha abaixo até o fim e
--    rode apenas essa parte.

-- delete from public.tasks
-- where google_event_id is not null
--   and title ilike 'happy birthday%';


-- ============================================================================
--  Variante: apagar TUDO que veio do Google numa faixa de datas
--  Útil se além dos aniversários entraram outros eventos indesejados.
--  Ajuste as datas. Preview primeiro, trocando "delete" por "select *".
-- ============================================================================

-- delete from public.tasks
-- where google_event_id is not null
--   and date between '2026-01-01' and '2026-08-11';
