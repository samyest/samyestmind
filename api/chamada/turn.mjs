import {userFromRequest, bearerToken, selectComoUsuario, rpcAdmin, env, json, fail, allowMethods, readJson} from '../_lib.mjs';

// Credencial TURN da Cloudflare para uma chamada de projeto (RFC 0002, SEC-077).
// O TURN só repassa áudio e vídeo quando a conexão direta entre as pessoas não
// é possível. A credencial vale 1 hora; o app pede outra aos 45 minutos, e
// cada pedido repete todas as checagens abaixo.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALIDADE_SEG = 3600;
const LIMITE_POR_HORA = 20;

// Projeto de que a pessoa é dona ou membro aceito, com pelo menos mais uma
// pessoa. Lido com o token dela: o RLS de projects e project_members decide o
// que volta.
async function podeChamar(token, userId, projectId){
  const projetos = await selectComoUsuario(token, `projects?id=eq.${projectId}&select=id,owner_id`);
  const p = projetos[0];
  if(!p) return false;
  const membros = await selectComoUsuario(token, `project_members?project_id=eq.${projectId}&status=eq.accepted&select=user_id`);
  const aceitos = new Set(membros.map(m=> m.user_id).filter(id=> id && id !== p.owner_id));
  const participa = p.owner_id === userId || aceitos.has(userId);
  return participa && aceitos.size >= 1;
}

// Só os campos que o RTCPeerConnection usa. Os endereços na porta 53 saem:
// os navegadores não usam essa porta, e tentar só atrasa a conexão.
function servidoresLimpos(bruto){
  const lista = Array.isArray(bruto) ? bruto : (bruto ? [bruto] : []);
  return lista.map(s=>{
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls])
      .filter(u=> typeof u === 'string' && /^(stun|turns?):/.test(u) && !/:53(\?|$)/.test(u));
    const limpo = {urls};
    if(typeof s.username === 'string') limpo.username = s.username;
    if(typeof s.credential === 'string') limpo.credential = s.credential;
    return limpo;
  }).filter(s=> s.urls.length);
}

export default async function handler(req, res){
  if(!allowMethods(req, res, ['POST'])) return;
  try{
    const user = await userFromRequest(req);
    if(!user) return json(res, 401, {error: 'não autenticado'});

    const body = readJson(req);
    const projectId = body && typeof body.project_id === 'string' ? body.project_id : '';
    if(!UUID_RE.test(projectId)) return json(res, 400, {error: 'projeto inválido'});

    // Sem a chave configurada, a chamada segue só com STUN. O app reconhece o
    // sem_turn e avisa que em algumas redes a conexão pode não sair.
    if(!process.env.TURN_KEY_ID || !process.env.TURN_KEY_API_TOKEN){
      return json(res, 503, {error: 'TURN não configurado', sem_turn: true});
    }

    if(!await podeChamar(bearerToken(req), user.id, projectId)){
      return json(res, 403, {error: 'sem acesso a chamadas neste projeto'});
    }

    const liberado = await rpcAdmin('registrar_emissao_turn', {p_user: user.id, p_projeto: projectId, p_limite: LIMITE_POR_HORA});
    if(liberado !== true){
      res.setHeader('Retry-After', '3600');
      return json(res, 429, {error: 'limite de credenciais por hora atingido'});
    }

    const cf = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env('TURN_KEY_ID'))}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${env('TURN_KEY_API_TOKEN')}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({ttl: VALIDADE_SEG})
    });
    if(!cf.ok) throw new Error(`Cloudflare TURN respondeu ${cf.status}: ${await cf.text()}`);
    const dados = await cf.json();

    json(res, 200, {
      iceServers: servidoresLimpos(dados.iceServers),
      expira_em: new Date(Date.now() + VALIDADE_SEG * 1000).toISOString()
    });
  }catch(e){
    fail(res, e, 'chamada/turn');
  }
}
