import { Link } from '@tanstack/react-router';
import { ShieldCheck } from 'lucide-react';

/** O mesmo resumo de "Uso de dados", antes de o aluno entrar. */
export function LoginPrivacyInfo() {
    return (
        <div className="mt-8 flex max-w-80 gap-3 rounded-2xl bg-primary/5 p-4 text-left text-xs leading-5 text-muted-foreground ring-1 ring-primary/20">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <p>
                <strong className="text-foreground">
                    Seus dados pessoais não ficam no servidor do Followw.
                </strong>{' '}
                O que identifica você fica neste aparelho; o servidor só guarda o que é da
                comunidade, sem associar seu nome ou matrícula às publicações. Suas credenciais
                ficam em cookies cifrados no navegador; não são gravadas no banco ou nos logs.{' '}
                <Link to="/perfil/dados" className="font-semibold text-primary">
                    Saiba mais
                </Link>
            </p>
        </div>
    );
}
