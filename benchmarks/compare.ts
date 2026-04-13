import { mkdirSync, writeFileSync } from 'node:fs'
import { Bench } from 'tinybench'
import { StreamingJSONParser } from '../src/core/parser.js'
import { FIXTURES, tokenize } from './fixtures.js'
import { parse as partialParse } from 'partial-json'
import { JSONParser } from '@streamparser/json'

const COMPARISON_FIXTURES = {
  flat_small: FIXTURES.flat_small,
  flat_medium: FIXTURES.flat_medium,
  array_objects: FIXTURES.array_objects,
  tool_call: FIXTURES.tool_call,
  ai_analysis: FIXTURES.ai_analysis,
}

interface CompareRow {
  fixture: string
  library: string
  ops_per_sec: number
  mean_ms: number
  throughput_mb_s: number
  has_certainty: boolean
  has_schema: boolean
}

const rows: CompareRow[] = []
const encoder = new TextEncoder()

for (const [fixtureName, json] of Object.entries(COMPARISON_FIXTURES)) {
  const chunks = tokenize(json, 'token')
  const bytes = encoder.encode(json).length

  const bench1 = new Bench({ time: 2000, warmupTime: 500 })
  bench1.add('jsonsettle', () => {
    const p = new StreamingJSONParser({})
    for (const c of chunks) p.write(c)
    p.flush()
  })
  await bench1.run()
  const sj = bench1.tasks[0]!.result!

  rows.push({
    fixture: fixtureName,
    library: 'jsonsettle',
    ops_per_sec: Math.round(sj.hz),
    mean_ms: Number((sj.mean * 1000).toFixed(4)),
    throughput_mb_s: Number(((bytes * sj.hz) / 1e6).toFixed(2)),
    has_certainty: true,
    has_schema: true,
  })

  const bench2 = new Bench({ time: 2000, warmupTime: 500 })
  bench2.add('partial-json', () => {
    let acc = ''
    for (const c of chunks) {
      acc += c
      try {
        partialParse(acc)
      } catch {
        // expected while input is incomplete
      }
    }
  })
  await bench2.run()
  const pj = bench2.tasks[0]!.result!

  rows.push({
    fixture: fixtureName,
    library: 'partial-json',
    ops_per_sec: Math.round(pj.hz),
    mean_ms: Number((pj.mean * 1000).toFixed(4)),
    throughput_mb_s: Number(((bytes * pj.hz) / 1e6).toFixed(2)),
    has_certainty: false,
    has_schema: false,
  })

  const bench3 = new Bench({ time: 2000, warmupTime: 500 })
  bench3.add('@streamparser/json', () => {
    const p = new JSONParser()
    for (const c of chunks) {
      try {
        p.write(c)
      } catch {
        // ignore malformed intermediate state
      }
    }
  })
  await bench3.run()
  const spj = bench3.tasks[0]!.result!

  rows.push({
    fixture: fixtureName,
    library: '@streamparser/json',
    ops_per_sec: Math.round(spj.hz),
    mean_ms: Number((spj.mean * 1000).toFixed(4)),
    throughput_mb_s: Number(((bytes * spj.hz) / 1e6).toFixed(2)),
    has_certainty: false,
    has_schema: false,
  })
}

console.log('\n── comparison: jsonsettle vs alternatives ────────────────────\n')
console.table(rows.map((r) => ({
  fixture: r.fixture,
  library: r.library,
  'ops/s': r.ops_per_sec.toLocaleString(),
  'mean(ms)': r.mean_ms,
  'MB/s': r.throughput_mb_s,
  certainty: r.has_certainty ? 'yes' : 'no',
  schema: r.has_schema ? 'yes' : 'no',
})))

for (const fixtureName of Object.keys(COMPARISON_FIXTURES)) {
  const sj = rows.find((r) => r.fixture === fixtureName && r.library === 'jsonsettle')!
  const pj = rows.find((r) => r.fixture === fixtureName && r.library === 'partial-json')!
  const spj = rows.find((r) => r.fixture === fixtureName && r.library === '@streamparser/json')!

  const vsPj = (sj.ops_per_sec / pj.ops_per_sec).toFixed(2)
  const vsSpj = (sj.ops_per_sec / spj.ops_per_sec).toFixed(2)
  console.log(`${fixtureName}: jsonsettle is ${vsPj}x vs partial-json, ${vsSpj}x vs @streamparser/json`)
}

