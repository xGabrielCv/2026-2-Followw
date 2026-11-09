import { $, call, closeDrawer, el, hasPermission, notice, openDrawer, ROLES, setUser } from './dashboard-core.js';

let onAuthenticated;
let mode = 'login';
const form = () => $('#login');
const error = () => $('#login-error');

function hideApp() {
    $('#app').classList.remove('ready');
    $('#main').replaceChildren();
    closeDrawer();
    setUser(null);
}

export function showLogin(message = '') {
    hideApp();
    mode = 'login';
    form().hidden = false;
    $('#login-title').textContent = 'Acesso à administração';
    $('#login-hint').textContent = 'Use o pseudônimo e a senha da sua conta administrativa. O autenticador será solicitado em seguida.';
    $('#credentials').hidden = false;
    $('#credentials').disabled = false;
    $('#mfa-fields').hidden = true;
    $('#repeat-password').hidden = true;
    $('#auth-submit').textContent = 'Continuar';
    error().textContent = message;
    $('#user').focus();
}

function showSetup() {
    showLogin();
    mode = 'setup';
    $('#login-title').textContent = 'Criar o acesso do Owner';
    $('#login-hint').textContent = 'Primeiro acesso local: escolha um pseudônimo e uma senha de pelo menos 12 caracteres. Em seguida, configure o autenticador. Nenhuma conta discente é criada.';
    $('#repeat-password').hidden = false;
    $('#password').autocomplete = 'new-password';
    $('#auth-submit').textContent = 'Cadastrar e configurar MFA';
}

async function showFactor(stage) {
    mode = stage;
    $('#credentials').hidden = true;
    $('#credentials').disabled = true;
    $('#repeat-password').hidden = true;
    $('#password').value = '';
    $('#password2').value = '';
    $('#mfa-fields').hidden = false;
    $('#factor').value = '';
    $('#login-title').textContent = stage === 'enroll' ? 'Configure seu autenticador' : 'Confirme seu acesso';
    $('#login-hint').textContent = stage === 'enroll' ? 'Escaneie o QR no Microsoft Authenticator ou outro aplicativo TOTP e confirme um código de 6 dígitos.' : 'Digite um código novo do autenticador ou um código de recuperação ainda não utilizado.';
    $('#qr-area').replaceChildren();
    if (stage === 'enroll') {
        const enrollment = await call('/mfa/enroll');
        $('#qr-area').append(el('img', { src: enrollment.qr, width: 224, height: 224, alt: 'QR para cadastrar o autenticador', class: 'totp-qr' }), el('details', {}, el('summary', {}, 'Configurar sem QR'), el('code', { class: 'secret' }, enrollment.secret)));
    }
    $('#auth-submit').textContent = stage === 'enroll' ? 'Confirmar autenticador' : 'Verificar código';
    $('#factor').focus();
}

export function showRecovery(codes, onDone = () => {}) {
    openDrawer(el('h2', {}, 'Guarde seus códigos de recuperação'),
        el('p', { class: 'notice' }, 'Exibidos somente agora. Cada código funciona uma vez, junto da senha. Guarde-os fora do navegador, em um gerenciador de senhas. Não envie estes códigos ao suporte.'),
        el('div', { class: 'recovery-codes' }, codes.map((value) => el('code', { class: 'secret' }, value))),
        el('button', { class: 'primary', onclick: () => { closeDrawer(); onDone(); } }, 'Guardei os códigos'));
}

export async function start() {
    let session;
    try { session = await call('/session'); } catch { showLogin('Sem conexão com a API. Tente novamente.'); return; }
    if (session.setup) { showSetup(); return; }
    if (!session.user) { showLogin(session.enabled ? '' : 'Crie o Owner pelo comando local do servidor para iniciar esta instalação.'); return; }
    form().hidden = true;
    setUser(session.user);
    $('#app').classList.add('ready');
    $('#who').textContent = `${session.user.username} · ${ROLES[session.user.role]}`;
    for (const button of document.querySelectorAll('nav [data-permission]')) button.hidden = !hasPermission(button.dataset.permission);
    onAuthenticated();
}

export function initializeAuth(callback) {
    onAuthenticated = callback;
    document.addEventListener('admin:expired', () => showLogin('Sessão encerrada. Entre novamente com MFA.'));
    form().addEventListener('submit', async (event) => {
        event.preventDefault();
        error().textContent = '';
        if (mode === 'setup' && $('#password').value !== $('#password2').value) { error().textContent = 'As senhas não conferem.'; return; }
        const button = $('#auth-submit');
        button.disabled = true;
        try {
            if (mode === 'login' || mode === 'setup') {
                const result = await call(mode === 'setup' ? '/setup' : '/login', { method: 'POST', body: JSON.stringify({ username: $('#user').value.trim(), password: $('#password').value }) });
                await showFactor(result.stage);
            } else {
                const result = await call(mode === 'enroll' ? '/mfa/confirm' : '/mfa/verify', { method: 'POST', body: JSON.stringify({ code: $('#factor').value.trim().toLowerCase() }) });
                $('#factor').value = '';
                $('#qr-area').replaceChildren();
                await start();
                if (result.recovery_codes?.length) showRecovery(result.recovery_codes);
            }
        } catch (failure) { error().textContent = failure instanceof TypeError ? 'Sem conexão com a API. Tente novamente.' : failure.message; }
        finally { button.disabled = false; }
    });
    $('#logout').addEventListener('click', async () => {
        try { await call('/logout', { method: 'POST' }); showLogin('Você saiu.'); }
        catch (failure) { notice(failure.message, true); }
    });
    $('#back-login').addEventListener('click', () => { $('#qr-area').replaceChildren(); showLogin(); });
    void start();
}
