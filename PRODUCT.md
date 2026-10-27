# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Samir, o dono do app** (inferido do código): usa no dia a dia para tarefas de
  clientes, rotinas, Metas e o Desafio de 88 dias, que só existe na conta dele.
- **Pessoas convidadas para projetos compartilhados** (inferido do código): editam
  ou só visualizam o quadro, o calendário e as notas de um projeto.
- **Contas abertas pelo cadastro** (inferido do código): o cadastro por email e senha
  está aberto; essas contas têm tarefas, rotinas, projetos, Metas e Google Calendar,
  mas não o Desafio.

## Product Purpose

Organizar tarefas e rotinas num só lugar, com sincronização nos dois sentidos com a
agenda principal do Google Calendar, e acompanhar objetivos pessoais de médio prazo.
Sucesso é a pessoa abrir o app e saber o que fazer hoje sem reconstruir a lista de
cabeça.

## Positioning

Tarefas, rotinas e objetivos pessoais ligados entre si e à agenda real do Google:
uma rotina gera a tarefa do dia, a tarefa vira evento, e um hábito de uma meta é uma
rotina. Nada disso vive em apps separados.

## Operating Context

- Uso diário, em computador (barra lateral) e celular (barra inferior); a aba fica
  aberta por horas.
- Kanban pessoal com colunas próprias, calendário, tabela, projetos compartilhados.
- Rotinas semanais criam a tarefa do dia sozinhas.
- O Desafio de 88 dias acompanha checklist diário, peso, comida, freelas, vagas,
  metas com prazo e uma trilha de estudos.

## Capabilities and Constraints

- HTML, CSS e JavaScript puros, sem build (`index.html`, `styles.css`, `script.js`);
  funções da Vercel em `api/`; Supabase com RLS; SQL versionado em `supabase/`.
- O Desafio fica restrito ao email do dono, inclusive nas policies do banco. As Metas
  começaram assim e foram abertas para todas as contas (cada uma só vê as próprias);
  uma apresentação abre uma vez por conta, registrada em `profiles.novidades_vistas`.
- Metas (decidido): quatro tipos — chegar a um número, criar um hábito, concluir em
  etapas, feito/não feito. Um hábito pode virar rotina e aparecer como tarefa nos
  dias marcados; concluir essa tarefa conta na meta. O Desafio fica dentro da seção
  Metas da barra lateral.
- Oito temas de cor: seis claros, o Vidro (vidro fosco nos tons do Sereno) e um escuro, o Grafite.
- Português do Brasil em toda a interface.

## Brand Commitments

- Nome **samyest.mind**, sempre em minúsculas, marcado como não traduzível.
- Voz em português informal e direta ("pra", "Aproveita pra respirar"), sem
  formalidade corporativa.

## Evidence on Hand

- Política de privacidade em `privacidade.html`.
- Não há depoimentos, números de uso ou clientes publicados; nada disso deve ser
  inventado.

## Product Principles

1. O que importa hoje aparece primeiro; o resto espera a sua vez.
2. Uma coisa vive num lugar só: rotina, tarefa e evento são o mesmo item em vistas
   diferentes, não cópias que se desencontram.
3. Criar algo novo leva segundos; configurar mais é opcional e vem depois.
4. Falha nunca se disfarça de sucesso: quando algo não salva, a pessoa fica sabendo
   e não perde o que digitou.

## Accessibility & Inclusion

- Navegação completa por teclado com foco visível, movimento reduzido respeitado e
  avisos lidos por leitor de tela (trabalho já feito no histórico; manter).
