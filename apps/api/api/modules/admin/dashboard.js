import { $, call, closeDrawer, confirmation, currentUser, el, hasPermission, notice, openDrawer, setReadSignal, when } from './dashboard-core.js';
import { initializeAuth } from './dashboard-auth.js';
import { accountsView, securityView } from './dashboard-accounts.js';
import { supportView } from './dashboard-support.js';
import { statisticsPanel } from './dashboard-statistics.js';
import { operationsView } from './dashboard-operations.js';
import { auditView } from './dashboard-audit.js';
import { limitsView } from './dashboard-limits.js';
import { moderationView } from './dashboard-moderation.js';

const LABELS = { review:"Avaliações", group:"Grupos", material:"Materiais", post:"Publicações", reply:"Respostas", tutorial:"Guias", report:"Denúncias" };
const REASONS = { ofensivo:"Ofensivo", dados_pessoais:"Expõe alguém", spam:"Spam", falso:"Falso", direitos_autorais:"Direitos autorais", outro:"Outro" };
const STATUS = { pending:"Pendentes", accepted:"Aceitas", rejected:"Recusadas", approved:"Aprovados" };
const state = { view:"overview", days:30, metric:"alunos ativos", data:{ kind:"review", page:1, q:"", status:"", subject:"", days:"" }, reports:"pending", tutorials:"pending" };

const svg = (tag, attrs = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};
const fmt = (n) => new Intl.NumberFormat("pt-BR").format(n);
const bytes = (n) => { const u = ["B","KB","MB","GB","TB"]; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${u[i]}`; };
const duration = (s) => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}min` : `${m}min`; };

let rendering = 0;
let readController;
try {
    const savedTheme = JSON.parse(localStorage.getItem('followw:theme') || 'null');
    if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.dataset.theme = savedTheme;
} catch {}
$('#theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('followw:theme', JSON.stringify(dark ? 'light' : 'dark')); } catch {}
});
for (const button of document.querySelectorAll('nav [data-view]')) {
    button.addEventListener('click', () => {
        state.view = button.dataset.view;
        history.replaceState(null, '', '#' + state.view);
        void render();
    });
}

