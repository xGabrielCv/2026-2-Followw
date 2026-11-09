import { call, closeDrawer, el, hasPermission, notice, openDrawer } from './dashboard-core.js';

const fmt = (n) => new Intl.NumberFormat('pt-BR').format(n);

// Redefinir estatísticas: só contadores de uso e métricas operacionais; conteúdo e catálogo ficam intactos.
async function openReset(render) {
    const preview = await call('/statistics/reset-preview');
    const chosen = new Set(preview.groups.map((group) => group.id));
    const confirmation = el('input', { 'aria-label': 'Digite REDEFINIR', placeholder: 'REDEFINIR', autocomplete: 'off', maxlength: 20 });
    const download = () => {
        const blob = new Blob([JSON.stringify(preview.summary, null, 2)], { type: 'application/json' });
        const link = el('a', { href: URL.createObjectURL(blob), download: `followw-resumo-estatisticas-${preview.generated_at.slice(0, 10)}.json` });
        link.click();
        URL.revokeObjectURL(link.href);
    };
    openDrawer(
        el('h2', {}, 'Redefinir estatísticas'),
        el('p', { class: 'muted' }, 'Zera contadores de uso e métricas operacionais acumulados (por exemplo, os do desenvolvimento local). Não apaga conteúdo, catálogo, contas, chaves nem o log de auditoria.'),
        preview.groups.map((group) => el('label', { class: 'switch' },
            el('span', {}, `${group.label} · ${fmt(group.items)} ${group.items === 1 ? 'item' : 'itens'}`, el('br', {}), el('small', { class: 'muted' }, group.detail)),
            el('input', { type: 'checkbox', checked: true, 'aria-label': group.label, onchange: (event) => { if (event.target.checked) chosen.add(group.id); else chosen.delete(group.id); } }))),
        el('div', { class: 'panel' }, el('h3', {}, 'Não será apagado'), el('ul', {}, preview.protected.map((item) => el('li', {}, item)))),
        el('button', { onclick: download }, 'Baixar resumo antes de zerar (sem dados pessoais)'),
        el('label', {}, 'Para confirmar, digite REDEFINIR', confirmation),
        el('div', { class: 'toolbar' },
            el('button', { onclick: closeDrawer }, 'Cancelar'),
            el('button', { class: 'danger', onclick: async () => {
                if (!chosen.size) return notice('Escolha ao menos um grupo.', true);
                try {
                    const result = await call('/statistics/reset', { method: 'POST', body: JSON.stringify({ groups: [...chosen], confirmation: confirmation.value }) });
                    notice(Object.entries(result.cleared).map(([group, n]) => `${group}: ${fmt(n)} zerados`).join(' · '));
                    closeDrawer();
                    render();
                } catch (error) { notice(error.message, true); }
            } }, 'Redefinir selecionados')));
}

export function statisticsPanel(render) {
    if (!hasPermission('owner')) return null;
    return el('div', { class: 'panel' }, el('h3', {}, 'Estatísticas'),
        el('p', { class: 'muted' }, 'Contadores de uso e métricas operacionais acumulados. Exige MFA recente e confirmação.'),
        el('button', { class: 'danger', onclick: () => openReset(render).catch((error) => notice(error.message, true)) }, 'Redefinir estatísticas…'));
}
