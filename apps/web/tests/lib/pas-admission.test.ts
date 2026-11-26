import { describe, expect, test } from 'bun:test';

import {
    findPasAdmission,
    formatPasScore,
    getPasHistory,
    loadPasSources,
    resolvePasCampus
} from '#/lib/pas-admission';

describe('notas de corte do PAS (Cebraspe)', () => {
    test('resolve campus corretamente a partir do código ou nome da unidade', () => {
        expect(resolvePasCampus('FCTE', 'Faculdade de Ciências e Tecnologias em Engenharia')).toBe(
            'FCTE'
        );
        expect(resolvePasCampus('FGA', 'Campus Gama')).toBe('FCTE');
        expect(resolvePasCampus('FCE', 'Faculdade de Ceilândia')).toBe('FCE');
        expect(resolvePasCampus('FUP', 'Faculdade UnB Planaltina')).toBe('FUP');
        expect(resolvePasCampus('CIC', 'Departamento de Ciência da Computação')).toBe(
            'Darcy Ribeiro'
        );
    });

    test('encontra nota de corte de Engenharia de Software (ingresso conjunto FCTE) e Ciência da Computação', async () => {
        const sources = await loadPasSources();
        expect(sources).toHaveLength(6);

        const software = findPasAdmission(
            {
                name: 'ENGENHARIA DE SOFTWARE',
                shift: 'Diurno',
                degree: 'Bacharelado',
                unitCode: 'FCTE'
            },
            sources[0]
        );
        expect(software).toBeDefined();
        expect(software?.campus).toBe('FCTE');
        expect(software?.ingressoConjunto).toBe(true);

        const ccHistory = getPasHistory(
            {
                name: 'CIÊNCIA DA COMPUTAÇÃO',
                shift: 'Diurno',
                degree: 'Bacharelado',
                unitCode: 'IE'
            },
            sources
        );
        expect(ccHistory).toHaveLength(6);
        expect(ccHistory.filter((item) => item.admission !== undefined).length).toBeGreaterThan(0);
    });

    test('omite cursos EAD e formata notas negativas e ausentes corretamente', async () => {
        const sources = await loadPasSources();
        expect(
            findPasAdmission(
                {
                    name: 'ADMINISTRAÇÃO',
                    shift: 'Diurno',
                    degree: 'Bacharelado',
                    modality: 'A distância',
                    unitCode: 'FACE'
                },
                sources[0]
            )
        ).toBeUndefined();
        expect(formatPasScore('-12.345')).toBe('-12,345');
        expect(formatPasScore(null)).toBe('Não informado');
    });
});
