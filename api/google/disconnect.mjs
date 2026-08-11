import {userFromRequest, getCredential, deleteCredential, json} from '../_lib.mjs';

export default async function handler(req, res){
  try{
    const user = await userFromRequest(req);
    if(!user) return json(res, 401, {error: 'não autenticado'});

    const cred = await getCredential(user.id);
    if(cred && cred.refresh_token){
      // Revoga do lado do Google também, senão o acesso continua concedido lá.
      try{
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: new URLSearchParams({token: cred.refresh_token})
        });
      }catch(e){}
    }
    await deleteCredential(user.id);
    json(res, 200, {ok: true});
  }catch(e){
    json(res, 500, {error: e.message});
  }
}
