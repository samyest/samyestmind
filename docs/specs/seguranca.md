# Spec — Segurança

Requisitos de segurança do samyestmind. Ids são estáveis: não renumere, marque como
`removido` quando um deixar de valer. Verificação: `auto` = `scripts/verificar.mjs`;
`revisão` = agente guardião lendo o código; `navegador` = teste no site rodando.

## Segredos

### SEC-001 — Segredos só em variável de ambiente
`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, `OAUTH_STATE_SECRET` e
`TURN_KEY_API_TOKEN` nunca aparecem em arquivo versionado nem em código que chega ao
navegador.
**Por quê:** a service role ignora todo o RLS; o client secret permite se passar
pelo app no Google; o token TURN gera credenciais à vontade na conta da Cloudflare. **Verificação:** auto (nenhum valor com cara de segredo em
arquivo versionado; `.env*` no `.gitignore`).

### SEC-002 — Navegador só conhece a chave publicável
O front usa apenas `SUPABASE_URL` e a chave publicável/anon. **Por quê:** é a única
chave feita para ser pública; tudo depende do RLS. **Verificação:** auto.

### SEC-003 — Refresh token do Google nunca sai de `api/`
Nenhuma resposta de `api/` inclui `refresh_token`. **Por quê:** ele dá acesso
indefinido à agenda. **Verificação:** auto (grep nas respostas `json(...)`) + revisão.

## XSS e montagem de HTML

### SEC-010 — Texto do usuário passa por `esc()`
Todo valor vindo do banco, do Google ou de input interpolado num template HTML usa
`esc()`. **Por quê:** tarefas, projetos e notas são compartilhados; um título com
`<script>` rodaria no navegador de todos os membros. **Verificação:** revisão
(o verificador lista interpolações suspeitas em `innerHTML` como aviso).

### SEC-011 — Cores por `corSegura()`, colunas por `normalizarColunas()`
Cor interpolada em `style=` passa por `corSegura()`. Colunas (pessoais ou de projeto)
só são usadas depois de `normalizarColunas()`. **Por quê:** a chave de coluna vai
crua para dentro de `onclick`. **Verificação:** revisão.

### SEC-012 — CSP sem `'unsafe-inline'` em `script-src` *(dívida)*
**Por quê:** com `'unsafe-inline'`, qualquer XSS que escape do `esc()` executa.
**Estado:** não atendido — o app usa ~150 handlers `onclick=` inline.
**Verificação:** auto, como aviso até a dívida ser paga.

### SEC-013 — Sem `eval`, `new Function`, `setTimeout(string)`
**Verificação:** auto.

### SEC-014 — URLs em `href`/`src` validadas
URL vinda de dado (avatar, link de evento) só entra em atributo se for `https:` ou
`blob:`/`data:image`. **Por quê:** `javascript:` em `href` é XSS. **Verificação:** revisão.

### SEC-015 — Notas de projeto sanitizadas por lista de permissão
HTML rico das notas passa pelo sanitizador com tags e atributos permitidos
explícitos. **Verificação:** revisão.

## Dependências de terceiros

### SEC-020 — Script externo com versão fixa e SRI
Todo `<script src="https://...">` tem versão exata, `integrity` e
`crossorigin="anonymous"`. **Por quê:** release nova ou CDN comprometida entraria
no app no mesmo dia. **Verificação:** auto.

## API serverless (`api/`)

### SEC-030 — Identidade sempre derivada do token
Toda rota que age em nome de alguém chama `userFromRequest()` e responde 401 sem
usuário. `user_id` vindo do cliente nunca é usado. **Verificação:** auto (rota sem
`userFromRequest` exceto `callback`) + revisão.

### SEC-031 — Métodos permitidos explícitos
Toda rota, exceto `callback`, chama `allowMethods()`. **Verificação:** auto.

### SEC-032 — Erro genérico para o cliente
Rota responde erro por `fail()`; `e.message` nunca vai para o corpo da resposta.
**Verificação:** auto + revisão.

### SEC-033 — State OAuth assinado e com validade
O `state` é HMAC-SHA256 com expiração e comparado com `timingSafeEqual`.
**Verificação:** revisão.

### SEC-034 — Redirect só para a origem configurada
`Location` é montado de `appOrigin()`; header `x-forwarded-host` só passa se tiver
forma de hostname. **Por quê:** open redirect pós-login. **Verificação:** revisão.

### SEC-035 — Entrada validada em tipo e tamanho
Campos aceitos de `PATCH`/`POST` têm tipo e tamanho máximo checados.
**Verificação:** revisão.

### SEC-036 — State OAuth amarrado ao navegador
O `state` carrega um nonce que também vai num cookie `HttpOnly; Secure;
SameSite=Lax`, e o callback confere os dois. **Por quê:** hoje o state só prova
*quem pediu*, não *quem consentiu*. Um usuário logado pode mandar a própria URL de
consentimento para outra pessoa; se ela aprovar, o refresh token dela é gravado na
conta de quem mandou. **Verificação:** revisão. *(Achado da rodada de 2026-10-24.)*

## Banco (Supabase)

### SEC-040 — RLS ligado em toda tabela de `public`
Toda `create table public.x` tem `enable row level security` no mesmo arquivo ou em
correção posterior. **Verificação:** auto.

### SEC-041 — Nenhuma policy `using (true)` ativa para escrita ou dado privado
**Verificação:** auto (aviso) + revisão de qual arquivo corrige.

### SEC-042 — `security definer` com `search_path` fixo
**Por quê:** sem ele, a função resolve nomes pelo caminho de quem chama.
**Verificação:** auto.

### SEC-043 — `google_credentials` sem acesso de `anon`/`authenticated`
Só a service role lê e escreve. **Verificação:** revisão + `inspecionar_schema.sql`.

### SEC-044 — Convite pendente só é legível pelo dono e pelo convidado *(atendido em `supabase/convites_pendentes.sql`)*
`code` e `invited_email` de uma linha `pending` em `project_members` não são
legíveis por outros membros. **Por quê:** a policy `members_select` libera a linha
para qualquer membro aceito. Um visualizador lê o código de um convite de editor,
resgata com uma segunda conta por `accept_invite_by_code` e ganha edição no projeto.
**Verificação:** revisão. *(Achado da rodada de 2026-10-24.)*

### SEC-045 — Tarefa de projeto segue o acesso ao projeto *(atendido em `supabase/tarefas_projeto_acesso.sql`)*
Tarefa com `project_id` só é visível para o dono e os membros aceitos do projeto,
inclusive para quem a criou. O mesmo vale para os comentários dela. **Por quê:**
`tasks_select` e as policies de `task_comments` aceitam `user_id = auth.uid()`, e
quem é removido do projeto continua lendo e comentando, até pelo realtime.
**Verificação:** revisão. *(Achado da rodada de 2026-10-24.)*

### SEC-046 — Código de convite expira e tem limite de tentativas *(não atendido)*
**Por quê:** hoje o código fica pendente para sempre e `accept_invite_by_code`
aceita chamadas ilimitadas de qualquer conta logada. **Verificação:** revisão.

### SEC-047 — Colunas de autoria não mudam em UPDATE *(não atendido)*
`author_id`/`user_id` ficam fixos depois do INSERT. **Por quê:** `notes_update` não
fixa `author_id`; um editor pode atribuir a nota a outra pessoa.
**Verificação:** revisão.

## Cabeçalhos HTTP

### SEC-050 — Cabeçalhos de segurança na Vercel
`vercel.json` define `Content-Security-Policy`, `X-Content-Type-Options`,
`X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, e
`Cache-Control: no-store` em `/api/`. **Verificação:** auto.

