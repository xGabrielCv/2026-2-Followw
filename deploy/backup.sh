#!/usr/bin/env bash
# Cópia de segurança CIFRADA do banco e dos materiais.
#   BACKUP_PASSPHRASE_FILE=/caminho/fora/do/repo/frase.txt deploy/backup.sh [pasta-destino]
# A frase fica FORA deste diretório e fora da VPS (guarde também em outro lugar seguro): sem ela o backup
# não abre. gpg com AES-256 (cifra autenticada, MDC). Os arquivos nunca ficam em claro no disco.
set -euo pipefail
cd "$(dirname "$0")"
: "${BACKUP_PASSPHRASE_FILE:?defina BACKUP_PASSPHRASE_FILE (arquivo com a frase, fora do repositório)}"
[ -s "$BACKUP_PASSPHRASE_FILE" ] || { echo "Frase de backup ausente ou vazia." >&2; exit 1; }
command -v gpg >/dev/null || { echo "gpg não encontrado." >&2; exit 1; }
dest="${1:-./backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dest"
umask 077
compose="docker compose -f compose.production.yml --env-file production.env"
seal() { gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" \
  --symmetric --cipher-algo AES256 --compress-algo none -o "$1"; }
$compose exec -T db pg_dump -U postgres -d followw --format=custom --no-owner | seal "$dest/followw-$stamp.dump.gpg"
$compose run --rm --no-deps --entrypoint tar api -C /data -cf - materials | seal "$dest/materials-$stamp.tar.gpg"
( cd "$dest" && sha256sum "followw-$stamp.dump.gpg" "materials-$stamp.tar.gpg" > "SHA256SUMS-$stamp" )
echo "Backup cifrado em $dest ($stamp). A DATA_ENCRYPTION_KEY NÃO está aqui: guarde-a separadamente."
