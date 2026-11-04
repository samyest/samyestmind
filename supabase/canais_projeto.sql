-- ============================================================================
--  samyest.mind — canais dos projetos (RFC 0004)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Depois do supabase/schema_base.sql (usa is_project_owner e
--    is_project_member) e do supabase/chat_projeto.sql (mexe em
--    project_messages e copia o project_chat_reads).
--
--    Pode rodar antes ou depois de publicar o código dos canais: sem isto a
--    aba Canais mostra um #geral e uma sala Geral, que são o chat e a chamada
--    de antes. Pode rodar mais de uma vez (IF NOT EXISTS, policies, funções e
--    gatilhos apagados e recriados; as cópias só pegam o que falta).
--
--    A cópia do histórico para o #geral atualiza cada mensagem, e cada
--    atualização chega pelo realtime a quem está com o app aberto. Num projeto
--    com milhares de mensagens, rode fora do horário de uso.
--
--  O QUE É
--    Cada projeto ganha categorias, canais de texto e salas de voz, como um
--    servidor do Discord. Projeto novo nasce com #geral e a sala Geral; os que
--    já existem ganham os dois aqui, e o chat de antes vira o #geral, com o
--    histórico e o "até onde li" de cada pessoa.
--
--  QUEM PODE
--    Todo mundo do projeto vê todos os canais, escreve nos de texto e entra
--    nas salas. Criar, renomear, mover e apagar é do dono e dos editores.
--
--  RISCO (SEC-080 a SEC-082)
--    - SEC-080: nenhuma policy de project_channels deixa de passar pelo acesso
--      ao projeto, e a escrita exige dono ou editor. project_id e tipo ficam
--      fora do grant de UPDATE: um canal não muda de projeto nem de tipo.
--    - SEC-081: a mensagem aponta para o canal pela chave composta
--      (canal_id, project_id), então nunca para canal de outro projeto, nem
--      chamando a API direto. Texto só em canal de texto; linha de chamada só
--      em sala de voz. canal_id fica fora do grant de UPDATE.
--    - SEC-082: "até onde li" por canal, só da própria pessoa, e a contagem de
--      não lidas roda com o RLS de quem pergunta.
--    - Apagar um canal apaga as mensagens dele (on delete cascade). É o pedido
--      (RFC 0004, Q7); a tela confirma antes.
-- ============================================================================


-- 1. Canais e categorias -----------------------------------------------------
--    Uma tabela só: categoria é um canal de tipo 'categoria', com um nível.
--    unique (id, project_id) existe para as chaves compostas das outras
--    tabelas apontarem para "este canal, deste projeto".

create table if not exists public.project_channels (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  tipo         text not null check (tipo in ('categoria', 'texto', 'voz')),
  nome         text not null check (char_length(nome) between 1 and 60 and btrim(nome) <> ''),
  categoria_id uuid references public.project_channels(id) on delete set null,
  posicao      integer not null default 0,
  created_at   timestamptz not null default now(),
  constraint project_channels_id_projeto unique (id, project_id),
  constraint project_channels_categoria_sem_pai check (tipo <> 'categoria' or categoria_id is null)
);

create index if not exists project_channels_projeto_idx
  on public.project_channels (project_id, posicao);

alter table public.project_channels enable row level security;

-- O Supabase dá todos os privilégios de tabela nova a anon e authenticated.
-- Aqui fica só o necessário, coluna por coluna.
revoke all on public.project_channels from anon, authenticated;
grant select on public.project_channels to authenticated;
grant insert (project_id, tipo, nome, categoria_id, posicao) on public.project_channels to authenticated;
grant update (nome, categoria_id, posicao) on public.project_channels to authenticated;
grant delete on public.project_channels to authenticated;


-- 2. Permissões dos canais ---------------------------------------------------

drop policy if exists canais_select on public.project_channels;
create policy canais_select on public.project_channels
  for select to authenticated
  using (is_project_owner(project_id) or is_project_member(project_id));

drop policy if exists canais_insert on public.project_channels;
create policy canais_insert on public.project_channels
  for insert to authenticated
  with check (is_project_owner(project_id) or is_project_member(project_id, 'editor'));

drop policy if exists canais_update on public.project_channels;
create policy canais_update on public.project_channels
  for update to authenticated
  using (is_project_owner(project_id) or is_project_member(project_id, 'editor'))
  with check (is_project_owner(project_id) or is_project_member(project_id, 'editor'));

