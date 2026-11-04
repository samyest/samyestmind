-- ============================================================================
--  samyest.mind — cargos e configurações do projeto (RFC 0005)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Depois de rls_correcoes.sql e tarefas_projeto_acesso.sql. Pode rodar antes
--    ou depois de publicar o código: sem isto, o app mostra os três cargos de
--    antes, a ordem de abas padrão e as regras de cargo padrão, e avisa ao
--    salvar que falta rodar este arquivo.
--
--  Pode rodar mais de uma vez sem problema.
--
--  O QUE É
--    - Cargo novo, PARTICIPANTE: mexe nas tarefas (cria, edita, move, apaga,
--      comenta), mas não na estrutura (colunas, notas, canais, ícone, nome,
--      abas). Editor e visualizador continuam como eram (SEC-085).
--    - definir_cargo_membro(): o dono muda o cargo de alguém. O UPDATE direto em
--      project_members continua fechado (SEC-084).
--    - projects.regras_cargos: quais cargos podem silenciar e mover outros nas
--      salas de voz. Só o dono muda (SEC-086).
--    - projects.ordem_abas: a ordem das abas do projeto, igual para todos. Dono
--      e editores mudam.
--    - tem_permissao_voz() e nivel_no_projeto(): usadas pela moderação das
--      salas, em salas_projeto.sql.
-- ============================================================================


-- 1. Cargo participante ---------------------------------------------------------
--    O check entra "not valid": vale para toda linha nova e alterada, sem
--    reprovar alguma linha antiga que tenha outro valor.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_members_role_valido') then
    alter table public.project_members
      add constraint project_members_role_valido
      check (role in ('editor', 'participante', 'viewer')) not valid;
  end if;
end $$;

-- A mesma policy do rls_correcoes.sql, com o cargo novo na lista.
drop policy if exists members_insert on public.project_members;
create policy members_insert on public.project_members
  for insert to authenticated
  with check (
    is_project_owner(project_id)
    and status = 'pending'
    and user_id is null
    and role in ('editor', 'participante', 'viewer')
  );


-- 2. Tarefas: o participante mexe nelas (SEC-085) --------------------------------
--    As mesmas policies do rls_correcoes.sql, com o participante ao lado do
--    editor. Tarefa pessoal continua só da própria pessoa, e o visualizador
--    continua sem escrita em tarefa de projeto.

create or replace function public.mexe_em_tarefas(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from projects where id = p_project_id and owner_id = auth.uid())
      or exists (select 1 from project_members
                  where project_id = p_project_id
                    and user_id = auth.uid()
                    and status = 'accepted'
                    and role in ('editor', 'participante'));
$$;

