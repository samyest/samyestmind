# RFC 0004 — Canais de projeto

- **Status:** proposta
- **Autor:** samyest
- **Data:** 2026-11-04
- **Specs afetadas:** [`docs/specs/seguranca.md`](../specs/seguranca.md) (SEC-071, SEC-074 e
  SEC-075 revistos; SEC-080 a SEC-082, novos)

O número 0003 ficou reservado na RFC 0001 para o redesenho visual.

## 1. Contexto

O pedido: "criar um projeto onde tenha os canais assim separados", com uma captura do
Discord de uma equipe. Lá aparecem categorias (Administração, Comunicação Geral,
Reuniões, Intervalo), canais de texto (`#truth-geral`, `#truth-drive`,
`#truth-musicas`, `#truth-intervalo`) e salas de voz (EM REUNIÃO, SALA 1 a 5,
Silêncio, INTERVALO).

Hoje um projeto tem **um** chat e **uma** chamada (RFC 0002). O que no código pesa:

- **Mensagens** em `project_messages`, por projeto. "Até onde li" e "silenciado" em
  `project_chat_reads`, uma linha por pessoa e projeto. A contagem é
  `contar_nao_lidas()`, `security invoker`.
- **Chamada** no canal privado `chamada:<project_id>` do Realtime, com Presence (quem
  está e o que tem ligado) e Broadcast (oferta, resposta, ICE). As policies em
  `realtime.messages` validam o tópico pelo formato e pelo acesso ao projeto
  (SEC-075). Cada sinal já vai endereçado a um user id e a uma sessão.
- **`render()` reescreve a área principal.** A janela da chamada fica fora dela.
- **Papéis:** dono, editor e visualizador. Estrutura do projeto (colunas, notas) é de
  dono e editor; o chat é de todos (Q4 da RFC 0002).
- **Fallback de tabela.** As notas e o chat já sabem seguir sem o SQL novo, mostrando
  o que existia antes. Isso deixa publicar o código e rodar o SQL em qualquer ordem.

## 2. Objetivo

Cada projeto ganha **categorias**, **canais de texto** e **salas de voz**, como um
servidor do Discord, dentro da aba que hoje é o Chat. Sem abrir acesso a ninguém de
fora do projeto e sem mexer nas policies da chamada.

### Decisões

Q1 a Q4 fechadas com o usuário em 2026-11-04 (skill `grilling`). As outras foram
decididas na implementação, seguindo o padrão do app.

