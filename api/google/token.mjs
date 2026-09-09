import {userFromRequest, freshAccessToken, getCredential, saveCredential, json, fail} from '../_lib.mjs';

// Devolve ao navegador um access token curto (~1h), renovando pelo refresh token
// guardado quando necessário. Também carrega/persiste o id do calendário e o
// syncToken, que precisam sobreviver entre dispositivos.
export default async function handler(req, res){
  try{
    const user = await userFromRequest(req);
    if(!user) return json(res, 401, {error: 'não autenticado'});

    if(req.method === 'PATCH'){
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const patch = {};
      const str = (v)=> typeof v === 'string' && v.length <= 512 ? v : null;
      if('calendar_id' in body) patch.calendar_id = str(body.calendar_id);
      if('sync_token' in body) patch.sync_token = str(body.sync_token);
      if(Object.keys(patch).length) await saveCredential(user.id, patch);
      return json(res, 200, {ok: true});
    }

    const cred = await getCredential(user.id);
    if(!cred) return json(res, 200, {connected: false});

    const accessToken = await freshAccessToken(user.id);
    if(!accessToken) return json(res, 200, {connected: false});

    json(res, 200, {
      connected: true,
      access_token: accessToken,
      calendar_id: cred.calendar_id || null,
      sync_token: cred.sync_token || null,
      connected_at: cred.connected_at || null
    });
  }catch(e){
    fail(res, e, 'google/token');
  }
}
