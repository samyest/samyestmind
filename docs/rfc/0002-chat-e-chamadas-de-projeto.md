# RFC 0002 — Chat e chamadas de projeto

- **Status:** proposta
- **Autor:** samyest
- **Data:** 2026-10-26
- **Specs afetadas:** [`docs/specs/seguranca.md`](../specs/seguranca.md) (SEC-070 a SEC-079, novos)

## 1. Contexto

O pedido: "quando criar projetos, tem opção de chat e após isso fazer chamadas online
com a opção de câmera e transmissão de tela".

Hoje um projeto compartilhado tem quadro, calendário, notas e comentários por tarefa.
A conversa sobre o projeto acontece fora do app. O que no código pesa nesta proposta:

- **Acesso a projeto** é ser dono (`projects.owner_id`) ou membro aceito
  (`project_members.status = 'accepted'`, papel `editor` ou `viewer`). Todo RLS de
  projeto passa por `is_project_owner()` e `is_project_member()`.
- **Dois furos recentes no mesmo modelo.** SEC-044: convite pendente legível por
  qualquer membro. SEC-045, ainda aberto: tarefa e comentários continuam visíveis para
  quem os criou depois que a pessoa sai do projeto, porque a policy aceita
  `user_id = auth.uid()`. O chat não pode ter esse atalho.
- **Realtime.** O app já usa Postgres Changes em dois canais (`app-changes` e
  `notas-projeto`). Esse modo reconfere o RLS de SELECT a cada mudança.
- **Cabeçalhos.** `vercel.json` bloqueia câmera e microfone
  (`Permissions-Policy: camera=(), microphone=()`).
- **Cadastro aberto.** Qualquer conta cria um projeto e vira dona dele. "É membro do
  projeto" não basta para filtrar abuso de um recurso pago.
- **`render()` reescreve a área principal inteira.** Nada que precise sobreviver a uma
  troca de tela, como um `<video>` de chamada, pode morar dentro dela.
- **As funções de `api/` são serverless na Vercel** e não seguram WebSocket. A
  sinalização da chamada precisa de outro meio.

## 2. Objetivo

Dar a cada projeto um chat persistente e, numa segunda fase, chamadas de voz e vídeo
com transmissão de tela para até 4 pessoas, sem abrir acesso a ninguém de fora do
projeto e sem custo fixo novo.

### Decisões

Fechadas em duas rodadas de entrevista em 2026-10-26.

| # | Decisão |
|---|---|
| Q1 | Todo projeto tem chat, inclusive os que já existem. Não há opção para desligar. |
| Q2 | Uma RFC, duas fases: primeiro o chat; as chamadas depois que o chat estiver em uso. |
| Q3 | Histórico persistente, sem prazo, apagado junto com o projeto. |
| Q4 | O dono e todo membro aceito escrevem, inclusive o visualizador. O "só leitura" continua valendo para tarefas, colunas e notas. |
| Q5 | Só texto, com links `https` clicáveis. Sem anexos. |
| Q6 | O autor apaga a própria mensagem e o dono apaga qualquer uma. O texto é zerado no banco e fica "mensagem apagada". Ninguém edita. |
| Q7 | Contador de não lidas mais notificação do navegador com o app aberto. O "até onde li" fica salvo no banco, por pessoa. |
| Q8 | Até 4 pessoas, em malha P2P. |
| Q9 | TURN da Cloudflare (Realtime TURN). |
| Q10 | Sem gravação. |
| Q11 | O dono e qualquer membro aceito, inclusive o visualizador, iniciam e entram. |
| Q12 | O chat é uma aba "Chat" do projeto, depois de Notas. |
| Q13 | Até 4.000 caracteres por mensagem e 20 mensagens por minuto por pessoa, as duas regras no banco. |
| Q14 | As mensagens de quem saiu ficam, e o autor aparece como "Ex-membro". |
| Q15 | A notificação mostra "Ana em Projeto X" e os 100 primeiros caracteres. |
| Q16 | Cada pessoa pode silenciar o chat de um projeto: o contador continua, a notificação para. |
| Q17 | Menções, reações, respostas encadeadas, busca e "digitando…" ficam fora. |
| Q18 | Botão "Iniciar chamada". Quem está com o app aberto recebe aviso e notificação. O chat registra "Chamada iniciada" e "Chamada encerrada · 32 min". Uma chamada por projeto por vez. |
| Q19 | A 5ª pessoa vê "Chamada cheia (4 de 4)" e não entra. |
| Q20 | A transmissão de tela substitui a câmera de quem transmite. Uma transmissão por vez. |
| Q21 | A chamada fica numa janela flutuante que continua aberta enquanto a pessoa navega pelo app. |
| Q22 | Prévia antes de entrar. O padrão é microfone ligado e câmera desligada. |
| Q23 | A credencial TURN vale 1 hora e é renovada aos 45 minutos, com nova conferência de acesso. |
| Q24 | No máximo 20 credenciais TURN por hora por pessoa, e só para projeto com pelo menos 2 pessoas. |
| Q25 | Conexão direta sempre que der. O IP público fica visível para quem está na chamada. |

