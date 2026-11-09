"""Atualiza nomes e IDs das unidades públicas, preservando siglas e referências existentes."""

import asyncio
import csv

from _collect import DATA_DIR, load_units, write_csv

OUTPUT = DATA_DIR / "units.csv"
COLUMNS = ("id", "code", "name")


def merge_units(existing, found):
    if not found or len({unit.id for unit in found}) != len(found):
        raise ValueError("Lista de unidades vazia ou repetida; catálogo preservado.")
    rows = {int(row["id"]): dict(row) for row in existing}
    for unit in found:
        if unit.id <= 0 or not unit.name.strip():
            raise ValueError("Unidade pública inválida; catálogo preservado.")
        previous = rows.get(unit.id, {})
        rows[unit.id] = {
            "id": unit.id,
            "code": previous.get("code", ""),
            "name": unit.name.strip(),
        }
    return [rows[key] for key in sorted(rows)]


def main():
    with OUTPUT.open(encoding="utf-8", newline="") as file:
        previous = list(csv.DictReader(file))
    found = asyncio.run(load_units())
    write_csv((OUTPUT, COLUMNS, merge_units(previous, found)))
    print(f"Unidades públicas verificadas: {len(found)}.", flush=True)


if __name__ == "__main__":
    main()
