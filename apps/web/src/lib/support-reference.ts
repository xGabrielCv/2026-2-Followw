import { createParser, parseAsStringLiteral } from 'nuqs/server';

import { TICKET_CATEGORIES } from '#/lib/support';

const REFERENCE =
    /^(review|material|group|post|reply|tutorial):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

type SupportReference = {
    type: 'review' | 'material' | 'group' | 'post' | 'reply' | 'tutorial';
    id: string;
};

export function parseSupportReference(value: string): SupportReference | null {
    if (!REFERENCE.test(value)) return null;
    const [type, id] = value.split(':');
    if (
        type === 'review' ||
        type === 'material' ||
        type === 'group' ||
        type === 'post' ||
        type === 'reply' ||
        type === 'tutorial'
    )
        return { type, id };
    return null;
}
export const supportParsers = {
    category: parseAsStringLiteral(TICKET_CATEGORIES).withDefault('bug'),
    reference: createParser({
        parse: (value) => (REFERENCE.test(value) ? value : null),
        serialize: String
    })
};
