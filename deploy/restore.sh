#!/usr/bin/env bash
# Restaura um backup cifrado. Use primeiro em AMBIENTE ISOLADO de teste.
#   BACKUP_PASSPHRASE_FILE=... deploy/restore.sh followw-AAAA.dump.gpg [materials-AAAA.tar.gpg]
# ATENÇÃO: substitui o banco atual.
set -euo pipefail
cd "$(dirname "$0")"
: "${BACKUP_PASSPHRASE_FILE:?defina BACKUP_PASSPHRASE_FILE}"
dump="${1:?informe o arquivo .dump.gpg}"
sums="$(dirname "$dump")/SHA256SUMS-$(basename "$dump" | sed -E 's/^followw-(.*)\.dump\.gpg$/\1/')"
if [ -f "$sums" ]; then ( cd "$(dirname "$dump")" && sha256sum --check --ignore-missing "$(basename "$sums")" ); else echo "Aviso: sem SHA256SUMS para conferir a integridade." >&2; fi
read -r -p "Isto APAGA o banco atual e restaura '$dump'. Digite RESTAURAR para continuar: " answer
[ "$answer" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }
compose="docker compose -f compose.production.yml --env-file production.env"
open() { gpg --batch --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt "$1"; }
$compose stop api web
$compose exec -T db psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS followw WITH (FORCE)" -c "CREATE DATABASE followw"
open "$dump" | $compose exec -T db pg_restore -U postgres -d followw --no-owner
if [ -n "${2:-}" ]; then
  open "$2" | $compose run --rm --no-deps --entrypoint tar api -C /data -xf -
fi
# recria o papel restrito e as políticas RLS sobre o banco restaurado
$compose run --rm migrate
$compose up -d api web
echo "Restauração concluída."
