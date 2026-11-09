"""CAS e SIGAA sintéticos no transporte HTTP; os parsers e locks reais continuam ativos."""

import asyncio
import hmac
import os
from collections import Counter
from html import escape
from pathlib import Path
from secrets import token_hex

import httpx
from sigaa_client import SigaaClient as RealSigaaClient
from sigaa_client.config import CLASSROOMS_PATH, DASHBOARD_PATH

LOGIN = """<form action="/sso-server/login?service=x" method="post">
<input type="text" name="username"/><input type="password" name="password"/><input type="hidden" name="lt" value="LT-local"/>
</form>"""

CLASSES = {
    "AAA": ("FGA0146", "ESTRUTURAS DE DADOS 1", "2026.2", "01"),
    "BBB": ("FGA0158", "ORIENTAÇÃO A OBJETOS", "2025.2", "02"),
}


def form(content: str, name: str = "form", action: str = CLASSROOMS_PATH) -> str:
    return f'''<form id="{name}" name="{name}" action="{action}">
    <input name="javax.faces.ViewState" value="j_local"/>{content}</form>'''


def history() -> str:
    rows = []
    for key, (code, name, semester, number) in CLASSES.items():
        rows.append(f"""<tr><td class="periodo">{semester}</td></tr><tr>
        <td>{code} - {name}</td><td align="center">{number}</td><td align="right">60h</td>
        <td>24M12</td><td><a title="Acessar Turma Virtual" href="#"
        onclick="jsfcljs(x,{{'form:link':'form:link','frontEndIdTurma':'{key}'}},'');">Entrar</a></td></tr>""")
    return form('<table class="listagem">' + "".join(rows) + "</table>")


def dashboard(registration: str) -> str:
    name = "ALUNA SIMULADA A" if registration == "251000000" else "ALUNO SIMULADO B"
    profile = f"""<div id="perfil-docente"><div class="info-docente"><p class="nome">{name}</p></div>
    <table><tr><td>Matrícula:</td><td>{escape(registration)}</td></tr>
    <tr><td>Curso:</td><td>ENGENHARIA DE SOFTWARE/FCTE - Bacharelado</td></tr>
    <tr><td>Nível:</td><td>GRADUAÇÃO</td></tr><tr><td>Entrada:</td><td>2025.1</td></tr>
    <tr><td><acronym>IRA:</acronym></td><td>4.1</td></tr></table><span>35% Integralizado</span></div>"""
    active = """<table><tr><td>2026.2</td></tr><tr class="odd"><td class="descricao">
    <form id="form_acessarTurmaVirtual"><a onclick="jsfcljs(x,{'frontEndIdTurma':'AAA'},'');">ESTRUTURAS DE DADOS 1</a></form>
    </td><td class="info">FCTE - SALA SINTÉTICA 1</td><td class="info"><center>24M12</center></td></tr>
    <tr><td id="linha_1617644"></td></tr></table>"""
    menu = form("", "menu:form_menu_discente", DASHBOARD_PATH)
    return f"<html><body>{profile}{active}{menu}</body></html>"


def context(key: str) -> str:
    code, name, semester, number = CLASSES[key]
    return f"""<script>var nomeTurma = "<div>Turma: {code} - {name} ({semester} - T{number})</div>";</script>"""


def home() -> str:
    links = "".join(
        f"""<a onclick="jsfcljs(x,{{'screen':'{key}'}},'');">{label}</a>"""
        for key, label in [
            ("frequency", "Frequência"),
            ("news", "Notícias"),
            ("topics", "Principal"),
            ("assessments", "Avaliações"),
        ]
    )
    return form(links, "formMenu", "/sigaa/ava/index.jsf")


FREQUENCY = """<div class="rich-stglpanel-header">Andamento das Aulas</div>
<div class="rich-stglpanel-body"><div>Aulas (Ministradas/Total): <i>24 / 60</i></div>
<div class="progress"><div class="progress-bar" style="width:40%">40%</div></div></div>
<fieldset><legend>Mapa de Frequências</legend><table class="listing"><tbody>
<tr><td>10/08/2026</td><td>Presente</td></tr><tr><td>12/08/2026</td><td>2 Falta(s)</td></tr>
</tbody></table><div class="botoes-show"><b>Presenças Registradas:</b> 22<br/>
<b>Número de Aulas com Registro de Frequência:</b> 24<br/>
<b>Porcentagem de Frequência em relação as Aulas com Registro de Frequência:</b> 92%<br/>
<b>Número de Aulas definidas pela CH do Componente:</b> 60<br/>
<b>Porcentagem de Frequência em relação a CH:</b> 37%</div></fieldset>"""

