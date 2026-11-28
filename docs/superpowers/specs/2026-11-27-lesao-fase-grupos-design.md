# Lesão na fase de grupos e W.O. com placar parcial — design

## Por quê
A 6.4.0 resolveu o atleta que se machuca **depois** dos grupos. Falta o caso mais comum: alguém se machuca
**durante um jogo** (em qualquer fase) ou no meio da fase de grupos e não pode jogar os jogos seguintes.

## Regra (decidida pelo organizador em 27/11)
- **Lesão durante o jogo = W.O., em qualquer fase.** O placar não é 6x0: a dupla de quem se machucou fica com
  os games que tinha e o adversário fica com 6 (2x4 → 2x6; 5x1 → 5x6). Dupla que nem entrou em quadra = 0x6.
  *(Decisão do Claude:)* final e 3º lugar vão até 7 — se a dupla tinha 6, o adversário fica com 7.
- **Grupos — próximos jogos de quem se machucou:** entra alguém no lugar dele.
  - **Atleta da liga** (de outro grupo): joga, mas não pontua e não soma no grupo; o jogo conta normalmente
    para o parceiro e os adversários.
  - **Atleta de fora** (cadastrado no app, inclusive na hora): os jogos dele contam, ele entra na tabela do
    grupo e **pode classificar** — com os jogos que fez, pelos mesmos critérios (V, SG, GP).
- **Quem se machucou** fica com os jogos e pontos que fez (inclusive a derrota por W.O.), aparece na tabela
  marcado como lesionado e **não ocupa vaga no mata-mata**: a vaga vai para o próximo.
  *(Decisão do Claude:)* ele não recebe pontos de posição no grupo. Se não houver próximo (ex.: liga de 16 com
  substituto da liga), ele segura a vaga e o organizador usa o Substituir da 6.4.0 no mata-mata.

## Como (decidido)
- `dados.wo[idDoJogo] = ladoQueSaiu` vale também para jogos de grupo; o W.O. é desfeito apagando o placar.
- `dados.gsubs = [{pos, jogo, entra, atleta:{id,nome}|null, motivo, em}]`: a partir do jogo `jogo` (0..2) do grupo,
  quem joga na posição `pos` é `entra` (posição de outro grupo, ou posição virtual de atleta de fora — o mesmo
  espaço de posições virtuais da 6.4.0).
- `games(g)` devolve os jogos já com quem realmente jogou; a classificação do grupo considera só quem pode
  classificar (membros não lesionados + atleta de fora daquele grupo).
- Faltando gente para 16 vagas, a vaga passa ao melhor que sobrou; sem ninguém, o lesionado segura a vaga.
- Só dá para colocar/desfazer substituto enquanto os jogos seguintes daquela posição não têm placar.
- Alterar placar dos grupos continua apagando o mata-mata, as trocas do mata-mata e os W.O. do mata-mata;
  os W.O. e substitutos dos grupos ficam.

## Fora do escopo
- Substituto do substituto nos grupos; mudar a ordem dos jogos.
