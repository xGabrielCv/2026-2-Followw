#!/usr/bin/env bash
# Restaura um backup. Uso: deploy/restore.sh followw-AAAA.dump [materials-AAAA.tar]
# ATENÇÃO: substitui o banco atual. Confira o arquivo e a DATA_ENCRYPTION_KEY antes.
set -euo pipefail
cd "$(dirname "$0")"
dump="${1:?informe o arquivo .dump}"
read -r -p "Isto APAGA o banco atual e restaura '$dump'. Digite RESTAURAR para continuar: " answer
[ "$answer" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }
compose="docker compose -f compose.production.yml --env-file production.env"
$compose stop api web
$compose exec -T db psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS followw WITH (FORCE)" -c "CREATE DATABASE followw"
$compose exec -T db pg_restore -U postgres -d followw --no-owner < "$dump"
if [ -n "${2:-}" ]; then
  $compose run --rm --no-deps --entrypoint tar api -C /data -xf - < "$2"
fi
# recria o papel restrito e as políticas RLS sobre o banco restaurado
$compose run --rm migrate
$compose up -d api web
echo "Restauração concluída."