## Autenticação no front

### SEC-060 — Nada sensível em `localStorage` além da sessão do Supabase
Access token do Google não é persistido em `localStorage`. **Verificação:** revisão.

### SEC-061 — Fluxo de redefinição de senha não vaza existência de conta
A mensagem é a mesma para email cadastrado ou não. **Verificação:** navegador.

## Chat e chamadas de projeto

Requisitos da [RFC 0002](../rfc/0002-chat-e-chamadas-de-projeto.md). Cada um diz em
que fase entra. Até lá, valem como critério de revisão para o código que implementar
a fase.

### SEC-070 — Mensagem de chat segue o acesso ao projeto *(fase 1, atendido em `supabase/chat_projeto.sql`; falta aplicar no Supabase)*
`project_messages` só é legível pelo dono e pelos membros aceitos do projeto, e só
eles escrevem nela. Nenhuma policy aceita `author_id = auth.uid()` sem também exigir
acesso ao projeto. Quem sai do projeto perde na hora a leitura, a escrita e o
"apagar" das próprias mensagens. **Por quê:** é o furo do SEC-045. A policy de
tarefas aceita quem criou a tarefa, e a pessoa removida continua lendo, até pelo
realtime. No chat, seria a conversa inteira do projeto. **Verificação:** revisão
(toda policy de `project_messages` passa por `is_project_owner`/`is_project_member`)
+ navegador (conta removida não lê nem recebe mensagem nova).

