"""Onde ficam os arquivos enviados pelos alunos.

Hoje numa pasta local (`MATERIALS_DIR`); na nuvem, basta outra classe com os mesmos métodos
(um storage de objetos). As chaves são aleatórias, nunca o nome que o aluno deu ao arquivo, e
o conteúdo fica cifrado (AES-256-GCM): o disco ou um backup não mostram nada.
"""

import re
from pathlib import Path

from anyio import to_thread

from api.core.config import settings
from api.crypto import decrypt_bytes, encrypt_bytes

_KEY = re.compile(r"^[0-9a-f]{32}$")


class LocalStorage:
    def __init__(self, base: str | Path) -> None:
        self._base = Path(base)

    def _path(self, key: str) -> Path:
        # A chave vem do banco, mas nunca vira caminho sem ser só hexadecimal.
        if not _KEY.match(key):
            raise ValueError("Chave de arquivo inválida.")
        return self._base / key[:2] / key

    async def save(self, key: str, data: bytes) -> None:
        path = self._path(key)
        sealed = encrypt_bytes(data, f"materials:{key}")

        def write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(sealed)

        await to_thread.run_sync(write)

    async def read(self, key: str) -> bytes | None:
        """O arquivo decifrado; `None` se sumiu ou foi adulterado."""
        path = self._path(key)
        sealed = await to_thread.run_sync(
            lambda: path.read_bytes() if path.exists() else None
        )
        if sealed is None:
            return None
        try:
            return decrypt_bytes(sealed, f"materials:{key}")
        except ValueError:
            return None

    async def delete(self, key: str) -> None:
        path = self._path(key)
        await to_thread.run_sync(lambda: path.unlink(missing_ok=True))

    async def usage(self) -> int:
        def total() -> int:
            if not self._base.exists():
                return 0
            return sum(
                file.stat().st_size for file in self._base.rglob("*") if file.is_file()
            )

        return await to_thread.run_sync(total)


def material_storage() -> LocalStorage:
    return LocalStorage(settings.materials_dir)
