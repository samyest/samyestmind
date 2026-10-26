# RFC 0001 — Agente guardião de qualidade e segurança

- **Status:** proposta
- **Autor:** samyest
- **Data:** 2026-10-24
- **Specs afetadas:** [`docs/specs/seguranca.md`](../specs/seguranca.md), [`docs/specs/qualidade.md`](../specs/qualidade.md)

## 1. Contexto

O samyestmind é um app de tarefas e rotinas com sync bidirecional com o Google
Calendar. Todo o front vive em três arquivos sem módulos (`index.html`, `styles.css`,
`script.js` com ~8.600 linhas), o back são quatro funções serverless em `api/google/`
e a persistência é Supabase com RLS.

Uma revisão externa apontou:

1. "Cara de IA" na interface.
2. Falta de requisitos explícitos de qualidade de código e segurança.
3. Vulnerabilidades.
4. Ausência de processo: RFC, spec, prompts definidos.

Já existe endurecimento feito caso a caso (`esc()`, `corSegura()`,
`normalizarColunas()`, `rls_correcoes.sql`, state OAuth assinado com HMAC, SRI no
`supabase-js`, CSP na Vercel). O problema é que essas regras moram em comentários
espalhados pelo código e na memória de quem escreveu. Nada impede uma mudança nova
de quebrá-las, e não há como provar para um revisor que elas valem.

## 2. Objetivo

Transformar as regras implícitas em **requisitos numerados e verificáveis** (specs)
e ter um **agente que verifica esses requisitos, testa o site e corrige o que estiver
quebrado**, rodando sob demanda ou em loop.

### Fora do escopo desta RFC

- Redesenho visual ("cara de IA"). Vira a RFC 0002, conduzida com a skill
  `impeccable`, porque mistura julgamento estético com correção técnica e as duas
  coisas pedem revisões diferentes.
- Migrar para framework ou build step. A stack sem build é decisão do projeto.

## 3. Proposta

### 3.1 Spec-driven: os requisitos vêm primeiro

Cada regra vira um requisito com id estável (`SEC-xxx`, `QUA-xxx`) em
`docs/specs/`. Cada requisito tem:

- **Regra** — uma frase no imperativo.
- **Por quê** — o ataque ou a falha que ele evita.
- **Verificação** — `auto` (checada por `scripts/verificar.mjs`), `revisão`
  (checada pelo agente lendo o código) ou `navegador` (checada abrindo o site).

Mudança de comportamento que afeta um requisito começa pela spec, não pelo código.
Mudança grande (nova integração, novo dado sensível, nova superfície pública) começa
por uma RFC nova em `docs/rfc/`.

### 3.2 Verificador automático

`scripts/verificar.mjs` — Node puro, sem dependências, coerente com o projeto não ter
`package.json`. Checa os requisitos marcados `auto` e sai com código ≠ 0 se algum
falhar. Cada falha cita o id do requisito, o arquivo e a linha.

```bash
node scripts/verificar.mjs
```

### 3.3 O agente guardião

Definido em `.claude/agents/guardiao.md`. O prompt segue estas decisões de prompt
engineering:

| Decisão | Motivo |
|---|---|
| Papel e limites no topo (o que pode e o que nunca faz) | Um agente que corrige sozinho precisa de trilhos antes de ferramentas. |
| A spec é a fonte da verdade, não a opinião do modelo | Achados ficam rastreáveis a um id; nada de "melhorias" sem requisito. |
| Ciclo fixo: verificar → reproduzir → corrigir → re-verificar | Evita correção sem prova e regressão silenciosa. |
| Toda correção exige evidência antes e depois | Separa achado real de suposição. |
| Formato de saída fixo (tabela por id) | O relatório pode ser comparado entre rodadas. |
| Proibições explícitas (push, deploy, segredos, SQL em produção) | O agente roda em loop; um erro se repetiria a cada volta. |
| "Na dúvida, reporte e não corrija" | Falso positivo corrigido custa mais que falso positivo reportado. |

### 3.4 Modos de execução

| Modo | Como | Uso |
|---|---|---|
| Sob demanda | Pedir "rode o guardião" numa sessão do Claude Code | Antes de commit/PR |
| Em loop | `/loop 30m rode o agente guardiao` | Sessão longa de trabalho |
| Só verificador | `node scripts/verificar.mjs` | Rápido, sem modelo |

O agente nunca dá push nem faz deploy. Ele corrige no working tree, um commit por
requisito, e quem decide subir é a pessoa.

## 4. Alternativas consideradas

- **Só linter (ESLint/Semgrep).** Exige `package.json` e não entende as regras do
  domínio (chave de coluna crua no `onclick`, RLS por projeto). Pode entrar depois
  como complemento.
- **Testes E2E com Playwright em CI.** Valioso, mas o login exige conta de teste no
  Supabase e o sync exige conta Google. Fica para a fase 2 (seção 6).
- **Revisão manual a cada PR.** É o que existe hoje e é o que gerou o feedback.

## 5. Riscos

- **Agente corrigindo errado.** Mitigado por: um commit por requisito, re-execução do
  verificador depois de cada correção, nenhuma mudança fora do requisito citado.
- **Spec envelhecer.** Mitigado por: o verificador falha quando um requisito `auto`
  deixa de valer; requisito sem verificação é sinal de spec ruim.
- **Falso senso de segurança.** O verificador cobre padrões, não lógica. A revisão do
  agente e o RLS no banco continuam sendo as defesas principais.

## 6. Plano

1. Specs de segurança e qualidade, verificador e agente. ← esta RFC
2. Primeira rodada do agente sobre o código atual; achados corrigidos em commits
   separados.
3. Conta de teste no Supabase (`.env.teste`, fora do git) para o agente testar os
   fluxos logados no navegador.
4. RFC 0002 — direção visual, com `impeccable`.
5. Tirar `'unsafe-inline'` do `script-src` da CSP (exige trocar os 150+ `onclick=`
   inline por delegação de eventos). Requisito `SEC-012`, hoje marcado como dívida.