### Fora do escopo

- Anexos. Imagem pode virar uma fase 3 se fizer falta.
- Menções, reações, respostas encadeadas, busca, "digitando…" e edição de mensagem.
- Notificação com o app fechado (Web Push: service worker, chaves VAPID, função de
  envio). Pede uma RFC própria.
- Gravação. Se um dia vier, começa por RFC (SEC-079).
- Chamadas com mais de 4 pessoas, que exigiriam um SFU (seção 4).
- Chat ou chamada fora de projeto, como uma conversa 1:1 pessoal.

## 3. Proposta

### 3.1 Fase 1 — Chat

**Na tela.** Aba "Chat" depois de Notas, na barra de abas do projeto. O contador de
não lidas aparece na aba e no projeto, em todo lugar onde a lista de projetos é
exibida. As mensagens ficam agrupadas por autor e por dia. Quem não divide mais
projeto com você aparece como "Ex-membro": o perfil some sozinho pelo RLS de
`profiles` (`shares_project_with`). Uma mensagem apagada vira "mensagem apagada", e
as linhas de chamada aparecem como linhas de sistema.

**Banco: `supabase/chat_projeto.sql`.** Esboço; o arquivo final segue o formato dos
outros `.sql`, com cabeçalho, blocos explicando o risco e verificação no fim.

```sql
create table if not exists public.project_messages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  author_id   uuid default auth.uid() references auth.users(id) on delete set null,
  kind        text not null default 'texto'
              check (kind in ('texto', 'chamada_inicio', 'chamada_fim')),
  body        text not null default '' check (char_length(body) <= 4000),
  duracao_seg integer check (duracao_seg >= 0),
  created_at  timestamptz not null default now(),
  apagada_em  timestamptz,
  check (kind <> 'texto' or apagada_em is not null or char_length(btrim(body)) > 0)
);
alter table public.project_messages enable row level security;

-- Autoria e data quem põe é o banco (SEC-071): ficam fora do grant de INSERT,
-- e o UPDATE só alcança as colunas usadas para apagar.
revoke insert, update, delete on public.project_messages from anon, authenticated;
grant insert (project_id, kind, body, duracao_seg) on public.project_messages to authenticated;
grant update (body, apagada_em) on public.project_messages to authenticated;

-- Sem atalho por autor (SEC-070): quem sai do projeto perde tudo na hora.
create policy msg_select on public.project_messages for select to authenticated
  using (is_project_owner(project_id) or is_project_member(project_id));

create policy msg_insert on public.project_messages for insert to authenticated
  with check (
    author_id = auth.uid() and apagada_em is null
    and (is_project_owner(project_id) or is_project_member(project_id))
  );

-- UPDATE só serve para apagar: o texto vira '' e não volta.
create policy msg_apagar on public.project_messages for update to authenticated
  using (
    apagada_em is null
    and (is_project_owner(project_id)
         or (author_id = auth.uid() and is_project_member(project_id)))
  )
  with check (body = '' and apagada_em is not null);
-- Sem policy de DELETE: a mensagem só some com o projeto.
```

