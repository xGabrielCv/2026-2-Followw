import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, notFound, rootRouteId } from '@tanstack/react-router';

import { ErrorState } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoginPromptCard } from '#/components/home/LoginPromptCard';
import { SubjectMaterialsPanel } from '#/components/materials/SubjectMaterialsPanel';
import { allClassroomsQueryOptions } from '#/queries/classrooms';
import { subjectMaterialsQueryOptions } from '#/queries/community';
import { meQueryOptions } from '#/queries/me';

export const Route = createFileRoute('/_app/materiais_/$code')({
    params: {
        parse: ({ code }) => {
            if (!/^[A-Za-z0-9]{3,16}$/.test(code)) throw notFound({ routeId: rootRouteId });
            return { code: code.toUpperCase() };
        },
        stringify: ({ code }) => ({ code })
    },
    head: ({ params }) => ({ meta: [{ title: `Material de ${params.code} | Followw` }] }),
    staticData: {
        header: () => <BackHeader to="/materiais" title="Material da matéria" />
    },
    errorComponent: ErrorState,
    component: MaterialPage
});

function MaterialPage() {
    const { code } = Route.useParams();
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const classrooms = useQuery({ ...allClassroomsQueryOptions, enabled: Boolean(user) });
    const materials = useQuery({ ...subjectMaterialsQueryOptions(code), enabled: Boolean(user) });
    if (!user) return <LoginPromptCard />;
    // se o aluno cursa a matéria agora, o envio já vem com a turma dele
    const current = classrooms.data?.find((item) => item.current && item.subject.code === code);

    return (
        <div className="flex flex-col gap-3 pb-8">
            <header>
                <p className="text-xs font-semibold text-primary">{code}</p>
                <h1 className="text-xl leading-tight font-semibold tracking-tight text-balance">
                    {materials.data?.subject.name ?? current?.subject.name ?? 'Matéria'}
                </h1>
            </header>
            <SubjectMaterialsPanel
                code={code}
                classroom={
                    current && {
                        semester: current.semester,
                        number: current.number,
                        professors: current.professors.map(({ name }) => name)
                    }
                }
            />
        </div>
    );
}
