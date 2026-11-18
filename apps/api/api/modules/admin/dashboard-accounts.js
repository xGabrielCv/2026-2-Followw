import { call, closeDrawer, confirmation, currentUser, el, hasPermission, notice, openDrawer, promptStepUpMfa, ROLES, when } from './dashboard-core.js';
import { showLogin, showRecovery } from './dashboard-auth.js';

const field = (label, input) => el('label', { class: 'form-field' }, label, input);

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

function passwordChangeForm(onSuccess) {
    const current = el('input', { type: 'password', required: true, minlength: 12, maxlength: 256, autocomplete: 'current-password' });
    const next = el('input', { type: 'password', required: true, minlength: 12, maxlength: 256, autocomplete: 'new-password' });
    const repeat = el('input', { type: 'password', required: true, minlength: 12, maxlength: 256, autocomplete: 'new-password' });
    const code = el('input', { required: true, maxlength: 64, autocomplete: 'one-time-code' });
    const error = el('p', { class: 'error', role: 'alert' });
    const submit = el('button', { class: 'primary', type: 'submit' }, 'Atualizar senha');
    openDrawer(el('h2', {}, 'Alterar minha senha administrativa'), el('p', { class: 'notice' }, 'Trocar a senha encerra suas outras sessões ativas e exige código MFA atual.'),
        el('form', { onsubmit: async (event) => {
            event.preventDefault();
            if (next.value !== repeat.value) { error.textContent = 'A confirmação da nova senha não confere.'; return; }
            submit.disabled = true;
            try {
                await call('/self/password', { method: 'POST', body: JSON.stringify({ password: current.value, new_password: next.value, code: code.value.trim().toLowerCase() }) });
                current.value = ''; next.value = ''; repeat.value = ''; code.value = '';
                closeDrawer();
                onSuccess();
            } catch (failure) { error.textContent = failure.message; }
            finally { submit.disabled = false; }
        } }, field('Senha atual', current), field('Nova senha (12+ caracteres)', next), field('Repita a nova senha', repeat), field('Código MFA ou recuperação', code), error, submit));
}

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
        el('div', { class: 'panel table-scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ['Pseudônimo', 'Cargo', 'Status', 'MFA', 'Sessões', 'Criada em', 'Ações'].map((title) => el('th', {}, title)))),
            el('tbody', {}, accounts.map((account) => {
                const manageable = account.role !== 'owner' && account.id !== actor.id && (hasPermission('owner') || account.role === 'moderator');
                return el('tr', {},
                    el('td', {}, account.username),
                    el('td', {}, el('span', { class: 'badge' }, ROLES[account.role])),
                    el('td', {}, account.enabled ? 'Ativa' : 'Suspensa', account.locked ? el('span', { class: 'badge warn' }, 'Bloqueio temp.') : null),
                    el('td', {}, account.mfa ? 'Confirmado' : 'Cadastro pendente'),
                    el('td', { class: 'num' }, String(account.active_sessions ?? 0)),
                    el('td', {}, when(account.created_at)),
                    el('td', {}, manageable ? el('div', { class: 'actions' },
                        el('button', { onclick: () => manage(account, 'toggle') }, account.enabled ? 'Suspender' : 'Reativar'),
                        el('button', { onclick: () => manage(account, 'revoke') }, 'Revogar sessões'),
                        hasPermission('owner') ? el('button', { onclick: () => manage(account, account.role === 'moderator' ? 'promote' : 'demote') }, account.role === 'moderator' ? 'Promover a admin' : 'Tornar moderador') : null,
                        hasPermission('owner') && account.mfa ? el('button', { class: 'danger', onclick: () => strongForm(`Redefinir MFA de ${account.username}`, (body) => call(`/accounts/${account.id}/mfa/reset`, { method: 'POST', body: JSON.stringify(body) }), () => { notice('MFA redefinido; a conta precisará cadastrar novo autenticador.'); refresh(); }) }, 'Redefinir MFA') : null)
                        : el('span', { class: 'muted' }, account.id === actor.id ? 'Sua conta' : 'Protegida')));
            }))))];
}

