-- ============================================================================
--  samyest.mind — canais e salas privadas, microfone por sala e moderação
--  de voz (RFC 0005)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Depois de canais_projeto.sql, chamadas.sql e configuracoes_projeto.sql.
--    Pode rodar antes ou depois de publicar o código: sem isto, todo canal é
--    aberto a todos do projeto, toda sala tem o microfone livre e a moderação
--    não aparece.
--
--  Pode rodar mais de uma vez sem problema.
--
--  O QUE É
--    - Canal ou sala PRIVADA: só veem e entram o dono, quem criou e as pessoas
--      da lista (project_channel_membros). Vale para as mensagens, o "até onde
--      li" e, na sala, o tópico próprio do Realtime
--      chamada:<projeto>:<sala> (SEC-088).
--    - Microfone ao entrar, regra de cada sala: 'livre', 'fechado' (entra mudo
--      e abre quando quiser) ou 'silencio' (só quem pode silenciar outros abre).
--      As salas que já se chamam "Silêncio" viram 'silencio' na primeira vez.
--    - Moderação de voz: silenciar, mover e desconectar outra pessoa é uma
--      linha em project_voz_moderacao, autorizada pelo cargo (SEC-087). Não
--      passa pelo Broadcast, onde quem manda escreve o próprio "de".
-- ============================================================================


-- 1. Colunas do canal --------------------------------------------------------------
--    criado_por vem do banco (auth.uid()) e fica fora dos grants. Nas linhas
--    que já existem ele fica nulo: só o dono e a lista veem, se virarem
--    privadas.

alter table public.project_channels add column if not exists privado boolean not null default false;
alter table public.project_channels add column if not exists criado_por uuid
  default auth.uid() references auth.users(id) on delete set null;

-- A regra do microfone entra uma vez só: na primeira, as salas "Silêncio" do
-- modelo de equipe viram sala de silêncio. Rodar de novo não desfaz a escolha
-- de ninguém.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'project_channels'
                    and column_name = 'regra_mic') then
    alter table public.project_channels add column regra_mic text not null default 'livre';
    update public.project_channels set regra_mic = 'silencio'
     where tipo = 'voz' and lower(btrim(nome)) in ('silêncio', 'silencio');
  end if;
end $$;

alter table public.project_channels drop constraint if exists project_channels_regra_mic_valida;
alter table public.project_channels add constraint project_channels_regra_mic_valida
  check (regra_mic in ('livre', 'fechado', 'silencio') and (regra_mic = 'livre' or tipo = 'voz'));

alter table public.project_channels drop constraint if exists project_channels_privado_valido;
alter table public.project_channels add constraint project_channels_privado_valido
  check (not privado or tipo <> 'categoria');

grant insert (privado, regra_mic) on public.project_channels to authenticated;
grant update (privado, regra_mic) on public.project_channels to authenticated;


-- 2. Quem vê o canal privado ------------------------------------------------------

create table if not exists public.project_channel_membros (
  canal_id    uuid not null,
  project_id  uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (canal_id, user_id),
  constraint project_channel_membros_canal_fk
    foreign key (canal_id, project_id)
    references public.project_channels (id, project_id)
    on delete cascade
);

create index if not exists project_channel_membros_pessoa_idx
  on public.project_channel_membros (user_id, project_id);

alter table public.project_channel_membros enable row level security;

revoke all on public.project_channel_membros from anon, authenticated;
grant select, delete on public.project_channel_membros to authenticated;
grant insert (canal_id, project_id, user_id) on public.project_channel_membros to authenticated;


-- 3. Funções de visibilidade --------------------------------------------------------
--    security definer para ler a lista e o canal sem cair no RLS deles (o que
--    daria recursão). ve_canal responde por qualquer pessoa e fica sem grant;
--    pode_ver_canal responde só por quem pergunta.