### SEC-071 — Autoria, projeto e data da mensagem são fixados pelo banco *(fase 1, atendido em `supabase/chat_projeto.sql`; falta aplicar no Supabase)*
`author_id` vem de `auth.uid()` e `created_at` de `now()`, e as duas colunas ficam
fora do `grant insert`. `autor_nome` (o nome de quem escreveu, para a mensagem
continuar assinada depois que a pessoa sai do projeto) vem do próprio perfil do autor,
por gatilho, e também fica fora dos grants (`supabase/autor_das_mensagens.sql`).
Nenhuma delas, nem `project_id` nem `canal_id` (RFC 0004), tem
`grant update`. UPDATE só
serve para apagar: o `with check` exige `body = ''` e `apagada_em` preenchido. Não
existe DELETE pela API. **Por quê:** é o SEC-047 valendo desde o primeiro dia. Sem
isso, um membro assina mensagem em nome de outro, data mensagem no passado ou troca o
texto de alguém. **Verificação:** revisão.

### SEC-072 — Texto da mensagem passa por `esc()`, e link só com `https:` *(fase 1, atendido em `script.js`, em `textoChatHtml()`)*
O corpo da mensagem passa por `esc()` antes de qualquer transformação. Os links são
reconhecidos depois do escape, só com `https://`, e viram `<a>` com
`rel="noopener noreferrer"` e `target="_blank"`. Quebra de linha vem do CSS
(`white-space: pre-wrap`), não de `<br>` montado. Nomes de autor, de projeto e de
participante da chamada também passam por `esc()`. A notificação do navegador
recebe texto puro. **Por quê:** o chat é o texto mais livre do app e chega em tempo
real ao navegador de todos os membros. **Verificação:** revisão (a heurística do
SEC-010 já cobre `.body`).

### SEC-073 — Limites de mensagem no banco *(fase 1, atendido em `supabase/chat_projeto.sql`; falta aplicar no Supabase)*
Um `check` limita o corpo a 4.000 caracteres e recusa texto vazio. Um gatilho recusa
a 21ª mensagem da mesma pessoa em 1 minuto. **Por quê:** a tela limita, mas a chave
pública permite chamar a API direto, e um membro inundaria o chat e as notificações
de todos. **Verificação:** revisão.

