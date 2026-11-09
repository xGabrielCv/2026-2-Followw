"""Validação estrita de DOCX, PPTX, XLSX e texto puro, com pacotes sintéticos montados em memória."""

import warnings
import zipfile
from io import BytesIO

import pytest

from api.modules.materials import office
from api.modules.materials.sanitize import InvalidFile, sanitize, sniff

CONTENT_TYPES = (
    b'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    b'<Default Extension="xml" ContentType="application/xml"/></Types>'
)
RELS = (
    b'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    b'<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    b"</Relationships>"
)
CORE = (
    b'<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y">'
    b"<dc:creator>Fulana de Tal</dc:creator><cp:lastModifiedBy>Outra Pessoa</cp:lastModifiedBy></cp:coreProperties>"
)
MAIN = {
    office.DOCX: "word/document.xml",
    office.XLSX: "xl/workbook.xml",
    office.PPTX: "ppt/presentation.xml",
}


def pacote(
    mime=office.DOCX, extra=None, conteudo=b"<root>texto</root>", types=CONTENT_TYPES
):
    saida = BytesIO()
    with zipfile.ZipFile(saida, "w", zipfile.ZIP_DEFLATED) as arquivo:
        arquivo.writestr("[Content_Types].xml", types)
        arquivo.writestr("_rels/.rels", RELS)
        arquivo.writestr("docProps/core.xml", CORE)
        arquivo.writestr(MAIN[mime], conteudo)
        for nome, dados in (extra or {}).items():
            arquivo.writestr(nome, dados)
    return saida.getvalue()


def nomes(dados):
    with zipfile.ZipFile(BytesIO(dados)) as arquivo:
        return arquivo.namelist()


@pytest.mark.parametrize("mime", [office.DOCX, office.XLSX, office.PPTX])
def test_detecta_o_formato_pelo_pacote_e_aceita(mime):
    dados = pacote(mime)
    assert sniff(dados, "qualquer.bin") == mime
    limpo = sanitize(dados, mime)
    assert MAIN[mime] in nomes(limpo)
    assert nomes(limpo)[0] == "[Content_Types].xml"


def test_metadados_de_autoria_sao_esvaziados_e_o_pacote_e_deterministico():
    dados = pacote()
    limpo = sanitize(dados, office.DOCX)
    with zipfile.ZipFile(BytesIO(limpo)) as arquivo:
        core = arquivo.read("docProps/core.xml")
        assert b"Fulana" not in core and b"Outra Pessoa" not in core
        assert {i.date_time for i in arquivo.infolist()} == {(1980, 1, 1, 0, 0, 0)}
    assert sanitize(dados, office.DOCX) == limpo


def test_zip_comum_ou_ambiguo_ou_corrompido_nao_e_office():
    saida = BytesIO()
    with zipfile.ZipFile(saida, "w") as arquivo:
        arquivo.writestr("a.txt", "x")
    assert sniff(saida.getvalue(), "x.docx") is None
    duplo = BytesIO()
    with zipfile.ZipFile(duplo, "w") as arquivo:
        arquivo.writestr("[Content_Types].xml", CONTENT_TYPES)
        arquivo.writestr("word/document.xml", "<a/>")
        arquivo.writestr("xl/workbook.xml", "<a/>")
    assert sniff(duplo.getvalue(), "x.docx") is None
    assert sniff(b"PK\x03\x04quebrado", "x.docx") is None


def test_extensao_nao_decide_o_tipo():
    assert sniff(pacote(office.XLSX), "planilha.docx") == office.XLSX
    with pytest.raises(InvalidFile):
        sanitize(pacote(office.XLSX), office.DOCX)


@pytest.mark.parametrize(
    "parte",
    [
        "word/vbaProject.bin",
        "xl/vbaProject.bin",
        "word/embeddings/oleObject1.bin",
        "ppt/embeddings/pacote.xlsx",
        "word/activeX/activeX1.xml",
        "xl/externalLinks/externalLink1.xml",
        "xl/connections.xml",
        "xl/queryTables/queryTable1.xml",
        "customUI/customUI.xml",
        "word/media/arquivo.exe",
        "word/media/script.js",
    ],
)
def test_macros_objetos_embutidos_e_executaveis_sao_recusados(parte):
    with pytest.raises(InvalidFile):
        sanitize(pacote(extra={parte: b"x"}), office.DOCX)


def test_tipo_de_conteudo_com_macro_e_recusado():
    tipos = CONTENT_TYPES.replace(
        b"</Types>",
        b'<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
    )
    with pytest.raises(InvalidFile):
        sanitize(pacote(types=tipos), office.DOCX)


def relacao(tipo, destino, externo=True):
    modo = ' TargetMode="External"' if externo else ""
    return (
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="r9" Type="{tipo}" Target="{destino}"{modo}/></Relationships>'
    ).encode()


BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"


@pytest.mark.parametrize(
    "tipo",
    ["oleObject", "attachedTemplate", "frame", "externalLink", "image", "subDocument"],
)
def test_vinculo_externo_que_busca_conteudo_e_recusado(tipo):
    extra = {
        "word/_rels/document.xml.rels": relacao(BASE + tipo, "http://exemplo.test/x")
    }
    with pytest.raises(InvalidFile):
        sanitize(pacote(extra=extra), office.DOCX)


