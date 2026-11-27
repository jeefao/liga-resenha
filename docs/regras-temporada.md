# Regras da Temporada — Liga Resenha (base: 3ª temporada)

Fonte: regulamento da 3ª temporada + confirmações do organizador em 22/11/2026.
Estas regras viram o **padrão** das novas temporadas; cada temporada guarda a sua
própria cópia e pode ajustá-la.

## Etapa (rodada)
- 16 a 32 atletas, múltiplos de 4, grupos de 4.
- No grupo: todos jogam entre si com duplas alternadas, 3 partidas por atleta; não há empate.
- Menos de 16 inscritos: cancelar ou fazer **rodada relâmpago** (sem pontos no ranking).

## Classificação para o mata-mata (sempre 16 atletas → 8 duplas)
| Atletas | Classificados |
|---|---|
| 16 | todos (4 primeiros, 4 segundos, 4 terceiros, 4 quartos) |
| 20 | 3 primeiros de cada grupo + melhor 4º |
| 24 | 2 primeiros de cada grupo + 4 melhores 3º |
| 28 | 2 primeiros de cada grupo + 2 melhores 3º |
| 32 | 2 primeiros de cada grupo |

Confirmado pelo organizador: **sempre passam 16 atletas** para o mata-mata (com 16 inscritos, todos avançam).

## Desempate (individual)
1. Vitórias; 2. Saldo de games; 3. Games pró;
4. **Confronto direto**: saldo de games de cada atleta nas partidas em que os dois jogaram um contra o outro;
5/6. Desempate manual (simples até 4 pontos ou sorteio) — o app só registra quem venceu, sem método.

## Duplas e chave
- Igual à Liga Relâmpago: melhores primeiros juntos, melhores segundos juntos etc.; posição ímpar
  completa com o melhor disponível da posição seguinte.
- Quartas (ordem da planilha): Q1 = D1×D8 (1-2 × 15-16), Q2 = D3×D6 (5-6 × 11-12), Q3 = D4×D5 (7-8 × 9-10), Q4 = D2×D7 (3-4 × 13-14). Semis: V(Q1)×V(Q2), V(Q3)×V(Q4). Final e 3º lugar. Ligas que já tinham placar no mata-mata antes dessa mudança (v6.3.1) seguem a ordem antiga (D1×D8, D4×D5, D2×D7, D3×D6).
- **Atleta machucado (substituição, v6.4.0)**: se um classificado não puder jogar o mata-mata, entra
  o **melhor eliminado** da classificação geral (mesmos critérios V, SG, GP), no mesmo lugar e com o
  mesmo parceiro. Sem eliminado disponível (liga de 16) ou por escolha do organizador, pode entrar
  qualquer atleta ativo do cadastro. A troca só vale **antes de a dupla jogar** no mata-mata; depois
  disso, a dupla perde o próximo jogo por **W.O.** (6×0). Os jogos dos grupos nunca mudam; alterar
  placar ou desempate dos grupos apaga o mata-mata, as trocas e os W.O. A troca pode ser desfeita e
  fica no histórico.
  - Pontos: quem saiu fica com os pontos dos grupos (e posição); o substituto soma os seus pontos
    dos grupos com os do mata-mata que conquistar; atleta de fora da liga recebe só os pontos do
    mata-mata; o parceiro não perde nada.
- **Etapas especiais (padrão: 3 e 7)**: a partir da semifinal as duplas são sorteadas antes de
  cada partida, sem repetir o parceiro da partida anterior. O app oferece **sorteio automático**
  (com a trava) ou **preenchimento manual** (sorteio com o saco de bolas).

## Placar
- Grupos e mata-mata: set até 6 (tie-break em 5×5 → 6×5).
- 3º lugar e final: até 7 em 5×5; tie-break em 6×6 → 7×6.

## Pontuação da etapa (por atleta, tudo soma)
| Item | Pontos |
|---|---|
| Vitória na partida | +1 |
| Vitória por 6×0 | +1 bônus |
| Derrota por 0×6 | −1 |
| Posição no grupo | 1º 12 • 2º 10 • 3º 7 • 4º 5 |
| Quartas | participação +1 • vitória +1 |
| Semifinal | participação +1 • vitória +2 |
| 3º lugar | participação +1 • vitória +1 |
| Final | participação +3 • campeão +3 |

Exemplo de campeão no mata-mata: (1+1) + (1+2) + (3+3) = 11, mais os pontos dos grupos.

## Ranking da temporada
- Padrão: 10 etapas; 5ª etapa vale o dobro; 1 descarte (menor pontuação, ausência = 0).
- **Ajustável por temporada**: ter ou não descarte, quantos, e quanto vale a ausência
  (0 ou a menor pontuação possível jogando). Etapas dobradas configuráveis.

## Ajustes e situações
- Atraso de mais de 10 min na confirmação: −5 no ranking (ajuste manual com motivo).
- W.O./desistência na partida: derrota da dupla do desistente; adversário vence com 6 games;
  games do desistente mantidos. **Substituto da Liga não gera pontos para ninguém.**
- Ausência sem aviso: suspensão de 3 etapas (controle de suspensão).
- **Convidados**: até 3 etapas; para entrar precisa chegar a uma semifinal; nova tentativa só após 4 etapas.
