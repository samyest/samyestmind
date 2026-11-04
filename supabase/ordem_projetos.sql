-- ============================================================================
--  samyest.mind — ordem dos projetos na barra lateral
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Pode rodar antes ou depois de publicar o código. Sem isto, a ordem que a
--    pessoa escolhe (segurando e arrastando o projeto) vale só no navegador
--    em que ela mexeu; com isto, vale em todos os aparelhos da conta.
--
--  Pode rodar mais de uma vez sem problema.
--
--  O QUE É
--    profiles.ordem_projetos guarda os ids dos projetos na ordem em que a
--    própria pessoa os quer ver. É só dela: quem escreve é ela mesma, pela
--    policy profiles_update_own, e nenhuma outra pessoa vê a ordem (o RLS de
--    profiles já limita a leitura). Projeto que não está na lista aparece no
--    fim, então convite aceito e projeto novo não somem.
-- ============================================================================

alter table public.profiles add column if not exists ordem_projetos jsonb;

alter table public.profiles drop constraint if exists profiles_ordem_projetos_valida;
alter table public.profiles add constraint profiles_ordem_projetos_valida check (
  ordem_projetos is null
  or (jsonb_typeof(ordem_projetos) = 'array' and jsonb_array_length(ordem_projetos) <= 500)
);

-- Se o grant de update de profiles for por coluna neste projeto, libera a nova.
-- Se for da tabela inteira, este comando não muda nada.
grant update (ordem_projetos) on public.profiles to authenticated;

notify pgrst, 'reload schema';


-- Verificação ---------------------------------------------------------------------
--    Deve retornar UMA linha com tudo true:
--      coluna  — a coluna existe
--      grant   — authenticated grava a coluna
--      check   — o limite de tamanho existe

select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles'
             and column_name = 'ordem_projetos')                              as coluna,
  has_column_privilege('authenticated', 'public.profiles', 'ordem_projetos', 'UPDATE') as grant,
  exists (select 1 from pg_constraint
           where conrelid = 'public.profiles'::regclass
             and conname = 'profiles_ordem_projetos_valida')                  as check;
