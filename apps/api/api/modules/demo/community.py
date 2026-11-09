"""Materiais, conversas, guias e denúncias fictícios, para os dados de demonstração."""

import hashlib
import random
import uuid
from collections.abc import Callable
from functools import partial
from io import BytesIO

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import academic_calendar
from api.db.main import after_rollback
from api.db.models import (
    Classroom,
    ForumPost,
    ForumReply,
    Material,
    ProfessorReview,
    Report,
    Tutorial,
)
from api.modules.materials.sanitize import sanitize
from api.storage import material_storage

_DEMO_KEY = "demo"
_MATERIALS = (
    ("Prova 1 resolvida", "prova", "image/png"),
    ("Lista de exercícios 2", "lista", "application/pdf"),
    ("Resumo para a P2", "resumo", "image/jpeg"),
)
_POSTS = (
    (
        "duvida",
        "Alguém sabe se a P1 cai recursão?",
        "Vi no plano de ensino mas não ficou claro. Quem já fez a matéria lembra?",
    ),
    (
        "duvida",
        "Como pedir revisão de menção no SIGAA?",
        "Minha menção saiu errada. Precisa abrir processo ou fala direto com o professor?",
    ),
    (
        "post",
        "Grupo de estudos para a P2",
        "Vamos nos encontrar na biblioteca às quintas, 14h. Quem quiser aparece!",
    ),
    (
        "duvida",
        "Vale a pena pegar 30 créditos no semestre?",
        "Estou pensando em adiantar matérias. Alguém que já fez conta como foi?",
    ),
    (
        "post",
        "Achei um carregador no S3",
        "Deixei com o pessoal da secretaria do bloco.",
    ),
)
_REPLIES = (
    "Cai sim, o professor avisou na última aula.",
    "Fala primeiro com o professor; se não resolver, abre o processo na secretaria.",
    "Eu vou!",
    "Depende das matérias: com duas de cálculo junto fica pesado.",
    "Valeu pela dica!",
)
_TUTORIALS = (
    (
        "estagio",
        "Como cadastrar um estágio no SIGAA (exemplo)",
        "Passo a passo do termo de compromisso até a assinatura. Guia de demonstração.",
        (
            "## Antes de começar\n\nEste é um **guia de demonstração** gerado para testar o app.\n\n"
            "1. Combine com a empresa as atividades e o horário.\n"
            "2. No SIGAA, procure a área de estágios do seu curso.\n"
            "3. Preencha o termo de compromisso e envie para a coordenação.\n"
            "4. Acompanhe as assinaturas até o termo ficar ativo.\n\n"
            "Confirme sempre as regras atuais com a coordenação do seu curso."
        ),
    ),
    (
        "matricula",
        "Dicas para a matrícula (exemplo)",
        "Como montar a grade, entender a prioridade e o ajuste. Guia de demonstração.",
        (
            "## Montando a grade\n\nUse o **simulador de grades** do Followw para comparar opções.\n\n"
            "- Veja os pré-requisitos antes.\n- Tenha turmas reserva.\n"
            "- No ajuste, as vagas que sobram são redistribuídas."
        ),
    ),
    (
        "auxilios",
        "Auxílios estudantis: por onde começar (exemplo)",
        "Onde encontrar os editais e o que separar de documentos. Guia de demonstração.",
        (
            "## Onde ver\n\nOs editais saem no site da assistência estudantil.\n\n"
            "Separe comprovantes de renda e de residência com antecedência."
        ),
    ),
)


def _demo_file(title: str, mime: str, seed: int) -> bytes:
    """Uma imagem simples com o título; o PDF é a mesma imagem numa página."""
    rng = random.Random(seed)
    image = Image.new("RGB", (900, 1200), (250, 250, 247))
    draw = ImageDraw.Draw(image)
    draw.rectangle((40, 40, 860, 140), fill=(77, 187, 148))
    draw.text((60, 75), f"{title} - demonstração", fill=(10, 30, 20))
    for line in range(14):
        y = 200 + line * 60
        draw.line((60, y, 60 + rng.randint(400, 780), y), fill=(150, 150, 150), width=4)
    output = BytesIO()
    image.save(
        output,
        format={"image/png": "PNG", "image/jpeg": "JPEG", "application/pdf": "PDF"}[
            mime
        ],
    )
    return sanitize(output.getvalue(), mime)


async def community(
    session: AsyncSession,
    current: list[Classroom],
    rng: random.Random,
    track: Callable[[str, uuid.UUID], None],
) -> None:
    storage = material_storage()
    semester = academic_calendar.current_regular_semester()
    for index, classroom in enumerate(current):
        for offset, (title, kind, mime) in enumerate(_MATERIALS[: 1 + index % 3]):
            data = _demo_file(title, mime, index * 10 + offset)
            key = uuid.uuid4().hex
            await storage.save(key, data)
            after_rollback(session, partial(storage.delete, key))
            material = Material(
                subject_code=classroom.subject_code,
                semester=semester
                if offset % 2 == 0
                else academic_calendar.shift_regular_semester(semester, -1),
                classroom_number=classroom.number if offset % 2 == 0 else None,
                professors=[p.name for p in classroom.professors]
                if offset % 2 == 0
                else [],
                title=title,
                kind=kind,
                filename=f"demo-{offset + 1}{'.pdf' if mime == 'application/pdf' else '.png' if mime == 'image/png' else '.jpg'}",
                mime=mime,
                size=len(data),
                sha256=hashlib.sha256(data + key.encode()).hexdigest(),
                storage_key=key,
                uploader_key=_DEMO_KEY,
            )
            session.add(material)
            await session.flush()
            track("material", material.id)

    subjects = [classroom.subject_code for classroom in current] or [None]
    for index, (kind, title, body) in enumerate(_POSTS):
        post = ForumPost(
            kind=kind,
            title=title,
            body=body,
            campus=rng.choice(["gama", "darcy", None]),
            subject_code=subjects[index % len(subjects)] if index % 2 == 0 else None,
            author_key=_DEMO_KEY,
            reply_count=0,
        )
        session.add(post)
        await session.flush()
        track("post", post.id)
        for reply in range(index % 3):
            item = ForumReply(
                post_id=post.id,
                body=_REPLIES[(index + reply) % len(_REPLIES)],
                author_key=_DEMO_KEY if reply == 1 else f"demo-{reply}",
            )
            session.add(item)
            await session.flush()
            track("reply", item.id)

    for category, title, summary, body in _TUTORIALS:
        tutorial = Tutorial(
            title=title,
            summary=summary,
            body=body,
            category=category,
            status="approved",
            author_key=_DEMO_KEY,
        )
        session.add(tutorial)
        await session.flush()
        tutorial.approved_at = tutorial.created_at
        track("tutorial", tutorial.id)
    pending = Tutorial(
        title="Como trancar uma matéria (exemplo pendente)",
        summary="Guia de demonstração esperando aprovação no painel do administrador.",
        body="Este guia de demonstração existe para testar a fila de aprovação do painel. "
        * 2,
        category="sigaa",
        status="pending",
        author_key=_DEMO_KEY,
    )
    session.add(pending)
    await session.flush()
    track("tutorial", pending.id)

    # Uma denúncia na fila, para ver a moderação funcionando.
    review_id = await session.scalar(
        select(ProfessorReview.id)
        .where(ProfessorReview.token_hash == _DEMO_KEY)
        .limit(1)
    )
    if review_id is not None:
        report = Report(
            target_type="review",
            target_id=review_id,
            reason="ofensivo",
            message="Denúncia de demonstração.",
        )
        session.add(report)
        await session.flush()
        track("report", report.id)
