import { call, confirmation, el, hasPermission, notice, when } from './dashboard-core.js';

const STATUS = { success: 'Atualizado', unchanged: 'Sem mudanças', failed: 'Falhou', skipped: 'Ignorado' };
const TRIGGER = { schedule: 'Agendada', manual: 'Manual' };
const NUMBERS = [
    ['timeout_seconds', 'Tempo limite do catálogo (segundos)', 60, 7200],
    ['backoff_minutes', 'Espera inicial após falha (minutos)', 5, 120],
    ['max_backoff_hours', 'Espera máxima após falhas (horas)', 1, 24],
    ['manual_cooldown_seconds', 'Pausa entre execuções manuais (segundos)', 60, 3600],
    ['startup_max_age_hours', 'Sincronizar ao iniciar se o último sucesso for mais velho que (horas)', 1, 24],
    ['history_limit', 'Execuções guardadas no histórico', 50, 1000],
];
const fmt = (value) => (value === null || value === undefined ? '—' : new Intl.NumberFormat('pt-BR').format(value));
const date = (iso) => (iso ? when(iso) : '—');

function sourceRow(source, render) {
    const run = async () => {
        if (!await confirmation(`Sincronizar agora: ${source.label}?`, 'Roda em segundo plano e consulta só fontes públicas. O resultado aparece no histórico.')) return;
        try { await call(`/sync/${source.key}/run`, { method: 'POST' }); notice('Sincronização iniciada em segundo plano.'); setTimeout(render, 1500); }
        catch (error) { notice(error.message, true); }
    };
    return el('tr', {},
        el('td', {}, el('strong', {}, source.label), el('div', { class: 'muted' }, source.enabled ? `Horários (Brasília): ${source.scheduled_times.join(', ')}` : 'Desligada')),
        el('td', {}, source.running ? 'Sincronizando…' : STATUS[source.last_status] || '—', source.consecutive_failures ? el('div', { class: 'muted' }, `${source.consecutive_failures} falha(s) seguidas`) : null),
        el('td', {}, date(source.last_attempt_at)),
        el('td', {}, date(source.last_success_at)),
        el('td', {}, date(source.last_change_at)),
        el('td', {}, source.enabled ? date(source.next_run_at) : '—'),
        el('td', { class: 'num' }, fmt(source.records)),
        el('td', {}, hasPermission('operations') ? el('button', { disabled: source.running, onclick: run }, 'Sincronizar agora') : null));
}

