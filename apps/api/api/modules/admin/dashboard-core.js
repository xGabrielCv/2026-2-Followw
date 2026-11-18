export const $ = (selector) => document.querySelector(selector);
export const base = location.pathname.replace(/\/+$/, '') + '/api';
let readSignal;
let user;

export const setReadSignal = (signal) => { readSignal = signal; };
export const currentUser = () => user;
export const setUser = (value) => { user = value; };
export const hasPermission = (permission) => Boolean(user?.permissions?.includes(permission));
export const ROLES = { moderator: 'Moderador', administrator: 'Administrador', owner: 'Owner' };

export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'widthPercent') node.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
        if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

export async function call(path, options = {}, _retried = false) {
    const headers = { ...options.headers, 'X-Admin-Request': '1' };
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, { ...options, signal: options.signal ?? ((!options.method || options.method === 'GET') ? readSignal : undefined), headers, credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401 && response.headers.get('X-Admin-Session') === 'expired') document.dispatchEvent(new Event('admin:expired'));
    if (response.status === 403 && response.headers.get('X-Admin-Step-Up') === 'mfa' && !_retried && path !== '/self/mfa-check') {
        const renewed = await promptStepUpMfa();
        if (renewed) return call(path, options, true);
    }
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.detail === 'string' ? body.detail : `Não foi possível concluir (${response.status}). Confira os campos e tente novamente.`);
    }
    return response.status === 204 ? null : response.json();
}

export function promptStepUpMfa() {
    return new Promise((resolve) => {
        const dialog = $('#confirmation');
        let ok = false;
        const input = el('input', { 'aria-label': 'Código MFA ou recuperação', placeholder: 'Código de 6 dígitos ou recuperação', autocomplete: 'one-time-code', maxlength: 64, required: true });
        const error = el('p', { class: 'error', role: 'alert' });
        const submit = el('button', { class: 'primary', type: 'submit' }, 'Validar MFA');
        const form = el('form', { onsubmit: async (event) => {
            event.preventDefault();
            const code = input.value.trim().toLowerCase();
            if (!code) return;
            submit.disabled = true;
            error.textContent = '';
            try {
                await call('/self/mfa-check', { method: 'POST', body: JSON.stringify({ code }) }, true);
                ok = true;
                notice('MFA revalidado por mais 15 minutos.');
                dialog.close();
            } catch (failure) {
                error.textContent = failure.message;
            } finally {
                submit.disabled = false;
            }
        } }, el('h2', {}, 'Confirmar MFA recente'), el('p', { class: 'muted' }, 'Esta operação sensível exige confirmação de MFA nos últimos 15 minutos. Digite um código atual do autenticador ou de recuperação.'), el('label', { class: 'form-field' }, 'Código MFA', input), error, el('div', { class: 'toolbar' }, el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancelar'), submit));
        dialog.replaceChildren(form);
        dialog.addEventListener('close', () => { dialog.replaceChildren(); resolve(ok); }, { once: true });
        if (!dialog.open) dialog.showModal();
    });
}

export function notice(message, error = false) {
    const output = $('#notice');
    output.textContent = message;
    output.classList.toggle('error', error);
    output.hidden = false;
}

export function openDrawer(...children) {
    const drawer = $('#drawer');
    drawer.replaceChildren(el('button', { class: 'drawer-close ghost', type: 'button', 'aria-label': 'Fechar detalhes', onclick: closeDrawer }, 'Fechar ×'), ...children);
    if (!drawer.open) drawer.showModal();
}
export function closeDrawer() { $('#drawer').close(); $('#drawer').replaceChildren(); }

export function confirmation(title, description, { reason = false, text = '', label = 'Confirmar' } = {}) {
    return new Promise((resolve) => {
        const dialog = $('#confirmation');
        let answer = null;
        const input = reason ? el('textarea', { maxlength: 300, rows: 3, placeholder: 'Motivo sem dados pessoais', 'aria-label': 'Motivo' }) : text ? el('input', { 'aria-label': 'Confirmação textual', placeholder: `Digite ${text}`, autocomplete: 'off' }) : null;
        dialog.replaceChildren(el('h2', {}, title), el('p', { class: 'muted' }, description), input,
            el('div', { class: 'toolbar' }, el('button', { onclick: () => dialog.close() }, 'Cancelar'),
                el('button', { class: 'primary', onclick: () => { if (text && input.value.trim() !== text) { notice(`Digite ${text} para confirmar.`, true); return; } answer = reason ? input.value.trim() : true; dialog.close(); } }, label)));
        dialog.addEventListener('close', () => { dialog.replaceChildren(); resolve(answer); }, { once: true });
        dialog.showModal();
    });
}

export function safeCsvCell(value) {
    const raw = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    const neutralized = /^\s*[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${neutralized.replaceAll('"', '""')}"`;
}

export function downloadData(filename, rows, format = 'json') {
    if (!rows.length) { notice('Não há registros para exportar.', true); return; }
    let content, mime;
    if (format === 'csv') {
        const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
        const lines = [columns.map(safeCsvCell).join(','), ...rows.map((row) => columns.map((col) => safeCsvCell(row[col])).join(','))];
        content = '\uFEFF' + lines.join('\r\n');
        mime = 'text/csv;charset=utf-8';
    } else {
        content = JSON.stringify(rows, null, 2);
        mime = 'application/json;charset=utf-8';
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `${filename}.${format}` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const when = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
