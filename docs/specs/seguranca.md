# Spec — Segurança

Requisitos de segurança do samyestmind. Ids são estáveis: não renumere, marque como
`removido` quando um deixar de valer. Verificação: `auto` = `scripts/verificar.mjs`;
`revisão` = agente guardião lendo o código; `navegador` = teste no site rodando.

## Segredos

### SEC-001 — Segredos só em variável de ambiente
`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET` e `OAUTH_STATE_SECRET` nunca
aparecem em arquivo versionado nem em código que chega ao navegador.
**Por quê:** a service role ignora todo o RLS; o client secret permite se passar
pelo app no Google. **Verificação:** auto (nenhum valor com cara de segredo em
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