async function render() {
  const version = ++rendering;
  readController?.abort();
  readController = new AbortController();
  setReadSignal(readController.signal);
  for (const button of document.querySelectorAll("nav [data-view]")) {
    if (button.dataset.view === state.view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const main = $("#main");
  main.replaceChildren(el("p", { class:"muted" }, "Carregando…"));
  try {
    const views = { overview, usage, moderation: () => moderationView(render, editTutorial), data, breakdown, system, audit: () => auditView(render), limits: () => limitsView(render), accounts: () => accountsView(render), security: securityView, support: () => supportView(render), operations: () => operationsView(render) };
    const children = await views[state.view]();
    if (version !== rendering) return;
    // `null` vira o texto "null" no DOM: só entram nós de verdade
    main.replaceChildren(...children.filter(Boolean));
  } catch (error) {
    if (version !== rendering || error.name === 'AbortError') return;
    main.replaceChildren(el('section', { class: 'panel error' }, el('h2', {}, 'Não foi possível carregar'), el('p', {}, error.message), el('button', { onclick: render }, 'Tentar novamente')));
  }
  void updatePending();
}

async function updatePending() {
  try {
    const o = await call("/moderation/summary");
    const total = o.reports + o.tutorials;
    $("#pending-count").hidden = !total;
    $("#pending-count").textContent = total;
  } catch {}
}

function tile(label, value, warn) {
  return el("div", { class:`panel tile${warn ? " warn" : ""}` }, el("div", { class:"value" }, value), el("div", { class:"label" }, label));
}

function header(title, ...actions) {
  return el("div", { class:"toolbar" }, el("h2", { class:"grow" }, title), ...actions);
}

function barChart(labels, values, { format = fmt, height = 220 } = {}) {
  const width = 900, pad = { l:40, r:8, t:10, b:26 };
  const chart = svg("svg", { class:"chart", viewBox:`0 0 ${width} ${height}`, role:"img", "aria-label":"Gráfico de barras" });
  const peak = Math.max(1, ...values);
  // eixo com rótulos inteiros e sem repetição: até 4 marcas, só valores redondos
  const marks = peak <= 4 ? peak : 4;
  const max = peak <= 4 ? peak : Math.ceil(peak / 4) * 4;
  const step = (width - pad.l - pad.r) / Math.max(1, values.length);
  for (let i = 0; i <= marks; i++) {
    const y = pad.t + (height - pad.t - pad.b) * (1 - i / marks);
    chart.append(svg("line", { class:"gridline", x1:pad.l, x2:width - pad.r, y1:y, y2:y }));
    const label = svg("text", { x:pad.l - 6, y:y + 4, "text-anchor":"end" });
    label.textContent = fmt(Math.round(max * i / marks));
    chart.append(label);
  }
  const every = Math.ceil(values.length / 12);
  values.forEach((value, i) => {
    const h = (height - pad.t - pad.b) * (value / max);
    const x = pad.l + i * step;
    const hit = svg("rect", { class:"hit", x, y:pad.t, width:step, height:height - pad.t - pad.b, fill:"transparent" });
    const bar = svg("rect", { class:"bar", x:x + step * 0.15, y:height - pad.b - h, width:Math.max(1, step * 0.7), height:Math.max(0, h), rx:Math.min(4, step * 0.3) });
    const show = (event) => tooltip(event, `${labels[i]}: ${format(value)}`);
    for (const target of [hit, bar]) { target.addEventListener("mousemove", show); target.addEventListener("mouseleave", hideTooltip); }
    chart.append(hit, bar);
    if (i % every === 0) {
      const label = svg("text", { x:x + step / 2, y:height - 8, "text-anchor":"middle" });
      label.textContent = labels[i].length > 7 ? labels[i].slice(5) : labels[i];
      chart.append(label);
    }
  });
  return chart;
}

function hbars(entries, labeler = (k) => k) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  if (!entries.length) return el("p", { class:"muted" }, "Sem dados ainda.");
  return el("div", { class:"hbars" }, entries.map(([key, n]) =>
    el("div", { class:"hbar" }, el("span", { class:"clip" }, labeler(key)),
      el("div", { class:"track" }, el("div", { class:"fill", widthPercent:(n / max * 100).toFixed(1) })),
      el("span", { class:"n" }, fmt(n)))));
}

function tooltip(event, text) {
  const tip = $("#tooltip");
  tip.textContent = text;
  tip.style.display = "block";
  tip.style.left = `${event.clientX + 12}px`;
  tip.style.top = `${event.clientY - 28}px`;
}
function hideTooltip() { $("#tooltip").style.display = "none"; }

async function overview() {
  const [o, s] = await Promise.all([call("/overview"), call("/series?days=30")]);
  const users = s.series["alunos ativos"];
  return [
    header("Visão geral", el("button", { onclick:render }, "Atualizar")),
    el("div", { class:"grid g4" },
      tile("Alunos ativos hoje", fmt(o.users["hoje"])),
      tile("Alunos nesta semana", fmt(o.users["esta semana"])),
      tile("Alunos neste mês", fmt(o.users["este mês"])),
      tile("Pendências de moderação", fmt(o.pending["denúncias"] + o.pending["guias"]), o.pending["denúncias"] + o.pending["guias"] > 0)),
    el("div", { class:"panel" }, el("h3", {}, "Alunos ativos por dia (30 dias)"),
      el("p", { class:"muted" }, "Contados por chaves anônimas por dia: dá para saber quantos, nunca quem."),
      barChart(s.days, users)),
    el("div", { class:"grid g4" }, Object.entries(o.counts).map(([label, n]) => tile(label, fmt(n)))),
    el("div", { class:"grid g3" },
      tile("Banco de dados", bytes(o.database_bytes)),
      tile("Arquivos de materiais (cifrados)", bytes(o.materials_bytes)),
      tile("API no ar há", duration(o.uptime_seconds))),
    o.demo_data ? el("p", { class:"notice" }, "Dados de demonstração ligados (DEMO_DATA). Desligue em produção.") : null,
  ];
}

async function usage() {
  const s = await call(`/series?days=${state.days}`);
  const metrics = Object.keys(s.series);
  if (!metrics.includes(state.metric)) state.metric = metrics[0];
  const periods = el("div", { class:"tabs" }, [7, 30, 90, 180, 365].map((days) =>
    el("button", { "aria-pressed":String(state.days === days), onclick:() => { state.days = days; render(); } }, `${days} dias`)));
  const metric = el("select", { "aria-label":"Métrica", onchange:(e) => { state.metric = e.target.value; render(); } },
    metrics.map((m) => el("option", { value:m, selected:m === state.metric }, m)));
  const values = s.series[state.metric];
  const total = values.reduce((a, b) => a + b, 0);
  return [
    header("Uso", periods, metric),
    el("div", { class:"grid g3" },
      tile(`Total no período: ${state.metric}`, fmt(total)),
      tile("Média por dia", (total / values.length).toLocaleString("pt-BR", { maximumFractionDigits:1 })),
      tile("Maior dia", fmt(Math.max(0, ...values)))),
    el("div", { class:"panel" }, el("h3", {}, `${state.metric} por dia`), barChart(s.days, values)),
    el("div", { class:"grid g2" },
      el("div", { class:"panel" }, el("h3", {}, "Alunos únicos por semana"), barChart(s.weeks.map((w) => w.period), s.weeks.map((w) => w.users), { height:180 })),
      el("div", { class:"panel" }, el("h3", {}, "Alunos únicos por mês"), barChart(s.months.map((m) => m.period), s.months.map((m) => m.users), { height:180 }))),
    el("div", { class:"panel" }, el("h3", {}, "Totais no período"),
      el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Métrica"), el("th", { class:"num" }, "Total"))),
        el("tbody", {}, Object.entries(s.totals).map(([k, n]) => el("tr", {}, el("td", {}, k), el("td", { class:"num" }, fmt(n))))))),
  ];
}