### SEC-074 — "Até onde li" e "silenciado" são só da própria pessoa *(fase 1, atendido em `supabase/chat_projeto.sql`; falta aplicar no Supabase)*
`project_chat_reads` só aceita linha com `user_id = auth.uid()` em projeto do qual a
pessoa é dona ou membro aceito, tanto para ler quanto para escrever. A contagem de
não lidas é função `security invoker`. Com os canais (RFC 0004), o "até onde li" por
canal segue a mesma regra no SEC-082. **Por quê:** a linha revela quando cada
pessoa abriu o chat, e uma contagem `security definer` contaria mensagens de projeto
alheio. **Verificação:** revisão.

### SEC-075 — Sinalização da chamada só em canal privado autorizado pelo projeto *(fase 2, atendido em `supabase/chamadas.sql`; falta aplicar no Supabase e o teste do passo 6 da RFC)*
O canal `chamada:<project_id>` é criado com `private: true`. As policies em
`realtime.messages` (Broadcast e Presence, para receber e para enviar) só deixam
passar o dono e os membros aceitos daquele projeto, e o formato do tópico é validado
antes do cast para uuid. Além disso, vale uma de duas: o acesso público do Realtime
fica desligado no painel do Supabase, ou o teste da fase 2 prova que um canal público
com o mesmo nome não recebe as mensagens do privado. **Por quê:** oferta, resposta e
candidatos ICE carregam o IP de cada participante, e quem os recebe pode entrar na
negociação da chamada. As salas de voz (RFC 0004) usam o mesmo tópico do projeto: a
sala vai na Presence e a separação entre salas é do cliente, não controle de acesso.
A sala privada (RFC 0005) tem tópico próprio, `chamada:<project_id>:<sala_id>`, e a
mesma função só o libera para sala de voz privada do projeto que a pessoa pode ver
(SEC-088). **Verificação:** revisão + navegador (uma conta de fora do projeto tenta
assinar o tópico e é recusada).

### SEC-076 — Só dono e membros aceitos ficam na chamada *(fase 2, atendido em `script.js`: `permitidoNaChamada` e `conferirAcessoChamada`)*
Além do SEC-075, cada participante recusa sinal de user id que não está entre o dono
e os membros aceitos que ele carregou. Quando `project_members` muda, cada
participante fecha na hora a conexão com quem perdeu o acesso, e o cliente de quem
saiu deixa a chamada e para câmera e microfone. O JWT do Supabase continua valendo 1
hora. Não há limite de pessoas na chamada (o de 4, que existia até a Q35 da RFC 0002,
era do cliente e nunca contou como controle de acesso).
Quem aparece no canal sem estar na lista carregada (entrou no projeto depois) faz o
cliente recarregar os projetos (`membroNovoNaChamada`, no máximo 3 vezes por pessoa)
e só entra se vier na lista nova: a recusa continua valendo para quem não é membro.
**Por quê:** o Realtime confere a policy ao entrar no canal e guarda o resultado até
o JWT vencer, então quem é removido no meio da chamada continuaria nela.
**Verificação:** revisão + navegador (remover um membro no meio de uma chamada;
entrar no projeto com a chamada em andamento).

### SEC-077 — Credencial TURN de curta duração, emitida só por `api/` *(fase 2, atendido em `api/chamada/turn.mjs` e `supabase/chamadas.sql`; falta aplicar no Supabase e configurar a Cloudflare)*
A credencial sai de `api/chamada/turn`, vale no máximo 1 hora e, durante a chamada, é
renovada chamando a rota de novo, que repete todas as checagens. A rota:
- usa `userFromRequest()`;
- só emite para dono ou membro aceito de projeto com pelo menos 2 pessoas;
- emite no máximo 20 vezes por hora por pessoa, contadas numa tabela sem grants para
  `anon`/`authenticated`;
- responde só com `iceServers` e a validade.

Entrar sozinho numa sala é permitido, mesmo em projeto de uma pessoa só: o app não
pede a credencial nesse caso, e a chamada fica só com STUN até alguém entrar na sala
(`buscarTurnChamada` e `renovarTurnChamada` em `script.js`). A regra das 2 pessoas
continua na rota.

