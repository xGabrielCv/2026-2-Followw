"""Jobs em segundo plano, numa sessão própria do SIGAA.

Só buscam o que é público e anônimo (os índices das turmas encerradas que o aluno liberou): nada
do aluno é gravado. A credencial viaja cifrada e some quando o job acaba.
"""

from pydantic import BaseModel, ConfigDict, field_serializer
from sigaa_client import Credentials


class Job(BaseModel):
    model_config = ConfigDict(frozen=True)

    credentials: Credentials
    task: str
    # chave anônima do aparelho, para gravar o que é do aluno sem a matrícula
    author: str | None = None
    attempt: int = 1

    @property
    def registration(self) -> str:
        return self.credentials.registration

    @property
    def key(self) -> str:
        """A mesma tarefa do mesmo aluno tem a mesma chave (para descartar repetidas)."""
        return f"{self.registration}:{self.task}:#{self.attempt}"

    @field_serializer("credentials")
    def _reveal(self, credentials: Credentials) -> dict[str, str]:
        # O job sai daqui cifrado: a senha só volta a ser legível na própria API.
        return {
            "registration": credentials.registration,
            "password": credentials.password.get_secret_value(),
        }
