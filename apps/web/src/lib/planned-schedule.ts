import type { AgendaItem } from '#/lib/agenda';
import type { SubjectClassroom } from '#/queries/subjects';

import { groupBySemester } from '#/lib/classroom-details';
import { localStorageRepository, STORAGE_KEYS, storedValue } from '#/lib/local-storage';
import { overlaps, parseSchedule, visibleSlots, WEEKDAYS_SHORT } from '#/lib/schedule';

export interface PlannedClass extends SubjectClassroom {
    code: string;
    name: string;
    hours: number | null;
}

const EMPTY: PlannedClass[] = [];

/** Uma grade montada no simulador; a ativa é a que a Busca e Minhas Turmas usam. */
export interface SchedulePlan {
    id: string;
    name: string;
    items: PlannedClass[];
}

export interface SchedulePlans {
    active: string;
    plans: SchedulePlan[];
}

export const MAX_PLANS = 6;
const FIRST: SchedulePlans = {
    active: 'grade-1',
    plans: [{ id: 'grade-1', name: 'Grade 1', items: [] }]
};

// A grade única de antes vira a "Grade 1".
if (typeof window !== 'undefined') {
    const old = localStorageRepository.get<PlannedClass[]>(STORAGE_KEYS.SCHEDULE);
    if (old && !localStorageRepository.get(STORAGE_KEYS.SCHEDULE_PLANS)) {
        localStorageRepository.set(STORAGE_KEYS.SCHEDULE_PLANS, {
            ...FIRST,
            plans: [{ ...FIRST.plans[0], items: old }]
        });
    }
    if (old) localStorageRepository.remove(STORAGE_KEYS.SCHEDULE);
}

export const schedulePlans = storedValue<SchedulePlans>(STORAGE_KEYS.SCHEDULE_PLANS, FIRST);

export const activePlan = ({ active, plans }: SchedulePlans): SchedulePlan =>
    plans.find((plan) => plan.id === active) ?? plans[0] ?? FIRST.plans[0];

function updatePlans(change: (value: SchedulePlans) => SchedulePlans) {
    schedulePlans.set(change(schedulePlans.getSnapshot()));
}

let lastPlans: SchedulePlans | undefined;
let lastItems: PlannedClass[] = EMPTY;

/** A grade ativa, com a mesma interface de antes: a Busca e Minhas Turmas mexem nela. */
export const plannedSchedule = {
    subscribe: schedulePlans.subscribe,
    getSnapshot: () => {
        const plans = schedulePlans.getSnapshot();
        if (plans !== lastPlans) {
            lastPlans = plans;
            lastItems = activePlan(plans).items;
        }
        return lastItems;
    },
    getServerSnapshot: () => EMPTY,
    set: (items: PlannedClass[]) =>
        updatePlans((value) => ({
            ...value,
            plans: value.plans.map((plan) =>
                plan.id === activePlan(value).id ? { ...plan, items } : plan
            )
        })),
    clear: () => plannedSchedule.set([])
};

const nextName = (plans: SchedulePlan[]) => {
    let index = plans.length + 1;
    while (plans.some((plan) => plan.name === `Grade ${index}`)) index++;
    return `Grade ${index}`;
};

/** Nova grade (vazia ou cópia de outra), já ativa; `null` passado o limite. */
export function createPlan(copyFrom?: string): string | null {
    const value = schedulePlans.getSnapshot();
    if (value.plans.length >= MAX_PLANS) return null;
    const source = value.plans.find((plan) => plan.id === copyFrom);
    const plan: SchedulePlan = {
        id: `grade-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: source ? `${source.name} (cópia)`.slice(0, 40) : nextName(value.plans),
        items: source?.items ?? []
    };
    schedulePlans.set({ active: plan.id, plans: [...value.plans, plan] });
    return plan.id;
}

export function selectPlan(id: string) {
    updatePlans((value) =>
        value.plans.some((plan) => plan.id === id) ? { ...value, active: id } : value
    );
}

export function renamePlan(id: string, name: string) {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    updatePlans((value) => ({
        ...value,
        plans: value.plans.map((plan) => (plan.id === id ? { ...plan, name: clean } : plan))
    }));
}

/** Apaga a grade; a última nunca some, só fica vazia. */
export function deletePlan(id: string) {
    updatePlans((value) => {
        const plans = value.plans.filter((plan) => plan.id !== id);
        if (plans.length === 0) return FIRST;
        return { active: value.active === id ? plans[0].id : value.active, plans };
    });
}

export const classKey = ({ code, semester, number }: PlannedClass) =>
    `${code}-${semester}-${number}`;

/** As turmas planejadas no formato da agenda do dia. */
export const plannedAgenda = (items: PlannedClass[]): AgendaItem[] =>
    items.map((item) => ({
        id: classKey(item),
        subject: { code: item.code, name: item.name },
        room: item.room,
        schedule: item.schedule,
        semester: item.semester
    }));

const totalHours = (items: PlannedClass[]) =>
    items.reduce((total, item) => total + (item.hours ?? 0), 0);

/** Por que a turma não entra na grade: matéria repetida, choque de horário ou carga máxima. */
export function addError(
    items: PlannedClass[],
    item: PlannedClass,
    maxHours: number | null
): string | null {
    const semester = items.filter((entry) => entry.semester === item.semester);
    const repeated = semester.find((entry) => entry.code === item.code);
    if (repeated) {
        return `${item.name} (${item.code}) já está na grade do semestre ${item.semester}, na turma ${repeated.number}.`;
    }
    const times = parseSchedule(item.schedule);
    const clash = semester.find((entry) =>
        parseSchedule(entry.schedule).some((existing) =>
            times.some((time) => overlaps(time, existing))
        )
    );
    if (clash) {
        return `O horário de ${item.name} (${item.code}) conflita com ${clash.name} (${clash.code}), turma ${clash.number}.`;
    }
    if (maxHours != null && totalHours(semester) + (item.hours ?? 0) > maxHours) {
        return `Adicionar ${item.name} ultrapassa a carga horária máxima de ${maxHours}h no semestre ${item.semester}.`;
    }
    return null;
}

/** Segunda a sábado, como `Date.getDay()`. */
export const GRID_DAYS = WEEKDAYS_SHORT.slice(1).map((label, index) => ({
    label,
    weekday: index + 1
}));

export interface GridRow {
    start: string;
    end: string;
    /** Uma célula por dia de `GRID_DAYS`; a grade não aceita choques. */
    cells: (PlannedClass | undefined)[];
}

/** Grade semanal por semestre, desenhada tanto no modal quanto na imagem. */
export function weeklyGrid(items: PlannedClass[]) {
    return groupBySemester(items).map(([semester, classes]) => {
        const timed = classes.map((item) => ({ item, times: parseSchedule(item.schedule) }));
        const rows = visibleSlots(timed.flatMap(({ times }) => times)).map(
            ([start, end]): GridRow => ({
                start,
                end,
                cells: GRID_DAYS.map(
                    ({ weekday }) =>
                        timed.find(({ times }) =>
                            times.some((time) => overlaps(time, { weekday, start, end }))
                        )?.item
                )
            })
        );
        return {
            semester,
            classes,
            hours: totalHours(classes),
            rows,
            unscheduled: timed.filter(({ times }) => times.length === 0).map(({ item }) => item)
        };
    });
}

export type GridSemester = ReturnType<typeof weeklyGrid>[number];
