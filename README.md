# samyestmind

Site para realizar organizações de tasks de rotina.

## Integração com Google Calendar

Sincroniza nos dois sentidos com a **agenda principal** do usuário: tarefas com
prazo viram eventos, e eventos da agenda viram tarefas. Cor e horário acompanham
nos dois lados; concluídas ganham "✓" no título.

Usa a agenda principal (e não um calendário dedicado) para que qualquer evento
criado no Google vire tarefa sem exigir escolher um calendário na hora. O custo
é que compromissos comuns também viram tarefa — convites recusados são o único
filtro. Feriados e aniversários ficam de fora por serem calendários separados no
Google.

### 1. Banco

Todo o SQL fica em `supabase/` e roda à mão no SQL Editor do Supabase. Os arquivos
podem rodar mais de uma vez sem problema.

- `supabase/schema_base.sql` — as tabelas que nasceram pelo painel (`profiles`,
  `projects`, `project_members`, `tasks`, `task_comments`), as funções
  `is_project_owner`, `is_project_member` e `accept_invite_by_code`, o bucket
  `avatars` e as policies de tudo isso, **como estão em produção hoje**. Serve de
  registro e para montar um banco novo.
- `supabase/rls_correcoes.sql` — fecha os furos de RLS que a revisão encontrou nas
  policies do schema base: visualizador que se promovia a editor, editor que tomava
  o projeto do dono, tarefa enfiada em projeto alheio, perfis legíveis sem login,
  bucket listável e outros. Cada bloco explica o risco que fecha. Rode **depois** do
  schema base. O app esconde botões de quem só visualiza, mas a proteção de verdade
  é este RLS.
- `supabase/inspecionar_schema.sql` — só leitura. Devolve numa célula de texto as
  colunas, policies, funções, grants e storage do banco, para conferir se ele bate
  com os arquivos daqui.

Num banco novo, a ordem é: `schema_base.sql`, depois as migrações
(`google_credentials`, `task_color`, `eventos_ignorados`, `task_sync_google`,
`routines`, `task_tags`, `tarefas_google_unicas`, `desafio`, `desafio_v2`) e por
último `rls_correcoes.sql`.

Os convites por email confiam no email do login, então mantenha ligada a
confirmação de email do Supabase ("Confirm email", nas configurações do provedor
Email em Authentication). Sem ela, alguém poderia criar conta com o email de outra pessoa
e aceitar os convites dela.

Rode `supabase/google_credentials.sql` no SQL Editor do Supabase. A tabela fica
com RLS ligado e **sem policies**, então nada no navegador consegue ler os
refresh tokens — só as funções em `api/`, que usam a service role key.

Depois rode `supabase/tarefas_google_unicas.sql`: ele cria o índice que impede a
mesma reunião de virar duas tarefas quando o app está aberto em mais de um
aparelho. O passo 1 do arquivo lista duplicatas que já existam (o índice não é
criado enquanto houver alguma).

### 2. Google Cloud Console

1. Criar projeto em <https://console.cloud.google.com>
2. **APIs e Serviços → Biblioteca** → ativar **Google Calendar API**
3. **Tela de permissão OAuth** → tipo **Externo**
   - Adicionar seu email em **Usuários de teste**
   - Manter em modo **Teste** (o escopo de Calendar é sensível; publicar exigiria
     verificação do Google, e em teste funciona para até 100 contas adicionadas)
4. **Credenciais → Criar credenciais → ID do cliente OAuth** → **Aplicativo da Web**
   - **Origens JavaScript autorizadas:** `https://SEU-APP.vercel.app`
   - **URIs de redirecionamento autorizados:** `https://SEU-APP.vercel.app/api/google/callback`
5. Guardar o **ID do cliente** e a **Chave secreta**

### 3. Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Onde obter |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud Console (passo 2) |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console (passo 2) |
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API (chave pública) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (**secreta**) |
| `OAUTH_STATE_SECRET` | Qualquer string aleatória longa: `openssl rand -base64 32` |
| `GOOGLE_REDIRECT_URI` | Opcional. Só se o domínio do callback for diferente do host da requisição |
| `APP_ORIGIN` | Opcional, mas recomendado. Origem fixa do app (`https://SEU-APP.vercel.app`). Sem ela, o redirect do callback é montado a partir do header `x-forwarded-host`, que vem do cliente |

> A service role key ignora todo o RLS do Supabase e o client secret dá acesso ao
> Google em nome do app. Nenhum dos dois pode ir para o repositório nem para o
> navegador — só nas variáveis de ambiente da Vercel.

### Como funciona

- `api/google/start` — monta a URL de consentimento com um `state` assinado (HMAC)
  contendo a identidade do usuário, para o callback não confiar no navegador
- `api/google/callback` — troca o código pelos tokens e guarda o refresh token
- `api/google/token` — devolve ao navegador um access token curto, renovando pelo
  refresh token quando vence; também guarda o id do calendário e o sync token. Se o Google
  falhar de forma passageira ao renovar, responde 503 e o app tenta de novo depois,
  sem dar a conta por desconectada
- `api/google/disconnect` — revoga no Google e apaga a credencial

O navegador nunca vê o refresh token; por isso a conexão sobrevive a recarregar a
página e dura até ser revogada.

### Limitações conhecidas

- O sync Google → app roda a cada 2 minutos **com o app aberto**. Sincronizar com o
  app fechado exigiria um cron job chamando a API.
- Compromissos recorrentes viram **uma tarefa por ocorrência** (a busca expande a
  recorrência), mas só dentro dos **próximos 90 dias**: uma daily sem data de fim
  vira umas 90 tarefas, um aniversário anual vira uma, e as ocorrências seguintes
  entram conforme a janela anda (o app faz uma busca completa por dia). Sem esse
  limite, cada aniversário da agenda virava ~30 tarefas, uma por ano até 2056.
- Em projetos compartilhados, cada membro sincroniza no próprio calendário. O id do
  evento de tarefas de terceiros fica por dispositivo (localStorage), senão os
  membros sobrescreveriam o mapeamento uns dos outros.
- Apagar um evento no Google só apaga a tarefa se ela for sua.
