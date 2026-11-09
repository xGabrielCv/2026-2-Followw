import { call, closeDrawer, currentUser, el, hasPermission, notice, openDrawer, when } from './dashboard-core.js';

const STATUS = { open: 'Aberto', in_review: 'Em análise', waiting_student: 'Aguardando aluno', answered: 'Respondido', resolved: 'Resolvido', closed: 'Encerrado' };
const CATEGORY = { bug: 'Problema no app', help: 'Ajuda', suggestion: 'Sugestão', praise: 'Elogio', complaint: 'Reclamação', review_question: 'Questionar avaliação', material_problem: 'Problema em material', group_problem: 'Problema em grupo', moderation_review: 'Revisão de moderação', other: 'Outro' };
const PRIORITY = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const SENDER = { student: 'Aluno', staff: 'Atendimento', note: 'Nota interna' };
const filters = { status: '', category: '', priority: '', assignee: '', q: '', page: 1 };

const select = (label, key, options) => el('label', {}, label,
    el('select', { onchange: (event) => { filters[key] = event.target.value; filters.page = 1; filters.refresh(); } },
        el('option', { value: '' }, 'Todos'),
        Object.entries(options).map(([value, text]) => el('option', { value, selected: filters[key] === value }, text))));

async function open(id, render) {
    const ticket = await call(`/tickets/${id}`);
    const field = el('textarea', { rows: 4, maxlength: 4000, 'aria-label': 'Mensagem', placeholder: 'Resposta ao aluno ou nota interna' });
    const status = el('select', { 'aria-label': 'Estado depois da resposta' }, ['answered', 'waiting_student', 'resolved', 'closed'].map((value) => el('option', { value }, STATUS[value])));
    const outcome = el('select', { 'aria-label': 'Decisão do recurso' }, [['', 'Análise em andamento'], ['accepted', 'Recurso aceito'], ['rejected', 'Recurso não acolhido']].map(([value, label]) => el('option', { value }, label)));
    const send = async (path, body, message) => {
        if (field.value.trim().length < 5) return notice('Escreva ao menos 5 caracteres.', true);
        try { await call(`/tickets/${id}${path}`, { method: 'POST', body: JSON.stringify(body) }); notice(message); closeDrawer(); render(); }
        catch (error) { notice(error.message, true); }
    };
    const change = async (body) => {
        try { await call(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); notice('Chamado atualizado.'); closeDrawer(); render(); }
        catch (error) { notice(error.message, true); }
    };
    openDrawer(
        el('h2', {}, `#${ticket.number} · ${ticket.title}`),
        el('p', { class: 'muted' }, `${CATEGORY[ticket.category] || ticket.category} · aberto em ${when(ticket.created_at)}`
            + (ticket.related_type ? ` · refere-se a ${ticket.related_type} ${ticket.related_id}` : '')),
        ticket.category === 'moderation_review' ? el('p', { class: 'muted' }, `${ticket.appeal_author_proven ? 'Posse de credencial de autoria comprovada.' : 'Autoria não comprovada; pedido de revisão permitido.'} ${ticket.appeal_decision_id ? `Decisão vinculada: ${ticket.appeal_decision_id}. Outro integrante deve concluir o recurso da própria decisão.` : 'Sem decisão vinculada automaticamente; conferir a referência.'}`) : null,
        el('div', { class: 'toolbar' },
            el('label', {}, 'Prioridade', el('select', { onchange: (event) => change({ priority: event.target.value }) },
                Object.entries(PRIORITY).map(([value, text]) => el('option', { value, selected: ticket.priority === value }, text)))),
            el('span', { class: 'badge' }, STATUS[ticket.status]),
            el('span', { class: 'muted' }, ticket.assigned_name ? `Responsável: ${ticket.assigned_name}` : 'Sem responsável'),
            el('button', { onclick: () => change({ assign: true, assigned_to: null }), hidden: !ticket.assigned_to }, 'Liberar'),
            el('button', { onclick: () => change({ assign: true, assigned_to: currentUser()?.id }), hidden: !currentUser()?.id || ticket.assigned_to === currentUser()?.id }, 'Assumir')),
        el('div', { class: 'list' }, ticket.messages.map((m) => el('div', {}, el('div', { class: 'item' },
            el('span', { class: 'badge' }, SENDER[m.sender]), m.admin ? el('span', { class: 'muted' }, m.admin + ' · ') : null, el('span', { class: 'muted' }, when(m.created_at)),
            el('p', { class: 'pre' }, m.body))))),
        field,
        el('div', { class: 'toolbar' }, status,
            ticket.category === 'moderation_review' ? outcome : null,
            el('button', { class: 'primary', onclick: () => send('/reply', { body: field.value.trim(), status: status.value, appeal_outcome: outcome.value || null }, 'Resposta enviada ao aluno.') }, 'Responder ao aluno'),
            el('button', { onclick: () => send('/note', { body: field.value.trim() }, 'Nota interna salva.') }, 'Salvar nota interna'),
            el('button', { onclick: () => change({ status: 'in_review' }) }, 'Marcar em análise')));
}

