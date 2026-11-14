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

### QUA-008 — Toda chamada de rede das funções em `api/` tem prazo
Supabase, Google e Cloudflare são chamados por `buscar()` do `_lib.mjs`, que corta
em 8 s. **Por quê:** sem prazo, um serviço que trava segura a função até a Vercel
matá-la, e o app recebe um erro genérico em vez do 503 de "tente de novo".
**Verificação:** auto (falha) — `fetch(` direto em `api/` fora do `buscar()`.

### QUA-009 — Componente do daisyUI só com prefixo `d-` e com as cores do tema *(RFC 0007)*
Classe do daisyUI sempre com `d-` (`d-btn`, nunca `btn`). Cor de componente sai dos
tokens do tema (o mapeamento no fim do `styles.css`), nunca de um tema do daisyUI nem
de cor fixa. Ajuste de componente vai no `styles.css`, fora de camada; o
`vendor/daisyui-*.css` não se edita à mão. Regra nova de reset (`*`, elemento solto)
vai para `@layer app-reset`. Tela migrada não mistura o controle antigo e o novo no
mesmo papel (dois tipos de botão primário, por exemplo). **Por quê:** sem o prefixo,
`.modal` e `.input` do daisyUI pegam os do app; fora da camada, o reset apaga o
padding dos componentes. **Verificação:** revisão.

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

### QUA-044 — Modal de tarefa nos temas *(RFC 0007)*
O modal de tarefa abre sem erro no Vidro, num tema claro e no Grafite: campos,
seletor Tarefa/Evento, tags, interruptores, dias da rotina e rodapé legíveis, foco
visível no teclado e sem rolagem lateral em 375px. Fora do modal, nada muda de
aparência com o daisyUI carregado. **Verificação:** navegador.

### QUA-043 — Fluxos logados *(precisa de conta de teste)*
Criar, mover e concluir tarefa; criar rotina; abrir projeto. Só roda se
`.env.teste` existir com credenciais da conta de teste. **Verificação:** navegador.
