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