Mais três peças no mesmo arquivo:

- **Gatilho `before insert`** que recusa a 21ª mensagem do mesmo `auth.uid()` em 1
  minuto (SEC-073), com índice em `(author_id, created_at desc)`.
- **`project_chat_reads`** (`project_id`, `user_id default auth.uid()`, `lido_ate`,
  `silenciado`, chave primária nos dois ids). Uma única policy `for all`:
  `user_id = auth.uid()` e dono ou membro aceito do projeto, em `using` e em
  `with check` (SEC-074). Quem nunca abriu o chat de um projeto não tem linha, e
  então todo o histórico conta como não lido. Para quem acabou de entrar, isso é
  "chegou e tem 40 mensagens para ler".
- **`contar_nao_lidas()`**, função `security invoker` (o RLS vale) que devolve
  `(project_id, n)`. Ela conta as mensagens dos outros posteriores a `lido_ate`, e a
  tela mostra "99+" acima de 99.

Para o realtime, `project_messages` entra na publicação `supabase_realtime`. O front
assina num canal próprio (`chat-projeto`), ligado só depois que a tabela respondeu,
como `ligarRealtimeNotas()` já faz. Postgres Changes reconfere o RLS de SELECT a cada
mensagem e para cada assinante, então quem é removido do projeto para de receber na
hora. Apagar é UPDATE e chega pelo mesmo canal.

**Montagem do HTML** (SEC-072):

1. `esc()` no corpo, antes de qualquer outra coisa.
2. Links reconhecidos no texto já escapado, só `https://`, viram
   `<a href="…" target="_blank" rel="noopener noreferrer">`.
3. Quebra de linha por `white-space: pre-wrap`; nada de montar `<br>`.

Nome do autor e nome do projeto também passam por `esc()`.

**Notificação.** Sai só com `document.hidden` e o projeto não silenciado:
`new Notification('Ana em Projeto X', {body: trecho, tag: 'chat-<project_id>'})`.
A API de notificação recebe texto puro e não interpreta HTML. O app já pede essa
permissão para os alarmes.

**Erros.** Falha de escrita avisa com `showToast(..., 'erro')` (QUA-005). O limite de
20 por minuto tem mensagem própria ("Calma: muitas mensagens seguidas").

### 3.2 Fase 2 — Chamadas

**Topologia.** Malha P2P de até 4 pessoas: cada participante mantém um
`RTCPeerConnection` com cada um dos outros.

**Sinalização.** Broadcast e Presence do Supabase Realtime, no canal privado
`chamada:<project_id>`:

- **Presence.** A chave é o user id, e o estado é `{em_chamada, camera, mic, tela}`.
  Quem está com o projeto aberto assina o canal sem entrar na chamada, para ver a
  faixa "Chamada em andamento · 2 pessoas · Entrar".
- **Broadcast.** Um evento `sinal` com `{de, para, tipo, dados}`, em que `tipo` é
  `oferta`, `resposta` ou `ice` (trickle ICE). Cada cliente ignora o que não é para
  ele. A negociação segue o padrão *perfect negotiation*: o participante de menor user
  id faz o papel "educado".

**Autorização do canal** (SEC-075). As policies ficam em `realtime.messages`:

```sql
-- Valida o formato do tópico antes do cast: tópico malformado vira false, não erro.
create or replace function public.pode_usar_canal_chamada(p_topico text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare v_id uuid;
begin
  if p_topico !~ '^chamada:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_id := substring(p_topico from 9)::uuid;
  return is_project_owner(v_id) or is_project_member(v_id);
end $$;

create policy chamada_receber on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence')
         and public.pode_usar_canal_chamada(realtime.topic()));

create policy chamada_enviar on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence')
              and public.pode_usar_canal_chamada(realtime.topic()));
```