drop policy if exists canais_delete on public.project_channels;
create policy canais_delete on public.project_channels
  for delete to authenticated
  using (is_project_owner(project_id) or is_project_member(project_id, 'editor'));


-- 3. Regras que o check não alcança -----------------------------------------
--    security invoker: só enxerga o que quem grava enxerga. Uma categoria de
--    outro projeto não aparece e é recusada como "não é deste projeto".
--    O "canal_limite" e o "canal_categoria" são o que o app reconhece para
--    mostrar o aviso próprio.

create or replace function public.canal_validar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.nome := btrim(new.nome);
  if new.categoria_id is not null then
    if new.categoria_id = new.id or not exists (
      select 1 from project_channels c
       where c.id = new.categoria_id
         and c.project_id = new.project_id
         and c.tipo = 'categoria'
    ) then
      raise exception 'canal_categoria: a categoria não é deste projeto'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'INSERT' and (select count(*) from project_channels
                            where project_id = new.project_id) >= 100 then
    raise exception 'canal_limite: o projeto já tem 100 canais e categorias'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.canal_validar() from public, anon, authenticated;

drop trigger if exists project_channels_validar on public.project_channels;
create trigger project_channels_validar
  before insert or update on public.project_channels
  for each row execute function public.canal_validar();


-- 4. Todo projeto nasce com #geral e a sala Geral ------------------------------
--    security definer para não depender do grant de quem cria o projeto; só
--    insere nas linhas do projeto que acabou de nascer.

create or replace function public.canais_padrao_do_projeto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into project_channels (project_id, tipo, nome, posicao)
  values (new.id, 'texto', 'geral', 0),
         (new.id, 'voz', 'Geral', 1);
  return new;
end $$;

revoke all on function public.canais_padrao_do_projeto() from public, anon, authenticated;

drop trigger if exists projects_canais_padrao on public.projects;
create trigger projects_canais_padrao
  after insert on public.projects
  for each row execute function public.canais_padrao_do_projeto();

-- Os projetos que já existem e ainda não têm canal nenhum.
with sem_canal as (
  select p.id from public.projects p
   where not exists (select 1 from public.project_channels c where c.project_id = p.id)
)
insert into public.project_channels (project_id, tipo, nome, posicao)
select s.id, v.tipo, v.nome, v.posicao
  from sem_canal s
 cross join (values ('texto', 'geral', 0), ('voz', 'Geral', 1)) as v(tipo, nome, posicao);


-- 5. Mensagem pertence a um canal --------------------------------------------
--    Chave composta: canal e mensagem são do mesmo projeto (SEC-081). Apagar
--    o canal apaga as mensagens dele.

alter table public.project_messages add column if not exists canal_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_messages_canal_fk') then
    alter table public.project_messages
      add constraint project_messages_canal_fk
      foreign key (canal_id, project_id)
      references public.project_channels (id, project_id)
      on delete cascade;
  end if;
end $$;

create index if not exists project_messages_canal_idx
  on public.project_messages (canal_id, created_at desc);

-- Soma canal_id ao grant de INSERT que o chat_projeto.sql deu. O de UPDATE
-- continua só body e apagada_em.
grant insert (canal_id) on public.project_messages to authenticated;

-- Texto vai para canal de texto e linha de chamada para sala de voz. Sem
-- canal_id, que é o que a versão anterior do app manda, vai para o primeiro
-- canal do tipo certo: quem não recarregou a página continua no #geral.
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
     where c.project_id = new.project_id and c.tipo = v_quer
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

drop trigger if exists project_messages_canal on public.project_messages;
create trigger project_messages_canal
  before insert on public.project_messages
  for each row execute function public.mensagem_canal();

-- O histórico: texto para o primeiro canal de texto, linhas de chamada para a
-- primeira sala de voz.
update public.project_messages m
   set canal_id = (
     select c.id from public.project_channels c
      where c.project_id = m.project_id
        and c.tipo = case when m.kind = 'texto' then 'texto' else 'voz' end
      order by c.posicao, c.created_at
      limit 1)
 where m.canal_id is null;


-- 6. Até onde li, por canal ----------------------------------------------------
--    O silenciado continua por projeto, em project_chat_reads.

create table if not exists public.project_channel_reads (
  canal_id    uuid not null,
  project_id  uuid not null,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lido_ate    timestamptz not null default '-infinity',
  primary key (canal_id, user_id),
  constraint project_channel_reads_canal_fk
    foreign key (canal_id, project_id)
    references public.project_channels (id, project_id)
    on delete cascade
);

