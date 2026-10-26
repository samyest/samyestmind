#!/usr/bin/env node
// Checa os requisitos marcados "auto" em docs/specs/. Node puro, sem dependências,
// porque o projeto não tem package.json. Cada achado cita o id do requisito para
// quem lê o relatório (pessoa ou agente) ir direto à regra.
//
//   node scripts/verificar.mjs          relatório legível
//   node scripts/verificar.mjs --json   saída para o agente guardião
//
// Sai com 1 se houver FALHA. AVISO não quebra: é dívida conhecida ou heurística
// com falso positivo possível, e o agente decide lendo o código.

import {execFileSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const achados = [];
const falha = (id, arq, linha, msg)=> achados.push({nivel: 'FALHA', id, arq, linha, msg});
const aviso = (id, arq, linha, msg)=> achados.push({nivel: 'AVISO', id, arq, linha, msg});

const ler = (f)=> readFileSync(join(ROOT, f), 'utf8');
// Inclui arquivo novo ainda fora do índice: uma rota nova em api/ ou um .sql novo
// precisa ser checado antes do primeiro commit, não depois.
const git = (args)=> execFileSync('git', args, {cwd: ROOT, encoding: 'utf8'}).split('\n');
const versionados = [...new Set([...git(['ls-files']), ...git(['ls-files', '--others', '--exclude-standard'])])]
  .filter(f=> f && existsSync(join(ROOT, f)) && !f.startsWith('.playwright-mcp/'));
const deTipo = (re)=> versionados.filter(f=> re.test(f));

// Percorre linha a linha; o callback devolve true para registrar a linha.
function cadaLinha(arq, fn){
  ler(arq).split('\n').forEach((l, i)=> fn(l, i + 1));
}

/* ---------- SEC-001: segredos em arquivo versionado ---------- */
const SEGREDOS = [
  [/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/, 'JWT (service role antiga?)'],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'chave secreta do Supabase'],
  [/GOCSPX-[A-Za-z0-9_-]{10,}/, 'client secret do Google'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
  [/(OAUTH_STATE_SECRET|SUPABASE_SERVICE_ROLE_KEY|GOOGLE_CLIENT_SECRET)\s*[=:]\s*['"][^'"]{8,}/, 'segredo atribuído em código']
];
for(const f of deTipo(/\.(js|mjs|html|json|sql|md|css|txt|ya?ml)$/)){
  if(f.startsWith('.claude/skills/')) continue;
  cadaLinha(f, (l, n)=>{
    for(const [re, nome] of SEGREDOS) if(re.test(l)) falha('SEC-001', f, n, `possível ${nome}`);
  });
}
const gi = existsSync(join(ROOT, '.gitignore')) ? ler('.gitignore') : '';
if(!/^\.env\*?$/m.test(gi) || !/^\.env\.\*$/m.test(gi)) falha('SEC-001', '.gitignore', 0, '.env e .env.* precisam estar ignorados');
for(const f of versionados) if(/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.example')) falha('SEC-001', f, 0, 'arquivo .env versionado');

/* ---------- SEC-002: só chave publicável no front ---------- */
for(const f of ['script.js', 'index.html', 'privacidade.html'].filter(f=> versionados.includes(f))){
  cadaLinha(f, (l, n)=>{
    if(/service_role|SERVICE_ROLE/.test(l)) falha('SEC-002', f, n, 'service role mencionada no código do navegador');
  });
}

/* ---------- SEC-003 / SEC-030 / SEC-031 / SEC-032: rotas da API ---------- */
for(const f of deTipo(/^api\/.*\.mjs$/)){
  const nome = f.split('/').pop();
  if(nome.startsWith('_')) continue;
  const src = ler(f);
  const ehCallback = nome === 'callback.mjs';
  if(!ehCallback && !src.includes('userFromRequest(')) falha('SEC-030', f, 0, 'rota sem userFromRequest()');
  if(!ehCallback && !src.includes('allowMethods(')) falha('SEC-031', f, 0, 'rota sem allowMethods()');
  src.split('\n').forEach((l, i)=>{
    if(/\bjson\(/.test(l) && /refresh_token/.test(l)) falha('SEC-003', f, i + 1, 'refresh_token numa resposta');
    if(/\bjson\(/.test(l) && /\be(rr)?\.message\b/.test(l)) falha('SEC-032', f, i + 1, 'e.message no corpo da resposta');
  });
}

/* ---------- SEC-013 / QUA-002 / QUA-003: padrões proibidos no JS ---------- */
for(const f of deTipo(/^(script\.js|api\/.*\.mjs|scripts\/.*\.mjs)$/)){
  if(f === 'scripts/verificar.mjs') continue;
  cadaLinha(f, (l, n)=>{
    const codigo = l.replace(/\/\/.*$/, '');
    if(/\beval\s*\(|new\s+Function\s*\(|set(Timeout|Interval)\s*\(\s*['"`]/.test(codigo)) falha('SEC-013', f, n, 'execução de string como código');
    if(/^\s*debugger\s*;?\s*$/.test(codigo)) falha('QUA-003', f, n, 'debugger esquecido');
    if(/console\.log\(/.test(codigo)) aviso('QUA-002', f, n, 'console.log');
  });
}

/* ---------- SEC-010 (heurística): campo de texto interpolado sem esc() ---------- */
// Só olha campos que costumam carregar texto do usuário. Pega o erro comum
// (${t.title} cru) sem afogar o relatório em ${n} numérico.
const CAMPO_TEXTO = /^[\w.$?[\]'"]*\.(title|name|notes|description|desc|text|content|email|invited_email|owner_email|label|summary|comment|body|location|full_name|username|time|client|code|avatar_url)\b/;
cadaLinha('script.js', (l, n)=>{
  for(const m of l.matchAll(/\$\{([^}]+)\}/g)){
    const expr = m[1].trim();
    // O regex corta no primeiro "}", então um ternário aninhado chega pela metade;
    // se ele já passa por esc() ou só compara valores, não é interpolação crua.
    if(/^(esc|corSegura|encodeURIComponent|Number|parseInt|Math\.)/.test(expr) || /\besc\(|===|!==/.test(expr)) continue;
    if(CAMPO_TEXTO.test(expr) && /[<>]|=\s*["']|innerHTML/.test(l)) aviso('SEC-010', 'script.js', n, `\${${expr}} sem esc()`);
  }
});

/* ---------- SEC-020: scripts externos com versão fixa e SRI ---------- */
for(const f of deTipo(/\.html$/)){
  cadaLinha(f, (l, n)=>{
    const m = l.match(/<script[^>]*\bsrc="(https?:[^"]+)"[^>]*>/);
    if(!m) return;
    if(!/@\d+\.\d+\.\d+/.test(m[1])) falha('SEC-020', f, n, `versão não fixa: ${m[1]}`);
    if(!/\bintegrity="sha(256|384|512)-/.test(m[0])) falha('SEC-020', f, n, 'script externo sem integrity');
    if(!/\bcrossorigin="anonymous"/.test(m[0])) falha('SEC-020', f, n, 'script externo sem crossorigin="anonymous"');
  });
}

/* ---------- SEC-040 / SEC-041 / SEC-042: SQL ---------- */
const sqls = deTipo(/^supabase\/.*\.sql$/);
const sqlTudo = sqls.map(f=> ler(f)).join('\n').toLowerCase();
for(const f of sqls){
  const src = ler(f);
  src.split('\n').forEach((l, i)=>{
    const m = l.toLowerCase().match(/create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?([a-z_][a-z0-9_]*)/);
    if(m){
      const tabela = m[3];
      const re = new RegExp(`alter\\s+table\\s+(if\\s+exists\\s+)?(only\\s+)?(public\\.)?${tabela}\\s+enable\\s+row\\s+level\\s+security`);
      if(!re.test(sqlTudo)) falha('SEC-040', f, i + 1, `tabela ${tabela} sem RLS em nenhum .sql`);
    }
    if(/using\s*\(\s*true\s*\)|with\s+check\s*\(\s*true\s*\)/i.test(l.replace(/--.*$/, ''))){
      // Policy aberta que um arquivo de correção derruba (drop policy) já não vale.
      const nome = (src.split('\n').slice(Math.max(0, i - 3), i + 1).join(' ').match(/create\s+policy\s+"?([\w ]+?)"?\s+on/i) || [])[1];
      const derrubadas = sqls.filter(o=> o !== f).some(o=> nome && new RegExp(`drop\\s+policy\\s+(if\\s+exists\\s+)?"?${nome}"?`, 'i').test(ler(o)));
      if(!derrubadas) aviso('SEC-041', f, i + 1, 'policy aberta: confira se alguma correção posterior a remove');
    }
  });
}
// Uma função pode ser redefinida num arquivo de correção; só é falha se nenhuma
// das definições dela fixa o search_path.
const definicoes = new Map();
for(const f of sqls){
  const partes = ler(f).split(/(?=create\s+(or\s+replace\s+)?function)/i);
  for(const p of partes){
    const m = p.match(/^create\s+(or\s+replace\s+)?function\s+(public\.)?([a-z_][a-z0-9_]*)/i);
    if(!m) continue;
    const cabecalho = p.split(/\$\$|\$[a-z_]+\$/i)[0] + (p.split(/\$\$|\$[a-z_]+\$/i).slice(-1)[0] || '');
    const nome = m[3].toLowerCase();
    const lista = definicoes.get(nome) || [];
    lista.push({f, definer: /security\s+definer/i.test(cabecalho), path: /set\s+search_path/i.test(cabecalho)});
    definicoes.set(nome, lista);
  }
}
// rls_correcoes.sql conserta as antigas com "alter function ... set search_path".
const alteradas = new Set([...sqlTudo.matchAll(/alter\s+function\s+(public\.)?([a-z_][a-z0-9_]*)\s*\([^)]*\)\s*set\s+search_path/g)].map(m=> m[2]));
for(const [nome, lista] of definicoes){
  const definers = lista.filter(d=> d.definer);
  if(definers.length && !definers.some(d=> d.path) && !alteradas.has(nome)) falha('SEC-042', definers[0].f, 0, `função ${nome} é security definer sem search_path fixo`);
}

/* ---------- SEC-012 / SEC-050: cabeçalhos da Vercel ---------- */
try{
  const cfg = JSON.parse(ler('vercel.json'));
  const todos = (cfg.headers || []).find(h=> h.source === '/(.*)');
  const api = (cfg.headers || []).find(h=> /^\/api/.test(h.source));
  const tem = (bloco, k)=> bloco && bloco.headers.find(h=> h.key.toLowerCase() === k.toLowerCase());
  for(const k of ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']){
    if(!tem(todos, k)) falha('SEC-050', 'vercel.json', 0, `falta ${k}`);
  }
  const csp = tem(todos, 'Content-Security-Policy');
  if(!tem(todos, 'X-Frame-Options') && !(csp && /frame-ancestors/.test(csp.value))) falha('SEC-050', 'vercel.json', 0, 'falta proteção contra iframe');
  const cc = tem(api, 'Cache-Control');
  if(!cc || !/no-store/.test(cc.value)) falha('SEC-050', 'vercel.json', 0, '/api/ sem Cache-Control: no-store');
  if(csp){
    const scriptSrc = (csp.value.match(/script-src([^;]*)/) || [])[1] || '';
    if(/'unsafe-inline'|'unsafe-eval'/.test(scriptSrc)) aviso('SEC-012', 'vercel.json', 0, `script-src permite ${scriptSrc.match(/'unsafe-[a-z]+'/g).join(' ')} (dívida conhecida)`);
  }
}catch(e){
  falha('SEC-050', 'vercel.json', 0, `não deu para ler: ${e.message}`);
}

/* ---------- QUA-001: sintaxe ---------- */
for(const f of deTipo(/^(script\.js|api\/.*\.mjs|scripts\/.*\.mjs)$/)){
  try{ execFileSync(process.execPath, ['--check', join(ROOT, f)], {stdio: 'pipe'}); }
  catch(e){ falha('QUA-001', f, 0, String(e.stderr || e.message).split('\n').find(Boolean)); }
}

/* ---------- QUA-020 / QUA-021: marcação ---------- */
for(const f of [...deTipo(/\.html$/), 'script.js']){
  cadaLinha(f, (l, n)=>{
    for(const m of l.matchAll(/<img\s[^>]*>/g)) if(!/\balt=/.test(m[0])) falha('QUA-021', f, n, '<img> sem alt');
    for(const m of l.matchAll(/<(div|span|li|td)\b[^>]*\bonclick=[^>]*>/g)){
      if(!/\brole=/.test(m[0])) aviso('QUA-020', f, n, `<${m[1]} onclick> sem role (use <button>)`);
    }
  });
}

/* ---------- saída ---------- */
const falhas = achados.filter(a=> a.nivel === 'FALHA');
if(process.argv.includes('--json')){
  console.log(JSON.stringify({falhas: falhas.length, avisos: achados.length - falhas.length, achados}, null, 2));
}else{
  const porId = {};
  for(const a of achados) (porId[`${a.nivel} ${a.id}`] ||= []).push(a);
  for(const chave of Object.keys(porId).sort()){
    const lista = porId[chave];
    console.log(`\n${chave} (${lista.length})`);
    for(const a of lista.slice(0, 15)) console.log(`  ${a.arq}${a.linha ? ':' + a.linha : ''}  ${a.msg}`);
    if(lista.length > 15) console.log(`  … mais ${lista.length - 15} (use --json)`);
  }
  console.log(`\n${falhas.length} falha(s), ${achados.length - falhas.length} aviso(s).`);
}
process.exit(falhas.length ? 1 : 0);
