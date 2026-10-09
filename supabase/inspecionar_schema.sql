-- ============================================================================
--  samyest.mind — fotografia do schema base e do RLS (só leitura)
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
--  NÃO ALTERA NADA. É um único SELECT sobre o catálogo do Postgres: não lê
--  nenhuma linha de tarefa, projeto ou perfil, só a estrutura. Pode rodar
--  quantas vezes quiser.
--
--  POR QUE EXISTE
--    tasks, profiles, projects, project_members, task_comments, a função
--    accept_invite_by_code e o bucket avatars foram criados pelo painel e nunca
--    entraram em supabase/. Este arquivo tira a fotografia do que está no banco
--    hoje, para versionar o schema base e conferir se o RLS segura o que o app
--    só esconde na tela (o visualizador não vê os botões, mas a chave pública
--    está no navegador e fala direto com a API).
--
--    Entram também as tabelas que já têm .sql aqui (routines,
--    google_credentials, google_ignored_events, challenge_days,
--    challenge_entries), para conferir se o banco bate com os arquivos.
--
--  POR QUE UM SELECT SÓ, NUMA CÉLULA SÓ
--    O SQL Editor mostra apenas o resultado do último comando, e copiar uma
--    grade de várias linhas depende de achar o botão de exportar. Então tudo
--    sai como texto numa única célula (coluna "relatorio"), um bloco por item:
--      ### secao · objeto
--      detalhe
--
--  O QUE O RESULTADO DEVE MOSTRAR (na ordem)
--    rls          uma linha por tabela: rls ligado, forçado e quantas policies.
--                 google_credentials precisa vir com rls_ligado=true e
--                 policies=0. "NÃO EXISTE" = a tabela não está no banco.
--    colunas      colunas de cada tabela, com tipo, not null e default
--    constraints  PK, FK, unique e check
--    indices      todos os índices
--    grants       o que os papéis anon e authenticated podem fazer em cada
--                 tabela (e coluna a coluna em profiles)
--    policies     todas as policies do schema public, com using e with check
--    funcoes      definição completa de cada função do schema public —
--                 accept_invite_by_code e qualquer função auxiliar que as
--                 policies chamem —, se roda como security definer e quem
--                 pode executá-la
--    triggers     triggers das tabelas acima e de auth.users
--    views        views do public: uma view sem security_invoker ignora o RLS
--                 de quem consulta
--    bucket       configuração dos buckets de storage (avatars em especial)
--    storage      policies de storage.objects e storage.buckets
--    realtime     tabelas publicadas no supabase_realtime
--    fim          sempre o último bloco, com o total de itens. Se ele não
--                 aparecer no que você copiou, a cópia veio cortada.
--
--  COMO DEVOLVER
--    Clique com o botão direito na célula de "relatorio" -> Copy cell (ou
--    selecione a célula e Cmd+C). Depois, no terminal, salve a cópia num
--    arquivo: pbpaste > supabase/resultado_inspecao.txt
--    (o arquivo serve só de base para o schema; não precisa ir para o git)
-- ============================================================================

