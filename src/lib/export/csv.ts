// RFC 4180 CSV: comma-separated, CRLF line breaks, a cell is quoted when it holds a comma, a quote
// or a line break, and quotes inside are doubled. No byte-order mark (importers that parse the
// header row literally would read it as part of the first column name).

export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
