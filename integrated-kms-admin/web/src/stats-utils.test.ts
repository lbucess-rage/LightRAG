import { compactDateRange, deltaPercent, fillHourRows, ratio, toCountRows } from './lib/stats'

test('stats rows are normalized with numeric counts and palette colors', () => {
  const rows = toCountRows([{ label: '통합 검색', count: '12' }])

  expect(rows).toEqual([{ label: '통합 검색', count: 12, color: '#2563eb' }])
})

test('hour rows always expose a complete 24 hour axis', () => {
  const rows = fillHourRows([{ label: '08:00', count: 3 }, { label: '17', count: 2 }])

  expect(rows).toHaveLength(24)
  expect(rows[8]).toEqual({ label: '08:00', count: 3 })
  expect(rows[17]).toEqual({ label: '17:00', count: 2 })
  expect(rows[9]).toEqual({ label: '09:00', count: 0 })
})

test('dashboard ratios and deltas handle empty baselines', () => {
  expect(deltaPercent(15, 10)).toBe(50)
  expect(deltaPercent(0, 0)).toBeNull()
  expect(ratio(2, 5)).toBe(40)
  expect(compactDateRange([{ label: '2026-06-09', count: 1 }, { label: '2026-06-10', count: 2 }])).toBe(
    '2026-06-09 ~ 2026-06-10'
  )
})
