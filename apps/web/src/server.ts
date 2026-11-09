import type { Register } from '@tanstack/react-router';

import {
    createServerEntry,
    createStartHandler,
    defaultStreamHandler,
    type RequestHandler
} from '@tanstack/react-start/server';
import { randomBytes } from 'node:crypto';

import { contentSecurityPolicy } from '#/lib/http-policy';

const handler = createStartHandler(defaultStreamHandler);

const secureHandler: RequestHandler<Register> = async (request, options) => {
    const nonce = randomBytes(18).toString('base64');
    request.headers.set('X-Followw-Csp-Nonce', nonce);
    const response = await handler(request, {
        ...options,
        context: { ...options?.context, nonce }
    });
    const headers = new Headers(response.headers);
    if (import.meta.env.PROD) headers.set('Content-Security-Policy', contentSecurityPolicy(nonce));
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
};

export default createServerEntry({ fetch: secureHandler });
