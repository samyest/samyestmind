-- ============================================================================
--  samyest.mind — chamadas dos projetos (RFC 0002, fase 2)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Depois do supabase/schema_base.sql (usa is_project_owner e
--    is_project_member) e do supabase/chat_projeto.sql (o início e o fim da
--    chamada viram linhas do chat).
--
--    Pode rodar mais de uma vez (policies e funções apagadas e recriadas,
--    tabela com IF NOT EXISTS).
--
--  DEPOIS DE RODAR
--    A chamada já funciona: o canal dela é privado e as policies abaixo só
--    deixam entrar quem é do projeto. O reforço do SEC-075 é o passo 6 da
--    RFC: conferir se uma conta de fora, assinando um canal PÚBLICO com o
--    mesmo nome, recebe os sinais. Se receber, desligue "Allow public access"
--    (Project Settings -> Realtime) e confira que o quadro, as notas e o chat
--    continuam atualizando sozinhos; eles usam canais públicos e podem parar.
--
--  O QUE É
--    A chamada não passa pelo banco: áudio e vídeo vão direto entre as
--    pessoas (ou pelo TURN da Cloudflare quando a rede não deixa). O banco
--    só autoriza o canal do Realtime em que elas combinam a conexão, e conta
--    as credenciais TURN que a rota api/chamada/turn emite.
--
--  RISCO (SEC-075 e SEC-077)
--    - SEC-075: o canal chamada:<project_id> carrega oferta, resposta e
--      candidatos ICE, que trazem o IP de cada um. Só o dono e os membros
--      aceitos daquele projeto recebem e enviam nele.
--    - SEC-077: a tabela turn_emissoes não tem policy nem grant para anon e
--      authenticated. Só a service role (a rota em api/) conta e registra, e
--      pela função registrar_emissao_turn, que faz as duas coisas sob uma
--      trava: duas requisições juntas não passam do limite.
--    - Não tem "alter table realtime.messages enable row level security": o
--      RLS já vem ligado e o comando falha por não sermos donos da tabela,
--      abortando o resto do arquivo.
-- ============================================================================


-- 1. Quem pode usar o canal de um projeto ------------------------------------
--    O formato do tópico é conferido antes do cast: tópico malformado vira
--    false, não erro. is_project_owner e is_project_member são security
--    definer e olham para auth.uid().

create or replace function public.pode_usar_canal_chamada(p_topico text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare v_id uuid;
begin
  if p_topico is null
     or p_topico !~ '^chamada:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_id := substring(p_topico from 9)::uuid;
  return is_project_owner(v_id) or is_project_member(v_id);
end $$;

revoke all on function public.pode_usar_canal_chamada(text) from public, anon;
grant execute on function public.pode_usar_canal_chamada(text) to authenticated;


-- 2. Policies do canal (Broadcast e Presence, receber e enviar) --------------

drop policy if exists chamada_receber on realtime.messages;
create policy chamada_receber on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.pode_usar_canal_chamada(realtime.topic())
  );

drop policy if exists chamada_enviar on realtime.messages;
create policy chamada_enviar on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.pode_usar_canal_chamada(realtime.topic())
  );


-- 3. Credenciais TURN emitidas -------------------------------------------------
--    Uma linha por credencial. Guarda um dia, que é o que basta para o limite
--    de uma hora; o resto é apagado na própria contagem.

create table if not exists public.turn_emissoes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  criado_em  timestamptz not null default now()
);

create index if not exists turn_emissoes_user_idx
  on public.turn_emissoes (user_id, criado_em desc);

alter table public.turn_emissoes enable row level security;
revoke all on public.turn_emissoes from anon, authenticated;

-- Conta as emissões da última hora e registra mais uma se estiver abaixo do
-- limite. Devolve false quando o limite já foi atingido.
create or replace function public.registrar_emissao_turn(p_user uuid, p_projeto uuid, p_limite integer default 20)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  perform pg_advisory_xact_lock(hashtext('turn_emissoes:' || p_user::text));
  delete from turn_emissoes
   where user_id = p_user and criado_em < now() - interval '1 day';
  select count(*) into v_n
    from turn_emissoes
   where user_id = p_user and criado_em > now() - interval '1 hour';
  if v_n >= p_limite then
    return false;
  end if;
  insert into turn_emissoes (user_id, project_id) values (p_user, p_projeto);
  return true;
end $$;

revoke all on function public.registrar_emissao_turn(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.registrar_emissao_turn(uuid, uuid, integer) to service_role;


-- 4. Atualiza o cache de esquema ---------------------------------------------

notify pgrst, 'reload schema';


-- 5. Verificação --------------------------------------------------------------
--    Deve retornar UMA linha com tudo true:
--      canal      — as duas policies existem em realtime.messages
--      topico     — tópico malformado é recusado sem erro
--      emissoes   — turn_emissoes com RLS ligado e sem SELECT para authenticated
--      contagem   — registrar_emissao_turn fora do alcance de authenticated

select
  (select count(*) = 2 from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
      and policyname in ('chamada_receber', 'chamada_enviar'))                as canal,
  not public.pode_usar_canal_chamada('chamada:nao-e-uuid')
  and not public.pode_usar_canal_chamada('outro:00000000-0000-0000-0000-000000000000') as topico,
  (select relrowsecurity from pg_class where oid = 'public.turn_emissoes'::regclass)
  and not has_table_privilege('authenticated', 'public.turn_emissoes', 'SELECT') as emissoes,
  not has_function_privilege('authenticated',
        'public.registrar_emissao_turn(uuid, uuid, integer)', 'EXECUTE')       as contagem;