`TURN_KEY_ID` e `TURN_KEY_API_TOKEN` ficam só nas variáveis da Vercel, com as regras
do SEC-001. **Por quê:** com o token da API, dá para gerar credenciais à vontade. Com
credencial longa ou sem limite, uma conta recém-criada usa o TURN como intermediário
grátis, e a Cloudflare não tem teto de gasto. **Verificação:** auto (SEC-030 e
SEC-031 já cobrem a rota nova) + revisão (validade, limites, corpo da resposta).

### SEC-078 — Câmera, microfone e tela só no próprio site e só depois de um clique *(fase 2, atendido em `vercel.json` e `script.js`)*
`Permissions-Policy` libera `camera`, `microphone` e `display-capture` só para
`self`. `getUserMedia` e `getDisplayMedia` só rodam a partir de um clique na prévia,
na barra da chamada ou no "Transmitir" da escolha da tela. Sair da chamada, ou fechar a aba, para todas as faixas.
**Por quê:** `*` deixaria qualquer iframe ou origem usar a permissão, e uma faixa
esquecida mantém a câmera ligada depois que a pessoa acha que saiu.
**Verificação:** auto (`Permissions-Policy` com os três presentes e só `self`) +
revisão + navegador.

### SEC-079 — Chamada não é gravada *(fase 2, atendido; o verificador barra gravação no `script.js`)*
Nenhum `MediaRecorder` nem captura de quadros sobre os fluxos da chamada.
**Por quê:** decisão da RFC 0002. Gravar exige o consentimento de todos e um lugar
para guardar vídeo, e uma gravação que vier depois começa por uma RFC.
**Verificação:** auto (`MediaRecorder`, `ImageCapture`, `captureStream` ou
`requestVideoFrameCallback` em `script.js` são falha).

## Canais de projeto

Requisitos da [RFC 0004](../rfc/0004-canais-de-projeto.md).

### SEC-080 — Canal segue o acesso ao projeto, e só dono e editores mudam a estrutura *(atendido em `supabase/canais_projeto.sql`; falta aplicar no Supabase)*
`project_channels` só é legível pelo dono e pelos membros aceitos do projeto. Criar,
renomear, mover e apagar canal ou categoria é só do dono e dos editores. `project_id`
e `tipo` ficam fora do `grant update`. O nome tem de 1 a 60 caracteres, a categoria
de um canal é do mesmo projeto e é do tipo categoria, e um projeto tem no máximo 100
itens. Desde a RFC 0006, mexer é por tipo: canal de texto pede a regra `texto` do
cargo, sala de voz a regra `voz`, categoria qualquer uma das duas
(`pode_mexer_no_canal`, `security definer` com `search_path` fixo); o dono sempre pode.
Conversa direta (`tipo = 'direta'`) não se cria, altera nem apaga por estas policies.
**Por quê:** é a estrutura que todos do projeto veem. Sem a regra no banco, a
chave pública deixaria um visualizador apagar canais (e o histórico deles), ou uma
conta qualquer inundar a lista. Canal privado (RFC 0005) soma a regra do SEC-088.
**Verificação:** revisão (toda policy de
`project_channels` passa por `is_project_owner`/`is_project_member`, e a escrita exige
`'editor'`) + teste do SQL com dono, editor, visualizador e conta de fora.

### SEC-081 — Mensagem presa a um canal do mesmo projeto e do tipo certo *(atendido em `supabase/canais_projeto.sql`; falta aplicar no Supabase)*
`project_messages.canal_id` tem chave estrangeira composta `(canal_id, project_id)`
para `project_channels (id, project_id)`: nenhuma mensagem aponta para canal de outro
projeto. Um gatilho recusa texto fora de canal de texto e linha de chamada fora de
sala de voz. `canal_id` não tem `grant update`. **Por quê:** o RLS de leitura é pelo
projeto. Uma mensagem gravada com o canal de outro projeto apareceria na conversa
errada, e trocar o canal depois mudaria quem a lê. **Verificação:** revisão + teste
do SQL (canal de outro projeto e tipo errado recusados).

