from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"), extra="ignore", hide_input_in_errors=True
    )

    environment: str = "development"
    # Libera /demo, que carrega dados fictícios de grupos, avaliações e índices para testes.
    demo_data: bool = False
    # Painel do administrador em /admin; sem usuário e hash da senha, desligado.
    # O hash (scrypt) vem de `uv run admin-password`; a senha nunca fica em texto.
    admin_username: str | None = Field(default=None, min_length=3, max_length=64)
    admin_password_hash: str | None = Field(
        default=None, pattern=r"^(scrypt\$|\$argon2id\$)"
    )
    # Onde ficam os arquivos dos materiais; na nuvem, trocar por um storage de objetos.
    materials_dir: str = str(
        Path(__file__).resolve().parents[4] / ".local" / "materials"
    )
    docs_url: str = "https://docs.followw.app"

    cors_origins: list[str] = ["https://followw.app"]

    database_url: str = Field(
        default="postgresql+asyncpg://postgres@127.0.0.1:5432/followw", repr=False
    )

    # Conta que cria o esquema e as políticas (db-init, CLI do administrador, carga do catálogo).
    # Em produção a API usa `database_url` com o papel restrito `followw_app` (sem bypass de RLS);
    # sem esta variável, a manutenção usa a mesma conexão (desenvolvimento simples).
    database_maintenance_url: str | None = Field(default=None, repr=False)
    # Senha do papel `followw_app` (cria o login ao rodar db-init); sem ela o papel não faz login.
    app_db_password: str | None = Field(default=None, min_length=16, repr=False)

    # Pool do PostgreSQL: por processo. Total máximo = (db_pool_size + db_max_overflow) x workers;
    # deixe a soma abaixo de max_connections do banco.
    db_pool_size: int = Field(default=10, ge=1, le=100)
    db_max_overflow: int = Field(default=10, ge=0, le=100)
    # Espera máxima por uma conexão livre antes de falhar (em vez de enfileirar para sempre).
    db_pool_timeout_seconds: float = Field(default=10, gt=0, le=60)
    # Troca conexões antigas, que firewalls e proxies costumam derrubar.
    db_pool_recycle_seconds: int = Field(default=1800, ge=60)
    # Corta consulta travada; 0 desliga.
    db_statement_timeout_ms: int = Field(default=60_000, ge=0)

    # Deriva as chaves que cifram os cookies (JWE) e os jobs.
    jwt_secret_key: str = Field(min_length=32, repr=False)
    # Cifra em repouso do conteúdo da comunidade e dos arquivos; sem ela, deriva do jwt_secret_key.
    data_encryption_key: str | None = Field(default=None, min_length=32, repr=False)
    data_encryption_key_id: str = Field(
        default="initial", pattern=r"^[a-zA-Z0-9_-]{1,32}$"
    )
    data_encryption_previous_keys: dict[str, str] = Field(
        default_factory=dict, repr=False
    )
    access_token_expire_minutes: int = Field(default=40, gt=0, le=60)
    # Limite absoluto independente da retenção offline; exige novo login ao vencer.
    refresh_token_expire_minutes: int = Field(default=8 * 60, gt=0, le=24 * 60)

    # Origem pública para links operacionais; não há fila de credenciais acadêmicas.
    public_url: str = "http://localhost:8000"

    # Sem Redis, limites em memória: implantação deve usar um único worker.
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

    @field_validator(
        "rate_limit_secret_key", "admin_username", "admin_password_hash", mode="before"
    )
    @classmethod
    def _empty_as_none(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("data_encryption_previous_keys")
    @classmethod
    def _previous_keys(cls, value: dict[str, str]) -> dict[str, str]:
        import re

        if len(value) > 10 or any(
            not re.fullmatch(r"[a-zA-Z0-9_-]{1,32}", key) or len(secret) < 32
            for key, secret in value.items()
        ):
            raise ValueError("Chaveiro anterior inválido")
        return value

    @model_validator(mode="after")
    def _production_boundaries(self):
        if self.data_encryption_key_id in self.data_encryption_previous_keys:
            raise ValueError(
                "A versão atual não pode repetir um identificador do chaveiro anterior"
            )
        if self.environment == "production":
            if "database_url" not in self.model_fields_set:
                raise ValueError("DATABASE_URL explícita é obrigatória em produção")
            if (
                not self.data_encryption_key
                or self.data_encryption_key == self.jwt_secret_key
            ):
                raise ValueError(
                    "Produção exige chave de dados própria, diferente da chave dos cookies"
                )
        return self


settings = Settings()
