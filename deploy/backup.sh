#!/usr/bin/env bash
# Cópia de segurança do banco e dos materiais (cifrados). Uso: deploy/backup.sh [pasta-destino]
# Guarde o resultado FORA da VPS e cifrado em repouso; sem a DATA_ENCRYPTION_KEY ele não restaura conteúdo.
set -euo pipefail
cd "$(dirname "$0")"
dest="${1:-./backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dest"
umask 077
compose="docker compose -f compose.production.yml --env-file production.env"
$compose exec -T db pg_dump -U postgres -d followw --format=custom --no-owner > "$dest/followw-$stamp.dump"
$compose run --rm --no-deps --entrypoint tar api -C /data -cf - materials > "$dest/materials-$stamp.tar"
sha256sum "$dest/followw-$stamp.dump" "$dest/materials-$stamp.tar" > "$dest/SHA256SUMS-$stamp"
echo "Backup em $dest ($stamp)"
