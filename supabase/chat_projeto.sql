-- ============================================================================
--  samyest.mind — chat dos projetos (RFC 0002, fase 1)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Depois do supabase/schema_base.sql (usa is_project_owner e
--    is_project_member). Rode ANTES de publicar o código do chat: sem isto a
--    aba Chat mostra "O chat ainda não foi ativado" e o resto do app segue
--    igual.
--
--    Pode rodar mais de uma vez (IF NOT EXISTS, policies e gatilho apagados e
--    recriados). Não apaga nenhuma mensagem.
--
--  O QUE É
--    Todo projeto ganha um chat de texto, inclusive os que já existem. O
--    histórico fica enquanto o projeto existir e some junto com ele. Cada
--    pessoa guarda até onde leu e se silenciou o chat daquele projeto.
--
--  QUEM PODE
--    O dono e todo membro aceito, inclusive o visualizador, leem e escrevem.
--    O autor apaga a própria mensagem e o dono apaga qualquer uma; apagar
--    zera o texto e deixa "mensagem apagada". Ninguém edita.
--
--  RISCO (SEC-070 a SEC-074)
--    - SEC-070: nenhuma policy aceita "author_id = auth.uid()" sozinho. É o
--      furo do SEC-045 nas tarefas: quem saía do projeto continuava lendo o
--      que tinha criado. Aqui, quem sai perde a conversa inteira na hora,
--      inclusive pelo realtime, e não apaga mais nem as próprias mensagens.
--    - SEC-071: autor e data quem põe é o banco. author_id e created_at ficam
--      fora do grant de INSERT; o UPDATE só alcança body e apagada_em, e o
--      with check só aceita apagar. Não existe DELETE pela API.
--    - SEC-073: 4.000 caracteres por mensagem e 20 mensagens por minuto por
--      pessoa, as duas regras aqui, porque a chave pública permite chamar a
--      API sem passar pela tela.
--    - SEC-074: "até onde li" e "silenciado" só da própria pessoa, e a
--      contagem de não lidas roda com o RLS de quem pergunta.
-- ============================================================================


-- 1. Mensagens -----------------------------------------------------------------
--    kind 'chamada_inicio'/'chamada_fim' e duracao_seg ficam prontos para a
--    fase 2 (chamadas); nesta fase o app só grava 'texto'.

create table if not exists public.project_messages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  author_id   uuid default auth.uid() references auth.users(id) on delete set null,
  kind        text not null default 'texto'
              check (kind in ('texto', 'chamada_inicio', 'chamada_fim')),
  body        text not null default '' check (char_length(body) <= 4000),
  duracao_seg integer check (duracao_seg >= 0),
  created_at  timestamptz not null default now(),
  apagada_em  timestamptz,
  constraint project_messages_texto_nao_vazio
    check (kind <> 'texto' or apagada_em is not null or char_length(btrim(body)) > 0)
);

create index if not exists project_messages_projeto_idx
  on public.project_messages (project_id, created_at desc);
create index if not exists project_messages_autor_idx
  on public.project_messages (author_id, created_at desc);

alter table public.project_messages enable row level security;

-- O Supabase dá todos os privilégios de tabela nova a anon e authenticated.
-- Aqui fica só o necessário, coluna por coluna.
revoke all on public.project_messages from anon, authenticated;
grant select on public.project_messages to authenticated;
grant insert (project_id, kind, body, duracao_seg) on public.project_messages to authenticated;
grant update (body, apagada_em) on public.project_messages to authenticated;


-- 2. Permissões das mensagens ----------------------------------------------------

drop policy if exists msg_select on public.project_messages;
create policy msg_select on public.project_messages
  for select to authenticated
  using (is_project_owner(project_id) or is_project_member(project_id));

drop policy if exists msg_insert on public.project_messages;
create policy msg_insert on public.project_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and apagada_em is null
    and (is_project_owner(project_id) or is_project_member(project_id))
  );

-- UPDATE só serve para apagar: o texto vira '' e não volta. O autor só apaga
-- enquanto ainda é membro aceito; o dono apaga qualquer uma.
drop policy if exists msg_apagar on public.project_messages;
create policy msg_apagar on public.project_messages
  for update to authenticated
  using (
    apagada_em is null
    and (is_project_owner(project_id)
         or (author_id = auth.uid() and is_project_member(project_id)))
  )
  with check (body = '' and apagada_em is not null);