| # | Decisão |
|---|---|
| Q1 | Dono e editores criam, renomeiam, reordenam, mudam de categoria e apagam canais e categorias. O visualizador usa: escreve e entra nas salas (Q4 e Q11 da RFC 0002). |
| Q2 | Todo canal fica visível para todos do projeto. Canal privado fica fora: sala de voz privada exigiria um tópico do Realtime por sala e policies novas. |
| Q3 | Projeto novo começa com `#geral` e a sala Geral. O chat de hoje vira `#geral`, com o histórico e o "até onde li" de cada pessoa; a chamada de hoje vira a sala Geral. No + da lista, enquanto o projeto não tem categoria, "Usar o modelo de equipe" monta a estrutura da captura de uma vez (3.4). |
| Q4 | A aba Chat vira **Canais**: lista de categorias e canais à esquerda, conversa à direita. No celular, primeiro a lista, depois o canal, como nas Notas. A barra lateral do app não muda. |
| Q5 | Três tipos: categoria, texto e voz. Categoria tem um nível só. Canal sem categoria fica no topo da lista, como no Discord. |
| Q6 | Nome livre de até 60 caracteres, com maiúsculas, acento e emoji ("EM REUNIÃO 🤫"). Não vira minúsculas com hífen. |
| Q7 | Apagar um canal apaga as mensagens dele, com confirmação que diz isso. Apagar uma categoria não apaga os canais: eles ficam sem categoria. No máximo 100 itens (canais e categorias) por projeto, regra do banco. |
| Q8 | Ordem pelo campo "Lugar na lista" do diálogo do canal ("No topo" ou "Depois de #drive"), que funciona no teclado e no celular; a categoria se escolhe no mesmo diálogo. Arrastar fica para depois. |
| Q9 | Não lidas por canal (nome em destaque e contador), e a soma no projeto (aba e barra lateral), como antes. O "silenciar" continua por projeto (Q16 da RFC 0002). A notificação diz "Ana em Projeto X" e, no corpo, "#drive: " antes do trecho. |
| Q10 | Cada sala é uma chamada separada, todas no mesmo tópico `chamada:<project_id>`. A Presence ganha `sala` (o id do canal de voz), e cada um só conecta com quem está na mesma sala. As policies do SEC-075 não mudam. |
| Q11 | Clicar numa sala abre a prévia (Q22 da RFC 0002). Quem já está numa sala do mesmo projeto troca direto ao clicar em outra, sem prévia e sem desligar microfone, câmera ou tela, como no Discord. Uma sala por vez. |
| Q12 | Quem está em cada sala aparece embaixo dela na lista, com o anel de quem fala e o ícone de microfone fechado. |
| Q13 | "Chamada iniciada" e "Chamada encerrada" continuam gravadas, agora no canal da sala, e continuam disparando o aviso, que passa a dizer a sala ("Ana iniciou uma chamada em Sala 1"). Saem das conversas de texto: com cinco salas, seriam ruído no `#geral`, e a lista já mostra quem está em cada sala. |
| Q14 | "Iniciar chamada", no topo do projeto, abre a prévia da primeira sala de voz. A faixa "Chamada em andamento" diz a sala; com mais de uma sala ocupada, leva para a aba Canais. |
| Q15 | Sem o `canais_projeto.sql`, o app segue como antes: um chat e uma chamada por projeto, mostrados como `#geral` e a sala Geral, sem o + da lista. |
| Q16 | Na chamada aberta, o botão **Salas** (só com mais de uma sala) abre a lista das salas do projeto com quem está em cada uma, e um toque troca de sala como na Q11. Fechada com o usuário em 2026-11-04. |
| Q17 | A tela da chamada segue o tema escolhido: fundo do tema com as manchas da página, vidro do tema nos quadros, na barra de controles e nos painéis; vídeo e tela continuam sobre preto. Substitui o palco escuro em todos os temas que a chamada tinha desde a fase 2 da RFC 0002. Pedido do usuário em 2026-11-04. |
| Q18 | Sala só de voz (ninguém com câmera nem tela): cada pessoa aparece como a foto grande, com o nome embaixo e o selo de microfone fechado no canto da foto; a foto é o botão do volume dela. Com câmera ou tela, volta a grade de quadros. Comparado com a grade de quadros para todos (fotos dos dois em 2026-11-04); dois revisores independentes escolheram as fotos. A troca fica em `layoutSoVoz`, no `script.js`. |

### Fora do escopo

- Canal ou categoria privada (Q2).
- Arrastar para reordenar (Q8).
- Silenciar um canal só, menções, tópico do canal, canal de anúncios.
- Chat de texto dentro da sala de voz.

## 3. Proposta

### 3.1 Banco: `supabase/canais_projeto.sql`

**`project_channels`**: `id`, `project_id`, `tipo` (`categoria`, `texto`, `voz`),
`nome` (1 a 60 caracteres, sem espaço nas pontas), `categoria_id` (outra linha do
mesmo projeto, do tipo categoria; `on delete set null`), `posicao`, `created_at`.
`unique (id, project_id)` para as chaves compostas abaixo.

- **Leitura:** dono e membros aceitos (SEC-080).
- **Escrita:** dono e editores. `project_id` e `tipo` ficam fora do `grant update`:
  um canal não muda de projeto nem de tipo.
- **Gatilho `canal_validar`:** a categoria é do mesmo projeto e é categoria; no máximo
  100 itens por projeto.
- **Gatilho em `projects`:** todo projeto novo nasce com `#geral` e a sala Geral.
  Os projetos que já existem ganham os dois no próprio arquivo.

**`project_messages.canal_id`**, com chave estrangeira composta
`(canal_id, project_id)` para `project_channels (id, project_id)`, `on delete
cascade` (Q7). A mensagem nunca aponta para canal de outro projeto, nem por API
direta (SEC-081). `canal_id` entra no `grant insert` e fica fora do `grant update`.

- **Gatilho `mensagem_canal`:** texto só em canal de texto, linha de chamada só em
  sala de voz. Sem `canal_id`, que é o que a versão anterior do app manda, a mensagem
  vai para o primeiro canal do tipo certo: quem ainda não recarregou a página
  continua escrevendo no `#geral`.
