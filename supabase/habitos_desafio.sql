-- ============================================================================
--  samyest.mind — hábitos do Desafio como metas, só na conta dona
-- ============================================================================
--
--  ONDE RODAR
--    Supabase -> SQL Editor -> New query -> colar tudo -> Run
--    Precisa de supabase/routines.sql e supabase/metas.sql já aplicados.
--
--  Pode rodar mais de uma vez: um hábito que já existe na conta (mesmo
--  título, ativo ou concluído) é pulado. Um que você apagou volta se rodar
--  de novo.
--
--  O QUE É
--    Os itens do checklist do Desafio que dependem de você fazer (os que o
--    app não marca sozinho) viram metas de hábito, cada uma com a rotina
--    ligada, igual a uma meta criada pela tela com "Aparecer como tarefa
--    nesses dias":
--
--      Academia ................ seg, qua, qui, sex
--      3L de água .............. todo dia
--      Creatina 3–5g ........... todo dia
--      1h de curso ou freela ... ter, sex, sáb
--      Revisar a semana ........ dom
--
--    "Pesar em jejum" e "140g de proteína" ficam de fora: o Desafio já marca
--    os dois pelo peso e pela comida registrados. "CS só depois do bloco"
--    entra no "por quê" do curso, não como hábito separado.
--
--    A rotina cai na primeira coluna do seu Kanban (como faz a tela). A
--    tarefa do dia aparece na próxima vez que o app abrir num dia marcado, e
--    concluí-la conta o dia na meta. O prazo é o fim do Desafio, 31/12/2026.
--
--  QUEM RECEBE
--    Só a conta samirahmadpour@gmail.com. O SQL Editor roda sem RLS, então é
--    o filtro pelo email abaixo que garante que nenhuma outra conta é tocada.
--    Tudo acontece numa transação: se algo falhar, nada fica pela metade.
-- ============================================================================


do $$
declare
  dono    uuid;
  coluna  text;
  h       record;
  rotina  uuid;
  criados int := 0;
begin
  select id into dono
  from auth.users
  where lower(email) = 'samirahmadpour@gmail.com';

  if dono is null then
    raise exception 'A conta samirahmadpour@gmail.com não existe em auth.users.';
  end if;

  -- Primeira coluna do Kanban da conta, como o app faz em rotinaDoHabito().
  -- Chave fora do formato que o app aceita (CHAVE_COLUNA) ou perfil sem
  -- colunas próprias: fica 'todo', a primeira das colunas padrão.
  select p.kanban_columns -> 0 ->> 'key' into coluna
  from public.profiles p
  where p.id = dono;

  if coluna is null or coluna !~ '^[A-Za-z0-9_-]{1,64}$' then
    coluna := 'todo';
  end if;

  for h in
    select *
    from (values
      ('Academia', 'saude',
       'Direto do trabalho. É o treino que leva dos 73 aos 77kg até 31/12.',
       array[1, 3, 4, 5]),
      ('3L de água', 'saude',
       '4L nos dias de treino.',
       array[0, 1, 2, 3, 4, 5, 6]),
      ('Creatina 3–5g', 'saude',
       'Pós-treino ou no almoço.',
       array[0, 1, 2, 3, 4, 5, 6]),
      ('1h de curso ou freela', 'carreira',
       'Celular longe. CS só depois do bloco: o jogo é a recompensa.',
       array[2, 5, 6]),
      ('Revisar a semana', 'pessoal',
       '15 minutos para ver o que andou e ajustar a próxima semana.',
       array[0])
    ) as v(titulo, area, porque, dias)
  loop
    if exists (
      select 1 from public.goals g
      where g.user_id = dono and g.kind = 'habito' and g.title = h.titulo
    ) then
      raise notice 'Já existia, pulei: %', h.titulo;
      continue;
    end if;

    -- created_at por clock_timestamp(), e não o now() do default: dentro de
    -- uma transação o now() é o mesmo para todas as linhas, e o app ordena
    -- metas e rotinas por created_at. Com empate, a ordem na barra lateral
    -- mudava de um carregamento para outro.
    insert into public.routines (user_id, title, status, priority, weekdays, created_at, updated_at)
    values (dono, h.titulo, coluna, 'normal', h.dias, clock_timestamp(), clock_timestamp())
    returning id into rotina;

    insert into public.goals (user_id, kind, title, area, why, weekdays, routine_id, due_date, created_at, updated_at)
    values (dono, 'habito', h.titulo, h.area, h.porque, h.dias, rotina, date '2026-12-31', clock_timestamp(), clock_timestamp());

    criados := criados + 1;
  end loop;

  raise notice 'Hábitos criados agora: %', criados;
end $$;


-- Verificação ----------------------------------------------------------------
--    Deve retornar CINCO linhas, todas com rotina_ligada = true e
--    rotina_ativa = true. Os dias saem como 0=domingo ... 6=sábado.

select g.title          as habito,
       g.area,
       g.weekdays       as dias,
       g.due_date       as prazo,
       r.id is not null as rotina_ligada,
       r.active         as rotina_ativa,
       r.status         as coluna
from public.goals g
join auth.users u on u.id = g.user_id
left join public.routines r on r.id = g.routine_id
where lower(u.email) = 'samirahmadpour@gmail.com'
  and g.kind = 'habito'
  and g.title in ('Academia', '3L de água', 'Creatina 3–5g', '1h de curso ou freela', 'Revisar a semana')
order by g.created_at;
