"""DOCX, PPTX e XLSX (Office Open XML) e texto puro, aceitos só depois de validação estrita.

Não há antivírus aqui e nada neste módulo promete detectar todo código malicioso. O que se faz é
recusar o que costuma carregar risco (macros, objetos embutidos, ActiveX, vínculos externos, DDE,
DOCTYPE/entidades XML, zip-bomb, caminhos fora do pacote) e reconstruir o pacote só com as partes
permitidas, com metadados de autoria esvaziados. O arquivo nunca ganha prévia no navegador.
"""

import re
import zipfile
from io import BytesIO

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
TEXT = "text/plain"
OFFICE_TYPES = {DOCX: ".docx", XLSX: ".xlsx", PPTX: ".pptx"}
# Parte principal de cada formato, procurada no pacote (nunca na extensão enviada).
_MAIN = {
    "word/document.xml": DOCX,
    "xl/workbook.xml": XLSX,
    "ppt/presentation.xml": PPTX,
}
_MAX_ENTRIES = 1500
_MAX_ENTRY = 50 * 1024 * 1024
_MAX_TOTAL = 120 * 1024 * 1024
_MAX_RATIO = 120
MAX_TEXT_BYTES = 1024 * 1024

# Qualquer parte com um destes trechos no caminho é recusada.
_FORBIDDEN_PATH = re.compile(
    r"(vbaproject|vbadata|/macrosheets/|/dialogsheets/|/embeddings/|/activex/|/externallinks/|"
    r"/connections\.xml|/querytables/|/customui/|/oleobject|\.exe$|\.dll$|\.js$|\.vbs$|\.ps1$|"
    r"\.bat$|\.cmd$|\.scr$|\.jar$|\.hta$|\.lnk$)",
    re.IGNORECASE,
)
_FORBIDDEN_TYPE = re.compile(
    r"(macroenabled|vbaproject|oleobject|activex)", re.IGNORECASE
)
# Campos do Word que buscam ou executam algo fora do documento.
_FIELDS = re.compile(
    rb"(ddeauto|\bdde\b|includetext|includepicture|\blink\b|\bimport\b|autoopen)",
    re.IGNORECASE,
)
_FIELD_ELEMENT = re.compile(
    rb"<w:instrText[^>]*>([^<]*)</w:instrText>|w:instr=\"([^\"]*)\""
)
# Fórmula do Excel no estilo DDE (`=cmd|'/c ...'!A1`).
_DDE_FORMULA = re.compile(rb"<f[^>]*>[^<]*\|[^<]*!")
_DOCTYPE = re.compile(rb"<!(doctype|entity)", re.IGNORECASE)
_EXTERNAL = re.compile(rb'TargetMode\s*=\s*"External"', re.IGNORECASE)
_REL_TYPE = re.compile(rb'Type\s*=\s*"([^"]+)"')
_BLANK = {
    "docProps/core.xml": (
        b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        b'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        b'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
        b'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>'
    ),
    "docProps/app.xml": (
        b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        b'<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>'
    ),
    "docProps/custom.xml": (
        b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        b'<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>'
    ),
}


class InvalidOffice(ValueError):
    pass


def _open(data: bytes) -> zipfile.ZipFile:
    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except (zipfile.BadZipFile, OSError, ValueError, NotImplementedError) as error:
        raise InvalidOffice("Arquivo Office corrompido ou inválido.") from error
    return archive


def detect(data: bytes) -> str | None:
    """O formato pelo conteúdo do pacote; `None` se não for DOCX, XLSX ou PPTX."""
    if not data.startswith(b"PK\x03\x04"):
        return None
    try:
        with _open(data) as archive:
            names = {name for name in archive.namelist()}
    except InvalidOffice:
        return None
    found = {mime for part, mime in _MAIN.items() if part in names}
    if "[Content_Types].xml" in names and len(found) == 1:
        return found.pop()
    return None


def _name_ok(name: str) -> bool:
    return (
        bool(name)
        and not name.startswith(("/", "\\"))
        and "\\" not in name
        and ".." not in name.split("/")
        and ":" not in name
        and "\x00" not in name
    )


