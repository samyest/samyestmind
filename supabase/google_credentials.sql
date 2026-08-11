-- Guarda a credencial do Google de cada usuário.
--
-- IMPORTANTE: o RLS fica ligado e SEM NENHUMA POLICY de propósito. Isso faz com
-- que a chave pública (anon) do navegador não consiga ler nem escrever nada aqui
-- — só a service_role key, que vive apenas nas variáveis de ambiente da Vercel,
-- tem acesso. O refresh_token dá acesso contínuo ao calendário da pessoa, então
-- ele nunca pode chegar ao navegador.

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

alter table public.google_credentials enable row level security;

-- Sem policies: nenhum acesso via anon/authenticated. Apenas service_role.