- **Histórico:** as mensagens que já existem vão para o `#geral` (texto) e para a
  sala Geral (linhas de chamada).

**`project_channel_reads`** (`canal_id`, `project_id`, `user_id`, `lido_ate`): o
"até onde li" passa a ser por canal. Mesma regra do SEC-074, uma policy `for all` com
`user_id = auth.uid()` e acesso ao projeto (SEC-082). O `lido_ate` de cada pessoa em
`project_chat_reads` é copiado para o `#geral`, para ninguém ver o histórico inteiro
como não lido. `silenciado` continua em `project_chat_reads`.

**`contar_nao_lidas_canais()`**, `security invoker`, devolve
`(project_id, canal_id, n)`. A `contar_nao_lidas()` antiga fica, para a aba que ainda
não recarregou.

**Realtime:** `project_channels` entra na publicação `supabase_realtime`. Criar,
renomear ou apagar um canal chega a todos com o projeto aberto. O DELETE do Postgres
Changes não passa pelo RLS e traz só a chave primária: quem escuta fica sabendo o id
de um canal apagado, nada mais.

### 3.2 Chamada por sala

Nada muda no banco nem nas policies da chamada. No cliente:

- A Presence de quem está na chamada leva `sala`. Quem não manda `sala` (versão
  anterior do app) conta como estando na primeira sala de voz.
- `reconciliarChamada` só olha quem está na mesma sala: abre conexão com quem chega
  nela e fecha com quem sai dela, inclusive para outra sala.
- Sinal (oferta, resposta, ICE, pedir) de quem está em outra sala é ignorado. Antes,
  todo sinal chegava de quem estava na chamada; agora a sala é mais uma condição.
- **Trocar de sala** fecha as conexões da sala antiga, grava "Chamada encerrada" nela
  se a pessoa era a última, gera uma sessão nova (sinal atrasado da sala antiga não se
  mistura) e marca a sala nova na Presence. As faixas locais seguem: microfone, câmera
  e tela continuam como estavam.
- O "uma pessoa só uma vez" continua valendo para o projeto inteiro: duas abas da
  mesma conta não ficam em salas diferentes.

**O que isso não garante.** A separação por sala é do cliente, como era o limite de
4 pessoas (RFC 0002, seção 3.2). Todo mundo do projeto assina o mesmo tópico e um
cliente modificado vê a sinalização das outras salas. Isso já valia para quem estava
com o projeto aberto sem entrar na chamada, e qualquer pessoa do projeto pode entrar
em qualquer sala (Q2). O que o banco garante continua o mesmo: todos ali são do
projeto.

### 3.3 Na tela

- **Aba Canais** (a chave interna continua `chat`, para a aba guardada de cada projeto
  não se perder). A superfície de vidro do chat ganha uma coluna à esquerda com a
  lista; a conversa à direita é o chat de hoje, com o nome do canal no topo.
- **Lista:** canais sem categoria no topo; depois cada categoria, que recolhe e
  expande (guardado no aparelho). Recolhida, continua mostrando o canal aberto e as
  salas com gente. `#` antes dos canais de texto e o ícone de alto-falante nas salas,
  desenhados no mesmo traço dos outros ícones do app.
- **Editores** veem o + no topo da lista (canal de texto, sala de voz, categoria e,
  enquanto não houver categoria, o modelo de equipe), o + de cada categoria (canal
  nela) e, ao passar o mouse ou com o foco, o lápis de cada canal e categoria.
- **Diálogo do canal**, no formato do "Novo projeto" (`modal-rapido`): tipo (só ao
  criar), nome, categoria e lugar na lista; ao editar, também "Apagar".
- **Erros** no próprio diálogo, como no "Novo projeto", sem fechar nem perder o nome
  digitado (princípio 4 do PRODUCT.md). Fora do diálogo, por
  `showToast(..., 'erro')` (QUA-005).
- **O canal aberto fica guardado** no aparelho, para criar canais acima dele (o
  modelo de equipe põe `#avisos` no topo) não trocar a conversa de ninguém.
- **Montagem do HTML:** nome do canal e da categoria por `esc()` em todo lugar; o id
  vai para `onclick` só depois de passar pelo formato uuid.

### 3.4 Modelo de equipe

