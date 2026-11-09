import { call, confirmation, el, notice } from './dashboard-core.js';

const LABELS = [['groups', 'Grupos'], ['reviews', 'Avaliações'], ['classrooms', 'Turmas passadas'], ['materials', 'Materiais'], ['posts', 'Conversas'], ['tutorials', 'Guias']];

// Só o Owner. Tudo que a demonstração cria é marcado e só o marcado pode ser apagado.
export async function demoView(render) {
    const data = await call('/demo');
    const act = (method, path, title, text, done) => async () => {
        if (!await confirmation(title, text)) return;
        try { await call(path, { method }); notice(done); render(); } catch (error) { notice(error.message, true); }
    };
    return [
        el('div', { class: 'toolbar' }, el('h2', { class: 'grow' }, 'Dados de demonstração'), el('button', { onclick: render }, 'Atualizar')),
        el('p', { class: 'muted' }, 'Cria grupos, avaliações, conversas, guias, materiais e estatísticas fictícios em turmas do catálogo, para testar o app. Cada item criado é marcado como demonstração; limpar apaga somente esses itens, nunca conteúdo real. Fica desligado em produção.'),
        data.available ? null : el('div', { class: 'panel' }, el('strong', {}, 'Indisponível'), el('p', { class: 'muted' }, data.reason)),
        data.available ? el('div', { class: 'panel' },
            el('div', { class: 'grid g4' }, LABELS.map(([key, label]) => el('div', { class: 'tile' }, el('div', { class: 'value' }, String(data.status[key] ?? 0)), el('div', { class: 'label' }, label)))),
            el('p', {}, data.status.loaded ? 'Há dados de demonstração carregados.' : 'Nenhum dado de demonstração carregado.'),
            el('div', { class: 'toolbar' },
                el('button', { class: 'primary', disabled: data.status.loaded, onclick: act('POST', '/demo/load', 'Carregar dados de demonstração?', 'Serão criados itens fictícios marcados como demonstração. Exige MFA recente.', 'Demonstração carregada e registrada na auditoria.') }, 'Carregar demonstração'),
                el('button', { class: 'danger', disabled: !data.status.loaded, onclick: act('DELETE', '/demo', 'Limpar a demonstração?', 'Apaga só os itens marcados como demonstração. Conteúdo real não é tocado. Exige MFA recente.', 'Demonstração removida e registrada na auditoria.') }, 'Limpar demonstração'))) : null,
    ].filter(Boolean);
}
