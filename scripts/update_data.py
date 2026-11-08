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
    print("$", *args, flush=True)
    subprocess.run([str(arg) for arg in args], cwd=cwd, check=True, env=os.environ)


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
        except subprocess.CalledProcessError:
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
        rows += list(csv.DictReader(file))
    rows.sort(key=lambda row: (row["subject_code"], row["number"], row["semester"]))
    with base.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


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


def load_database(professors: bool) -> None:
    """O seed só cria o que falta e atualiza o que mudou (upsert)."""
    run("uv", "run", "--no-sync", "--quiet", "db-init", cwd=API)
    if professors and PROFESSORS.exists():
        run(
            "uv",
            "run",
            "--no-sync",
            "--quiet",
            "db-seed-professors",
            PROFESSORS,
            cwd=API,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offer", action="append", help="AAAA.P; repetível.")
    parser.add_argument("--professors", action="store_true")
    parser.add_argument(
        "--no-load", action="store_true", help="só atualiza os CSVs, sem o banco."
    )
    args = parser.parse_args()

    everything = not args.offer and not args.professors
    current, upcoming = regular_semesters(date.today())
    offers = args.offer or [current, upcoming]
    collected = [semester for semester in offers if collect_offer(semester)]
    if everything:
        prune_offer({current, upcoming})
    if collected:
        # Componentes novos citados pelas turmas; os que já estão no CSV não são refeitos.
        run(sys.executable, SCRIPTS / "collect_subjects.py")
    if everything or args.professors:
        collect_professors()
    if not args.no_load:
        load_database(professors=everything or args.professors)

    LOCAL.mkdir(exist_ok=True)
    STATE.write_text(
        json.dumps(
            {
                "updated_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "offers": collected,
                "professors": everything or args.professors,
            }
        ),
        encoding="utf-8",
    )
    print("Dados atualizados.", flush=True)


if __name__ == "__main__":
    main()
