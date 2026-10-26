-- ============================================================================
--  samyest.mind — tarefa de projeto só para quem tem acesso ao projeto (SEC-045)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Depois do supabase/rls_correcoes.sql e do supabase/convites_pendentes.sql.
--    Pode rodar mais de uma vez; não apaga nenhum dado, só troca a policy de
--    leitura de tasks e as três policies de task_comments.
--
--  RISCO
--    tasks_select (do schema base, nunca corrigida) liberava a tarefa para
--    quem a criou em qualquer caso, e as policies de task_comments faziam o
--    mesmo: "ver" e "comentar" aceitavam t.user_id = eu, e "excluir" só
--    conferia se o comentário era meu. Quem era removido do projeto (ou saía
--    dele) continuava lendo as tarefas que tinha criado ali, com tudo o que o
--    time escrevia nelas depois (título, notas, datas, responsável), lia e
--    escrevia nos comentários delas e recebia cada mudança pelo realtime.
--
--  CORREÇÃO
--    A regra do tasks_update de rls_correcoes.sql, agora para leitura:
--    tarefa pessoal (sem projeto) só o dono dela vê; tarefa de projeto, só o
--    dono do projeto e os membros aceitos (editor ou visualizador), inclusive
--    quando quem pede é quem criou a tarefa. Comentário segue a tarefa: ler,
--    comentar e apagar o próprio comentário exigem ver a tarefa por essa
--    regra. A subconsulta em tasks já passaria pelo tasks_select, mas a regra
--    fica escrita por extenso para não depender disso.
--
--  O QUE MUDA NO APP
--    Para quem continua no projeto, nada. Para quem é removido ou sai, as
--    tarefas que criou no projeto somem junto com as dos outros (até hoje só
--    as dos outros sumiam). O app recarrega a lista de projetos na hora, mas
--    a de tarefas só na próxima carga (abrir o app, o botão de atualizar ou
--    outra mudança de tarefa); até lá, o que já estava na tela fica, sem
--    receber nada novo. Projeto excluído continua igual: as tarefas dele
--    ficam sem projeto (on delete set null) e voltam a ser de quem criou.
--
--    Google Agenda: o evento que a pessoa criou a partir de uma tarefa do
--    projeto fica na agenda dela como estava quando saiu. Ele não volta como
--    tarefa pessoal: o app grava "Sincronizado do samyest.mind" na descrição
--    e o sync não importa evento com essa marca. Mudanças do time na tarefa
--    não chegam mais ao evento, e apagar o evento no Google não mexe em
--    nada. É o que já acontecia com as tarefas do projeto atribuídas a ela.
--    Se ela voltar ao projeto, o sync retoma o mesmo evento (o id continua
--    gravado na tarefa).
--    Caso raro: se ela apagar a marca da descrição no Google, o sync tenta
--    importar o evento, o índice de supabase/tarefas_google_unicas.sql recusa
--    (a tarefa do projeto ainda guarda esse id com o user_id dela) e o app só
--    recarrega. Não aparece tarefa duplicada.
-- ============================================================================


-- 1. Tarefas -------------------------------------------------------------------

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    ((project_id is null) and (auth.uid() = user_id))
    or ((project_id is not null)
        and (is_project_member(project_id) or is_project_owner(project_id)))
  );


-- 2. Comentários ---------------------------------------------------------------

drop policy if exists "ver comentarios de tarefas que vejo" on public.task_comments;
create policy "ver comentarios de tarefas que vejo" on public.task_comments
  for select to authenticated
  using (
    exists (
      select 1 from tasks t
      where t.id = task_comments.task_id
        and (((t.project_id is null) and (t.user_id = auth.uid()))
             or ((t.project_id is not null)
                 and (is_project_member(t.project_id) or is_project_owner(t.project_id))))
    )
  );

drop policy if exists "comentar em tarefas que vejo" on public.task_comments;
create policy "comentar em tarefas que vejo" on public.task_comments
  for insert to authenticated
  with check (
    (user_id = auth.uid())
    and exists (
      select 1 from tasks t
      where t.id = task_comments.task_id
        and (((t.project_id is null) and (t.user_id = auth.uid()))
             or ((t.project_id is not null)
                 and (is_project_member(t.project_id) or is_project_owner(t.project_id))))
    )
  );

drop policy if exists "excluir meu proprio comentario" on public.task_comments;
create policy "excluir meu proprio comentario" on public.task_comments
  for delete to authenticated
  using (
    (user_id = auth.uid())
    and exists (
      select 1 from tasks t
      where t.id = task_comments.task_id
        and (((t.project_id is null) and (t.user_id = auth.uid()))
             or ((t.project_id is not null)
                 and (is_project_member(t.project_id) or is_project_owner(t.project_id))))
    )
  );


-- 3. Atualiza o cache de esquema -----------------------------------------------

notify pgrst, 'reload schema';


-- 4. Verificação ---------------------------------------------------------------
--    Deve retornar UMA linha com ok = true. Confere que as quatro policies têm
--    a regra nova e que nenhuma outra policy permissiva de leitura em tasks ou
--    task_comments reabre o acesso (policies permissivas se somam por OR).

select 'tarefa de projeto e comentários só com acesso ao projeto' as item,
       (select count(*) from pg_policies
         where schemaname = 'public'
           and ((tablename = 'tasks' and policyname = 'tasks_select')
             or (tablename = 'task_comments'
                 and policyname in ('ver comentarios de tarefas que vejo',
                                    'comentar em tarefas que vejo',
                                    'excluir meu proprio comentario')))
           and coalesce(qual, with_check) like '%project_id IS NULL) AND%') = 4
       and not exists (select 1 from pg_policies
                        where schemaname = 'public'
                          and permissive = 'PERMISSIVE'
                          and cmd in ('SELECT', 'ALL')
                          and ((tablename = 'tasks' and policyname <> 'tasks_select')
                            or (tablename = 'task_comments'
                                and policyname <> 'ver comentarios de tarefas que vejo'))) as ok;
