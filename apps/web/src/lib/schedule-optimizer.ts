import type { PlannedClass } from '#/lib/planned-schedule';

import { type ClassTime, overlaps, parseSchedule } from '#/lib/schedule';

/**
 * Simulador 2.0: monta grades válidas a partir das turmas que o aluno já escolheu como opção e as
 * ordena pelas preferências. É determinístico, roda no aparelho e nunca devolve grade com choque de
 * horário, matéria repetida, dia bloqueado ou carga acima do máximo. Não sabe de vagas nem de
 * pré-requisitos: usa só o que o aluno colocou em suas grades.
 */

export type Shift = 'morning' | 'afternoon' | 'night';
export type Weight = 0 | 1 | 2 | 3;

export const SHIFT_LABELS: Record<Shift, string> = {
    morning: 'manhã',
    afternoon: 'tarde',
    night: 'noite'
};

export interface Preferences {
    completedCodes?: readonly string[];
    /** dias (1 = segunda ... 6 = sábado) em que o aluno não pode ir ao campus: nenhuma aula neles */
    blockedWeekdays: number[];
    /** horários indisponíveis: nenhuma aula pode tocar neles */
    blockedTimes: ClassTime[];
    avoidShifts: Shift[];
    maxHours: number | null;
    weights: {
        fewerDays: Weight;
        fewerGaps: Weight;
        avoidShifts: Weight;
        balance: Weight;
        /** quantas matérias opcionais entram (avanço no fluxo) */
        progress: Weight;
    };
    /** matérias que tornam a grade melhor quando entram (ex.: críticas para o fluxo) */
    priority: string[];
}

export const DEFAULT_PREFERENCES: Preferences = {
    blockedWeekdays: [],
    blockedTimes: [],
    avoidShifts: [],
    maxHours: null,
    weights: { fewerDays: 2, fewerGaps: 2, avoidShifts: 2, balance: 1, progress: 3 },
    priority: []
};

export interface Subject {
    code: string;
    name: string;
    /** obrigatória: toda grade sugerida a contém */
    required: boolean;
    options: PlannedClass[];
}

export interface Suggestion {
    items: PlannedClass[];
    score: number;
    metrics: Metrics;
    /** frases curtas para o aluno entender por que esta grade subiu */
    reasons: string[];
    /** matérias opcionais que ficaram de fora, com o motivo */
    left: { code: string; name: string; reason: string }[];
}

export interface Metrics {
    days: number;
    gapMinutes: number;
    shiftMinutes: Record<Shift, number>;
    /** desvio-padrão dos minutos por dia com aula (menor = mais equilibrado) */
    imbalance: number;
    hours: number;
}

export interface Result {
    suggestions: Suggestion[];
    /** a busca parou no limite de trabalho: pode haver grades melhores */
    truncated: boolean;
    /** matérias obrigatórias sem nenhuma turma possível, e por quê */
    impossible: { code: string; name: string; reason: string }[];
}

const toMinutes = (time: string) => {
    const [hours = 0, minutes = 0] = time.split(':').map(Number);
    return hours * 60 + minutes;
};

const shiftOf = (start: string): Shift => {
    const minutes = toMinutes(start);
    return minutes < 12 * 60 ? 'morning' : minutes < 18 * 60 ? 'afternoon' : 'night';
};

// `parseSchedule` usa regex: o backtracking chama milhares de vezes, então guarda por código de horário
const parsed = new Map<string, ClassTime[]>();
const classTimes = (item: PlannedClass) => {
    const key = item.schedule ?? '';
    let times = parsed.get(key);
    if (!times) {
        times = parseSchedule(key);
        parsed.set(key, times);
    }
    return times;
};

export function metricsOf(items: PlannedClass[]): Metrics {
    const times = items.flatMap(classTimes);
    const byDay = new Map<number, ClassTime[]>();
    for (const time of times) byDay.set(time.weekday, [...(byDay.get(time.weekday) ?? []), time]);
    let gapMinutes = 0;
    const perDay: number[] = [];
    for (const day of byDay.values()) {
        const sorted = day.toSorted((a, b) => toMinutes(a.start) - toMinutes(b.start));
        let end = toMinutes(sorted[0].end);
        let total = toMinutes(sorted[0].end) - toMinutes(sorted[0].start);
        for (const time of sorted.slice(1)) {
            gapMinutes += Math.max(0, toMinutes(time.start) - end);
            end = Math.max(end, toMinutes(time.end));
            total += toMinutes(time.end) - toMinutes(time.start);
        }
        perDay.push(total);
    }
    const mean = perDay.reduce((a, b) => a + b, 0) / (perDay.length || 1);
    const variance =
        perDay.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (perDay.length || 1);
    const shiftMinutes: Record<Shift, number> = { morning: 0, afternoon: 0, night: 0 };
    for (const time of times)
        shiftMinutes[shiftOf(time.start)] += toMinutes(time.end) - toMinutes(time.start);
    return {
        days: byDay.size,
        gapMinutes,
        shiftMinutes,
        imbalance: Math.sqrt(variance),
        hours: items.reduce((total, item) => total + (item.hours ?? 0), 0)
    };
}

