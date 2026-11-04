-- ============================================================================
--  samyest.mind — fonte e cor do nome (RFC 0005, SEC-089)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Pode rodar antes ou depois de publicar o código. Sem isto, todo nome
--    aparece na fonte do app, e as Configurações avisam ao salvar que falta
--    rodar este arquivo.
--
--  Pode rodar mais de uma vez sem problema.
--
--  O QUE É
--    Cada pessoa escolhe uma fonte e uma cor para o próprio nome, que aparece
--    assim no chat, na chamada, nas salas e na lista de pessoas dos projetos.
--      nome_fonte — nula (a fonte do app) ou uma chave da lista abaixo, a
--                   mesma de FONTES_NOME no script.js. Fonte nova entra nos
--                   dois. A font-family sai do styles.css, nunca do banco.
--      nome_cor   — nula (a cor do texto) ou #rrggbb.
--    Só a própria pessoa muda, pela policy profiles_update_own.
-- ============================================================================

alter table public.profiles add column if not exists nome_fonte text;
alter table public.profiles add column if not exists nome_cor   text;

alter table public.profiles drop constraint if exists profiles_nome_fonte_valida;
alter table public.profiles add constraint profiles_nome_fonte_valida check (
  nome_fonte is null or nome_fonte in (
    'grotesca', 'serifada', 'mono', 'manuscrita', 'arredondada',
    'pixel', 'marcante', 'elegante', 'retro'
  )
);

alter table public.profiles drop constraint if exists profiles_nome_cor_valida;
alter table public.profiles add constraint profiles_nome_cor_valida check (
  nome_cor is null or nome_cor ~ '^#[0-9A-Fa-f]{6}$'
);

-- Se o grant de update de profiles for por coluna neste projeto, libera as
-- novas. Se for da tabela inteira, este comando não muda nada.
grant update (nome_fonte, nome_cor) on public.profiles to authenticated;

notify pgrst, 'reload schema';


-- Verificação ---------------------------------------------------------------------
--    Deve retornar UMA linha com tudo true:
--      colunas — as duas colunas existem
--      grant   — authenticated grava as duas
--      checks  — os dois checks existem

select
  (select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('nome_fonte', 'nome_cor'))                           as colunas,
  has_column_privilege('authenticated', 'public.profiles', 'nome_fonte', 'UPDATE')
  and has_column_privilege('authenticated', 'public.profiles', 'nome_cor', 'UPDATE') as grant,
  (select count(*) = 2 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname in ('profiles_nome_fonte_valida', 'profiles_nome_cor_valida')) as checks;
