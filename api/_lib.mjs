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

export function redirectUri(req){
  if(process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/google/callback`;
}

export function appOrigin(req){
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
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

export async function getCredential(userId){
  const url = `${env('SUPABASE_URL')}/rest/v1/google_credentials?user_id=eq.${userId}&select=*`;
  const res = await fetch(url, {headers: adminHeaders()});
  if(!res.ok) return null;
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
  const url = `${env('SUPABASE_URL')}/rest/v1/google_credentials?user_id=eq.${userId}`;
  await fetch(url, {method: 'DELETE', headers: adminHeaders()});
}

/* ---------- Google ---------- */

// Access tokens duram ~1h; o refresh token guardado gera novos indefinidamente,
// que é o que mantém a conexão viva sem o usuário reconectar.
export async function freshAccessToken(userId){
  const cred = await getCredential(userId);
  if(!cred) return null;

  const stillValid = cred.access_token && cred.expires_at && new Date(cred.expires_at).getTime() - 60000 > Date.now();
  if(stillValid) return cred.access_token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: cred.refresh_token,
      grant_type: 'refresh_token'
    })
  });

  if(!res.ok){
    // Refresh token revogado ou expirado: a conexão morreu de vez.
    if(res.status === 400 || res.status === 401) await deleteCredential(userId);
    return null;
  }

  const tok = await res.json();
  const expiresAt = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();
  await saveCredential(userId, {access_token: tok.access_token, expires_at: expiresAt});
  return tok.access_token;
}

export function json(res, status, body){
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
