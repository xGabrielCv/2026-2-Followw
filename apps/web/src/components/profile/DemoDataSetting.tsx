import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { api } from '#/queries/api';
import { apiClient } from '#/queries/client';

const status = api.queryOptions('get', '/demo', {}, { retry: false, staleTime: 60_000 });

/**
 * Só aparece com a API em modo de teste (`DEMO_DATA`, ligado pelo run.ps1): carrega grupos,
 * avaliações e índices fictícios das turmas do aluno e apaga quando quiser.
 */
export function DemoDataSetting() {
    const queryClient = useQueryClient();
    const demo = useQuery(status);
    const change = useMutation({
        mutationFn: async (load: boolean) => {
            const { error } = load
                ? await apiClient.POST('/demo')
                : await apiClient.DELETE('/demo');
            if (error) throw new Error('Não foi possível mudar os dados de demonstração');
        },
        // grupos, notas e índices mudam em todo o app
        onSettled: () => queryClient.invalidateQueries()
    });

    if (!demo.data) return null;
    const { loaded, groups, reviews, classrooms, materials, posts, tutorials } = demo.data;
    return (
        <div className="flex flex-col gap-2 py-2.5">
            <div className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                    <FlaskConical className="size-4" aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium">Dados de demonstração</span>
                    <span className="text-xs text-muted-foreground">
                        {loaded
                            ? `${groups} grupos, ${reviews} avaliações, ${classrooms} turmas com índices, ${materials ?? 0} materiais, ${posts ?? 0} conversas e ${tutorials ?? 0} guias fictícios.`
                            : 'Só para testar: grupos, avaliações, índices, materiais, conversas e guias fictícios das suas turmas.'}
                    </span>
                </div>
            </div>
            <div className="flex gap-2">
                <Button
                    size="sm"
                    variant={loaded ? 'outline' : 'default'}
                    disabled={change.isPending}
                    onClick={() => change.mutate(true)}
                >
                    {loaded ? 'Recarregar' : 'Carregar dados de teste'}
                </Button>
                {loaded && (
                    <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        disabled={change.isPending}
                        onClick={() => change.mutate(false)}
                    >
                        Apagar
                    </Button>
                )}
            </div>
            {change.isError && (
                <p role="alert" className="text-xs text-destructive">
                    Não foi possível. Tente novamente.
                </p>
            )}
            <p className="text-xs text-muted-foreground">
                Some quando o Followw for publicado; os dados reais não são tocados.
            </p>
        </div>
    );
}
