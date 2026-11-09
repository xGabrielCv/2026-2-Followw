import { call, closeDrawer, confirmation, currentUser, el, hasPermission, notice, openDrawer, ROLES, when } from './dashboard-core.js';
import { showLogin, showRecovery } from './dashboard-auth.js';

const field = (label, input) => el('label', { class: 'form-field' }, label, input);

export async function accountsView(refresh) {
    const accounts = await call('/accounts');
    const create = () => {
        const username = el('input', { required: true, maxlength: 64, autocomplete: 'off', pattern: '[A-Za-z][A-Za-z0-9._\\-]{2,63}' });
        const password = el('input', { type: 'password', minlength: 12, maxlength: 256, required: true, autocomplete: 'new-password' });
        const role = el('select', {}, ['moderator', ...(hasPermission('owner') ? ['administrator'] : [])].map((value) => el('option', { value }, ROLES[value])));
        const error = el('p', { class: 'error', role: 'alert' });
        const submit = el('button', { type: 'submit', class: 'primary' }, 'Criar conta');
        openDrawer(el('h2', {}, 'Nova conta administrativa'), el('p', { class: 'muted' }, 'Use um pseudônimo sem matrícula ou e-mail. A pessoa precisará cadastrar seu próprio autenticador antes de acessar o painel.'),
            el('form', { onsubmit: async (event) => {
                event.preventDefault(); submit.disabled = true;
                try { await call('/accounts', { method: 'POST', body: JSON.stringify({ username: username.value.trim(), password: password.value, role: role.value }) }); password.value = ''; closeDrawer(); notice('Conta criada. MFA obrigatório no primeiro acesso.'); refresh(); }
                catch (failure) { error.textContent = failure.message; }
                finally { submit.disabled = false; }
            } }, field('Pseudônimo', username), field('Senha inicial (12+ caracteres)', password), field('Cargo', role), error, submit));
    };
    const manage = async (account, operation) => {
        const description = operation === 'revoke' ? 'Todos os acessos dessa conta serão encerrados.' : 'A mudança também revoga os acessos existentes dessa conta.';
        if (!await confirmation('Confirmar alteração de acesso?', description)) return;
        try {
            if (operation === 'revoke') await call(`/accounts/${account.id}/revoke`, { method: 'POST' });
            else await call(`/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify(operation === 'promote' ? { role: 'administrator' } : operation === 'demote' ? { role: 'moderator' } : { enabled: !account.enabled }) });
            notice('Acesso atualizado.'); refresh();
        } catch (failure) { notice(failure.message, true); }
    };
    const actor = currentUser();
    return [el('div', { class: 'toolbar page-heading' }, el('div', { class: 'grow' }, el('h1', {}, 'Equipe administrativa'), el('p', { class: 'muted' }, 'Contas independentes, permissões no servidor e MFA obrigatório.')), el('button', { class: 'primary', onclick: create }, 'Nova conta')),
        el('div', { class: 'panel table-scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ['Pseudônimo', 'Cargo', 'Status', 'MFA', 'Criada em', 'Ações'].map((title) => el('th', {}, title)))),
            el('tbody', {}, accounts.map((account) => {
                const manageable = account.role !== 'owner' && account.id !== actor.id && (hasPermission('owner') || account.role === 'moderator');
                return el('tr', {}, el('td', {}, account.username), el('td', {}, el('span', { class: 'badge' }, ROLES[account.role])), el('td', {}, account.enabled ? 'Ativa' : 'Suspensa'), el('td', {}, account.mfa ? 'Confirmado' : 'Cadastro pendente'), el('td', {}, when(account.created_at)), el('td', {}, manageable ? el('div', { class: 'actions' },
                    el('button', { onclick: () => manage(account, 'toggle') }, account.enabled ? 'Suspender' : 'Reativar'),
                    el('button', { onclick: () => manage(account, 'revoke') }, 'Revogar sessões'),
                    hasPermission('owner') ? el('button', { onclick: () => manage(account, account.role === 'moderator' ? 'promote' : 'demote') }, account.role === 'moderator' ? 'Promover a admin' : 'Tornar moderador') : null) : el('span', { class: 'muted' }, account.id === actor.id ? 'Sua conta' : 'Protegida')));
            }))))];
}

function strongForm(title, action, onSuccess) {
    const password = el('input', { type: 'password', required: true, minlength: 12, maxlength: 256, autocomplete: 'current-password' });
    const code = el('input', { required: true, maxlength: 64, autocomplete: 'one-time-code' });
    const error = el('p', { class: 'error', role: 'alert' });
    const submit = el('button', { class: 'primary', type: 'submit' }, 'Confirmar operação');
    openDrawer(el('h2', {}, title), el('p', { class: 'notice' }, 'Esta operação exige sua senha e um código novo do autenticador ou de recuperação.'),
        el('form', { onsubmit: async (event) => {
            event.preventDefault(); submit.disabled = true;
            try { const result = await action({ password: password.value, code: code.value.trim().toLowerCase() }); password.value = ''; code.value = ''; closeDrawer(); onSuccess(result); }
            catch (failure) { error.textContent = failure.message; }
            finally { submit.disabled = false; }
        } }, field('Sua senha administrativa', password), field('Código MFA ou recuperação', code), error, submit));
}

export async function securityView() {
    const actor = currentUser();
    const blocks = [el('div', { class: 'page-heading' }, el('h1', {}, 'Segurança da administração'), el('p', { class: 'muted' }, `${actor.username} · ${ROLES[actor.role]}`)),
        el('div', { class: 'grid g2' },
            el('section', { class: 'panel' }, el('h2', {}, 'Recuperação do autenticador'), el('p', { class: 'muted' }, 'Gerar novos códigos invalida todos os anteriores. Cada código funciona uma vez e nunca aparece no banco em texto aberto.'), el('button', { onclick: () => strongForm('Gerar novos códigos de recuperação', (body) => call('/self/recovery-codes', { method: 'POST', body: JSON.stringify(body) }), (result) => showRecovery(result.recovery_codes)) }, 'Gerar códigos')),
            el('section', { class: 'panel' }, el('h2', {}, 'Sessões privilegiadas'), el('p', { class: 'muted' }, 'Sessões têm limite de 4 horas. Mudanças de cargo, suspensão e recuperação revogam os acessos no servidor.'), el('button', { class: 'danger', onclick: async () => {
                if (!await confirmation('Desconectar todos os seus acessos?', 'Você precisará entrar novamente com senha e MFA.')) return;
                try { await call('/self/revoke', { method: 'POST' }); showLogin('Todos os seus acessos foram revogados.'); } catch (failure) { notice(failure.message, true); }
            } }, 'Revogar meus acessos'))),
        el('section', { class: 'panel' }, el('h2', {}, 'Redefinir seu autenticador'), el('p', { class: 'muted' }, 'Revoga todas as sessões e os códigos antigos. O próximo acesso exigirá cadastrar TOTP novamente. Sem acesso a qualquer fator, use a recuperação local no terminal do servidor.'), el('button', { class: 'danger', onclick: () => strongForm('Redefinir seu MFA', (body) => call(`/accounts/${actor.id}/mfa/reset`, { method: 'POST', body: JSON.stringify(body) }), () => showLogin('Entre para cadastrar o novo autenticador.')) }, 'Redefinir MFA'))];
    if (hasPermission('owner')) {
        const accounts = await call('/accounts');
        const target = el('select', { 'aria-label': 'Novo Owner' }, accounts.filter((account) => account.id !== actor.id && account.enabled && account.mfa).map((account) => el('option', { value: account.id }, `${account.username} · ${ROLES[account.role]}`)));
        blocks.push(el('section', { class: 'panel' }, el('h2', {}, 'Transferir a instalação'), el('p', { class: 'notice' }, 'Existe um único Owner. Após transferir, você se torna administrador e ambas as contas precisam entrar novamente. O destino deve estar ativo e com MFA confirmado.'), field('Conta de destino', target), el('button', { class: 'danger', disabled: !target.options.length, onclick: () => strongForm('Transferir o Owner', (body) => call(`/ownership/${target.value}`, { method: 'POST', body: JSON.stringify(body) }), () => showLogin('Propriedade transferida. Entre novamente.')) }, 'Transferir com verificação reforçada')));
    }
    return blocks;
}
