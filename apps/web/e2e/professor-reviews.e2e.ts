import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { login, ready } from './helpers/student';

// Docente já semeado por apps/api/loadtest/fixtures.py na instância E2E descartável.
const professorPath = '/professores/1000001';

async function openProfessor(page: Page) {
    await page.goto(professorPath);
    await ready(page);
    await expect(
        page.getByRole('heading', { name: 'Docente Sintético', exact: true })
    ).toBeVisible();
}

async function readReviews(page: Page, comment: string, rating: number) {
    await page.getByRole('button', { name: 'Ver avaliações completas', exact: true }).click();
    const dialog = page.getByRole('dialog', {
        name: 'Avaliações de Docente Sintético',
        exact: true
    });
    const review = dialog.getByRole('listitem').filter({ hasText: comment });
    await expect(review).toHaveCount(1);
    await expect(review.getByText(comment, { exact: true })).toBeVisible();
    await expect(review.getByText(`Nota ${rating}`, { exact: true })).toBeVisible();
    return dialog;
}

test('aluno avalia e edita professor; visitante lê e outro aluno não edita avaliação alheia', async ({
    page,
    browser,
    baseURL,
    request
}) => {
    const marker = randomUUID();
    const original = `Avaliação sintética de didática ${marker}.`;
    const edited = `Avaliação sintética revisada de organização ${marker}.`;
    let reviewId = '';

    await test.step('aluno sintético publica avaliação pela interface', async () => {
        await login(page);
        await openProfessor(page);
        await page.getByRole('button', { name: 'Avaliar', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Avaliar professor', exact: true });
        const rating = dialog.getByRole('slider', {
            name: 'Nota de Docente Sintético',
            exact: true
        });
        await rating.focus();
        await rating.press('End');
        await expect(rating).toHaveValue('100');
        await dialog
            .getByRole('group', { name: 'Cobra chamada', exact: true })
            .getByRole('button', { name: 'Cobra', exact: true })
            .click();
        await dialog.getByLabel('Comentário (opcional)', { exact: true }).fill(original);
        await dialog
            .getByLabel('Semestre da experiência (opcional)', { exact: true })
            .fill('2026.2');
        await dialog
            .getByRole('spinbutton', { name: 'Clareza das explicações', exact: true })
            .fill('5');
        const created = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === '/api/reviews' &&
                response.request().method() === 'POST'
        );
        await dialog.getByRole('button', { name: 'Enviar avaliação', exact: true }).click();
        const response = await created;
        expect(response.status()).toBe(201);
        const headers = await response.request().allHeaders();
        expect(headers.cookie).toBeUndefined();
        expect(headers['x-followw-permit']).toBeTruthy();
        reviewId = (await response.json()).review.id;
        expect(reviewId).toBeTruthy();
        await expect(dialog).not.toBeVisible();
        const reading = await readReviews(page, original, 100);
        const review = reading.getByRole('listitem').filter({ hasText: original });
        await expect(review.getByText('Chamada: Cobra', { exact: true })).toBeVisible();
        await expect(review.getByText('Clareza: 5/5', { exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(reading).not.toBeVisible();
    });

    await test.step('autor recarrega e atualiza a mesma avaliação pela interface', async () => {
        await page.reload();
        await ready(page);
        await page.getByRole('button', { name: 'Avaliar', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Avaliar professor', exact: true });
        await expect(dialog.getByText(/Você já avaliou/)).toBeVisible();
        await expect(dialog.getByLabel('Comentário (opcional)', { exact: true })).toHaveValue(
            original
        );
        const rating = dialog.getByRole('slider', {
            name: 'Nota de Docente Sintético',
            exact: true
        });
        await expect(rating).toHaveValue('100');
        await rating.focus();
        await rating.press('ArrowLeft');
        await expect(rating).toHaveValue('99');
        await dialog.getByLabel('Comentário (opcional)', { exact: true }).fill(edited);
        const updated = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/api/reviews/${reviewId}` &&
                response.request().method() === 'PUT'
        );
        await dialog.getByRole('button', { name: 'Atualizar avaliação', exact: true }).click();
        const response = await updated;
        expect(response.status()).toBe(200);
        expect((await response.json()).id).toBe(reviewId);
        expect((await response.request().allHeaders()).cookie).toBeUndefined();
        await expect(dialog).not.toBeVisible();
        const reading = await readReviews(page, edited, 99);
        await expect(reading.getByText(original, { exact: true })).toHaveCount(0);
    });

    await test.step('visitante em contexto limpo lê sem controles de edição', async () => {
        const visitor = await browser.newContext({
            baseURL,
            storageState: { cookies: [], origins: [] }
        });
        try {
            const publicPage = await visitor.newPage();
            await openProfessor(publicPage);
            await expect(
                publicPage.getByRole('link', { name: 'Entre para avaliar', exact: true })
            ).toBeVisible();
            await expect(
                publicPage.getByRole('button', { name: 'Avaliar', exact: true })
            ).toHaveCount(0);
            const reading = await readReviews(publicPage, edited, 99);
            await expect(
                reading.getByRole('button', { name: /Editar|Atualizar avaliação|Apagar avaliação/ })
            ).toHaveCount(0);
            await expect(
                publicPage.getByRole('dialog', { name: 'Avaliar professor', exact: true })
            ).toHaveCount(0);
        } finally {
            await visitor.close();
        }
    });

    await test.step('outro aluno não recebe autoria e a API rejeita credencial incorreta', async () => {
        const other = await browser.newContext({
            baseURL,
            storageState: { cookies: [], origins: [] }
        });
        try {
            const otherPage = await other.newPage();
            await login(otherPage, '252000000');
            await openProfessor(otherPage);
            const reading = await readReviews(otherPage, edited, 99);
            await expect(
                reading.getByRole('button', { name: /Editar|Atualizar avaliação|Apagar avaliação/ })
            ).toHaveCount(0);
            await otherPage.keyboard.press('Escape');
            await expect(reading).not.toBeVisible();
            await otherPage.getByRole('button', { name: 'Avaliar', exact: true }).click();
            const dialog = otherPage.getByRole('dialog', {
                name: 'Avaliar professor',
                exact: true
            });
            await expect(dialog.getByLabel('Comentário (opcional)', { exact: true })).toHaveValue(
                ''
            );
            await expect(dialog.getByText(/Você já avaliou/)).toHaveCount(0);
            await expect(
                dialog.getByRole('button', { name: 'Enviar avaliação', exact: true })
            ).toBeVisible();
            await expect(
                dialog.getByRole('button', { name: /Atualizar avaliação|Apagar avaliação/ })
            ).toHaveCount(0);

            const permit = await other.request.post('/api/auth/community-permits', {
                data: { method: 'PUT', path: `/reviews/${reviewId}` }
            });
            expect(permit.status()).toBe(200);
            const rejected = await request.put(`/api/reviews/${reviewId}`, {
                headers: {
                    'X-Followw-Permit': (await permit.json()).token,
                    'X-Review-Token': '0'.repeat(64)
                },
                data: { rating: 0, comment: 'Tentativa sintética de editar avaliação alheia.' }
            });
            expect(rejected.status()).toBe(404);
            expect(await rejected.json()).toEqual({ detail: 'Avaliação não encontrada.' });
            await otherPage.keyboard.press('Escape');
            await expect(dialog).not.toBeVisible();
            await otherPage.reload();
            await ready(otherPage);
            await readReviews(otherPage, edited, 99);
            const publicReviews = await request.get('/api/public/professors/1000001/reviews');
            expect(publicReviews.status()).toBe(200);
            const reviews = (await publicReviews.json()).reviews;
            expect(reviews.filter((review: { id: string }) => review.id === reviewId)).toEqual([
                expect.objectContaining({ id: reviewId, rating: 99, comment: edited })
            ]);
            expect(
                reviews.some((review: { comment: string | null }) => review.comment === original)
            ).toBe(false);
        } finally {
            await other.close();
        }
    });
});
