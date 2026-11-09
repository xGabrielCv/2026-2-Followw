import { call, confirmation, el, hasPermission, notice } from './dashboard-core.js';

const fmt = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('pt-BR').format(n));
const bytes = (n) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${u[i]}`; };
const tile = (label, value, warn) => el('div', { class: `panel tile${warn ? ' warn' : ''}` }, el('div', { class: 'value' }, value), el('div', { class: 'label' }, label));
const ms = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)} ms`);
const row = (label, value) => el('tr', {}, el('td', {}, label), el('td', { class: 'num' }, value));
const CIRCUIT = { closed: 'fechado (saudável)', open: 'aberto (usando cache)', half_open: 'testando a origem' };

// Atividade e infraestrutura reais deste processo, sem identificar ninguém. Nada aqui é estimado.
export async function operationsView(render) {
    const live = await call('/operations/live');
    const a = live.activity, db = live.database, p = live.process, pool = live.pool, c = live.cache, ru = live.origins.ru;
    const modules = Object.entries(a.errors_by_module_24_hours);
    const clear = (target, label) => el('button', { onclick: async () => {
        if (!await confirmation('Limpar cache público?', `${label}: a próxima consulta busca de novo na origem (respeita os limites globais).`)) return;
        try { await call('/operations/cache/clear', { method: 'POST', body: JSON.stringify({ target }) }); notice('Cache limpo.'); render(); } catch (error) { notice(error.message, true); }
    } }, label);
    const toggleMaintenance = async () => {
        const next = !live.maintenance;
        if (!await confirmation(next ? 'Ligar o modo de manutenção?' : 'Desligar o modo de manutenção?', next ? 'Ninguém conseguirá usar o app até você desligar. Exige MFA recente.' : 'O app volta a atender.')) return;
        try { await call('/operations/maintenance', { method: 'PUT', body: JSON.stringify({ enabled: next }) }); notice(next ? 'Manutenção ligada.' : 'Manutenção desligada.'); render(); } catch (error) { notice(error.message, true); }
    };
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
                ? el('table', {}, el('tbody', {}, modules.map(([name, n]) => row(name, fmt(n)))))
                : el('p', { class: 'muted' }, 'Nenhum erro 5xx nas últimas 24 horas neste processo.')),
        el('div', { class: 'grid g2' },
            el('div', { class: 'panel' }, el('h3', {}, 'PostgreSQL'),
                el('table', {}, el('tbody', {},
                    row('Conexões (ativas / total / máximo)', `${fmt(db.active)} / ${fmt(db.connections)} / ${fmt(db.max_connections)}`),
                    row('Locks esperando', fmt(db.waiting_locks)),
                    row('Tamanho do banco', bytes(db.size_bytes)),
                    row('Pool deste processo (em uso / ociosas / tamanho)', pool.size === undefined ? 'sem dados' : `${fmt(pool.in_use)} / ${fmt(pool.idle)} / ${fmt(pool.size)}`)))),
            el('div', { class: 'panel' }, el('h3', {}, 'Processo da API'),
                el('table', {}, el('tbody', {},
                    row('PID / pai', `${p.pid} / ${p.parent_pid ?? '—'}`),
                    row('Memória / threads', `${bytes(p.memory_bytes)} / ${p.threads}`),
                    row('Processos filhos', fmt(p.children)),
                    row('No ar há', `${Math.floor(a.uptime_seconds / 60)} min`),
                    row('Redis', live.redis.configured ? 'configurado' : 'não configurado (cotas em memória)'),
                    row('Ambiente', live.environment))))),
        el('div', { class: 'panel' }, el('h3', {}, 'SIGAA/UnB públicos e cache compartilhado'),
            el('table', {}, el('tbody', {},
                row('Circuito do RU', CIRCUIT[ru.circuit] || ru.circuit),
                row('Consultas à origem (RU) / atendidas sem nova consulta', `${fmt(ru.origin_calls)} / ${fmt(ru.shared_requests)}`),
                row('Taxa de acerto do cache', c.hit_rate === null ? 'sem dados' : `${(c.hit_rate * 100).toFixed(0)}% (${fmt(c.hits)} acertos, ${fmt(c.misses)} falhas)`),
                row('Respostas da cópia vencida (origem fora do ar)', fmt(c.stale_served)),
                row('Pedidos que esperaram uma consulta em andamento', fmt(c.single_flight_shared)))),
            el('div', { class: 'toolbar' }, clear('units', 'Limpar unidades'), clear('classrooms', 'Limpar turmas'), clear('all', 'Limpar tudo'))),
        el('div', { class: 'panel' }, el('h3', {}, 'Modo de manutenção'),
            el('p', { class: 'muted' }, 'Com o modo ligado, o app responde 503 "em manutenção" a todos; o painel continua aberto. Vale em até 5 s em todos os processos.'),
            el('p', {}, live.maintenance ? 'Ligado agora.' : 'Desligado.'),
            hasPermission('owner')
                ? el('button', { class: live.maintenance ? 'primary' : 'danger', onclick: toggleMaintenance }, live.maintenance ? 'Desligar manutenção' : 'Ligar manutenção')
                : el('p', { class: 'muted' }, 'Só o Owner liga e desliga.')),
        el('div', { class: 'panel' }, el('h3', {}, 'Reiniciar serviços'),
            el('p', { class: 'muted' }, `${live.restart.reason} Não existe botão de reiniciar de propósito: o painel nunca recebe controle sobre o servidor.`)),
    ];
}