O `.sql` **não** pode ter `alter table realtime.messages enable row level security`:
o RLS já vem ligado, e o comando falha por não sermos donos da tabela, abortando o
resto do arquivo.

Para o canal privado valer, a documentação do Supabase manda desligar "Allow public
access" nas configurações do Realtime. Não está confirmado o que isso faz com
`app-changes` e `notas-projeto`. Por isso a fase 2 começa por um teste (seção 6, passo
6) que responde a duas perguntas:

- Uma conta de fora do projeto é recusada em `chamada:<id>`?
- Os canais atuais precisam virar privados, com policy própria?

**A permissão do canal fica em cache.** O Realtime confere a policy ao entrar no
canal e guarda o resultado até o JWT vencer (1 hora no Supabase). Quem é removido no
meio da chamada continuaria recebendo os sinais. Por isso (SEC-076):

- A validade do JWT do Supabase fica em 1 hora, o padrão. Não aumentar.
- Os clientes já escutam `project_members` pelo `app-changes`. Quando a lista muda,
  cada participante fecha na hora a conexão com quem não é mais dono nem membro
  aceito, e passa a ignorar sinal desse user id.
- O cliente de quem saiu, ao recarregar a lista, deixa a chamada e para câmera e
  microfone.
- A credencial TURN de quem saiu deixa de ser renovada (3.3).

**Entrar numa chamada:**

1. "Iniciar chamada" (no topo do projeto) ou "Entrar" (na faixa ou no aviso).
2. Prévia: só agora o app pede câmera e microfone (`getUserMedia` depois do clique,
   SEC-078). Microfone ligado, câmera desligada.
3. Busca a credencial em `api/chamada/turn` (3.3). Se falhar, segue só com o STUN
   (`stun.cloudflare.com`, gratuito) e avisa que em algumas redes a chamada pode não
   conectar.
4. Entra na Presence com `em_chamada: true`. Com 4 pessoas já na chamada, mostra
   "Chamada cheia (4 de 4)".
5. O primeiro a entrar grava `chamada_inicio` no chat, e o último a sair grava
   `chamada_fim` com `duracao_seg`. Se o último cair sem sair, a linha de fim não
   aparece; fica assim nesta versão.
6. A linha `chamada_inicio` chega pelo canal do chat a todo membro com o app aberto,
   que vê o aviso "Ana iniciou uma chamada em Projeto X · Entrar" e, se não
   silenciou o projeto, a notificação do navegador. Nenhum canal novo é preciso para
   avisar.

O limite de 4 pessoas e o "uma transmissão por vez" moram no cliente, e um cliente
modificado os ignora. Não são controle de acesso. O que o banco garante é que todos ali
são do projeto.

**Janela da chamada.** Elemento fixo preso ao `body`, fora do container que `render()`
reescreve, como o `alarm-banner`. A janela minimiza, expande e vai para tela cheia, e
tem botões de microfone, câmera, tela e sair:

- **Tela.** O botão só aparece se `navigator.mediaDevices.getDisplayMedia` existir (no
  celular ele some). A tela entra no lugar da câmera por `replaceTrack`; ao parar,
  volta a câmera se ela estava ligada.
- **Sair.** Para todas as faixas com `track.stop()`, para o indicador de câmera do
  sistema apagar, fecha as conexões e sai da Presence. Fechar a aba faz o mesmo pelo
  `pagehide`.

**Nomes.** O nome de cada participante vem do perfil, pelo user id. O campo `de` da
sinalização é declarado pelo próprio cliente (seção 5).

### 3.3 Credencial TURN

Serviço: Cloudflare Realtime TURN. Rota `api/chamada/turn.mjs`, `POST
{project_id}`:

1. `allowMethods(['POST'])` e `userFromRequest()` (SEC-030, SEC-031).
2. `project_id` validado como uuid (SEC-035).
3. Com o token da própria pessoa, para o RLS valer, a rota confere que o projeto está
   visível para ela e tem pelo menos 2 pessoas (o dono e um membro aceito).
