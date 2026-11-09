import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse, JSONResponse

from api.core.config import settings
from api.errors import EXCEPTION_HANDLERS
from api.logger import RequestLoggingMiddleware
from api.maintenance import MaintenanceMiddleware
from api.modules.admin.router import router as admin_router
from api.modules.auth.router import router as auth_router
from api.modules.class_groups.router import router as class_groups_router
from api.modules.classrooms.router import router as classrooms_router
from api.modules.community.router import router as community_router
from api.modules.demo.router import router as demo_router
from api.modules.forum.router import router as forum_router
from api.modules.internships.router import router as internships_router
from api.modules.logs.sink import get_sink
from api.modules.materials.router import router as materials_router
from api.modules.me.router import router as me_router
from api.modules.posts.router import router as posts_router
from api.modules.professor_reviews.router import router as reviews_router
from api.modules.public_classrooms.router import router as public_classrooms_router
from api.modules.public_config.router import router as public_config_router
from api.modules.public_courses.router import router as public_courses_router
from api.modules.public_professors.router import router as public_professors_router
from api.modules.public_restaurant.router import router as public_restaurant_router
from api.modules.public_search.router import router as public_search_router
from api.modules.public_subjects.router import router as public_subjects_router
from api.modules.reports.router import router as reports_router
from api.modules.support.router import router as support_router
from api.modules.sync.scheduler import get_scheduler
from api.modules.tutorials.router import router as tutorials_router
from api.rate_limit import RateLimitMiddleware
from api.security import BodyTooLarge, SecurityMiddleware

# desativa logs "HTTP Request: ..." que o httpx emite pra cada chamada ao SIGAA
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

tags_metadata = [
    {
        "name": "Auth",
        "description": "Autenticação via SIGAA/CAS da UnB e gerenciamento de sessão stateless por cookies.",
    },
    {
        "name": "Classrooms",
        "description": "Turmas do semestre e histórico, participantes, frequência e estatísticas de aprovação.",
    },
    {
        "name": "Me",
        "description": "Perfil acadêmico, extrato/saldo do RU e carteirinha do estudante autenticado.",
    },
    {
        "name": "Internships",
        "description": "Mural de estágios do SIGAA, lido na hora e sem gravação.",
    },
    {
        "name": "Public Classrooms",
        "x-displayName": "Classrooms",
        "description": "Busca pública de turmas e unidades do SIGAA, sem autenticação.",
    },
    {
        "name": "Public Courses",
        "x-displayName": "Courses",
        "description": "Cursos cadastrados e seus currículos por semestre de ingresso, sem autenticação.",
    },
    {
        "name": "Public Professors",
        "x-displayName": "Professors",
        "description": "Catálogo público de docentes do SIGAA, sem autenticação.",
    },
    {
        "name": "Public Restaurant",
        "x-displayName": "Restaurant",
        "description": "Cardápio público do RU, sem autenticação.",
    },
    {
        "name": "Public Config",
        "x-displayName": "Config",
        "description": "Cartões do menu Mais e links das ferramentas, definidos no painel do admin.",
    },
    {
        "name": "Public Search",
        "x-displayName": "Search",
        "description": "Busca única de matérias, cursos e docentes, sem autenticação.",
    },
    {
        "name": "Public Subjects",
        "x-displayName": "Subjects",
        "description": "Componentes curriculares de graduação e suas turmas, sem autenticação.",
    },
    {
        "name": "Groups",
        "description": "Grupos de conversa das turmas, que qualquer aluno logado cadastra e edita, sem autor.",
    },
    {
        "name": "Reviews",
        "description": "Avaliações anônimas de docentes: nada de quem avaliou é gravado.",
    },
    {
        "name": "Materials",
        "description": "Material compartilhado por matéria (PDF e imagens), anônimo e sem metadados.",
    },
    {
        "name": "Forum",
        "description": "Dúvidas e publicações anônimas da comunidade, com respostas.",
    },
    {
        "name": "Tutorials",
        "description": "Guias escritos pela comunidade, publicados depois de aprovados.",
    },
    {
        "name": "Reports",
        "description": "Denúncias e pedidos de exclusão de conteúdo, para a moderação.",
    },
    {
        "name": "Community",
        "description": "Migração única da autoria antiga para credenciais independentes por publicação.",
    },
    {
        "name": "Support",
        "description": "Chamados de suporte anônimos: a chave de cada chamado fica só no aparelho do aluno.",
    },
    {
        "name": "Demo",
        "description": "Dados fictícios para testar o app localmente; desligado em produção.",
    },
    {
        "name": "Posts",
        "description": "Notícias e avaliações recentes das turmas, consultadas diretamente na home do SIGAA.",
    },
]


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """O agendador de sincronização vive com o processo; nos testes fica desligado."""
    enabled = settings.sync_scheduler_enabled
    if enabled is None:
        enabled = settings.environment != "testing"
    scheduler = get_scheduler()
    sink = get_sink()
    log_events = settings.log_events_enabled
    if log_events is None:
        log_events = settings.environment != "testing"
    if log_events:
        await sink.start()
    if enabled:
        await scheduler.start(settings.sync_tick_seconds)
    try:
        yield
    finally:
        await scheduler.stop()
        await sink.stop()