A estrutura da captura, com nomes genéricos (a pessoa renomeia depois):

| Categoria | Canais |
|---|---|
| Administração | `#avisos` |
| Comunicação Geral | `#geral` (o que já existe, com o histórico), `#drive`, `#músicas` |
| Reuniões | Geral (a sala que já existe), Em reunião, Sala 1 a Sala 5, Silêncio |
| Intervalo | `#intervalo`, sala Intervalo |

Só aparece enquanto o projeto não tem categoria nenhuma, para não duplicar nada.
Move o `#geral` e a sala Geral que existirem, em vez de criar outros.

## 4. Alternativas consideradas

- **Um tópico do Realtime por sala** (`chamada:<project_id>:<canal_id>`). Separa a
  sinalização de verdade e abriria caminho para sala privada. Exige mudar a função e
  as policies do SEC-075, e o cliente assinaria um tópico por sala só para mostrar
  quem está em cada uma. Fica para quando houver canal privado (Q2).
- **Canais na barra lateral do app**, embaixo de cada projeto. Mais parecido com o
  Discord, mas muda a navegação do app inteiro (Q4).
- **Tabela separada para categorias.** Duas tabelas, duas policies e duas
  assinaturas do realtime para a mesma lista. Um `tipo` a mais resolve.
- **Apagar canal mantendo as mensagens** (sem canal). Elas ficariam inacessíveis na
  tela e ocupando o banco.

## 5. Riscos

- **Repetir o SEC-045.** Mitigado pelo SEC-080 e SEC-082: toda policy nova passa por
  `is_project_owner`/`is_project_member`.
- **Mensagem em canal de outro projeto.** Barrado pela chave composta (SEC-081), não
  só pelo gatilho.
- **Editor apagando canal com histórico.** É o pedido (Q1 e Q7). A confirmação diz que
  as mensagens somem. Não há lixeira.
- **Rodar o SQL com o app aberto.** A cópia do histórico para o `#geral` é um UPDATE
  em cada mensagem, e cada um chega pelo realtime a quem está com o app aberto. A tela
  já trata UPDATE; num projeto com milhares de mensagens, rode fora do horário de uso.
- **Versões misturadas** enquanto alguém não recarrega a página: a versão anterior
  escreve no `#geral` (gatilho) e, na chamada, vê todas as salas como uma só. Ela
  tenta conectar com quem está em outra sala e é ignorada; recarregar resolve.
- **`script.js` crescer mais.** Os canais reaproveitam o chat e a chamada: a conversa
  passa a ser por canal, e a chamada ganha a sala. O bloco novo fica junto do chat,
  com nomes em português (QUA-004).

## 6. Plano

1. Specs SEC-080 a SEC-082 e revisão do SEC-071, SEC-074 e SEC-075 (esta RFC).
2. `supabase/canais_projeto.sql`, testado num Postgres local com dono, editor,
   visualizador, conta de fora e conta removida.
3. Front: aba Canais, diálogo do canal, modelo de equipe, salas na chamada e
   fallback sem a tabela.
4. Teste no navegador com o Supabase simulado: lista, troca de canal, celular a 375px.

**Estado em 2026-11-04.** Passos 1 a 4 e 7 feitos. O SQL passou em 38 casos num
Postgres 16 local (inclusive rodando duas vezes seguidas). No Chromium, com o
Supabase simulado, foram testados: o modelo de equipe, gente nas salas, não lidas
por canal, criar uma sala numa posição, renomear, o celular a 375px, os temas Vidro
e Grafite e o modo sem o SQL novo. Faltam os passos 5 e 6, que dependem do painel
do Supabase e de duas contas reais (a troca de sala com WebRTC de verdade não foi
testada).
5. Rodar o `canais_projeto.sql` no Supabase e conferir a verificação do fim do
   arquivo. Pode ser antes ou depois de publicar o código (Q15).
6. Teste com duas contas em salas diferentes e trocando de sala no meio da chamada.
7. `privacidade.html`: as mensagens agora dizem em que canal estão.
8. Tela da chamada nova (Q16 a Q18): lista de salas, tema, sala só de voz em fotos.
   Testada no Chromium com o Supabase simulado nos temas Vidro, Rosa, Menta e
   Grafite, no celular a 390px e na janela flutuante (o tema vai junto, inclusive
   trocado com ela aberta).
