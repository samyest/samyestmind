# RFC 0007 — Base de componentes: daisyUI com prefixo

- **Status:** piloto (modal de tarefa), aguardando aprovação para seguir
- **Autor:** samyest
- **Data:** 2026-11-14
- **Specs afetadas:** [`docs/specs/seguranca.md`](../specs/seguranca.md) (SEC-021, novo),
  [`docs/specs/qualidade.md`](../specs/qualidade.md) (QUA-009 e QUA-044, novos)

A RFC 0003 continua reservada para a direção visual (RFC 0001). Esta aqui não muda a
cara do app: troca o material de que os controles são feitos.

## 1. Contexto

O pedido: usar as bibliotecas [coss ui](https://coss.com/), [AlignUI](https://www.alignui.com/),
[daisyUI](https://daisyui.com/), [HeroUI](https://heroui.com/) e
[Ant Design](https://ant.design/), "e utilizar tudo que elas têm".

O que pesa no código:

- **Sem framework e sem build.** `index.html`, `styles.css` (~7.300 linhas) e
  `script.js`, que monta HTML por template string.
- **Quatro das cinco são React.** coss ui, AlignUI, HeroUI e Ant Design entregam
  componentes React. Usar qualquer uma é reescrever o front e criar um build.
- **O daisyUI é CSS.** É um plugin do Tailwind, com versão pronta no CDN.
- **Nomes em conflito.** O daisyUI usa `.modal`, `.input`, `.select`, `.badge` e
  `.toast`, que o `styles.css` já usa. O `.modal` dele começa invisível
  (`opacity:0; pointer-events:none`): carregado do CDN como vem, esconderia todos os
  modais do app.
- **Reset global.** O `styles.css` tem `*{padding:0;margin:0}` e
  `button{background:none;border:none}` fora de camada. O daisyUI vem todo em
  `@layer`, e regra fora de camada sempre ganha de regra em camada: os botões do
  daisyUI perderiam padding e fundo.
- **8 temas.** O `applyTheme()` troca variáveis CSS no `:root`; o Vidro também
  redefine `--radius` no `body`.

## 2. Decisões

Q1 e Q2 fechadas com o usuário em 2026-11-14. As outras foram decididas na
implementação.

| # | Decisão |
|---|---|
| Q1 | **daisyUI como base, as outras quatro como referência.** Os componentes vêm do daisyUI. Das bibliotecas React vêm padrões, reescritos em CSS/JS puro: o seletor segmentado (Ant Design `Segmented`, HeroUI `Tabs`), o botão com estado de carregando (HeroUI `isLoading`), a dica de atalho dentro do botão (AlignUI e coss), o retorno de toque ao apertar (HeroUI). Migrar para React foi descartado: muda a stack, o deploy e o CLAUDE.md, e é trabalho de semanas. |
| Q2 | **Uma tela piloto primeiro.** O modal de tarefa, porque junta quase todo tipo de controle: texto, select, data, segmentado, tags, interruptor, botões de dia, área de texto e rodapé com três ações. O resto do app só muda depois de o dono aprovar o piloto. |
| Q3 | **Prefixo `d-`.** `d-btn`, `d-input`, `d-modal`… Acaba o conflito de nomes, e dá para migrar tela por tela, com as classes antigas e as novas convivendo. O prefixo só existe passando pelo plugin, então o CSS é **gerado** (Q4). |
| Q4 | **Arquivo gerado e versionado, sem CDN.** `scripts/daisyui/gerar.sh` instala daisyUI 5.7.50 e Tailwind 4.3.3 (versões fixas, publicadas há mais de duas semanas, `--ignore-scripts`) numa pasta temporária e grava `vendor/daisyui-5.7.50.css`. O deploy continua sem build; o script só roda quando a versão muda. Servir daqui também dispensa abrir `cdn.jsdelivr.net` no `style-src` da CSP. |
| Q5 | **A biblioteca inteira.** O arquivo traz todas as classes do daisyUI (371 KB, 43 KB com gzip), sem as variantes responsivas (`sm:`, `md:`…), que o app não usa. Gerar só as classes em uso deixaria o arquivo bem menor, mas cada classe nova exigiria rodar o script de novo, e uma classe esquecida some sem erro (foi o que aconteceu com `d-status` na primeira versão do gerador). Revisitar quando a migração terminar e o uso estiver estável. |
| Q6 | **Camadas.** A primeira linha do `styles.css` fixa `@layer app-reset, theme, base, components, utilities;`. O reset do app (`*`, `button`, `input,select,textarea`) vai para `app-reset`, abaixo do daisyUI. O resto do `styles.css` continua fora de camada e ganha do daisyUI, o que permite vestir os componentes sem `!important`. O `<link>` do daisyUI vem **depois** do `styles.css`, para a ordem valer. |
| Q7 | **Cores do tema, não do daisyUI.** No `body`, `--color-base-*`, `--color-primary` etc. apontam para `--glass-strong`, `--accent`, `--text`… Os 8 temas valem nos `d-*` sem paleta nova. Secundária e destaque usam os tons claros da paleta com texto forte; as cores de estado são as do quadro (`--doing`, `--done`, `--waiting`, `--danger`). `--depth:0` e `--noise:0`: o mundo do app é vidro chapado. |
| Q8 | **Raio concêntrico (RFC 0006).** Caixa no `--radius` do tema, campo em 10px, peça pequena em 8px; no Vidro, botões em pílula. |
| Q9 | **Foco do app.** O `:focus-visible` global continua valendo nos `d-*` (mesmo anel em todo o app); só o `border-radius:6px` dele volta ao do componente, por `revert-layer`. |

## 3. O piloto

Modal de tarefa (`#modal`), com o mesmo comportamento de antes:

- Fechar, limpar horário e dias da rotina: `d-btn` (fantasma, quadrado, circular).
- Tarefa/Evento: `d-tabs d-tabs-box`, com `role="radio"` como antes.
- Cliente, prazo e horário: `d-input`. Status, prioridade, projeto e responsável:
  `d-select`.
- Tags: a caixa é um `d-input` que cresce; cada tag é `d-badge` com o ponto
  `d-status`, nas cores das tags do quadro. O × virou ícone desenhado.
- Repetir e Google Agenda: `d-toggle`.
- Notas e comentário: `d-textarea`. Enviar: `d-btn d-btn-primary`.
- Rodapé: Excluir `d-btn-soft d-btn-error`, Cancelar `d-btn-ghost`, Salvar
  `d-btn-primary` com o atalho em `d-kbd` (⌘ no Mac, escondido em tela de toque) e,
  salvando, `d-loading` no lugar do atalho, sem perder a cor do botão.

Ajustes que vieram junto: os dias da rotina ganharam `aria-pressed` (antes só a cor
dizia qual estava marcado), no modal de tarefa e no de rotina; o texto do botão soft
sobe para 4,8:1 (a cor pura do daisyUI dava menos de 3:1 sobre o vidro claro).

Verificado no Chromium com o Supabase simulado: Vidro, Sereno, Rosa e Grafite no
desktop, Vidro em 390px (sem rolagem lateral), foco por teclado, estado salvando,
nenhum erro de página. Fora do modal, o estilo computado dos 823 elementos da página
(com Configurações e rotina abertas) é idêntico ao de antes, no Vidro e no Grafite.

## 4. Riscos

- **CSS de terceiro.** CSS também vaza dado (`input[value^=a]{background:url(…)}`), e
  a CSP aceita `img-src https:`. O SEC-021 barra `url()` para fora e `@import` no
  arquivo gerado, e folha de estilo de fora no HTML (só o Google Fonts).
- **Peso.** +43 KB com gzip na primeira visita (Q5).
- **Duas convenções por um tempo.** Telas não migradas seguem com `.btn-primary`,
  `.input` etc. O QUA-009 diz como as novas convivem com as antigas.
- **Animações sem prefixo.** Os `@keyframes` do daisyUI (`toast`, `menu`,
  `dropdown`, `progress`, `rating`, `skeleton`, `radio`, `rotator`, `aura*`) não
  ganham o prefixo. Hoje nenhum colide com o `styles.css`; um `@keyframes` novo no app
  não pode usar esses nomes.

## 5. Próximos passos (depois da aprovação do piloto)

1. Componentes base no resto do app: botões, campos, selects, interruptores (os
   `.sound-toggle` das Configurações e da rotina), confirmação, toasts.
2. Modais com `d-modal`, que pede `<dialog>` e troca o abrir/fechar do JS.
3. Listas de sugestão (cliente e tags) com `d-menu`/`d-dropdown`.
4. Ao fim, decidir Q5 de novo: biblioteca inteira ou só as classes em uso.
