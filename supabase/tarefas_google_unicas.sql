-- ============================================================================
--  samyest.mind — uma tarefa por evento do Google, mesmo com vários aparelhos
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
--  Pode rodar mais de uma vez sem problema (usa IF NOT EXISTS).
--
--  O PROBLEMA QUE ISTO RESOLVE
--    Com o app aberto no celular e no computador, os dois buscam as novidades
--    da agenda. Um evento criado no Google aparecia como novo para os dois ao
--    mesmo tempo, e cada um criava a sua tarefa: a mesma reunião duas vezes.
--    O app já grava o id do evento junto com a tarefa (antes era num segundo
--    passo); este índice faz o banco recusar a segunda cópia, e o app trata a
--    recusa como "outro aparelho chegou antes" e só recarrega.
--
--  POR QUE (user_id, google_event_id) E NÃO SÓ O EVENTO
--    Um convite aparece na agenda de cada convidado com o mesmo id de evento.
--    Duas pessoas diferentes podem, e devem, ter cada uma a sua tarefa.
--
--  SE DER "Ainda há tarefas duplicadas"
--    É o passo 3 avisando que o banco já tem cópias de antes da correção. O
--    SQL Editor só mostra o resultado do último comando, então o passo 1 passa
--    despercebido ao rodar tudo junto. Rode o passo 1 sozinho, confira, rode
--    o passo 2, e depois rode o arquivo inteiro de novo.
-- ============================================================================


-- 1. PREVIEW — duplicatas que já existem ------------------------------------
--    "manter" é a mais antiga de cada grupo; "apagar" são as cópias.

select user_id,
       google_event_id,
       count(*)                                         as copias,
       (array_agg(id order by created_at))[1]           as manter,
       (array_agg(id order by created_at))[2:]          as apagar,
       min(title)                                       as titulo,
       min(date)                                        as data
from public.tasks
where google_event_id is not null
group by user_id, google_event_id
having count(*) > 1
order by copias desc;


-- 2. APAGAR AS CÓPIAS (só se o passo 1 trouxe linhas) ------------------------
--    ⚠️  APAGA DADOS. Mantém a tarefa mais antiga de cada evento e apaga as
--    outras (comentários feitos numa cópia vão junto). Selecione do "delete"
--    até o ponto e vírgula, tire os "-- " do começo das linhas e rode só isso.

-- delete from public.tasks t
-- using (
--   select id,
--          row_number() over (partition by user_id, google_event_id order by created_at) as n
--   from public.tasks
--   where google_event_id is not null
-- ) d
-- where t.id = d.id and d.n > 1;


-- 3. O índice ----------------------------------------------------------------
--    A checagem antes dele troca o erro cru do Postgres por uma instrução.

do $$
begin
  if exists (
    select 1 from public.tasks
    where google_event_id is not null
    group by user_id, google_event_id
    having count(*) > 1
  ) then
    raise exception 'Ainda há tarefas duplicadas. Rode o passo 1 sozinho para ver quais, depois o passo 2 para apagar as cópias, e rode este arquivo de novo.';
  end if;
end $$;

create unique index if not exists tasks_user_google_event_unico
  on public.tasks (user_id, google_event_id)
  where google_event_id is not null;


-- 4. Verificação -------------------------------------------------------------
--    Deve retornar UMA linha com o índice.

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename  = 'tasks'
  and indexname  = 'tasks_user_google_event_unico';


-- ============================================================================
--  EXTRA — ocorrências de compromissos recorrentes importadas longe demais
-- ============================================================================
--
--  Até esta correção, um compromisso recorrente sem data de fim virava uma
--  tarefa por ocorrência décadas para a frente — cada aniversário anual da
--  agenda deixava ~30 tarefas, até 2056. Agora o app só importa os próximos 90 dias e traz o resto conforme
--  a janela anda. As tarefas que já entraram além disso podem ser apagadas: as
--  que voltarem para dentro da janela são importadas de novo na hora certa.
--
--  Preview: quantas tarefas cada série recorrente deixou além de 90 dias.

-- select split_part(google_event_id, '_', 1) as serie,
--        min(title)                          as titulo,
--        count(*)                            as tarefas,
--        min(date)                           as primeira,
--        max(date)                           as ultima
-- from public.tasks
-- where from_google
--   and date > current_date + 90
-- group by 1
-- order by tarefas desc;

--  ⚠️  APAGA DADOS. Só tarefas que vieram do Google e que estão além de 90
--  dias; nada criado no app é tocado.

-- delete from public.tasks
-- where from_google
--   and date > current_date + 90;