with alvo(tabela) as (
  values ('tasks'), ('profiles'), ('projects'), ('project_members'),
         ('task_comments'), ('routines'), ('google_credentials'),
         ('google_ignored_events'), ('challenge_days'), ('challenge_entries')
),
rel as (
  select a.tabela, c.oid as relid, c.relrowsecurity, c.relforcerowsecurity
  from alvo a
  left join pg_class c
    on c.relname = a.tabela
   and c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'p')
),
papel(nome) as (
  values ('anon'::name), ('authenticated'::name)
),
linhas(ordem, secao, objeto, detalhe) as (

  -- 1. RLS por tabela --------------------------------------------------------
  select 1, 'rls', r.tabela,
         case when r.relid is null then 'NÃO EXISTE'
              else format('rls_ligado=%s  forcado=%s  policies=%s',
                          r.relrowsecurity, r.relforcerowsecurity,
                          (select count(*) from pg_policies p
                            where p.schemaname = 'public' and p.tablename = r.tabela))
         end
  from rel r
  union all
  select 1, 'rls', 'storage.objects',
         format('rls_ligado=%s  forcado=%s  policies=%s',
                c.relrowsecurity, c.relforcerowsecurity,
                (select count(*) from pg_policies p
                  where p.schemaname = 'storage' and p.tablename = 'objects'))
  from pg_class c
  where c.oid = to_regclass('storage.objects')

  -- 2. Colunas ---------------------------------------------------------------
  union all
  select 2, 'colunas', r.tabela,
         string_agg(
           a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || case when a.attnotnull then ' not null' else '' end
           || case a.attidentity when 'a' then ' generated always as identity'
                                 when 'd' then ' generated by default as identity'
                                 else '' end
           || case when a.attgenerated = 's'
                   then ' generated always as (' || pg_get_expr(d.adbin, d.adrelid) || ') stored'
                   else coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '') end,
           E'\n' order by a.attnum)
  from rel r
  join pg_attribute a on a.attrelid = r.relid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  group by r.tabela

  -- 3. Constraints -----------------------------------------------------------
  union all
  select 3, 'constraints', r.tabela,
         string_agg(co.conname || ': ' || pg_get_constraintdef(co.oid), E'\n'
                    order by co.contype, co.conname)
  from rel r
  join pg_constraint co on co.conrelid = r.relid
                       and co.contype <> 'n'  -- not null já aparece em colunas
  group by r.tabela

  -- 4. Índices ---------------------------------------------------------------
  union all
  select 4, 'indices', r.tabela,
         string_agg(pg_get_indexdef(i.indexrelid), E'\n' order by i.indexrelid::regclass::text)
  from rel r
  join pg_index i on i.indrelid = r.relid
  group by r.tabela

  -- 5. Grants de anon e authenticated ----------------------------------------
  union all
  select 5, 'grants', r.tabela || ' / ' || g.nome,
         coalesce(nullif(concat_ws(',',
           case when has_table_privilege(g.nome, r.relid, 'SELECT') then 'select' end,
           case when has_table_privilege(g.nome, r.relid, 'INSERT') then 'insert' end,
           case when has_table_privilege(g.nome, r.relid, 'UPDATE') then 'update' end,
           case when has_table_privilege(g.nome, r.relid, 'DELETE') then 'delete' end), ''),
           'nenhum')
  from rel r
  cross join papel g
  where r.relid is not null
  union all
  -- s = pode ler a coluna, u = pode alterar; "-" = não pode
  select 5, 'grants', 'profiles (por coluna) / ' || g.nome,
         string_agg(a.attname || ':'
                    || case when has_column_privilege(g.nome, a.attrelid, a.attnum, 'SELECT') then 's' else '-' end
                    || case when has_column_privilege(g.nome, a.attrelid, a.attnum, 'UPDATE') then 'u' else '-' end,
                    '  ' order by a.attnum)
  from rel r
  cross join papel g
  join pg_attribute a on a.attrelid = r.relid and a.attnum > 0 and not a.attisdropped
  where r.tabela = 'profiles'
  group by g.nome

  -- 6. Policies do schema public ---------------------------------------------
  union all
  select 6, 'policies', p.tablename || ' / ' || p.policyname,
         format('cmd=%s  %s  roles=%s', p.cmd, lower(p.permissive), array_to_string(p.roles, ','))
         || coalesce(E'\nusing: ' || p.qual, '')
         || coalesce(E'\nwith check: ' || p.with_check, '')
  from pg_policies p
  where p.schemaname = 'public'

  -- 7. Funções do schema public (fora as de extensões) -----------------------
  union all
  select 7, 'funcoes', p.oid::regprocedure::text,
         format('security_definer=%s  config=%s  execute: anon=%s authenticated=%s',
                p.prosecdef,
                coalesce(array_to_string(p.proconfig, ','), '-'),
                has_function_privilege('anon', p.oid, 'EXECUTE'),
                has_function_privilege('authenticated', p.oid, 'EXECUTE'))
         || E'\n' || pg_get_functiondef(p.oid)
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend dep
                     where dep.classid = 'pg_proc'::regclass
                       and dep.objid = p.oid and dep.deptype = 'e')
  union all
  select 7, 'funcoes', 'accept_invite_by_code', 'NÃO EXISTE no schema public'
  where not exists (select 1 from pg_proc
                     where proname = 'accept_invite_by_code'
                       and pronamespace = 'public'::regnamespace)

  -- 8. Triggers --------------------------------------------------------------
  union all
  select 8, 'triggers', t.tgrelid::regclass::text || ' / ' || t.tgname,
         pg_get_triggerdef(t.oid, true)
  from pg_trigger t
  where not t.tgisinternal
    and (t.tgrelid in (select relid from rel where relid is not null)
         or t.tgrelid = to_regclass('auth.users'))

  -- 9. Views do public ---------------------------------------------------------
  union all
  select 9, 'views', c.relname,
         format('tipo=%s  security_invoker=%s',
                case c.relkind when 'm' then 'materialized' else 'view' end,
                coalesce((select o.option_value from pg_options_to_table(c.reloptions) o
                           where o.option_name = 'security_invoker'), 'false'))
         || E'\n' || pg_get_viewdef(c.oid, true)
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('v', 'm')
    and not exists (select 1 from pg_depend dep
                     where dep.classid = 'pg_class'::regclass
                       and dep.objid = c.oid and dep.deptype = 'e')

  -- 10. Buckets de storage (só a configuração, nenhum arquivo) ---------------
  union all
  select 10, 'bucket', b.id::text, (to_jsonb(b) - 'owner' - 'owner_id')::text
  from storage.buckets b
  union all
  select 10, 'bucket', 'avatars', 'NÃO EXISTE'
  where not exists (select 1 from storage.buckets where id = 'avatars')

  -- 11. Policies de storage ----------------------------------------------------
  union all
  select 11, 'storage', p.tablename || ' / ' || p.policyname,
         format('cmd=%s  %s  roles=%s', p.cmd, lower(p.permissive), array_to_string(p.roles, ','))
         || coalesce(E'\nusing: ' || p.qual, '')
         || coalesce(E'\nwith check: ' || p.with_check, '')
  from pg_policies p
  where p.schemaname = 'storage'

  -- 12. Realtime ---------------------------------------------------------------
  union all
  select 12, 'realtime', pt.pubname::text,
         string_agg(pt.schemaname || '.' || pt.tablename, ', ' order by pt.tablename)
  from pg_publication_tables pt
  where pt.pubname = 'supabase_realtime'
  group by pt.pubname
)
select string_agg('### ' || secao || ' · ' || objeto || E'\n' || coalesce(detalhe, ''),
                  E'\n\n' order by ordem, objeto) as relatorio
from (
  select ordem, secao, objeto, detalhe from linhas
  union all
  select 99, 'fim', 'fim',
         format('%s itens acima · Postgres %s', count(*), current_setting('server_version'))
  from linhas
) x;
