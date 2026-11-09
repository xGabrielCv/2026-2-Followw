from io import BytesIO

import pytest
from PIL import Image
from pydantic import SecretStr
from pypdf import PdfReader, PdfWriter
from pypdf.actions import JavaScript
from sigaa_client import Credentials
from sqlalchemy import inspect, select

from api.core.config import settings
from api.db.models import Classroom, ClassroomProfessor, Material, Professor, Subject
from api.modules.materials import service as materials

ANA = Credentials(registration="251000000", password=SecretStr("senha123"))
BIA = Credentials(registration="252000000", password=SecretStr("senha456"))
URL = "/materials/FGA0030"


def _png(color=(200, 10, 10), size=(40, 30), exif=False) -> bytes:
    image = Image.new("RGB", size, color)
    output = BytesIO()
    if exif:
        data = Image.Exif()
        data[0x010F] = "Celular da Ana"  # fabricante
        image.save(output, format="JPEG", exif=data)
    else:
        image.save(output, format="PNG")
    return output.getvalue()


def _pdf(author="Ana Souza") -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.add_metadata({"/Author": author, "/Title": "Prova"})
    writer.add_open_action(JavaScript("app.alert('oi');"))
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.fixture
def materia(database, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "materials_dir", str(tmp_path))
    with database.begin() as session:
        session.add(Subject(code="FGA0030", name="ESTRUTURAS DE DADOS 2"))
        professor = Professor(name="MAURICIO SERRANO")
        turma = Classroom(subject_code="FGA0030", number="02", semester="2026.2")
        session.add_all([professor, turma])
        session.flush()
        session.add(
            ClassroomProfessor(classroom_id=turma.id, professor_id=professor.id)
        )
    return tmp_path


@pytest.fixture
def logado(client, cookies):
    client.cookies.update(cookies(refresh=ANA))
    return client


def _enviar(client, data, name="prova.png", **form):
    fields = {"title": "Prova 1", "kind": "prova", "semester": "2026.2", **form}
    return client.post(URL, files={"file": (name, data)}, data=fields)


def test_materiais_permite_leitura_e_exige_login_no_envio(client, materia):
    assert client.get(URL).status_code == 200
    assert _enviar(client, _png()).status_code == 401


def test_envia_imagem_sem_metadados_com_turma_e_docentes(logado, materia, database):
    response = _enviar(
        logado, _png(exif=True), name="../../foto da prova.jpg", classroom_number="02"
    )
    assert response.status_code == 201, response.text
    item = response.json()
    assert item["mime"] == "image/jpeg"
    # nome sem pasta nem caracteres estranhos, com a extensão do tipo real
    assert item["filename"] == "foto da prova.jpg"
    assert item["professors"] == ["MAURICIO SERRANO"]
    assert item["mine"] is True

    download = logado.get(f"{URL}/{item['id']}")
    assert download.status_code == 200
    assert download.headers["x-content-type-options"] == "nosniff"
    assert "attachment" in download.headers["content-disposition"]
    assert "sandbox" in download.headers["content-security-policy"]
    # o EXIF (aparelho, GPS) não sobrevive
    assert not Image.open(BytesIO(download.content)).getexif()

    listing = logado.get(URL).json()
    assert listing["usage"] == {"files": 1, "bytes": item["size"], "mine": 1}
    assert listing["oldest_semester"] == "2024.1"
    assert listing["limits"]["max_daily_upload_attempts"] == 10

    # nenhuma coluna guarda a matrícula ou o nome de quem enviou
    with database() as session:
        material = session.scalar(select(Material))
    assert "251000000" not in material.uploader_key
    assert {c.key for c in inspect(Material).columns} >= {"uploader_key"}
    assert not {"user_id", "registration", "author"} & {
        c.key for c in inspect(Material).columns
    }


def test_pdf_perde_autor_e_javascript(logado, materia):
    item = _enviar(logado, _pdf(), name="lista.pdf", kind="lista").json()
    content = logado.get(f"{URL}/{item['id']}").content
    reader = PdfReader(BytesIO(content))
    assert not (reader.metadata or {}).get("/Author")
    assert "/JavaScript" not in str(reader.trailer["/Root"])
    assert "/OpenAction" not in reader.trailer["/Root"]


@pytest.mark.parametrize(
    ("data", "status"),
    [
        (b"MZ\x90\x00 executavel", 415),
        (b"<html><script>alert(1)</script></html>", 415),
        (b"%PDF-1.7 quebrado", 422),
        (b"\x89PNG\r\n\x1a\n quebrado", 422),
    ],
)
def test_tipo_e_conteudo_invalidos(logado, materia, data, status):
    assert _enviar(logado, data, name="prova.png").status_code == status


def test_arquivo_grande_demais(logado, materia, monkeypatch):
    monkeypatch.setattr(materials, "MAX_FILE_BYTES", 100)
    monkeypatch.setattr("api.modules.materials.router.MAX_FILE_BYTES", 100)
    assert _enviar(logado, _png(size=(400, 400))).status_code == 413


def test_semestre_fora_da_janela_e_campos_invalidos(logado, materia):
    assert _enviar(logado, _png(), semester="2023.2").status_code == 422
    assert _enviar(logado, _png(), semester="2027.2").status_code == 422
    assert _enviar(logado, _png(), kind="meme").status_code == 422
    assert _enviar(logado, _png(), title="a").status_code == 422
    assert logado.get("/materials/XYZ0001").status_code == 404


