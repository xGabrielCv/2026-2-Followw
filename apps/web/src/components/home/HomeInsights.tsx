import type { Classroom } from '#/queries/classrooms';
import type { UserProfile } from '#/queries/me';

import { SemesterOverview } from '#/components/home/SemesterOverview';
import { ListCard, Meter } from '#/components/ListCard';
import { AcademicIndexesCard } from '#/components/profile/ProfileOverview';
import { SectionHeader } from '#/components/SectionHeader';
import { academicIndexes } from '#/lib/profile';

interface HomeInsightsProps {
    date: string;
    user: UserProfile | null;
    classrooms?: Classroom[];
}

/** Estatísticas do semestre e do curso: na lateral do computador ou no fim da página no celular. */
export function HomeInsights({ date, user, classrooms }: HomeInsightsProps) {
    const performance = user && (academicIndexes(user).length > 0 || user.integralization != null);
    return (
        <>
            <section aria-label="Semestre">
                <SectionHeader title="Semestre" />
                <SemesterOverview date={date} classrooms={user ? classrooms : undefined} />
            </section>
            {performance && (
                <section aria-label="Desempenho">
                    <SectionHeader title="Desempenho" actionLabel="Ver perfil" actionTo="/perfil" />
                    <div className="flex flex-col gap-2">
                        <AcademicIndexesCard user={user} />
                        {user.integralization != null && (
                            <ListCard>
                                <Meter label="Integralização" value={user.integralization} />
                            </ListCard>
                        )}
                    </div>
                </section>
            )}
        </>
    );
}