def test_link_de_hipertexto_comum_e_aceito_e_interno_tambem():
    extra = {
        "word/_rels/document.xml.rels": relacao(BASE + "hyperlink", "https://unb.br/"),
        "word/_rels/header1.xml.rels": relacao(
            BASE + "image", "media/a.png", externo=False
        ),
    }
    assert sanitize(pacote(extra=extra), office.DOCX)


@pytest.mark.parametrize(
    "xml",
    [
        b'<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>',
        b'<!ENTITY lol "lol"><a/>',
    ],
)
def test_doctype_e_entidades_xml_sao_recusados(xml):
    with pytest.raises(InvalidFile):
        sanitize(pacote(conteudo=xml), office.DOCX)


@pytest.mark.parametrize(
    "xml",
    [
        b"<w:p><w:instrText> DDEAUTO c:\\\\windows\\\\system32\\\\cmd.exe </w:instrText></w:p>",
        b'<w:fldSimple w:instr=" INCLUDETEXT &quot;http://x/y&quot; "/>',
        b'<w:fldSimple w:instr="LINK Excel.Sheet.8 c:\\\\a.xls"/>',
    ],
)
def test_campos_do_word_que_executam_ou_buscam_sao_recusados(xml):
    with pytest.raises(InvalidFile):
        sanitize(pacote(conteudo=xml), office.DOCX)


def test_campo_comum_do_word_continua_aceito():
    xml = b'<w:p><w:instrText> PAGE </w:instrText><w:fldSimple w:instr="DATE"/></w:p>'
    assert sanitize(pacote(conteudo=xml), office.DOCX)


def test_formula_dde_do_excel_e_recusada_e_formula_comum_nao():
    with pytest.raises(InvalidFile):
        sanitize(
            pacote(office.XLSX, conteudo=b"<c><f>cmd|'/c calc'!A1</f></c>"), office.XLSX
        )
    assert sanitize(
        pacote(office.XLSX, conteudo=b"<c><f>SUM(A1:A9)</f></c>"), office.XLSX
    )


@pytest.mark.parametrize("nome", ["../fora.xml", "/abs.xml", "c:/x.xml"])
def test_caminhos_perigosos_dentro_do_zip_sao_recusados(nome):
    with pytest.raises(InvalidFile):
        sanitize(pacote(extra={nome: b"<a/>"}), office.DOCX)


def test_nomes_repetidos_sao_recusados():
    saida = BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with zipfile.ZipFile(saida, "w") as arquivo:
            arquivo.writestr("[Content_Types].xml", CONTENT_TYPES)
            arquivo.writestr("word/document.xml", "<a/>")
            arquivo.writestr("word/document.xml", "<b/>")
    with pytest.raises(InvalidFile):
        sanitize(saida.getvalue(), office.DOCX)


def test_arquivo_bomba_por_taxa_de_compressao_e_recusado():
    zeros = b"0" * (3 * 1024 * 1024)
    with pytest.raises(InvalidFile, match="bomba"):
        sanitize(pacote(extra={"word/media/grande.xml": zeros}), office.DOCX)


def test_partes_demais_e_senha_sao_recusadas():
    muitos = {f"word/p{i}.xml": b"<a/>" for i in range(office._MAX_ENTRIES + 1)}
    with pytest.raises(InvalidFile, match="partes demais"):
        sanitize(pacote(extra=muitos), office.DOCX)
    dados = bytearray(pacote())
    # liga o bit "criptografado" na primeira entrada (cabeçalho local e diretório central)
    for assinatura, deslocamento in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
        posicao = dados.find(assinatura)
        dados[posicao + deslocamento] |= 0x1
    with pytest.raises(InvalidFile):
        sanitize(bytes(dados), office.DOCX)


def test_texto_puro_so_com_extensao_txt_utf8_e_sem_controle():
    assert sniff("olá, mundo\n".encode(), "notas.txt") == office.TEXT
    assert sniff(b"texto", "notas.md") is None
    assert sniff(b"texto", "notas") is None
    assert sniff(b"", "vazio.txt") is None
    assert sniff(b"\xff\xfe\x00", "bin.txt") is None
    assert sniff(b"a\x00b", "nulo.txt") is None
    assert sniff(b"a\x1b[31mb", "ansi.txt") is None
    assert sniff(b"x" * (office.MAX_TEXT_BYTES + 1), "grande.txt") is None


def test_texto_e_normalizado_para_utf8_com_quebra_de_linha_unica():
    bruto = b"\xef\xbb\xbflinha 1\r\nlinha 2\rlinha 3\n"
    assert sanitize(bruto, office.TEXT) == b"linha 1\nlinha 2\nlinha 3\n"


def test_nao_altera_pdf_e_imagem_existentes():
    assert sniff(b"%PDF-1.7\n", "a.txt") == "application/pdf"
    assert sniff(b"\x89PNG\r\n\x1a\n" + b"0" * 20, "a.txt") == "image/png"


def test_nome_com_barra_invertida_nao_e_aceito():
    # o zipfile do Windows converte "\\" ao ler; em outros sistemas o nome chegaria assim
    assert office._name_ok("a\\b.xml") is False
    assert office._name_ok("word/document.xml") is True