/** Por que a turma não pode entrar de jeito nenhum (independente das outras), ou `null`. */
export function blockedReason(item: PlannedClass, prefs: Preferences): string | null {
    if (!requirementsMet(item.prerequisites, new Set(prefs.completedCodes)))
        return 'pré-requisitos ainda não confirmados';
    const times = classTimes(item);
    const day = times.find((time) => prefs.blockedWeekdays.includes(time.weekday));
    if (day) return `tem aula em um dia bloqueado`;
    if (times.some((time) => prefs.blockedTimes.some((blocked) => overlaps(time, blocked))))
        return 'bate com um horário indisponível';
    if (prefs.maxHours != null && (item.hours ?? 0) > prefs.maxHours)
        return 'passa da carga horária máxima sozinha';
    return null;
}

function requirementsMet(groups: PlannedClass['prerequisites'], codes: ReadonlySet<string>) {
    return (
        !groups?.length ||
        groups.some((group) => group.length > 0 && group.every((item) => codes.has(item.code)))
    );
}

const conflicts = (a: PlannedClass, b: PlannedClass) =>
    classTimes(a).some((x) => classTimes(b).some((y) => overlaps(x, y)));

const score = (items: PlannedClass[], subjects: Subject[], prefs: Preferences): number => {
    const m = metricsOf(items);
    const w = prefs.weights;
    const shiftPenalty = prefs.avoidShifts.reduce((sum, shift) => sum + m.shiftMinutes[shift], 0);
    const optional = items.filter((item) =>
        subjects.some((subject) => subject.code === item.code && !subject.required)
    ).length;
    const priority = items.filter((item) => prefs.priority.includes(item.code)).length;
    return (
        // cada matéria opcional e cada prioritária valem mais que qualquer conforto de horário
        (w.progress * 1000 + 500) * optional +
        w.progress * 600 * priority -
        w.fewerDays * 120 * m.days -
        (w.fewerGaps * m.gapMinutes) / 2 -
        (w.avoidShifts * shiftPenalty) / 3 -
        w.balance * m.imbalance
    );
};

export const MAX_NODES = 150_000;
/** Teto de tempo da busca: o celular não pode travar esperando a melhor de todas as grades. */
export const MAX_MILLISECONDS = 600;

/**
 * Procura grades por backtracking (matérias com menos opções primeiro, para podar cedo) e devolve
 * as `limit` melhores. O trabalho tem teto: passou dele, `truncated` avisa.
 */
