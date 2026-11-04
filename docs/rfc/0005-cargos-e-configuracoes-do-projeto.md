# RFC 0005 — Cargos, salas privadas e configurações do projeto

- **Status:** proposta
- **Autor:** samyest
- **Data:** 2026-11-04
- **Specs afetadas:** [`docs/specs/seguranca.md`](../specs/seguranca.md) (SEC-075 e SEC-080
  revistos; SEC-084 a SEC-089, novos)

## 1. Contexto

O pedido, numa lista de anotações:

> Regras de cargo, criar funções como silenciar outros integrantes, mover outros
> integrantes. Opção de call privadas. Opção de mover as calls pressionando elas
> (depende do cargo). Opção de mudar o cargo das pessoas, dono mudar o editor como
> visualizador ou participante. Liberar customização de fontes de nomes. Regras de
> call, call silêncio já vem mutado. Movimentar os projetos de ordem pressionando
> elas. Se eu clicar no projeto da barra lateral, abre a tela anterior do projeto.
> Criar opção de configuração do servidor do lado do convidar, superior direito.
> Mudar ícone de minimizado pra tirar e colocar a câmera. Melhorar a animação ao
> trocar de aba/projeto. Colocar a opção de alterar a ordem da barra de categorias
> (canais, calendário, notas) na configuração do servidor.

O que no código pesa:

- **Papéis hoje:** dono (`projects.owner_id`), editor e visualizador
  (`project_members.role`). O dono **não tem UPDATE** em `project_members` desde o
  `rls_correcoes.sql`: o grant de UPDATE só cobre `user_id` e `status`, para o
  convidado aceitar o próprio convite. Mudar o cargo de alguém não existe.
- **Chamada:** um tópico do Realtime por projeto (`chamada:<project_id>`), com a
  sala de cada um na Presence (RFC 0004, Q10). O Broadcast **não autentica quem
  manda**: o campo `de` do sinal é escrito pelo próprio cliente. Qualquer pessoa do
  projeto consegue mandar um sinal dizendo que veio do dono.
- **Sala privada** ficou fora da RFC 0004 (Q2 e seção 4) porque exige um tópico por
  sala e policies novas. Agora é o pedido.
- **Ordem na lista de canais** é o campo "Lugar na lista" do diálogo; arrastar ficou
  para depois (Q8 da RFC 0004).
