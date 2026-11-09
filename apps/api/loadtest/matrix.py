"""Pools x workers: roda a escada de carga para cada combinação e resume (um banco sintético por rodada).

uv run --no-sync python loadtest/matrix.py --levels 250,500,1000 --seconds 15 --out ../../.local/load/matrix.json
"""

import argparse
import itertools
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--levels", default="250,500,1000")
    parser.add_argument("--seconds", default="15")
    parser.add_argument("--workers", default="1,2,4")
    parser.add_argument("--pools", default="5+5,10+5,10+10")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    results = []
    for workers, pool in itertools.product(
        args.workers.split(","), args.pools.split(",")
    ):
        size, overflow = pool.split("+")
        out = Path(args.out).with_name(f"matrix-w{workers}-p{size}-{overflow}.json")
        subprocess.run(
            [
                sys.executable,
                str(HERE / "run.py"),
                "--workers",
                workers,
                "--pool",
                size,
                "--overflow",
                overflow,
                "--levels",
                args.levels,
                "--seconds",
                args.seconds,
                "--out",
                str(out),
            ],
            check=False,
        )
        if out.exists():
            report = json.loads(out.read_text(encoding="utf-8"))
            results.append(
                {
                    "workers": int(workers),
                    "pool": pool,
                    "levels": report["levels"],
                    "external_attempts_blocked": report.get(
                        "external_attempts_blocked"
                    ),
                }
            )
    Path(args.out).write_text(
        json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
