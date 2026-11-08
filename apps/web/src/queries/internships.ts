import type { components } from '#/queries/schema.gen';

import { api } from '#/queries/api';

export type InternshipItem = components['schemas']['InternshipItem'];
export type Internship = components['schemas']['Internship'];

// O mural vem do SIGAA na hora: o navegador guarda e relê depois de um tempo.
export const internshipsQueryOptions = api.queryOptions(
    'get',
    '/internships',
    {},
    { staleTime: 60 * 60_000 }
);

export const internshipQueryOptions = (reference: string) =>
    api.queryOptions(
        'get',
        '/internships/{reference}',
        { params: { path: { reference } } },
        { staleTime: 60 * 60_000, retry: false }
    );

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatStipend = (value: string | null | undefined) =>
    value == null ? 'Sem bolsa informada' : money.format(Number(value));
