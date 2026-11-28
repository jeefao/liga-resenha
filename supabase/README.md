# Supabase da Liga Resenha V6

Projeto Supabase **exclusivo da V6**. Nunca aplicar estas migrations no projeto
`liga-resenha` (`eyllvstfeexvayihudoq`), que é o banco da **V2**.

## Estrutura

| Tabela | Conteúdo |
|---|---|
| `admins` | Usuários autorizados a alterar ligas |
| `ligas` | Uma linha por competição: nome, data, atletas, status, etapa, dados completos e número da versão |
| `ligas_versoes` | Cópia completa automática a cada gravação (imutável) |
| `ligas_eventos` | Histórico legível de alterações (imutável) |

Escrita somente pelas funções `criar_liga`, `salvar_liga`, `restaurar_versao`,
`mover_para_lixeira` e `retirar_da_lixeira`. Leitura somente para administradores (RLS).

## Testes

```powershell
npm install
npm test
```

Os testes rodam um PostgreSQL em memória (PGlite) e não acessam nenhum Supabase.

## Configuração inicial (feita uma única vez, pelo painel do Supabase)

1. **Criar o projeto**: em supabase.com/dashboard, clique em *New project*.
   - Nome: `liga-resenha-v6`
   - Senha do banco: gere uma senha forte e guarde-a no seu gerenciador de senhas
     (ela não vai para o app).
   - Região: *South America (São Paulo)*.
2. **Aplicar as migrations, em ordem**: abra *SQL Editor* → *New query*, cole todo o
   conteúdo de cada arquivo e clique em *Run* (um de cada vez):
   1. `supabase/migrations/20261122000001_ligas_relampago.sql`
   2. `supabase/migrations/20261122000002_keepalive.sql`
   3. `supabase/migrations/20261123000001_atletas.sql` (cadastro único de atletas)
   4. `supabase/migrations/20261124000001_lixeira_exclusao.sql` (apagar de vez da lixeira)
   5. `supabase/migrations/20261125000001_temporadas.sql` (temporadas e etapas)
   6. `supabase/migrations/20261126000001_excluir_temporada.sql` (apagar temporada arquivada de vez)
   7. `supabase/migrations/20261128000001_consulta_publica.sql` (página pública só de consulta: leitura da temporada marcada como pública, sem login)
   8. `supabase/migrations/20261128000002_consulta_publica_relampagos.sql` (página de consulta com ligas relâmpago e datas previstas)
   9. `supabase/migrations/20261128000003_consulta_todas_temporadas.sql` (consulta com todas as temporadas em andamento e encerradas)
   10. `supabase/migrations/20261128000004_acessos_atletas.sql` (login dos atletas: a consulta passa a exigir conta aprovada pelo administrador)
   11. `supabase/migrations/20261128000005_permissoes_admin.sql` (dono e administradores com permissões por área; os administradores existentes viram donos)
   12. `supabase/migrations/20261128000006_financeiro.sql` (Finanças: caixa único, inscrições por rodada, despesas, premiação prevista; só pelas funções, com as permissões do financeiro)
   13. `supabase/migrations/20261129000001_pedido_nova_senha.sql` (esqueci a senha: o atleta pede a senha nova no app, sem login; ela só passa a valer quando o dono aprova na aba Usuários)
   14. `supabase/migrations/20261129000002_corrige_ajustes_financas.sql` (o Supabase recusa UPDATE sem WHERE: corrige o Salvar dos Ajustes do Finanças)
   15. `supabase/migrations/20261129000003_historico_app.sql` (histórico do app, situação do atleta na próxima liga e atletas que são administradores)
   16. `supabase/migrations/20261129000004_financeiro_baixa.sql` (Finanças: despesa/entrada paga ou pendente, com baixa)
   17. `supabase/migrations/20261129000005_financeiro_liga_apagada.sql` (Finanças: a cobrança da rodada some quando a liga é apagada de vez e não tem dinheiro ligado)
   O resultado esperado é "Success. No rows returned".
