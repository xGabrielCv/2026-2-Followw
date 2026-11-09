import { useQuery } from '@tanstack/react-query';
import {
    Download,
    Eye,
    FileText,
    Image as ImageIcon,
    ShieldCheck,
    Trash2,
    Upload
} from 'lucide-react';
import { useState } from 'react';

import type { MaterialItem, SubjectMaterials } from '#/queries/community';

import { ReportButton } from '#/components/community/ReportButton';
import { LoadingText } from '#/components/LoadingText';
import { FilteredMaterials } from '#/components/materials/FilteredMaterials';
import { MaterialPreview } from '#/components/materials/MaterialPreview';
import { UploadMaterialDialog } from '#/components/materials/UploadMaterialDialog';
import { Button } from '#/components/ui/button';
import { useIsOwn } from '#/lib/author';
import { saveFile } from '#/lib/download';
import { formatBytes, MATERIAL_KIND_LABELS } from '#/lib/materials';
import { titleCase } from '#/lib/profile';
import { reviewMonth } from '#/lib/reviews';
import { cn } from '#/lib/shadcn';
import {
    downloadMaterial,
    subjectMaterialsQueryOptions,
    useDeleteMaterial
} from '#/queries/community';
import { meQueryOptions } from '#/queries/me';
import { nameKey } from '#/queries/outcomes';

interface SubjectMaterialsPanelProps {
    code: string;
    // a turma de quem abriu: o material dela aparece marcado e o envio já vem preenchido
    classroom?: { semester: string; number: string; professors: string[] };
}

/** Material compartilhado da matéria: provas, listas e resumos, anônimos. */
export function SubjectMaterialsPanel({ code, classroom }: SubjectMaterialsPanelProps) {
    const query = useQuery(subjectMaterialsQueryOptions(code));
    const { data: user } = useQuery(meQueryOptions);
    const [uploading, setUploading] = useState(false);

    if (query.isPending) return <LoadingText>Carregando materiais...</LoadingText>;
    if (query.isError)
        return (
            <div className="flex items-center justify-between gap-2 rounded-2xl bg-card p-4 text-sm">
                <span className="text-muted-foreground">
                    Não foi possível carregar os materiais.
                </span>
                <Button size="sm" variant="outline" onClick={() => query.refetch()}>
                    Tentar de novo
                </Button>
            </div>
        );

    return (
        <MaterialsView
            data={query.data}
            code={code}
            classroom={classroom}
            onUpload={user ? () => setUploading(true) : undefined}
        >
            {user && (
                <UploadMaterialDialog
                    open={uploading}
                    onOpenChange={setUploading}
                    code={code}
                    data={query.data}
                    classroom={classroom}
                />
            )}
        </MaterialsView>
    );
}

