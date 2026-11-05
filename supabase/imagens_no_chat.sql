-- ============================================================================
--  samyest.mind — imagem no chat (RFC 0006, SEC-090)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Depois de chat_projeto.sql, canais_projeto.sql e salas_projeto.sql. Pode
--    rodar antes ou depois de publicar o código: sem isto, o botão de imagem
--    avisa que falta rodar este arquivo.
--
--  Pode rodar mais de uma vez sem problema.
--
--  O QUE É
--    Uma mensagem de texto pode levar uma imagem. O arquivo vai para o bucket
--    PRIVADO "chat", no caminho
--      <id do projeto>/<id do canal>/<id de quem enviou>_<número>.<png|jpg|webp|gif>
--    e a mensagem guarda só esse caminho (project_messages.imagem). O app
--    mostra a imagem por um link assinado, de 1 hora.
--
--  QUEM VÊ
--    Quem vê o canal (pode_ver_canal: acesso ao projeto, e a lista no canal
--    privado e na conversa direta). O caminho leva o canal, então a imagem de
--    um canal privado não abre para quem está fora dele, mesmo sabendo o nome.
--    Só quem enviou grava no próprio nome de arquivo e apaga o que enviou.
-- ============================================================================


-- 1. A mensagem guarda o caminho ----------------------------------------------------

alter table public.project_messages add column if not exists imagem text;

alter table public.project_messages drop constraint if exists project_messages_imagem_valida;
alter table public.project_messages add constraint project_messages_imagem_valida check (
  imagem is null or imagem ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9a-f]{8,32}\.(png|jpg|webp|gif)$'
);

-- Mensagem de texto pode ir só com a imagem, sem texto.
alter table public.project_messages drop constraint if exists project_messages_texto_nao_vazio;
alter table public.project_messages add constraint project_messages_texto_nao_vazio check (
  kind <> 'texto' or apagada_em is not null or char_length(btrim(body)) > 0 or imagem is not null
);

-- A imagem é do mesmo projeto e canal da mensagem, de quem envia, e só em
-- texto. Roda depois do gatilho que escolhe o canal (a ordem é pelo nome).
create or replace function public.mensagem_imagem()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.imagem is null then
    return new;
  end if;
  if new.kind <> 'texto'
     or split_part(new.imagem, '/', 1) <> new.project_id::text
     or split_part(new.imagem, '/', 2) <> coalesce(new.canal_id::text, '')
     or (auth.uid() is not null and split_part(split_part(new.imagem, '/', 3), '_', 1) <> auth.uid()::text) then
    raise exception 'imagem_caminho: a imagem não é deste canal ou não é sua' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.mensagem_imagem() from public, anon, authenticated;

drop trigger if exists project_messages_imagem on public.project_messages;
create trigger project_messages_imagem
  before insert on public.project_messages
  for each row execute function public.mensagem_imagem();

-- Envia com a imagem; apagar a mensagem zera a imagem junto com o texto.
grant insert (imagem) on public.project_messages to authenticated;
grant update (imagem) on public.project_messages to authenticated;

drop policy if exists msg_apagar on public.project_messages;
create policy msg_apagar on public.project_messages
  for update to authenticated
  using (
    apagada_em is null
    and pode_ver_canal(canal_id)
    and (is_project_owner(project_id)
         or (author_id = auth.uid() and is_project_member(project_id)))
  )
  with check (body = '' and apagada_em is not null and imagem is null);


-- 2. O bucket privado ---------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat', 'chat', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- O caminho tem um formato só, conferido antes de qualquer cast. Ler e enviar
-- pedem ver o canal (que é de texto ou conversa direta, do mesmo projeto);
-- enviar pede também que o arquivo leve o id de quem envia.
create or replace function public.pode_usar_imagem_chat(p_nome text, p_enviar boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_proj  uuid;
  v_canal uuid;
begin
  if p_nome is null or p_nome !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9a-f]{8,32}\.(png|jpg|webp|gif)$' then
    return false;
  end if;
  v_proj := split_part(p_nome, '/', 1)::uuid;
  v_canal := split_part(p_nome, '/', 2)::uuid;
  if p_enviar and split_part(split_part(p_nome, '/', 3), '_', 1) <> coalesce(auth.uid()::text, '') then
    return false;
  end if;
  return exists (select 1 from project_channels c
                  where c.id = v_canal and c.project_id = v_proj and c.tipo in ('texto', 'direta'))
     and ve_canal(v_canal, auth.uid());
end $$;

revoke all on function public.pode_usar_imagem_chat(text, boolean) from public, anon;
grant execute on function public.pode_usar_imagem_chat(text, boolean) to authenticated;

drop policy if exists chat_imagem_ler on storage.objects;
create policy chat_imagem_ler on storage.objects
  for select to authenticated
  using (bucket_id = 'chat' and public.pode_usar_imagem_chat(name, false));

drop policy if exists chat_imagem_enviar on storage.objects;
create policy chat_imagem_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat' and public.pode_usar_imagem_chat(name, true));

-- Apagar: só quem enviou (o id está no nome do arquivo).
drop policy if exists chat_imagem_apagar on storage.objects;
create policy chat_imagem_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat' and public.pode_usar_imagem_chat(name, true));


-- 3. Atualiza o cache de esquema --------------------------------------------------------

notify pgrst, 'reload schema';


-- 4. Verificação ------------------------------------------------------------------------
--    Deve retornar UMA linha com tudo true:
--      coluna   — imagem existe, com check, e entra só no insert e no update
--      apagar   — apagar a mensagem exige a imagem zerada
--      bucket   — o bucket chat existe e é privado
--      storage  — as três policies do bucket existem
--      gatilho  — o gatilho do caminho existe

select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'project_messages' and column_name = 'imagem')
  and exists (select 1 from pg_constraint where conname = 'project_messages_imagem_valida')
  and has_column_privilege('authenticated', 'public.project_messages', 'imagem', 'INSERT')  as coluna,
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'project_messages'
             and policyname = 'msg_apagar' and with_check like '%imagem IS NULL%')         as apagar,
  exists (select 1 from storage.buckets where id = 'chat' and not public)                  as bucket,
  (select count(*) = 3 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('chat_imagem_ler', 'chat_imagem_enviar', 'chat_imagem_apagar'))   as storage,
  exists (select 1 from pg_trigger
           where not tgisinternal and tgname = 'project_messages_imagem')                  as gatilho;
