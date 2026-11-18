import type { Components } from 'react-markdown';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '#/lib/shadcn';

const components: Components = {
    img: ({ src, alt, title }) =>
        src ? (
            <img src={src} alt={alt} title={title} referrerPolicy="no-referrer" />
        ) : (
            <span>{alt}</span>
        ),
    a: ({ href, children, title }) => {
        if (!href) return <span>{children}</span>;
        const external = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href);
        return (
            <a
                href={href}
                title={title}
                target={external ? '_blank' : undefined}
                rel={external ? 'external noopener noreferrer' : undefined}
            >
                {children}
            </a>
        );
    }
};

// Texto da comunidade: imagem de fora vira só o texto, para nenhum site saber quem leu o guia.
const communityComponents: Components = {
    ...components,
    img: ({ alt }) => <span>{alt ? `[imagem: ${alt}]` : '[imagem]'}</span>,
    a: ({ href, children, title }) => {
        if (!href || !/^(?:https?:\/\/|mailto:)/i.test(href)) return <span>{children}</span>;
        return (
            <a
                href={href}
                title={title}
                target="_blank"
                rel="external noopener noreferrer nofollow"
            >
                {children}
            </a>
        );
    }
};

/** `article` para páginas de leitura; o padrão cabe em cards e diálogos. */
export function Markdown({
    children,
    article = false,
    community = false
}: {
    children: string;
    article?: boolean;
    // escrito por alunos (guias): sem imagens externas
    community?: boolean;
}) {
    return (
        <div
            className={cn(
                'markdown wrap-break-word',
                article ? 'article' : 'text-sm leading-relaxed text-muted-foreground'
            )}
        >
            <ReactMarkdown
                skipHtml
                remarkPlugins={[remarkGfm]}
                components={community ? communityComponents : components}
            >
                {children}
            </ReactMarkdown>
        </div>
    );
}