export function suggestSchedules(
    subjects: Subject[],
    prefs: Preferences = DEFAULT_PREFERENCES,
    limit = 3,
    maxNodes = MAX_NODES,
    maxMilliseconds = MAX_MILLISECONDS
): Result {
    const impossible: Result['impossible'] = [];
    const usable = subjects.map((subject) => ({
        ...subject,
        options: subject.options.filter((option) => blockedReason(option, prefs) === null)
    }));
    for (const subject of usable) {
        if (subject.required && subject.options.length === 0) {
            const original = subjects.find((entry) => entry.code === subject.code);
            const reason = original?.options
                .map((option) => blockedReason(option, prefs))
                .find(Boolean);
            impossible.push({
                code: subject.code,
                name: subject.name,
                reason: reason ? `nenhuma turma serve: ${reason}` : 'nenhuma turma foi escolhida'
            });
        }
    }
    if (impossible.length) return { suggestions: [], truncated: false, impossible };

    const ordered = usable
        .filter((subject) => subject.options.length > 0)
        .toSorted(
            (a, b) =>
                Number(b.required) - Number(a.required) ||
                a.options.length - b.options.length ||
                a.code.localeCompare(b.code)
        );
    const best: { items: PlannedClass[]; score: number; key: string }[] = [];
    let nodes = 0;
    let truncated = false;
    const deadline = performance.now() + maxMilliseconds;
    const seen = new Set<string>();

    const record = (items: PlannedClass[]) => {
        const concurrent = new Set([
            ...(prefs.completedCodes ?? []),
            ...items.map((item) => item.code)
        ]);
        if (items.some((item) => !requirementsMet(item.corequisites, concurrent))) return;
        const key = items
            .map((item) => `${item.code}-${item.number}`)
            .toSorted()
            .join('|');
        if (seen.has(key)) return;
        seen.add(key);
        best.push({ items, score: score(items, subjects, prefs), key });
        best.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
        if (best.length > limit * 4) best.length = limit * 4;
    };

    const search = (index: number, chosen: PlannedClass[], hours: number) => {
        if (nodes >= maxNodes || (nodes % 256 === 0 && performance.now() > deadline)) {
            truncated = true;
            nodes = maxNodes;
            return;
        }
        nodes++;
        if (index === ordered.length) {
            record(chosen);
            return;
        }
        const subject = ordered[index];
        for (const option of subject.options) {
            if (prefs.maxHours != null && hours + (option.hours ?? 0) > prefs.maxHours) continue;
            if (chosen.some((entry) => conflicts(entry, option))) continue;
            search(index + 1, [...chosen, option], hours + (option.hours ?? 0));
        }
        // opcional pode ficar de fora; obrigatória nunca
        if (!subject.required) search(index + 1, chosen, hours);
    };
    search(0, [], 0);

    // sem grade que contenha todas as obrigatórias: diz qual par se atrapalha
    if (best.length === 0) {
        const required = ordered.filter((subject) => subject.required);
        for (const a of required)
            for (const b of required)
                if (
                    a.code < b.code &&
                    a.options.every((x) => b.options.every((y) => conflicts(x, y)))
                )
                    impossible.push({
                        code: a.code,
                        name: a.name,
                        reason: `todas as turmas batem com as de ${b.name} (${b.code})`
                    });
        return { suggestions: [], truncated, impossible };
    }

    const suggestions = best.slice(0, limit).map(({ items, score: value }): Suggestion => {
        const metrics = metricsOf(items);
        const reasons = [
            `${metrics.days} ${metrics.days === 1 ? 'dia' : 'dias'} no campus`,
            metrics.gapMinutes === 0
                ? 'sem janelas entre as aulas'
                : `${Math.round(metrics.gapMinutes / 60)}h de janelas no total`
        ];
        if (prefs.avoidShifts.length) {
            const avoided = prefs.avoidShifts.reduce(
                (s, shift) => s + metrics.shiftMinutes[shift],
                0
            );
            reasons.push(
                avoided === 0
                    ? `nenhuma aula de ${prefs.avoidShifts.map((s) => SHIFT_LABELS[s]).join(' ou ')}`
                    : `${Math.round(avoided / 60)}h em turno que você prefere evitar`
            );
        }
        if (prefs.blockedWeekdays.length || prefs.blockedTimes.length)
            reasons.push('respeita seus dias e horários bloqueados');
        const left = subjects
            .filter((subject) => !subject.required && !items.some((i) => i.code === subject.code))
            .map((subject) => ({
                code: subject.code,
                name: subject.name,
                reason: leftReason(subject, items, prefs)
            }));
        return { items, score: value, metrics, reasons, left };
    });
    return { suggestions, truncated, impossible: [] };
}

function leftReason(subject: Subject, chosen: PlannedClass[], prefs: Preferences): string {
    const usable = subject.options.filter((option) => blockedReason(option, prefs) === null);
    if (usable.length === 0) return 'nenhuma turma serve nos seus dias e horários';
    for (const option of usable) {
        const clash = chosen.find((item) => conflicts(item, option));
        if (!clash)
            return 'deixaria a grade pior nas suas preferências ou passaria da carga máxima';
    }
    const first = chosen.find((item) => conflicts(item, usable[0]));
    return first ? `todas as turmas batem com ${first.name}` : 'não coube';
}

/** Agrupa as turmas das grades do aluno por matéria, para virarem opções do otimizador. */
export function subjectsFromPlans(items: PlannedClass[], optionalCodes: Set<string>): Subject[] {
    const byCode = new Map<string, Subject>();
    for (const item of items) {
        const subject = byCode.get(item.code) ?? {
            code: item.code,
            name: item.name,
            required: !optionalCodes.has(item.code),
            options: []
        };
        if (!subject.options.some((option) => option.number === item.number))
            subject.options.push(item);
        byCode.set(item.code, subject);
    }
    return [...byCode.values()].toSorted((a, b) => a.code.localeCompare(b.code));
}
