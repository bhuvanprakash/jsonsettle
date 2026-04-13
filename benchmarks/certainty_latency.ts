import { mkdirSync, writeFileSync } from 'node:fs'
import { StreamingJSONParser } from '../src/core/parser.js'
import { FIXTURES, tokenize } from './fixtures.js'

interface LatencyRow {
  fixture: string
  total_chars: number
  first_certain_at: number
  first_certain_pct: string
  fields_certain_at_50pct: number
  total_fields: number
  all_certain_at: number
  all_certain_pct: string
}

const rows: LatencyRow[] = []

for (const [fixtureName, json] of Object.entries(FIXTURES)) {
  const chunks = tokenize(json, 'token')
  const totalChars = json.length

  let firstCertainAt = -1
  let allCertainAt = -1
  let fieldsCertainAt50 = -1
  const fieldFirstCertain: Record<string, number> = {}
  let charsConsumed = 0

  const parser = new StreamingJSONParser({
    onUpdate: (e) => {
      const certainCount = Object.values(e.fields).filter((f) => f.certainty === 'certain').length

      if (firstCertainAt === -1 && certainCount > 0) {
        firstCertainAt = charsConsumed
      }

      for (const [key, info] of Object.entries(e.fields)) {
        if (info.certainty === 'certain' && !(key in fieldFirstCertain)) {
          fieldFirstCertain[key] = charsConsumed
        }
      }

      if (charsConsumed >= totalChars * 0.5 && fieldsCertainAt50 === -1) {
        fieldsCertainAt50 = certainCount
      }

      if (e.isComplete) {
        allCertainAt = charsConsumed
      }
    },
  })

  for (const chunk of chunks) {
    parser.write(chunk)
    charsConsumed += chunk.length
  }
  parser.flush()

  const totalFields = Object.keys(fieldFirstCertain).length
  const firstCertainPct = firstCertainAt >= 0 ? `${((firstCertainAt / totalChars) * 100).toFixed(1)}%` : 'n/a'
  const allCertainPct = allCertainAt >= 0 ? `${((allCertainAt / totalChars) * 100).toFixed(1)}%` : 'n/a'

  rows.push({
    fixture: fixtureName,
    total_chars: totalChars,
    first_certain_at: firstCertainAt,
    first_certain_pct: firstCertainPct,
    fields_certain_at_50pct: Math.max(0, fieldsCertainAt50),
    total_fields: totalFields,
    all_certain_at: allCertainAt,
    all_certain_pct: allCertainPct,
  })
}

console.log('\n── certainty latency: how early fields lock in ───────────────\n')
console.table(rows.map((r) => ({
  fixture: r.fixture,
  'total chars': r.total_chars,
  '1st certain @': r.first_certain_at,
  '1st certain %': r.first_certain_pct,
  'fields @50%': `${r.fields_certain_at_50pct}/${r.total_fields}`,
  'all certain @': r.all_certain_at,
  'all certain %': r.all_certain_pct,
})))

console.log('\nKey insight: with partial-json or @streamparser/json, you get 0 certain')
console.log('fields at any point. With jsonsettle, you get fields from early stream positions.\n')

mkdirSync('benchmarks/results', { recursive: true })
writeFileSync(
  `benchmarks/results/certainty_latency_${Date.now()}.json`,
  JSON.stringify(rows, null, 2),
)

/* BENCHMARK RESULTS — run on Apple M-series, Node v20, 2026-04-13
> npx tsx benchmarks/certainty_latency.ts

── certainty latency: how early fields lock in ───────────────

┌─────────┬───────────────────┬─────────────┬───────────────┬───────────────┬─────────────┬───────────────┬───────────────┐
│ (index) │ fixture           │ total chars │ 1st certain @ │ 1st certain % │ fields @50% │ all certain @ │ all certain % │
├─────────┼───────────────────┼─────────────┼───────────────┼───────────────┼─────────────┼───────────────┼───────────────┤
│ 0       │ 'flat_small'      │ 70          │ 13            │ '18.6%'       │ '2/5'       │ 69            │ '98.6%'       │
│ 1       │ 'flat_medium'     │ 641         │ 30            │ '4.7%'        │ '10/20'     │ 637           │ '99.4%'       │
│ 2       │ 'flat_large'      │ 1448        │ 10            │ '0.7%'        │ '50/100'    │ 1446          │ '99.9%'       │
│ 3       │ 'nested_deep'     │ 130         │ 116           │ '89.2%'       │ '0/11'      │ 129           │ '99.2%'       │
│ 4       │ 'array_objects'   │ 2799        │ 17            │ '0.6%'        │ '126/251'   │ 2797          │ '99.9%'       │
│ 5       │ 'strings_unicode' │ 207         │ 17            │ '8.2%'        │ '3/6'       │ 205           │ '99.0%'       │
│ 6       │ 'tool_call'       │ 210         │ 27            │ '12.9%'       │ '3/12'      │ 208           │ '99.0%'       │
│ 7       │ 'ai_analysis'     │ 368         │ 27            │ '7.3%'        │ '5/18'      │ 365           │ '99.2%'       │
│ 8       │ 'long_strings'    │ 1331        │ 109           │ '8.2%'        │ '1/13'      │ 1329          │ '99.8%'       │
│ 9       │ 'numbers_heavy'   │ 589         │ 17            │ '2.9%'        │ '15/30'     │ 588           │ '99.8%'       │
└─────────┴───────────────────┴─────────────┴───────────────┴───────────────┴─────────────┴───────────────┴───────────────┘

Key insight: with partial-json or @streamparser/json, you get 0 certain
fields at any point. With jsonsettle, you get fields from early stream positions.
*/