4. Limite de 20 emissões por pessoa por hora, contadas na tabela `turn_emissoes`. A
   tabela tem RLS ligado, nenhuma policy e nenhum grant para `anon` e
   `authenticated`, o mesmo modelo da `google_credentials`. Acima do limite, responde
   429.
5. Chama
   `POST https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers`
   com `Authorization: Bearer $TURN_KEY_API_TOKEN` e `{"ttl": 3600}`.
6. Responde só `{iceServers, expira_em}`. Erro sai por `fail()` (SEC-032).

**Renovação.** Aos 45 minutos de chamada, o cliente chama a rota de novo e aplica o
resultado com `setConfiguration()` em cada conexão. Pela documentação da Cloudflare,
uma credencial vencida derruba a conexão que passa pelo TURN pouco depois de vencer.
Então, além de ser desconectado pelos outros participantes, quem perdeu o acesso perde
o TURN em até 1 hora.

**Segredos.** `TURN_KEY_ID` e `TURN_KEY_API_TOKEN` ficam só nas variáveis da Vercel.
Quando a fase 2 entrar, os dois vão para a tabela de variáveis do README e o
`TURN_KEY_API_TOKEN` vai para a lista do SEC-001, da regra do `CLAUDE.md` e do
verificador.

**Custo.**

- Preço: 1.000 GB por mês grátis, divididos entre TURN e SFU; depois, US$ 0,05 por GB.
  Não há teto de gasto.
- Pior caso: um vídeo a 1,5 Mbps gasta cerca de 0,7 GB por hora. Com tudo passando
  pelo TURN, uma chamada a dois gasta cerca de 1,4 GB por hora, e a quatro cerca de
  8 GB por hora, o que deixa a franquia em umas 125 horas por mês.
- Na prática, a maioria das conexões vai direto e não passa pelo TURN.
- Conferir o uso no painel da Cloudflare uma vez por mês.

### 3.4 Cabeçalhos e CSP

- **`Permissions-Policy`:** passa a
  `camera=(self), microphone=(self), display-capture=(self), geolocation=(), interest-cohort=()`.
- **CSP:** sem mudança.
  - A rota TURN é `'self'`.
  - O Realtime já está no `connect-src` (`wss://*.supabase.co`).
  - O tráfego ICE e TURN do WebRTC não passa pelo `connect-src`.
  - `<video>` com `srcObject` não é carregamento por URL.
- **Conferir no navegador** com a CSP de produção (QUA-040).

### 3.5 Privacidade

`privacidade.html` ganha:

- **Mensagens do chat.** Ficam guardadas enquanto o projeto existir, e só os membros
  as veem. Apagar zera o texto.
- **Cloudflare na tabela de serviços.** Repassa o áudio e o vídeo quando a conexão
  direta não é possível, e não grava.
- **IP na chamada.** O IP público de cada participante fica visível para os outros
  participantes.
- **Gravação.** Nada é gravado.

## 4. Alternativas consideradas

- **Chat efêmero, só por Broadcast.** Quem estava fora do app perderia a conversa
  (Q3).
- **Chat por Broadcast disparado do banco (`realtime.broadcast_changes`)** em vez de
  Postgres Changes. Escala melhor, mas exige canal privado e policy em
  `realtime.messages` já na fase 1. Postgres Changes é o padrão do app (notas) e
  reconfere o RLS a cada mensagem. Fica como saída se o volume crescer.
- **SFU (LiveKit, Daily, Cloudflare Realtime SFU)** para mais de 4 pessoas. Traz custo
  e dependência novos. Se for preciso, o SFU da Cloudflare é a saída natural: mesma
  conta e mesma franquia do TURN.
- **TURN da Twilio ou coturn próprio.** A Twilio cobra desde o primeiro GB e exige
  conta nova. O coturn exige servidor fixo pago e manutenção (Q9).
