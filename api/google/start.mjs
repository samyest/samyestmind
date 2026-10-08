import {userFromRequest, signState, redirectUri, env, json, fail, allowMethods, GOOGLE_SCOPE} from '../_lib.mjs';

// Monta a URL de consentimento do Google. O cliente chama isto autenticado e
// depois navega para a URL devolvida — a identidade vai no state assinado, então
// o callback não precisa confiar em nada que volte do navegador.
export default async function handler(req, res){
  if(!allowMethods(req, res, ['GET'])) return;
  try{
    const user = await userFromRequest(req);
    if(!user) return json(res, 401, {error: 'não autenticado'});

    const params = new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      redirect_uri: redirectUri(req),
      response_type: 'code',
      scope: GOOGLE_SCOPE,
      access_type: 'offline',      // pede o refresh token
      prompt: 'consent',           // garante que o refresh token venha mesmo em reconexões
      include_granted_scopes: 'true',
      state: signState(user.id)
    });

    json(res, 200, {url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`});
  }catch(e){
    fail(res, e, 'google/start');
  }
}
