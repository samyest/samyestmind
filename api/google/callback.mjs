import {verifyState, saveCredential, redirectUri, appOrigin, env} from '../_lib.mjs';

function back(res, origin, status){
  res.status(302).setHeader('Location', `${origin}/?google=${status}`);
  res.setHeader('Cache-Control', 'no-store, private');
  res.end();
}

// O Google redireciona pra cá depois do consentimento. Troca o código pelos
// tokens e guarda o refresh token — que nunca chega ao navegador.
export default async function handler(req, res){
  let origin;
  try{ origin = appOrigin(req); }
  catch(e){ res.status(400); res.end('host inválido'); return; }
  const {code, state, error} = req.query || {};

  if(error) return back(res, origin, 'negado');
  if(!code || !state) return back(res, origin, 'erro');

  const userId = verifyState(state);
  if(!userId) return back(res, origin, 'expirado');

  try{
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        code,
        client_id: env('GOOGLE_CLIENT_ID'),
        client_secret: env('GOOGLE_CLIENT_SECRET'),
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code'
      })
    });

    if(!tokenRes.ok){
      // Sem log, um redirect_uri ou secret errado na Vercel vira só "erro" na
      // tela e nenhuma pista no painel.
      console.error('[google/callback] troca do código falhou', tokenRes.status, await tokenRes.text());
      return back(res, origin, 'erro');
    }
    const tok = await tokenRes.json();
    if(!tok.refresh_token) return back(res, origin, 'sem_refresh');

    await saveCredential(userId, {
      refresh_token: tok.refresh_token,
      access_token: tok.access_token || null,
      expires_at: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
      connected_at: new Date().toISOString()
    });

    back(res, origin, 'ok');
  }catch(e){
    console.error('[google/callback]', e);
    back(res, origin, 'erro');
  }
}