def sanitize_office(data: bytes, mime: str) -> bytes:
    """Valida o pacote inteiro e devolve outro, reconstruído sem metadados de autoria."""
    if detect(data) != mime:
        raise InvalidOffice("O conteúdo não corresponde a um documento Office válido.")
    output = BytesIO()
    seen: set[str] = set()
    total = 0
    with (
        _open(data) as source,
        zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target,
    ):
        infos = source.infolist()
        if len(infos) > _MAX_ENTRIES:
            raise InvalidOffice("Documento com partes demais.")
        for info in sorted(
            infos, key=lambda i: (i.filename != "[Content_Types].xml", i.filename)
        ):
            name = info.filename
            lowered = name.lower()
            if info.is_dir():
                continue
            if not _name_ok(name) or lowered in seen:
                raise InvalidOffice("Documento com caminhos inválidos ou repetidos.")
            seen.add(lowered)
            if info.flag_bits & 0x1:
                raise InvalidOffice("Documento protegido por senha não é aceito.")
            if _FORBIDDEN_PATH.search("/" + lowered):
                raise InvalidOffice(
                    "O documento contém macros, objetos embutidos ou vínculos externos."
                )
            if info.file_size > _MAX_ENTRY:
                raise InvalidOffice("Documento grande demais depois de descompactado.")
            if (
                info.compress_size
                and info.file_size / info.compress_size > _MAX_RATIO
                and info.file_size > 1024 * 1024
            ):
                raise InvalidOffice("Compressão suspeita (possível arquivo-bomba).")
            total += info.file_size
            if total > _MAX_TOTAL:
                raise InvalidOffice("Documento grande demais depois de descompactado.")
            if lowered in {p.lower() for p in _BLANK}:
                target.writestr(
                    _info(name), _BLANK[next(p for p in _BLANK if p.lower() == lowered)]
                )
                continue
            with source.open(info) as part:
                content = part.read(_MAX_ENTRY + 1)
            if len(content) > _MAX_ENTRY:
                raise InvalidOffice("Documento grande demais depois de descompactado.")
            if lowered.endswith((".xml", ".rels")):
                _check_xml(lowered, content)
            target.writestr(_info(name), content)
    return output.getvalue()


def _info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    return info


def _check_xml(name: str, content: bytes) -> None:
    if _DOCTYPE.search(content):
        raise InvalidOffice("O documento usa declarações XML não permitidas.")
    if name == "[content_types].xml" and _FORBIDDEN_TYPE.search(
        content.decode("utf-8", "ignore")
    ):
        raise InvalidOffice("O documento contém macros ou objetos embutidos.")
    if name.endswith(".rels"):
        for relation in re.findall(rb"<Relationship\b[^>]*>", content):
            if not _EXTERNAL.search(relation):
                continue
            kind = _REL_TYPE.search(relation)
            # Só link de hipertexto comum; qualquer outro vínculo externo busca dado fora do arquivo.
            if not kind or not kind.group(1).endswith(b"/hyperlink"):
                raise InvalidOffice("O documento busca conteúdo externo.")
        return
    for match in _FIELD_ELEMENT.finditer(content):
        instruction = match.group(1) or match.group(2) or b""
        if _FIELDS.search(instruction):
            raise InvalidOffice(
                "O documento usa campos que executam ou buscam conteúdo."
            )
    if _DDE_FORMULA.search(content):
        raise InvalidOffice("O documento usa fórmulas que executam comandos.")


def sniff_text(data: bytes, filename: str) -> bool:
    """Texto puro só quando o nome termina em .txt e o conteúdo é UTF-8 sem caracteres de controle."""
    if not filename.lower().endswith(".txt") or not data or len(data) > MAX_TEXT_BYTES:
        return False
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return False
    return not any(ord(c) < 32 and c not in "\n\r\t" or ord(c) == 127 for c in text)


def sanitize_text(data: bytes) -> bytes:
    if not sniff_text(data, "x.txt"):
        raise InvalidOffice("Texto inválido: use UTF-8 sem caracteres de controle.")
    text = data.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    return text.encode("utf-8")
