-- ============================================================================
--  samyest.mind — tabela de credenciais do Google Calendar
-- ============================================================================
--
--  ONDE RODAR
--    1. Abra https://supabase.com/dashboard
--    2. Selecione o projeto (nufcsghiitooamcgukbw)
--    3. Menu lateral -> SQL Editor -> New query
--    4. Cole este arquivo inteiro e clique em Run
--
--  Pode rodar mais de uma vez sem problema (usa IF NOT EXISTS).
--
--  POR QUE O RLS FICA SEM POLICY
--    O refresh_token dá acesso contínuo ao Google Calendar da pessoa. Com RLS
--    ligado e nenhuma policy criada, a chave pública que roda no navegador não
--    consegue ler nem escrever nada aqui — só a service_role key, que existe
--    apenas nas variáveis de ambiente da Vercel. Isso é intencional: se um dia
--    alguém criar uma policy "permissiva" nesta tabela, os tokens vazam.
-- ============================================================================


-- 1. A tabela ------------------------------------------------------------------

create table if not exists public.google_credentials (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  refresh_token text        not null,
  access_token  text,
  expires_at    timestamptz,
  calendar_id   text,
  sync_token    text,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);


-- 2. Tranca o acesso -----------------------------------------------------------

alter table public.google_credentials enable row level security;

-- (nenhuma policy de propósito — ver explicação no topo)


-- 3. Verificação ---------------------------------------------------------------
--    Deve retornar UMA linha, com rls_ligado = true e policies = 0.
--    Se policies for maior que 0, algo está errado: os tokens ficam expostos.

select
  c.relname                                        as tabela,
  c.relrowsecurity                                 as rls_ligado,
  (select count(*) from pg_policies p
    where p.schemaname = 'public'
      and p.tablename  = 'google_credentials')     as policies,
  case
    when c.relrowsecurity and (select count(*) from pg_policies p
      where p.schemaname = 'public'
        and p.tablename  = 'google_credentials') = 0
    then 'OK — pronto para uso'
    else 'ATENCAO — revise, os tokens podem estar expostos'
  end                                              as status
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'google_credentials';
