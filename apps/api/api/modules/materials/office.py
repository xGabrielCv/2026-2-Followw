"""DOCX, PPTX e XLSX (Office Open XML) e texto puro, aceitos só depois de validação estrita.

Não há antivírus aqui e nada neste módulo promete detectar todo código malicioso. O que se faz é
recusar o que costuma carregar risco (macros, objetos embutidos, ActiveX, vínculos externos, DDE,
DOCTYPE/entidades XML, zip-bomb, caminhos fora do pacote) e reconstruir o pacote só com as partes
permitidas, com metadados de autoria esvaziados. O arquivo nunca ganha prévia no navegador.
"""

import re
import struct
import zipfile
import zlib
from io import BytesIO

from PIL import Image, ImageOps

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
# Partes de comentários e listas de autores/revisores que expõem nomes reais de alunos.
_DROPPED_AUTHOR_PARTS = re.compile(
    r"^(word/(comments[^/]*|people)\.xml|ppt/(comments/.*|commentauthors\.xml)|"
    r"xl/(comments[^/]*\.xml|threadedcomments/.*|persons/.*))$",
    re.IGNORECASE,
)
_DROPPED_REL = re.compile(
    rb"<Relationship\b[^>]*(?:comments|people|commentAuthors|threadedComment|person)[^>]*/>",
    re.IGNORECASE,
)
_DROPPED_CONTENT_TYPE = re.compile(
    rb"<Override\b[^>]*PartName\s*=\s*\"/(?:word/(?:comments|people)|ppt/(?:comments|commentAuthors)|xl/(?:comments|threadedComments|persons))[^\"]*\"[^>]*/>",
    re.IGNORECASE,
)
_AUTHOR_ATTR = re.compile(
    rb'\b((?:[A-Za-z0-9_]+:)?(?:author|initials|userId|providerId))\s*=\s*"[^"]*"'
)
_MEDIA_PATH = re.compile(r"^(?:word|ppt|xl)/media/", re.IGNORECASE)
_MAX_MEDIA_PIXELS = 40_000_000
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


class ZipEntryTooLarge(InvalidOffice):
    pass


def read_zip_entry_safe(data: bytes, info: zipfile.ZipInfo, max_bytes: int) -> bytes:
    """Descompacta uma entrada ZIP limitando estritamente os bytes no `zlib` (imune a cabeçalho forjado)."""
    offset = info.header_offset
    if (
        offset < 0
        or offset + 30 > len(data)
        or data[offset : offset + 4] != b"PK\x03\x04"
    ):
        raise InvalidOffice("Cabeçalho local ZIP inválido.")
    fname_len, extra_len = struct.unpack_from("<HH", data, offset + 26)
    start = offset + 30 + fname_len + extra_len
    end = start + info.compress_size
    if info.compress_size < 0 or end > len(data):
        raise InvalidOffice("Entrada ZIP truncada.")
    raw = memoryview(data)[start:end]
    if info.compress_type == zipfile.ZIP_STORED:
        if len(raw) > max_bytes:
            raise ZipEntryTooLarge("Documento grande demais depois de descompactado.")
        content = bytes(raw)
    elif info.compress_type == zipfile.ZIP_DEFLATED:
        try:
            decomp = zlib.decompressobj(-15)
            chunk = decomp.decompress(raw, max_bytes + 1)
            if len(chunk) > max_bytes or decomp.unconsumed_tail:
                raise ZipEntryTooLarge(
                    "Documento grande demais depois de descompactado."
                )
            tail = decomp.flush(max_bytes + 1 - len(chunk))
            content = chunk + tail
            if len(content) > max_bytes:
                raise ZipEntryTooLarge(
                    "Documento grande demais depois de descompactado."
                )
        except zlib.error as error:
            raise InvalidOffice("Fluxo compactado corrompido no Office.") from error
    else:
        raise InvalidOffice("Método de compressão ZIP não suportado.")
    if (zlib.crc32(content) & 0xFFFFFFFF) != info.CRC or len(content) != info.file_size:
        raise InvalidOffice("Integridade CRC/tamanho inválida no pacote Office.")
    return content


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
            if _DROPPED_AUTHOR_PARTS.match(lowered):
                continue
            content = read_zip_entry_safe(data, info, _MAX_ENTRY)
            total += len(content) - info.file_size
            if total > _MAX_TOTAL:
                raise InvalidOffice("Documento grande demais depois de descompactado.")
            if lowered.endswith((".xml", ".rels")):
                _check_xml(lowered, content)
                content = _strip_xml_authors(lowered, content)
            elif _MEDIA_PATH.match(lowered):
                content = _strip_media_metadata(content)
            target.writestr(_info(name), content)
    return output.getvalue()


def _strip_xml_authors(lowered: str, content: bytes) -> bytes:
    if lowered == "[content_types].xml":
        return _DROPPED_CONTENT_TYPE.sub(b"", content)
    if lowered.endswith(".rels"):
        return _DROPPED_REL.sub(b"", content)
    return _AUTHOR_ATTR.sub(rb'\1=""', content)


def _strip_media_metadata(content: bytes) -> bytes:
    fmt: str | None = None
    if content.startswith(b"\xff\xd8\xff"):
        fmt = "JPEG"
    elif content.startswith(b"\x89PNG\r\n\x1a\n"):
        fmt = "PNG"
    elif content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        fmt = "WEBP"
    if fmt is None:
        return content
    try:
        with Image.open(BytesIO(content)) as probe:
            if probe.width * probe.height > _MAX_MEDIA_PIXELS:
                raise InvalidOffice(
                    "Imagem embutida grande demais no documento Office."
                )
            probe.verify()
        with Image.open(BytesIO(content)) as image:
            image.load()
            clean = ImageOps.exif_transpose(image)
            if fmt == "JPEG" and clean.mode not in ("RGB", "L"):
                clean = clean.convert("RGB")
            out = BytesIO()
            opts = {"quality": 90} if fmt != "PNG" else {"optimize": True}
            clean.save(out, format=fmt, **opts)
            return out.getvalue()
    except InvalidOffice:
        raise
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as error:
        raise InvalidOffice(
            "Imagem embutida corrompida no documento Office."
        ) from error


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