### SEC-082 — "Até onde li" de cada canal é só da própria pessoa *(atendido em `supabase/canais_projeto.sql`; falta aplicar no Supabase)*
`project_channel_reads` só aceita linha com `user_id = auth.uid()` em projeto do qual
a pessoa é dona ou membro aceito, para ler e para escrever, e o canal é do mesmo
projeto (chave composta). `contar_nao_lidas_canais()` é `security invoker`. **Por
quê:** o mesmo do SEC-074, agora por canal. **Verificação:** revisão.

## Ícone do projeto

### SEC-083 — Ícone do projeto só de lista fechada, cor validada e imagem do próprio bucket *(atendido em `supabase/icone_projeto.sql` e `script.js`; falta aplicar no Supabase)*
`projects.icone` só aceita uma chave de `ICONES_PROJETO` (a mesma lista no `check` do
banco e no `script.js`), e o SVG sai do `script.js`, nunca do banco. `icone_cor` é
`#rrggbb` no banco e passa por `corSegura()` no app. `icone_imagem` guarda só o
caminho no bucket `avatars`, no formato
`<id de quem enviou>/projeto-<id do projeto>-<número>.<png|jpg|webp>`. Um gatilho
`security invoker` confere que a pasta é de quem salva e que o id é o do próprio
projeto, e o app só monta a URL com `getPublicUrl()` depois de conferir o mesmo
formato. Mudam o ícone só o dono e os editores (`projects_update`), pelo
`grant update` das três colunas. **Por quê:** o ícone aparece para todo mundo do
projeto. Uma URL qualquer no banco faria o navegador de cada membro buscar um
endereço de fora, que veria o IP e a hora de quem abriu o projeto. Um SVG ou uma
cor vindos do banco entrariam crus no HTML. **Verificação:** revisão + teste do SQL
(chave fora da lista, cor inválida, URL externa, pasta de outra pessoa e imagem de
outro projeto recusadas; visualizador não muda).

## Cargos e configurações do projeto

Requisitos da [RFC 0005](../rfc/0005-cargos-e-configuracoes-do-projeto.md).

### SEC-084 — Cargo só muda por função, pelo dono ou pela regra `cargos` *(atendido em `supabase/configuracoes_projeto.sql`; falta aplicar no Supabase)*
`definir_cargo_membro(membro, cargo)` é `security definer` com `search_path` fixo e
recusa cargo fora de `editor`, `participante` e `viewer`. O dono muda qualquer um.
Quem tem a regra `cargos` (RFC 0006) só muda quem está com cargo igual ou abaixo do
seu, só para cargo igual ou abaixo do seu, e nunca o próprio cargo. O grant de UPDATE de `project_members` continua só com
`user_id` e `status`, e a policy de convite só aceita os três cargos. Além do dono,
convida quem tem a permissão `convidar` do cargo, e só para cargo igual ou abaixo do
seu (`pode_convidar_como`, `security definer` com `search_path` fixo); o convite nasce
pendente e sem usuário, e ver e apagar convite pendente continua com o dono e o
convidado (SEC-044). **Por quê:** o
grant de `role` valeria também para o convidado, que escolheria o próprio cargo ao
aceitar (o furo que o `rls_correcoes.sql` fechou). **Verificação:** revisão + teste
do SQL (editor, participante e conta de fora recusados; cargo inválido recusado).

