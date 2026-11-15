import { call, confirmation, el, notice, when } from './dashboard-core.js';

export function alertPanel(info, refresh) {
  if (!info) return null;
  const cfg = info.config;
  const titleInput = el("input", { type:"text", value:cfg.title, maxlength:120, required:true });
  const messageInput = el("textarea", { rows:3, maxlength:600, required:true }, cfg.message);
  const presetSelect = el("select", { "aria-label":"Modelo de aviso" }, [
    ["custom", "Personalizado (Disparo manual)"],
    ["mid_semester", "50% do semestre"],
    ["last_day", "Último dia do semestre"],
    ["first_day", "Primeiro dia (Semestre anterior)"],
  ].map(([value, label]) => el("option", { value, selected: cfg.preset === value }, label)));
  presetSelect.addEventListener("change", () => {
    const preset = info.presets?.[presetSelect.value];
    if (!preset) return;
    titleInput.value = preset.title;
    messageInput.value = preset.message;
  });
  const enabledInput = el("input", { type:"checkbox", checked: cfg.enabled });
  const alwaysOnInput = el("input", { type:"checkbox", checked: cfg.always_on });
  const midEnabledInput = el("input", { type:"checkbox", checked: cfg.mid_semester_enabled });
  const midEveryNInput = el("input", { type:"number", min:1, max:20, step:1, value: cfg.mid_semester_every_n ?? 3, required:true });
  const midTitleInput = el("input", { type:"text", value: cfg.mid_semester_title, maxlength:120, required:true });
  const midMessageInput = el("textarea", { rows:2, maxlength:600, required:true }, cfg.mid_semester_message);
  const lastDayEnabledInput = el("input", { type:"checkbox", checked: cfg.last_day_enabled ?? true });
  const lastDayTitleInput = el("input", { type:"text", value: cfg.last_day_title || "Último dia do semestre: avalie seus professores", maxlength:120, required:true });
  const lastDayMessageInput = el("textarea", { rows:2, maxlength:600, required:true }, cfg.last_day_message || "Último dia letivo do semestre! Avalie seus professores e compartilhe as estatísticas das suas turmas anonimamente.");
  const firstDayEnabledInput = el("input", { type:"checkbox", checked: cfg.first_day_enabled ?? true });
  const firstDayTitleInput = el("input", { type:"text", value: cfg.first_day_title || "Avalie seus professores do semestre anterior", maxlength:120, required:true });
  const firstDayMessageInput = el("textarea", { rows:2, maxlength:600, required:true }, cfg.first_day_message || "Novo semestre começando! Aproveite para avaliar seus professores do semestre anterior e ajudar os colegas.");
  const readPayload = () => ({
    enabled: enabledInput.checked,
    always_on: alwaysOnInput.checked,
    preset: presetSelect.value,
    title: titleInput.value.trim(),
    message: messageInput.value.trim(),
    mid_semester_enabled: midEnabledInput.checked,
    mid_semester_every_n: Number(midEveryNInput.value),
    mid_semester_title: midTitleInput.value.trim(),
    mid_semester_message: midMessageInput.value.trim(),
    last_day_enabled: lastDayEnabledInput.checked,
    last_day_title: lastDayTitleInput.value.trim(),
    last_day_message: lastDayMessageInput.value.trim(),
    first_day_enabled: firstDayEnabledInput.checked,
    first_day_title: firstDayTitleInput.value.trim(),
    first_day_message: firstDayMessageInput.value.trim(),
    trigger_id: cfg.trigger_id,
    triggered_at: cfg.triggered_at,
  });
  const version = (title, explanation, ...fields) => el("details", { class:"alert-version" },
    el("summary", {}, title), el("p", { class:"muted" }, explanation), ...fields);
  const form = el("form", { class:"panel alert-settings", onsubmit:(event) => event.preventDefault() },
    el("h3", {}, "Lembretes de avaliações e compartilhamento"),
    el("p", { class:"muted" }, "Convide estudantes a avaliar docentes e, se quiserem, compartilhar índices das turmas. A participação é opcional. Nenhuma avaliação ou estatística é enviada automaticamente."),
    el("div", { class:"alert-status" },
      el("strong", {}, `Semestre: ${info.current_semester}`),
      el("span", {}, info.progress_percent != null ? `${info.progress_percent}% do período de aulas` : "Datas oficiais ainda indisponíveis: lembretes automáticos aguardam calendário"),
      el("span", { class:"muted" }, cfg.triggered_at ? `Última campanha: ${when(cfg.triggered_at)}` : "Nenhuma campanha manual disparada")),
    el("div", { class:"grid g2" },
      el("label", { class:"switch" }, el("span", {}, "Ativar lembretes"), enabledInput),
      el("label", { class:"switch" }, el("span", {}, "Forçar exibição para teste"), alwaysOnInput)),
    el("p", { class:"muted" }, "Desativar lembretes interrompe os convites, inclusive o modo de teste. Ativo, o teste permite abrir sem avaliações pendentes. Alterações chegam ao app em até um minuto ou ao voltar à aba. Fechar vale para esta sessão; ‘Não mostrar novamente’ vale para a versão ou campanha neste aparelho."),
    el("h4", {}, "Lembretes automáticos"),
    el("p", { class:"muted" }, "Usam as datas publicadas do semestre, sem precisar trocar o ano. Só aparecem para estudantes autenticados com avaliações pendentes. O primeiro dia tem prioridade, seguido do último dia, campanha manual e metade do semestre."),
    version("Metade do semestre", "A partir de 50% do período de aulas, na primeira abertura e depois a cada N novas sessões do navegador.",
      el("label", { class:"switch" }, el("span", {}, "Ativar aviso aos 50%+ do semestre"), midEnabledInput),
      el("div", { class:"grid g2" },
        el("label", { class:"form-field" }, "Intervalo entre exibições (sessões)", midEveryNInput),
        el("label", { class:"form-field" }, "Título", midTitleInput)),
      el("label", { class:"form-field" }, "Mensagem", midMessageInput)),
    version("Último dia de aulas", "Convida a avaliar os docentes das turmas atuais no último dia letivo publicado.",
      el("label", { class:"switch" }, el("span", {}, "Ativar no último dia do semestre"), lastDayEnabledInput),
      el("label", { class:"form-field" }, "Título", lastDayTitleInput),
      el("label", { class:"form-field" }, "Mensagem", lastDayMessageInput)),
    version("Primeiro dia de aulas", "Convida a avaliar docentes do semestre regular anterior. Usa o histórico lido pelo navegador, sem guardar turmas pessoais no servidor.",
      el("label", { class:"switch" }, el("span", {}, "Ativar no primeiro dia do semestre"), firstDayEnabledInput),
      el("label", { class:"form-field" }, "Título", firstDayTitleInput),
      el("label", { class:"form-field" }, "Mensagem", firstDayMessageInput)),
    el("h4", {}, "Campanha manual"),
    el("p", { class:"muted" }, "Salvar altera os textos e regras. Disparar cria uma nova campanha para a próxima abertura dos estudantes elegíveis; não envia notificações e não reabre uma sessão que já fechou o aviso."),
    el("div", { class:"grid g2" },
      el("label", {}, "Modelo rápido (disparo manual)", presetSelect),
      el("label", { class:"form-field" }, "Título da campanha", titleInput)),
    el("label", { class:"form-field" }, "Mensagem da campanha", messageInput),
    el("div", { class:"toolbar" },
      el("button", { class:"primary", type:"button", onclick:async () => {
        if (!form.reportValidity()) return;
        try {
          await call("/alert", { method:"PUT", body:JSON.stringify(readPayload()) });
          notice("Configuração do aviso salva.");
          void refresh();
        } catch (error) { notice(error.message, true); }
      } }, "Salvar configuração"),
      el("button", { type:"button", onclick:async () => {
        if (!form.reportValidity()) return;
        if (!await confirmation("Disparar aviso agora?", "Gera uma nova campanha: mesmo quem clicou em 'Não mostrar novamente' verá este aviso (a menos que já tenha avaliado todos os professores do semestre atual).")) return;
        try {
          await call("/alert", { method:"PUT", body:JSON.stringify(readPayload()) });
          await call("/alert/trigger", { method:"POST", body:JSON.stringify({ title: titleInput.value.trim(), message: messageInput.value.trim() }) });
          notice("Nova campanha disponível na próxima abertura dos estudantes elegíveis.");
          void refresh();
        } catch (error) { notice(error.message, true); }
      } }, "Disparar campanha")));
  return form;
}
