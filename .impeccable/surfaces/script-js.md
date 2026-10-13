---
version: 1
slug: "script-js"
primary_target: "script.js"
related_targets: ["index.html","styles.css"]
---

# Metas (barra lateral, criação passo a passo, página da meta)

Modo: Operate. Extensão do mundo visual existente (vidro, temas, Space Grotesk + Inter); nada de identidade nova.

Público e tarefa: só a conta do dono. Criar uma meta em segundos a partir do + ao lado de "Metas" na barra lateral e registrar avanço em um toque na página dela. "Projetos" ganha o mesmo + (todas as contas).

Decidido com o usuário: quatro tipos (número, hábito, etapas, feito/não feito); hábito vira rotina e as tarefas concluídas da rotina contam; Desafio entra como primeiro item de Metas; metas só na conta do dono (RLS por email).

Fora do escopo: as metas internas do Desafio; projetos além do +.

## Direction contract

THESIS: Criar uma meta é responder poucas perguntas, uma por vez, tocando em respostas prontas; a página da meta muda de forma conforme o tipo. Recusa o formulário longo com todos os campos de uma vez e o painel de cards de métrica.

OWN-WORLD: O vidro do app (--modal-glass, blur, borda suave), Space Grotesk nos títulos e Inter no resto, o accent do tema só no que está selecionado e nas ações, e a cor da área da meta como único toque de cor por meta. Cartões de escolha grandes com ícone de traço, nome e um exemplo em texto suave; progresso como barra fina.

STORY: O dono toca o + ao lado de Metas, escolhe o tipo, dá nome, define a medida e o prazo, revisa e cria. A meta entra na barra lateral com o progresso, e a página dela recebe o avanço em um toque.

FIRST VIEWPORT: Modal de vidro de 560px; no topo, "Nova meta" e os pontos de progresso; a pergunta em 20px Space Grotesk; grade 2×2 de cartões de tipo; rodapé com Voltar e Continuar (accent). No celular, folha inferior com a mesma grade.

FORM: Passo a passo, posição 3 da lista ordenada; seed key b317d5ae. Interação-assinatura: tocar uma resposta avança o passo numa transição lateral de 200ms.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