def test_limites_por_materia_e_espaco(logado, materia, monkeypatch, cookies):
    monkeypatch.setattr(materials, "MAX_PER_SUBJECT", 3)
    assert _enviar(logado, _png((1, 1, 1))).status_code == 201
    # o mesmo arquivo de novo não entra
    assert _enviar(logado, _png((1, 1, 1))).status_code == 409
    assert _enviar(logado, _png((2, 2, 2))).status_code == 201

    logado.cookies.clear()
    logado.cookies.update(cookies(refresh=BIA))
    # outro aluno, noutro aparelho: a autoria vem do segredo do aparelho
    logado.headers["X-Followw-Author"] = "b" * 64
    assert _enviar(logado, _png((4, 4, 4))).status_code == 201
    cheia = _enviar(logado, _png((5, 5, 5)))
    assert cheia.status_code == 409
    assert "3 arquivos" in cheia.json()["detail"]

    monkeypatch.setattr(materials, "MAX_PER_SUBJECT", 50)
    monkeypatch.setattr(materials, "MAX_SUBJECT_BYTES", 10)
    assert "espaço" in _enviar(logado, _png((6, 6, 6))).json()["detail"]


def test_so_quem_enviou_apaga_e_o_arquivo_some(logado, materia, cookies):
    item = _enviar(logado, _png()).json()
    assert (
        len(list(materia.rglob("*.*")) + [f for f in materia.rglob("*") if f.is_file()])
        >= 1
    )

    logado.cookies.clear()
    logado.cookies.update(cookies(refresh=BIA))
    # outro aluno, noutro aparelho: a autoria vem do segredo do aparelho
    logado.headers["X-Followw-Author"] = "b" * 64
    assert logado.get(URL).json()["items"][0]["mine"] is False
    assert logado.delete(f"{URL}/{item['id']}").status_code == 404

    logado.cookies.clear()
    logado.cookies.update(cookies(refresh=ANA))
    logado.headers["X-Followw-Author"] = "a" * 64
    assert logado.delete(f"{URL}/{item['id']}").status_code == 204
    assert logado.get(f"{URL}/{item['id']}").status_code == 404
    assert not [f for f in materia.rglob("*") if f.is_file()]


def test_semestres_antigos_saem_sozinhos(logado, materia, database, hoje):
    from datetime import date

    antigo = _enviar(logado, _png((7, 7, 7)), semester="2024.1").json()
    _enviar(logado, _png((8, 8, 8)), semester="2026.2")
    # três anos depois, 2024.1 sai da janela dos 6 semestres
    hoje(date(2027, 3, 20))
    listing = logado.get(URL).json()
    assert [item["semester"] for item in listing["items"]] == ["2026.2"]
    assert logado.get(f"{URL}/{antigo['id']}").status_code == 404
    # o próximo envio apaga de vez, com o arquivo
    _enviar(logado, _png((9, 9, 9)), semester="2027.1")
    with database() as session:
        semesters = session.scalars(select(Material.semester)).all()
    assert "2024.1" not in semesters


def test_lista_materias_com_material(logado, materia):
    _enviar(logado, _png())
    assert logado.get("/materials", params={"q": "estruturas"}).json() == [
        {"code": "FGA0030", "name": "ESTRUTURAS DE DADOS 2", "files": 1}
    ]
    assert logado.get("/materials", params={"q": "calculo"}).json() == []


def test_visitante_baixa_material_mas_nao_pode_apagar(logado, materia):
    uploaded = _enviar(logado, _png()).json()
    logado.cookies.clear()
    assert logado.get("/materials").status_code == 200
    assert logado.get(URL).json()["items"][0]["id"] == uploaded["id"]
    assert logado.get(f"{URL}/{uploaded['id']}").content.startswith(b"\x89PNG")
    assert logado.delete(f"{URL}/{uploaded['id']}").status_code == 401


def test_rollback_de_envio_nao_apaga_arquivo_antigo(logado, materia, database, hoje):
    from datetime import date

    old = _enviar(logado, _png((7, 7, 7)), semester="2024.1").json()
    assert _enviar(logado, _png((8, 8, 8)), semester="2026.2").status_code == 201
    with database() as session:
        row = session.get(Material, old["id"])
        key = row.storage_key
    path = materia / key[:2] / key
    encrypted = path.read_bytes()
    hoje(date(2027, 3, 20))
    # A limpeza executa antes de detectar a duplicata; o rollback precisa manter o arquivo.
    assert _enviar(logado, _png((8, 8, 8)), semester="2027.1").status_code == 409
    assert path.read_bytes() == encrypted
    with database() as session:
        assert session.get(Material, old["id"]) is not None


async def test_rollback_de_moderacao_preserva_arquivo(logado, materia, database):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from api.db.context import set_context
    from api.db.main import Database
    from api.modules.materials.service import delete_material

    uploaded = _enviar(logado, _png()).json()
    with database() as session:
        material = session.get(Material, uploaded["id"])
        key, material_id = material.storage_key, material.id
    path = materia / key[:2] / key
    encrypted = path.read_bytes()
    set_context(scope="admin")

    async def reject(session):
        assert await delete_material(session, material_id)
        raise ValueError("Rejeição sintética depois da exclusão")

    engine = create_async_engine(
        database.kw["bind"].url.set(drivername="postgresql+asyncpg"), poolclass=NullPool
    )
    try:
        with pytest.raises(ValueError):
            await Database(async_sessionmaker(engine)).write(reject)
    finally:
        await engine.dispose()
    assert path.read_bytes() == encrypted
    with database() as session:
        assert session.get(Material, material_id) is not None
