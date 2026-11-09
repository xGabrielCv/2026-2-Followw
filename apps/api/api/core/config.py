from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"), extra="ignore", hide_input_in_errors=True
    )

    environment: str = "development"
    # Estado inicial opcional da demonstração; o Owner controla a flag pelo painel local.
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
    # Sincronização agendada do catálogo público e do cardápio; `None` liga fora dos testes.
    sync_scheduler_enabled: bool | None = None
    sync_tick_seconds: float = Field(default=30, ge=1, le=300)
    # Eventos técnicos (avisos, erros, sincronização) guardados para o painel; `None` liga fora dos testes.
    log_events_enabled: bool | None = None
    log_retention_days: int = Field(default=14, ge=1, le=90)

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
    app_db_role: str = Field(
        default="followw_app",
        pattern=r"^followw_(?:app|test_app|(?:e2e|load)_[a-f0-9]{12})$",
    )

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
    # Onde as cotas SENSÍVEIS (login, publicação, recuperação) são contadas quando não há Redis:
    # `memory` = por processo (desenvolvimento, um worker); `postgres` = compartilhado entre workers e
    # réplicas, sem o atacante ganhar cota nova só por cair em outro worker. A cota global de leitura
    # continua por processo (contá-la no banco custaria uma escrita por pedido).
    rate_limit_backend: Literal["memory", "postgres"] = "memory"
    # Bloqueio da sessão SIGAA do mesmo aluno: `memory` vale dentro de um processo; `postgres` vale entre
    # workers e réplicas (advisory lock). Com vários workers use `postgres`.
    session_lock_backend: Literal["memory", "postgres"] = "memory"
    # Conexões reservadas só para esses bloqueios (cada requisição ao SIGAA segura uma enquanto dura).
    session_lock_pool: int = Field(default=8, ge=1, le=100)
    rate_limit_requests: int = Field(default=600, gt=0)
    # Multiplica as cotas de publicação por origem de rede (só para o teste de carga: todos os usuários
    # virtuais compartilham um IP). Em produção fica 1.
    publish_quota_multiplier: int = Field(default=1, ge=1, le=1_000_000)
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
