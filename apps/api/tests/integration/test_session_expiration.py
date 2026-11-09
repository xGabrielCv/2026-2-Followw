from datetime import UTC, datetime, timedelta

import pytest

from api.cookies import REFRESH_COOKIE_NAME, encrypt_cookie


@pytest.mark.parametrize("kind", ["invalid", "expired", "legacy_long", "legacy_short"])
def test_sessao_invalida_vencida_ou_legada_apaga_cookies_sem_consultar_sigaa(
    client, stub_sigaa, kind
):
    now = datetime.now(UTC)
    payload = {
        "registration": "251000001",
        "password": "sintetica123",
        "session_version": 2,
        "exp": int((now + timedelta(hours=1)).timestamp()),
    }
    if kind == "expired":
        payload["exp"] = int((now - timedelta(seconds=1)).timestamp())
    if kind.startswith("legacy"):
        payload.pop("session_version")
    if kind == "legacy_long":
        payload["exp"] = int((now + timedelta(days=400)).timestamp())
    token = (
        "invalido"
        if kind == "invalid"
        else encrypt_cookie(REFRESH_COOKIE_NAME, payload)
    )
    response = client.get(
        "/me",
        headers={
            "cookie": f"refresh_token={token}; profile=sintetico; access_token=sintetico"
        },
    )
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"
    deleted = response.headers.get_list("set-cookie")
    assert all(
        any(
            header.startswith(name + "=") and "Max-Age=0" in header
            for header in deleted
        )
        for name in ("refresh_token", "access_token", "profile")
    )
    stub_sigaa.authenticate.assert_not_awaited()