revoke all on function public.mexe_em_tarefas(uuid) from public, anon;
grant execute on function public.mexe_em_tarefas(uuid) to authenticated;

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    (auth.uid() = user_id)
    and ((project_id is null) or mexe_em_tarefas(project_id))
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (
    ((project_id is null) and (auth.uid() = user_id))
    or ((project_id is not null) and mexe_em_tarefas(project_id))
  )
  with check (
    ((project_id is null) and (auth.uid() = user_id))
    or ((project_id is not null) and mexe_em_tarefas(project_id))
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (
    ((project_id is null) and (auth.uid() = user_id))
    or ((project_id is not null) and mexe_em_tarefas(project_id))
  );


-- 3. O dono muda o cargo (SEC-084) -------------------------------------------------
--    security definer porque o dono não tem UPDATE em project_members: dar o
--    grant de role valeria também para o convidado, que escolheria o próprio
--    cargo ao aceitar o convite. Serve para convite pendente e para membro.

create or replace function public.definir_cargo_membro(p_membro uuid, p_cargo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_projeto uuid;
begin
  if auth.uid() is null then
    raise exception 'cargo_sem_login: entre na conta' using errcode = '42501';
  end if;
  if p_cargo is null or p_cargo not in ('editor', 'participante', 'viewer') then
    raise exception 'cargo_invalido: cargo desconhecido' using errcode = '22023';
  end if;
  select project_id into v_projeto from project_members where id = p_membro;
  if v_projeto is null or not is_project_owner(v_projeto) then
    raise exception 'cargo_sem_permissao: só o dono do projeto muda cargos' using errcode = '42501';
  end if;
  update project_members set role = p_cargo where id = p_membro;
end $$;

revoke all on function public.definir_cargo_membro(uuid, text) from public, anon;
grant execute on function public.definir_cargo_membro(uuid, text) to authenticated;


-- 4. Regras de cargo e ordem das abas (SEC-086) ------------------------------------
--    As duas colunas são jsonb de lista fechada. O check usa funções immutable
--    porque check não aceita subconsulta.
--
--    regras_cargos: {"editor": ["silenciar", "mover"], "participante": [], ...}
--      Nulo, ou cargo ausente, é o padrão: editor com as duas, os outros sem.
--    ordem_abas: ["chat", "inicio", "kanban", "calendar", "notes"]
--      Nulo é a ordem padrão do app. Aba que faltar na lista entra no fim.

create or replace function public.regras_cargos_validas(r jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select r is null or (
    jsonb_typeof(r) = 'object'
    and not exists (
      select 1 from jsonb_each(r) e
       where e.key not in ('editor', 'participante', 'viewer')
          or jsonb_typeof(e.value) <> 'array'
          or jsonb_array_length(e.value) > 2
          or not (e.value <@ '["silenciar", "mover"]'::jsonb)
    )
  );
$$;

create or replace function public.ordem_abas_valida(r jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select r is null or (
    jsonb_typeof(r) = 'array'
    and jsonb_array_length(r) between 1 and 5
    and r <@ '["inicio", "kanban", "calendar", "notes", "chat"]'::jsonb
    and (select count(distinct x) from jsonb_array_elements_text(r) x) = jsonb_array_length(r)
  );
$$;

alter table public.projects add column if not exists regras_cargos jsonb;
alter table public.projects add column if not exists ordem_abas    jsonb;

alter table public.projects drop constraint if exists projects_regras_cargos_validas;
alter table public.projects add constraint projects_regras_cargos_validas
  check (public.regras_cargos_validas(regras_cargos));

alter table public.projects drop constraint if exists projects_ordem_abas_valida;
alter table public.projects add constraint projects_ordem_abas_valida
  check (public.ordem_abas_valida(ordem_abas));

-- O editor altera projects pela policy de sempre (projects_update). As regras
-- de cargo ficam só com o dono: sem isto, o editor daria a si mesmo poder de
-- moderar quem o dono não quis. Pelo SQL Editor (sem auth.uid()) passa.
create or replace function public.projeto_regras_so_dono()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.regras_cargos is distinct from old.regras_cargos
     and auth.uid() is not null
     and not is_project_owner(new.id) then
    raise exception 'regras_so_dono: só o dono muda as regras de cargo' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.projeto_regras_so_dono() from public, anon, authenticated;

drop trigger if exists projects_regras_so_dono on public.projects;
create trigger projects_regras_so_dono
  before update of regras_cargos on public.projects
  for each row execute function public.projeto_regras_so_dono();

-- Soma ao grant de rls_correcoes.sql e icone_projeto.sql. owner_id e
-- owner_email continuam fixos.
grant update (regras_cargos, ordem_abas) on public.projects to authenticated;


-- 5. Funções usadas pela moderação das salas ----------------------------------------
--    security definer para ler o cargo sem cair no RLS de project_members.
--    nivel_no_projeto revela o cargo de qualquer pessoa em qualquer projeto,
--    então fica sem grant: só as outras funções do banco a chamam.

create or replace function public.nivel_no_projeto(p_project_id uuid, p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user is null then null
    when exists (select 1 from projects where id = p_project_id and owner_id = p_user) then 3
    else (select case m.role when 'editor' then 2 when 'participante' then 1 else 0 end
            from project_members m
           where m.project_id = p_project_id and m.user_id = p_user and m.status = 'accepted'
           limit 1)
  end;
$$;

revoke all on function public.nivel_no_projeto(uuid, uuid) from public, anon, authenticated;

-- A permissão de voz de quem chama: o dono sempre; os outros pela regra do
-- cargo (ou pelo padrão, se o dono nunca mexeu).
create or replace function public.tem_permissao_voz(p_project_id uuid, p_permissao text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with eu as (
    select p.owner_id = auth.uid() as dono, p.regras_cargos as regras,
           (select m.role from project_members m
             where m.project_id = p.id and m.user_id = auth.uid() and m.status = 'accepted'
             limit 1) as cargo
      from projects p
     where p.id = p_project_id
  )
  select coalesce((
    select case
      when dono then true
      when cargo is null then false
      when regras ? cargo then (regras -> cargo) ? p_permissao
      else cargo = 'editor' and p_permissao in ('silenciar', 'mover')
    end
    from eu
  ), false)
  and p_permissao in ('silenciar', 'mover');
$$;

revoke all on function public.tem_permissao_voz(uuid, text) from public, anon;
grant execute on function public.tem_permissao_voz(uuid, text) to authenticated;


-- 6. Atualiza o cache de esquema --------------------------------------------------

notify pgrst, 'reload schema';


-- 7. Verificação ------------------------------------------------------------------
--    Deve retornar UMA linha com tudo true:
--      cargo     — a policy de convite aceita participante e o check existe
--      tarefas   — as três policies de escrita usam mexe_em_tarefas
--      funcao    — definir_cargo_membro é security definer com search_path, e
--                  authenticated continua sem UPDATE em project_members.role
--      colunas   — regras_cargos e ordem_abas existem, com check e grant
--      gatilho   — o gatilho das regras existe
--      nivel     — nivel_no_projeto não está liberada para authenticated

select
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'project_members'
             and policyname = 'members_insert' and with_check like '%participante%')
  and exists (select 1 from pg_constraint where conname = 'project_members_role_valido') as cargo,
  (select count(*) = 3 from pg_policies
    where schemaname = 'public' and tablename = 'tasks'
      and policyname in ('tasks_insert', 'tasks_update', 'tasks_delete')
      and coalesce(qual, '') || coalesce(with_check, '') like '%mexe_em_tarefas%')      as tarefas,
  (select prosecdef and proconfig is not null from pg_proc
    where oid = 'public.definir_cargo_membro(uuid, text)'::regprocedure)
  and not has_column_privilege('authenticated', 'public.project_members', 'role', 'UPDATE') as funcao,
  has_column_privilege('authenticated', 'public.projects', 'regras_cargos', 'UPDATE')
  and has_column_privilege('authenticated', 'public.projects', 'ordem_abas', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.projects', 'owner_id', 'UPDATE')
  and (select count(*) = 2 from pg_constraint
        where conrelid = 'public.projects'::regclass
          and conname in ('projects_regras_cargos_validas', 'projects_ordem_abas_valida')) as colunas,
  exists (select 1 from pg_trigger
           where not tgisinternal and tgname = 'projects_regras_so_dono')        as gatilho,
  not has_function_privilege('authenticated', 'public.nivel_no_projeto(uuid, uuid)', 'EXECUTE') as nivel;
