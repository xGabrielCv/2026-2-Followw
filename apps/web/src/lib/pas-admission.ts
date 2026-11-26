export interface PasModality {
    id: string;
    sistema: string;
    descricao: string;
}

export interface PasQuotaScore {
    minimo: string | null;
    maximo: string | null;
    observacao?: string;
}

export interface PasRecord {
    nome: string;
    campus: string;
    grau: string;
    graus: string[];
    turno: string;
    minimo: string | null;
    maximo?: string | null;
    pagina: number;
    ingressoConjunto?: boolean;
    ofertaOriginal?: string;
    cotas?: Partial<Record<string, PasQuotaScore>>;
}

export interface PasSource {
    ciclo: string;
    sistema: string;
    url: string;
    observacao?: string;
    modalidades: PasModality[];
    registros: PasRecord[];
}

export interface PasCourseQuery {
    name: string;
    shift?: string | null;
    degree?: string | null;
    modality?: string | null;
    unitCode?: string | null;
    unitName?: string | null;
}

let cachedSources: Promise<PasSource[]> | null = null;

/** Carrega os 6 ciclos oficiais do PAS (Cebraspe) sob demanda para não inflar o bundle inicial. */
export function loadPasSources(): Promise<PasSource[]> {
    if (!cachedSources) {
        cachedSources = Promise.all([
            import('#/data/pas/pas-2023-2025.json'),
            import('#/data/pas/pas-2022-2024.json'),
            import('#/data/pas/pas-2021-2023.json'),
            import('#/data/pas/pas-2020-2022.json'),
            import('#/data/pas/pas-2019-2021.json'),
            import('#/data/pas/pas-2018-2020.json')
        ]).then((modules) =>
            modules.map(
                (mod) =>
                    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSONs estáticos de boletins Cebraspe com esquema fixo
                    ('default' in mod ? mod.default : mod) as unknown as PasSource
            )
        );
    }
    return cachedSources;
}

function normalizeTerm(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function normalizedName(value: string): string {
    return normalizeTerm(value)
        .replace(/[–—.,/-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const ENGENHARIAS_FCTE = new Set([
    'engenharia',
    'engenharia de software',
    'engenharia aeroespacial',
    'engenharia automotiva',
    'engenharia de energia',
    'engenharia eletronica'
]);

const NAME_ALIASES = new Map([
    ['ciencias sociais', 'ciencias sociais antropologia sociologia'],
    ['ciencias sociais antropologia', 'ciencias sociais antropologia sociologia'],
    ['ciencias sociais sociologia', 'ciencias sociais antropologia sociologia'],
    ['educacao fisica', 'educacao fisica ciclo basico'],
    ['engenharia mecatronica controle e automacao', 'engenharia mecatronica'],
    ['artes cenicas interpretacao teatral', 'artes cenicas'],
    ['comunicacao social comunicacao organizacional', 'comunicacao organizacional'],
    ['design programacao visual', 'design'],
    ['design projeto do produto', 'design'],
    ['letras lingua e literatura japonesa', 'lingua e literatura japonesa'],
    [
        'letras lingua espanhola e literatura espanhola e hispano americana',
        'lingua espanhola e literatura espanhola e hispano americana'
    ],
    ['letras lingua francesa e respectiva literatura', 'lingua francesa'],
    ['lingua francesa e respectiva literatura', 'lingua francesa'],
    ['letras lingua inglesa e respectiva literatura', 'lingua inglesa'],
    ['lingua inglesa e respectiva literatura', 'lingua inglesa'],
    ['letras lingua portuguesa e respectiva literatura', 'lingua portuguesa'],
    ['lingua portuguesa e respectiva literatura', 'lingua portuguesa'],
    [
        'letras portugues do brasil como seg lingua',
        'letras portugues do brasil como segunda lingua'
    ],
    ['linguas estrangeiras aplicadas msi', 'linguas estrangeiras aplicadas'],
    ['gestao de agronegocios', 'gestao de agronegocio']
]);

const PROFESSIONAL_DEGREES = new Map([
    ['agronomia', 'engenheiro agronomo'],
    ['arquitetura e urbanismo', 'arquiteto e urbanista'],
    ['enfermagem', 'enfermeiro'],
    ['engenharia ambiental', 'engenheiro'],
    ['engenharia civil', 'engenheiro civil'],
    ['engenharia eletrica', 'engenheiro eletricista'],
    ['engenharia florestal', 'engenheiro florestal'],
    ['engenharia mecanica', 'engenheiro mecanico'],
    ['engenharia mecatronica', 'engenheiro de controle e automacao'],
    ['geologia', 'geologo'],
    ['medicina', 'medico'],
    ['medicina veterinaria', 'medico veterinario'],
    ['nutricao', 'nutricionista'],
    ['odontologia', 'cirurgiao dentista']
]);

function canonicalCourseName(value: string): string {
    const key = normalizedName(value);
    return NAME_ALIASES.get(key) ?? key;
}

export function resolvePasCampus(unitCode?: string | null, unitName?: string | null): string {
    const combined = normalizeTerm(`${unitCode ?? ''} ${unitName ?? ''}`);
    if (/\b(fcte|fga|gama)\b/.test(combined)) return 'FCTE';
    if (/\b(fce|ceilandia)\b/.test(combined)) return 'FCE';
    if (/\b(fup|planaltina)\b/.test(combined)) return 'FUP';
    return 'Darcy Ribeiro';
}

function canonicalShift(shift?: string | null): string | null {
    if (!shift) return null;
    const key = normalizeTerm(shift);
    if (key === 'd' || key === 'diurno' || key === 'integral' || key === 'matutino') {
        return 'diurno';
    }
    if (key === 'n' || key === 'noturno') return 'noturno';
    return key;
}

function canonicalDegree(courseName: string, degree?: string | null): string | null {
    if (!degree) return null;
    const normalized = normalizeTerm(degree);
    return PROFESSIONAL_DEGREES.get(courseName) === normalized ? 'bacharelado' : normalized;
}

/** Cada edição preserva sua própria oferta; sem correspondência única, devolve undefined. */
export function findPasAdmission(course: PasCourseQuery, source: PasSource): PasRecord | undefined {
    if (course.modality && ['a distancia', 'ead'].includes(normalizeTerm(course.modality))) {
        return undefined;
    }
    const campus = resolvePasCampus(course.unitCode, course.unitName);
    const name = canonicalCourseName(course.name);
    const shift = canonicalShift(course.shift);
    const degree = canonicalDegree(name, course.degree);

    const matches = source.registros.filter((item) => {
        if (item.campus !== campus) return false;
        if (shift && canonicalShift(item.turno) !== shift) return false;
        if (degree && !item.graus.some((g) => normalizeTerm(g) === degree)) return false;
        return (
            canonicalCourseName(item.nome) === name ||
            Boolean(item.ingressoConjunto && ENGENHARIAS_FCTE.has(name))
        );
    });
    return matches.length === 1 ? matches[0] : undefined;
}

export function getPasHistory(course: PasCourseQuery, sources: PasSource[]) {
    return sources.map((source) => ({
        source,
        admission: findPasAdmission(course, source)
    }));
}

export function formatPasScore(value: string | null | undefined): string {
    if (value == null) return 'Não informado';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return value;
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    }).format(numeric);
}
