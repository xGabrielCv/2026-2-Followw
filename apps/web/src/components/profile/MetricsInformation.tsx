import { CircleHelp } from 'lucide-react';

import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from '#/components/ui/dialog';

const permitted = [
    'Eventos gerais de funcionamento.',
    'Informações técnicas de desempenho.',
    'Erros técnicos sem conteúdo pessoal.',
    'Dados agregados de utilização.',
    'Informações para melhorar estabilidade e usabilidade.'
];
const excluded = [
    'Matrícula, nome, senha ou credenciais SIGAA.',
    'Cookies de autenticação.',
    'Notas, frequência ou histórico acadêmico.',
    'Disciplinas individuais vinculadas à identidade.',
    'Mensagens privadas ou conteúdo dos tickets.',
    'Chaves de autoria ou identificadores persistentes de aluno.',
    'Dados que reconstruam sua identidade acadêmica.',
    'Caminhos de URLs, parâmetros ou mensagens de erro com dados pessoais.'
];

export function MetricsInformation() {
    return (
        <Dialog>
            <DialogTrigger
                render={
                    <Button variant="ghost" size="icon" aria-label="Entender as métricas de uso" />
                }
            >
                <CircleHelp aria-hidden="true" />
            </DialogTrigger>
            <DialogContent className="viewport-dialog flex flex-col overflow-hidden">
                <DialogHeader className="shrink-0 pr-6">
                    <DialogTitle>Métricas de uso</DialogTitle>
                    <DialogDescription>
                        Você escolhe se quer ajudar e pode desligar a qualquer momento.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto pr-1 text-sm">
                    <section className="flex flex-col gap-2">
                        <h3 className="font-semibold">O que pode ser enviado</h3>
                        <ul className="flex list-disc flex-col gap-1 pl-5">
                            {permitted.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </section>
                    <section className="flex flex-col gap-2">
                        <h3 className="font-semibold">O que não é enviado</h3>
                        <ul className="flex list-disc flex-col gap-1 pl-5">
                            {excluded.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </section>
                    <p className="text-muted-foreground">
                        Hoje, a coleta opcional resume acessos em contagens e registra a falha
                        técnica de guardar uma sessão. Os eventos técnicos vão à própria API, sem
                        serviço externo de análise, e seus contadores são zerados ao reiniciar o
                        processo. Contagens de uso não guardam sua identidade acadêmica.
                    </p>
                    <p className="text-muted-foreground">
                        Ao desligar, o app interrompe novos envios opcionais. Contadores gerais já
                        recebidos não permitem separar a sua contribuição.
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
}
