import { call, confirmation, el, notice } from './dashboard-core.js';

const fields = [
    ['materials_file_mb', 'MB por arquivo', 20],
    ['materials_per_subject', 'Arquivos por matéria', 50],
    ['materials_subject_mb', 'MB por matéria', 100],
    ['forum_replies', 'Respostas por conversa', 500],
    ['tutorials_pending', 'Guias aguardando moderação', 60],
];

export async function limitsView(render) {
    const values = await call('/limits');
    return [el('h1', {}, 'Limites da comunidade'),
        el('p', { class: 'muted' }, 'Ajustes valem para novas operações em todos os workers. Reduzir um limite não apaga conteúdo existente. Os tetos de segurança não podem ser aumentados por este painel.'),
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
            el('p', { class: 'muted' }, 'Autorizações de materiais continuam limitadas a 10 tentativas por matéria, navegador e dia. Isso não identifica alunos nem impõe uma cota exata entre aparelhos.'),
            el('button', { type: 'submit', class: 'primary' }, 'Salvar limites'))];
}
