-- ============================================================================
--  samyest.mind — convite pendente só para o dono e o convidado (SEC-044)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Depois do supabase/rls_correcoes.sql. Pode rodar mais de uma vez; não
--    apaga nenhum dado, só troca a policy de leitura de project_members.
--
--  RISCO
--    members_select liberava a linha inteira para qualquer membro aceito,
--    inclusive as linhas pendentes, com code e invited_email. O app só
--    escondia o código na tela; pela API, com o console aberto, um
--    visualizador lia sb.from('project_members').select('code, role'),
--    resgatava um código de editor com uma segunda conta pelo
--    accept_invite_by_code e passava a editar o projeto. Também dava para
--    queimar o código antes do convidado e ver o email de quem foi convidado.
--
--  CORREÇÃO
--    Convite pendente só é legível pelo dono do projeto e pelo próprio
--    convidado (pelo email). Membros aceitos continuam vendo uns aos outros.
--    O resgate por código não depende desta leitura: accept_invite_by_code é
--    security definer e acha a linha sozinho.
--
--  O QUE MUDA NO APP
--    Editor e visualizador deixam de ver, no cartão do projeto, as linhas
--    "Pendente" de convites que ainda não foram aceitos. O dono vê tudo como
--    antes; o convidado continua vendo o próprio convite.
-- ============================================================================

drop policy if exists members_select on public.project_members;
create policy members_select on public.project_members
  for select to authenticated
  using (
    (user_id = auth.uid())
    or (status = 'pending' and lower(invited_email) = lower(auth.jwt() ->> 'email'))
    or is_project_owner(project_id)
    or (status = 'accepted' and is_project_member(project_id))
  );

notify pgrst, 'reload schema';


-- Verificação ------------------------------------------------------------------
--    Deve retornar UMA linha com ok = true.

select 'membro não lê convite pendente alheio' as item,
       exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = 'project_members'
                  and policyname = 'members_select'
                  and qual like '%accepted%is_project_member%') as ok;