### SEC-085 — Participante mexe em tarefas, não na estrutura *(atendido em `supabase/configuracoes_projeto.sql`; falta aplicar no Supabase)*
`tasks_insert`, `tasks_update` e `tasks_delete` aceitam tarefa de projeto de dono,
editor e participante, antes e depois da alteração. `projects_update`,
`project_channels` e as notas continuam exigindo `'editor'` ou dono. Visualizador
continua sem escrita em tarefa de projeto. **Por quê:** é o cargo novo; sem a regra no
banco, o app esconderia botões mas a chave pública deixaria o participante mudar
colunas e notas, ou o visualizador mexer em tarefas. **Verificação:** revisão + teste
do SQL com os quatro cargos.

### SEC-086 — Regras de cargo só o dono muda, e as configurações são de lista fechada *(atendido em `supabase/configuracoes_projeto.sql`; falta aplicar no Supabase)*
`projects.regras_cargos` só aceita as chaves `editor`, `participante` e `viewer`, cada
uma com uma lista sem repetição dentro de `convidar`, `cargos`, `nome`, `icone`,
`texto`, `voz`, `silenciar` e `mover`, e um gatilho recusa a mudança feita por quem
não é o dono. Desde a RFC 0006, `projects_update` aceita também quem tem a regra
`nome` ou `icone`, e o gatilho `projeto_campos_por_regra` confere campo por campo: o
nome pede `nome`, as três colunas do ícone pedem `icone`, e colunas, notas e ordem das
abas continuam do dono e do editor. `projects.nomes_cargos` (o nome de cada cargo no
projeto) só aceita as chaves `owner`, `editor`, `participante` e `viewer`, com texto de
1 a 24 caracteres, sem espaço nas pontas, sem `<`, `>` nem caractere de controle
(`nomes_cargos_validos`), e o mesmo gatilho das regras deixa só o dono mudar. O app
só usa o nome depois de conferir o mesmo formato e sempre passa por `esc()`. `projects.ordem_abas` só aceita as cinco chaves de aba,
sem repetir. As duas colunas entram no grant de UPDATE de `projects`; `owner_id`
continua fora. **Por quê:** o editor altera `projects` pela policy de sempre; sem o
gatilho, ele daria a si mesmo poder de moderar quem o dono não quis. **Verificação:**
revisão + teste do SQL (editor muda abas e não muda regras).

### SEC-087 — Moderação de voz autorizada pelo banco *(atendido em `supabase/salas_projeto.sql` e `script.js`; falta aplicar no Supabase)*
Silenciar, mover e desconectar outra pessoa é uma linha em `project_voz_moderacao`,
nunca um Broadcast. Leitura: dono e membros aceitos. Escrita: quem tem a permissão do
cargo (`tem_permissao_voz`), sobre alguém do projeto que não é o dono e tem cargo igual
ou abaixo (`pode_moderar`). Um gatilho `security definer` confere a permissão de
cada campo que mudou, fixa `atualizado_por`, `atualizado_em` e `comando_em` pelo
banco e só aceita sala de destino de voz, do mesmo projeto, que o alvo pode ver. No
app, os receptores aplicam a moderação por conta própria: não tocam a voz de quem
está silenciado (ou numa sala de silêncio sem poder falar) e não conectam com a sessão
que recebeu ordem de mover ou desconectar. **Por quê:** o campo `de` do Broadcast é
escrito pelo cliente; aceitar ordem por ali deixaria um visualizador silenciar a sala
inteira em nome do dono. **Verificação:** revisão + teste do SQL (sem permissão,
contra o dono, contra cargo acima e sala de outro projeto recusados).