- **Sinalização por `api/` com polling.** A Vercel não segura WebSocket, e o polling
  acrescenta atraso e invocações. O Realtime já está na stack.
- **Forçar tudo pelo TURN para esconder o IP.** Toda chamada gastaria franquia e
  ficaria mais lenta (Q25).
- **Link do Google Meet no evento do projeto.** O app já fala com o Google Calendar,
  mas a chamada sairia do app, e só funcionaria para quem conectou o Google. O pedido
  é chamada dentro do projeto.

## 5. Riscos

- **Repetir o SEC-045 no chat.** Mitigado pelo SEC-070, pela ausência de policy por
  autor e pelo teste no navegador com uma conta removida.
- **Permissão de canal em cache até o JWT vencer.** Mitigado por: participantes
  derrubam a conexão com quem saiu na hora; JWT continua com 1 hora; TURN sem
  renovação (SEC-076, SEC-077).
- **TURN usado como intermediário grátis, sem teto de gasto.** Mitigado pelas regras
  do SEC-077 (projeto com 2 pessoas, 20 por hora, validade de 1 hora), pela revogação
  de credencial pela API da Cloudflare e pela conferência mensal do uso. Quem cria duas
  contas ainda passa; o limite reduz o estrago, não o zera.
- **Desligar "Allow public access" quebrar os canais atuais.** Mitigado pelo teste no
  início da fase 2, feito antes de mexer no painel de produção.
- **Identidade na sinalização declarada pelo cliente.** Um membro pode se apresentar
  como outro membro dentro da chamada. Aceito nesta versão: fica restrito a pessoas
  do projeto, e o RLS impede que alguém de fora entre.
- **Malha em rede fraca.** Com 4 pessoas de câmera ligada no 4G, a chamada degrada.
  Mitigado pela câmera desligada por padrão e pela tela no lugar da câmera.
- **Safari e iOS.** O WebRTC funciona, mas o áudio só toca depois de um gesto, e a
  entrada já é por clique. Transmissão de tela não existe no celular.
- **`script.js` crescer mais.** Chat e chamada seguem os padrões que já existem
  (QUA-004). A malha fica num bloco próprio, com nomes em português.

## 6. Plano

**Fase 1 — chat**

1. Specs SEC-070 a SEC-079 (esta RFC).
2. Rodar `supabase/chat_projeto.sql` no Supabase e conferir a verificação do fim do
   arquivo.
3. Front: aba Chat, contador, notificação e silenciar.
4. Guardião: verificador, revisão do SEC-070 ao SEC-074 e teste no navegador com duas
   contas, uma delas removida do projeto no meio da conversa.
5. `privacidade.html`: chat.

O SEC-045 não bloqueia o chat, porque as tabelas são outras. Mas vale corrigi-lo antes
da fase 1, para ninguém usar a policy errada das tarefas como modelo.

**Fase 2 — chamadas**

6. Teste do Realtime privado: canal `chamada:<id>` com as policies acima. Confirmar
   que uma conta de fora do projeto é recusada e ver o efeito de "Allow public access"
   em `app-changes` e `notas-projeto`. O resultado fica registrado nesta RFC.
7. Conta na Cloudflare, chave TURN e variáveis na Vercel. Rodar
   `supabase/chamadas.sql`, com a função do tópico, as policies em `realtime.messages`
   e `turn_emissoes`.
8. Rota `api/chamada/turn.mjs` e `Permissions-Policy` no `vercel.json`. Atualizar
   README, `CLAUDE.md` e SEC-001 com o segredo novo. O verificador ganha as checagens
   automáticas do SEC-078 e do SEC-079 e o padrão `TURN_KEY_API_TOKEN` no SEC-001.
9. Front: prévia, janela flutuante, malha, tela, renovação do TURN e saída quando a
   pessoa é removida.
10. Teste com 2 a 4 navegadores em redes diferentes, incluindo 4G (que força o TURN)
    e Safari.
11. `privacidade.html`: Cloudflare, IP visível e ausência de gravação.
