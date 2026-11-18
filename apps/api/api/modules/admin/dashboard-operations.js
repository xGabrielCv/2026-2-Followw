import { call, confirmation, el, hasPermission, notice } from './dashboard-core.js';

const fmt = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('pt-BR').format(n));
const bytes = (n) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${u[i]}`; };
const tile = (label, value, warn) => el('div', { class: `panel tile${warn ? ' warn' : ''}` }, el('div', { class: 'value' }, value), el('div', { class: 'label' }, label));
const ms = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)} ms`);
const row = (label, value) => el('tr', {}, el('td', {}, label), el('td', { class: 'num' }, value));
const tableWrap = (table) => el('div', { class: 'table-scroll' }, table);
const CIRCUIT = { closed: 'fechado (saudável)', open: 'aberto (usando cache)', half_open: 'testando a origem' };
const ORIGIN_LABELS = { ru: 'Cardápio do RU (UnB)', sigaa_units: 'SIGAA público · Unidades', sigaa_classrooms: 'SIGAA público · Turmas' };

function bannerPanel(banner, render) {
    const enabled = el('input', { type: 'checkbox', checked: Boolean(banner?.enabled) });
    const level = el('select', { 'aria-label': 'Nível do aviso' }, [
        ['info', 'Informação (azul/neutro)'],
        ['warning', 'Alerta de instabilidade (âmbar)'],
    ].map(([v, label]) => el('option', { value: v, selected: (banner?.level || 'info') === v }, label)));
    const title = el('input', { maxlength: 80, value: banner?.title || '', placeholder: 'Ex.: Instabilidade no SIGAA' });
    const message = el('textarea', { rows: 2, maxlength: 280, placeholder: 'Ex.: O SIGAA está lento hoje; seus dados salvos no aparelho continuam disponíveis.' }, banner?.message || '');
    const localExpires = banner?.expires_at ? new Date(new Date(banner.expires_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    const expires = el('input', { type: 'datetime-local', value: localExpires });
    const canConfigure = hasPermission('configure');
    for (const ctrl of [enabled, level, title, message, expires]) ctrl.disabled = !canConfigure;
    return el('div', { class: 'panel' },
        el('h3', {}, 'Aviso operacional público (topo do app)'),
        el('p', { class: 'muted' }, 'Exibe um aviso informativo sem bloquear o uso do Followw (por exemplo, quando o SIGAA da UnB estiver fora do ar). Expira sozinho se uma data limite for informada.'),
        el('label', { class: 'inline-check' }, enabled, 'Exibir aviso no app'),
        el('div', { class: 'grid g2' },
            el('label', {}, 'Nível', level),
            el('label', {}, 'Expira em (opcional)', expires)),
        el('label', {}, 'Título curto', title),
        el('label', {}, 'Mensagem', message),
        canConfigure ? el('div', { class: 'toolbar' },
            el('button', { class: 'primary', type: 'button', onclick: async () => {
                if (enabled.checked && (!title.value.trim() || !message.value.trim())) {
                    notice('Preencha título e mensagem para ativar o aviso.', true);
                    return;
                }
                const payload = {
                    enabled: enabled.checked,
                    level: level.value,
                    title: title.value.trim(),
                    message: message.value.trim(),
                    expires_at: expires.value ? new Date(expires.value).toISOString() : null,
                };
                try {
                    await call('/operations/banner', { method: 'PUT', body: JSON.stringify(payload) });
                    notice(payload.enabled ? 'Aviso público publicado.' : 'Aviso público desativado.');
                    render();
                } catch (error) { notice(error.message, true); }
            } }, 'Salvar aviso público')) : el('p', { class: 'muted' }, 'Exige permissão de configuração.'));
}

// Atividade e infraestrutura reais deste processo, sem identificar ninguém. Nada aqui é estimado.
export async function operationsView(render) {
    const live = await call('/operations/live');
    const a = live.activity, db = live.database, p = live.process, pool = live.pool, hp = live.http_pool || {}, sl = live.session_lock || {}, rl = live.rate_limit || {}, c = live.cache;
    const modules = Object.entries(a.errors_by_module_24_hours);
    const clear = (target, label) => el('button', { onclick: async () => {
        if (!await confirmation('Limpar cache público?', `${label}: a próxima consulta busca de novo na origem (respeita os limites globais).`)) return;
        try { await call('/operations/cache/clear', { method: 'POST', body: JSON.stringify({ target }) }); notice('Cache limpo.'); render(); } catch (error) { notice(error.message, true); }
    } }, label);
    const recoverOrigin = (originName) => el('button', { onclick: async () => {
        if (!await confirmation('Reabrir circuito de origem?', `Zera a contagem de falhas de ${ORIGIN_LABELS[originName] || originName} para permitir nova consulta imediata.`)) return;
        try { await call(`/operations/origins/${originName}/recover`, { method: 'POST' }); notice('Circuito reaberto.'); render(); } catch (error) { notice(error.message, true); }
    } }, 'Reabrir circuito');
    const maintMessage = el('input', { maxlength: 240, value: live.maintenance_message || '', placeholder: 'O Followw está em manutenção. Volte em alguns minutos.', disabled: !hasPermission('owner') });
    const toggleMaintenance = async (next) => {
        if (!await confirmation(next ? 'Ligar o modo de manutenção?' : 'Desligar o modo de manutenção?', next ? 'O app responderá 503 com a mensagem informada até você desligar. Exige MFA recente.' : 'O app volta a atender imediatamente.')) return;
        try { await call('/operations/maintenance', { method: 'PUT', body: JSON.stringify({ enabled: next, message: maintMessage.value.trim() }) }); notice(next ? 'Manutenção ligada.' : 'Manutenção desligada.'); render(); } catch (error) { notice(error.message, true); }
    };
    const rateBackendLabel = rl.backend === 'redis' ? 'Redis compartilhado' : rl.backend === 'postgres' ? `PostgreSQL compartilhado (${fmt(rl.postgres_windows)} janelas em rate_windows)` : `Memória deste processo (${fmt(rl.memory_keys)} chaves)`;
    return [
        el('div', { class: 'toolbar' }, el('h2', { class: 'grow' }, 'Operações e atividade'), el('button', { onclick: render }, 'Atualizar')),
        el('p', { class: 'muted' }, 'Pedidos recebidos, não pessoas: o mesmo aluno gera vários pedidos e não há como contá-lo sem identificá-lo. Os números são deste processo e zeram ao reiniciar.'),
        el('div', { class: 'grid g4' },
            tile('Pedidos agora (em andamento)', fmt(a.in_flight)),
            tile('Pedidos por segundo (último minuto)', fmt(a.requests_per_second)),
            tile('Pedidos nos últimos 5 min', fmt(a.last_5_minutes)),
            tile('Pedidos nos últimos 15 min', fmt(a.last_15_minutes))),
        el('div', { class: 'grid g4' },
            tile('Pedidos na última hora', fmt(a.last_hour)),
            tile('Pedidos em 24 h', fmt(a.last_24_hours)),
            tile('Erros 5xx em 24 h', fmt(a.errors_24_hours), a.errors_24_hours > 0),
            tile('Latência p50 / p95 / p99', `${ms(a.latency_ms.p50)} / ${ms(a.latency_ms.p95)} / ${ms(a.latency_ms.p99)}`)),
        el('div', { class: 'panel' }, el('h3', {}, 'Erros por módulo (24 h)'),
            modules.length
                ? tableWrap(el('table', {}, el('tbody', {}, modules.map(([name, n]) => row(name, fmt(n))))))
                : el('p', { class: 'muted' }, 'Nenhum erro 5xx nas últimas 24 horas neste processo.')),
        el('div', { class: 'grid g2' },
            el('div', { class: 'panel' }, el('h3', {}, 'PostgreSQL e pools de sessão'),
                tableWrap(el('table', {}, el('tbody', {},
                    row('Conexões (ativas visíveis / total / máximo)', `${fmt(db.active)} / ${fmt(db.connections)} / ${fmt(db.max_connections)}`),
                    row('Locks esperando / advisory locks ativos', `${fmt(db.waiting_locks)} / ${fmt(sl.active_advisory_locks)}`),
                    row('Tamanho do banco', bytes(db.size_bytes)),
                    row('Pool principal (em uso / ociosas / tamanho)', pool.size === undefined ? 'sem dados' : `${fmt(pool.in_use)} / ${fmt(pool.idle)} / ${fmt(pool.size)} (+${fmt(pool.overflow)})`),
                    row('Pool session_lock (em uso / tamanho + overflow)', `${fmt(sl.in_use)} / ${fmt(sl.size)} (+${fmt(sl.overflow)}/${fmt(sl.max_overflow)}) · ${sl.backend || '—'}`))))),
            el('div', { class: 'panel' }, el('h3', {}, 'Processo, pool HTTP SIGAA e cotas'),
                tableWrap(el('table', {}, el('tbody', {},
                    row('PID / pai', `${p.pid} / ${p.parent_pid ?? '—'}`),
                    row('Memória / threads / filhos', `${bytes(p.memory_bytes)} / ${p.threads} / ${fmt(p.children)}`),
                    row('No ar há / ambiente', `${Math.floor(a.uptime_seconds / 60)} min · ${live.environment}`),
                    row('Pool HTTP SIGAA (ativas / limite simultâneo)', `${fmt(hp.active_requests)} / ${fmt(hp.max_concurrent)} (saturações 503: ${fmt(hp.saturated)})`),
                    row('Keep-alive HTTP SIGAA (keepalive / máx.)', `${fmt(hp.keepalive_connections)} / ${fmt(hp.max_connections)}`),
                    row('Backend de cotas anti-abuso', rateBackendLabel)))))),
        el('div', { class: 'panel' }, el('h3', {}, 'SIGAA/UnB públicos, circuitos e cache compartilhado'),
            tableWrap(el('table', {},
                el('thead', {}, el('tr', {}, ['Origem pública', 'Circuito', 'Consultas', 'Rejeições (aberto)', 'Ação'].map((h) => el('th', {}, h)))),
                el('tbody', {}, Object.entries(ORIGIN_LABELS).map(([key, label]) => {
                    const orig = live.origins[key] || { circuit: 'closed', origin_calls: 0, circuit_rejections: 0 };
                    return el('tr', {},
                        el('td', {}, label),
                        el('td', {}, el('span', { class: `badge ${orig.circuit === 'closed' ? 'ok' : 'warn'}` }, CIRCUIT[orig.circuit] || orig.circuit)),
                        el('td', { class: 'num' }, fmt(orig.origin_calls)),
                        el('td', { class: 'num' }, fmt(orig.circuit_rejections)),
                        el('td', {}, orig.circuit !== 'closed' ? recoverOrigin(key) : el('span', { class: 'muted' }, 'Normal')));
                })))),
            tableWrap(el('table', {}, el('tbody', {},
                row('Taxa de acerto do cache em memória', c.hit_rate === null ? 'sem dados' : `${(c.hit_rate * 100).toFixed(0)}% (${fmt(c.hits)} acertos, ${fmt(c.misses)} falhas)`),
                row('Respostas da cópia vencida (origem fora do ar)', fmt(c.stale_served)),
                row('Pedidos compartilhados em SingleFlight', fmt(c.single_flight_shared))))),
            el('div', { class: 'toolbar' }, clear('units', 'Limpar unidades'), clear('classrooms', 'Limpar turmas'), clear('subjects', 'Limpar busca de matérias'), clear('all', 'Limpar tudo'))),
        bannerPanel(live.banner, render),
        el('div', { class: 'panel' }, el('h3', {}, 'Modo de manutenção'),
            el('p', { class: 'muted' }, 'Com o modo ligado, o app responde 503 a todos com a mensagem abaixo; o painel continua aberto. Vale em até 5 s em todos os processos.'),
            el('p', {}, live.maintenance ? 'Ligado agora.' : 'Desligado.'),
            el('label', {}, 'Mensagem exibida durante a manutenção', maintMessage),
            hasPermission('owner')
                ? el('div', { class: 'toolbar' },
                    el('button', { class: live.maintenance ? 'primary' : 'danger', onclick: () => toggleMaintenance(!live.maintenance) }, live.maintenance ? 'Desligar manutenção' : 'Ligar manutenção'),
                    live.maintenance ? el('button', { type: 'button', onclick: () => toggleMaintenance(true) }, 'Atualizar mensagem') : null)
                : el('p', { class: 'muted' }, 'Só o Owner liga e desliga.')),
        el('div', { class: 'panel' }, el('h3', {}, 'Reiniciar serviços'),
            el('p', { class: 'muted' }, `${live.restart.reason} Não existe botão de reiniciar de propósito: o painel nunca recebe controle sobre o servidor.`)),
    ];
}
