import { call, confirmation, el, notice, openDrawer } from './dashboard-core.js';

const LABELS = [['groups', 'Grupos'], ['reviews', 'Avaliações'], ['classrooms', 'Turmas passadas'], ['materials', 'Materiais'], ['posts', 'Conversas'], ['tutorials', 'Guias']];

// Só o Owner. Tudo que a demonstração cria é marcado e só o marcado pode ser apagado.
export async function demoView(render) {
    const data = await call('/demo');
    const act = (method, path, title, text, done) => async () => {
        const expected = method === 'DELETE' ? 'LIMPAR DEMONSTRAÇÃO' : path.endsWith('/reload') ? 'RECARREGAR DEMONSTRAÇÃO' : '';
        if (!await confirmation(title, text, expected ? { text: expected } : {})) return;
        try { await call(path, { method, ...(expected ? { body: JSON.stringify({ confirmation: expected }) } : {}) }); notice(done); render(); } catch (error) { notice(error.message, true); }
    };
    return [
        el('div', { class: 'toolbar' }, el('h2', { class: 'grow' }, 'Dados de demonstração'), el('button', { onclick: render }, 'Atualizar')),
        el('p', { class: 'muted' }, 'Cria grupos, avaliações, conversas, guias, materiais e estatísticas fictícios em turmas do catálogo, para testar o app. Cada item criado é marcado como demonstração; limpar apaga somente esses itens, nunca conteúdo real. Fica desligado em produção.'),
        data.available ? null : el('div', { class: 'panel' }, el('strong', {}, 'Indisponível'), el('p', { class: 'muted' }, data.reason)),
        data.available ? el('div', { class: 'panel' },
            el('button', { onclick: async () => { try { const preview = await call('/demo/preview'); openDrawer(el('h2', {}, 'Prévia da demonstração'), el('p', {}, `Até ${preview.eligible_classrooms} turmas públicas de ${preview.semester || 'semestre indisponível'}. Grupos, avaliações, materiais, conversas, guias e turmas passadas sintéticas, sem substituir conteúdo real.`), el('p', { class: 'muted' }, preview.can_clear ? 'A limpeza verificará novamente as referências reais antes de confirmar.' : 'Há respostas reais em publicações sintéticas. A limpeza e a recarga serão recusadas para preservar essas respostas.')); } catch (error) { notice(error.message, true); } } }, 'Ver prévia'),
            el('p', {}, data.enabled ? 'Demonstração ativada nesta instância local.' : 'Demonstração desativada. Os itens já criados são preservados.'),
            el('button', { onclick: async () => {
                if (!await confirmation(data.enabled ? 'Desativar demonstração?' : 'Ativar demonstração local?', 'Só nesta instância local. Exige MFA recente. Não apaga conteúdo.')) return;
                try { await call('/demo/settings', { method: 'PUT', body: JSON.stringify({ enabled: !data.enabled }) }); render(); } catch (error) { notice(error.message, true); }
            } }, data.enabled ? 'Desativar demonstração' : 'Ativar demonstração'),
            el('div', { class: 'grid g4' }, LABELS.map(([key, label]) => el('div', { class: 'tile' }, el('div', { class: 'value' }, String(data.status[key] ?? 0)), el('div', { class: 'label' }, label)))),
            el('p', {}, data.status.loaded ? 'Há dados de demonstração carregados.' : 'Nenhum dado de demonstração carregado.'),
            el('div', { class: 'toolbar' },
                el('button', { disabled: !data.enabled, onclick: act('POST', '/demo/reload', 'Recarregar demonstração?', 'Troca somente o namespace sintético em uma transação. Conteúdo real e auditoria são preservados.', 'Demonstração recarregada e registrada na auditoria.') }, 'Recarregar demonstração'),
                el('button', { class: 'primary', disabled: !data.enabled || data.status.loaded, onclick: act('POST', '/demo/load', 'Carregar dados de demonstração?', 'Serão criados itens fictícios marcados como demonstração. Exige MFA recente.', 'Demonstração carregada e registrada na auditoria.') }, 'Carregar demonstração'),
                el('button', { class: 'danger', disabled: !data.enabled || !data.status.loaded, onclick: act('DELETE', '/demo', 'Limpar a demonstração?', 'Apaga só os itens marcados como demonstração. Conteúdo real não é tocado. Exige MFA recente.', 'Demonstração removida e registrada na auditoria.') }, 'Limpar demonstração'))) : null,
    ].filter(Boolean);
}
