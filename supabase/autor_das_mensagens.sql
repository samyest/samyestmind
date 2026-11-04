-- Nome de quem escreveu, guardado na mensagem do chat do projeto.
--
-- Quem sai do projeto deixa de aparecer no RLS de profiles
-- (profiles_select_own_or_team, em rls_correcoes.sql), e o chat mostrava as
-- mensagens dela como "Ex-membro". Agora cada mensagem guarda o nome do autor
-- de quando foi enviada. O app usa o nome atual de quem ainda está no
-- projeto e este, guardado, para quem saiu.
--
-- Quem preenche é o banco, nunca o navegador (SEC-071): a coluna fica fora
-- dos grants de insert e de update de project_messages, e o gatilho
-- sobrescreve o que vier. Assim ninguém assina mensagem em nome de outra
-- pessoa. O gatilho é security invoker: lê o perfil do próprio autor, que o
-- RLS de profiles já deixa ler (id = auth.uid()).
--
-- Rode no SQL Editor do Supabase, depois do chat_projeto.sql. Pode rodar mais
-- de uma vez. O fim do arquivo preenche as mensagens que já existem e
-- confere tudo.

-- 1. Coluna -------------------------------------------------------------------

alter table public.project_messages add column if not exists autor_nome text;

alter table public.project_messages drop constraint if exists project_messages_autor_nome_tamanho;
alter table public.project_messages add constraint project_messages_autor_nome_tamanho
  check (autor_nome is null or char_length(autor_nome) <= 80);

-- Nenhum grant novo: o grant insert (project_id, kind, body, duracao_seg,
-- canal_id) e o grant update (body, apagada_em) continuam como estão, e a
-- coluna nova fica fora dos dois.


-- 2. Gatilho --------------------------------------------------------------------

create or replace function public.mensagem_autor_nome()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.autor_nome := (
    select left(nullif(btrim(p.name), ''), 80)
      from public.profiles p
     where p.id = new.author_id
  );
  return new;
end $$;

revoke all on function public.mensagem_autor_nome() from public, anon, authenticated;

drop trigger if exists project_messages_autor_nome on public.project_messages;
create trigger project_messages_autor_nome
  before insert on public.project_messages
  for each row execute function public.mensagem_autor_nome();


-- 3. Mensagens que já existem ------------------------------------------------------
--
-- O SQL Editor roda sem RLS: dá para ler o nome inclusive de quem já saiu,
-- o que traz de volta o nome das mensagens que hoje aparecem como
-- "Ex-membro".

update public.project_messages m
   set autor_nome = left(nullif(btrim(p.name), ''), 80)
  from public.profiles p
 where p.id = m.author_id
   and m.autor_nome is null
   and nullif(btrim(p.name), '') is not null;

notify pgrst, 'reload schema';


-- 4. Verificação --------------------------------------------------------------------
--    Deve retornar UMA linha com tudo true:
--      grants    — authenticated não grava autor_nome, nem no insert nem no update
--      gatilho   — o gatilho existe
--      invoker   — a função do gatilho não é security definer
--      preenchido — nenhuma mensagem de autor com nome ficou sem o nome

select
  not has_column_privilege('authenticated', 'public.project_messages', 'autor_nome', 'INSERT')
  and not has_column_privilege('authenticated', 'public.project_messages', 'autor_nome', 'UPDATE') as grants,
  exists (select 1 from pg_trigger
           where not tgisinternal and tgname = 'project_messages_autor_nome') as gatilho,
  not (select prosecdef from pg_proc
        where oid = 'public.mensagem_autor_nome()'::regprocedure)          as invoker,
  not exists (select 1 from public.project_messages m
                join public.profiles p on p.id = m.author_id
               where m.autor_nome is null
                 and nullif(btrim(p.name), '') is not null)                   as preenchido;