export async function supportView(render) {
    filters.refresh = render;
    const params = new URLSearchParams({ page: String(filters.page), page_size: '25' });
    for (const key of ['status', 'category', 'priority', 'assignee', 'q']) if (filters[key]) params.set(key, filters[key]);
    const [page, summary] = await Promise.all([call(`/tickets?${params}`), call('/tickets/summary')]);
    const pages = Math.max(1, Math.ceil(page.total / page.page_size));
    return [
        el('div', { class: 'toolbar' }, el('h2', { class: 'grow' }, 'Chamados de suporte')),
        el('div', { class: 'grid g2' }, Object.entries(STATUS).map(([key, label]) =>
            el('div', { class: 'panel tile' }, el('div', { class: 'value' }, summary[key] ?? 0), el('div', { class: 'label' }, label)))),
        el('div', { class: 'panel' },
            el('div', { class: 'toolbar' },
                select('Estado', 'status', STATUS), select('Assunto', 'category', CATEGORY), select('Prioridade', 'priority', PRIORITY),
                select('Responsável', 'assignee', { me: 'Meus', none: 'Sem responsável' }),
                el('input', { type: 'search', 'aria-label': 'Buscar no título', placeholder: 'Buscar no título', value: filters.q, maxlength: 60,
                    onchange: (event) => { filters.q = event.target.value.trim(); filters.page = 1; render(); } })),
            page.items.length
                ? el('table', {}, el('thead', {}, el('tr', {}, ['Nº', 'Título', 'Assunto', 'Estado', 'Prioridade', 'Responsável', 'Atualizado'].map((h) => el('th', {}, h)))),
                    el('tbody', {}, page.items.map((t) => el('tr', { class: 'clickable', tabindex: 0, onclick: () => open(t.id, render), onkeydown: (event) => event.key === 'Enter' && open(t.id, render) },
                        el('td', {}, t.number), el('td', { class: 'clip' }, t.title), el('td', {}, CATEGORY[t.category]), el('td', {}, STATUS[t.status]),
                        el('td', {}, PRIORITY[t.priority]), el('td', {}, t.assigned_name || '—'), el('td', {}, when(t.updated_at))))))
                : el('p', { class: 'muted' }, 'Nenhum chamado com esses filtros.'),
            el('div', { class: 'toolbar' },
                el('button', { disabled: filters.page <= 1, onclick: () => { filters.page--; render(); } }, 'Anterior'),
                el('span', { class: 'muted' }, `Página ${filters.page} de ${pages} · ${page.total} chamados`),
                el('button', { disabled: filters.page >= pages, onclick: () => { filters.page++; render(); } }, 'Próxima'))),
        hasPermission('support') ? null : el('p', { class: 'muted' }, 'Seu cargo não atende chamados.'),
    ];
}
