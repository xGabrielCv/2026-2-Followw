import { expect, type Page } from '@playwright/test';

export async function ready(page: Page) {
    await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
}

export async function login(page: Page, registration = '251000000') {
    await page.goto('/login');
    await ready(page);
    await page.getByRole('textbox', { name: 'Matrícula', exact: true }).fill(registration);
    await page.getByLabel('Senha do SIGAA', { exact: true }).fill('simulada123');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/perfil$/);
    await expect(async () => {
        const consent = page.getByRole('button', { name: 'Agora não', exact: true });
        if (await consent.isVisible()) await consent.click();
        await expect(page.getByRole('button', { name: 'Editar perfil' })).toBeVisible();
    }).toPass({ timeout: 15000 });
}

export function syntheticPdf() {
    const text = 'BT /F1 18 Tf 30 150 Td (Documento sintetico) Tj ET';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${text.length} >>\nstream\n${text}\nendstream`
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const start = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
    return Buffer.from(pdf);
}
