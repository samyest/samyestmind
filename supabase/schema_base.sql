-- ============================================================================
--  samyest.mind — schema base: tabelas, funções, storage e RLS como estão hoje
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
--  Pode rodar mais de uma vez sem problema: tabelas e índices usam IF NOT
--  EXISTS, funções usam CREATE OR REPLACE e cada policy é apagada e recriada.
--  Num banco que já existe, nada muda (é a fotografia dele).
--
--  O QUE É
--    profiles, projects, project_members, tasks e task_comments, as funções
--    is_project_owner, is_project_member e accept_invite_by_code, o bucket
--    avatars e as policies de tudo isso foram criados pelo painel e nunca
--    estiveram em supabase/. Este arquivo os reconstrói a partir do
--    supabase/inspecionar_schema.sql rodado no banco de produção (Postgres
--    17.6, outubro de 2026).
--
--  ⚠️  AS POLICIES AQUI SÃO AS DE HOJE, COM AS FALHAS DE HOJE
--    Elas foram copiadas como estão para o arquivo servir de registro fiel.
--    As correções ficam em supabase/rls_correcoes.sql, que precisa rodar
--    DEPOIS deste. Num banco novo, a ordem é:
--      1. schema_base.sql (este)
--      2. as migrações, nesta ordem (é a que reproduz o banco de hoje coluna
--         por coluna): google_credentials, task_color, eventos_ignorados,
--         task_sync_google, routines, task_tags, tarefas_google_unicas,
--         desafio, desafio_v2
--      3. rls_correcoes.sql
--
--  O QUE FICA DE FORA (já tem arquivo próprio)
--    Colunas de tasks acrescentadas depois: color_id, sync_google,
--    from_google, routine_id e tags. E as tabelas routines,
--    google_credentials, google_ignored_events, challenge_days e
--    challenge_entries.
--
--    Também fica de fora a função rls_auto_enable(): é o gatilho de eventos
--    que o próprio Supabase cria para ligar o RLS em toda tabela nova do
--    public.
-- ============================================================================


-- 1. Perfis ---------------------------------------------------------------------
--    Uma linha por usuário, criada pelo próprio app no onboarding (não há
--    trigger em auth.users).

create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  name           text,
  avatar_url     text,
  updated_at     timestamptz default now(),
  theme          text default 'bluegray',
  kanban_columns jsonb,
  sound_enabled  boolean default true
);


-- 2. Projetos compartilhados -------------------------------------------------

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz default now(),
  notes       text,
  columns     jsonb,
  owner_email text
);


-- 3. Membros e convites --------------------------------------------------------
--    Convite por email: invited_email preenchido, user_id nulo até aceitar.
--    Convite por código: invited_email nulo e code preenchido; quem usa o
--    código entra por accept_invite_by_code.

create table if not exists public.project_members (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  invited_email text,
  role          text not null default 'editor',
  status        text not null default 'pending',
  code          text unique,
  created_at    timestamptz default now()
);

create unique index if not exists project_members_unique_active
  on public.project_members (project_id, user_id)
  where status = 'accepted' and user_id is not null;


-- 4. Tarefas -------------------------------------------------------------------

create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  client          text,
  status          text default 'todo',
  priority        text default 'normal',
  date            date,
  notes           text,
  created_at      timestamptz default now(),
  google_event_id text,
  completed_at    timestamptz,
  project_id      uuid references public.projects(id) on delete set null,
  assigned_to     uuid references auth.users(id) on delete set null,
  time            text
);


-- 5. Comentários -----------------------------------------------------------------

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null,
  created_at timestamptz default now()
);


-- 6. Funções usadas pelas policies ---------------------------------------------
--    security definer para poderem consultar projects e project_members sem
--    cair nas policies dessas mesmas tabelas (o que daria recursão).

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable security definer
as $function$
  select exists (
    select 1 from projects
    where id = p_project_id
      and owner_id = auth.uid()
  );
$function$;

create or replace function public.is_project_member(p_project_id uuid, p_role text default null::text)
returns boolean
language sql
stable security definer
as $function$
  select exists (
    select 1 from project_members
    where project_id = p_project_id
      and user_id = auth.uid()
      and status = 'accepted'
      and (p_role is null or role = p_role)
  );
$function$;


-- 7. Entrar num projeto por código ---------------------------------------------

create or replace function public.accept_invite_by_code(p_code text)
returns json
language plpgsql
security definer
as $function$
declare
  v_row project_members%rowtype;
  v_already boolean;
begin
  select * into v_row from project_members where code = upper(p_code) and status = 'pending' limit 1;
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