function editTutorial(t) {
  const title = el("input", { value:t.title, maxlength:"120" });
  const summary = el("input", { value:t.summary, maxlength:"240" });
  const category = el("input", { value:t.category, maxlength:"24" });
  const body = el("textarea", { maxlength:"20000" }, t.body);
  const error = el("p", { class:"error" });
  openDrawer(el("h2", {}, "Editar guia"),
    el("label", {}, "Título", title), el("label", {}, "Resumo", summary), el("label", {}, "Categoria", category), el("label", {}, "Texto (Markdown)", body), error,
    el("div", { class:"toolbar" }, el("button", { class:"primary", onclick:async () => {
      try {
        await call(`/tutorials/${t.id}`, { method:"PUT", body:JSON.stringify({ title:title.value, summary:summary.value, category:category.value, body:body.value }) });
        closeDrawer(); render();
      } catch (e) { error.textContent = e.message; }
    } }, "Salvar"), el("button", { onclick:closeDrawer }, "Cancelar")));
}

async function data() {
  const d = state.data;
  const params = new URLSearchParams({ page:d.page, page_size:25 });
  for (const key of ["q", "status", "subject", "days"]) if (d[key]) params.set(key, d[key]);
  const page = await call(`/content/${d.kind}?${params}`);
  const kinds = el("div", { class:"tabs" }, Object.entries(LABELS).map(([kind, label]) =>
    el("button", { "aria-pressed":String(d.kind === kind), onclick:() => { Object.assign(d, { kind, page:1, status:"" }); render(); } }, label)));
  const q = el("input", { type:"search", placeholder:"Buscar no conteúdo (decifrado)", value:d.q, maxlength:"32" });
  const subject = el("input", { placeholder:"Matéria (ex.: FGA0030)", value:d.subject, maxlength:"16", size:"16" });
  const days = el("select", { "aria-label":"Período" }, [["", "Todo o período"], ["1", "Último dia"], ["7", "7 dias"], ["30", "30 dias"], ["90", "90 dias"], ["365", "1 ano"]].map(([v, l]) => el("option", { value:v, selected:d.days === v }, l)));
  const statuses = { tutorial:["", "pending", "approved", "rejected"], report:["", "pending", "accepted", "rejected"] }[d.kind];
  const status = statuses ? el("select", { "aria-label":"Situação" }, statuses.map((s) => el("option", { value:s, selected:d.status === s }, s ? STATUS[s] : "Todas as situações"))) : null;
  const apply = (e) => { e?.preventDefault(); Object.assign(d, { q:q.value.trim(), subject:subject.value.trim(), days:days.value, status:status?.value || "", page:1 }); render(); };
  const pages = Math.max(1, Math.ceil(page.total / page.page_size));
  return [
    header("Dados", kinds),
    el("form", { class:"toolbar", onsubmit:apply }, q, subject, days, status, el("button", { class:"primary", type:"submit" }, "Filtrar"),
      el("span", { class:"muted grow" }, `${fmt(page.total)} itens`)),
    el("div", { class:"panel" }, page.items.length ? el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, "Conteúdo"), el("th", {}, "Marcadores"), el("th", {}, "Criado em"), el("th", {}))),
      el("tbody", {}, page.items.map((row) => el("tr", { class:"click", tabindex:0, onkeydown:(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showDetail(d.kind, row.id); } }, onclick:() => showDetail(d.kind, row.id) },
        el("td", {}, el("strong", {}, row.title), row.detail ? el("div", { class:"muted clip" }, row.detail) : null),
        el("td", {}, row.tags.map((t) => el("span", { class:"badge" }, t))),
        el("td", {}, when(row.created_at)),
        el("td", {}, el("button", { class:"ghost", onclick:(e) => { e.stopPropagation(); remove(d.kind, row.id); } }, "Apagar"))))))
      : el("p", { class:"muted" }, "Nenhum item com estes filtros."),
      el("div", { class:"pager" },
        el("button", { disabled:d.page <= 1, onclick:() => { d.page--; render(); } }, "Anterior"),
        el("span", { class:"muted" }, `Página ${d.page} de ${pages}`),
        el("button", { disabled:d.page >= pages, onclick:() => { d.page++; render(); } }, "Próxima"))),
  ];
}

