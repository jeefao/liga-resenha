# Lesão na fase de grupos — Implementation Plan

**Goal:** W.O. com placar parcial em todas as fases e substituto nos jogos seguintes da fase de grupos.
**Spec:** `docs/superpowers/specs/2026-11-27-lesao-fase-grupos-design.md`
**Architecture:** tudo em `index.html`; dados em `dados.wo` (grupos e mata-mata) e `dados.gsubs`. `games(g)` aplica os
substitutos; `rank(g)` só com quem pode classificar; `classificadosGerais` completa as 16 vagas.
**Tests:** `swtest/teste-grupos-lesao.mjs` (puppeteer + mock).

## Global Constraints
- Nunca alterar `S.names`, `S.ids`; nunca mostrar salvo antes do servidor (`persist`).
- Liga sem `gsubs`/`wo` funciona igual. Versão `6.5.0`, cache `liga-resenha-v6-pwa-11` (inclui a correção da tela 6.4.1).

## Review Focus
- Liga antiga abre igual (regressão completa). Substituto da liga não pontua no grupo dele nem no outro.
- Liga de 16 com substituto da liga ainda forma 16 vagas. Desfazer bloqueado com jogo seguinte lançado.

### Task 1: W.O. com games — `placarWO(id,kind,games)`, `marcarWO(id,lado,games)`, modal `abrirWO(id,kind)`
- [ ] Teste: grupo 2 games → [2,6]/[6,2] conforme lado; final com 6 → 7; wo gravado; apagar placar remove; mata-mata idem.
### Task 2: Substituto nos grupos — `substituirNoGrupo(pos,jogo,sel,motivo)`, `desfazerGrupo(k)`, `games`, `rank`, `listsGeneral`, `classificadosGerais`
- [ ] Teste: liga sub não soma; externo soma e classifica; lesionado fora das vagas; liga de 16 completa as vagas.
### Task 3: Telas — botão "Lesão / W.O." nos jogos, aviso de substituto com Desfazer, lesionado na classificação.
### Task 4: Pontos — jogos por quem jogou; externo com id no ranking; lesionado sem pontos de posição.
### Task 5: Regressão, versão, docs, resumo; commit e publicação só com autorização.
