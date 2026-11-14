"""Varredura ativa de ameaças em arquivos enviados (YARA-X, PDF, Office/OLE2 e polyglots)."""

import re
import zipfile
from dataclasses import dataclass
from io import BytesIO

import olefile
import yara_x
from pypdf import PdfReader
from pypdf.errors import PdfReadError


class ScanRejected(Exception):
    """Arquivo barrado por um motor de segurança antes ou após sanitização."""

    def __init__(
        self, engine: str, reason_code: str, detail: str, status_code: int = 422
    ) -> None:
        super().__init__(detail)
        self.engine = engine
        self.reason_code = reason_code
        self.detail = detail
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class ScanFinding:
    engine: str
    reason_code: str
    detail: str
    status_code: int = 422


_YARA_SOURCE = r"""
rule Eicar_Test_Signature {
    meta:
        engine = "yara-x"
        code = "eicar_signature"
        detail = "Arquivo recusado: assinatura de teste antivírus (EICAR) detectada."
    strings:
        $eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    condition:
        $eicar
}

rule Executable_Binary_Payload {
    meta:
        engine = "yara-x"
        code = "executable_payload"
        detail = "Arquivo recusado: assinatura de executável nativo ou bytecode detectada."
    strings:
        $elf = { 7F 45 4C 46 }
        $macho32 = { FE ED FA CE }
        $macho64 = { FE ED FA CF }
        $macho_le = { CF FA ED FE }
        $java_class = { CA FE BA BE 00 00 }
        $lnk = { 4C 00 00 00 01 14 02 00 00 00 00 00 C0 00 00 00 }
        $mz = { 4D 5A }
        $pe_hdr = "PE\x00\x00"
    condition:
        $elf at 0 or $macho32 at 0 or $macho64 at 0 or $macho_le at 0 or $java_class at 0 or $lnk at 0 or ($mz at 0 and $pe_hdr in (0..4096))
}

rule Script_Or_Stager_Payload {
    meta:
        engine = "yara-x"
        code = "script_stager"
        detail = "Arquivo recusado: comando ou script executável suspeito detectado."
    strings:
        $ps_enc = /powershell(\.exe)?\s+-(enc|encodedcommand|w\s+hidden|nop)/ nocase
        $iex = /Invoke-Expression|IEX\s*\(/ nocase
        $wscript = /CreateObject\(\s*["']WScript\.Shell["']\s*\)/ nocase
        $cmd_exec = /cmd(\.exe)?\s+\/[ck]\s+(powershell|certutil|bitsadmin|curl|wget|mshta)/ nocase
        $mshta = /mshta(\.exe)?\s+(http|javascript:|vbscript:)/ nocase
        $xss_svg = /<(script|foreignObject)\b/ nocase
        $xss_attr = /\son(load|error|click)\s*=\s*["']?[^"'>]{3,}/ nocase
    condition:
        any of them
}

rule Pdf_Dangerous_Exploit_Primitives {
    meta:
        engine = "yara-x"
        code = "pdf_exploit_primitive"
        detail = "PDF recusado: contém primitivas perigosas (ação externa, embutido, XFA ou API de script arriscada)."
    strings:
        $launch = "/Launch"
        $rich = "/RichMedia"
        $submit = "/SubmitForm"
        $imp = "/ImportData"
        $emb = "/EmbeddedFiles"
        $emb_single = "/EmbeddedFile"
        $xfa = "/XFA"
        $gotor = "/GoToR"
        $gotoe = "/GoToE"
        $js_launch = "app.launchURL" nocase
        $js_export = "exportDataObject" nocase
        $js_import = "importTextData" nocase
        $js_eval = /eval\s*\(\s*unescape\s*\(/ nocase
        $js_printf = "util.printf" nocase
        $js_collab = "Collab.collectEmailInfo" nocase
    condition:
        any of them
}
"""

_RULES = yara_x.compile(_YARA_SOURCE)

