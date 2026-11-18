"""Confere o tipo real do arquivo e regrava sem metadados.

PDF, imagens (PNG, JPEG, WebP), documentos Office (DOCX, PPTX, XLSX) e texto puro (.txt): o tipo vem do
conteúdo, nunca da extensão (o .txt é a única exceção, e só com UTF-8 sem caracteres de controle). Imagens
são decodificadas e salvas de novo, sem EXIF (onde fica o GPS e o aparelho). PDFs são refeitos
só com as páginas: saem autor, programa, XMP, JavaScript, anexos, formulários e anotações.
"""

from io import BytesIO

from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError

from api.modules.materials import office

EXTENSIONS = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    office.TEXT: ".txt",
    **office.OFFICE_TYPES,
}
_IMAGE_FORMATS = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}
# Uma foto de prova cabe com folga; acima disso é imagem-bomba.
_MAX_PIXELS = 40_000_000
_MAX_PAGES = 300


class InvalidFile(ValueError):
    pass


def sniff(data: bytes, filename: str = "") -> str | None:
    """O tipo pelo conteúdo; `None` fora dos aceitos."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"PK\x03\x04"):
        return office.detect(data)
    if office.sniff_text(data, filename):
        return office.TEXT
    return None


def sanitize(data: bytes, mime: str) -> bytes:
    if mime == "application/pdf":
        return _pdf(data)
    if mime == office.TEXT:
        return _office(office.sanitize_text, data)
    if mime in office.OFFICE_TYPES:
        return _office(office.sanitize_office, data, mime)
    return _image(data, mime)


def _office(function, *args) -> bytes:
    try:
        return function(*args)
    except office.InvalidOffice as error:
        raise InvalidFile(str(error)) from error


def _image(data: bytes, mime: str) -> bytes:
    try:
        with Image.open(BytesIO(data)) as probe:
            if probe.width * probe.height > _MAX_PIXELS:
                raise InvalidFile("Imagem grande demais.")
            probe.verify()
        with Image.open(BytesIO(data)) as image:
            image.load()
            # Gira pela orientação do EXIF antes de jogá-lo fora.
            clean = ImageOps.exif_transpose(image)
            if mime == "image/jpeg" and clean.mode not in ("RGB", "L"):
                clean = clean.convert("RGB")
            output = BytesIO()
            options = {"quality": 90} if mime != "image/png" else {"optimize": True}
            clean.save(output, format=_IMAGE_FORMATS[mime], **options)
            return output.getvalue()
    except InvalidFile:
        raise
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as error:
        raise InvalidFile("Imagem corrompida ou inválida.") from error


_FORBIDDEN_PDF_ACTIONS = {
    "/Launch",
    "/RichMedia",
    "/SubmitForm",
    "/ImportData",
    "/JavaScript",
    "/JS",
}


def _pdf_has_forbidden_content(reader: PdfReader) -> bool:
    root = reader.trailer.get("/Root")
    root_obj = root.get_object() if hasattr(root, "get_object") else root
    if isinstance(root_obj, dict):
        open_action = root_obj.get("/OpenAction")
        open_obj = (
            open_action.get_object()
            if hasattr(open_action, "get_object")
            else open_action
        )
        if isinstance(open_obj, dict) and open_obj.get("/S") in _FORBIDDEN_PDF_ACTIONS:
            return True
        names = root_obj.get("/Names")
        names_obj = names.get_object() if hasattr(names, "get_object") else names
        if isinstance(names_obj, dict) and "/EmbeddedFiles" in names_obj:
            return True
    for page in reader.pages:
        aa = page.get("/AA")
        aa_obj = aa.get_object() if hasattr(aa, "get_object") else aa
        if isinstance(aa_obj, dict):
            for value in aa_obj.values():
                val = value.get_object() if hasattr(value, "get_object") else value
                if isinstance(val, dict) and val.get("/S") in _FORBIDDEN_PDF_ACTIONS:
                    return True
    return False


def _strip_jpeg_segments(jpeg: bytes) -> bytes:
    """Remove segmentos EXIF/XMP/IPTC e comentários de streams JPEG sem alterar os pixels."""
    if not jpeg.startswith(b"\xff\xd8"):
        return jpeg
    out = bytearray(b"\xff\xd8")
    pos = 2
    size = len(jpeg)
    while pos < size:
        if jpeg[pos] != 0xFF:
            out.extend(jpeg[pos:])
            break
        while pos < size and jpeg[pos] == 0xFF:
            pos += 1
        if pos >= size:
            break
        marker = jpeg[pos]
        pos += 1
        if marker in (0xD9, 0xDA):
            out.extend((0xFF, marker))
            out.extend(jpeg[pos:])
            break
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            out.extend((0xFF, marker))
            continue
        if pos + 2 > size:
            return jpeg
        seg_len = int.from_bytes(jpeg[pos : pos + 2], "big")
        if seg_len < 2 or pos + seg_len > size:
            return jpeg
        # Preserva APP0 (JFIF) e APP14 (Adobe CMYK/RGB); descarta APP1..APP13, APP15 e COM (0xFE).
        if marker != 0xFE and not (0xE1 <= marker <= 0xEF and marker != 0xEE):
            out.extend((0xFF, marker))
            out.extend(jpeg[pos : pos + seg_len])
        pos += seg_len
    return bytes(out)


def _clean_page_xobjects(page) -> None:
    resources = page.get("/Resources")
    res_obj = resources.get_object() if hasattr(resources, "get_object") else resources
    if not isinstance(res_obj, dict):
        return
    xobjects = res_obj.get("/XObject")
    xobj_dict = xobjects.get_object() if hasattr(xobjects, "get_object") else xobjects
    if not isinstance(xobj_dict, dict):
        return
    for ref in list(xobj_dict.values()):
        obj = ref.get_object() if hasattr(ref, "get_object") else ref
        if not isinstance(obj, dict):
            continue
        obj.pop("/Metadata", None)
        flt = obj.get("/Filter")
        is_dct = flt == "/DCTDecode" or (
            isinstance(flt, list) and len(flt) == 1 and flt[0] == "/DCTDecode"
        )
        if is_dct and hasattr(obj, "_data") and isinstance(obj._data, bytes):
            obj._data = _strip_jpeg_segments(obj._data)


def _pdf(data: bytes) -> bytes:
    try:
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted:
            raise InvalidFile("PDF protegido por senha não é aceito.")
        if len(reader.pages) > _MAX_PAGES:
            raise InvalidFile(f"PDF com mais de {_MAX_PAGES} páginas.")
        if _pdf_has_forbidden_content(reader):
            raise InvalidFile(
                "PDF com ações externas (Launch/RichMedia) ou arquivos embutidos não é aceito."
            )
        writer = PdfWriter()
        for page in reader.pages:
            # Ações ao abrir a página, metadados XMP por página e EXIF de JPEGs não vão junto.
            page.pop("/AA", None)
            page.pop("/Metadata", None)
            page.pop("/PieceInfo", None)
            _clean_page_xobjects(page)
            writer.add_page(page)
        # Links, comentários e campos de formulário podem carregar ações e dados.
        writer.remove_annotations(subtypes=None)
        output = BytesIO()
        writer.write(output)
        return output.getvalue()
    except InvalidFile:
        raise
    except (PdfReadError, OSError, ValueError, KeyError, TypeError) as error:
        raise InvalidFile("PDF corrompido ou inválido.") from error
