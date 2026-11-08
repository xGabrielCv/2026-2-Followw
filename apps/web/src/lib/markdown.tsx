import type { Components } from 'react-markdown';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
    img: ({ src, alt, title }) =>
        src ? <img src={src} alt={alt} title={title} /> : <span>{alt}</span>,
    a: ({ href, children, title }) => {
        const external = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href ?? '');
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
    img: ({ alt }) => <span>{alt ? `[imagem: ${alt}]` : '[imagem]'}</span>
};

export function Markdown({
    children,
    community = false
}: {
    children: string;
    // escrito por alunos (guias): sem imagens externas
    community?: boolean;
}) {
    return (
        <div className="markdown text-sm leading-relaxed wrap-break-word text-muted-foreground">
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
