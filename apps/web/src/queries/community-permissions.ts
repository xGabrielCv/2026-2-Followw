import { materialUploadKey } from '#/lib/material-quota';
import { toApiError } from '#/queries/errors';

const COOKIE_FREE = new Set([
    'forum',
    'materials',
    'groups',
    'reviews',
    'tutorials',
    'reports',
    'support',
    'community'
]);
const VERIFIED = new Set(['forum', 'materials', 'groups', 'reviews', 'tutorials']);

export function isCommunityRequest(request: Request) {
    const path = new URL(request.url).pathname.replace(/^\/api(?=\/)/, '').replace(/\/$/, '');
    const root = path.split('/')[1];
    return {
        path,
        cookieFree: COOKIE_FREE.has(root) || /^\/public\/professors(?:\/|$)/.test(path),
        needsPermission: VERIFIED.has(root) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    };
}

/** O comprovante existe só durante esta operação e nunca passa pelo cache ou armazenamento. */
export async function communityRequest(
    request: Request,
    transport: (request: Request) => Promise<Response>
) {
    const policy = isCommunityRequest(request);
    if (!policy.cookieFree) return request;
    const headers = new Headers(request.headers);
    for (const name of ['cookie', 'authorization', 'X-Followw-Metrics', 'X-Followw-Usage'])
        headers.delete(name);
    if (policy.needsPermission) {
        const uploadKey =
            request.method === 'POST' && /^\/materials\/[A-Za-z0-9]{3,16}$/.test(policy.path)
                ? await materialUploadKey(policy.path.split('/')[2].toUpperCase())
                : undefined;
        const response = await transport(
            new Request(new URL('/api/auth/community-permits', request.url), {
                method: 'POST',
                credentials: 'include',
                referrerPolicy: 'no-referrer',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    method: request.method,
                    path: policy.path,
                    ...(uploadKey ? { upload_key: uploadKey } : {})
                }),
                signal: request.signal
            })
        );
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw toApiError(response.status, body);
        if (
            !body ||
            typeof body !== 'object' ||
            !('token' in body) ||
            typeof body.token !== 'string'
        )
            throw new Error('Não foi possível obter uma autorização comunitária.');
        headers.set('X-Followw-Permit', body.token);
    }
    return new Request(request, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        headers: Array.from(headers.entries())
    });
}