-- Sem policy de DELETE: a mensagem só some com o projeto.


-- 3. Limite de 20 mensagens por minuto por pessoa --------------------------------
--    security definer para contar também mensagens em projetos que a pessoa
--    já não vê; só conta, não devolve nada. O texto "chat_limite" é o que o
--    app reconhece para mostrar o aviso próprio.

create or replace function public.chat_limite_mensagens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from project_messages
       where author_id = auth.uid()
         and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'chat_limite: muitas mensagens seguidas'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.chat_limite_mensagens() from public, anon, authenticated;

drop trigger if exists project_messages_limite on public.project_messages;
create trigger project_messages_limite
  before insert on public.project_messages
  for each row execute function public.chat_limite_mensagens();


-- 4. Até onde li e silenciado -----------------------------------------------------
--    Quem nunca abriu o chat de um projeto não tem linha, e então todo o
--    histórico conta como não lido.

create table if not exists public.project_chat_reads (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lido_ate    timestamptz not null default '-infinity',
  silenciado  boolean not null default false,
  primary key (project_id, user_id)
);

alter table public.project_chat_reads enable row level security;

revoke all on public.project_chat_reads from anon, authenticated;
grant select, insert, update, delete on public.project_chat_reads to authenticated;

drop policy if exists chat_reads_proprio on public.project_chat_reads;
create policy chat_reads_proprio on public.project_chat_reads
  for all to authenticated
  using (
    user_id = auth.uid()
    and (is_project_owner(project_id) or is_project_member(project_id))
  )
  with check (
    user_id = auth.uid()
    and (is_project_owner(project_id) or is_project_member(project_id))
  );


-- 5. Contagem de não lidas ----------------------------------------------------------
--    security invoker: o RLS de project_messages e de project_chat_reads vale,
--    então só entram projetos de que a pessoa é dona ou membro aceito.

create or replace function public.contar_nao_lidas()
returns table (project_id uuid, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select m.project_id, count(*)
  from project_messages m
  left join project_chat_reads r
    on r.project_id = m.project_id and r.user_id = auth.uid()
  where m.kind = 'texto'
    and m.apagada_em is null
    and m.author_id is distinct from auth.uid()
    and m.created_at > coalesce(r.lido_ate, '-infinity')
  group by m.project_id;
$$;

revoke all on function public.contar_nao_lidas() from public, anon;
grant execute on function public.contar_nao_lidas() to authenticated;


-- 6. Realtime --------------------------------------------------------------------
--    Postgres Changes reconfere o msg_select a cada mensagem e para cada
--    assinante: quem sai do projeto para de receber na hora. Apagar é UPDATE
--    e chega pelo mesmo canal.

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = 'project_messages') then
    alter publication supabase_realtime add table public.project_messages;
  end if;
end $$;


-- 7. Atualiza o cache de esquema -------------------------------------------------

notify pgrst, 'reload schema';


-- 8. Verificação -----------------------------------------------------------------
--    Deve retornar UMA linha com tudo true:
--      policies   — msg_select, msg_insert, msg_apagar e chat_reads_proprio,
--                   todas passando pelo acesso ao projeto, e nenhuma de DELETE
--      autoria    — authenticated sem INSERT em author_id/created_at e sem
--                   UPDATE em project_id/author_id
--      gatilho    — o limite de 20 por minuto existe
--      invoker    — contar_nao_lidas não é security definer
--      realtime   — project_messages está na publicação

select
  (select count(*) = 4
     and bool_and(coalesce(qual, '') || coalesce(with_check, '') like '%is_project_member%')
     from pg_policies
    where schemaname = 'public'
      and tablename in ('project_messages', 'project_chat_reads'))
  and not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = 'project_messages'
                     and cmd = 'DELETE')                                    as policies,
  not has_column_privilege('authenticated', 'public.project_messages', 'author_id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.project_messages', 'created_at', 'INSERT')
  and not has_column_privilege('authenticated', 'public.project_messages', 'author_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.project_messages', 'project_id', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.project_messages', 'DELETE') as autoria,
  exists (select 1 from pg_trigger
           where tgname = 'project_messages_limite' and not tgisinternal)   as gatilho,
  not (select prosecdef from pg_proc
        where oid = 'public.contar_nao_lidas()'::regprocedure)              as invoker,
  exists (select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public' and tablename = 'project_messages')  as realtime;
