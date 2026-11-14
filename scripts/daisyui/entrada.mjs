// Monta a entrada do Tailwind que gera vendor/daisyui-<versão>.css.
//
// Uso: node scripts/daisyui/entrada.mjs <caminho do daisyui.css do pacote>
// (quem chama é o scripts/daisyui/gerar.sh; a saída vai para o stdout).
//
// Por que existe: o daisyUI pelo CDN usa nomes que o styles.css já usa
// (.modal, .input, .select, .badge, .toast) e esconderia os modais do app.
// O prefixo "d-" só existe passando pelo plugin, e o Tailwind 4 só gera as
// classes que aparecem como candidatas. Esta entrada lista todas as classes
// do daisyUI como candidatas, então o arquivo gerado traz a biblioteca
// inteira, sem as variantes responsivas (sm:, md:…), que o app não usa.
import { readFileSync } from 'node:fs';

const caminho = process.argv[2];
if(!caminho){
  console.error('Uso: node scripts/daisyui/entrada.mjs <daisyui.css>');
  process.exit(1);
}

// Tira url(...) antes de procurar classes: o SVG embutido do ruído tem
// "www.w3.org", que viraria a classe ".w3". Strings não são tiradas: há aspas
// soltas no meio dos SVGs, e um regex de string engoliria trechos inteiros
// (foi assim que .d-status e .d-btn-soft sumiram na primeira versão). Uma
// candidata a mais que não existe no daisyUI só não gera nada.
const css = readFileSync(caminho, 'utf8')
  .replace(/url\([^)]*\)/g, '');

const classes = new Set();
for(const m of css.matchAll(/\.(-?[a-z][a-z0-9-]*)/g)){
  // Nomes com "\:" são variantes (sm\:modal-middle) e ficam de fora pelo
  // próprio regex; números soltos (".5rem") não começam com letra.
  classes.add(m[1]);
}

const candidatas = [...classes].sort().map(c => 'd-' + c).join(' ');

// source(none): o Tailwind não varre pasta nenhuma, só as candidatas daqui.
// Varrendo, ele geraria utilitários soltos (.hidden, .flex, .table) que
// passariam por cima das classes do styles.css.
process.stdout.write(`/* Gerado por scripts/daisyui/entrada.mjs. Não editar à mão. */
@layer theme, base, components, utilities;
@import "tailwindcss/utilities.css" layer(utilities) source(none);
@source inline("${candidatas}");
/* O toggle e o radio usam esta variável no modo de alto contraste; sem os
   utilitários do Tailwind, ninguém a declararia. */
@property --tw-outline-style { syntax: "*"; inherits: false; initial-value: solid; }
@plugin "daisyui" {
  prefix: "d-";
  themes: false;
  exclude: rootcolor, scrollbar, rootscrolllock, rootscrollgutter;
  logs: false;
}
`);