_FORBIDDEN_PDF_URI = re.compile(
    r"^\s*(javascript|vbscript|file|data:text/html):", re.IGNORECASE
)
_FORBIDDEN_PDF_ACTIONS = frozenset(
    {
        "/Launch",
        "/RichMedia",
        "/SubmitForm",
        "/ImportData",
        "/GoToR",
        "/GoToE",
    }
)
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_OLE_DANGEROUS_STREAMS = frozenset(
    {"macros", "vba", "_vba_project", "objectpool", "\x01ole10native", "package"}
)
_MAX_SCAN_ZIP_ENTRIES = 1500
_MAX_SCAN_ENTRY_BYTES = 16 * 1024 * 1024
_MAX_SCAN_TOTAL_BYTES = 64 * 1024 * 1024


def active_engines() -> list[str]:
    """Motores ativos nesta instância (útil para status no admin e telemetria)."""
    from api.modules.materials import av

    engines = ["yara-x", "pdf-inspector", "office-ole", "image-reencode"]
    if av.enabled():
        engines.append("clamav")
    return engines


def _run_yara(data: bytes) -> ScanFinding | None:
    if not data:
        return None
    matches = _RULES.scan(data).matching_rules
    if not matches:
        return None
    rule = matches[0]
    meta = dict(rule.metadata)
    return ScanFinding(
        engine=str(meta.get("engine") or "yara-x"),
        reason_code=str(meta.get("code") or rule.identifier.lower()),
        detail=str(
            meta.get("detail")
            or f"Arquivo recusado pela regra de segurança ({rule.identifier})."
        ),
    )


def _scan_ole_bytes(data: bytes) -> ScanFinding | None:
    if not data.startswith(_OLE_MAGIC):
        return None
    try:
        with olefile.OleFileIO(BytesIO(data)) as ole:
            for path in ole.listdir(streams=True, storages=True):
                lowered = {part.lower() for part in path}
                if lowered & _OLE_DANGEROUS_STREAMS:
                    return ScanFinding(
                        engine="office-ole",
                        reason_code="ole_macro_or_object",
                        detail="Documento recusado: objeto OLE/macro embutido detectado.",
                    )
    except OSError:
        return ScanFinding(
            engine="office-ole",
            reason_code="corrupted_ole",
            detail="Documento recusado: objeto OLE embutido inválido.",
        )
    return None


def _inspect_pdf_deep(data: bytes) -> None:
    # Polyglot: %PDF- precisa abrir o arquivo (permite apenas BOM UTF-8 eventual).
    head = data.lstrip(b"\xef\xbb\xbf")
    if not head.startswith(b"%PDF-"):
        raise ScanRejected(
            "pdf-inspector",
            "pdf_polyglot_header",
            "PDF inválido: cabeçalho fora do início do arquivo.",
        )
    try:
        reader = PdfReader(BytesIO(data))
    except (PdfReadError, OSError, ValueError, KeyError, TypeError) as error:
        raise ScanRejected(
            "pdf-inspector",
            "pdf_corrupted",
            "PDF corrompido ou inválido.",
        ) from error

    if reader.is_encrypted:
        raise ScanRejected(
            "pdf-inspector",
            "pdf_encrypted",
            "PDF protegido por senha não é aceito.",
        )

    root = reader.trailer.get("/Root")
    root_obj = root.get_object() if hasattr(root, "get_object") else root
    if isinstance(root_obj, dict):
        names = root_obj.get("/Names")
        names_obj = names.get_object() if hasattr(names, "get_object") else names
        if isinstance(names_obj, dict) and "/EmbeddedFiles" in names_obj:
            raise ScanRejected(
                "pdf-inspector",
                "pdf_embedded_files",
                "PDF com arquivos embutidos não é aceito.",
            )
        acro = root_obj.get("/AcroForm")
        acro_obj = acro.get_object() if hasattr(acro, "get_object") else acro
        if isinstance(acro_obj, dict) and "/XFA" in acro_obj:
            raise ScanRejected(
                "pdf-inspector",
                "pdf_xfa_form",
                "PDF com formulário dinâmico XFA não é aceito.",
            )

    for page in reader.pages[:300]:
        annots = page.get("/Annots")
        annot_list = annots.get_object() if hasattr(annots, "get_object") else annots
        if isinstance(annot_list, list):
            for ref in annot_list[:200]:
                annot = ref.get_object() if hasattr(ref, "get_object") else ref
                if not isinstance(annot, dict):
                    continue
                action = annot.get("/A")
                action_obj = (
                    action.get_object() if hasattr(action, "get_object") else action
                )
                if isinstance(action_obj, dict):
                    if action_obj.get("/S") in _FORBIDDEN_PDF_ACTIONS:
                        raise ScanRejected(
                            "pdf-inspector",
                            "pdf_forbidden_action",
                            "PDF com ações externas (Launch/RichMedia) não é aceito.",
                        )
                    uri = action_obj.get("/URI")
                    if isinstance(uri, str) and _FORBIDDEN_PDF_URI.match(uri):
                        raise ScanRejected(
                            "pdf-inspector",
                            "pdf_dangerous_uri",
                            "PDF com link executável (javascript/file) não é aceito.",
                        )
        # Varrer fluxo de conteúdo descomprimido para evitar payloads comprimidos em FlateDecode.
        try:
            contents = page.get_contents()
            raw = contents.get_data() if contents is not None else b""
        except PdfReadError, OSError, ValueError, KeyError, TypeError, AttributeError:
            raw = b""
        if raw:
            finding = _run_yara(raw)
            if finding is not None:
                raise ScanRejected(finding.engine, finding.reason_code, finding.detail)


