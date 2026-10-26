# Spec — Qualidade de código e funcionamento

Mesmas convenções de `seguranca.md`: ids estáveis, verificação `auto`, `revisão` ou
`navegador`.

## Código

### QUA-001 — Arquivos JS sem erro de sintaxe
`script.js` e todo `api/**/*.mjs` passam em `node --check`. **Verificação:** auto.

### QUA-002 — Sem `console.log` de depuração esquecido
`console.error`/`console.warn` são permitidos para falhas reais; `console.log` não.
**Verificação:** auto (aviso).

### QUA-003 — Sem `debugger`
**Verificação:** auto.

### QUA-004 — Seguir o padrão existente do arquivo
Antes de código novo, procurar o padrão que já existe (`showToast`, `esc`, `sb.from`,
nomes em português) e seguir. Nada de segunda convenção. **Verificação:** revisão.

### QUA-005 — Erro do Supabase sempre tratado
Toda chamada `await sb.from(...)` que escreve checa `error` e avisa o usuário com
`showToast(..., 'erro')`. **Por quê:** falha silenciosa faz o usuário achar que
salvou. **Verificação:** revisão.

### QUA-006 — Comentário explica o porquê, não o quê
**Verificação:** revisão.

### QUA-007 — Mudança de schema tem `.sql` em `supabase/`
**Verificação:** revisão.

## Interface e acessibilidade

### QUA-020 — Elementos clicáveis são `<button>` ou `<a>`
`onclick` em `div`/`span` exige `role` e `tabindex`, e o ideal é virar `<button>`.
**Verificação:** auto (aviso) + revisão.

### QUA-021 — Imagem tem `alt`
Decorativa usa `alt=""`. **Verificação:** auto.

### QUA-022 — Input tem rótulo
`<input>` tem `<label for>`, `aria-label` ou `aria-labelledby`. **Verificação:** revisão.

## Funcionamento (navegador)

### QUA-040 — Carrega sem erro no console
A página inicial abre sem erro de JavaScript nem recurso bloqueado pela CSP.
**Verificação:** navegador.

### QUA-041 — Tela de login funciona sem sessão
Login, cadastro e redefinição de senha aparecem e validam campos vazios.
**Verificação:** navegador.

### QUA-042 — Layout sem rolagem horizontal em 375px
**Verificação:** navegador.

### QUA-043 — Fluxos logados *(precisa de conta de teste)*
Criar, mover e concluir tarefa; criar rotina; abrir projeto. Só roda se
`.env.teste` existir com credenciais da conta de teste. **Verificação:** navegador.
