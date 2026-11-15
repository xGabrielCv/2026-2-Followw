import { Link } from '@tanstack/react-router';
import { Check, ShieldCheck, X } from 'lucide-react';

/** O mesmo resumo de "Uso de dados", antes de o aluno entrar. */
export function LoginPrivacyInfo() {
    return (
        <div className="mt-8 flex max-w-80 flex-col gap-3 rounded-2xl bg-primary/5 p-4 text-left text-xs leading-5 text-muted-foreground ring-1 ring-primary/20">
            <p className="flex items-start gap-2 font-semibold text-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>Seus dados pessoais não ficam no servidor do Followw.</span>
            </p>
            <ul className="flex flex-col gap-2">
                <li className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>Seus dados pessoais ficam neste aparelho.</span>
                </li>
                <li className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>Credenciais em cookies cifrados no navegador.</span>
                </li>
                <li className="flex gap-2">
                    <X
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <span>Sem credenciais gravadas no banco ou nos logs.</span>
                </li>
                <li className="flex gap-2">
                    <X
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <span>
                        Na comunidade, o servidor não associa seu nome ou matrícula às publicações.
                    </span>
                </li>
            </ul>
            <p>O servidor guarda o conteúdo compartilhado da comunidade.</p>
            <Link to="/perfil/dados" className="self-start font-semibold text-primary">
                Saiba mais
            </Link>
        </div>
    );
}