async function remove(kind, id) {
  const reason = await confirmation('Apagar este item?', 'Não dá para desfazer. Informe o motivo sem dados pessoais; ele fica no registro de auditoria.', { reason: true, label: 'Apagar conteúdo' });
  if (reason === null) return;
  try { await call(`/content/${kind}/${id}`, { method:"DELETE", body:JSON.stringify({ reason:reason || null }) }); closeDrawer(); render(); }
  catch (error) { notice(error.message, true); }
}

async function showDetail(kind, id) {
  const item = await call(`/content/${kind}/${id}`);
  openDrawer(
    el("div", { class:"toolbar" }, el("h2", { class:"grow" }, LABELS[kind]), el("button", { onclick:closeDrawer }, "Fechar")),
    el("p", { class:"muted" }, "Campos decifrados. Chaves anônimas de autoria ficam ocultas."),
    el("dl", {}, Object.entries(item).flatMap(([key, value]) => [el("dt", {}, key), el("dd", {}, value === null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value))])),
    el("div", { class:"toolbar" },
      kind === "material" ? el("a", { href:`${base}/materials/${id}/file`, download:"" }, el("button", {}, "Baixar arquivo")) : null,
      el("button", { class:"danger", onclick:() => remove(kind, id) }, "Apagar")));
}

async function breakdown() {
  const b = await call("/breakdown");
  const panel = (title, content) => el("div", { class:"panel" }, el("h3", {}, title), content);
  return [
    header("Distribuições"),
    el("div", { class:"grid g2" },
      panel("Notas das avaliações", barChart(b.ratings.map((_, i) => `${i * 10}–${i * 10 + (i === 9 ? 10 : 9)}`), b.ratings, { height:180 })),
      panel("Chamada, segundo as avaliações", hbars(Object.entries(b.attendance), (k) => ({ cobra:"Cobra", nao_cobra:"Não cobra", varia:"Varia", sem:"Não informado" }[k] || k))),
      panel("Matérias com mais conteúdo", hbars(b.top_subjects.map((s) => [s.code, s.items]))),
      panel("Materiais por tipo", hbars(Object.entries(b.materials_by_kind))),
      panel("Publicações por campus", hbars(Object.entries(b.posts_by_campus), (k) => k === "sem" ? "Todos os campi" : k)),
      panel("Publicações por tipo", hbars(Object.entries(b.posts_by_kind))),
      panel("Guias por categoria", hbars(Object.entries(b.tutorials_by_category))),
      panel("Denúncias por motivo", hbars(Object.entries(b.reports_by_reason), (k) => REASONS[k] || k))),
  ];
}

