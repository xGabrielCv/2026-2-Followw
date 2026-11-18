import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
    accountStore,
    clearRegistrationData,
    isStorageBlocked,
    localStorageRepository,
    registeredStoreCount
} from '#/lib/local-storage';

import { MemoryStorage } from '../helpers/memory-storage';

describe('localStorageRepository', () => {
    let memoryStorage: MemoryStorage;
    let originalWindow: typeof globalThis.window | undefined;

    beforeEach(() => {
        originalWindow = globalThis.window;
        memoryStorage = new MemoryStorage();

        Object.defineProperty(globalThis, 'window', {
            value: { localStorage: memoryStorage },
            writable: true,
            configurable: true
        });
        Object.defineProperty(globalThis, 'localStorage', {
            value: memoryStorage,
            writable: true,
            configurable: true
        });
    });

    afterEach(() => {
        if (originalWindow === undefined) {
            Reflect.deleteProperty(globalThis, 'window');
            Reflect.deleteProperty(globalThis, 'localStorage');
        } else {
            Object.defineProperty(globalThis, 'window', {
                value: originalWindow,
                writable: true,
                configurable: true
            });
        }
    });

    test('armazena e recupera valores do tipo string', () => {
        localStorageRepository.set('ru-token', 'token-123456');
        const retrieved = localStorageRepository.get<string>('ru-token');

        expect(retrieved).toBe('token-123456');
        expect(memoryStorage.getItem('followw:ru-token')).toBeNull();
    });

    test('armazena e recupera valores do tipo número', () => {
        localStorageRepository.set('ru_balance', 42.5);
        const retrieved = localStorageRepository.get<number>('ru_balance');

        expect(retrieved).toBe(42.5);
        expect(memoryStorage.getItem('followw:ru_balance')).toBeNull();
    });

    test('armazena e recupera configurações', () => {
        const settings = { displayName: 'Estudante UnB' };
        localStorageRepository.set('settings', settings);
        const retrieved = localStorageRepository.get('settings');

        expect(retrieved).toEqual(settings);
        expect(memoryStorage.getItem('followw:settings')).toBeNull();
    });

    test('armazena e recupera objetos complexos', () => {
        const payload = { id: 1, active: true, items: ['a', 'b'] };
        localStorageRepository.set('user-data', payload);

        const retrieved = localStorageRepository.get<typeof payload>('user-data');
        expect(retrieved).toEqual(payload);
        expect(memoryStorage.getItem('followw:user-data')).toBeNull();
    });

    test('retorna null para chaves inexistentes', () => {
        const result = localStorageRepository.get<string>('non-existent');
        expect(result).toBeNull();
    });

    test('remove um item armazenado via chave lógica', () => {
        localStorageRepository.set('temp', 'value');
        expect(localStorageRepository.get<string>('temp')).toBe('value');

        localStorageRepository.remove('temp');
        expect(localStorageRepository.get('temp')).toBeNull();
        expect(memoryStorage.getItem('followw:temp')).toBeNull();
    });

    test('clear remove apenas chaves com prefixo followw: mantendo dados de outras aplicações', () => {
        memoryStorage.setItem('other_app:session', 'abc');
        localStorageRepository.set('token', '123');
        localStorageRepository.set('balance', 10);

        expect(memoryStorage.getItem('other_app:session')).toBe('abc');
        expect(memoryStorage.getItem('followw:token')).toBeNull();

        localStorageRepository.clear();

        expect(localStorageRepository.get('token')).toBeNull();
        expect(localStorageRepository.get('balance')).toBeNull();
        expect(memoryStorage.getItem('other_app:session')).toBe('abc');
    });

    test('retorna null de forma segura ao ler JSON inválido', () => {
        memoryStorage.setItem('followw:corrupted', '{invalid_json');

        const result = localStorageRepository.get('corrupted');
        expect(result).toBeNull();
    });

    test('trata erros no set sem lançar exceções para objetos não serializáveis', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;

        expect(() => {
            localStorageRepository.set('circular', circular);
        }).not.toThrow();

        expect(localStorageRepository.get('circular')).toBeNull();
    });

    test('trata erros no set quando setItem lança exceção (ex: QuotaExceededError)', () => {
        memoryStorage.setItem = () => {
            throw new Error('QuotaExceededError');
        };

        expect(() => {
            localStorageRepository.set('key', 'value');
        }).not.toThrow();
    });

    test('funciona com resiliência se window ou localStorage estiver ausente ou indisponível', () => {
        Reflect.deleteProperty(globalThis, 'window');
        Reflect.deleteProperty(globalThis, 'localStorage');

        expect(localStorageRepository.get('test')).toBeNull();
        expect(() => localStorageRepository.set('test', 123)).not.toThrow();
        expect(() => localStorageRepository.remove('test')).not.toThrow();
        expect(() => localStorageRepository.clear()).not.toThrow();
    });

    test('detecta storage liberado', () => {
        Object.defineProperty(globalThis, 'window', {
            value: { localStorage: memoryStorage, navigator: { cookieEnabled: true } },
            writable: true,
            configurable: true
        });

        expect(isStorageBlocked()).toBe(false);
    });

    test('detecta storage bloqueado quando o acesso ao localStorage lança SecurityError', () => {
        Object.defineProperty(globalThis, 'window', {
            value: {
                navigator: { cookieEnabled: true },
                get localStorage() {
                    throw new DOMException('Access is denied', 'SecurityError');
                }
            },
            writable: true,
            configurable: true
        });

        expect(isStorageBlocked()).toBe(true);
    });

    test('detecta cookies desativados pelo navigator', () => {
        Object.defineProperty(globalThis, 'window', {
            value: { localStorage: memoryStorage, navigator: { cookieEnabled: false } },
            writable: true,
            configurable: true
        });

        expect(isStorageBlocked()).toBe(true);
    });

    test('no SSR não acumula chaves de matrícula nos mapas globais do processo', () => {
        Reflect.deleteProperty(globalThis, 'window');
        Reflect.deleteProperty(globalThis, 'localStorage');

        const before = registeredStoreCount();
        const settings = accountStore('settings:231012345', { displayName: null });
        const events = accountStore('events:231012345', []);

        expect(settings.getServerSnapshot()).toEqual({ displayName: null });
        expect(events.getServerSnapshot()).toEqual([]);
        expect(registeredStoreCount()).toEqual(before);
    });

    test('clearRegistrationData apaga chaves acadêmicas da matrícula preservando credenciais', async () => {
        const reg = '231099999';
        const settings = accountStore(`settings:${reg}`, {});
        settings.set({ displayName: 'Estudante' });
        localStorageRepository.set(`events:${reg}`, [{ id: '1' }]);
        localStorageRepository.set(`marks:${reg}`, { T1: { a1: 'falta' } });
        localStorageRepository.set(`schedule-plans:${reg}`, { active: 'p1', plans: [] });
        localStorageRepository.set(`academic-simulation:${reg}`, { grades: {} });
        localStorageRepository.set(`post-reading:${reg}`, ['p1']);
        localStorageRepository.set(`graduation:${reg}:plan`, { semesters: [] });
        localStorageRepository.set(`semester-alert-dismissed:${reg}`, '2026.2');
        localStorageRepository.set(`author:${reg}`, { post: { id1: 'chave' } });
        localStorageRepository.set(`reviews:${reg}`, { p1: { id: '1', token: 't', rating: 5 } });

        await clearRegistrationData(reg);

        expect(settings.getSnapshot()).toEqual({});
        for (const key of [
            `settings:${reg}`,
            `events:${reg}`,
            `marks:${reg}`,
            `schedule-plans:${reg}`,
            `academic-simulation:${reg}`,
            `post-reading:${reg}`,
            `graduation:${reg}:plan`,
            `semester-alert-dismissed:${reg}`
        ]) {
            expect(localStorageRepository.get(key)).toBeNull();
        }
        expect(localStorageRepository.get(`author:${reg}`)).toEqual({ post: { id1: 'chave' } });
        expect(localStorageRepository.get(`reviews:${reg}`)).toEqual({
            p1: { id: '1', token: 't', rating: 5 }
        });
    });
});
