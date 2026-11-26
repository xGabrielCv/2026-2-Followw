export type OpenDataFormat = 'csv' | 'json';

/** Neutraliza prefixos de fórmula em planilhas (=, +, -, @, tab, CR) antes de escapar aspas. */
export function safeCsvCell(value: unknown): string {
    const raw =
        value === null || value === undefined
            ? ''
            : typeof value === 'string'
              ? value
              : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
                ? `${value}`
                : JSON.stringify(value);
    const neutralized = /^\s*[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${neutralized.replaceAll('"', '""')}"`;
}

export function serializeOpenData(
    rows: readonly Record<string, unknown>[],
    format: OpenDataFormat
): { content: string; mime: string } {
    if (format === 'json') {
        return {
            content: JSON.stringify(rows, null, 2),
            mime: 'application/json;charset=utf-8'
        };
    }
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const lines = [
        columns.map(safeCsvCell).join(','),
        ...rows.map((row) => columns.map((col) => safeCsvCell(row[col])).join(','))
    ];
    return {
        content: `\uFEFF${lines.join('\r\n')}`,
        mime: 'text/csv;charset=utf-8'
    };
}

export function downloadOpenData(
    filename: string,
    rows: readonly Record<string, unknown>[],
    format: OpenDataFormat
): boolean {
    if (!rows.length || typeof document === 'undefined') return false;
    const { content, mime } = serializeOpenData(rows, format);
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
}
