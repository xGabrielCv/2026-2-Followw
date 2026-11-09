import { useId, useState, type ReactNode } from 'react';

import type { MaterialItem } from '#/queries/community';

import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { MATERIAL_KIND_LABELS } from '#/lib/materials';
import { nameKey } from '#/queries/outcomes';

const PAGE_SIZE = 10;

export function FilteredMaterials({
    items,
    children
}: {
    items: MaterialItem[];
    children: (page: MaterialItem[]) => ReactNode;
}) {
    const id = useId();
    const [search, setSearch] = useState('');
    const [kind, setKind] = useState('');
    const [semester, setSemester] = useState('');
    const [order, setOrder] = useState('recent');
    const [page, setPage] = useState(1);
    const needle = nameKey(search.trim());
    const matching = items
        .filter(
            (item) =>
                (!kind || kind === item.kind) &&
                (!semester || item.semester === semester) &&
                (!needle ||
                    nameKey([item.title, item.filename, ...item.professors].join(' ')).includes(
                        needle
                    ))
        )
        .toSorted((a, b) =>
            order === 'title'
                ? a.title.localeCompare(b.title, 'pt-BR')
                : b.semester.localeCompare(a.semester) || b.month.localeCompare(a.month)
        );
    const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
    const current = Math.min(page, pages);
    const reset = () => {
        setSearch('');
        setKind('');
        setSemester('');
        setOrder('recent');
        setPage(1);
    };
    return (
        <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
                <label
                    htmlFor={`${id}-search`}
                    className="flex min-w-0 grow flex-col gap-1 text-xs"
                >
                    Buscar material
                    <Input
                        id={`${id}-search`}
                        type="search"
                        maxLength={80}
                        placeholder="Título, arquivo ou docente"
                        value={search}
                        onChange={(event) => {
                            setSearch(event.target.value);
                            setPage(1);
                        }}
                    />
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-xs">
                    Categoria
                    <select
                        className="max-w-full rounded-lg border bg-background p-2"
                        value={kind}
                        onChange={(event) => {
                            setKind(event.target.value);
                            setPage(1);
                        }}
                    >
                        <option value="">Todas</option>
                        {Object.entries(MATERIAL_KIND_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-xs">
                    Semestre
                    <select
                        className="max-w-full rounded-lg border bg-background p-2"
                        value={semester}
                        onChange={(event) => {
                            setSemester(event.target.value);
                            setPage(1);
                        }}
                    >
                        <option value="">Todos</option>
                        {[...new Set(items.map((item) => item.semester))].map((value) => (
                            <option key={value} value={value}>
                                {value}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-xs">
                    Ordem
                    <select
                        className="max-w-full rounded-lg border bg-background p-2"
                        value={order}
                        onChange={(event) => {
                            setOrder(event.target.value);
                            setPage(1);
                        }}
                    >
                        <option value="recent">Mais recentes</option>
                        <option value="title">Título</option>
                    </select>
                </label>
                <Button variant="ghost" size="sm" onClick={reset}>
                    Limpar filtros
                </Button>
            </div>
            {matching.length ? (
                children(matching.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE))
            ) : (
                <output className="rounded-2xl bg-card p-4 text-sm text-muted-foreground">
                    Nenhum material corresponde aos filtros.
                </output>
            )}
            {pages > 1 && (
                <div className="flex items-center justify-between gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={current <= 1}
                        onClick={() => setPage(current - 1)}
                    >
                        Anterior
                    </Button>
                    <output className="text-xs text-muted-foreground">
                        {current} / {pages} · {matching.length} materiais
                    </output>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={current >= pages}
                        onClick={() => setPage(current + 1)}
                    >
                        Próxima
                    </Button>
                </div>
            )}
        </div>
    );
}