create or replace function public.ve_canal(p_canal uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_canal is null or exists (
    select 1
      from project_channels c
      join projects p on p.id = c.project_id
     where c.id = p_canal
       and p_user is not null
       and (p.owner_id = p_user
            or exists (select 1 from project_members m
                        where m.project_id = c.project_id and m.user_id = p_user
                          and m.status = 'accepted'))
       and (not c.privado
            or p.owner_id = p_user
            or c.criado_por = p_user
            or exists (select 1 from project_channel_membros l
                        where l.canal_id = c.id and l.user_id = p_user))
  );
$$;

revoke all on function public.ve_canal(uuid, uuid) from public, anon, authenticated;

create or replace function public.pode_ver_canal(p_canal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ve_canal(p_canal, auth.uid());
$$;

revoke all on function public.pode_ver_canal(uuid) from public, anon;
grant execute on function public.pode_ver_canal(uuid) to authenticated;

-- Usada na policy de project_channels, que não pode consultar a própria
-- tabela para a linha que está sendo gravada (o INSERT ... RETURNING de um
-- canal privado novo não acharia a linha).
create or replace function public.na_lista_do_canal(p_canal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from project_channel_membros
                  where canal_id = p_canal and user_id = auth.uid());
$$;

revoke all on function public.na_lista_do_canal(uuid) from public, anon;
grant execute on function public.na_lista_do_canal(uuid) to authenticated;


-- 4. Policies dos canais --------------------------------------------------------------
--    As de canais_projeto.sql, com a regra do privado. A escrita continua de
--    dono e editores (SEC-080), e só no que eles veem. No UPDATE, a linha nova
--    também precisa ficar visível: o editor não tranca a si mesmo fora.

drop policy if exists canais_select on public.project_channels;
create policy canais_select on public.project_channels
  for select to authenticated
  using (
    (is_project_owner(project_id) or is_project_member(project_id))
    and (not privado or is_project_owner(project_id)
         or criado_por = auth.uid() or na_lista_do_canal(id))
  );

drop policy if exists canais_insert on public.project_channels;
create policy canais_insert on public.project_channels
  for insert to authenticated
  with check (is_project_owner(project_id) or is_project_member(project_id, 'editor'));

drop policy if exists canais_update on public.project_channels;
create policy canais_update on public.project_channels
  for update to authenticated
  using (
    (is_project_owner(project_id) or is_project_member(project_id, 'editor'))
    and (not privado or is_project_owner(project_id)
         or criado_por = auth.uid() or na_lista_do_canal(id))
  )
  with check (
    (is_project_owner(project_id) or is_project_member(project_id, 'editor'))
    and (not privado or is_project_owner(project_id)
         or criado_por = auth.uid() or na_lista_do_canal(id))
  );

drop policy if exists canais_delete on public.project_channels;
create policy canais_delete on public.project_channels
  for delete to authenticated
  using (
    (is_project_owner(project_id) or is_project_member(project_id, 'editor'))
    and (not privado or is_project_owner(project_id)
         or criado_por = auth.uid() or na_lista_do_canal(id))
  );

-- A lista: quem vê o canal vê quem está nela; dono e editores que veem o
-- canal mexem nela.
drop policy if exists canal_membros_select on public.project_channel_membros;
create policy canal_membros_select on public.project_channel_membros
  for select to authenticated
  using ((is_project_owner(project_id) or is_project_member(project_id)) and pode_ver_canal(canal_id));

drop policy if exists canal_membros_insert on public.project_channel_membros;
create policy canal_membros_insert on public.project_channel_membros
  for insert to authenticated
  with check ((is_project_owner(project_id) or is_project_member(project_id, 'editor')) and pode_ver_canal(canal_id));

drop policy if exists canal_membros_delete on public.project_channel_membros;
create policy canal_membros_delete on public.project_channel_membros
  for delete to authenticated
  using ((is_project_owner(project_id) or is_project_member(project_id, 'editor')) and pode_ver_canal(canal_id));

-- Só gente do projeto entra na lista, e só em canal de texto ou sala.
create or replace function public.canal_membro_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from projects where id = new.project_id and owner_id = new.user_id)
     and not exists (select 1 from project_members
                      where project_id = new.project_id and user_id = new.user_id
                        and status = 'accepted') then
    raise exception 'canal_membro_fora: a pessoa não é do projeto' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from project_channels
                  where id = new.canal_id and project_id = new.project_id and tipo <> 'categoria') then
    raise exception 'canal_membro_tipo: categoria não tem lista' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.canal_membro_validar() from public, anon, authenticated;

drop trigger if exists project_channel_membros_validar on public.project_channel_membros;
create trigger project_channel_membros_validar
  before insert on public.project_channel_membros
  for each row execute function public.canal_membro_validar();


-- 5. Mensagens e "até onde li" seguem o canal ---------------------------------------
--    As policies de chat_projeto.sql e canais_projeto.sql, com pode_ver_canal.
--    A contagem de não lidas é security invoker e herda isto.

drop policy if exists msg_select on public.project_messages;
create policy msg_select on public.project_messages
  for select to authenticated
  using ((is_project_owner(project_id) or is_project_member(project_id)) and pode_ver_canal(canal_id));

