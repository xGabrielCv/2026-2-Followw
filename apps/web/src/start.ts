import { createCsrfMiddleware, createStart } from '@tanstack/react-start';

const csrf = createCsrfMiddleware({ filter: ({ handlerType }) => handlerType === 'serverFn' });

export const startInstance = createStart(() => ({ requestMiddleware: [csrf] }));