3. **Cadastro dos atletas** (a partir da migration 10): em *Authentication* → *Sign In / Providers*,
   deixe **ligado** *Allow new users to sign up* e, em *Email*, **desligue** *Confirm email* e salve.
   Quem cria conta não vê nem altera nada até o administrador aprovar (aba Usuários do app);
   as tabelas continuam liberadas só para o administrador. Antes da migration 10, deixe o cadastro desligado.
4. **Criar o seu usuário**: em *Authentication* → *Users* → *Add user* →
   *Create new user*, informe o seu e-mail e uma senha, marque *Auto Confirm User*.
5. **Tornar o seu usuário administrador**: no *SQL Editor*, rode (troque o e-mail):

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'SEU-EMAIL-AQUI';
   ```

   O resultado esperado é "1 row" inserida.
6. **Dados para o app**: em *Project Settings* → *API Keys*, copie a **Publishable key**
   (começa com `sb_publishable_`) e a **Project URL**. Essas duas são públicas e vão
   no app. **Nunca** copie a `secret`/`service_role` para o app.

## Esqueci a senha (v7.5.1)

- Na tela de entrar, "Esqueci a senha" pede o e-mail e a senha nova. A função `pedir_nova_senha` (aceita sem login)
  guarda só a versão embaralhada da senha em `pedidos_senha` — ninguém lê essa tabela direto.
- A resposta é sempre a mesma, exista ou não a conta, para não revelar quais e-mails estão cadastrados. Conta do dono
  não aceita pedido. No máximo 30 pedidos esperando ao mesmo tempo; um pedido novo da mesma conta substitui o anterior.
- A senha só muda quando o dono toca em "Aprovar senha nova" (`responder_pedido_senha`); recusar apaga o pedido e a
  senha antiga continua valendo. O botão Usuários mostra 🔔 com a soma de contas e senhas esperando.

## Painel do atleta e histórico do app (v7.6.0)

- A consulta abre no painel do atleta da conta (temporadas, etapas, relâmpagos, jogos, vitórias, aproveitamento,
  saldo de games, títulos, posição em cada temporada e participações). Os números saem dos mesmos placares e da mesma
  conta do ranking. Dá para escolher o painel de qualquer atleta.
- Linha "Próxima etapa" abaixo dos botões: `minha_situacao(liga)` diz se o atleta da conta está na lista da próxima
  liga e, se a rodada cobra inscrição, se está pago, isento ou pendente. Só a própria situação; nada de outros atletas.
- Histórico: gatilhos anotam em `historico` o que muda em temporadas, atletas, contas, administradores, pedidos de
  senha e financeiro (quem, o quê, quando). As ligas entram pelo registro que já existia (`ligas_eventos`). Visitas:
  o app chama `registrar_visita()` ao abrir (no máximo uma linha a cada 30 minutos por pessoa). Ações iguais em poucos
  minutos viram uma linha só com "vezes".
- `historico_app()` só para o dono (bloco abaixo da Lixeira); `historico_financeiro()` para quem tem "Financeiro: ver"
  (aba Histórico do Finanças). Ninguém lê a tabela direto. O histórico começa a contar a partir da instalação.
- Todo UPDATE/DELETE dentro das funções precisa de WHERE (o Supabase recusa sem): o teste
  `supabase/tests/update-com-where.test.js` confere isso nas migrations.

## Finanças: pago ou pendente (v7.7.0)

- Cada despesa/entrada tem situação: paga (entra no caixa) ou a pagar / a receber (entra só no saldo futuro).
  Os lançamentos que já existiam continuam pagos. O botão Pagar/Receber chama `fin_baixar_lancamento(id, true)`
  (precisa de "Financeiro: lançar"); pagamento de prêmio já nasce pago.
- Saldo futuro previsto = caixa − a pagar + entradas a receber − premiação prevista. Inscrições pendentes continuam
  à parte, em "A receber".
- As inscrições marcadas como pagas aparecem nos lançamentos como uma linha automática por rodada ("Inscrições —
  N pago(s)"). Ela é calculada na tela a partir das inscrições, então não precisa ser lançada e não conta em dobro.
- Liga apagada de vez: a cobrança da rodada some junto se não houver inscrição paga, lançamento ativo nem prêmio
  (gatilho `fin_liga_apagada`); com dinheiro, continua como "liga apagada". O "De onde é" não oferece ligas apagadas
  nem na lixeira.