function settingsForm(settings, render) {
    const field = (name, label, attrs) => el('label', {}, label, el('input', { name, required: true, ...attrs }));
    return el('form', { class: 'panel', onsubmit: async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const body = {
            catalog_enabled: data.get('catalog_enabled') === 'on',
            restaurant_enabled: data.get('restaurant_enabled') === 'on',
            catalog_times: String(data.get('catalog_times')).split(',').map((value) => value.trim()).filter(Boolean),
            restaurant_time: String(data.get('restaurant_time')).trim(),
        };
        for (const [key] of NUMBERS) body[key] = Number(data.get(key));
        if (!await confirmation('Salvar a configuração?', 'Os próximos horários são recalculados agora. Exige MFA recente.')) return;
        try { await call('/sync/settings', { method: 'PUT', body: JSON.stringify(body) }); notice('Configuração salva e registrada na auditoria.'); render(); }
        catch (error) { notice(error.message, true); }
    } },
    el('h3', {}, 'Configuração'),
    el('p', { class: 'muted' }, 'Horários no fuso America/Sao_Paulo. Os limites seguros são fixos no servidor; este painel só escolhe dentro deles. Só as fontes conhecidas podem ser sincronizadas.'),
    el('div', { class: 'grid g2' },
        el('label', {}, el('input', { type: 'checkbox', name: 'catalog_enabled', checked: settings.catalog_enabled }), ' Catálogo ligado'),
        field('catalog_times', 'Horários do catálogo (HH:MM separados por vírgula, 1 a 6, 1 h de distância)', { value: settings.catalog_times.join(', '), pattern: '^\\s*([01]\\d|2[0-3]):[0-5]\\d(\\s*,\\s*([01]\\d|2[0-3]):[0-5]\\d)*\\s*$' }),
        el('label', {}, el('input', { type: 'checkbox', name: 'restaurant_enabled', checked: settings.restaurant_enabled }), ' Verificação diária do RU ligada'),
        field('restaurant_time', 'Horário do RU (HH:MM)', { value: settings.restaurant_time, pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
        NUMBERS.map(([key, label, min, max]) => el('label', {}, label,
            el('input', { name: key, type: 'number', min, max, step: 1, required: true, value: settings[key] }),
            el('small', { class: 'muted' }, `Entre ${fmt(min)} e ${fmt(max)}`)))),
    el('button', { type: 'submit', class: 'primary' }, 'Salvar configuração'));
}

function historyTable(page, state, render) {
    const select = (name, options) => el('select', { onchange: (event) => { state[name] = event.target.value; state.page = 1; render(); } },
        options.map(([value, label]) => el('option', { value, selected: state[name] === value }, label)));
    const pages = Math.max(1, Math.ceil(page.total / page.page_size));
    return el('div', { class: 'panel' },
        el('div', { class: 'toolbar' }, el('h3', { class: 'grow' }, 'Histórico'),
            select('source', [['', 'Todas as fontes'], ['catalog', 'Catálogo'], ['restaurant', 'Cardápio do RU']]),
            select('status', [['', 'Todos os resultados'], ['success', 'Atualizado'], ['unchanged', 'Sem mudanças'], ['failed', 'Falhou'], ['skipped', 'Ignorado']])),
        page.items.length
            ? el('table', {}, el('thead', {}, el('tr', {}, ['Quando', 'Fonte', 'Origem', 'Resultado', 'Registros', 'Detalhe'].map((label) => el('th', {}, label)))),
                el('tbody', {}, page.items.map((run) => el('tr', {},
                    el('td', {}, date(run.started_at)), el('td', {}, run.source === 'catalog' ? 'Catálogo' : 'Cardápio do RU'),
                    el('td', {}, TRIGGER[run.trigger] || run.trigger), el('td', {}, STATUS[run.status] || run.status, run.changed ? ' (houve mudança)' : ''),
                    el('td', { class: 'num' }, fmt(run.records)), el('td', {}, run.error || '')))))
            : el('p', { class: 'muted' }, 'Nenhuma execução registrada com este filtro.'),
        el('div', { class: 'toolbar' }, el('button', { disabled: state.page <= 1, onclick: () => { state.page -= 1; render(); } }, 'Anterior'),
            el('span', { class: 'muted' }, `Página ${page.page} de ${pages}`),
            el('button', { disabled: state.page >= pages, onclick: () => { state.page += 1; render(); } }, 'Próxima')));
}

const historyState = { source: '', status: '', page: 1 };

export async function syncView(render) {
    const query = new URLSearchParams({ page: String(historyState.page), page_size: '15' });
    for (const key of ['source', 'status']) if (historyState[key]) query.set(key, historyState[key]);
    const [overview, history, resources] = await Promise.all([call('/sync'), call(`/sync/history?${query}`), call('/sync/resources')]);
    return [
        el('div', { class: 'toolbar' }, el('h2', { class: 'grow' }, 'Sincronização e catálogos'), el('button', { onclick: render }, 'Atualizar')),
        el('p', { class: 'muted' }, 'O catálogo e o cardápio são públicos: nada aqui envolve dados de alunos. Se uma fonte falhar, o último dado válido continua sendo servido e uma nova tentativa acontece com espera crescente.'),
        el('div', { class: 'panel' }, el('table', {}, el('thead', {}, el('tr', {}, ['Fonte', 'Situação', 'Última consulta', 'Último sucesso', 'Última mudança real', 'Próxima execução', 'Registros', ''].map((label) => el('th', {}, label)))),
            el('tbody', {}, overview.sources.map((source) => sourceRow(source, render))))),
        el('div', { class: 'panel' }, el('h3', {}, 'Atividade da comunidade'),
            el('p', { class: 'muted' }, 'Só agregados: a última atividade aparece em hora cheia e não há como ligar um item a quem o publicou.'),
            el('table', {}, el('thead', {}, el('tr', {}, ['Recurso', 'Última atividade (hora)', 'Nas últimas 24 h', 'Total'].map((label) => el('th', {}, label)))),
                el('tbody', {}, resources.map((item) => el('tr', {}, el('td', {}, item.label), el('td', {}, item.last_activity_hour ? new Date(item.last_activity_hour).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'), el('td', { class: 'num' }, fmt(item.last_24_hours)), el('td', { class: 'num' }, fmt(item.total))))))),
        hasPermission('configure') ? settingsForm(overview.settings, render) : null,
        historyTable(history, historyState, render),
    ].filter(Boolean);
}
