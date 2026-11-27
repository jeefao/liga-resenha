# Substituição por lesão e W.O. — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar um atleta classificado que não pode jogar o mata-mata (melhor eliminado ou atleta do cadastro) e marcar W.O. em jogos do mata-mata.

**Architecture:** Tudo em `index.html` (app de arquivo único). Trocas e W.O. ficam em `dados.subs` e `dados.wo` da liga; uma única função monta as duplas do mata-mata aplicando as trocas, e as 4 telas/saídas (aba Mata-mata/Chave, `chaveAtual`, `pontosDaEtapa`, folhas) passam a usá-la. Sem SQL.

**Tech Stack:** JS puro; testes de navegador com puppeteer-core + mock do Supabase (scratchpad `swtest/`).

**Spec:** `docs/superpowers/specs/2026-11-26-substituicao-lesao-design.md`

## Global Constraints
- Nunca alterar `S.names`, `S.ids` ou `S.scores` ao substituir.
- Salvar sempre via `persist([...eventos])` (mostra "salvo" só após o servidor).
- Atleta de fora da liga ganha índice virtual `capacity()+k` (k = ordem em `S.subs`), usado só no mata-mata.
- Versão `6.4.0`, cache `liga-resenha-v6-pwa-10`.

## Review Focus
- Liga antiga sem `subs`/`wo` abre e funciona igual (teste: dados sem as chaves).
- Mesmo atleta não pode entrar duas vezes nem entrar quem já está no mata-mata (teste: segunda troca com o mesmo atleta é recusada).
- Alterar placar dos grupos depois da troca limpa `subs` e `wo` (teste).
- Substituir dupla que já tem placar no mata-mata é bloqueado (teste).
- Temporada: substituto externo com id recebe pontos do mata-mata; quem saiu mantém só grupos (teste).

---

### Task 1: Dados e montagem das duplas com trocas

**Files:** Modify `index.html` (normalização ~l.270, `dadosParaServidor` ~l.283, nomes ~l.1637, `nomesCurtos`, `aplicarPlacar`, `chaveAtual`, `renderKnockout`, `pontosDaEtapa`, `corpoChave`). Test: `swtest/teste-subs.mjs`.

**Interfaces — Produces:**
- `nomeCompleto(i) -> string` (posição normal ou virtual); `name`, `rawName`, `wNome`, `nomesCurtos()` passam a cobrir índices virtuais.
- `idDe(i) -> uuid|null`.
- `classificadosGerais() -> {duos:number[][], fora:number[]} | null` — duos **já com trocas aplicadas**; `fora` = eliminados em ordem de classificação geral (sem os que entraram).
- `melhorEliminado() -> number|null`.
- `duplaTemPlacar(d) -> boolean` (dupla d=0..7 já tem placar em alguma quartas).

- [ ] Teste: liga 20 atletas com grupos completos → `melhorEliminado()` é o 1º de `fora`; com `S.subs=[{sai:duos[0][0],entra:X}]`, `classificadosGerais().duos[0]` contém X no lugar; `S.names` inalterado; liga sem `subs` igual a antes.
- [ ] Rodar → falha. Implementar. Rodar → passa.
- [ ] `aplicarPlacar` em `scores` com `subs`/`wo` existentes: aviso passa a citar trocas; limpa `S.subs=[]`, `S.wo={}` junto com `S.finals`. Teste.

### Task 2: Telas — Substituir, desfazer e W.O.

**Files:** Modify `index.html` (`duoCards`, `scorecard` para `finals`, modal novo `abrirSubstituicao(d)`, `aplicarSubstituicao`, `desfazerSubstituicao(k)`, `marcarWO(id,lado)`, `textoWhatsApp`, `corpoChave`). Test: `swtest/teste-subs.mjs`.

**Interfaces — Consumes:** Task 1. **Produces:** `abrirSubstituicao(d:number)`, `marcarWO(id:string, lado:0|1)`.

- [ ] Teste: em cada dupla sem placar aparece "Substituir"; modal lista os 2 atletas da dupla e sugere `melhorEliminado()`; aceita atleta do cadastro (vira índice virtual com `atleta:{id,nome}`); salvar grava `subs` e evento "Substituição: Sai X (lesão) → Entra Y"; desfazer remove; dupla com placar não mostra "Substituir"; mesmo atleta duas vezes recusado.
- [ ] Teste W.O.: `marcarWO('q1',1)` grava `finals.q1=[6,0]` e `wo.q1=1`; placar mostra "W.O."; apagar o placar remove o `wo`.
- [ ] Rodar → falha. Implementar. Rodar → passa.

### Task 3: Pontos da temporada

**Files:** Modify `pontosDaEtapa` (`index.html` ~l.801). Test: `swtest/teste-subs.mjs`.

- [ ] Teste: substituto da liga = pontos de grupo + mata-mata; externo com id = só mata-mata (aparece no ranking por id); quem saiu = só grupos/posição.
- [ ] Rodar → falha. Implementar. Rodar → passa.

### Task 4: Regressão, versão e publicação
- [ ] Rodar `teste-folhas2/ordem/placar/temporadas/atletas` e `npx vitest run` → todos passam.
- [ ] Versão 6.4.0 / pwa-10; atualizar `docs/regras-temporada.md` com a regra de substituição.
- [ ] Mostrar resumo ao usuário; commit e publicação só com autorização.
