-- ============================================================================
--  samyest.mind — correções de RLS (projetos, convites, tarefas, perfis, fotos)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Depois do supabase/schema_base.sql (num banco que já existe, pode rodar
--    direto: o schema base é a fotografia dele).
--
--  Pode rodar mais de uma vez sem problema. Não apaga nenhum dado: só troca
--  policies, permissões de coluna e uma função.
--
--  POR QUE EXISTE
--    O app esconde botões de quem só visualiza, mas isso é só a tela: a chave
--    pública está no navegador e qualquer pessoa logada pode chamar a API
--    direto, com o console aberto. Quem decide o que pode é o RLS. A revisão
--    do schema de produção (outubro de 2026) achou os furos abaixo; cada
--    bloco diz o risco que fecha.
--
--  O QUE O APP CONTINUA FAZENDO NORMALMENTE
--    Aceitar e recusar convite, entrar por código, sair do projeto, editor
--    mexer em tarefas, colunas e notas, dono convidar e remover, comentar,
--    trocar a própria foto, ver nome e foto de quem está nos mesmos projetos.
--
--  ATENÇÃO PARA O FUTURO
--    projects e project_members passam a ter UPDATE liberado só em colunas
--    específicas (blocos 2 e 3). Se o app um dia precisar alterar outra
--    coluna dessas tabelas, ela tem de entrar no "grant update (...)".
-- ============================================================================


-- 0. Funções auxiliares ----------------------------------------------------------
--    security definer sem search_path fixo resolve nomes de tabela pelo
--    search_path de quem chama. Fixar em public impede que alguém com acesso
--    a SQL faça a função ler uma tabela "projects" de outro schema.

alter function public.is_project_owner(uuid)        set search_path = public;
alter function public.is_project_member(uuid, text) set search_path = public;

