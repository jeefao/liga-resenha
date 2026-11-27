# Substituição por lesão e W.O. no mata-mata — design

## Por quê
Na Relâmpago de 23/11 um atleta se machucou depois de jogar e classificar na fase de grupos e não pôde jogar o mata-mata. O app não tinha como trocar o atleta; a troca foi feita "na mão". A regra precisa ser justa, rápida de aplicar na quadra e refletir certo na chave, nas folhas, no WhatsApp e no ranking da temporada.

## Regra (decidida pelo organizador)
- **Quem entra:** o melhor atleta que ficou fora do corte, pelos mesmos critérios da classificação geral (V, SG, GP) — o primeiro eliminado da lista geral. O app sugere; o organizador confirma.
- **Sem eliminado disponível** (liga de 16) **ou por escolha do organizador:** botão de substituição permite escolher qualquer atleta do cadastro.
- **Onde entra:** exatamente no lugar de quem saiu — mesmo parceiro, mesma posição na chave. Nenhuma outra dupla muda.
- **Quando:** só antes de a dupla ter placar no mata-mata. Depois disso, a dupla perde o próximo jogo por **W.O.**
- **Pontos na temporada:** quem sai fica com os pontos dos grupos (e posição); o substituto que jogou a liga soma seus pontos dos grupos com os do mata-mata que conquistar; o parceiro não perde nada. *(Decisão do Claude, corrigível:)* atleta de fora da liga também recebe os pontos do mata-mata que jogar.

## Objetivos
- Botão **Substituir** em cada dupla classificada (aba Mata-mata), com prévia "Sai X (lesão) → Entra Y" e confirmação.
- Botão **W.O.** nos jogos do mata-mata: lança 6x0 marcado como W.O. para o lado que não pode jogar.
- Desfazer a substituição (enquanto a dupla não tiver placar no mata-mata).
- Tudo registrado no histórico da liga.

## Fora do escopo
- Substituição na fase de grupos; trocar parceiro de quem não se machucou; refazer as duplas.

## Anti-objetivos
- Nunca alterar os resultados ou nomes da fase de grupos (o substituto não pode "herdar" os jogos de quem saiu).
- Nunca mostrar "salvo" antes da resposta do servidor (regra geral do app).

## Caminhos considerados
1. **Registro de trocas dentro dos dados da liga** (escolhido): `dados.subs` guarda as trocas; chave/folhas/WhatsApp/pontos aplicam as trocas ao montar as duplas. Sem SQL; versões e histórico continuam como hoje; desfazer é remover o registro.
2. Trocar o nome direto na lista de atletas — descartado: apaga a verdade dos grupos e distorce o ranking.
3. Tabela nova no Supabase — descartado: mais trabalho e SQL sem ganho.

## Como (decidido)
- `dados.subs = [{sai, entra, atleta:{id,nome}|null, motivo, em}]` — `sai`/`entra` são posições na liga; atleta de fora da liga ganha uma posição "virtual" depois das posições normais (só usada no mata-mata).
- `dados.wo = {idDoJogo: ladoQueNaoJogou}` para marcar W.O.; o placar fica 6x0.
- As 4 montagens de duplas do mata-mata (tela, chave/folhas, WhatsApp, pontos da temporada) passam por uma única função que aplica as trocas.
- Alterar placar da fase de grupos já apaga o mata-mata; passa a apagar também trocas e W.O. (com aviso).
- `dadosParaServidor` e a normalização passam a carregar `subs` e `wo`.

## Para o construtor decidir
- Visual exato dos botões e da janela de substituição (seguir o padrão atual dos modais).
- Texto do aviso/histórico.
