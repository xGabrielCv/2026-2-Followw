import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { apiClient } from '#/queries/client';
import { meQueryOptions, type UserProfile } from '#/queries/me';
import { settingsStore } from '#/queries/settings';

import { useDom } from '../helpers/dom';

const dom = useDom();
const user: UserProfile = {
    name: 'Nome SIGAA',
    registration: '123',
    photo: 'https://arquivos.unb.br/foto.jpg',
    bio: 'Bio anterior',
    course: null,
    unit: null,
    entry_semester: null,
    integralization: null,
    workload: null,
    period_max_workload: null,
    ira: null,
    mp: null,
    level: 'Graduação'
};
let client: QueryClient;
let requests: Request[];
const middleware = {
    onRequest: ({ request }: { request: Request }) => {
        requests.push(request);
        throw new Error('Perfil local não pode consultar servidor');
    }
};
beforeEach(() => {
    client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    client.setQueryData(meQueryOptions.queryKey, user);
    settingsStore(user.registration).clear();
    requests = [];
    apiClient.use(middleware);
});
afterEach(() => {
    dom.testing.cleanup();
    client.clear();
    apiClient.eject(middleware);
    expect(requests).toHaveLength(0);
});
async function open(profile = user) {
    const { ProfileForm } = await import('#/components/profile/EditProfile');
    const { Dialog } = await import('#/components/ui/dialog');
    const page = dom.testing.render(
        <QueryClientProvider client={client}>
            <Dialog open>
                <ProfileForm
                    user={profile}
                    displayName="Ana"
                    close={() => {}}
                    onSavingChange={() => {}}
                />
            </Dialog>
        </QueryClientProvider>
    );
    await page.findByLabelText('Nome de exibição');
    return page;
}
async function save(page: Awaited<ReturnType<typeof open>>) {
    dom.testing.fireEvent.click(page.getByRole('button', { name: 'Salvar alterações' }));
    await dom.testing.waitFor(() =>
        expect(settingsStore(user.registration).getSnapshot().displayName).toBeDefined()
    );
}
test('salva nome e bio somente neste aparelho sem requisição nem alteração do perfil SIGAA', async () => {
    const page = await open();
    dom.testing.fireEvent.change(page.getByLabelText('Nome de exibição'), {
        target: { value: 'Bia' }
    });
    dom.testing.fireEvent.change(page.getByLabelText('Bio'), {
        target: { value: 'Nova bio local' }
    });
    await save(page);
    expect(settingsStore('123').getSnapshot()).toMatchObject({
        displayName: 'Bia',
        profile: { bio: 'Nova bio local' }
    });
    expect(client.getQueryData(meQueryOptions.queryKey)).toEqual(user);
    expect(settingsStore('outra-conta').getSnapshot().profile).toBeUndefined();
});
test('bio antiga abre limitada sem sobrescrever origem ao salvar somente nome', async () => {
    const page = await open({ ...user, bio: 'a'.repeat(2000) });
    expect(page.container.querySelector('textarea')?.value).toHaveLength(1024);
    await save(page);
    expect(settingsStore('123').getSnapshot().profile?.bio).toBeUndefined();
});
test('limita bio sem quebrar emoji e não transmite o texto', async () => {
    const page = await open();
    dom.testing.fireEvent.change(page.getByLabelText('Bio'), {
        target: { value: '😀'.repeat(1100) }
    });
    await save(page);
    expect(Array.from(settingsStore('123').getSnapshot().profile!.bio!)).toHaveLength(1024);
});
test('nome vazio volta ao nome institucional somente na apresentação', async () => {
    const page = await open();
    dom.testing.fireEvent.change(page.getByLabelText('Nome de exibição'), {
        target: { value: ' ' }
    });
    await save(page);
    expect(settingsStore('123').getSnapshot().displayName).toBeNull();
});
test('remoção da foto só é gravada ao confirmar e mantém o original', async () => {
    const page = await open();
    dom.testing.fireEvent.click(page.getByRole('button', { name: 'Remover foto' }));
    expect(settingsStore('123').getSnapshot().profile).toBeUndefined();
    await save(page);
    expect(settingsStore('123').getSnapshot().profile?.photo).toBeNull();
    expect(client.getQueryData(meQueryOptions.queryKey)?.photo).toBe(user.photo);
});
test('cancelar não modifica foto ou bio', async () => {
    const page = await open();
    dom.testing.fireEvent.change(page.getByLabelText('Bio'), { target: { value: 'descartar' } });
    dom.testing.fireEvent.click(page.getByRole('button', { name: 'Remover foto' }));
    dom.testing.fireEvent.click(page.getByRole('button', { name: 'Cancelar' }));
    expect(settingsStore('123').getSnapshot().profile).toBeUndefined();
});
test('seletor rejeita formato inadequado antes de abrir o recorte', async () => {
    const page = await open();
    expect(page.getByLabelText('Foto de perfil').getAttribute('accept')).toBe('.jpg,.jpeg,.png');
    dom.testing.fireEvent.change(page.getByLabelText('Foto de perfil'), {
        target: { files: [new File(['x'], 'ataque.svg', { type: 'image/svg+xml' })] }
    });
    expect(page.getByRole('alert').textContent).toContain('JPEG ou PNG');
});
test('recusa imagem original acima de quatro MB', async () => {
    const page = await open();
    dom.testing.fireEvent.change(page.getByLabelText('Foto de perfil'), {
        target: {
            files: [
                new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'grande.jpg', {
                    type: 'image/jpeg'
                })
            ]
        }
    });
    expect(page.getByRole('alert').textContent).toContain('4 MB');
});
test('funciona offline e explica que as alterações ficam neste navegador', async () => {
    const page = await open();
    expect(page.getByText(/Foto, bio e nome ficam cifrados/)).toBeDefined();
    expect(page.getByRole('button', { name: 'Salvar alterações' }).hasAttribute('disabled')).toBe(
        false
    );
    await save(page);
});
test('ajuste produz recorte 4 por 5 somente após confirmação', async () => {
    const { PhotoCrop } = await import('#/components/profile/PhotoCrop');
    const bitmap = { width: 1600, height: 1200, close: () => {} };
    const previousBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
    Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        value: async () => bitmap
    });
    const prototype = Object.getPrototypeOf(document.createElement('canvas'));
    const previousContext = prototype.getContext;
    const previousBlob = prototype.toBlob;
    const draws: unknown[][] = [];
    prototype.getContext = () => ({
        fillRect: () => {},
        drawImage: (...args: unknown[]) => draws.push(args)
    });
    prototype.toBlob = (callback: (blob: Blob) => void) =>
        callback(new Blob(['jpeg'], { type: 'image/jpeg' }));
    const confirmed: File[] = [];
    try {
        const page = dom.testing.render(
            <PhotoCrop
                file={new File(['foto'], 'foto.jpg', { type: 'image/jpeg' })}
                onConfirm={(file) => confirmed.push(file)}
                onCancel={() => {}}
            />
        );
        await dom.testing.waitFor(() => expect(draws.length).toBeGreaterThan(0));
        expect(confirmed).toHaveLength(0);
        expect(page.queryByRole('slider')).toBeNull();
        const viewport = page.getByLabelText('Ajustar enquadramento da foto');
        viewport.setPointerCapture = () => {};
        viewport.getBoundingClientRect = () => ({
            width: 256,
            height: 320,
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 256,
            bottom: 320,
            toJSON: () => ({})
        });
        const pointer = (type: string, id: number, x: number, y: number) =>
            dom.testing.fireEvent(
                viewport,
                new window.PointerEvent(type, {
                    bubbles: true,
                    pointerId: id,
                    clientX: x,
                    clientY: y
                })
            );
        const initialWidth = Number(draws.at(-1)![3]);
        dom.testing.fireEvent.wheel(viewport, { deltaY: -350 });
        await dom.testing.waitFor(() =>
            expect(Number(draws.at(-1)![3])).toBeLessThan(initialWidth)
        );
        const beforePan = Number(draws.at(-1)![1]);
        dom.testing.fireEvent.keyDown(viewport, { key: 'ArrowLeft' });
        expect(Number(draws.at(-1)![1])).toBeGreaterThan(beforePan);
        const beforeDrag = Number(draws.at(-1)![1]);
        pointer('pointerdown', 1, 100, 100);
        pointer('pointermove', 1, 120, 100);
        expect(Number(draws.at(-1)![1])).toBeLessThan(beforeDrag);
        pointer('pointerdown', 2, 180, 100);
        const beforePinch = Number(draws.at(-1)![3]);
        pointer('pointermove', 2, 240, 100);
        expect(Number(draws.at(-1)![3])).toBeLessThan(beforePinch);
        pointer('pointerup', 2, 240, 100);
        pointer('pointermove', 1, 10000, 10000);
        expect(Number(draws.at(-1)![1])).toBeGreaterThanOrEqual(0);
        expect(Number(draws.at(-1)![2])).toBeGreaterThanOrEqual(0);
        pointer('pointercancel', 1, 10000, 10000);
        const last = draws.at(-1)!;
        expect(Number(last[3]) / Number(last[4])).toBeCloseTo(0.8);
        expect(last.slice(-2)).toEqual([800, 1000]);
        dom.testing.fireEvent.click(page.getByRole('button', { name: 'Confirmar foto' }));
        expect(confirmed[0].type).toBe('image/jpeg');
    } finally {
        dom.testing.cleanup();
        prototype.getContext = previousContext;
        prototype.toBlob = previousBlob;
        if (previousBitmap) Object.defineProperty(globalThis, 'createImageBitmap', previousBitmap);
        else Reflect.deleteProperty(globalThis, 'createImageBitmap');
    }
});