-- 8. RLS e policies (como estão hoje — ver aviso no topo) ----------------------

alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks           enable row level security;
alter table public.task_comments   enable row level security;

-- profiles
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid());

-- projects
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete using (owner_id = auth.uid());

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert with check (owner_id = auth.uid());

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using ((owner_id = auth.uid()) or is_project_member(id));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update using ((owner_id = auth.uid()) or is_project_member(id, 'editor'));

-- project_members
drop policy if exists members_delete on public.project_members;
create policy members_delete on public.project_members
  for delete using ((user_id = auth.uid()) or is_project_owner(project_id));

drop policy if exists members_insert on public.project_members;
create policy members_insert on public.project_members
  for insert with check (is_project_owner(project_id));

drop policy if exists members_select on public.project_members;
create policy members_select on public.project_members
  for select using (
    (user_id = auth.uid())
    or (invited_email = (auth.jwt() ->> 'email'))
    or is_project_owner(project_id)
    or is_project_member(project_id)
  );

drop policy if exists members_update on public.project_members;
create policy members_update on public.project_members
  for update using ((invited_email = (auth.jwt() ->> 'email')) or is_project_owner(project_id));

-- tasks
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (
    (auth.uid() = user_id)
    or ((project_id is not null) and is_project_member(project_id, 'editor'))
    or ((project_id is not null) and is_project_owner(project_id))
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    (auth.uid() = user_id)
    and ((project_id is null) or is_project_member(project_id, 'editor') or is_project_owner(project_id))
  );

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (
    (auth.uid() = user_id)
    or ((project_id is not null) and is_project_member(project_id))
    or ((project_id is not null) and is_project_owner(project_id))
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    (auth.uid() = user_id)
    or ((project_id is not null) and is_project_member(project_id, 'editor'))
    or ((project_id is not null) and is_project_owner(project_id))
  );

-- task_comments
drop policy if exists "comentar em tarefas que vejo" on public.task_comments;
create policy "comentar em tarefas que vejo" on public.task_comments
  for insert with check (
    (user_id = auth.uid())
    and exists (
      select 1 from tasks t
      where t.id = task_comments.task_id
        and ((t.user_id = auth.uid())
             or ((t.project_id is not null)
                 and (is_project_member(t.project_id) or is_project_owner(t.project_id))))
    )
  );

drop policy if exists "excluir meu proprio comentario" on public.task_comments;
create policy "excluir meu proprio comentario" on public.task_comments
  for delete using (user_id = auth.uid());

drop policy if exists "ver comentarios de tarefas que vejo" on public.task_comments;
create policy "ver comentarios de tarefas que vejo" on public.task_comments
  for select using (
    exists (
      select 1 from tasks t
      where t.id = task_comments.task_id
        and ((t.user_id = auth.uid())
             or ((t.project_id is not null)
                 and (is_project_member(t.project_id) or is_project_owner(t.project_id))))
    )
  );


-- 9. Bucket de fotos de perfil ---------------------------------------------------
--    Público: a foto é lida pela URL pública, sem login. Cada pessoa grava em
--    <id do usuário>/avatar.<ext>.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists avatar_own_delete on storage.objects;
create policy avatar_own_delete on storage.objects
  for delete using ((bucket_id = 'avatars') and ((auth.uid())::text = (storage.foldername(name))[1]));

drop policy if exists avatar_own_update on storage.objects;
create policy avatar_own_update on storage.objects
  for update using ((bucket_id = 'avatars') and ((auth.uid())::text = (storage.foldername(name))[1]));

drop policy if exists avatar_own_upload on storage.objects;
create policy avatar_own_upload on storage.objects
  for insert with check ((bucket_id = 'avatars') and ((auth.uid())::text = (storage.foldername(name))[1]));

drop policy if exists avatar_public_read on storage.objects;
create policy avatar_public_read on storage.objects
  for select using (bucket_id = 'avatars');


-- 10. Realtime -------------------------------------------------------------------
--    O app escuta mudanças nestas quatro tabelas. O realtime respeita o RLS
--    de SELECT: cada pessoa só recebe o que já poderia ler.

do $$
declare
  t text;
begin
  foreach t in array array['tasks', 'projects', 'project_members', 'task_comments'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime'
                      and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;


-- 11. Atualiza o cache de esquema ----------------------------------------------

notify pgrst, 'reload schema';


-- 12. Verificação ----------------------------------------------------------------
--    Deve retornar CINCO linhas, todas com rls_ligado = true.

select c.relname as tabela, c.relrowsecurity as rls_ligado
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('profiles', 'projects', 'project_members', 'tasks', 'task_comments')
order by c.relname;
