-- ============================================================================
--  samyest.mind — Metas para todas as contas
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Rode ANTES de publicar o código que abre as Metas para todo mundo: sem
--    isto, as outras contas veem a seção mas não conseguem criar nada.
--
--  Pode rodar mais de uma vez sem problema.
--
--  O QUE MUDA
--    1. As Metas (goals e goal_entries) deixam de ser só da conta dona. Cada
--       conta lê e grava apenas as próprias metas; o registro de um dia só
--       pode apontar para uma meta da mesma conta. O Desafio continua restrito
--       (tabelas challenge_*, intocadas aqui).
--    2. profiles.novidades_vistas guarda as apresentações de novidade que a
--       pessoa já fechou ("metas" é a primeira), para o aviso aparecer uma vez
--       por conta, e não uma vez por aparelho.
-- ============================================================================


-- 1. Metas: cada conta com as suas ------------------------------------------

drop policy if exists "own goals" on public.goals;
create policy "own goals"
  on public.goals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own goal entries" on public.goal_entries;
create policy "own goal entries"
  on public.goal_entries
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid())
  );


-- 2. Novidades já apresentadas ----------------------------------------------

alter table public.profiles
  add column if not exists novidades_vistas text[] not null default '{}';


-- 3. Atualiza o cache de esquema ---------------------------------------------

notify pgrst, 'reload schema';


-- 4. Verificação -------------------------------------------------------------
--    Deve retornar TRÊS linhas: as duas policies, SEM o email no texto, e a
--    coluna novidades_vistas.

select tablename as item, qual as detalhe
from pg_policies
where schemaname = 'public' and tablename in ('goals', 'goal_entries')
union all
select 'coluna profiles.novidades_vistas', data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'novidades_vistas';
