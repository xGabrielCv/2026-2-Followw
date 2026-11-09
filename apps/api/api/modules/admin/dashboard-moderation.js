import { call, confirmation, el, notice, when } from './dashboard-core.js';

const filters = { reports: 'pending', tutorials: 'pending', reportPage: 1, tutorialPage: 1, reason: '', target: '', reportSearch: '', tutorialSearch: '', reportOrder: 'newest', tutorialOrder: 'newest' };
const reasons = { ofensivo: 'Ofensivo', dados_pessoais: 'Expõe alguém', spam: 'Spam', falso: 'Falso', direitos_autorais: 'Direitos autorais', outro: 'Outro' };
const types = { review: 'Avaliação', group: 'Grupo', material: 'Material', post: 'Publicação', reply: 'Resposta', tutorial: 'Guia' };

export async function moderationView(render, editTutorial) {
    const params = new URLSearchParams({ status: filters.reports, page: filters.reportPage });
    if (filters.reason) params.set('reason', filters.reason);
    if (filters.target) params.set('target', filters.target);
    params.set('q', filters.reportSearch); params.set('order', filters.reportOrder);
    const tutorialParams = new URLSearchParams({ status: filters.tutorials, page: filters.tutorialPage, q: filters.tutorialSearch, order: filters.tutorialOrder });
    const [reports, tutorials] = await Promise.all([call('/reports?' + params), call('/tutorials?' + tutorialParams)]);
    const selected = { report: new Set(), tutorial: new Set() };
    const act = async (kind, ids, action, batch = false) => {
        if (!ids.length || ids.length > 20) { notice('Selecione de 1 a 20 itens da página.', true); return; }
        const reason = await confirmation(`Confirmar decisão sobre ${ids.length} item(ns)?`, action === 'accept' && kind === 'report' ? 'O conteúdo denunciado será apagado. Confira a seleção e registre a justificativa. A exclusão não pode ser desfeita.' : 'Confira os itens e registre uma justificativa sem dados pessoais.', { reason: true, label: 'Confirmar decisão' });
        if (!reason) return;
        try {
            await call(batch ? '/moderation/batch' : `/${kind === 'report' ? 'reports' : 'tutorials'}/${ids[0]}`, { method: 'POST', body: JSON.stringify({ action, reason, ...(batch ? { kind, ids } : {}) }) });
            notice('Decisão registrada na auditoria.'); void render();
        } catch (error) { notice(error.message, true); }
    };
    const tabs = (key, options) => el('div', { class: 'tabs' }, options.map(([value, title]) => el('button', { 'aria-pressed': String(filters[key] === value), onclick: () => { filters[key] = value; filters[key === 'reports' ? 'reportPage' : 'tutorialPage'] = 1; void render(); } }, title)));
    const history = (item) => item.history.length ? el('details', {}, el('summary', {}, 'Histórico de decisões'), item.history.map((entry) => el('p', { class: 'muted pre' }, `${when(entry.created_at)} · ${entry.action} · ${entry.reason || 'Registro legado sem justificativa'}`))) : null;
    const checkbox = (kind, item, title) => item.status === 'pending' ? el('input', { type: 'checkbox', 'aria-label': `Selecionar ${title}`, onchange: (event) => { if (event.target.checked) selected[kind].add(item.id); else selected[kind].delete(item.id); } }) : null;
    const batch = (kind) => el('div', { class: 'toolbar' }, el('p', { class: 'muted grow' }, 'Seleção vale só para esta página. Lotes de até 20 itens; qualquer falha reverte o lote inteiro.'),
        el('button', { onclick: () => act(kind, [...selected[kind]], 'accept', true) }, kind === 'report' ? 'Aceitar selecionadas' : 'Aprovar selecionados'),
        el('button', { onclick: () => act(kind, [...selected[kind]], 'reject', true) }, 'Recusar selecionados'));
    const pager = (result, key) => el('div', { class: 'pager' }, el('button', { disabled: result.page <= 1, onclick: () => { filters[key]--; void render(); } }, 'Anterior'), el('span', {}, `Página ${result.page} de ${Math.max(1, Math.ceil(result.total / result.page_size))} · ${result.total} itens`), el('button', { disabled: result.page * result.page_size >= result.total, onclick: () => { filters[key]++; void render(); } }, 'Próxima'));
    const filter = (key, title, options) => el('label', {}, title, el('select', { 'aria-label': title, onchange: (event) => { filters[key] = event.target.value; filters.reportPage = 1; void render(); } }, el('option', { value: '' }, 'Todos'), Object.entries(options).map(([value, name]) => el('option', { value, selected: filters[key] === value }, name))));
    const search = (kind, title) => el('form', { class: 'toolbar', onsubmit: (event) => { event.preventDefault(); filters[kind + 'Page'] = 1; void render(); } },
        el('label', {}, title, el('input', { type: 'search', value: filters[kind + 'Search'], maxlength: '120', oninput: (event) => { filters[kind + 'Search'] = event.target.value; } })),
        el('label', {}, 'Ordenação', el('select', { 'aria-label': `Ordenação de ${title}`, onchange: (event) => { filters[kind + 'Order'] = event.target.value; filters[kind + 'Page'] = 1; void render(); } }, [['newest', 'Mais recentes'], ['oldest', 'Mais antigos']].map(([value, name]) => el('option', { value, selected: filters[kind + 'Order'] === value }, name)))),
        el('button', { type: 'submit' }, 'Buscar'));
    return [el('h1', {}, 'Moderação'),
        el('div', { class: 'panel' }, el('h2', {}, 'Denúncias e pedidos de exclusão'), tabs('reports', [['pending', 'Pendentes'], ['accepted', 'Aceitas'], ['rejected', 'Recusadas']]),
            el('div', { class: 'toolbar' }, filter('reason', 'Motivo', reasons), filter('target', 'Conteúdo', types)),
            search('report', 'Buscar mensagem, motivo ou ID do conteúdo'),
            reports.search_limited ? el('p', { role: 'status', class: 'muted' }, 'Busca limitada às 2.000 denúncias mais recentes dos filtros selecionados.') : null,
            reports.items.length ? el('div', { class: 'list' }, reports.items.map((item) => el('div', {},
                el('div', { class: 'item' }, checkbox('report', item, `denúncia ${item.id}`), el('strong', {}, types[item.target_type] || item.target_type), el('span', { class: 'badge' }, reasons[item.reason]), el('p', { class: 'pre' }, item.preview || '(conteúdo já apagado)'), item.message ? el('p', { class: 'muted pre' }, item.message) : null, history(item)),
                item.status === 'pending' ? el('div', { class: 'actions' }, el('button', { class: 'danger', onclick: () => act('report', [item.id], 'accept') }, 'Apagar conteúdo'), el('button', { onclick: () => act('report', [item.id], 'reject') }, 'Manter')) : null))) : el('p', { role: 'status', class: 'muted' }, 'Nenhuma denúncia corresponde aos filtros.'),
            filters.reports === 'pending' ? batch('report') : null, pager(reports, 'reportPage')),
        el('div', { class: 'panel' }, el('h2', {}, 'Guias da UnB'), tabs('tutorials', [['pending', 'Pendentes'], ['approved', 'Aprovados'], ['rejected', 'Recusados']]),
            search('tutorial', 'Buscar nos guias'),
            tutorials.search_limited ? el('p', { role: 'status', class: 'muted' }, 'Busca limitada aos 2.000 guias mais recentes desta fila.') : null,
            tutorials.items.length ? el('div', { class: 'list' }, tutorials.items.map((item) => el('div', {},
                el('div', { class: 'item' }, checkbox('tutorial', item, item.title), el('strong', {}, item.title), el('p', { class: 'muted' }, item.summary), el('details', {}, el('summary', {}, 'Ler o guia'), el('p', { class: 'pre' }, item.body)), history(item)),
                el('div', { class: 'actions' }, el('button', { onclick: () => editTutorial(item) }, 'Editar'), item.status !== 'approved' ? el('button', { onclick: () => act('tutorial', [item.id], 'accept') }, 'Aprovar') : null, item.status !== 'rejected' ? el('button', { onclick: () => act('tutorial', [item.id], 'reject') }, item.status === 'approved' ? 'Despublicar' : 'Recusar') : null)))) : el('p', { role: 'status', class: 'muted' }, 'Nenhum guia nesta fila.'),
            filters.tutorials === 'pending' ? batch('tutorial') : null, pager(tutorials, 'tutorialPage'))];
}
