from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    environment: str = "development"
    # Libera /demo, que carrega dados fictícios de grupos, avaliações e índices para testes.
    demo_data: bool = False
    # Painel do administrador em /admin; sem usuário e hash da senha, desligado.
    # O hash (scrypt) vem de `uv run admin-password`; a senha nunca fica em texto.
    admin_username: str | None = Field(default=None, min_length=3, max_length=64)
    admin_password_hash: str | None = Field(default=None, pattern=r"^scrypt\$")
    # Onde ficam os arquivos dos materiais; na nuvem, trocar por um storage de objetos.
    materials_dir: str = str(
        Path(__file__).resolve().parents[4] / ".local" / "materials"
    )
    docs_url: str = "https://docs.followw.app"

    cors_origins: list[str] = ["https://followw.app"]

    database_url: str

    # Deriva as chaves que cifram os cookies (JWE) e os jobs.
    jwt_secret_key: str = Field(min_length=32)
    # Cifra em repouso do conteúdo da comunidade e dos arquivos; sem ela, deriva do jwt_secret_key.
    data_encryption_key: str | None = Field(default=None, min_length=32)
    access_token_expire_minutes: int = 40
    # O navegador limita cookies a 400 dias: o aluno fica logado até lá sem digitar a senha.
    refresh_token_expire_minutes: int = 60 * 24 * 400

    # "local" roda os jobs no próprio processo da API, sem QStash (dev offline).
    job_queue: Literal["qstash", "local"] = "qstash"
    # URL pública da API: o QStash entrega os jobs em `{public_url}/jobs`.
    public_url: str = "http://localhost:8000"
    qstash_url: str | None = None
    qstash_token: str | None = None
    qstash_current_signing_key: str | None = None
    qstash_next_signing_key: str | None = None

    # REST do Upstash; sem URL ou token, Redis e rate limit ficam desativados.
    upstash_redis_rest_url: str | None = None
    upstash_redis_rest_token: str | None = None
    redis_timeout_seconds: float = Field(default=1, gt=0, allow_inf_nan=False)

    # Cotas por IP em janela fixa; login tem uma cota própria, mais restrita.
    rate_limit_requests: int = Field(default=600, gt=0)
    rate_limit_login_requests: int = Field(default=30, gt=0)
    rate_limit_window_seconds: int = Field(default=60, gt=0)
    # Refresh abre o app e pode vir de muitos alunos atrás do mesmo NAT.
    rate_limit_refresh_requests: int = Field(default=120, gt=0)
    # Tentativas de login por matrícula, de qualquer IP.
    rate_limit_registration_requests: int = Field(default=10, gt=0)
    rate_limit_registration_window_seconds: int = Field(default=600, gt=0)
    # Assina o IP original que o SSR encaminha; sem ele, o encaminhamento é ignorado.
    rate_limit_secret_key: str | None = Field(default=None, min_length=32)

    @model_validator(mode="after")
    def _qstash_configured(self) -> Settings:
        keys = (
            self.qstash_token,
            self.qstash_current_signing_key,
            self.qstash_next_signing_key,
        )
        if self.job_queue == "qstash" and not all(keys):
            raise ValueError("QSTASH_TOKEN e as signing keys são obrigatórios")
        return self

    @field_validator("rate_limit_secret_key", mode="before")
    @classmethod
    def _empty_as_none(cls, value: str | None) -> str | None:
        return value or None


settings = Settings()
