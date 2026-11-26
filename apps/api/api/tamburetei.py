"""Leitura em memória (somente leitura) do snapshot local do Tamburetei UnB (PAS + DPO).

Lê `.local/data/tamburetei/snapshot.json` (fora do Git) com cache por `mtime`, sem gravar
nada no banco e sem chamadas externas durante requisições de estudantes.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / ".local" / "data" / "tamburetei" / "snapshot.json"

_CACHE_KEY: tuple[Path, int, int] | None = None
_CACHE_DATA: dict[str, Any] | None = None

_ENGENHARIAS_FCTE = frozenset(
    {
        "engenharia",
        "engenharia de software",
        "engenharia aeroespacial",
        "engenharia automotiva",
        "engenharia de energia",
        "engenharia eletronica",
    }
)

_NAME_ALIASES: dict[str, str] = {
    "ciencias sociais": "ciencias sociais antropologia sociologia",
    "ciencias sociais antropologia": "ciencias sociais antropologia sociologia",
    "ciencias sociais sociologia": "ciencias sociais antropologia sociologia",
    "educacao fisica": "educacao fisica ciclo basico",
    "engenharia mecatronica controle e automacao": "engenharia mecatronica",
    "artes cenicas interpretacao teatral": "artes cenicas",
    "comunicacao social comunicacao organizacional": "comunicacao organizacional",
    "design programacao visual": "design",
    "design projeto do produto": "design",
    "letras lingua e literatura japonesa": "lingua e literatura japonesa",
    "letras lingua espanhola e literatura espanhola e hispano americana": (
        "lingua espanhola e literatura espanhola e hispano americana"
    ),
    "letras lingua francesa e respectiva literatura": "lingua francesa",
    "lingua francesa e respectiva literatura": "lingua francesa",
    "letras lingua inglesa e respectiva literatura": "lingua inglesa",
    "lingua inglesa e respectiva literatura": "lingua inglesa",
    "letras lingua portuguesa e respectiva literatura": "lingua portuguesa",
    "lingua portuguesa e respectiva literatura": "lingua portuguesa",
    "letras portugues do brasil como seg lingua": (
        "letras portugues do brasil como segunda lingua"
    ),
    "linguas estrangeiras aplicadas msi": "linguas estrangeiras aplicadas",
    "gestao de agronegocios": "gestao de agronegocio",
}

_PROFESSIONAL_DEGREES: dict[str, str] = {
    "agronomia": "engenheiro agronomo",
    "arquitetura e urbanismo": "arquiteto e urbanista",
    "enfermagem": "enfermeiro",
    "engenharia ambiental": "engenheiro",
    "engenharia civil": "engenheiro civil",
    "engenharia eletrica": "engenheiro eletricista",
    "engenharia florestal": "engenheiro florestal",
    "engenharia mecanica": "engenheiro mecanico",
    "engenharia mecatronica": "engenheiro de controle e automacao",
    "geologia": "geologo",
    "medicina": "medico",
    "medicina veterinaria": "medico veterinario",
    "nutricao": "nutricionista",
    "odontologia": "cirurgiao dentista",
    "psicologia": "psicologo",
}


class PasModality(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    sistema: str
    descricao: str


class PasQuotaScore(BaseModel):
    model_config = ConfigDict(frozen=True)

    minimo: str | None = None
    maximo: str | None = None
    observacao: str | None = None


class PasCycleEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    ciclo: str
    sistema: str
    url: str
    observacao: str | None = None
    modalidades: list[PasModality] = []
    nome: str
    campus: str
    grau: str
    graus: list[str] = []
    turno: str
    minimo: str | None = None
    maximo: str | None = None
    pagina: int
    ingresso_conjunto: bool = False
    oferta_original: str | None = None
    cotas: dict[str, PasQuotaScore] = {}


class CourseYearMetrics(BaseModel):
    model_config = ConfigDict(frozen=True)

    ano: int
    vagas_totais: int | None = None
    inscritos_total: int | None = None
    ingressantes: int | None = None
    matriculados: int | None = None
    concluintes: int | None = None
    trancados: int | None = None
    desvinculados: int | None = None
    taxa_sucesso: float | None = None
    taxa_evasao: float | None = None


class CourseIndicatorSummary(BaseModel):
    model_config = ConfigDict(frozen=True)

    pas_latest: float | None = None
    pas_average: float | None = None
    pas_cycle: str | None = None
    pas_cycles_count: int = 0
    latest_metrics: CourseYearMetrics | None = None


class CourseIndicatorsDetail(BaseModel):
    model_config = ConfigDict(frozen=True)

    course_id: int
    pas_latest: float | None = None
    pas_average: float | None = None
    pas_cycle: str | None = None
    pas_history: list[PasCycleEntry] = []
    latest_metrics: CourseYearMetrics | None = None
    historical_metrics: list[CourseYearMetrics] = []
    tamburetei_slug: str | None = None
    updated_at: str | None = None


class CampusDashboardSummary(BaseModel):
    model_config = ConfigDict(frozen=True)

    campus: str
    matriculados: int
    desvinculados: int
    taxa_evasao: float
    taxa_media_anual: float | None = None


class UnbDashboardSummary(BaseModel):
    model_config = ConfigDict(frozen=True)

    total_cursos: int
    total_campi: int
    ingressantes: int
    matriculados: int
    concluintes: int
    trancados: int
    evadidos: int
    taxa_media_formacao: float | None = None
    taxa_media_evasao: float | None = None
    resumo_campi: list[CampusDashboardSummary] = []
    updated_at: str | None = None


class CourseIndicatorsCatalog(BaseModel):
    model_config = ConfigDict(frozen=True)

    updated_at: str | None = None
    dashboard: UnbDashboardSummary | None = None
    courses: dict[str, CourseIndicatorSummary] = {}


class ExternalOutcomeRates(BaseModel):
    """Taxas históricas públicas vindas do Tamburetei/DPO (fora dos compartilhamentos do Followw)."""

    model_config = ConfigDict(frozen=True)

    classrooms: int
    approved: float
    failed: float
    dropped: float
    enrolled: int
    source: Literal["tamburetei"] = "tamburetei"
    semesters: list[str] = []


class ExternalSubjectRate(BaseModel):
    model_config = ConfigDict(frozen=True)

    code: str
    name: str
    rates: ExternalOutcomeRates


def _load_snapshot() -> dict[str, Any]:
    global _CACHE_KEY, _CACHE_DATA
    path = SNAPSHOT_PATH
    try:
        stat = path.stat()
    except OSError:
        return {}
    key = (path, stat.st_mtime_ns, stat.st_size)
    if _CACHE_KEY == key and _CACHE_DATA is not None:
        return _CACHE_DATA
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
    except OSError, ValueError:
        return {}
    _CACHE_KEY = key
    _CACHE_DATA = data
    return data


def _normalize_term(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    without_accents = "".join(
        ch for ch in decomposed if unicodedata.category(ch) != "Mn"
    )
    return without_accents.lower().strip()


def _normalized_name(value: str) -> str:
    cleaned = re.sub(r"[–—.,/-]", " ", _normalize_term(value))
    return re.sub(r"\s+", " ", cleaned).strip()


def _canonical_course_name(value: str) -> str:
    key = _normalized_name(value)
    return _NAME_ALIASES.get(key, key)


def _canonical_campus(value: str | None) -> str:
    combined = _normalize_term(value or "")
    if re.search(r"\b(fcte|fga|gama)\b", combined):
        return "FCTE"
    if re.search(r"\b(fce|ceilandia)\b", combined):
        return "FCE"
    if re.search(r"\b(fup|planaltina)\b", combined):
        return "FUP"
    return "Darcy Ribeiro"


def _canonical_shift(shift: str | None) -> str | None:
    if not shift:
        return None
    key = _normalize_term(shift)
    if key in {"d", "diurno", "integral", "matutino", "vespertino"}:
        return "diurno"
    if key in {"n", "noturno"}:
        return "noturno"
    return key


def _canonical_degree(course_name: str, degree: str | None) -> str | None:
    if not degree:
        return None
    normalized = _normalize_term(degree)
    if _PROFESSIONAL_DEGREES.get(course_name) == normalized:
        return "bacharelado"
    return normalized


def _parse_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(str(value).replace(",", "."))
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def _parse_year_metrics(raw: Any) -> CourseYearMetrics | None:
    if not isinstance(raw, dict) or raw.get("ano") is None:
        return None
    try:
        return CourseYearMetrics(
            ano=int(raw["ano"]),
            vagas_totais=raw.get("vagas_totais"),
            inscritos_total=raw.get("inscritos_total"),
            ingressantes=raw.get("ingressantes"),
            matriculados=raw.get("matriculados"),
            concluintes=raw.get("concluintes"),
            trancados=raw.get("trancados"),
            desvinculados=raw.get("desvinculados"),
            taxa_sucesso=_parse_float(raw.get("taxa_sucesso")),
            taxa_evasao=_parse_float(raw.get("taxa_evasao")),
        )
    except TypeError, ValueError:
        return None


def _match_pas_record(
    *,
    name: str,
    shift: str | None,
    degree: str | None,
    modality: str | None,
    unit_code: str | None,
    unit_name: str | None,
    source: dict[str, Any],
) -> dict[str, Any] | None:
    if modality and _normalize_term(modality) in {"a distancia", "ead"}:
        return None
    campus = _canonical_campus(f"{unit_code or ''} {unit_name or ''}")
    canon_name = _canonical_course_name(name)
    canon_shift = _canonical_shift(shift)
    canon_degree = _canonical_degree(canon_name, degree)

    matches = []
    for item in source.get("registros") or []:
        if not isinstance(item, dict):
            continue
        if _canonical_campus(item.get("campus")) != campus:
            continue
        if canon_shift and _canonical_shift(item.get("turno")) != canon_shift:
            continue
        graus = [str(g) for g in (item.get("graus") or [])]
        if canon_degree and not any(_normalize_term(g) == canon_degree for g in graus):
            continue
        item_name = _canonical_course_name(str(item.get("nome") or ""))
        if item_name == canon_name or (
            bool(item.get("ingressoConjunto")) and canon_name in _ENGENHARIAS_FCTE
        ):
            matches.append(item)

    if len(matches) == 1:
        return matches[0]
    # Quando a matriz do curso ainda não foi informada (ex.: card na busca), se há apenas 1
    # registro com mesmo campus+nome+turno ignorando grau, ou todos têm o mesmo mínimo:
    if not matches and canon_degree:
        return None
    return None


def _match_dpo_course(
    *,
    name: str,
    shift: str | None,
    degree: str | None,
    modality: str | None,
    unit_code: str | None,
    unit_name: str | None,
    courses: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if modality and _normalize_term(modality) in {"a distancia", "ead"}:
        return None
    campus = _canonical_campus(f"{unit_code or ''} {unit_name or ''}")
    canon_name = _canonical_course_name(name)
    raw_norm = _normalized_name(name)
    canon_shift = _canonical_shift(shift)
    canon_degree = _canonical_degree(canon_name, degree)

    def _matches(require_degree: bool) -> list[dict[str, Any]]:
        found = []
        for item in courses:
            if not isinstance(item, dict):
                continue
            item_mod = _normalize_term(str(item.get("modalidade") or ""))
            if item_mod in {"a distancia", "ead"}:
                continue
            if _canonical_campus(item.get("campus")) != campus:
                continue
            if canon_shift and _canonical_shift(item.get("turno")) != canon_shift:
                continue
            item_raw = _normalized_name(str(item.get("nome") or ""))
            item_canon = _canonical_course_name(str(item.get("nome") or ""))
            if item_raw != raw_norm and item_canon != canon_name:
                continue
            if require_degree and canon_degree:
                item_deg = _canonical_degree(item_canon, item.get("grau"))
                if item_deg != canon_degree:
                    continue
            found.append(item)
        return found

    exact = _matches(require_degree=True)
    if len(exact) == 1:
        return exact[0]
    if not exact and canon_degree:
        relaxed = _matches(require_degree=False)
        if len(relaxed) == 1:
            return relaxed[0]
    # Se empatou apenas entre bacharelado/licenciatura e já há 1 com métricas, só devolve se único.
    with_metrics = [item for item in exact if item.get("metricas_recentes")]
    if len(with_metrics) == 1:
        return with_metrics[0]
    return None


def _compute_pas_stats(
    history: list[PasCycleEntry],
) -> tuple[float | None, float | None, str | None]:
    latest_score: float | None = None
    latest_cycle: str | None = None
    numeric_scores: list[float] = []
    for entry in history:
        score = _parse_float(entry.minimo)
        if score is None:
            continue
        if latest_score is None:
            latest_score = round(score, 3)
            latest_cycle = entry.ciclo
        numeric_scores.append(score)
    average = (
        round(sum(numeric_scores) / len(numeric_scores), 3) if numeric_scores else None
    )
    return latest_score, average, latest_cycle


def course_indicators(
    *,
    course_id: int,
    name: str,
    shift: str | None,
    unit_code: str | None,
    unit_name: str | None,
    degree: str | None = None,
    modality: str | None = None,
) -> CourseIndicatorsDetail:
    snapshot = _load_snapshot()
    pas_history: list[PasCycleEntry] = []
    for source in snapshot.get("pas_cycles") or []:
        if not isinstance(source, dict):
            continue
        record = _match_pas_record(
            name=name,
            shift=shift,
            degree=degree,
            modality=modality,
            unit_code=unit_code,
            unit_name=unit_name,
            source=source,
        )
        if record is None:
            continue
        modalidades = [
            PasModality(
                id=str(m["id"]),
                sistema=str(m["sistema"]),
                descricao=str(m["descricao"]),
            )
            for m in (source.get("modalidades") or [])
            if isinstance(m, dict) and m.get("id")
        ]
        cotas: dict[str, PasQuotaScore] = {}
        for key, score in (record.get("cotas") or {}).items():
            if isinstance(score, dict):
                cotas[str(key)] = PasQuotaScore(
                    minimo=score.get("minimo"),
                    maximo=score.get("maximo"),
                    observacao=score.get("observacao"),
                )
        pas_history.append(
            PasCycleEntry(
                ciclo=str(source.get("ciclo") or ""),
                sistema=str(source.get("sistema") or "Sistema Universal"),
                url=str(source.get("url") or ""),
                observacao=source.get("observacao"),
                modalidades=modalidades,
                nome=str(record.get("nome") or name),
                campus=str(record.get("campus") or ""),
                grau=str(record.get("grau") or ""),
                graus=[str(g) for g in (record.get("graus") or [])],
                turno=str(record.get("turno") or ""),
                minimo=record.get("minimo"),
                maximo=record.get("maximo"),
                pagina=int(record.get("pagina") or 1),
                ingresso_conjunto=bool(record.get("ingressoConjunto")),
                oferta_original=record.get("ofertaOriginal"),
                cotas=cotas,
            )
        )

    pas_latest, pas_average, pas_cycle = _compute_pas_stats(pas_history)
    matched_dpo = _match_dpo_course(
        name=name,
        shift=shift,
        degree=degree,
        modality=modality,
        unit_code=unit_code,
        unit_name=unit_name,
        courses=snapshot.get("courses") or [],
    )
    latest_metrics = (
        _parse_year_metrics(matched_dpo.get("metricas_recentes"))
        if matched_dpo
        else None
    )
    historical_metrics = (
        sorted(
            (
                parsed
                for raw in (matched_dpo.get("metricas_historicas") or [])
                if (parsed := _parse_year_metrics(raw)) is not None
            ),
            key=lambda item: item.ano,
            reverse=True,
        )
        if matched_dpo
        else []
    )

    return CourseIndicatorsDetail(
        course_id=course_id,
        pas_latest=pas_latest,
        pas_average=pas_average,
        pas_cycle=pas_cycle,
        pas_history=pas_history,
        latest_metrics=latest_metrics,
        historical_metrics=historical_metrics,
        tamburetei_slug=str(matched_dpo["slug"])
        if matched_dpo and matched_dpo.get("slug")
        else None,
        updated_at=snapshot.get("updated_at"),
    )


def course_indicator_summary(
    *,
    course_id: int,
    name: str,
    shift: str | None,
    unit_code: str | None,
    unit_name: str | None,
    degree: str | None = None,
    modality: str | None = None,
) -> CourseIndicatorSummary:
    detail = course_indicators(
        course_id=course_id,
        name=name,
        shift=shift,
        unit_code=unit_code,
        unit_name=unit_name,
        degree=degree,
        modality=modality,
    )
    return CourseIndicatorSummary(
        pas_latest=detail.pas_latest,
        pas_average=detail.pas_average,
        pas_cycle=detail.pas_cycle,
        pas_cycles_count=sum(
            1 for entry in detail.pas_history if _parse_float(entry.minimo) is not None
        ),
        latest_metrics=detail.latest_metrics,
    )


def dashboard_summary() -> UnbDashboardSummary | None:
    snapshot = _load_snapshot()
    raw = snapshot.get("dashboard")
    if not isinstance(raw, dict) or not raw.get("total_cursos"):
        return None
    campuses: list[CampusDashboardSummary] = []
    for item in raw.get("resumo_campi") or []:
        if not isinstance(item, dict) or not item.get("campus"):
            continue
        campuses.append(
            CampusDashboardSummary(
                campus=str(item["campus"]),
                matriculados=int(item.get("matriculados") or 0),
                desvinculados=int(item.get("desvinculados") or 0),
                taxa_evasao=round(float(item.get("taxa_evasao") or 0.0), 2),
                taxa_media_anual=_parse_float(item.get("taxa_media_anual")),
            )
        )
    return UnbDashboardSummary(
        total_cursos=int(raw.get("total_cursos") or 0),
        total_campi=int(raw.get("total_campi") or 0),
        ingressantes=int(raw.get("ingressantes") or 0),
        matriculados=int(raw.get("matriculados") or 0),
        concluintes=int(raw.get("concluintes") or 0),
        trancados=int(raw.get("trancados") or 0),
        evadidos=int(raw.get("evadidos") or 0),
        taxa_media_formacao=_parse_float(raw.get("taxa_media_formacao")),
        taxa_media_evasao=_parse_float(raw.get("taxa_media_evasao")),
        resumo_campi=campuses,
        updated_at=snapshot.get("updated_at"),
    )


def _subject_external_rates(raw: dict[str, Any]) -> ExternalOutcomeRates | None:
    consolidada = raw.get("metrica_consolidada")
    if not isinstance(consolidada, dict):
        return None
    enrolled = int(consolidada.get("matriculados") or 0)
    # Respeita a supressão LGPD do próprio Tamburetei/DPO (n < 5 ou taxa suprimida).
    if enrolled < 5 or consolidada.get("taxa_aprovacao_acumulada") is None:
        return None
    approved_n = int(consolidada.get("aprovados") or 0)
    failed_n = int(consolidada.get("reprovados_nota") or 0) + int(
        consolidada.get("reprovados_falta") or 0
    )
    dropped_n = int(consolidada.get("trancamentos") or 0)
    metricas = [
        m
        for m in (raw.get("metricas") or [])
        if isinstance(m, dict) and not m.get("amostragem_suprimida_lgpd")
    ]
    semesters = sorted(
        {
            f"{m['ano']}.{m['semestre']}"
            for m in metricas
            if m.get("ano") and m.get("semestre")
        },
        reverse=True,
    )
    return ExternalOutcomeRates(
        classrooms=max(len(metricas), 1),
        approved=round((approved_n / enrolled) * 100.0, 1),
        failed=round((failed_n / enrolled) * 100.0, 1),
        dropped=round((dropped_n / enrolled) * 100.0, 1),
        enrolled=enrolled,
        semesters=semesters,
    )


def subject_external_outcomes(code: str) -> ExternalOutcomeRates | None:
    snapshot = _load_snapshot()
    target = code.strip().upper()
    for item in snapshot.get("subjects") or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("codigo") or "").strip().upper() == target:
            return _subject_external_rates(item)
    return None


def all_external_subject_rates(
    allowed_codes: set[str] | None = None,
) -> list[ExternalSubjectRate]:
    snapshot = _load_snapshot()
    results: list[ExternalSubjectRate] = []
    for item in snapshot.get("subjects") or []:
        if not isinstance(item, dict):
            continue
        code = str(item.get("codigo") or "").strip().upper()
        if not code:
            continue
        if allowed_codes is not None and code not in allowed_codes:
            continue
        rates = _subject_external_rates(item)
        if rates is None:
            continue
        results.append(
            ExternalSubjectRate(
                code=code,
                name=str(item.get("nome") or code),
                rates=rates,
            )
        )
    results.sort(key=lambda entry: (-entry.rates.failed, entry.code))
    return results


def snapshot_updated_at() -> str | None:
    return _load_snapshot().get("updated_at")
