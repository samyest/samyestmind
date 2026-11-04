import {userFromRequest, getCredential, deleteCredential, buscar, json, fail, allowMethods} from '../_lib.mjs';

export default async function handler(req, res){
  if(!allowMethods(req, res, ['POST'])) return;
  try{
    const user = await userFromRequest(req);
    if(!user) return json(res, 401, {error: 'não autenticado'});

    const cred = await getCredential(user.id);
    if(cred && cred.refresh_token){
      // Revoga do lado do Google também, senão o acesso continua concedido lá.
      // Prazo curto: um Google lento não pode impedir que a credencial saia
      // do banco logo abaixo.
      try{
        await buscar('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: new URLSearchParams({token: cred.refresh_token})
        }, 4000);
      }catch(e){}
    }
    await deleteCredential(user.id);
    json(res, 200, {ok: true});
  }catch(e){
    fail(res, e, 'google/disconnect');
  }
}
