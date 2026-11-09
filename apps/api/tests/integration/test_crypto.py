import base64
import os

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from api.cookies import _hkdf
from api.core.config import settings
from api.crypto import decrypt, decrypt_bytes, encrypt, encrypt_bytes


async def test_recifragem_do_banco_preserva_conteudo_e_salva_ciphertext_anterior(
    maintenance_database, database, tmp_path, monkeypatch
):
    from sqlalchemy import select, text

    from api.db.models import ForumPost
    from api.rotate_data import rotate_database

    old = settings.data_encryption_key or settings.jwt_secret_key
    with database.begin() as session:
        post = ForumPost(
            kind="duvida",
            title="Título sintético",
            body="Conteúdo sintético",
            author_key="aleatorio",
        )
        session.add(post)
    with database() as session:
        before = session.execute(text("SELECT title FROM forum_posts")).scalar_one()
    monkeypatch.setattr(
        settings, "data_encryption_key", "nova-chave-de-teste-" + "a" * 32
    )
    monkeypatch.setattr(settings, "data_encryption_key_id", "rotated")
    monkeypatch.setattr(settings, "data_encryption_previous_keys", {"initial": old})
    engine = maintenance_database.kw["bind"]
    assert await rotate_database(engine) == 2
    with database() as session:
        assert (
            session.execute(text("SELECT title FROM forum_posts")).scalar_one()
            == before
        )
    journal = tmp_path / "ciphertexts.jsonl"
    assert await rotate_database(engine, journal) == 2
    assert before in journal.read_text(encoding="utf-8")
    monkeypatch.setattr(settings, "data_encryption_previous_keys", {})
    with database() as session:
        assert session.scalar(select(ForumPost.title)) == "Título sintético"
        assert session.scalar(select(ForumPost.body)) == "Conteúdo sintético"


def test_recifragem_de_arquivos_preserva_original_e_conteudo(tmp_path):
    from api.rotate_data import rotate_files

    base = tmp_path / "materials"
    shard = base / "ab"
    shard.mkdir(parents=True)
    path = shard / ("ab" + "1" * 30)
    context = f"materials:{path.name}"
    original = encrypt_bytes(b"arquivo original sintetico", context)
    path.write_bytes(original)
    backup = tmp_path / "backup"
    backup.mkdir()
    assert rotate_files(base) == 1
    assert path.read_bytes() == original
    assert rotate_files(base, backup) == 1
    assert (backup / path.name).read_bytes() == original
    assert decrypt_bytes(path.read_bytes(), context) == b"arquivo original sintetico"


def test_nonces_contextos_integridade_e_formatos_versionados():
    value = encrypt("texto sensível sintético", "test.one")
    assert value.startswith("v2:initial:")
    assert encrypt("texto sensível sintético", "test.one") != value
    assert decrypt(value, "test.one") == "texto sensível sintético"
    with pytest.raises(ValueError):
        decrypt(value, "test.two")
    with pytest.raises(ValueError):
        decrypt("v2:initial:!!", "test.one")
    sealed = encrypt_bytes(b"arquivo sintetico", "test.file")
    assert decrypt_bytes(sealed, "test.file") == b"arquivo sintetico"
    with pytest.raises(ValueError):
        decrypt_bytes(sealed[:-1] + bytes([sealed[-1] ^ 1]), "test.file")


def test_rotacao_le_versoes_antigas_sem_reescrever_ou_perder_dados(monkeypatch):
    old = "chave-antiga-sintetica-" + "a" * 32
    monkeypatch.setattr(settings, "data_encryption_key", old)
    before = encrypt("antigo", "test")
    file_before = encrypt_bytes(b"antigo", "test")
    nonce = os.urandom(12)
    raw = nonce + AESGCM(_hkdf(old, "followw:data-at-rest")).encrypt(
        nonce, b"legado", b"test"
    )
    legacy = "v1:" + base64.urlsafe_b64encode(raw).decode()
    monkeypatch.setattr(
        settings, "data_encryption_key", "chave-nova-sintetica-" + "b" * 32
    )
    monkeypatch.setattr(settings, "data_encryption_key_id", "next")
    monkeypatch.setattr(
        settings, "data_encryption_previous_keys", {"initial": old, "legacy": old}
    )
    assert decrypt(before, "test") == "antigo"
    assert decrypt(legacy, "test") == "legado"
    assert decrypt_bytes(file_before, "test") == b"antigo"
    assert decrypt_bytes(raw, "test") == b"legado"
    after = encrypt(decrypt(before, "test"), "test")
    assert after.startswith("v2:next:")
    monkeypatch.setattr(settings, "data_encryption_previous_keys", {})
    with pytest.raises(ValueError):
        decrypt(before, "test")
    assert decrypt(after, "test") == "antigo"