-- Verdadeiro quando o usuário logado e p_user estão juntos em algum projeto
-- (como dono ou membro aceito). Usada pela policy de profiles, bloco 5.
create or replace function public.shares_project_with(p_user uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $function$
  with meus as (
    select id as project_id from projects where owner_id = auth.uid()
    union
    select project_id from project_members
     where user_id = auth.uid() and status = 'accepted'
  ),
  dele as (
    select id as project_id from projects where owner_id = p_user
    union
    select project_id from project_members
     where user_id = p_user and status = 'accepted'
  )
  select exists (select 1 from meus join dele using (project_id));
$function$;


-- 1. Convites e membros (CRÍTICO) ---------------------------------------------
--
--  RISCO: visualizador vira editor sozinho, e qualquer convidado entra em
--  qualquer projeto.
--    A policy members_update deixava quem tem invited_email = seu email
--    alterar A PRÓPRIA linha de membro em qualquer coluna, a qualquer momento
--    — e accept_invite_by_code grava o email de quem entra por código, então
--    vale para todos os membros. Com o console aberto:
--      update project_members set role = 'editor' where user_id = <eu>
--    promovia o visualizador a editor (e daí ele altera e apaga tarefas,
--    colunas e notas). Trocar project_id pelo id de outro projeto fazia a
--    pessoa entrar como editor num projeto para o qual nunca foi convidada.
--
--  CORREÇÃO: o convidado só pode fazer uma coisa — aceitar o próprio convite
--  pendente, gravando user_id = ele e status = 'accepted'. E, para qualquer
--  um, UPDATE só existe nas colunas user_id e status: role, project_id,
--  invited_email e code ficam fora de alcance pela API. O dono não alterava
--  linhas de membro pelo app (ele convida e remove), então perde o UPDATE.

drop policy if exists members_update on public.project_members;
create policy members_update on public.project_members
  for update to authenticated
  using (
    status = 'pending'
    and lower(invited_email) = lower(auth.jwt() ->> 'email')
  )
  with check (
    status = 'accepted'
    and user_id = auth.uid()
    and lower(invited_email) = lower(auth.jwt() ->> 'email')
  );

revoke update on public.project_members from anon, authenticated;
grant update (user_id, status) on public.project_members to authenticated;

--  RISCO: o dono põe qualquer pessoa no projeto sem convite.
--    members_insert só checava se quem insere é o dono. Ele podia inserir
--    uma linha já com user_id = <qualquer usuário> e status = 'accepted' e
--    atribuir tarefas a ela — que viram eventos na agenda do Google da
--    vítima, sem ela ter aceitado nada.
--
--  CORREÇÃO: convite nasce pendente e sem usuário, com papel válido; quem
--  preenche o user_id é o próprio convidado ao aceitar.

drop policy if exists members_insert on public.project_members;
create policy members_insert on public.project_members
  for insert to authenticated
  with check (
    is_project_owner(project_id)
    and status = 'pending'
    and user_id is null
    and role in ('editor', 'viewer')
  );

--  BUG (não é furo): recusar convite por email não fazia nada.
--    Convite por email tem user_id nulo, e members_delete só deixava apagar
--    a linha com user_id = eu ou sendo dono. "Recusar" voltava sem erro, mas
--    o convite continuava lá; o mesmo no "você já era membro" do aceite.
--
--  CORREÇÃO: o convidado também apaga o próprio convite pendente.

drop policy if exists members_delete on public.project_members;
create policy members_delete on public.project_members
  for delete to authenticated
  using (
    (user_id = auth.uid())
    or is_project_owner(project_id)
    or (status = 'pending' and lower(invited_email) = lower(auth.jwt() ->> 'email'))
  );


-- 2. Projetos ------------------------------------------------------------------
--
--  RISCO: editor toma o projeto do dono.
--    projects_update deixa o editor alterar a linha do projeto, e sem WITH
--    CHECK próprio o Postgres reusa o USING na linha nova — que continua
--    verdadeiro para o editor. Então
--      update projects set owner_id = <eu> where id = <projeto>
--    passava: o editor virava dono, e com isso podia apagar o projeto e
--    remover todo mundo.
--    (Visualizador não altera columns nem notes — isso já estava certo.)
--
--  CORREÇÃO: pela API, UPDATE em projects só nas colunas que o app edita:
--  name, columns e notes. owner_id e owner_email ficam fixos.

revoke update on public.projects from anon, authenticated;
grant update (name, columns, notes) on public.projects to authenticated;


-- 3. Tarefas -------------------------------------------------------------------
--
--  RISCO: visualizador (ou alguém de fora) põe tarefas num projeto e mexe
--  nelas.
--    tasks_insert exige ser editor ou dono para criar tarefa num projeto,
--    mas tasks_update não tinha WITH CHECK, e a regra "a tarefa é minha"
--    valia na linha nova. Bastava criar uma tarefa pessoal e depois
--      update tasks set project_id = <projeto> where id = <minha tarefa>
--    para enfiá-la num projeto onde a pessoa é só visualizadora — ou num
--    projeto do qual nem faz parte, sabendo o id. Dali em diante ela editava
--    e apagava essa tarefa dentro do projeto como se fosse editora.
--
--  CORREÇÃO: tarefa pessoal (sem projeto) só o dono dela altera e apaga;
--  tarefa de projeto, só editor ou dono do projeto — antes e depois da
--  alteração. Visualizador não faz UPDATE nem DELETE em tarefa de projeto,
--  nem nas que ele mesmo criou quando ainda era editor.

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (
    ((project_id is null) and (auth.uid() = user_id))
    or ((project_id is not null)
        and (is_project_member(project_id, 'editor') or is_project_owner(project_id)))
  )
  with check (
    ((project_id is null) and (auth.uid() = user_id))
    or ((project_id is not null)
        and (is_project_member(project_id, 'editor') or is_project_owner(project_id)))
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (
    ((project_id is null) and (auth.uid() = user_id))
    or ((project_id is not null)
        and (is_project_member(project_id, 'editor') or is_project_owner(project_id)))
  );


-- 4. Entrar por código ---------------------------------------------------------
--
--  RISCO: código de convite queimado sem login, e função sem search_path.
--    accept_invite_by_code roda como dono do banco e podia ser chamada pelo
--    papel anon (a chave pública, sem login). Com auth.uid() nulo, ela
--    marcava o convite como aceito por ninguém e apagava o código: dava para
--    sair testando códigos e inutilizar convites alheios.
--
--  CORREÇÃO: exige login, trava a linha do convite enquanto aceita (dois
--  usando o mesmo código ao mesmo tempo não entram os dois) e só o papel
--  authenticated pode executar. O retorno continua o mesmo que o app espera.

create or replace function public.accept_invite_by_code(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row project_members%rowtype;
  v_already boolean;
begin
  if auth.uid() is null then
    return json_build_object('success', false, 'error', 'Entre na sua conta para usar o código');
  end if;

  select * into v_row from project_members
   where code = upper(p_code) and status = 'pending'
   limit 1
   for update;
  if not found then
    return json_build_object('success', false, 'error', 'Código inválido ou já usado');
  end if;

  select exists(
    select 1 from project_members
    where project_id = v_row.project_id and user_id = auth.uid() and status = 'accepted'
  ) into v_already;

  if v_already then
    delete from project_members where id = v_row.id;
    return json_build_object('success', true, 'project_id', v_row.project_id, 'already_member', true);
  end if;

  update project_members
  set user_id = auth.uid(),
      status = 'accepted',
      invited_email = coalesce((auth.jwt() ->> 'email'), invited_email),
      code = null
  where id = v_row.id;

  return json_build_object('success', true, 'project_id', v_row.project_id);
end;
$function$;

revoke execute on function public.accept_invite_by_code(text) from public, anon;
grant execute on function public.accept_invite_by_code(text) to authenticated;


-- 5. Perfis --------------------------------------------------------------------
--
--  RISCO: qualquer um, mesmo sem login, lista todos os usuários.
--    profiles_select_all era "using (true)" para todos os papéis: com a
--    chave pública dava para baixar id, nome, foto, tema, som e as colunas
--    do Kanban pessoal (nomes de clientes, às vezes) de todas as contas. O id
--    vazado também era o que faltava para o ataque do bloco 1 (pôr alguém
--    num projeto à força).
--
--  CORREÇÃO: cada pessoa logada vê o próprio perfil e o de quem está com ela
--  em algum projeto — exatamente o que o app usa (membros, dono, autores de
--  comentários).
--
--  O QUE AINDA FICA: entre colegas de projeto, a linha inteira continua
--  legível (tema, som e colunas do Kanban pessoal), porque o RLS filtra
--  linhas, não colunas. Fechar isso pede uma view só com id, name e
--  avatar_url e trocar as duas consultas do script.js que leem perfis de
--  outras pessoas para ela.

drop policy if exists profiles_select_all on public.profiles;
drop policy if exists profiles_select_own_or_team on public.profiles;
create policy profiles_select_own_or_team on public.profiles
  for select to authenticated
  using ((id = auth.uid()) or public.shares_project_with(id));


-- 6. Fotos de perfil -----------------------------------------------------------
--
--  RISCO: listar o bucket inteiro e hospedar qualquer arquivo nele.
--    avatar_public_read liberava SELECT em storage.objects do bucket para
--    todos — isso não é o que serve a foto (bucket público serve a URL
--    pública sem passar pelo RLS), é o que permite LISTAR o bucket: a lista
--    de pastas é a lista de ids de todos os usuários. E o bucket aceitava
--    qualquer tipo e tamanho de arquivo: cada conta podia hospedar HTML, SVG
--    ou um executável numa URL pública do projeto.
--    (Sobrescrever a foto de outra pessoa já era impossível: insert, update
--    e delete exigem que a pasta seja o próprio id.)
--
--  CORREÇÃO: cada pessoa só enxerga a própria pasta (o upload com upsert do
--  app precisa disso), e o bucket só aceita as imagens que o app aceita,
--  até 4 MB — o mesmo limite que o app já confere antes de enviar.

drop policy if exists avatar_public_read on storage.objects;
drop policy if exists avatar_own_read on storage.objects;
create policy avatar_own_read on storage.objects
  for select to authenticated
  using ((bucket_id = 'avatars') and ((auth.uid())::text = (storage.foldername(name))[1]));

update storage.buckets
   set file_size_limit    = 4194304,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
 where id = 'avatars';


-- 7. Credenciais do Google -----------------------------------------------------
--
--  ESTAVA CERTO: RLS ligado e nenhuma policy, então anon e authenticated não
--  leem nada. Mas os dois papéis ainda tinham GRANT completo na tabela: a
--  única coisa entre o navegador e os refresh tokens era nunca ninguém criar
--  uma policy ali.
--
--  CORREÇÃO (segunda tranca): tira os GRANTs. As funções em api/ usam a
--  service role, que continua com acesso.

revoke all on public.google_credentials from anon, authenticated;


-- 8. Atualiza o cache de esquema ----------------------------------------------

notify pgrst, 'reload schema';


-- 9. Verificação ---------------------------------------------------------------
--    Deve retornar DEZ linhas, todas com ok = true.

select item, ok from (values
  ('1. convidado só aceita o próprio convite',
   exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_members'
            and policyname = 'members_update' and with_check is not null)),
  ('1. membro não altera role nem project_id',
   not has_column_privilege('authenticated', 'public.project_members', 'role', 'UPDATE')
   and not has_column_privilege('authenticated', 'public.project_members', 'project_id', 'UPDATE')),
  ('1. convite nasce pendente',
   exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_members'
            and policyname = 'members_insert' and with_check like '%pending%')),
  ('2. editor não troca o dono do projeto',
   not has_column_privilege('authenticated', 'public.projects', 'owner_id', 'UPDATE')
   and has_column_privilege('authenticated', 'public.projects', 'notes', 'UPDATE')),
  ('3. tasks_update com with check',
   exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks'
            and policyname = 'tasks_update' and with_check is not null)),
  ('4. anon não executa accept_invite_by_code',
   not has_function_privilege('anon', 'public.accept_invite_by_code(text)', 'EXECUTE')),
  ('5. perfis fechados para quem não é do projeto',
   not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
                and policyname = 'profiles_select_all')),
  ('6. bucket avatars não é listável',
   not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                and policyname = 'avatar_public_read')),
  ('6. bucket avatars só aceita imagem',
   exists (select 1 from storage.buckets where id = 'avatars' and allowed_mime_types is not null)),
  ('7. google_credentials sem grant e sem policy',
   not has_table_privilege('authenticated', 'public.google_credentials', 'SELECT')
   and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'google_credentials'))
) as v(item, ok);
