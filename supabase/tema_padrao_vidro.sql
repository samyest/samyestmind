-- ============================================================================
--  samyest.mind — Vidro como tema padrão
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Pode rodar mais de uma vez.
--
--  O QUE É
--    Conta nova passa a nascer no tema Vidro. Quem já tem conta continua no
--    tema que está salvo no perfil; troca em Configurações -> Aparência.
--    O código já grava 'vidro' ao criar o perfil; isto deixa o banco com o
--    mesmo padrão, para perfil criado à mão ou por outro caminho.
-- ============================================================================

alter table public.profiles alter column theme set default 'vidro';

-- Verificação: deve mostrar 'vidro'::text
select column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'theme';
