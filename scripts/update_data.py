"""Atualiza os dados públicos do SIGAA: turmas do semestre atual e do próximo, componentes
novos que elas citam e o catálogo de docentes. Depois carrega só o que mudou no banco.

Os CSVs ficam ordenados e só com o semestre atual e o próximo, então cada atualização muda
apenas as linhas alteradas e o tamanho não cresce com o tempo. O calendário acadêmico vem
junto com o código (`unb_browser`), não daqui.

    uv run python scripts/update_data.py                # tudo
    uv run python scripts/update_data.py --offer 2027.1 # só as turmas de um semestre
    uv run python scripts/update_data.py --professors   # só os docentes
"""

import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
from datetime import UTC, date, datetime
from pathlib import Path

from unb_browser import load_academic_calendar

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "packages" / "sigaa-client" / "scripts"
DATA = ROOT / "packages" / "sigaa-client" / "data"
CLASSROOMS = DATA / "classrooms.csv"
LOCAL = ROOT / ".local"
PROFESSORS = LOCAL / "data" / "professors.csv"
STATE = LOCAL / "update.json"
API = ROOT / "apps" / "api"
_institutional_calls = 0
_calls_measured = False


def regular_semesters(today: date) -> tuple[str, str]:
    """O semestre regular em curso (ou o último, nas férias) e o seguinte."""
    started = sorted(
        semester.semester
        for semester in load_academic_calendar().list_semesters()
        if semester.semester[-1] in "12" and semester.period.start <= today
    )
    current = started[-1]
    year, term = map(int, current.split("."))
    return current, f"{year}.2" if term == 1 else f"{year + 1}.1"


def run(*args: str | Path, cwd: Path = ROOT) -> None:
    global _institutional_calls, _calls_measured
    print("$", *args, flush=True)
    with tempfile.TemporaryDirectory() as directory:
        counter = Path(directory) / "calls"
        try:
            subprocess.run(
                [str(arg) for arg in args],
                cwd=cwd,
                check=True,
                env={**os.environ, "FOLLOWW_PUBLIC_COUNTER": str(counter)},
            )
        finally:
            if counter.exists():
                _institutional_calls += int(counter.read_text(encoding="ascii"))
                _calls_measured = True


def collect_offer(semester: str) -> bool:
    """Coleta as turmas do semestre e as troca no CSV; `False` se a oferta não saiu."""
    with tempfile.TemporaryDirectory() as folder:
        output = Path(folder) / "classrooms.csv"
        try:
            run(
                sys.executable,
                SCRIPTS / "collect_classrooms.py",
                "--semester",
                semester,
                "--output",
                output,
            )
        except subprocess.CalledProcessError as error:
            if error.returncode != 3:
                raise
            # O coletor falha sem nenhuma turma: a oferta ainda não foi publicada.
            print(f"Sem oferta de {semester} no SIGAA.", flush=True)
            return False
        merge_offer(CLASSROOMS, output, semester)
    return True


def merge_offer(base: Path, new: Path, semester: str) -> None:
    """Troca as linhas do semestre pelas novas, na ordem do coletor."""
    with base.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        columns = reader.fieldnames or []
        rows = [row for row in reader if row["semester"] != semester]
    with new.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames != columns:
            raise ValueError("Colunas inesperadas na oferta; catálogo preservado.")
        collected = list(reader)
    if not collected or any(row["semester"] != semester for row in collected):
        raise ValueError("Oferta vazia ou semestre inesperado; catálogo preservado.")
    keys = [(row["subject_code"], row["number"], row["semester"]) for row in collected]
    if len(set(keys)) != len(keys):
        raise ValueError("Turmas repetidas na coleta; catálogo preservado.")
    rows += collected
    rows.sort(key=lambda row: (row["subject_code"], row["number"], row["semester"]))
    temporary = base.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(base)


def prune_offer(keep: set[str]) -> None:
    """Só o semestre atual e o próximo ficam no CSV: as turmas antigas não fazem falta."""
    with CLASSROOMS.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        columns = reader.fieldnames or []
        rows = [row for row in reader if row["semester"] in keep]
    with CLASSROOMS.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def collect_professors() -> None:
    PROFESSORS.parent.mkdir(parents=True, exist_ok=True)
    run(
        sys.executable,
        SCRIPTS / "collect_professors.py",
        "--output-dir",
        PROFESSORS.parent,
    )


def load_database(professors: bool) -> dict:
    """O seed só cria o que falta e atualiza o que mudou (upsert)."""
    # O processo normal não precisa de DDL nem da conta de manutenção para atualizar o catálogo.
    code = (
        "import asyncio,json; from api.db.seed.run import sync_catalog; print(json.dumps(asyncio.run(sync_catalog("
        + repr(str(PROFESSORS) if professors and PROFESSORS.exists() else None)
        + "))))"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=API,
        env=os.environ,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def main() -> None:
    global _institutional_calls, _calls_measured
    _institutional_calls, _calls_measured = 0, False
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offer", action="append", help="AAAA.P; repetível.")
    parser.add_argument("--professors", action="store_true")
    parser.add_argument("--offers-only", action="store_true")
    parser.add_argument("--subjects-only", action="store_true")
    parser.add_argument("--curricula-only", action="store_true")
    parser.add_argument("--units-only", action="store_true")
    parser.add_argument(
        "--no-load", action="store_true", help="só atualiza os CSVs, sem o banco."
    )
    args = parser.parse_args()

    everything = not any(
        (
            args.offer,
            args.professors,
            args.offers_only,
            args.subjects_only,
            args.curricula_only,
            args.units_only,
        )
    )
    current, upcoming = regular_semesters(date.today())
    offers = args.offer or (
        [current, upcoming] if everything or args.offers_only else []
    )
    if everything or args.units_only:
        run(sys.executable, SCRIPTS / "collect_units.py")
    collected = [semester for semester in offers if collect_offer(semester)]
    if everything:
        prune_offer({current, upcoming})
    if collected or args.subjects_only:
        # Componentes novos citados pelas turmas; os que já estão no CSV não são refeitos.
        run(
            sys.executable,
            SCRIPTS / "collect_subjects.py",
            *(["--refresh"] if args.subjects_only else []),
        )
    if args.curricula_only:
        run(sys.executable, SCRIPTS / "collect_curricula.py")
    if everything or args.professors:
        collect_professors()
    metrics = (
        {} if args.no_load else load_database(professors=everything or args.professors)
    )
    if _calls_measured:
        metrics["institutional_calls"] = _institutional_calls

    LOCAL.mkdir(exist_ok=True)
    STATE.write_text(
        json.dumps(
            {
                "updated_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "offers": collected,
                "professors": everything or args.professors,
                "metrics": metrics,
            }
        ),
        encoding="utf-8",
    )
    print("Dados atualizados.", flush=True)


if __name__ == "__main__":
    main()