export function MaterialsView({
    data,
    code,
    classroom,
    onUpload,
    children
}: {
    data: SubjectMaterials;
    code: string;
    classroom?: SubjectMaterialsPanelProps['classroom'];
    onUpload?: () => void;
    children?: React.ReactNode;
}) {
    const { usage, limits } = data;
    // o servidor não sabe quem enviou: o limite por matéria vale para todos
    const full = usage.files >= limits.max_per_subject || usage.bytes >= limits.max_subject_bytes;

    return (
        <section aria-label="Material da matéria" className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/8">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <h3 className="text-sm font-semibold">Material da matéria</h3>
                        <p className="text-xs text-muted-foreground">
                            Provas, listas e resumos de todas as turmas de {code}, enviados
                            anonimamente. Guardados por {limits.keep_semesters} semestres.
                        </p>
                    </div>
                    {onUpload && (
                        <Button size="sm" onClick={onUpload} disabled={full}>
                            <Upload aria-hidden="true" />
                            Enviar
                        </Button>
                    )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                    <Meter label="Arquivos" value={usage.files} max={limits.max_per_subject} />
                    <Meter
                        label="Espaço"
                        value={usage.bytes}
                        max={limits.max_subject_bytes}
                        format={formatBytes}
                    />
                </div>
                {onUpload && full && (
                    <p className="text-xs text-warning">
                        A matéria chegou ao limite de arquivos ou de espaço.
                    </p>
                )}
            </div>
            {data.items.length === 0 ? (
                <p className="rounded-2xl bg-card p-4 text-center text-sm text-muted-foreground">
                    Ninguém compartilhou material desta matéria ainda.
                </p>
            ) : (
                <FilteredMaterials items={data.items}>
                    {(items) =>
                        [...new Set(items.map((item) => item.semester))].map((semester) => (
                            <div key={semester} className="flex flex-col gap-2">
                                <h4 className="px-1 text-xs font-semibold text-muted-foreground">
                                    {semester}
                                </h4>
                                <ul className="flex flex-col gap-2">
                                    {items
                                        .filter((item) => item.semester === semester)
                                        .map((item) => (
                                            <MaterialRow
                                                key={item.id}
                                                item={item}
                                                canEdit={Boolean(onUpload)}
                                                code={code}
                                                classroom={classroom}
                                            />
                                        ))}
                                </ul>
                            </div>
                        ))
                    }
                </FilteredMaterials>
            )}
            {children}
        </section>
    );
}

function Meter({
    label,
    value,
    max,
    format = String
}: {
    label: string;
    value: number;
    max: number;
    format?: (value: number) => string;
}) {
    const percent = Math.min(100, (value / max) * 100);
    return (
        <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-semibold tabular-nums">
                {format(value)}
                <span className="font-normal text-muted-foreground"> / {format(max)}</span>
            </span>
            <span className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span
                    className={cn(
                        'block h-full rounded-full',
                        percent >= 90 ? 'bg-warning' : 'bg-primary'
                    )}
                    style={{ width: `${percent}%` }}
                />
            </span>
        </div>
    );
}

/** De qual turma e docentes veio: quem é de outra turma vê o aviso. */
export function originLabel(
    item: MaterialItem,
    classroom?: SubjectMaterialsPanelProps['classroom']
): { text: string; other: boolean } {
    const professors = item.professors.map(titleCase).join(', ');
    const where = [item.classroom_number && `Turma ${item.classroom_number}`, professors]
        .filter(Boolean)
        .join(' · ');
    if (!where) return { text: 'Turma não informada', other: false };
    const mine = new Set(classroom?.professors.map(nameKey));
    const other =
        Boolean(classroom) &&
        item.professors.length > 0 &&
        !item.professors.some((name) => mine.has(nameKey(name)));
    return { text: other ? `Outro docente: ${where}` : where, other };
}

function MaterialRow({
    item,
    code,
    classroom,
    canEdit
}: {
    item: MaterialItem;
    canEdit: boolean;
    code: string;
    classroom?: SubjectMaterialsPanelProps['classroom'];
}) {
    const remove = useDeleteMaterial(code);
    const isOwn = useIsOwn();
    const mine = isOwn('material', item.id, item.mine);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const origin = originLabel(item, classroom);
    const Icon = item.mime === 'application/pdf' ? FileText : ImageIcon;

    const fetchFile = async (action: (blob: Blob) => void) => {
        setBusy(true);
        setFailed(false);
        try {
            action(await downloadMaterial(code, item.id));
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="flex items-start gap-3 rounded-2xl bg-card p-3 shadow-card ring-1 ring-foreground/8">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                        {MATERIAL_KIND_LABELS[item.kind]}
                    </span>
                    {mine && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            Seu envio
                        </span>
                    )}
                </div>
                <span className="text-sm font-semibold wrap-anywhere">{item.title}</span>
                <span
                    className={cn(
                        'text-xs',
                        origin.other ? 'text-warning' : 'text-muted-foreground'
                    )}
                >
                    {origin.text}
                </span>
                <span className="text-xs text-muted-foreground">
                    {formatBytes(item.size)} · enviado em {reviewMonth(item.month)}
                </span>
                {failed && (
                    <span role="alert" className="text-xs text-destructive">
                        Não foi possível abrir. Tente de novo.
                    </span>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setPreviewing(true)}
                    >
                        <Eye aria-hidden="true" />
                        Abrir
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`Baixar ${item.title}`}
                        onClick={() => void fetchFile((blob) => saveFile(blob, item.filename))}
                    >
                        <Download aria-hidden="true" />
                        Baixar
                    </Button>
                    {canEdit && mine ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={remove.isPending}
                            aria-label={`Apagar ${item.title}`}
                            onClick={() => {
                                if (window.confirm('Apagar este material? Não dá para desfazer.'))
                                    remove.mutate(item.id);
                            }}
                        >
                            <Trash2 aria-hidden="true" />
                        </Button>
                    ) : (
                        <ReportButton target="material" id={item.id} what="este material" />
                    )}
                </div>
            </div>
            <MaterialPreview
                code={code}
                item={item}
                open={previewing}
                onOpenChange={setPreviewing}
            />
        </li>
    );
}

export function MaterialsPrivacyNote() {
    return (
        <p className="flex gap-2 rounded-xl bg-primary/10 p-3 text-xs">
            <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
                <strong className="font-semibold">Envio sem seu nome de conta.</strong> O arquivo é
                regravado para remover metadados comuns, como autor e localização da foto. O próprio
                conteúdo ainda pode identificar você: não envie nome, matrícula ou rosto.
            </span>
        </p>
    );
}
