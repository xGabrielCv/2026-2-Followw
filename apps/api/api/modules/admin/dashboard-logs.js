import { call, el, when } from './dashboard-core.js';

const state = { level: '', event: '', q: '', since: '', page: 1 };
const LEVELS = [['', 'Todos os níveis'], ['INFO', 'Informação'], ['WARNING', 'Aviso'], ['ERROR', 'Erro'], ['CRITICAL', 'Crítico']];
const WINDOWS = [['', 'Todo o período'], ['1', 'Última hora'], ['24', 'Últimas 24 h'], ['168', 'Últimos 7 dias']];
const fmt = (value) => new Intl.NumberFormat('pt-BR').format(value ?? 0);
const fields = (item) => Object.entries(item.fields).map(([key, value]) => `${key}=${value}`).join('  ');

// Eventos técnicos já filtrados no servidor: sem corpo de pedido, cookie, matrícula ou texto de usuário.
export async function logsView(render) {
    const query = new URLSearchParams({ page: String(state.page), page_size: '25' });
    if (state.level) query.set('level', state.level);
    if (state.event) query.set('event', state.event);
    if (state.q) query.set('q', state.q);
    if (state.since) query.set('since', new Date(Date.now() - Number(state.since) * 3600_000).toISOString());
    const [page, summary] = await Promise.all([call(`/logs?${query}`), call('/logs/summary')]);
    const pages = Math.max(1, Math.ceil(page.total / page.page_size));
    const select = (name, options) => el('select', { 'aria-label': name, onchange: (event) => { state[name] = event.target.value; state.page = 1; render(); } },
        options.map(([value, label]) => el('option', { value, selected: state[name] === value }, label)));
    return [
        el('div', { class: 'toolbar' }, el('h2', { class: 'grow' }, 'Registros técnicos'), el('button', { onclick: render }, 'Atualizar')),
        el('p', { class: 'muted' }, `Avisos, erros, sincronização e respostas 5xx, guardados por ${summary.retention_days} dias. Não há texto de usuário, matrícula, cookie nem corpo de pedido. O painel lê só do banco; não abre arquivos do servidor.`),
        el('div', { class: 'grid g4' }, ['INFO', 'WARNING', 'ERROR', 'CRITICAL'].map((level) =>
            el('div', { class: `panel tile${level === 'ERROR' || level === 'CRITICAL' ? ' warn' : ''}` }, el('div', { class: 'value' }, fmt(summary.last_24_hours[level])), el('div', { class: 'label' }, `${LEVELS.find(([value]) => value === level)[1]} (24 h)`)))),
        summary.dropped_in_this_process ? el('p', { class: 'muted' }, `${fmt(summary.dropped_in_this_process)} evento(s) descartado(s) neste processo por excesso ou falha de gravação.`) : null,
        el('form', { class: 'toolbar', onsubmit: (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            state.q = String(data.get('q') || '').trim();
            state.event = String(data.get('event') || '').trim().toLowerCase();
            state.page = 1;
            render();
        } },
            select('level', LEVELS), select('since', WINDOWS),
            el('input', { name: 'event', placeholder: 'Evento (ex.: sync.)', pattern: '[a-z0-9_.]{1,80}', value: state.event, 'aria-label': 'Evento' }),
            el('input', { name: 'q', placeholder: 'Buscar nos campos', maxlength: 64, value: state.q, 'aria-label': 'Buscar' }),
            el('button', { type: 'submit' }, 'Filtrar')),
        el('div', { class: 'panel' }, page.items.length
            ? el('table', {}, el('thead', {}, el('tr', {}, ['Quando', 'Nível', 'Evento', 'Campos'].map((label) => el('th', {}, label)))),
                el('tbody', {}, page.items.map((item) => el('tr', {}, el('td', {}, when(item.at)), el('td', {}, item.level), el('td', {}, item.event), el('td', { class: 'muted' }, fields(item))))))
            : el('p', { class: 'muted' }, 'Nenhum registro com este filtro.')),
        el('div', { class: 'toolbar' }, el('button', { disabled: state.page <= 1, onclick: () => { state.page -= 1; render(); } }, 'Anterior'),
            el('span', { class: 'muted' }, `Página ${page.page} de ${pages} · ${fmt(page.total)} registro(s)`),
            el('button', { disabled: state.page >= pages, onclick: () => { state.page += 1; render(); } }, 'Próxima')),
    ].filter(Boolean);
}
