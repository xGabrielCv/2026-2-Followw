import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BriefcaseBusiness } from 'lucide-react';

import { QueryState } from '#/components/QueryState';
import { filterInternships } from '#/lib/internships';
import { formatStipend, internshipsQueryOptions } from '#/queries/internships';
import { meQueryOptions } from '#/queries/me';

/** Reutiliza o mural privado e seu cache; nunca consulta estágios para visitantes. */
export function InternshipSection({ text }: { text: string }) {
    const { data: user } = useQuery(meQueryOptions);
    const query = useQuery({ ...internshipsQueryOptions, enabled: Boolean(user) });
    return (
        <section className="flex flex-col gap-3" aria-label="Estágios">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
                <BriefcaseBusiness className="size-4 text-primary" aria-hidden="true" />
                Estágios
            </h2>
            {!user ? (
                <p className="text-sm text-muted-foreground">
                    <Link to="/login" className="font-semibold text-primary">
                        Entre com o SIGAA
                    </Link>{' '}
                    para consultar o mural de estágios.
                </p>
            ) : (
                <QueryState
                    query={query}
                    loading="Buscando estágios..."
                    error="Não foi possível ler o mural."
                    stale="Não foi possível atualizar o mural. Exibindo as vagas salvas."
                >
                    {(data) => {
                        const items = filterInternships(data, {
                            q: text,
                            scope: 'all',
                            order: 'closing',
                            bolsa: false
                        });
                        return (
                            <>
                                {items.length ? (
                                    items.slice(0, 3).map((item) => (
                                        <Link
                                            key={item.reference}
                                            to="/estagios"
                                            search={{ q: text, scope: 'all' }}
                                            className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3"
                                        >
                                            <span className="text-sm font-semibold">
                                                {item.title}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {formatStipend(item.stipend)} ·{' '}
                                                {item.mine ? 'Do seu curso' : 'Outros cursos'}
                                            </span>
                                        </Link>
                                    ))
                                ) : (
                                    <p className="text-sm text-muted-foreground">
                                        Nenhum estágio em aberto para esta busca.
                                    </p>
                                )}
                                <Link
                                    to="/estagios"
                                    search={{ q: text, scope: 'all' }}
                                    className="text-sm font-semibold text-primary"
                                >
                                    Abrir mural e filtros de estágios
                                </Link>
                            </>
                        );
                    }}
                </QueryState>
            )}
        </section>
    );
}
