/**
 * Loot exporters. Each takes the items as the current user can see them
 * (players never have unidentified true properties to export).
 */
import type { LootItem, User } from '@vtt/shared';
import { absoluteUrl, dateStamp, downloadText } from '../lib/download';

interface ExportRow {
  name: string;
  quantity: number;
  value: string;
  holder: string;
  identified: boolean;
  notes: string;
  trueProperties: string;
  image: string;
  addedBy: string;
  addedAt: string;
}

function toRows(items: LootItem[], users: Record<string, User>): ExportRow[] {
  return items.map((i) => ({
    name: i.name,
    quantity: i.quantity,
    value: i.value,
    holder: i.holderId ? (users[i.holderId]?.name ?? 'Unknown') : 'Party',
    identified: i.identified,
    notes: i.notes,
    trueProperties: i.secretNotes,
    image: absoluteUrl(i.imageUrl),
    addedBy: users[i.createdBy]?.name ?? 'Unknown',
    addedAt: new Date(i.createdAt).toISOString(),
  }));
}

function csvCell(v: unknown): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS: [keyof ExportRow, string][] = [
  ['name', 'Name'],
  ['quantity', 'Quantity'],
  ['value', 'Value'],
  ['holder', 'Holder'],
  ['identified', 'Identified'],
  ['notes', 'Party notes'],
  ['trueProperties', 'True properties'],
  ['image', 'Image'],
  ['addedBy', 'Added by'],
  ['addedAt', 'Added at'],
];

export const lootExporters = {
  csv: {
    label: 'CSV (spreadsheet)',
    ext: 'csv',
    mime: 'text/csv',
    render(rows: ExportRow[]) {
      const lines = [COLUMNS.map(([, h]) => h), ...rows.map((r) => COLUMNS.map(([k]) => r[k]))];
      // BOM so Excel detects UTF-8.
      return '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n');
    },
  },
  markdown: {
    label: 'Markdown',
    ext: 'md',
    mime: 'text/markdown',
    render(rows: ExportRow[], title: string) {
      const out = [`# ${title}`, ''];
      for (const r of rows) {
        out.push(`## ${r.name}${r.quantity !== 1 ? ` ×${r.quantity}` : ''}`, '');
        if (r.image) out.push(`![${r.name}](${r.image})`, '');
        const facts = [
          r.value && `**Value:** ${r.value}`,
          `**Holder:** ${r.holder}`,
          `**Identified:** ${r.identified ? 'yes' : 'no'}`,
        ].filter(Boolean);
        out.push(facts.join(' · '), '');
        if (r.notes) out.push('**Party notes**', '', r.notes, '');
        if (r.trueProperties) out.push('**True properties**', '', r.trueProperties, '');
      }
      return out.join('\n');
    },
  },
  json: {
    label: 'JSON',
    ext: 'json',
    mime: 'application/json',
    render(rows: ExportRow[]) {
      return JSON.stringify(rows, null, 2);
    },
  },
};

export type LootExportFormat = keyof typeof lootExporters;

export function exportLoot(format: LootExportFormat, items: LootItem[], users: Record<string, User>, roomId: string) {
  const exporter = lootExporters[format];
  const content = exporter.render(toRows(items, users), `Loot: ${roomId}`);
  downloadText(`loot-${roomId}-${dateStamp()}.${exporter.ext}`, exporter.mime, content);
}
