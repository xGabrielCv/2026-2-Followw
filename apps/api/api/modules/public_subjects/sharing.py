from sqlalchemy import ColumnElement, select

from api.db.models import Classroom, SharedStatistics


def shared_statistics() -> ColumnElement[bool]:
    """Turma com estatística que algum aluno liberou nos índices públicos."""
    return Classroom.id.in_(select(SharedStatistics.classroom_id))