app = FastAPI(
    lifespan=lifespan,
    title="Followw UnB API",
    description=(
        "Cliente alternativo e open-source para o ecossistema de sistemas da Universidade "
        "de Brasília (UnB). Agrega em uma experiência unificada e performática dados do "
        "SIGAA, Restaurante Universitário (RU) e calendário oficial, com autenticação "
        "stateless delegada ao CAS da UnB, credenciais cifradas em cookies JWE (AES-256-GCM), "
        "sincronização assíncrona inteligente e cache resiliente via Stale-While-Revalidate."
    ),
    version="0.1.0",
    root_path="/api",
    docs_url=None,
    redoc_url=None,
    openapi_tags=tags_metadata,
    exception_handlers=EXCEPTION_HANDLERS,
)


def custom_openapi() -> dict[str, Any]:
    if app.openapi_schema is None:
        app.openapi_schema = get_openapi(
            title=app.title,
            version=app.version,
            openapi_version=app.openapi_version,
            description=app.description,
            routes=app.routes,
            tags=app.openapi_tags,
            servers=[{"url": app.root_path}],
        )
        app.openapi_schema["x-tagGroups"] = [
            {
                "name": "Public",
                "tags": [
                    "Public Classrooms",
                    "Public Courses",
                    "Public Professors",
                    "Public Restaurant",
                    "Public Search",
                    "Public Config",
                    "Public Subjects",
                ],
            },
            {
                "name": "SIGAA",
                "tags": ["Auth", "Classrooms", "Me", "Posts", "Internships"],
            },
            {
                "name": "Comunidade",
                "tags": [
                    "Groups",
                    "Reviews",
                    "Materials",
                    "Forum",
                    "Tutorials",
                    "Reports",
                    "Support",
                    "Community",
                    "Demo",
                ],
            },
        ]
    return app.openapi_schema


app.openapi = custom_openapi


@app.get("/docs", include_in_schema=False)
async def mintlify_docs() -> HTMLResponse:
    return HTMLResponse(
        f"""
        <!doctype html>
        <html lang="pt-BR">
          <head>
            <title>{app.title} — Documentação</title>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <meta http-equiv="refresh" content="0; url={settings.docs_url}" />
            <link rel="canonical" href="{settings.docs_url}" />
          </head>
          <body>
            <p>Redirecionando para a <a href="{settings.docs_url}">documentação no Mintlify</a>...</p>
          </body>
        </html>
        """
    )


if settings.environment == "production":
    app.add_middleware(HTTPSRedirectMiddleware)

app.add_middleware(RateLimitMiddleware)
app.add_middleware(MaintenanceMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Age", "Retry-After"],
)

app.add_middleware(RequestLoggingMiddleware)
# Por fora de tudo: cabeçalhos de segurança, origem das escritas e tamanho do corpo.
app.add_middleware(SecurityMiddleware)


@app.exception_handler(BodyTooLarge)
async def body_too_large(_request: Request, _error: BodyTooLarge) -> JSONResponse:
    return JSONResponse({"detail": "Corpo grande demais."}, status_code=413)


app.include_router(auth_router, prefix="/auth", tags=["Auth"])
app.include_router(classrooms_router, prefix="/classrooms", tags=["Classrooms"])
app.include_router(
    public_classrooms_router, prefix="/public/classrooms", tags=["Public Classrooms"]
)
app.include_router(
    public_courses_router, prefix="/public/courses", tags=["Public Courses"]
)
app.include_router(
    public_professors_router, prefix="/public/professors", tags=["Public Professors"]
)
app.include_router(
    public_restaurant_router, prefix="/public/restaurant", tags=["Public Restaurant"]
)
app.include_router(
    public_search_router, prefix="/public/search", tags=["Public Search"]
)
app.include_router(
    public_config_router, prefix="/public/config", tags=["Public Config"]
)
app.include_router(
    public_subjects_router, prefix="/public/subjects", tags=["Public Subjects"]
)
app.include_router(me_router, prefix="/me", tags=["Me"])
app.include_router(internships_router, prefix="/internships", tags=["Internships"])
app.include_router(posts_router, prefix="/posts", tags=["Posts"])
app.include_router(class_groups_router, prefix="/groups", tags=["Groups"])
app.include_router(reviews_router, prefix="/reviews", tags=["Reviews"])
app.include_router(demo_router, prefix="/demo", tags=["Demo"])
app.include_router(materials_router, prefix="/materials", tags=["Materials"])
app.include_router(forum_router, prefix="/forum", tags=["Forum"])
app.include_router(tutorials_router, prefix="/tutorials", tags=["Tutorials"])
app.include_router(reports_router, prefix="/reports", tags=["Reports"])
app.include_router(community_router, prefix="/community", tags=["Community"])
app.include_router(support_router, prefix="/support", tags=["Support"])
app.include_router(admin_router, prefix="/admin")
