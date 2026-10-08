import crypto from 'node:crypto';

// Arquivos em /api começando com "_" não viram endpoints — só código compartilhado.

// Só eventos: o app não cria nem apaga calendários desde que passou a usar a
// agenda principal. Pedir o escopo amplo daria acesso a mais do que se usa e
// pesa contra na revisão do Google.
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export function env(name){
  const v = process.env[name];
  if(!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

// x-forwarded-host vem do cliente. Se o Location do callback for montado a
// partir dele sem checagem, dá para levar o usuário autenticado para outro
// domínio. Ordem: APP_ORIGIN > origem do GOOGLE_REDIRECT_URI > header, e o
// header só passa se tiver forma de hostname.
const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/i;

function configuredOrigin(){
  if(process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/+$/, '');
  if(process.env.GOOGLE_REDIRECT_URI){
    try{ return new URL(process.env.GOOGLE_REDIRECT_URI).origin; }catch(e){}
  }
  if(process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return null;
}

export function appOrigin(req){
  const fixed = configuredOrigin();
  if(fixed) return fixed;
  const proto = req.headers['x-forwarded-proto'] === 'http' ? 'http' : 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  if(!HOST_RE.test(host)) throw new Error('host inválido');
  return `${proto}://${host}`;
}

export function redirectUri(req){
  if(process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  return `${appOrigin(req)}/api/google/callback`;
}

/* ---------- state assinado (CSRF + identidade do usuário) ---------- */

export function signState(userId){
  const payload = `${userId}.${Date.now() + 10 * 60 * 1000}`;
  const mac = crypto.createHmac('sha256', env('OAUTH_STATE_SECRET')).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${mac}`;
}

export function verifyState(state){
  if(typeof state !== 'string' || !state.includes('.')) return null;
  const idx = state.lastIndexOf('.');
  const encoded = state.slice(0, idx);
  const mac = state.slice(idx + 1);
  let payload;
  try{ payload = Buffer.from(encoded, 'base64url').toString('utf8'); }
  catch(e){ return null; }

  const expected = crypto.createHmac('sha256', env('OAUTH_STATE_SECRET')).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [userId, expiresAt] = payload.split('.');
  if(!userId || !expiresAt || Date.now() > Number(expiresAt)) return null;
  return userId;
}

/* ---------- Supabase (via REST, sem dependências) ---------- */

// Confirma que o Bearer token vem mesmo de um usuário logado no Supabase.
// Nunca confie num user_id enviado pelo cliente — sempre derive daqui.
export async function userFromRequest(req){
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if(!token) return null;
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env('SUPABASE_ANON_KEY')
    }
  });
  if(!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user : null;
}

function adminHeaders(){
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  };
}

// null = o usuário não tem credencial. Falha ao consultar NÃO é "sem
// credencial": devolver null aqui fazia o app concluir que a conta foi
// desconectada e parar o sync por causa de uma instabilidade do Supabase.
export async function getCredential(userId){
  const url = `${env('SUPABASE_URL')}/rest/v1/google_credentials?user_id=eq.${encodeURIComponent(userId)}&select=*`;
  const res = await fetch(url, {headers: adminHeaders()});
  if(!res.ok) throw new Error(`Falha ao ler credencial: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null;
}

export async function saveCredential(userId, patch){
  const url = `${env('SUPABASE_URL')}/rest/v1/google_credentials`;
  const res = await fetch(url, {
    method: 'POST',
    headers: Object.assign(adminHeaders(), {Prefer: 'resolution=merge-duplicates,return=representation'}),
    body: JSON.stringify([Object.assign({user_id: userId, updated_at: new Date().toISOString()}, patch)])
  });
  if(!res.ok) throw new Error(`Falha ao salvar credencial: ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null;
}

export async function deleteCredential(userId){
  const url = `${env('SUPABASE_URL')}/rest/v1/google_credentials?user_id=eq.${encodeURIComponent(userId)}`;
  const res = await fetch(url, {method: 'DELETE', headers: adminHeaders()});
  // Sem esta checagem o disconnect respondia ok com a credencial ainda no
  // banco, e a conexão "voltava sozinha" no próximo carregamento.
  if(!res.ok) throw new Error(`Falha ao apagar credencial: ${res.status} ${await res.text()}`);
}

/* ---------- Google ---------- */

// Falha passageira ao renovar o token (rede, cota, instabilidade do Google).
// As rotas respondem 503 para o app tentar de novo depois, em vez de
// {connected:false}, que o app trata como conta desconectada.
export class TransientError extends Error {}

// Access tokens duram ~1h; o refresh token guardado gera novos indefinidamente,
// que é o que mantém a conexão viva sem o usuário reconectar.
// null = não há conexão (nunca houve, ou o Google revogou o refresh token).
export async function freshAccessToken(userId){
  const cred = await getCredential(userId);
  if(!cred) return null;

  const stillValid = cred.access_token && cred.expires_at && new Date(cred.expires_at).getTime() - 60000 > Date.now();
  if(stillValid) return cred.access_token;

  let res;
  try{
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        client_id: env('GOOGLE_CLIENT_ID'),
        client_secret: env('GOOGLE_CLIENT_SECRET'),
        refresh_token: cred.refresh_token,
        grant_type: 'refresh_token'
      })
    });
  }catch(e){
    throw new TransientError(`Google token indisponível: ${e.message}`);
  }

  if(!res.ok){
    // Só apaga a credencial quando o Google confirma que o refresh token
    // morreu mesmo (invalid_grant). Qualquer outro erro (rede, cota,
    // instabilidade momentânea do Google) também vem como 400/401, mas é
    // passageiro — apagar aqui de novo derrubava a conexão à toa e o
    // usuário precisava reconectar bem mais que a cada 7 dias.
    let code = null;
    try{ code = (await res.json()).error; }catch(e){}
    if(code === 'invalid_grant'){
      await deleteCredential(userId);
      return null;
    }
    throw new TransientError(`Google recusou a renovação (${res.status} ${code || 'sem código'})`);
  }

  const tok = await res.json();
  const expiresAt = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();
  await saveCredential(userId, {access_token: tok.access_token, expires_at: expiresAt});
  return tok.access_token;
}

export function json(res, status, body){
  res.status(status).setHeader('Content-Type', 'application/json');
  // Toda resposta destas rotas é por usuário e algumas carregam access token —
  // nenhuma pode ficar em cache de CDN ou de navegador.
  res.setHeader('Cache-Control', 'no-store, private');
  res.end(JSON.stringify(body));
}

// e.message vaza detalhe interno (nome de variável de ambiente ausente, resposta
// crua do Supabase). O detalhe fica no log da função; o cliente recebe genérico.
export function fail(res, e, tag){
  console.error(`[${tag}]`, e);
  if(e instanceof TransientError){
    res.setHeader('Retry-After', '60');
    return json(res, 503, {error: 'Google indisponível no momento. Tentando de novo em instantes.', transient: true});
  }
  json(res, 500, {error: 'Erro interno. Tente de novo em instantes.'});
}

// Cada rota aceita só os métodos que usa. As outras recebem 405 em vez de
// executar o handler (um GET em /disconnect não deve desconectar nada).
export function allowMethods(req, res, methods){
  if(methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  json(res, 405, {error: 'método não permitido'});
  return false;
}

// A Vercel entrega req.body já parseado quando o Content-Type é JSON, mas
// cai em string (ou nada) em outros casos. Corpo inválido vira null, não 500.
export function readJson(req){
  if(req.body && typeof req.body === 'object') return req.body;
  if(typeof req.body !== 'string' || !req.body) return {};
  try{
    const v = JSON.parse(req.body);
    return v && typeof v === 'object' ? v : null;
  }catch(e){ return null; }
}
