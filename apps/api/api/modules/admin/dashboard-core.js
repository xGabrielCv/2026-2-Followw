export const $ = (selector) => document.querySelector(selector);
const base = location.pathname.replace(/\/+$/, '') + '/api';
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

export async function call(path, options = {}) {
    const headers = { ...options.headers, 'X-Admin-Request': '1' };
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, { ...options, signal: options.signal ?? ((!options.method || options.method === 'GET') ? readSignal : undefined), headers, credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401 && response.headers.get('X-Admin-Session') === 'expired') document.dispatchEvent(new Event('admin:expired'));
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.detail === 'string' ? body.detail : `Não foi possível concluir (${response.status}). Confira os campos e tente novamente.`);
    }
    return response.status === 204 ? null : response.json();
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

export function confirmation(title, description, { reason = false, label = 'Confirmar' } = {}) {
    return new Promise((resolve) => {
        const dialog = $('#confirmation');
        let answer = null;
        const input = reason ? el('textarea', { maxlength: 300, rows: 3, placeholder: 'Motivo sem dados pessoais', 'aria-label': 'Motivo' }) : null;
        dialog.replaceChildren(el('h2', {}, title), el('p', { class: 'muted' }, description), input,
            el('div', { class: 'toolbar' }, el('button', { onclick: () => dialog.close() }, 'Cancelar'),
                el('button', { class: 'primary', onclick: () => { answer = reason ? input.value.trim() : true; dialog.close(); } }, label)));
        dialog.addEventListener('close', () => { dialog.replaceChildren(); resolve(answer); }, { once: true });
        dialog.showModal();
    });
}

export const when = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
