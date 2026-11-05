# RFC 0006 — Fotos no chat, mensagens diretas e regras de cargo por área

- **Status:** proposta
- **Autor:** samyest
- **Data:** 2026-11-05
- **Specs afetadas:** [`docs/specs/seguranca.md`](../specs/seguranca.md) (SEC-080, SEC-084 e
  SEC-086 revistos; SEC-090 e SEC-091, novos)

## 1. Contexto

O pedido, numa lista de anotações:

- permitir mandar foto no chat;
- melhorar as bordas (o canto de dentro acompanhando o de fora);
- opção de mudar os cargos, como regra de cargo;
- mudar foto e nome do servidor, separados;
- criar e editar canais de texto e salas de voz, separados;
- a aba "Início" passa a se chamar "Visão geral";
- pressionar o título da lista de canais para mudar a ordem;
- mostrar na sala há quanto tempo ela está em ligação;
- tirar o botão "Iniciar chamada";
- chat privado entre duas pessoas.

Três itens mexem em segurança: a foto é um dado novo (e um arquivo), a mensagem direta é
uma conversa que nem o dono pode ver, e as regras novas dão a cargos que não são o dono
poder sobre nome, ícone, canais e cargos. Por isso esta RFC.

## 2. Objetivo

### Decisões

| # | Decisão |
|---|---|
| Q1 | Regras de cargo em grupos: **Pessoas** (`convidar`, `cargos`), **Projeto** (`nome`, `icone`), **Canais** (`texto`, `voz`) e **Salas de voz** (`silenciar`, `mover`). O dono tem todas, sempre; o bloco dele não tem interruptores. |
| Q2 | Padrão: o editor tem tudo menos `cargos` (era o que já fazia); o participante só `convidar`; o visualizador nada. Quem já tinha regras salvas para o editor ganha `nome`, `icone`, `texto` e `voz` uma vez só, na primeira vez que o SQL roda; depois vale o que o dono escolher. |
| Q3 | `cargos`: muda o cargo de quem está igual ou abaixo, só para cargo igual ou abaixo do seu, nunca o próprio. |
| Q4 | Canais por tipo: `texto` cria e mexe em canais de texto, `voz` em salas; categoria pede qualquer uma. O banco confere em `pode_mexer_no_canal`. |
| Q5 | Foto no chat: bucket privado `chat`, URL assinada de 1 hora, até 5 MB, PNG/JPG/WebP/GIF. O app reduz para no máximo 1600 px e converte para WebP (ou JPEG) antes de subir; o GIF vai como está. A legenda é o texto que estiver no campo. Colar uma imagem no campo também envia. |
| Q6 | Mensagem direta entre duas pessoas do projeto, como um canal `direta` privado com as duas na lista. Só as duas veem, nem o dono. Fica numa seção "Mensagens diretas" abaixo dos canais, com o + para escolher a pessoa, e no botão de mensagem ao lado de cada membro nas configurações. |
| Q7 | Arredondado concêntrico: peça encostada na borda de outra usa o raio de fora menos a folga. |
| Q8 | Organizar: tocar no título "Canais" liga um modo com alça em cada item, que arrasta no primeiro movimento; "Pronto" desliga. Segurar para arrastar continua valendo. |
| Q9 | Tempo em ligação: na linha da sala, desde quem entrou primeiro entre os que estão nela (na minha sala, o relógio da chamada). |
| Q10 | Nome dos cargos: o dono renomeia cada cargo do projeto ("Editor" vira "Moderador") clicando no nome, em Configurações → Cargos. Até 24 caracteres; vazio volta ao padrão, que aparece ao lado quando o nome é outro. O nome novo vale em todo o app: topo do projeto, barra lateral, membros, convites e listas. |

### Fora do escopo

- Mensagem direta em grupo (três ou mais pessoas): um canal privado já faz isso.
- Foto na chamada (só no chat de texto e na conversa direta).
- Vídeo e arquivo que não seja imagem.

## 3. Proposta

### 3.1 Banco: `supabase/configuracoes_projeto.sql`

A lista de regras válidas cresce para oito. `tem_permissao_voz` ganha os padrões novos.
`definir_cargo_membro` aceita quem tem `cargos` com as travas do Q3. `projects_update`
aceita dono, editor e quem tem `nome` ou `icone`; o gatilho `projeto_campos_por_regra`
confere campo por campo. `pode_mexer_no_canal(projeto, tipo)` resolve o Q4.

### 3.2 Banco: `supabase/salas_projeto.sql`

`tipo` aceita `direta`, sempre privada e sem categoria. `ve_canal` e as policies de
`project_channels` tratam a conversa direta à parte (só a lista, nem o dono), e as policies
de escrita recusam `direta` e usam `pode_mexer_no_canal`. `abrir_conversa_direta` acha a
conversa que já existe ou cria uma, com as duas pessoas na lista. Texto pode ir para
canal `direta`. O limite de 100 canais não conta as conversas diretas (que têm o seu, 500).

### 3.3 Banco: `supabase/imagens_no_chat.sql` (novo)

Coluna `imagem`, `check` do formato, gatilho do caminho, bucket privado `chat` e as
três policies de `storage.objects`. Roda depois do `salas_projeto.sql` (os dois definem
`msg_apagar`).

### 3.4 Na tela

- Configurações → Cargos: as regras em grupos; Membros: o cargo vira seletor para quem
  pode mudar, e cada pessoa ganha o botão de mensagem direta.
- Visão geral: nome e foto do projeto conferidos separados (`nome`, `icone`).
- Canais: o + mostra só os tipos que a pessoa pode criar; o diálogo trava o tipo que ela
  não pode; "Usar o modelo de equipe" pede as duas regras.
- Topo do projeto: sem "Iniciar chamada"; entra-se pela sala ou pela faixa.

## 4. Alternativas consideradas

- **Foto pública com link aleatório:** mais simples, mas o link vazaria para fora do
  projeto e de canais privados. Descartada.
- **Mensagem direta numa tabela própria:** duplicaria leitura, não lidas, realtime e
  apagar. O canal privado já tem tudo isso e a lista de duas pessoas.
- **Dono vendo as conversas diretas:** contraria o que a pessoa espera de "privado".

## 5. Riscos

- Arquivo órfão: quando o dono apaga a mensagem de outra pessoa, o arquivo fica no
  bucket (só quem enviou apaga). Continua legível só por quem vê o canal.
- O relógio da sala usa o horário do aparelho de quem entrou; com relógio errado, o tempo
  sai torto (nunca negativo).

## 6. Plano

1. Rodar de novo `configuracoes_projeto.sql` e `salas_projeto.sql`, e rodar
   `imagens_no_chat.sql` (nessa ordem).
2. Conferir a linha final de cada um (tudo `true`).
3. Publicar o app.
