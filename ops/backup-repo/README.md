# Liga Resenha V6 — backups e keep-alive

Repositório **particular**. Contém:

- `.github/workflows/keepalive.yml` — chama o banco todo dia para o Supabase gratuito não pausar.
- `.github/workflows/backup.yml` — toda terça guarda um backup completo do banco em `backups/`.

## Configuração (uma vez)

1. Em *Settings* → *Secrets and variables* → *Actions* → *New repository secret*:
   - Nome: `SUPABASE_DB_URL`
   - Valor: no painel do Supabase da V6, botão **Connect** → aba **Connection string** →
     **Session pooler**. Copie o endereço e troque `[YOUR-PASSWORD]` pela senha do banco.
2. Em *Actions*, rode cada workflow uma vez com **Run workflow** e confira se ficou verde.

## Restaurar um backup

Os arquivos `backups/*.sql.gz` podem ser restaurados num projeto Supabase novo
(descompactar e rodar com `psql`). Peça ajuda antes de restaurar: a restauração
substitui dados.