### SEC-088 — Canal privado só para o dono, quem criou e a lista *(atendido em `supabase/salas_projeto.sql`; falta aplicar no Supabase)*
`pode_ver_canal(canal)` exige acesso ao projeto e, se o canal é privado, ser o dono,
quem o criou (`criado_por`, preenchido pelo banco e fora dos grants) ou estar em
`project_channel_membros`. Ela entra nas policies de `project_channels` (ler, alterar,
apagar), de `project_messages` (ler, escrever, apagar), de `project_channel_reads` e
da própria lista. A lista só aceita pessoa do projeto, e sair do projeto apaga a
pessoa dela. O tópico `chamada:<project_id>:<sala_id>` só é liberado para sala de
voz privada daquele projeto que a pessoa pode ver. **Por quê:** esconder o canal só
na tela deixaria as mensagens e a sinalização da sala chegarem a todos do projeto pela
API e pelo Realtime. **Verificação:** revisão + teste do SQL (membro fora da lista não
lê canal, mensagem nem tópico; dono e lista leem).

## Fotos no chat e mensagens diretas

Requisitos da [RFC 0006](../rfc/0006-fotos-mensagens-diretas-e-regras-de-cargo.md).

### SEC-090 — Foto do chat em bucket privado, com caminho conferido *(atendido em `supabase/imagens_no_chat.sql` e `script.js`; falta aplicar no Supabase)*
`project_messages.imagem` guarda só o caminho no bucket privado `chat`, no formato
`<projeto>/<canal>/<quem enviou>_<8 a 32 hex>.<png|jpg|webp|gif>` (o mesmo `check` no
banco e `IMAGEM_CHAT` no app). Um gatilho confere que projeto e canal são os da
mensagem e que o arquivo é de quem envia. O bucket aceita até 5 MB e só os quatro
tipos de imagem. Ler o arquivo pede poder ver o canal (`pode_usar_imagem_chat`, com
`ve_canal`); enviar e apagar pedem também que o arquivo seja seu. O app só mostra a
foto por URL assinada de 1 hora, e redesenha a foto no canvas antes de subir (tira
EXIF e localização). Apagar a mensagem zera `imagem` (`msg_apagar` exige
`imagem is null`). **Por quê:** a foto é do canal, privado ou não; num bucket público
qualquer um com o link a veria, e um caminho livre no banco apontaria para a foto de
outro canal ou de outra pessoa. **Verificação:** revisão + teste do SQL (caminho de
outro canal, de outra pessoa e fora do formato recusados; quem não vê o canal não lê
o arquivo).

### SEC-091 — Mensagem direta só para as duas pessoas *(atendido em `supabase/salas_projeto.sql`; falta aplicar no Supabase)*
Conversa direta é um canal `tipo = 'direta'`, sempre privado e sem categoria
(`check`), com as duas pessoas em `project_channel_membros`. Ela só nasce por
`abrir_conversa_direta(projeto, outro)` (`security definer`, `search_path` fixo), que
exige as duas pessoas no projeto, reaproveita a conversa que já existe e limita a 500
por projeto. `ve_canal` e as policies de `project_channels` só mostram a conversa a
quem está na lista, **nem ao dono do projeto**; criar, alterar e apagar pelas policies
comuns é recusado. **Por quê:** é a conversa privada que a pessoa espera; o atalho de
"o dono vê todo canal privado" (SEC-088) não pode valer aqui. **Verificação:** revisão +
teste do SQL (dono, terceiro e conta de fora não leem; criar direto na tabela recusado).

## Fonte do nome

### SEC-089 — Fonte e cor do nome de lista fechada *(atendido em `supabase/fonte_do_nome.sql` e `script.js`; falta aplicar no Supabase)*
`profiles.nome_fonte` só aceita uma chave de `FONTES_NOME` (a mesma lista no `check`
do banco e no `script.js`), e o app só usa a chave depois de conferir na lista; a
`font-family` sai do `styles.css`, nunca do banco. `profiles.nome_cor` é `#rrggbb` no
banco e passa por `corSegura()` no app. **Por quê:** o nome aparece no navegador de
todo mundo do projeto; um valor cru no `style` viraria injeção de CSS (ou de HTML,
fora do atributo). **Verificação:** revisão + teste do SQL (fonte fora da lista e cor
inválida recusadas).
