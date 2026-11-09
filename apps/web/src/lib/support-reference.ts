import { createParser, parseAsStringLiteral } from 'nuqs/server';

import { TICKET_CATEGORIES } from '#/lib/support';

const REFERENCE = /^(review|material|group|post|reply|tutorial):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const supportParsers = {
    category: parseAsStringLiteral(TICKET_CATEGORIES).withDefault('bug'),
    reference: createParser({
        parse: value => REFERENCE.test(value) ? value : null,
        serialize: String
    })
};
