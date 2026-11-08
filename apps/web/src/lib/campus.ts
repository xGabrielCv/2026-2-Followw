import type { Campus } from '#/queries/groups';

export const CAMPUSES: Campus[] = ['darcy', 'gama', 'ceilandia', 'planaltina'];

export const CAMPUS_LABELS: Record<Campus, string> = {
    darcy: 'Darcy Ribeiro',
    gama: 'Gama',
    ceilandia: 'Ceilândia',
    planaltina: 'Planaltina'
};

// unidade de cada campus fora do Darcy Ribeiro, como na API
const CAMPUS_UNITS: Record<number, Campus> = { 673: 'gama', 672: 'ceilandia', 666: 'planaltina' };

/** O campus do aluno pela unidade do curso; sem ela, nenhum. */
export const campusOfUnit = (unitId: number | null | undefined): Campus | undefined =>
    unitId == null ? undefined : (CAMPUS_UNITS[unitId] ?? 'darcy');
