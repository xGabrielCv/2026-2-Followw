import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { GraduationCap } from 'lucide-react';

import { PagedSection } from '#/components/search/PagedSection';
import { titleCase } from '#/lib/profile';
import { type CoursePage, coursesQueryOptions } from '#/queries/courses';
import { coursesIndicatorsSummaryQueryOptions, formatPasScore } from '#/queries/indicators';

export function CourseSection({
    page,
    q,
    onShowAll
}: {
    page: CoursePage;
    q: string | null;
    onShowAll?: () => void;
}) {
    const indicators = useQuery(coursesIndicatorsSummaryQueryOptions);
    const byCourse = indicators.data?.courses;

    return (
        <PagedSection
            title="Cursos"
            count={`${page.total} ${page.total === 1 ? 'curso' : 'cursos'}`}
            noun="cursos"
            first={page}
            pageOptions={(number) => coursesQueryOptions(q, number)}
            onShowAll={onShowAll}
        >
            {(courses) => (
                <div className="flex flex-col gap-3">
                    {courses.map((course) => {
                        const summary = byCourse?.[String(course.id)];
                        const pasValue = summary?.pas_average ?? summary?.pas_latest ?? null;
                        const pasLabel =
                            summary && summary.pas_cycles_count > 1 ? 'PAS médio' : 'PAS';
                        return (
                            <Link
                                key={course.id}
                                to="/cursos/$id"
                                params={{ id: course.id }}
                                aria-description="Abrir fluxograma do curso"
                                className="flex items-center gap-4 rounded-2xl border bg-card p-5 text-card-foreground transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                                <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                    <GraduationCap className="size-8" aria-hidden="true" />
                                </div>
                                <div className="flex min-w-0 flex-1 flex-col gap-2">
                                    <h3 className="text-base leading-snug font-semibold">
                                        {titleCase(course.name)}
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <p className="text-sm font-medium text-primary">
                                            {course.level ?? 'Curso'}
                                            {course.shift && ` · ${titleCase(course.shift)}`}
                                        </p>
                                        {pasValue != null && (
                                            <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary tabular-nums">
                                                {pasLabel}: {formatPasScore(pasValue)}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {titleCase(course.unit.name)}
                                    </p>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </PagedSection>
    );
}
