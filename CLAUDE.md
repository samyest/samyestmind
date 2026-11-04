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

- `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, `OAUTH_STATE_SECRET` e
  `TURN_KEY_API_TOKEN` nunca vão para o repositório nem para o navegador — só
  variáveis de ambiente da Vercel. A service role key ignora todo o RLS; o refresh
  token do Google e o token TURN da Cloudflare só são tocados pelas funções em `api/`.
- `styles.css` e `script.js` são grandes e sem módulos. Antes de adicionar código novo,
  procure o padrão que já existe no arquivo e siga ele, em vez de introduzir uma
  segunda convenção.
- Mensagens de commit em português, descritivas e no presente, como as que já estão no
  histórico: "Corrige atalho N disparando dentro das notas do projeto".
- O `supabase-js` é carregado do jsDelivr com **versão fixa e hash SRI** (`integrity`
  no `index.html`). Nunca volte para `@2` solto: qualquer release nova entraria no
  app no mesmo dia. Para atualizar, escolha uma versão publicada há pelo menos duas
  semanas, troque o número na URL e recalcule o hash:
  `curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@X.Y.Z/dist/umd/supabase.js | openssl dgst -sha384 -binary | openssl base64 -A`
- HTML montado por template string: texto do usuário sempre por `esc()`, cor por
  `corSegura()`, e colunas (pessoais ou de projeto) só depois de `normalizarColunas()`
  — a chave delas vai crua para dentro de `onclick`.

## Specs, RFCs e o agente guardião

- Requisitos de segurança e qualidade ficam em `docs/specs/` com id estável
  (`SEC-xxx`, `QUA-xxx`). Mudança que afeta um requisito começa pela spec; mudança
  grande (integração nova, dado sensível novo, superfície pública nova) começa por uma
  RFC em `docs/rfc/`.
- `node scripts/verificar.mjs` checa os requisitos automáticos. Rode antes de commit;
  `FALHA` bloqueia, `AVISO` se confirma lendo o código.
- O agente `guardiao` (`.claude/agents/guardiao.md`) roda verificador, revisão e teste
  no navegador e corrige um requisito por commit. Nunca dá push nem deploy.

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
| `ponytail` | Modo "dev sênior preguiçoso": a menor mudança que resolve a tarefa inteira, sem abstração nem config que ninguém pediu. Níveis `lite`, `full` (padrão) e `ultra`; desliga com "stop ponytail". |
| `ponytail-review` | Revisão de um diff ou commit: bug, segurança, carga, teste faltando, velocidade e o que cortar. Só relata, não altera código. |
| `ponytail-audit` | A mesma revisão para o repo inteiro (ou uma pasta), em ranking. Só relata. |
| `ponytail-debt` | Lista os comentários `shortcut:` como livro de dívidas técnicas. Só relata. |
| `ponytail-help` / `ponytail-gain` | Cartão de referência do ponytail e placar do benchmark deles. Só exibem; citam recursos do plugin (band, statusline) que não vêm com a skill. |
| `security-audit` | Auditoria de segurança com rastreio até a fonte. Por padrão é só guia; o fluxo completo de seis fases (com relatório fora do repo, em `~/security-audit-skill/`) roda apenas quando o pedido é auditoria completa ou pen test. |
| `voicestudio` | Gerar fala, transcrever e dublar pela API local do [VoiceStudio](https://github.com/debpalash/VoiceStudio) (`localhost:3900`). Só serve com o app rodando; não tem relação com o código deste site. |

Use uma de cada vez. `impeccable` e `frontend-design` se sobrepõem — não empilhe as duas
no mesmo pedido; escolha pelo tamanho do trabalho. O mesmo vale para revisão:
`ponytail-review`/`ponytail-audit` olham qualidade geral, `security-audit` vai fundo em
segurança, e o agente `guardiao` checa as specs de `docs/specs/` — escolha uma pelo foco.

### Origem das skills de terceiros

Copiadas sem alteração, com a licença de cada projeto em `LICENSE.txt` na pasta da skill.
Para atualizar, clone de novo, compare e troque o commit aqui.

| Skills | Repositório | Commit | Licença |
|---|---|---|---|
| `ponytail*` (as 6 de `skills/`) | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | `96608e0` | MIT |
| `security-audit` | [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) | `c1c8a8c` | MIT |
| `voicestudio` | [debpalash/VoiceStudio](https://github.com/debpalash/VoiceStudio) | `346bef2` | AGPL-3.0 |

Do ponytail vieram só as skills: os hooks de ativação automática, a statusline e o
"band" são do plugin e não foram instalados. Do VoiceStudio ficou de fora a
`voicestudio-maintainer`, que serve para manter o repositório deles.