GRADES = """<h3>Relatório de Notas do(a) Aluno(a)</h3><table class="tabelaRelatorio">
<caption>2025.2</caption><thead><tr><th>Código</th><th>Disciplina</th><th>Resultado</th></tr></thead>
<tbody><tr class="linhaPar linha"><td>FGA0158</td><td>ORIENTAÇÃO A OBJETOS</td><td>MS</td></tr></tbody></table>"""

NEWS = form(
    """<fieldset><legend>Notícias</legend><table class="listing"><tbody><tr>
<td>Notícia sintética de boas-vindas</td><td>10/08/2026</td><td><a
onclick="jsfcljs(x,{'id':'42'},'');">Visualizar</a></td></tr></tbody></table></fieldset>""",
    "news",
    "/sigaa/ava/NoticiaTurma/listar.jsf",
)


def install_simulated_client(fake) -> None:
    """Transporte sem sockets; mantém autenticação, parsers e sessões do cliente real."""
    if os.environ.get("ENVIRONMENT") != "testing":
        raise RuntimeError("Simulação autenticada exige ambiente testing.")
    import api.sigaa as integration
    from api.modules.auth import router as auth

    class SyntheticClient(RealSigaaClient):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(fake)
            super().__init__(*args, **kwargs)

    integration.SigaaClient = SyntheticClient
    auth.SigaaClient = SyntheticClient


