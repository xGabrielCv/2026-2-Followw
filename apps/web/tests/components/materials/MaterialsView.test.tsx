import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, test } from 'bun:test';

import type { MaterialItem, SubjectMaterials } from '#/queries/community';

import { MaterialsView, originLabel } from '#/components/materials/SubjectMaterialsPanel';
import { fileProblem, formatBytes, materialSemesters } from '#/lib/materials';

import { useDom } from '../../helpers/dom';

const dom = useDom();
afterEach(() => dom.testing.cleanup());

const item = (patch: Partial<MaterialItem>): MaterialItem => ({
    id: crypto.randomUUID(),
    title: 'Prova 1',
    kind: 'prova',
    semester: '2026.2',
    classroom_number: '02',
    professors: ['MAURICIO SERRANO'],
    filename: 'prova.pdf',
    mime: 'application/pdf',
    size: 2 * 1024 * 1024,
    month: '2026-11',
    mine: false,
    ...patch
});

const data = (
    items: MaterialItem[],
    usage?: Partial<SubjectMaterials['usage']>
): SubjectMaterials => ({
    subject: { code: 'FGA0030', name: 'ESTRUTURAS DE DADOS 2' },
    oldest_semester: '2024.1',
    limits: {
        max_file_bytes: 20 * 1024 * 1024,
        max_daily_upload_attempts: 10,
        max_per_subject: 50,
        max_subject_bytes: 100 * 1024 * 1024,
        keep_semesters: 6
    },
    usage: { files: items.length, bytes: 0, mine: 0, ...usage },
    items
});

const classroom = { semester: '2026.2', number: '02', professors: ['Maurício Serrano'] };

function render(value: SubjectMaterials) {
    return dom.testing.render(
        <QueryClientProvider client={new QueryClient()}>
            <MaterialsView data={value} code="FGA0030" classroom={classroom} onUpload={() => {}} />
        </QueryClientProvider>
    );
}

describe('material da matéria', () => {
    test('agrupa por semestre, marca o próprio envio e avisa quando é de outro docente', () => {
        const page = render(
            data([
                item({ title: 'P1 resolvida', mine: true }),
                item({
                    title: 'Lista do Glauco',
                    professors: ['GLAUCO PEDROSA'],
                    classroom_number: '01'
                }),
                item({
                    title: 'Resumo antigo',
                    semester: '2025.2',
                    classroom_number: null,
                    professors: []
                })
            ])
        );
        const headings = page.getAllByRole('heading', { level: 4 }).map((node) => node.textContent);
        expect(headings).toEqual(['2026.2', '2025.2']);
        expect(page.getByText('Seu envio')).toBeDefined();
        expect(page.getByText('Outro docente: Turma 01 · Glauco Pedrosa')).toBeDefined();
        expect(page.getByText('Turma não informada')).toBeDefined();
        // só quem enviou apaga; os outros podem denunciar
        expect(page.getByRole('button', { name: 'Apagar P1 resolvida' })).toBeDefined();
        expect(page.getAllByRole('button', { name: /Denunciar ou pedir exclusão/ })).toHaveLength(
            2
        );
    });

    test('sem material mostra estado vazio; no limite, o envio fica desligado', () => {
        expect(render(data([])).getByText(/Ninguém compartilhou material/)).toBeDefined();
        dom.testing.cleanup();
        const full = render(data([item({})], { files: 50 }));
        expect(full.getByRole('button', { name: 'Enviar' }).hasAttribute('disabled')).toBe(true);
        expect(full.getByText(/chegou ao limite de arquivos ou de espaço/)).toBeDefined();
    });

    test('visitante abre e baixa material sem envio nem exclusão mesmo com autoria no cache', () => {
        const page = dom.testing.render(
            <QueryClientProvider client={new QueryClient()}>
                <MaterialsView data={data([item({ mine: true })])} code="FGA0030" />
            </QueryClientProvider>
        );
        expect(page.getByRole('button', { name: 'Abrir' })).toBeDefined();
        expect(page.getByRole('button', { name: /Baixar/ })).toBeDefined();
        expect(page.queryByRole('button', { name: 'Enviar' })).toBeNull();
        expect(page.queryByRole('button', { name: /Apagar/ })).toBeNull();
        expect(page.queryByText('Seus envios')).toBeNull();
    });

    test('origem do material pelo docente, ignorando acento', () => {
        expect(originLabel(item({}), classroom)).toEqual({
            text: 'Turma 02 · Mauricio Serrano',
            other: false
        });
        expect(originLabel(item({ professors: ['ANA'] }), classroom).other).toBe(true);
        expect(originLabel(item({ professors: ['ANA'] })).other).toBe(false);
    });

    test('semestres aceitos, tamanho e tipo do arquivo', () => {
        expect(materialSemesters('2024.1', '2026-11-08')).toEqual([
            '2027.1',
            '2026.2',
            '2026.1',
            '2025.2',
            '2025.1',
            '2024.2',
            '2024.1'
        ]);
        expect(formatBytes(1536)).toBe('2 KB');
        expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
        const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
        const exe = new File(['MZ'], 'a.exe', { type: 'application/x-msdownload' });
        expect(fileProblem(pdf, 100)).toBeNull();
        expect(fileProblem(pdf, 2)).toContain('passa de');
        expect(fileProblem(exe, 100)).toContain('PDF, imagem');
        const docx = new File(['PK'], 'a.docx', {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
        const txt = new File(['oi'], 'a.txt', { type: 'text/plain' });
        const semTipo = new File(['PK'], 'planilha.xlsx', { type: '' });
        const exeSemTipo = new File(['MZ'], 'a.exe', { type: '' });
        for (const file of [docx, txt, semTipo]) expect(fileProblem(file, 100)).toBeNull();
        expect(fileProblem(exeSemTipo, 100)).toContain('Envie');
    });
});
