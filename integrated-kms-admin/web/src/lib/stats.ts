export type CountRow = {
  label: string
  count: number
  color?: string
}

export const STATS_PALETTE = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#dc2626',
  '#4f46e5',
  '#0f766e'
]

export function toCountRows(rows: unknown, palette = STATS_PALETTE): CountRow[] {
  if (!Array.isArray(rows)) return []
  return rows.map((row: any, index) => ({
    label: String(row?.label ?? '-'),
    count: Number(row?.count || 0),
    color: row?.color || palette[index % palette.length]
  }))
}

export function fillHourRows(rows: unknown): CountRow[] {
  const source = new Map(
    toCountRows(rows).map((row) => [String(row.label).replace(':00', '').padStart(2, '0'), row.count])
  )
  return Array.from({ length: 24 }, (_, hour) => {
    const label = String(hour).padStart(2, '0')
    return {
      label: `${label}:00`,
      count: source.get(label) || 0
    }
  })
}

export function deltaPercent(current: number, previous: number): number | null {
  if (!previous) return current ? 100 : null
  return Math.round(((current - previous) / previous) * 100)
}

export function compactDateRange(rows: CountRow[]): string {
  if (!rows.length) return '-'
  const first = rows[0].label
  const last = rows[rows.length - 1].label
  if (first === last) return first
  return `${first} ~ ${last}`
}

export function ratio(value: number, total: number): number {
  if (!total) return 0
  return Math.round((value / total) * 100)
}
