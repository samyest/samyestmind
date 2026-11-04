-- ============================================================================
--  samyest.mind — ícone do projeto
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Pode rodar antes ou depois de publicar o código. Sem isto o app mostra a
--    inicial do projeto no lugar do ícone e avisa, ao salvar, que falta rodar
--    este arquivo.
--
--  Pode rodar mais de uma vez sem problema (IF NOT EXISTS, constraints e
--  gatilho apagados e recriados).
--
--  O QUE É
--    Cada projeto ganha um ícone quadrado na barra lateral, no topo do projeto
--    e na lista de projetos, no lugar da bolinha. O ícone é um destes:
--      - a inicial do nome (icone nulo), o padrão;
--      - um dos ícones prontos do app (icone = uma chave da lista abaixo);
--      - uma imagem enviada (icone_imagem), recortada em quadrado pelo app.
--    icone_cor é a cor do ícone pronto e da inicial, e a da borda da imagem.
--
--  QUEM PODE
--    Quem já muda o nome do projeto: o dono e os editores (projects_update,
--    em schema_base.sql). As colunas novas entram no grant update de
--    projects, ao lado de name, columns e notes (rls_correcoes.sql).
--
--  A IMAGEM (SEC-083)
--    O banco guarda só o caminho do arquivo no bucket avatars, nunca uma URL.
--    O app monta a URL pública a partir do caminho, então ninguém aponta o
--    ícone do projeto para um endereço de fora (que veria o IP de quem abre o
--    projeto). O caminho tem um formato só:
--      <id de quem enviou>/projeto-<id do projeto>-<número>.<png|jpg|webp>
--    e o gatilho confere que a pasta é de quem está salvando e que o id é o
--    do próprio projeto. As policies do bucket já só deixam cada pessoa
--    gravar na própria pasta, até 4 MB e só imagem (rls_correcoes.sql).
-- ============================================================================


-- 1. Colunas ---------------------------------------------------------------------

alter table public.projects add column if not exists icone        text;
alter table public.projects add column if not exists icone_cor    text;
alter table public.projects add column if not exists icone_imagem text;

-- A mesma lista de ICONES_PROJETO, em script.js. Ícone novo entra nos dois.
alter table public.projects drop constraint if exists projects_icone_valido;
alter table public.projects add constraint projects_icone_valido check (
  icone is null or icone in (
    'foguete', 'estrela', 'raio', 'coracao', 'alvo', 'livro', 'codigo', 'musica',
    'camera', 'globo', 'casa', 'maleta', 'sacola', 'grafico', 'chat', 'coroa',
    'folha', 'fogo', 'diamante', 'lampada', 'pessoas', 'escudo', 'jogo'
  )
);

alter table public.projects drop constraint if exists projects_icone_cor_valida;
alter table public.projects add constraint projects_icone_cor_valida check (
  icone_cor is null or icone_cor ~ '^#[0-9A-Fa-f]{6}$'
);

alter table public.projects drop constraint if exists projects_icone_imagem_valida;
alter table public.projects add constraint projects_icone_imagem_valida check (
  icone_imagem is null or icone_imagem ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/projeto-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]{1,16}\.(png|jpg|webp)$'
);


-- 2. Gatilho: a imagem é de quem salva e é deste projeto --------------------------
--
--  Só olha quando o caminho muda (ou no insert). Pelo SQL Editor (sem
--  auth.uid()) deixa passar, para dar para corrigir à mão.

create or replace function public.projeto_icone_imagem()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.icone_imagem is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.icone_imagem is not distinct from old.icone_imagem then
    return new;
  end if;
  if split_part(new.icone_imagem, '/', 2) not like 'projeto-' || new.id::text || '-%' then
    raise exception 'A imagem do ícone não é deste projeto.' using errcode = '42501';
  end if;
  if auth.uid() is not null and split_part(new.icone_imagem, '/', 1) <> auth.uid()::text then
    raise exception 'A imagem do ícone tem de estar na sua própria pasta.' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.projeto_icone_imagem() from public, anon, authenticated;

drop trigger if exists projects_icone_imagem on public.projects;
create trigger projects_icone_imagem
  before insert or update of icone_imagem on public.projects
  for each row execute function public.projeto_icone_imagem();


-- 3. Permissão ----------------------------------------------------------------------
--    Soma ao grant de rls_correcoes.sql. owner_id e owner_email continuam fixos.

grant update (icone, icone_cor, icone_imagem) on public.projects to authenticated;

notify pgrst, 'reload schema';


-- 4. Verificação ----------------------------------------------------------------------
--    Deve retornar UMA linha com tudo true:
--      colunas  — as três colunas existem
--      grants   — authenticated altera o ícone, e continua sem alterar o dono
--      checks   — as três constraints existem
--      gatilho  — o gatilho existe e a função não é security definer

select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'projects'
      and column_name in ('icone', 'icone_cor', 'icone_imagem')) = 3          as colunas,
  has_column_privilege('authenticated', 'public.projects', 'icone_imagem', 'UPDATE')
  and has_column_privilege('authenticated', 'public.projects', 'icone_cor', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.projects', 'owner_id', 'UPDATE') as grants,
  (select count(*) from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname in ('projects_icone_valido', 'projects_icone_cor_valida',
                      'projects_icone_imagem_valida')) = 3                     as checks,
  exists (select 1 from pg_trigger
           where not tgisinternal and tgname = 'projects_icone_imagem')
  and not (select prosecdef from pg_proc
            where oid = 'public.projeto_icone_imagem()'::regprocedure)        as gatilho;
