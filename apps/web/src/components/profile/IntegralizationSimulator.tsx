import { useState } from 'react';

import type { Category, Outcome, Scenario } from '#/lib/integralization-simulation';
import type { Classroom } from '#/queries/classrooms';
import type { UserProfile } from '#/queries/me';

import { Button } from '#/components/ui/button';
import { Card } from '#/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '#/components/ui/select';
import { integralizationSubjects, simulateIntegralization } from '#/lib/integralization-simulation';
import { nextRegularSemester } from '#/lib/offer';
import { titleCase } from '#/lib/profile';

const outcomes: Record<Outcome, string> = {
    pending: 'Sem resultado simulado',
    approved: 'Aprovado',
    failed: 'Reprovado',
    withdrawn: 'Trancado'
};
const categories: Record<Category, string> = {
    mandatory: 'Obrigatória',
    optional: 'Optativa',
    complementary: 'Complementar',
    free: 'Módulo livre',
    unknown: 'Categoria não informada'
};
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function IntegralizationSimulator({
    user,
    classrooms,
    semester,
    onBack
}: {
    user: UserProfile;
    classrooms: Classroom[];
    semester: string;
    onBack: () => void;
}) {
    const [scenario, setScenario] = useState<Scenario>({});
    const items = integralizationSubjects(classrooms, semester);
    const choice = (item: Classroom) =>
        scenario[item.subject.code] ?? {
            outcome: 'pending' as const,
            category: item.subject.kind ?? 'unknown'
        };
    const result = simulateIntegralization(
        user,
        items,
        Object.fromEntries(items.map((item) => [item.subject.code, choice(item)]))
    );
    return (
        <div className="my-4 flex flex-col gap-4">
            <Button variant="ghost" className="self-start" onClick={onBack}>
                Voltar ao simulador de IRA e MP
            </Button>
            <h2 className="text-lg font-semibold">Calcular integralização futura</h2>
            <p className="text-sm text-muted-foreground">
                Simule os resultados de {semester} para o início de {nextRegularSemester(semester)}.
                A projeção usa sua carga total e as pendências por categoria do SIGAA, para qualquer
                curso.
            </p>
            <Card className="gap-3 px-4">
                {result ? (
                    <div aria-live="polite">
                        <dl className="grid grid-cols-2 gap-4">
                            <div>
                                <dt className="text-muted-foreground">Integralização atual</dt>
                                <dd className="text-2xl font-semibold text-info">
                                    {percent.format(result.current)}%
                                </dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">Integralização futura</dt>
                                <dd className="text-2xl font-semibold text-success">
                                    {percent.format(result.future)}%
                                </dd>
                            </div>
                        </dl>
                        <p className="mt-3 text-sm">
                            {result.added}h adicionais aproveitáveis de {result.total}h exigidas.
                        </p>
                        {result.uncertain.length > 0 && (
                            <output className="mt-2 text-sm text-warning">
                                Sem carga ou categoria confirmada: {result.uncertain.join('; ')}.
                                Essas disciplinas não entraram no cálculo.
                            </output>
                        )}
                    </div>
                ) : (
                    <output>
                        O SIGAA não informou uma carga total e pendências válidas para calcular esta
                        projeção.
                    </output>
                )}
                <p className="text-xs text-muted-foreground">
                    Estimativa, não atualização oficial. Reprovação, trancamento e resultado
                    indefinido não acrescentam horas. Horas são limitadas às pendências de cada
                    categoria; módulo livre não é somado. Confira equivalências e aproveitamentos no
                    SIGAA.
                </p>
            </Card>
            <section
                aria-label="Resultados simulados para integralização"
                className="flex flex-col gap-3"
            >
                <h3 className="text-sm font-semibold">Semestre atual · {semester}</h3>
                {items.length === 0 && (
                    <p className="text-muted-foreground">
                        Nenhuma disciplina em curso neste semestre.
                    </p>
                )}
                {items.map((item) => {
                    const current = choice(item);
                    const update = (patch: Partial<Scenario[string]>) =>
                        setScenario({ ...scenario, [item.subject.code]: { ...current, ...patch } });
                    const name = titleCase(item.subject.name);
                    return (
                        <Card key={item.subject.code} className="gap-3 px-4">
                            <div>
                                <h4 className="font-medium">{name}</h4>
                                <p className="text-xs text-muted-foreground">
                                    {item.subject.code} ·{' '}
                                    {item.subject.hours == null
                                        ? 'Carga não informada'
                                        : `${item.subject.hours}h`}
                                </p>
                            </div>
                            <div className="grid grid-cols-1 gap-3 desk:grid-cols-2">
                                <div className="flex flex-col gap-1">
                                    <label htmlFor={`outcome-${item.subject.code}`}>
                                        Resultado
                                    </label>
                                    <Select
                                        value={current.outcome}
                                        items={outcomes}
                                        onValueChange={(value) => {
                                            if (value) update({ outcome: value });
                                        }}
                                    >
                                        <SelectTrigger
                                            id={`outcome-${item.subject.code}`}
                                            className="w-full"
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(outcomes).map(([value, label]) => (
                                                <SelectItem key={value} value={value}>
                                                    {label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label htmlFor={`category-${item.subject.code}`}>
                                        Categoria para a simulação
                                    </label>
                                    <Select
                                        value={current.category}
                                        items={categories}
                                        onValueChange={(value) => {
                                            if (value) update({ category: value });
                                        }}
                                    >
                                        <SelectTrigger
                                            id={`category-${item.subject.code}`}
                                            className="w-full"
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(categories).map(([value, label]) => (
                                                <SelectItem key={value} value={value}>
                                                    {label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </section>
            <Button variant="outline" className="self-start" onClick={() => setScenario({})}>
                Limpar simulação de integralização
            </Button>
            <p className="text-xs text-muted-foreground">
                Esta simulação vive só nesta tela e é descartada ao sair. Não altera suas menções de
                IRA/MP, seu histórico ou os dados no servidor.
            </p>
        </div>
    );
}