- **A ordem dos projetos na barra lateral** já se muda segurando e arrastando (#21);
  esta RFC não mexe nela.

## 2. Objetivo

Dar ao projeto o que um servidor do Discord tem para organizar gente: cargos com
regras, moderação das salas de voz, canais e salas privadas, e uma tela de
configurações do projeto. Sem abrir acesso a ninguém de fora do projeto, e com o
banco decidindo quem pode cada coisa.

### Decisões

Tomadas na implementação, a partir das anotações, seguindo o padrão do app.

| # | Decisão |
|---|---|
| Q1 | Quatro cargos: **Dono**, **Editor**, **Participante** e **Visualizador**. O participante é novo: cria, edita, move e apaga tarefas e comenta, mas não muda a estrutura (colunas, notas, canais, ícone, nome, abas). Editor e visualizador continuam como eram. |
| Q2 | Só o dono muda o cargo de alguém, pela função `definir_cargo_membro`. O grant de UPDATE de `project_members` continua sem `role`: dar `role` ali deixaria o convidado escolher o próprio cargo ao aceitar. O convite já escolhe entre os três cargos. |
| Q3 | **Regras de cargo**: duas permissões de voz, ligadas por cargo — *Silenciar outros nas salas* e *Mover e desconectar outros*. Padrão: o editor tem as duas; participante e visualizador, nenhuma; o dono sempre tem. Só o dono muda as regras (gatilho no banco). |
| Q4 | Hierarquia: ninguém modera o dono, e cada um modera só quem tem cargo igual ou abaixo do seu (editor > participante > visualizador). |
| Q5 | A moderação passa pelo banco, não pelo Broadcast (seção 1): uma linha por pessoa e projeto em `project_voz_moderacao`, que só aceita escrita de quem tem a permissão. Chega aos outros pelo Postgres Changes, que confere o RLS. |
| Q6 | **Silenciar**: o app de quem foi silenciado fecha e trava o microfone, com o aviso "Silenciado por <nome>". Os apps dos outros também deixam de tocar a voz dele, então nem um app alterado fura. Vale em todas as salas do projeto até alguém com a permissão liberar, como no Discord. |
| Q7 | **Mover** leva a pessoa direto para a sala escolhida, sem prévia e sem desligar câmera ou tela (como a troca de sala da Q11 da RFC 0004). **Desconectar** tira da chamada. Os outros apps param de conectar com a sessão que recebeu a ordem: quem ignorar fica sozinho. |
| Q8 | **Canal ou sala privada**: opção no diálogo do canal. Veem e entram o dono, quem criou e as pessoas marcadas na lista. Vale para canal de texto também; as linhas "Chamada iniciada" da sala privada ficam escondidas junto. Ninguém de fora do projeto entra na lista. |
| Q9 | A sala privada usa um tópico próprio, `chamada:<projeto>:<sala>`, cuja policy confere a lista. Quem está numa sala privada some da Presence do tópico do projeto: quem não está na lista não vê nem que a sala tem gente. |
| Q10 | **Microfone ao entrar**, regra de cada sala: *Livre* (o de sempre), *Fechado* (entra mudo e abre quando quiser) e *Silêncio* (ninguém abre o microfone, só quem pode silenciar outros). Na sala Silêncio, os apps dos outros também não tocam a voz de quem não pode falar. A sala "Silêncio" do modelo de equipe nasce assim, e as que já existem com esse nome mudam ao rodar o SQL. |
| Q11 | Dono e editores **arrastam canais, salas e categorias** segurando ~0,4 s, inclusive para outra categoria; Alt + seta faz o mesmo pelo teclado. O "Lugar na lista" do diálogo continua. |
| Q12 | Quem pode mover outros arrasta uma pessoa de uma sala para outra na lista, ou clica nela e escolhe *Mover para*. O mesmo menu tem *Silenciar* e *Desconectar*, e aparece também no quadro da pessoa na chamada. |
| Q13 | **Configurações do projeto**: engrenagem ao lado do Convidar, no topo do projeto, para todos. Seções: *Geral* (nome e ícone), *Abas* (ordem), *Cargos* (as regras da Q3) e *Membros* (cargo de cada um). Quem não pode mudar uma seção vê como está, sem os controles. |
| Q14 | A **ordem das abas** (Início, Quadro, Calendário, Notas, Canais) é do projeto e igual para todos, em `projects.ordem_abas`. Dono e editores mudam, arrastando ou pelas setas. A primeira aba é a que abre no primeiro acesso. A direção do deslizar na troca de aba segue essa ordem. |
| Q15 | **Fonte do nome**: cada pessoa escolhe uma de nove fontes e uma cor para o próprio nome, nas Configurações > Conta. Aparece no chat, na chamada, nas salas e na lista de pessoas. As fontes vêm do Google Fonts (já liberado na CSP) e só carregam quando alguém usa uma. |
| Q16 | Clicar na barra lateral no projeto em que a chamada aberta está minimiza a chamada e mostra a tela do projeto, a mesma aba e o mesmo canal de antes. Antes o clique não fazia nada. |
| Q17 | Chamada minimizada: o botão da câmera entra no lugar do da janela flutuante, que passa para o topo da chamada aberta. |
| Q18 | Troca de aba e de projeto mais viva: o realce da aba desliza até a nova, o conteúdo entra com profundidade (desliza, cresce de leve e desfoca para nítido) e os blocos chegam em cascata; na troca de projeto, o ícone e o título entram primeiro. Tudo some com `prefers-reduced-motion`. |

### Fora do escopo

- Cargos criados pela pessoa, com nome e cor próprios. Os quatro fixos cobrem o
  pedido e mantêm o RLS simples.
- Permissões de voz por sala (só regra de microfone por sala, Q10).
- Banir do projeto: remover membro continua com o dono, como hoje.
- Fonte do nome do projeto ou dos canais (a fonte é do nome da pessoa).

## 3. Proposta

### 3.1 Banco: `supabase/configuracoes_projeto.sql`

- `project_members.role` aceita `participante` (policy de convite e um `check`
  `not valid`, que não reprova linhas antigas).
- `tasks_insert`, `tasks_update` e `tasks_delete`: tarefa de projeto passa a aceitar
  o participante, além do editor e do dono. Tarefa pessoal continua só do dono dela.
  Colunas, notas, canais e o resto de `projects` continuam só com dono e editor.
- `definir_cargo_membro(membro, cargo)`, `security definer` com `search_path` fixo:
  confere que quem chama é dono do projeto daquela linha e que o cargo é um dos três.
- `projects.regras_cargos` (`jsonb`): `{"editor": ["silenciar", "mover"], ...}`;
  nulo é o padrão da Q3. `check` por função `immutable` com a lista fechada. Gatilho
  recusa mudança feita por quem não é o dono.
- `projects.ordem_abas` (`jsonb`): lista das cinco chaves, sem repetir, `check` por
  função `immutable`. Dono e editores mudam (o `projects_update` de sempre).
- `tem_permissao_voz(projeto, permissao)` e `nivel_no_projeto(projeto, pessoa)`,
  `security definer`, usadas pelas policies da moderação.

### 3.2 Banco: `supabase/salas_projeto.sql`

- `project_channels` ganha `privado`, `criado_por` (`auth.uid()` do banco, fora dos
  grants) e `regra_mic` (`livre`, `fechado`, `silencio`; só em sala de voz).
- `project_channel_membros` (`canal_id`, `project_id`, `user_id`): a lista de quem vê
  o canal privado. Chave composta para o canal do mesmo projeto; um gatilho recusa
  pessoa que não é do projeto. Dono e editores que veem o canal mexem na lista.
- `pode_ver_canal(canal)`: o canal não é privado, ou quem pergunta é o dono, quem
  criou ou está na lista — sempre além do acesso ao projeto. Entra no `select`,
  `update` e `delete` de `project_channels`, no `select`, `insert` e "apagar" de
  `project_messages` e na policy de `project_channel_reads`. A contagem de não lidas
  é `security invoker` e herda tudo isso.
- `mensagem_canal` (mensagem sem canal, da versão anterior do app) passa a escolher
  o primeiro canal **não privado**.
- `pode_usar_canal_chamada` aceita também `chamada:<projeto>:<sala>`, só para sala de
  voz privada do projeto que a pessoa pode ver. O formato continua conferido antes
  do cast.
- `project_voz_moderacao` (`project_id`, `user_id`, `silenciado`, `comando`
  — `mover` ou `desconectar` —, `comando_sala`, `comando_sessao`, `comando_em`,
  `atualizado_por`, `atualizado_em`). Leitura: dono e membros aceitos. Escrita:
  `pode_moderar(projeto, alvo)` (Q3, Q4). Um gatilho `security definer` confere a
  permissão certa para o que mudou (silenciar ou mover), põe autoria e data do banco
  e confere que a sala de destino é do projeto, é de voz e o alvo pode vê-la.
- Sair do projeto apaga a pessoa das listas de canais privados e da moderação.
- Realtime: `project_voz_moderacao` entra na publicação.

### 3.3 Banco: `supabase/fonte_do_nome.sql`

`profiles.nome_fonte` (lista fechada, a mesma de `FONTES_NOME` no `script.js`) e
`profiles.nome_cor` (`#rrggbb`), com grant de UPDATE. A pessoa só muda o próprio
perfil (`profiles_update_own`).

### 3.4 Chamada

- O registro de canais do Realtime passa a ser por tópico: o do projeto e um por
  sala privada que a pessoa vê. A lista de quem está em cada sala junta os dois.
- Entrar, trocar de sala ou ser movido entre sala pública e privada troca de tópico:
  sai da Presence de um, entra na do outro, com sessão nova.
- A moderação chega pelo Postgres Changes. O alvo obedece (fecha o microfone, troca
  de sala, sai). Os receptores aplicam por conta própria: não tocam a voz de quem
  está silenciado ou numa sala de silêncio sem poder falar, e não conectam com a
  sessão que recebeu ordem de mover ou desconectar.

**O que isso não garante.** Quem é silenciado e altera o próprio app continua
transmitindo; os apps dos outros é que não tocam. Um app alterado também pode
continuar no tópico do projeto depois de movido, mas ninguém conecta com ele. Dentro
do tópico de uma sala, a separação continua sendo a do SEC-075.

### 3.5 Na tela

- **Configurações do projeto**: modal no formato das Configurações do app (seções à
  esquerda, painel à direita; no celular, seções em cima).
- **Membros**: cada pessoa com o cargo num `select` para o dono; texto para os outros.
- **Cargos**: uma tabela com as duas permissões por cargo, em interruptores. O dono
  aparece com tudo ligado e travado.
- **Diálogo do canal**: "Privado" com a lista de pessoas do projeto para marcar, e,
  na sala de voz, "Microfone ao entrar".
- **Lista de canais**: cadeado nos privados; o ícone da sala de silêncio mostra o
  microfone riscado. Pessoa silenciada pelo moderador aparece com o microfone riscado
  em vermelho.
- Sem os `.sql` novos, tudo segue como antes, e o que depende deles avisa o arquivo
  que falta ao salvar.

## 4. Alternativas consideradas

- **Moderação pelo Broadcast**, conferindo o cargo de quem manda. O `de` é do
  cliente: um visualizador silenciaria todo mundo em nome do dono. Descartada.
- **Cargos configuráveis livres** (nome, cor, permissões soltas). Exigiria reescrever
  toda policy de projeto em cima de uma tabela de permissões. Quatro cargos fixos mais
  duas permissões de voz cobrem o pedido.
- **Sala privada só no cliente** (esconder da lista). Qualquer um do projeto ainda
  assinaria o tópico e veria a sinalização da sala. Descartada pelo mesmo motivo que
  a RFC 0004 deu.
- **Ordem das abas por pessoa.** O pedido põe a ordem na "configuração do servidor":
  é do projeto, como as colunas.

## 5. Riscos

- **Repetir o SEC-045.** Toda policy nova passa por `is_project_owner`/
  `is_project_member`, e as funções novas que leem cargo são `security definer` com
  `search_path` fixo e sem grant onde não precisam.
- **Editor que se tranca fora de um canal privado.** A policy de UPDATE confere a
  visibilidade na linha nova; o app põe quem está salvando na lista antes de tornar o
  canal privado.
- **Perda de visibilidade não chega pelo realtime.** Quem sai da lista de um canal não
  recebe o UPDATE (o RLS esconde). O app de quem salvou avisa os outros por um
  Broadcast "canais" no tópico do projeto, e cada um recarrega a lista. Um aviso falso
  só causa uma recarga.
- **`script.js` crescer mais.** O código novo fica junto do bloco que estende (canais,
  chamada, projeto), com nomes em português (QUA-004).

## 6. Plano

1. Specs SEC-084 a SEC-089 e revisão do SEC-075 e SEC-080 (esta RFC).
2. Os três `.sql`, testados num Postgres 16 local com dono, editor, participante,
   visualizador, conta de fora e conta removida.
3. Front: cargos, configurações do projeto, abas, arrastar canais, salas privadas,
   regra de microfone, moderação, fonte do nome, barra lateral, mini e animação.
4. Teste no navegador com o Supabase simulado: celular a 375px, temas Vidro e Grafite.
**Estado em 2026-11-04.** Passos 1 a 4 feitos. O SQL passou em 83 casos num
Postgres 16 local, com stubs de `auth`, `storage` e `realtime`, rodando os três
arquivos duas vezes seguidas sobre todo o SQL de antes. No Chromium, com o Supabase
simulado e microfone e câmera falsos: troca de aba e de projeto, as quatro seções
das configurações (cargo, ordem das abas e regra de cargo gravados), canais com gente
nas salas, menu de moderação, arrastar canal para outra categoria e pessoa para outra
sala, diálogo da sala privada e da sala de silêncio, fonte do nome, entrar numa sala,
silenciar pelo quadro da pessoa, minimizar pelo clique no projeto da barra lateral,
câmera pelo mini, ser movido para a sala de silêncio, ser silenciado e ser
desconectado. Em 1440px e 390px, nos temas Vidro e Grafite, sem erro no console.
Faltam os passos 5 e 6.

5. Rodar os `.sql` no Supabase (ordem no README) e conferir a verificação do fim de
   cada um.
6. Teste com duas contas: silenciar, mover e desconectar no meio da chamada, sala
   privada com alguém de fora da lista.