async function system() {
  const [o, health] = await Promise.all([call("/overview"), call("/health")]);
  const toggle = (key, enabled) => el("input", { type:"checkbox", checked:enabled, "aria-label":key, onchange:async (e) => {
    try { await call(`/flags/${key}`, { method:"PUT", body:JSON.stringify({ enabled:e.target.checked }) }); } catch (error) { notice(error.message, true); e.target.checked = !e.target.checked; }
  } });
  const FLAG_LABELS = { materials:"Envio de materiais", forum:"Novas dúvidas, posts e respostas", reviews:"Novas avaliações de docentes", groups:"Edição dos grupos das turmas", tutorials:"Envio de guias", reports:"Denúncias e pedidos de exclusão", telemetry:"Contagem opcional de uso (exige consentimento)" };
  const meter = (label, used, total, detail) => el("div", {}, el("div", { class:"toolbar" }, el("span", { class:"grow" }, label), el("span", { class:"muted" }, detail)),
    el("div", { class:"meter" }, el("span", { widthPercent:Math.min(100, used / Math.max(total, 1) * 100).toFixed(1) })));
  const sys = o.system;
  return [
    header("Sistema", el("button", { onclick:render }, "Atualizar")),
    el('section', { class: 'panel' }, el('div', { class: 'toolbar' }, el('h2', { class: 'grow' }, 'Saúde e latência'),
      hasPermission('owner') ? el('button', { onclick: async () => {
        if (!await confirmation('Zerar métricas deste processo?', 'Apenas contadores operacionais em memória serão zerados. A auditoria permanece intacta.')) return;
        try { await call('/metrics/reset', { method: 'POST' }); notice('Contadores operacionais zerados.'); render(); } catch (failure) { notice(failure.message, true); }
      } }, 'Zerar contadores') : null),
      el('p', { class: 'muted' }, `PostgreSQL respondeu em ${health.postgresql.latency_ms} ms. Percentis usam as últimas 200 requisições por rota deste processo. O reinício zera a memória; dados acadêmicos não entram nas métricas.`),
      el('p', { class: 'muted' }, Object.keys(health.metrics.origins).length ? Object.entries(health.metrics.origins).map(([name, value]) => `${name}: última tentativa ${value.state === 'failed' ? 'com falha' : 'conectada'} em ${when(value.last_at)}`).join(' · ') : 'Integrações institucionais: nenhuma tentativa observada nesta execução. Não fazemos consultas acadêmicas para medir disponibilidade.'),
      el('p', { class: 'muted' }, `Cardápio do RU: circuito ${{ closed: 'fechado (origem saudável)', open: 'aberto (usando cache)', half_open: 'testando a origem' }[health.origins.ru.circuit]} · ${fmt(health.origins.ru.origin_calls)} consultas à UnB · ${fmt(health.origins.ru.shared_requests)} pedidos atendidos sem nova consulta · ${fmt(health.origins.ru.stale_served)} respostas do cache vencido.`),
      el('p', { class: 'muted' }, health.pool.size === undefined ? 'Pool de conexões: sem dados neste ambiente.' : `Pool do banco: ${health.pool.in_use} em uso, ${health.pool.idle} ociosas, tamanho ${health.pool.size}, excedente ${health.pool.overflow}.`),
      el('table', {}, el('thead', {}, el('tr', {}, ['Rota', 'Pedidos', 'Erros 5xx', 'p50', 'p95'].map((label) => el('th', {}, label)))),
        el('tbody', {}, health.metrics.routes.slice(0, 15).map((row) => el('tr', {}, el('td', {}, `${row.method} ${row.route}`), el('td', {}, row.requests), el('td', {}, row.errors), el('td', {}, `${row.p50_ms} ms`), el('td', {}, `${row.p95_ms} ms`)))))) ,
    el("div", { class:"grid g2" },
      el("div", { class:"panel" }, el("h3", {}, "Funções do app"), el("p", { class:"muted" }, "Desligue uma função durante um ataque de spam ou manutenção; o app mostra o aviso."),
        Object.entries(o.flags).map(([key, enabled]) => el("label", { class:"switch" }, el("span", {}, FLAG_LABELS[key] || key), toggle(key, enabled)))),
      el("div", { class:"panel" }, el("h3", {}, "Recursos da instância"),
        el("p", { class:"muted" }, `${o.platform} · Python ${o.python} · ambiente ${o.environment}. Mede a máquina (ou o contêiner) onde a API roda: na VPS, a VPS.`),
        meter("CPU da máquina", sys.cpu_percent, 100, `${sys.cpu_percent.toFixed(0)}% de ${sys.cpus} núcleos · carga ${sys.load_1m.toFixed(2)}`),
        meter("Memória", sys.memory_used_bytes, sys.memory_total_bytes, `${bytes(sys.memory_used_bytes)} de ${bytes(sys.memory_total_bytes)}`),
        meter("Disco (pasta dos materiais)", sys.disk_total_bytes - sys.disk_free_bytes, sys.disk_total_bytes, `${bytes(sys.disk_free_bytes)} livres de ${bytes(sys.disk_total_bytes)}`),
        el("p", { class:"muted" }, `Processo da API: ${bytes(o.process.memory_bytes)} de memória, ${o.process.threads} threads, no ar há ${duration(o.uptime_seconds)} · máquina ligada há ${duration(sys.boot_seconds)}`),
        el("p", { class:"muted" }, `Banco: ${bytes(o.database_bytes)}, ${o.database_connections} conexões · materiais: ${fmt(o.materials_files)} arquivos, ${bytes(o.materials_bytes)}`))),
    el("div", { class:"grid g2" },
      el("div", { class:"panel" }, el("h3", {}, "Cartões do menu Mais"),
        el("p", { class:"muted" }, "Esconda ou mostre cada cartão para todos os alunos (vale em até 1 minuto). As ferramentas de matrícula extraordinária ficam ligadas só no período que você escolher."),
        o.menu.map((item) => el("label", { class:"switch" }, el("span", {}, item.label), el("input", { type:"checkbox", checked:item.visible, "aria-label":item.label, onchange:async (e) => {
          try { await call(`/menu/${item.key}`, { method:"PUT", body:JSON.stringify({ visible:e.target.checked }) }); } catch (error) { notice(error.message, true); e.target.checked = !e.target.checked; }
        } })))),
      el("div", { class:"panel" }, el("h3", {}, "Links das ferramentas"),
        el("p", { class:"muted" }, "Só links https. Sem link, a ferramenta ligada aparece como “em breve”."),
        o.texts.map((item) => {
          const input = el("input", { type:"url", value:item.value, placeholder:"https://", maxlength:"300", class:"grow" });
          const status = el("span", { class:"muted" });
          return el("div", { class:"switch" }, el("div", { class:"field-stack grow" }, el("span", {}, item.label),
            el("div", { class:"toolbar" }, input, el("button", { onclick:async () => {
              try { await call(`/texts/${item.key}`, { method:"PUT", body:JSON.stringify({ value:input.value.trim() }) }); status.textContent = "Salvo."; }
              catch (error) { status.textContent = error.message; }
            } }, "Salvar"), status)));
        }))),
    el("div", { class:"grid g2" },
      el("div", { class:"panel" }, el("h3", {}, "Armazenamento"),
        el("table", {}, el("tbody", {},
          el("tr", {}, el("td", {}, "Banco de dados (servidor)"), el("td", { class:"num" }, bytes(o.database_bytes))),
          el("tr", {}, el("td", {}, "Arquivos de materiais, cifrados (servidor)"), el("td", { class:"num" }, bytes(o.materials_bytes))))),
        el("p", { class:"muted" }, "Armazenamento dos aparelhos não é coletado. Consulte Uso de dados no próprio navegador. Backups operacionais dependem da rotina configurada pelo responsável pela instalação."),

        el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Tabela"), el("th", { class:"num" }, "Linhas"), el("th", { class:"num" }, "Tamanho"))),
          el("tbody", {}, o.tables.map((t) => el("tr", {}, el("td", {}, t.table), el("td", { class:"num" }, fmt(t.rows)), el("td", { class:"num" }, bytes(t.bytes))))))),
      el("div", { class:"panel" }, el("h3", {}, "Manutenção"),
        el("p", { class:"muted" }, "Apaga materiais fora dos 6 últimos semestres, registros de uso com mais de 400 dias e denúncias resolvidas há mais de 180 dias."),
        el("button", { class:"primary", hidden:!hasPermission('maintenance'), onclick:async (e) => {
          if (!await confirmation('Executar manutenção?', 'Materiais vencidos e contadores antigos serão removidos conforme a política de retenção. A auditoria administrativa é preservada.')) return;
          e.target.disabled = true;
          try { const r = await call("/maintenance", { method:"POST" }); notice(Object.entries(r).map(([k, n]) => `${k}: ${n}`).join("\n")); render(); }
          catch (error) { notice(error.message, true); e.target.disabled = false; }
        } }, "Rodar limpeza agora"))),
    statisticsPanel(render),
  ];
}

initializeAuth(() => {
    const requested = location.hash.slice(1);
    const permissions = { overview: 'operations', usage: 'operations', moderation: 'moderate', data: 'moderate', breakdown: 'operations', system: 'operations', audit: 'audit', limits: 'configure', accounts: 'accounts', support: 'support', operations: 'operations' };
    state.view = requested === 'security' || (requested in permissions && hasPermission(permissions[requested])) ? requested : hasPermission('operations') ? 'overview' : 'moderation';
    void render();
});