export async function securityView() {
    const actor = currentUser();
    const sessions = await call('/self/sessions').catch(() => []);
    const blocks = [el('div', { class: 'toolbar page-heading' },
        el('div', { class: 'grow' }, el('h1', {}, 'Segurança da administração'), el('p', { class: 'muted' }, `${actor.username} · ${ROLES[actor.role]}`)),
        el('button', { type: 'button', onclick: () => void promptStepUpMfa() }, 'Renovar MFA (15 min)')),
        el('div', { class: 'grid g2' },
            el('section', { class: 'panel' }, el('h2', {}, 'Senha e recuperação'), el('p', { class: 'muted' }, 'Gerar novos códigos invalida os anteriores. Trocar a senha desconecta outros aparelhos mantendo esta sessão.'),
                el('div', { class: 'toolbar' },
                    el('button', { onclick: () => passwordChangeForm(() => notice('Senha atualizada com Argon2id.')) }, 'Alterar senha'),
                    el('button', { onclick: () => strongForm('Gerar novos códigos de recuperação', (body) => call('/self/recovery-codes', { method: 'POST', body: JSON.stringify(body) }), (result) => showRecovery(result.recovery_codes)) }, 'Gerar códigos'))),
            el('section', { class: 'panel' }, el('h2', {}, 'Redefinir autenticador'), el('p', { class: 'muted' }, 'Revoga todas as sessões e os códigos antigos. O próximo acesso exigirá cadastrar TOTP novamente.'),
                el('div', { class: 'toolbar' },
                    el('button', { class: 'danger', onclick: () => strongForm('Redefinir seu MFA', (body) => call(`/accounts/${actor.id}/mfa/reset`, { method: 'POST', body: JSON.stringify(body) }), () => showLogin('Entre para cadastrar o novo autenticador.')) }, 'Redefinir MFA'),
                    el('button', { class: 'danger', onclick: async () => {
                        if (!await confirmation('Desconectar todos os seus acessos?', 'Você precisará entrar novamente com senha e MFA.')) return;
                        try { await call('/self/revoke', { method: 'POST' }); showLogin('Todos os seus acessos foram revogados.'); } catch (failure) { notice(failure.message, true); }
                    } }, 'Revogar meus acessos')))),
        el('section', { class: 'panel' }, el('h2', {}, `Minhas sessões ativas (${sessions.length})`),
            el('p', { class: 'muted' }, 'Sessões duram até 4 horas e não guardam IP. Você pode encerrar qualquer acesso individualmente.'),
            sessions.length ? el('div', { class: 'table-scroll' }, el('table', {},
                el('thead', {}, el('tr', {}, ['Sessão', 'Iniciada em', 'MFA confirmado em', 'Expira em', ''].map((h) => el('th', {}, h)))),
                el('tbody', {}, sessions.map((s) => el('tr', {},
                    el('td', {}, s.current ? el('span', { class: 'badge ok' }, 'Este navegador') : el('span', { class: 'muted' }, s.id.slice(0, 8))),
                    el('td', {}, when(s.created_at)),
                    el('td', {}, when(s.authenticated_at)),
                    el('td', {}, when(s.expires_at)),
                    el('td', {}, el('button', { class: s.current ? 'danger' : '', onclick: async () => {
                        if (!await confirmation('Encerrar esta sessão?', s.current ? 'Sua sessão atual será encerrada imediatamente.' : 'O outro navegador perderá o acesso na hora.')) return;
                        try {
                            await call(`/self/sessions/${s.id}`, { method: 'DELETE' });
                            if (s.current) showLogin('Sessão encerrada.');
                            else { notice('Sessão encerrada.'); location.hash = '#security'; window.dispatchEvent(new HashChangeEvent('hashchange')); s.revoked = true; }
                        } catch (failure) { notice(failure.message, true); }
                    } }, 'Encerrar'))))))) : el('p', { class: 'muted' }, 'Nenhuma sessão listada.'))];
    if (hasPermission('owner')) {
        const accounts = await call('/accounts');
        const target = el('select', { 'aria-label': 'Novo Owner' }, accounts.filter((account) => account.id !== actor.id && account.enabled && account.mfa).map((account) => el('option', { value: account.id }, `${account.username} · ${ROLES[account.role]}`)));
        blocks.push(el('section', { class: 'panel' }, el('h2', {}, 'Transferir a instalação'), el('p', { class: 'notice' }, 'Existe um único Owner. Após transferir, você se torna administrador e ambas as contas precisam entrar novamente. O destino deve estar ativo e com MFA confirmado.'), field('Conta de destino', target), el('button', { class: 'danger', disabled: !target.options.length, onclick: () => strongForm('Transferir o Owner', (body) => call(`/ownership/${target.value}`, { method: 'POST', body: JSON.stringify(body) }), () => showLogin('Propriedade transferida. Entre novamente.')) }, 'Transferir com verificação reforçada')));
    }
    return blocks;
}
