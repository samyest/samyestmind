-- ============================================================================
--  samyest.mind — várias notas por projeto
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Rode ANTES de publicar o código das notas novas. Sem isto o app continua
--    mostrando a nota única de antes, sem perder nada.
--
--  Pode rodar mais de uma vez sem problema (IF NOT EXISTS, policies apagadas
--  e recriadas, cópia da nota antiga só onde ainda não há notas).
--
--  O QUE É
--    A aba Notas do projeto vira uma lista de notas com título ("Reunião de
--    heads 16/10", "Marketing setembro"…), cada uma com quem escreveu e quando.
--    O texto que já existia em projects.notes vira a primeira nota de cada
--    projeto, chamada "Notas gerais". A coluna projects.notes fica onde está,
--    intocada, como cópia de segurança.
--
--  QUEM PODE
--    As mesmas regras das tarefas do projeto: dono e membros leem; dono e
--    editores criam, editam e apagam qualquer nota. Visualizador só lê.
-- ============================================================================


-- 1. Tabela --------------------------------------------------------------------

create table if not exists public.project_notes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  title       text not null default '' check (char_length(title) <= 160),
  body        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists project_notes_projeto_idx
  on public.project_notes (project_id, created_at desc);

alter table public.project_notes enable row level security;


-- 2. Permissões ----------------------------------------------------------------

drop policy if exists notes_select on public.project_notes;
create policy notes_select on public.project_notes
  for select using (is_project_owner(project_id) or is_project_member(project_id));

-- Quem cria assina a nota com o próprio id.
drop policy if exists notes_insert on public.project_notes;
create policy notes_insert on public.project_notes
  for insert with check (
    author_id = auth.uid()
    and (is_project_owner(project_id) or is_project_member(project_id, 'editor'))
  );

-- O with check impede mover a nota para um projeto em que a pessoa não edita.
drop policy if exists notes_update on public.project_notes;
create policy notes_update on public.project_notes
  for update
  using (is_project_owner(project_id) or is_project_member(project_id, 'editor'))
  with check (is_project_owner(project_id) or is_project_member(project_id, 'editor'));

drop policy if exists notes_delete on public.project_notes;
create policy notes_delete on public.project_notes
  for delete using (is_project_owner(project_id) or is_project_member(project_id, 'editor'));


-- 3. A nota antiga vira "Notas gerais" ------------------------------------------
--    Só em projetos que têm texto (ou imagem) na nota antiga e ainda não têm
--    nenhuma nota nova, então rodar de novo não duplica.

insert into public.project_notes (project_id, author_id, title, body, created_at, updated_at)
select p.id, p.owner_id, 'Notas gerais', p.notes, coalesce(p.created_at, now()), now()
from public.projects p
where p.notes is not null
  and (
    p.notes ~* '<img'
    or btrim(replace(regexp_replace(p.notes, '<[^>]*>', '', 'g'), '&nbsp;', ' ')) <> ''
  )
  and not exists (select 1 from public.project_notes n where n.project_id = p.id);


-- 4. Realtime --------------------------------------------------------------------
--    Quem está com o projeto aberto vê a nota nova de outra pessoa aparecer.

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = 'project_notes') then
    alter publication supabase_realtime add table public.project_notes;
  end if;
end $$;


-- 5. Atualiza o cache de esquema -------------------------------------------------

notify pgrst, 'reload schema';


-- 6. Verificação -----------------------------------------------------------------
--    Deve retornar QUATRO policies (notes_select, notes_insert, notes_update,
--    notes_delete) e, na última linha, quantas notas existem agora.

select policyname as item, cmd as detalhe
from pg_policies
where schemaname = 'public' and tablename = 'project_notes'
union all
select 'notas no total', count(*)::text from public.project_notes;
