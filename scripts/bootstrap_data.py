"""Importa o catálogo público original para uma instância nova; os CSVs ficam só nesta máquina."""

import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "packages" / "sigaa-client" / "data"
REVISION = "7219b37aefb6e46b1c4d363f382528f53d241837"
BASE = f"https://raw.githubusercontent.com/unb-mds/2026-2-Followw/{REVISION}/packages/sigaa-client/data"
# Hashes do catálogo público nessa revisão; nenhum dado de uma instância é exportado.
CHECKSUMS: dict[str, str] = {
    "units.csv": "25b83c361a451eed1fa027ae5504858e61703215b1a248f13b8c13708a56bbba",
    "courses.csv": "9b153d6c349036d5c3885622314fab8d465ee74549a193c7ee5957966c287ad0",
    "curricula.csv": "76323a5120499e2cec2de069de229671969246f419a1ab0dba2e40f15bfcc0c9",
    "curriculum_components.csv": "6836f7467f7e427061275a95ae3727f3454442f58369016674f261b3f7d0240c",
    "subjects.csv": "98bf04eb32da1c9e97a98cee0bf55436b48fd262b8650f42550dd4f006d2bae0",
    "classrooms.csv": "1c91ab572290fbe90776cf08a62294a065a12795877f71d9a169197d20063ffd",
}


def bootstrap(destination: Path = DATA) -> None:
    missing = [name for name in CHECKSUMS if not (destination / name).exists()]
    if not missing:
        return
    with TemporaryDirectory() as folder, httpx.Client(timeout=60) as client:
        temporary = Path(folder)
        for name in missing:
            response = client.get(f"{BASE}/{name}")
            response.raise_for_status()
            content = response.content
            if hashlib.sha256(content).hexdigest() != CHECKSUMS[name]:
                raise ValueError(f"Catálogo com integridade inválida: {name}")
            (temporary / name).write_bytes(content)
        destination.mkdir(parents=True, exist_ok=True)
        for name in missing:
            (destination / name).write_bytes((temporary / name).read_bytes())
            print(f"Catálogo público importado: {name}", flush=True)


if __name__ == "__main__":
    bootstrap()
