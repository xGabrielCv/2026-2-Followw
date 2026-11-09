/* oxlint-disable no-await-in-loop -- as medições precisam do mesmo navegador sem carga concorrente */
import { chromium, expect, test } from '@playwright/test';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test.skip(process.env.FOLLOWW_E2E_PRODUCTION !== '1', 'Lighthouse exige build de produção');

test('mede Lighthouse em produção local com dados sintéticos', async () => {
    test.setTimeout(240_000);
    const directory = fileURLToPath(new URL('../../../.local/performance/', import.meta.url));
    await mkdir(directory, { recursive: true });
    const chrome = await launch({
        chromePath: chromium.executablePath(),
        chromeFlags: [
            '--headless',
            '--disable-background-networking',
            '--disable-sync',
            '--no-first-run',
            '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'
        ]
    });
    const summaries = [];
    try {
        for (const formFactor of ['mobile', 'desktop'] as const) {
            for (const path of ['/', '/ru', '/comunidade', '/perfil/dados']) {
                const name = `${formFactor}-${path.replaceAll('/', '_') || 'home'}`;
                const result = await lighthouse(`http://127.0.0.1:3011${path}`, {
                    port: chrome.port,
                    output: 'html',
                    logLevel: 'error',
                    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
                    formFactor,
                    screenEmulation:
                        formFactor === 'mobile'
                            ? {
                                  mobile: true,
                                  width: 390,
                                  height: 844,
                                  deviceScaleFactor: 1,
                                  disabled: false
                              }
                            : {
                                  mobile: false,
                                  width: 1440,
                                  height: 1000,
                                  deviceScaleFactor: 1,
                                  disabled: false
                              },
                    blockedUrlPatterns: [
                        'https://*',
                        'http://sigaa.unb.br/*',
                        'http://autenticacao.unb.br/*'
                    ]
                });
                if (!result) throw new Error('Lighthouse não retornou resultado');
                const report = result.lhr;
                await writeFile(
                    `${directory}/${name}.html`,
                    typeof result.report === 'string' ? result.report : result.report.join('\n')
                );
                summaries.push({
                    path,
                    formFactor,
                    runtimeError: report.runtimeError?.code ?? null,
                    scores: Object.fromEntries(
                        Object.entries(report.categories).map(([key, category]) => [
                            key,
                            category.score
                        ])
                    ),
                    lcp_ms: report.audits['largest-contentful-paint']?.numericValue,
                    cls: report.audits['cumulative-layout-shift']?.numericValue,
                    tbt_ms: report.audits['total-blocking-time']?.numericValue,
                    fcp_ms: report.audits['first-contentful-paint']?.numericValue,
                    failed: Object.entries(report.audits)
                        .filter(
                            ([, audit]) =>
                                audit.score !== null &&
                                audit.score < 1 &&
                                !['notApplicable', 'informative'].includes(audit.scoreDisplayMode)
                        )
                        .map(([id, audit]) => ({ id, score: audit.score, title: audit.title }))
                });
                expect(report.runtimeError, name).toBeUndefined();
            }
        }
    } finally {
        await writeFile(`${directory}/summary.json`, JSON.stringify(summaries, null, 2));
        chrome.kill();
    }
});