mkdirSync('benchmarks/results', { recursive: true })
writeFileSync(
  `benchmarks/results/compare_${Date.now()}.json`,
  JSON.stringify(rows, null, 2),
)

/* BENCHMARK RESULTS — run on Apple M-series, Node v20, 2026-04-13
> jsonsettle@0.1.1 bench:compare
> npx tsx benchmarks/compare.ts

── comparison: jsonsettle vs alternatives ────────────────────

┌─────────┬─────────────────┬──────────────────────┬───────────┬────────────┬───────┬───────────┬────────┐
│ (index) │ fixture         │ library              │ ops/s     │ mean(ms)   │ MB/s  │ certainty │ schema │
├─────────┼─────────────────┼──────────────────────┼───────────┼────────────┼───────┼───────────┼────────┤
│ 0       │ 'flat_small'    │ 'jsonsettle'         │ '362,903' │ 2.792      │ 25.4  │ 'yes'     │ 'yes'  │
│ 1       │ 'flat_small'    │ 'partial-json'       │ '12,937'  │ 83.7856    │ 0.91  │ 'no'      │ 'no'   │
│ 2       │ 'flat_small'    │ '@streamparser/json' │ '12,006'  │ 90.0423    │ 0.84  │ 'no'      │ 'no'   │
│ 3       │ 'flat_medium'   │ 'jsonsettle'         │ '21,010'  │ 48.1675    │ 13.47 │ 'yes'     │ 'yes'  │
│ 4       │ 'flat_medium'   │ 'partial-json'       │ '1,026'   │ 999.41     │ 0.66  │ 'no'      │ 'no'   │
│ 5       │ 'flat_medium'   │ '@streamparser/json' │ '996'     │ 1060.8101  │ 0.64  │ 'no'      │ 'no'   │
│ 6       │ 'array_objects' │ 'jsonsettle'         │ '333'     │ 3017.0521  │ 0.93  │ 'yes'     │ 'yes'  │
│ 7       │ 'array_objects' │ 'partial-json'       │ '34'      │ 29140.5841 │ 0.1   │ 'no'      │ 'no'   │
│ 8       │ 'array_objects' │ '@streamparser/json' │ '203'     │ 5603.496   │ 0.57  │ 'no'      │ 'no'   │
│ 9       │ 'tool_call'     │ 'jsonsettle'         │ '58,617'  │ 19.7563    │ 12.31 │ 'yes'     │ 'yes'  │
│ 10      │ 'tool_call'     │ 'partial-json'       │ '2,674'   │ 428.3228   │ 0.56  │ 'no'      │ 'no'   │
│ 11      │ 'tool_call'     │ '@streamparser/json' │ '3,191'   │ 320.4274   │ 0.67  │ 'no'      │ 'no'   │
│ 12      │ 'ai_analysis'   │ 'jsonsettle'         │ '32,124'  │ 31.4288    │ 11.82 │ 'yes'     │ 'yes'  │
│ 13      │ 'ai_analysis'   │ 'partial-json'       │ '1,207'   │ 835.7488   │ 0.44  │ 'no'      │ 'no'   │
│ 14      │ 'ai_analysis'   │ '@streamparser/json' │ '1,819'   │ 550.4525   │ 0.67  │ 'no'      │ 'no'   │
└─────────┴─────────────────┴──────────────────────┴───────────┴────────────┴───────┴───────────┴────────┘
flat_small: jsonsettle is 28.05x vs partial-json, 30.23x vs @streamparser/json
flat_medium: jsonsettle is 20.48x vs partial-json, 21.09x vs @streamparser/json
array_objects: jsonsettle is 9.79x vs partial-json, 1.64x vs @streamparser/json
tool_call: jsonsettle is 21.92x vs partial-json, 18.37x vs @streamparser/json
ai_analysis: jsonsettle is 26.61x vs partial-json, 17.66x vs @streamparser/json
*/
