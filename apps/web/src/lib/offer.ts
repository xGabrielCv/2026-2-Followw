import { getSemester, listSemesters } from '#/calendar';

const REGULAR = /^\d{4}\.[12]$/;

/** `2026.2` -> `2027.1`; o de férias (`.4`) não conta. */
export function nextRegularSemester(semester: string) {
    const [year, term] = semester.split('.').map(Number);
    return term === 1 ? `${year}.2` : `${year + 1}.1`;
}

/** Último semestre regular já iniciado; nas férias, o que acabou de terminar. */
export function currentRegularSemester(today: string) {
    return listSemesters()
        .filter(({ semester, period }) => REGULAR.test(semester) && period.start <= today)
        .map(({ semester }) => semester)
        .toSorted()
        .at(-1);
}

/** Início da matrícula do semestre, pelo calendário acadêmico. */
export function enrollmentStart(semester: string) {
    return getSemester(semester)?.events.find((event) => event.category === 'enrollment')
        ?.start_date;
}

export interface OfferChoice {
    semester: string;
    kind: 'current' | 'next';
    available: boolean;
}

/** O semestre atual e o próximo, marcando quais já têm oferta gravada. */
export function offerChoices(available: readonly string[], today: string) {
    const current = currentRegularSemester(today);
    const choices: OfferChoice[] = current
        ? [
              { semester: current, kind: 'current', available: available.includes(current) },
              {
                  semester: nextRegularSemester(current),
                  kind: 'next',
                  available: available.includes(nextRegularSemester(current))
              }
          ]
        : [];
    const fallback = choices.find((choice) => choice.available)?.semester ?? available[0];
    return {
        choices,
        /** O escolhido, se tiver oferta; senão o atual ou o mais recente gravado. */
        resolve: (picked: string | null) =>
            picked && available.includes(picked) ? picked : fallback
    };
}

/** Parâmetro da API: omitido quando é o padrão dela, o mais recente gravado. */
export const semesterParam = (semester: string | undefined, available: readonly string[]) =>
    semester && semester !== available[0] ? semester : undefined;
