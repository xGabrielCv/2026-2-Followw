"""Confere o tipo real do arquivo e regrava sem metadados.

Só PDF e imagens (PNG, JPEG, WebP): o tipo vem dos primeiros bytes, nunca da extensão. Imagens
são decodificadas e salvas de novo, sem EXIF (onde fica o GPS e o aparelho). PDFs são refeitos
só com as páginas: saem autor, programa, XMP, JavaScript, anexos, formulários e anotações.
"""

from io import BytesIO

from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError

EXTENSIONS = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
_IMAGE_FORMATS = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}
# Uma foto de prova cabe com folga; acima disso é imagem-bomba.
_MAX_PIXELS = 40_000_000
_MAX_PAGES = 300


class InvalidFile(ValueError):
    pass


def sniff(data: bytes) -> str | None:
    """O tipo pelos primeiros bytes; `None` fora dos aceitos."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def sanitize(data: bytes, mime: str) -> bytes:
    if mime == "application/pdf":
        return _pdf(data)
    return _image(data, mime)


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


def _pdf(data: bytes) -> bytes:
    try:
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted:
            raise InvalidFile("PDF protegido por senha não é aceito.")
        if len(reader.pages) > _MAX_PAGES:
            raise InvalidFile(f"PDF com mais de {_MAX_PAGES} páginas.")
        writer = PdfWriter()
        for page in reader.pages:
            # Ações ao abrir a página (JavaScript) não vão junto.
            page.pop("/AA", None)
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
