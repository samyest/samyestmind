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

Rode `supabase/google_credentials.sql` no SQL Editor do Supabase. A tabela fica
com RLS ligado e **sem policies**, então nada no navegador consegue ler os
refresh tokens — só as funções em `api/`, que usam a service role key.

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

> A service role key ignora todo o RLS do Supabase e o client secret dá acesso ao
> Google em nome do app. Nenhum dos dois pode ir para o repositório nem para o
> navegador — só nas variáveis de ambiente da Vercel.

### Como funciona

- `api/google/start` — monta a URL de consentimento com um `state` assinado (HMAC)
  contendo a identidade do usuário, para o callback não confiar no navegador
- `api/google/callback` — troca o código pelos tokens e guarda o refresh token
- `api/google/token` — devolve ao navegador um access token curto, renovando pelo
  refresh token quando vence; também guarda o id do calendário e o sync token
- `api/google/disconnect` — revoga no Google e apaga a credencial

O navegador nunca vê o refresh token; por isso a conexão sobrevive a recarregar a
página e dura até ser revogada.

### Limitações conhecidas

- O sync Google → app roda a cada 2 minutos **com o app aberto**. Sincronizar com o
  app fechado exigiria um cron job chamando a API.
- Compromissos recorrentes viram **uma tarefa por ocorrência** (a busca expande a
  recorrência). Uma daily de 90 dias cria 90 tarefas.
- Em projetos compartilhados, cada membro sincroniza no próprio calendário. O id do
  evento de tarefas de terceiros fica por dispositivo (localStorage), senão os
  membros sobrescreveriam o mapeamento uns dos outros.
- Apagar um evento no Google só apaga a tarefa se ela for sua.
