import { call, confirmation, el, notice } from './dashboard-core.js';

const bytes = (n) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${u[i]}`; };

const fields = [
    ['materials_file_mb', 'MB por arquivo', 20],
    ['materials_per_subject', 'Arquivos por matéria', 30],
    ['materials_subject_mb', 'MB por matéria', 30],
    ['materials_total_gb', 'Espaço global máximo do projeto (GB · interno)', 500],
    ['forum_replies', 'Respostas por conversa', 500],
    ['upload_attempts_per_day', 'Autorizações de envio por matéria, navegador e dia', 10],
    ['tutorials_pending', 'Guias aguardando moderação', 60],
];

export async function limitsView(render) {
    const [values, overview] = await Promise.all([call('/limits'), call('/overview')]);
    const capBytes = values.materials_total_gb * 1024 ** 3;
    const usedBytes = overview.materials_bytes || 0;
    const pct = Math.min(100, (usedBytes / Math.max(capBytes, 1)) * 100);
    return [el('h1', {}, 'Limites da comunidade'),
        el('p', { class: 'muted' }, 'Ajustes valem para novas operações em todos os workers. Reduzir um limite não apaga conteúdo existente. Os tetos de segurança não podem ser aumentados por este painel.'),
        el('div', { class: 'panel' },
            el('div', { class: 'toolbar' },
                el('strong', { class: 'grow' }, 'Armazenamento global de materiais (visível só no admin)'),
                el('span', { class: 'muted' }, `${bytes(usedBytes)} de ${values.materials_total_gb} GB (${pct.toFixed(1)}%)`)),
            el('div', { class: 'meter' }, el('span', { widthPercent: pct.toFixed(1) })),
            el('p', { class: 'muted' }, overview.clamav_enabled
                ? 'Verificação ativa: sanitização estrutural (PDF/Office/imagens) + varredura ClamAV configurada.'
                : 'Não há antivírus ativo nesta instância (ClamAV opcional via CLAMAV_HOST). PDFs passam por reconstrução e bloqueio de JavaScript/Launch/arquivos embutidos; imagens e Office são sanitizados estruturalmente.')),
        el('form', { class: 'panel', onsubmit: async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, Number(value)]));
            const accepted = await confirmation('Atualizar limites?', fields.map(([key, label]) => `${label}: ${values[key]}`).join(' · '));
            if (!accepted) return;
            const submit = form.querySelector('[type="submit"]');
            if (submit) submit.disabled = true;
            try { await call('/limits', { method: 'PUT', body: JSON.stringify(values) }); notice('Limites atualizados e registrados na auditoria.'); void render(); }
            catch (error) { notice(error.message, true); if (submit) submit.disabled = false; }
        } }, el('div', { class: 'grid g2' }, fields.map(([key, label, maximum]) => el('label', {}, label,
            el('input', { name: key, type: 'number', min: 1, max: maximum, step: 1, required: true, value: values[key] }),
            el('small', { class: 'muted' }, `Entre 1 e ${maximum}`)))),
            el('p', { class: 'muted' }, 'O limite de arquivos é por matéria (no máximo 30 arquivos / 30 MB), nunca por estudante. O teto global do projeto em GB protege o disco do servidor e não aparece ao usuário final.'),
            el('button', { type: 'submit', class: 'primary' }, 'Salvar limites'))];
}