alter table public.project_channel_reads enable row level security;

revoke all on public.project_channel_reads from anon, authenticated;
grant select, insert, update, delete on public.project_channel_reads to authenticated;

drop policy if exists canal_reads_proprio on public.project_channel_reads;
create policy canal_reads_proprio on public.project_channel_reads
  for all to authenticated
  using (
    user_id = auth.uid()
    and (is_project_owner(project_id) or is_project_member(project_id))
  )
  with check (
    user_id = auth.uid()
    and (is_project_owner(project_id) or is_project_member(project_id))
  );

-- O "até onde li" do chat de antes vale para o #geral: ninguém vê o histórico
-- inteiro como não lido depois da troca.
insert into public.project_channel_reads (canal_id, project_id, user_id, lido_ate)
select c.id, r.project_id, r.user_id, r.lido_ate
  from public.project_chat_reads r
  join lateral (
    select c.id from public.project_channels c
     where c.project_id = r.project_id and c.tipo = 'texto'
     order by c.posicao, c.created_at
     limit 1
  ) c on true
on conflict (canal_id, user_id) do nothing;


-- 7. Contagem de não lidas por canal ---------------------------------------------
--    security invoker, como a contar_nao_lidas() (que fica para a aba que
--    ainda não recarregou).

create or replace function public.contar_nao_lidas_canais()
returns table (project_id uuid, canal_id uuid, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select m.project_id, m.canal_id, count(*)
  from project_messages m
  left join project_channel_reads r
    on r.canal_id = m.canal_id and r.user_id = auth.uid()
  where m.kind = 'texto'
    and m.apagada_em is null
    and m.canal_id is not null
    and m.author_id is distinct from auth.uid()
    and m.created_at > coalesce(r.lido_ate, '-infinity')
  group by m.project_id, m.canal_id;
$$;

revoke all on function public.contar_nao_lidas_canais() from public, anon;
grant execute on function public.contar_nao_lidas_canais() to authenticated;


-- 8. Realtime -----------------------------------------------------------------
--    Criar, renomear e apagar canal chega a quem está com o projeto aberto.
--    O DELETE do Postgres Changes não passa pelo RLS e leva só a chave
--    primária: quem escuta fica sabendo o id de um canal apagado, nada mais.

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = 'project_channels') then
    alter publication supabase_realtime add table public.project_channels;
  end if;
end $$;


-- 9. Atualiza o cache de esquema -------------------------------------------------

notify pgrst, 'reload schema';


-- 10. Verificação ---------------------------------------------------------------
--    Deve retornar UMA linha com tudo true:
--      policies  — as quatro de project_channels e a de project_channel_reads
--                  passam pelo acesso ao projeto, e a escrita pede editor
--      grants    — project_id e tipo sem UPDATE; canal_id de mensagem sem UPDATE
--      gatilhos  — validação do canal, canais padrão e canal da mensagem
--      historico — nenhuma mensagem sem canal (em projeto que tem canal)
--      invoker   — contar_nao_lidas_canais não é security definer
--      realtime  — project_channels está na publicação

select
  (select count(*) = 5
     and bool_and(coalesce(qual, '') || coalesce(with_check, '') like '%is_project_%')
     from pg_policies
    where schemaname = 'public'
      and tablename in ('project_channels', 'project_channel_reads'))
  and (select bool_and(coalesce(qual, '') || coalesce(with_check, '') like '%editor%')
         from pg_policies
        where schemaname = 'public' and tablename = 'project_channels'
          and cmd in ('INSERT', 'UPDATE', 'DELETE'))                        as policies,
  not has_column_privilege('authenticated', 'public.project_channels', 'project_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.project_channels', 'tipo', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.project_messages', 'canal_id', 'UPDATE')
  and has_column_privilege('authenticated', 'public.project_messages', 'canal_id', 'INSERT') as grants,
  (select count(*) = 3 from pg_trigger
    where not tgisinternal
      and tgname in ('project_channels_validar', 'projects_canais_padrao', 'project_messages_canal')) as gatilhos,
  not exists (select 1 from public.project_messages m
               where m.canal_id is null
                 and exists (select 1 from public.project_channels c
                              where c.project_id = m.project_id
                                and c.tipo = case when m.kind = 'texto' then 'texto' else 'voz' end)) as historico,
  not (select prosecdef from pg_proc
        where oid = 'public.contar_nao_lidas_canais()'::regprocedure)       as invoker,
  exists (select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public' and tablename = 'project_channels')  as realtime;
