-- ============================================================================
--  samyest.mind — Desafio, parte 2: metas e registro de comida
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    (depois do supabase/desafio.sql)
--
--  Pode rodar mais de uma vez sem problema.
--
--  O Supabase vai avisar "destructive operations" por causa do DROP
--  CONSTRAINT: ele só troca a regra que diz quais tipos de lançamento valem,
--  pra aceitar os tipos novos. Nenhuma tabela e nenhum dado é apagado.
--
--  O QUE MUDA em challenge_entries
--    kind 'meta'     — meta com prazo (date) e status 'aberta' ou 'feita'
--    kind 'comida'   — o que foi comido: label = texto, value = kcal, protein = g
--    kind 'alimento' — alimento cadastrado à mão: value = kcal e protein = g por porção
-- ============================================================================

alter table public.challenge_entries
  drop constraint if exists challenge_entries_kind_check;

alter table public.challenge_entries
  add constraint challenge_entries_kind_check
  check (kind in ('peso', 'freela', 'vaga', 'meta', 'comida', 'alimento'));

alter table public.challenge_entries
  add column if not exists protein numeric;

notify pgrst, 'reload schema';

-- Verificação: deve retornar a regra nova com os 6 tipos e a coluna protein.
select conname as item, pg_get_constraintdef(oid) as detalhe
from pg_constraint
where conname = 'challenge_entries_kind_check'
union all
select 'coluna protein', data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'challenge_entries' and column_name = 'protein';
