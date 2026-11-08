import type { UserProfile } from '#/queries/me';

import { getCurrentSemester } from '#/calendar';
import { currentCurriculumPeriod } from '#/queries/subjects';

/** O curso do aluno usa o ingresso dele; outro curso, a matriz vigente no semestre atual. */
export function flowTarget(user: UserProfile | null | undefined, courseId: number) {
    const semester = getCurrentSemester()?.semester;
    const ownCourse = courseId === user?.course?.id;
    return {
        ownCourse,
        loggedIn: Boolean(user),
        entrySemester: ownCourse ? user?.entry_semester : semester,
        currentPeriod: ownCourse ? currentCurriculumPeriod(user?.entry_semester, semester) : null
    };
}

/** `/cursos/123`: só ids inteiros positivos. */
export function parseCourseId(id: string) {
    const courseId = /^\d+$/.test(id) ? Number(id) : 0;
    return Number.isSafeInteger(courseId) && courseId > 0 ? courseId : null;
}
