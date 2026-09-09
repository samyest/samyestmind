# samyestmind

Site para organizar tarefas e rotinas, com sync bidirecional com o Google Calendar.
O `README.md` cobre a configuração do Google, do Supabase e das variáveis de ambiente
— leia ele antes de mexer no fluxo de OAuth ou de sync.

## Stack

Sem framework e sem build step. Não existe `package.json`; nada é compilado.

- **Front** — `index.html`, `styles.css` (~2.600 linhas), `script.js` (~4.000 linhas),
  em HTML/CSS/JS puro. Todo o app vive nesses três arquivos.
- **Back** — funções serverless da Vercel em `api/` (ESM, `.mjs`), mais Supabase
  (Postgres com RLS) para persistência.
- **SQL** — versionado em `supabase/*.sql` e aplicado à mão no SQL Editor do Supabase.
  Mudou schema? Escreva o `.sql` correspondente ali.

## Regras do projeto

- `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET` e `OAUTH_STATE_SECRET` nunca vão
  para o repositório nem para o navegador — só variáveis de ambiente da Vercel. A
  service role key ignora todo o RLS; o refresh token do Google só é tocado pelas
  funções em `api/`.
- `styles.css` e `script.js` são grandes e sem módulos. Antes de adicionar código novo,
  procure o padrão que já existe no arquivo e siga ele, em vez de introduzir uma
  segunda convenção.
- Mensagens de commit em português, descritivas e no presente, como as que já estão no
  histórico: "Corrige atalho N disparando dentro das notas do projeto".

## Skills deste repositório

As skills em `.claude/skills/` são cópias fixadas aqui, então valem para este projeto
mesmo em sessões na nuvem ou para quem clonar o repo. Existem versões globais das
mesmas skills em `~/.claude/skills/`; **a cópia do repositório é a que vale aqui.**

| Skill | Quando usar |
|---|---|
| `impeccable` | Trabalho visual de peso: repensar hierarquia, tipografia, cor, espaçamento, motion, estados vazios e de erro. É a principal para design neste projeto. |
| `frontend-design` | Ajuste pontual de direção estética, quando o pedido é pequeno e `impeccable` seria pesado demais. |
| `web-design-guidelines` | Auditoria de UI já existente: acessibilidade, semântica de HTML, conformidade com as Web Interface Guidelines. Recebe arquivo ou padrão como argumento. |
| `grilling` | **Antes** de construir feature nova. Entrevista em rodadas para fechar as decisões do plano. Não serve para trabalho visual. |

Use uma de cada vez. `impeccable` e `frontend-design` se sobrepõem — não empilhe as duas
no mesmo pedido; escolha pelo tamanho do trabalho.