def _inspect_office_deep(data: bytes) -> None:
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            infos = archive.infolist()
            if len(infos) > _MAX_SCAN_ZIP_ENTRIES:
                raise ScanRejected(
                    "office-ole",
                    "zip_bomb",
                    "Arquivo Office excede o limite estrutural de entradas.",
                )
            total = 0
            for info in infos:
                if info.file_size > _MAX_SCAN_ENTRY_BYTES:
                    raise ScanRejected(
                        "office-ole",
                        "zip_bomb",
                        "Entrada interna grande demais no documento Office.",
                    )
                total += info.file_size
                if total > _MAX_SCAN_TOTAL_BYTES:
                    raise ScanRejected(
                        "office-ole",
                        "zip_bomb",
                        "Documento Office excede o tamanho descompactado permitido.",
                    )
                entry_bytes = archive.read(info.filename)
                finding = _run_yara(entry_bytes) or _scan_ole_bytes(entry_bytes)
                if finding is not None:
                    raise ScanRejected(
                        finding.engine, finding.reason_code, finding.detail
                    )
    except ScanRejected:
        raise
    except (zipfile.BadZipFile, OSError, ValueError, NotImplementedError) as error:
        raise ScanRejected(
            "office-ole",
            "office_corrupted",
            "Arquivo Office corrompido ou inválido.",
        ) from error


def scan_raw(data: bytes, mime: str | None) -> None:
    """Executa varredura ativa antes de sanitizar/armazenar."""
    ole_finding = _scan_ole_bytes(data)
    if ole_finding is not None:
        raise ScanRejected(
            ole_finding.engine,
            ole_finding.reason_code,
            ole_finding.detail,
            status_code=415 if mime is None else 422,
        )

    finding = _run_yara(data)
    if finding is not None:
        status = (
            415 if mime is None and finding.reason_code != "eicar_signature" else 422
        )
        raise ScanRejected(
            finding.engine, finding.reason_code, finding.detail, status_code=status
        )

    if mime == "application/pdf":
        _inspect_pdf_deep(data)
    elif mime and mime.startswith("application/vnd.openxmlformats-"):
        _inspect_office_deep(data)


def verify_clean(clean: bytes, mime: str) -> None:
    """Confirma após reconstrução que nenhuma assinatura ativa sobreviveu."""
    finding = _run_yara(clean)
    if finding is not None:
        raise ScanRejected(finding.engine, finding.reason_code, finding.detail)
    if mime.startswith("application/vnd.openxmlformats-"):
        _inspect_office_deep(clean)