class SimulatedSigaa:
    def __init__(self, latency: float = 0, counter: Path | None = None) -> None:
        self.latency = latency
        self.calls: Counter[str] = Counter()
        self.sessions: dict[str, tuple[str, str]] = {}
        self.tickets: dict[str, str] = {}
        self.mode = "normal"
        self.counter = counter
        self.expired: set[str] = set()
        self.signing_key = os.environ.get(
            "FOLLOWW_SIMULATION_KEY", "public-synthetic-tests-only"
        ).encode()

    def observe(self, name: str) -> None:
        self.calls[name] += 1
        if self.counter is not None:
            with Path(str(self.counter) + "." + name).open("ab") as handle:
                handle.write(b"x")

    def expire(self, registration: str | None = None) -> None:
        self.expired.update(
            key
            for key, value in self.sessions.items()
            if registration is None or value[0] == registration
        )
        self.sessions = {
            key: value
            for key, value in self.sessions.items()
            if registration is not None and value[0] != registration
        }

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.observe("requests")
        await asyncio.sleep(self.latency)
        if self.mode == "timeout":
            raise httpx.ReadTimeout("Timeout sintético", request=request)
        if self.mode == "unavailable":
            return httpx.Response(503, text="Indisponibilidade sintética")
        payload = (
            dict(httpx.QueryParams(request.content.decode())) if request.content else {}
        )
        path = request.url.path
        if request.url.host == "autenticacao.unb.br":
            if request.method == "GET":
                return httpx.Response(200, text=LOGIN)
            registration = payload.get("username", "")
            if not (
                registration.isdigit()
                and len(registration) == 9
                and payload.get("password") == "simulada123"
            ):
                return httpx.Response(
                    200,
                    text=LOGIN
                    + '<p id="errors" class="login-error">Credenciais inválidas.</p>',
                )
            ticket = token_hex(12)
            self.tickets[ticket] = registration
            return httpx.Response(
                302,
                headers={
                    "location": f"https://sigaa.unb.br/sigaa/login/cas?ticket={ticket}"
                },
            )
        if path == "/sigaa/login/cas":
            registration = self.tickets.pop(request.url.params.get("ticket", ""), None)
            if registration is None:
                return httpx.Response(403)
            self.observe("logins")
            message = registration + "." + token_hex(16)
            token = (
                "app14~"
                + message
                + "."
                + hmac.digest(self.signing_key, message.encode(), "sha256").hex()
            )
            self.sessions[token] = (registration, "AAA")
            return httpx.Response(
                302,
                headers={
                    "location": DASHBOARD_PATH,
                    "set-cookie": f"JSESSIONID={token}; Path=/",
                },
            )
        if path == "/sigaa/verTelaLogin.do":
            return httpx.Response(200, text=LOGIN)
        token = next(
            (
                part.strip().partition("=")[2]
                for part in request.headers.get("cookie", "").split(";")
                if part.strip().startswith("JSESSIONID=")
            ),
            "",
        )
        # Workers diferentes enxergam a mesma sessão sintética, sem consultar uma origem real.
        if (
            token not in self.sessions
            and token not in self.expired
            and token.startswith("app14~")
        ):
            registration, separator, _signature = token.removeprefix(
                "app14~"
            ).partition(".")
            message, _, mac = token.removeprefix("app14~").rpartition(".")
            if (
                separator
                and registration.isdigit()
                and len(registration) == 9
                and hmac.compare_digest(
                    mac, hmac.digest(self.signing_key, message.encode(), "sha256").hex()
                )
            ):
                self.sessions[token] = (registration, "AAA")
        if path == "/sigaa/logar.do":
            self.sessions.pop(token, None)
            self.expired.add(token)
            self.observe("logouts")
            return httpx.Response(200, text="Saiu")
        if token not in self.sessions:
            return httpx.Response(
                302, headers={"location": "https://sigaa.unb.br/sigaa/verTelaLogin.do"}
            )
        registration, selected = self.sessions[token]
        self.observe("authenticated")
        if path == DASHBOARD_PATH:
            self.observe("profile" if request.method == "GET" else "grades")
            if request.method == "POST" and any(
                "ofertaEstagio" in value for value in payload.values()
            ):
                return httpx.Response(
                    200,
                    text='<table id="listagem_meu_curso"><tbody></tbody></table><table id="listagem_outros_cursos"><tbody></tbody></table>',
                )
            return httpx.Response(
                200, text=dashboard(registration) if request.method == "GET" else GRADES
            )
        if path == CLASSROOMS_PATH:
            if request.method == "POST":
                selected = payload.get("frontEndIdTurma", selected)
                if selected not in CLASSES:
                    return httpx.Response(404)
                self.sessions[token] = (registration, selected)
                return httpx.Response(200, text=home() + context(selected))
            return httpx.Response(200, text=history())
        if path == "/sigaa/ava/index.jsf":
            screen = payload.get("screen")
            body = {
                "frequency": FREQUENCY,
                "news": NEWS,
                "assessments": "<fieldset><legend>Datas de Avaliações</legend></fieldset>",
                "topics": '<form id="formAva"><div class="topico-aula"><h3 class="titulo">Aula simulada (10/08/2026 - 12/08/2026)</h3><div class="conteudotopico">Material de estudo.</div></div></form>',
            }.get(screen, home())
            return httpx.Response(
                200, text='<div id="conteudo">' + body + "</div>" + context(selected)
            )
        if path == "/sigaa/ava/participantes.jsf":
            return httpx.Response(
                200,
                text="""<fieldset><legend>Docentes (1)</legend></fieldset>
            <table class="participantes"><tr><td valign="top"><strong>DOCENTE SINTÉTICO</strong></td></tr></table>
            <fieldset><legend>Discentes (0)</legend></fieldset><table class="participantes"></table>"""
                + context(selected),
            )
        if path == "/sigaa/ava/NoticiaTurma/listar.jsf":
            return httpx.Response(
                200,
                text="""<fieldset><legend>Visualização de Notícia</legend><ul class="form">
            <li><label>Título:</label><span>Notícia sintética de boas-vindas</span></li>
            <li><label>Data:</label><span>10/08/2026 10:00</span></li>
            <li><table><tr><th>Texto:</th><td class="conteudoNoticia"><div><p>Conteúdo simulado.</p></div></td></tr></table></li>
            </ul></fieldset>"""
                + context(selected),
            )
        return httpx.Response(
            503, text="Tela não simulada; nenhuma consulta real foi feita."
        )
