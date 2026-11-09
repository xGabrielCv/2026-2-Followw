"""Inspeção e recifragem em manutenção; o chaveiro antigo continua necessário aos backups."""

import argparse
import asyncio
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import Text, cast, literal, select, update
from sqlalchemy.ext.asyncio import AsyncEngine

from api.crypto import Encrypted, decrypt, decrypt_bytes, encrypt, encrypt_bytes
from api.db.base import Base


async def rotate_database(engine: AsyncEngine, backup: Path | None = None) -> int:
    count = 0
    journal = backup.open("x", encoding="utf-8") if backup else None
    try:
        async with engine.begin() as connection:
            for table in Base.metadata.sorted_tables:
                primary = list(table.primary_key.columns)
                for column in table.columns:
                    if not isinstance(column.type, Encrypted):
                        continue
                    query = select(*primary, cast(column, Text)).where(
                        column.is_not(None)
                    )
                    if journal:
                        query = query.with_for_update()
                    result = await connection.stream(
                        query.execution_options(yield_per=100)
                    )
                    async for row in result:
                        original = row[-1]
                        value = decrypt(original, column.type.context)
                        count += 1
                        if journal:
                            record = {
                                "table": table.name,
                                "column": column.name,
                                "key": [str(item) for item in row[:-1]],
                                "ciphertext": original,
                            }
                            journal.write(json.dumps(record) + "\n")
                            journal.flush()
                            os.fsync(journal.fileno())
                            statement = (
                                update(table)
                                .where(
                                    *(
                                        field == row[index]
                                        for index, field in enumerate(primary)
                                    )
                                )
                                .values(
                                    {
                                        column.name: literal(
                                            encrypt(value, column.type.context),
                                            type_=Text(),
                                        )
                                    }
                                )
                            )
                            await connection.execute(statement)
        return count
    finally:
        if journal:
            journal.close()


def rotate_files(base: Path, backup: Path | None = None) -> int:
    count = 0
    if not base.exists():
        return count
    for shard in base.iterdir():
        if not shard.is_dir() or shard.is_symlink():
            continue
        for path in shard.iterdir():
            if (
                path.is_symlink()
                or not path.is_file()
                or len(path.name) != 32
                or any(char not in "0123456789abcdef" for char in path.name)
            ):
                continue
            original = path.read_bytes()
            data = decrypt_bytes(original, f"materials:{path.name}")
            count += 1
            if backup:
                saved = backup / path.name
                with saved.open("xb") as stream:
                    stream.write(original)
                    stream.flush()
                    os.fsync(stream.fileno())
                temporary = None
                try:
                    with tempfile.NamedTemporaryFile(
                        dir=path.parent, prefix=".rotation-", delete=False
                    ) as stream:
                        temporary = Path(stream.name)
                        stream.write(encrypt_bytes(data, f"materials:{path.name}"))
                        stream.flush()
                        os.fsync(stream.fileno())
                    temporary.replace(path)
                finally:
                    if temporary:
                        temporary.unlink(missing_ok=True)
    return count


async def _run(apply: bool, directory: Path) -> None:
    from api.core.config import settings
    from api.db.main import maintenance_engine as engine

    # Inspeciona tudo antes de modificar o primeiro registro.
    fields = await rotate_database(engine)
    files = await asyncio.to_thread(rotate_files, Path(settings.materials_dir))
    print(
        f"Verificação: {fields} campos e {files} arquivos legíveis. Nenhuma chave é exibida."
    )
    if not apply:
        return
    backup = directory / (
        datetime.now(UTC).strftime("%Y%m%dT%H%M%S") + "-" + uuid4().hex
    )
    backup.mkdir(parents=True, exist_ok=False)
    (backup / "files").mkdir()
    await rotate_database(engine, backup / "ciphertexts.jsonl")
    await asyncio.to_thread(
        rotate_files, Path(settings.materials_dir), backup / "files"
    )
    print(
        f"Recifragem concluída; cópia dos ciphertexts anteriores em {backup}. Preserve o chaveiro antigo separadamente."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--maintenance",
        action="store_true",
        help="Confirma que os serviços estão parados e há backup completo.",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        default=Path(__file__).resolve().parents[3] / ".local" / "key-rotation",
    )
    args = parser.parse_args()
    if args.apply and not args.maintenance:
        parser.error(
            "--apply exige --maintenance, com os serviços parados e backup completo."
        )
    asyncio.run(_run(args.apply, args.backup_dir))
