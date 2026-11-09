import { call, el, when } from './dashboard-core.js';

const state = { page: 1, page_size: 20, order: 'newest' };

export async function auditView(render) {
    const query = new URLSearchParams(Object.entries(state).filter(([, value]) => value !== '').map(([key, value]) => [key, String(value)]));
    const result = await call('/log?' + query);
    const field = (name, label, type = 'text') => el('label', {}, label,
        el('input', { name, type, value: state[name] || '', maxlength: name === 'actor' ? 64 : 80 }));
    const select = (name, label, options) => el('label', {}, label, el('select', { name }, options.map(([value, title]) => el('option', { value, selected: String(state[name] ?? '') === value }, title))));
    const filters = el('form', { class: 'toolbar', onsubmit: (event) => {
        event.preventDefault();
        Object.assign(state, Object.fromEntries(new FormData(event.currentTarget)), { page: 1 });
        void render();
    } }, field('action', 'Ação'), field('actor', 'Conta administrativa'), field('target', 'Tipo de alvo'),
    select('role', 'Cargo', [['', 'Todos'], ['owner', 'Owner'], ['administrator', 'Administrador'], ['moderator', 'Moderador']]),
    field('since', 'De (UTC)', 'date'), field('until', 'Até (UTC)', 'date'),
    select('order', 'Ordem', [['newest', 'Mais recentes'], ['oldest', 'Mais antigos']]),
    select('page_size', 'Por página', [['10', '10'], ['20', '20'], ['50', '50'], ['100', '100']]),
    el('button', { type: 'submit', class: 'primary' }, 'Filtrar'),
    el('button', { type: 'button', onclick: () => {
        for (const key of Object.keys(state)) delete state[key];
        Object.assign(state, { page: 1, page_size: 20, order: 'newest' });
        void render();
    } }, 'Limpar filtros'));
    const pages = Math.max(1, Math.ceil(result.total / result.page_size));
    return [el('h1', {}, 'Auditoria'), el('p', { class: 'muted' }, 'Ações administrativas e justificativas. Registro somente de leitura; filtros por data usam UTC.'),
        el('div', { class: 'panel' }, filters,
            result.items.length ? el('div', { class: 'table-scroll', tabindex: 0, 'aria-label': 'Registros de auditoria' }, el('table', {},
                el('thead', {}, el('tr', {}, ['Quando', 'Conta / cargo', 'Ação', 'Alvo', 'Justificativa'].map((label) => el('th', {}, label)))),
                el('tbody', {}, result.items.map((item) => el('tr', {}, el('td', {}, when(item.created_at)), el('td', {}, [item.actor || 'Legado', item.actor_role].filter(Boolean).join(' · ')), el('td', {}, item.action), el('td', {}, [item.target_type, item.target_id].filter(Boolean).join(' · ')), el('td', {}, item.detail || '—'))))))
                : el('p', { role: 'status', class: 'muted' }, 'Nenhum registro corresponde aos filtros.'),
            el('div', { class: 'pager' }, el('button', { disabled: result.page <= 1, onclick: () => { state.page--; void render(); } }, 'Anterior'),
                el('span', { role: 'status' }, `Página ${result.page} de ${pages} · ${result.total} registros`),
                el('button', { disabled: result.page >= pages, onclick: () => { state.page++; void render(); } }, 'Próxima')))
    ];
}