drop policy if exists msg_insert on public.project_messages;
create policy msg_insert on public.project_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and apagada_em is null
    and (is_project_owner(project_id) or is_project_member(project_id))
    and pode_ver_canal(canal_id)
  );

drop policy if exists msg_apagar on public.project_messages;
create policy msg_apagar on public.project_messages
  for update to authenticated
  using (
    apagada_em is null
    and pode_ver_canal(canal_id)
    and (is_project_owner(project_id)
         or (author_id = auth.uid() and is_project_member(project_id)))
  )
  with check (body = '' and apagada_em is not null);

drop policy if exists canal_reads_proprio on public.project_channel_reads;
create policy canal_reads_proprio on public.project_channel_reads
  for all to authenticated
  using (
    user_id = auth.uid()
    and (is_project_owner(project_id) or is_project_member(project_id))
    and pode_ver_canal(canal_id)
  )
  with check (
    user_id = auth.uid()
    and (is_project_owner(project_id) or is_project_member(project_id))
    and pode_ver_canal(canal_id)
  );

-- Mensagem sem canal (a versão anterior do app) vai para o primeiro canal
-- aberto do tipo certo, nunca para um privado.
create or replace function public.mensagem_canal()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_quer text := case when new.kind = 'texto' then 'texto' else 'voz' end;
  v_tipo text;
begin
  if new.canal_id is null then
    select c.id into new.canal_id
      from project_channels c
     where c.project_id = new.project_id and c.tipo = v_quer and not c.privado
     order by c.posicao, c.created_at
     limit 1;
    if new.canal_id is null then
      raise exception 'canal_obrigatorio: o projeto não tem canal para esta mensagem'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  select c.tipo into v_tipo
    from project_channels c
   where c.id = new.canal_id and c.project_id = new.project_id;
  if v_tipo is distinct from v_quer then
    raise exception 'canal_tipo: canal errado para esta mensagem'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.mensagem_canal() from public, anon, authenticated;


-- 6. Tópico da sala privada no Realtime (SEC-075, SEC-088) ----------------------------
--    chamada:<projeto>          — o de sempre, de todo mundo do projeto.
--    chamada:<projeto>:<sala>   — só sala de voz privada do projeto, para quem
--                                 a vê. O formato é conferido antes do cast.

create or replace function public.pode_usar_canal_chamada(p_topico text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_id   uuid;
  v_sala uuid;
begin
  if p_topico is null then
    return false;
  end if;
  if p_topico ~ '^chamada:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := substring(p_topico from 9)::uuid;
    return is_project_owner(v_id) or is_project_member(v_id);
  end if;
  if p_topico ~ '^chamada:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := substring(p_topico from 9 for 36)::uuid;
    v_sala := substring(p_topico from 46)::uuid;
    return (is_project_owner(v_id) or is_project_member(v_id))
       and exists (select 1 from project_channels c
                    where c.id = v_sala and c.project_id = v_id
                      and c.tipo = 'voz' and c.privado)
       and pode_ver_canal(v_sala);
  end if;
  return false;
end $$;

revoke all on function public.pode_usar_canal_chamada(text) from public, anon;
grant execute on function public.pode_usar_canal_chamada(text) to authenticated;


-- 7. Moderação de voz (SEC-087) ----------------------------------------------------------
--    Uma linha por pessoa e projeto:
--      silenciado      — silenciada por um moderador, em todas as salas, até
--                        alguém liberar.
--      comando         — 'mover' (para comando_sala) ou 'desconectar'.
--      comando_sessao  — a sessão da chamada da pessoa quando a ordem saiu: os
--                        outros apps não conectam com ela.
--      comando_em, atualizado_por, atualizado_em — do banco, pelo gatilho.

create table if not exists public.project_voz_moderacao (
  project_id      uuid not null references public.projects(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  silenciado      boolean not null default false,
  comando         text,
  comando_sala    uuid,
  comando_sessao  text,
  comando_em      timestamptz,
  atualizado_por  uuid references auth.users(id) on delete set null,
  atualizado_em   timestamptz not null default now(),
  primary key (project_id, user_id),
  constraint project_voz_moderacao_comando check (
    (comando is null and comando_sala is null)
    or (comando = 'desconectar' and comando_sala is null)
    or (comando = 'mover' and comando_sala is not null)
  ),
  constraint project_voz_moderacao_sessao check (
    comando_sessao is null or comando_sessao ~ '^[0-9a-f]{1,64}$'
  )
);

alter table public.project_voz_moderacao enable row level security;

revoke all on public.project_voz_moderacao from anon, authenticated;
grant select on public.project_voz_moderacao to authenticated;
grant insert (project_id, user_id, silenciado, comando, comando_sala, comando_sessao)
  on public.project_voz_moderacao to authenticated;
grant update (silenciado, comando, comando_sala, comando_sessao)
  on public.project_voz_moderacao to authenticated;

-- Quem chama modera o alvo: tem alguma permissão de voz, o alvo é do
-- projeto, não é o dono e tem cargo igual ou abaixo.
create or replace function public.pode_moderar(p_project_id uuid, p_alvo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and (tem_permissao_voz(p_project_id, 'silenciar') or tem_permissao_voz(p_project_id, 'mover'))
     and coalesce(nivel_no_projeto(p_project_id, p_alvo) < 3, false)
     and coalesce(nivel_no_projeto(p_project_id, p_alvo) <= nivel_no_projeto(p_project_id, auth.uid()), false);
$$;

revoke all on function public.pode_moderar(uuid, uuid) from public, anon;
grant execute on function public.pode_moderar(uuid, uuid) to authenticated;

drop policy if exists moderacao_select on public.project_voz_moderacao;
create policy moderacao_select on public.project_voz_moderacao
  for select to authenticated
  using (is_project_owner(project_id) or is_project_member(project_id));

drop policy if exists moderacao_insert on public.project_voz_moderacao;
create policy moderacao_insert on public.project_voz_moderacao
  for insert to authenticated
  with check (pode_moderar(project_id, user_id));

drop policy if exists moderacao_update on public.project_voz_moderacao;
create policy moderacao_update on public.project_voz_moderacao
  for update to authenticated
  using (pode_moderar(project_id, user_id))
  with check (pode_moderar(project_id, user_id));
-- Sem DELETE pela API: liberar é silenciado = false.

-- Cada campo pede a permissão dele; autoria e datas vêm do banco; a sala de
-- destino é de voz, do projeto, e o alvo pode vê-la. Pelo SQL Editor (sem
-- auth.uid()) as permissões não são conferidas, para dar para corrigir à mão.
create or replace function public.moderacao_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_comando_mudou boolean;
begin
  new.atualizado_por := v_uid;
  new.atualizado_em := now();

  if (tg_op = 'INSERT' and new.silenciado)
     or (tg_op = 'UPDATE' and new.silenciado is distinct from old.silenciado) then
    if v_uid is not null and not tem_permissao_voz(new.project_id, 'silenciar') then
      raise exception 'moderar_sem_permissao: seu cargo não silencia outras pessoas' using errcode = '42501';
    end if;
  end if;

  v_comando_mudou := case when tg_op = 'INSERT' then new.comando is not null
    else new.comando is distinct from old.comando
      or new.comando_sala is distinct from old.comando_sala
      or new.comando_sessao is distinct from old.comando_sessao end;

  if v_comando_mudou then
    if v_uid is not null and not tem_permissao_voz(new.project_id, 'mover') then
      raise exception 'moderar_sem_permissao: seu cargo não move nem desconecta outras pessoas' using errcode = '42501';
    end if;
    if new.comando = 'mover' and (
         not exists (select 1 from project_channels c
                      where c.id = new.comando_sala and c.project_id = new.project_id and c.tipo = 'voz')
         or not ve_canal(new.comando_sala, new.user_id)) then
      raise exception 'moderar_sala: a sala não é deste projeto ou a pessoa não pode entrar nela' using errcode = 'check_violation';
    end if;
    new.comando_em := case when new.comando is null then null else now() end;
    if new.comando is null then
      new.comando_sessao := null;
    end if;
  elsif tg_op = 'UPDATE' then
    new.comando_em := old.comando_em;
  else
    new.comando_em := null;
  end if;
  return new;
end $$;

revoke all on function public.moderacao_validar() from public, anon, authenticated;

drop trigger if exists project_voz_moderacao_validar on public.project_voz_moderacao;
create trigger project_voz_moderacao_validar
  before insert or update on public.project_voz_moderacao
  for each row execute function public.moderacao_validar();

-- O app chama esta função: insert com "on conflict" só nas colunas da ação.
-- security invoker: o RLS, os grants e o gatilho acima valem do mesmo jeito.
create or replace function public.moderar_voz(
  p_projeto uuid, p_alvo uuid, p_acao text, p_sala uuid default null, p_sessao text default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_acao in ('silenciar', 'liberar') then
    insert into project_voz_moderacao (project_id, user_id, silenciado)
    values (p_projeto, p_alvo, p_acao = 'silenciar')
    on conflict (project_id, user_id) do update set silenciado = excluded.silenciado;
  elsif p_acao in ('mover', 'desconectar') then
    insert into project_voz_moderacao (project_id, user_id, comando, comando_sala, comando_sessao)
    values (p_projeto, p_alvo, p_acao, case when p_acao = 'mover' then p_sala end, p_sessao)
    on conflict (project_id, user_id) do update
      set comando = excluded.comando,
          comando_sala = excluded.comando_sala,
          comando_sessao = excluded.comando_sessao;
  else
    raise exception 'moderar_acao: ação desconhecida' using errcode = '22023';
  end if;
end $$;

revoke all on function public.moderar_voz(uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.moderar_voz(uuid, uuid, text, uuid, text) to authenticated;


-- 8. Quem sai do projeto sai das listas e da moderação ----------------------------------

create or replace function public.membro_saiu_limpar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.user_id is not null then
    delete from project_channel_membros where project_id = old.project_id and user_id = old.user_id;
    delete from project_voz_moderacao where project_id = old.project_id and user_id = old.user_id;
  end if;
  return old;
end $$;

revoke all on function public.membro_saiu_limpar() from public, anon, authenticated;

drop trigger if exists project_members_saiu_limpar on public.project_members;
create trigger project_members_saiu_limpar
  after delete on public.project_members
  for each row execute function public.membro_saiu_limpar();


-- 9. Realtime ----------------------------------------------------------------------------
--    A moderação chega a quem está com o projeto aberto pelo Postgres Changes,
--    que confere o RLS de SELECT para cada um.

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = 'project_voz_moderacao') then
    alter publication supabase_realtime add table public.project_voz_moderacao;
  end if;
end $$;


-- 10. Atualiza o cache de esquema ----------------------------------------------------------

notify pgrst, 'reload schema';


-- 11. Verificação --------------------------------------------------------------------------
--    Deve retornar UMA linha com tudo true:
--      colunas    — privado, criado_por e regra_mic existem; criado_por fora dos grants
--      privado    — as policies de canais, mensagens, leituras e lista passam por
--                   pode_ver_canal ou na_lista_do_canal
--      definer    — as funções de visibilidade e da moderação têm search_path, e
--                   ve_canal não está liberada para authenticated
--      moderacao  — a tabela tem RLS, sem DELETE pela API, e o gatilho existe
--      topico     — a função do tópico aceita a sala privada
--      realtime   — project_voz_moderacao está na publicação

select
  (select count(*) = 3 from information_schema.columns
    where table_schema = 'public' and table_name = 'project_channels'
      and column_name in ('privado', 'criado_por', 'regra_mic'))
  and not has_column_privilege('authenticated', 'public.project_channels', 'criado_por', 'INSERT')
  and not has_column_privilege('authenticated', 'public.project_channels', 'criado_por', 'UPDATE') as colunas,
  (select count(*) = 4 from pg_policies
    where schemaname = 'public' and tablename = 'project_channels'
      and coalesce(qual, '') || coalesce(with_check, '') like '%is_project_%'
      and (cmd = 'INSERT' or qual like '%na_lista_do_canal%'))
  and (select bool_and(coalesce(qual, '') || coalesce(with_check, '') like '%pode_ver_canal%')
         from pg_policies
        where schemaname = 'public'
          and ((tablename = 'project_messages' and policyname in ('msg_select', 'msg_insert', 'msg_apagar'))
            or tablename in ('project_channel_reads', 'project_channel_membros')))     as privado,
  (select bool_and(proconfig is not null) from pg_proc
    where proname in ('ve_canal', 'pode_ver_canal', 'na_lista_do_canal', 'pode_moderar',
                      'moderacao_validar', 'canal_membro_validar', 'membro_saiu_limpar',
                      'moderar_voz', 'pode_usar_canal_chamada')
      and pronamespace = 'public'::regnamespace)
  and not has_function_privilege('authenticated', 'public.ve_canal(uuid, uuid)', 'EXECUTE') as definer,
  (select relrowsecurity from pg_class where oid = 'public.project_voz_moderacao'::regclass)
  and not has_table_privilege('authenticated', 'public.project_voz_moderacao', 'DELETE')
  and exists (select 1 from pg_trigger
               where not tgisinternal and tgname = 'project_voz_moderacao_validar')      as moderacao,
  (select prosrc like '%for 36%' from pg_proc
    where oid = 'public.pode_usar_canal_chamada(text)'::regprocedure)                  as topico,
  exists (select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public' and tablename = 'project_voz_moderacao')        as realtime;
