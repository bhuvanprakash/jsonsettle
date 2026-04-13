import { mkdirSync, writeFileSync } from 'node:fs'
import { Bench } from 'tinybench'
import { StreamingJSONParser } from '../src/core/parser.js'
import { FIXTURES, tokenize } from './fixtures.js'

const MODES = ['char', 'token', 'chunk'] as const

interface ResultRow {
  fixture: string
  mode: string
  fixture_bytes: number
  ops_per_sec: number
  mean_ms: number
  p99_ms: number
  throughput_mb_s: number
}

const encoder = new TextEncoder()
const results: ResultRow[] = []

for (const [fixtureName, json] of Object.entries(FIXTURES)) {
  for (const mode of MODES) {
    const chunks = tokenize(json, mode)
    const bytes = encoder.encode(json).length

    const bench = new Bench({ time: 2000, warmupTime: 500 })
    bench.add(`${fixtureName}:${mode}`, () => {
      const parser = new StreamingJSONParser({})
      for (const chunk of chunks) parser.write(chunk)
      parser.flush()
    })

    await bench.run()

    const task = bench.tasks[0]!
    const taskResult = task.result!
    const opsPerSec = taskResult.hz
    const meanMs = taskResult.mean * 1000
    const p99Ms = taskResult.p99 * 1000
    const throughputMBS = (bytes * opsPerSec) / (1024 * 1024)

    results.push({
      fixture: fixtureName,
      mode,
      fixture_bytes: bytes,
      ops_per_sec: Math.round(opsPerSec),
      mean_ms: Number(meanMs.toFixed(4)),
      p99_ms: Number(p99Ms.toFixed(4)),
      throughput_mb_s: Number(throughputMBS.toFixed(2)),
    })
  }
}

console.log('\n── jsonsettle throughput benchmark ──────────────────────────\n')
console.table(results.map((r) => ({
  fixture: r.fixture,
  mode: r.mode,
  bytes: r.fixture_bytes,
  'ops/s': r.ops_per_sec.toLocaleString(),
  'mean(ms)': r.mean_ms,
  'p99(ms)': r.p99_ms,
  'MB/s': r.throughput_mb_s,
})))

mkdirSync('benchmarks/results', { recursive: true })
writeFileSync(
  `benchmarks/results/throughput_${Date.now()}.json`,
  JSON.stringify(results, null, 2),
)
console.log('\nSaved to benchmarks/results/')

/* BENCHMARK RESULTS — run on Apple M-series, Node v20, 2026-04-13
> jsonsettle@0.1.2 bench
> npx tsx benchmarks/run.ts

── jsonsettle throughput benchmark ──────────────────────────

┌─────────┬───────────────────┬─────────┬───────┬───────────┬───────────┬───────────┬───────┐
│ (index) │ fixture           │ mode    │ bytes │ ops/s     │ mean(ms)  │ p99(ms)   │ MB/s  │
├─────────┼───────────────────┼─────────┼───────┼───────────┼───────────┼───────────┼───────┤
│ 0       │ 'flat_small'      │ 'char'  │ 70    │ '245,111' │ 4.4811    │ 11.5838   │ 16.36 │
│ 1       │ 'flat_small'      │ 'token' │ 70    │ '353,700' │ 3.2328    │ 7.792     │ 23.61 │
│ 2       │ 'flat_small'      │ 'chunk' │ 70    │ '460,765' │ 2.2202    │ 2.875     │ 30.76 │
│ 3       │ 'flat_medium'     │ 'char'  │ 641   │ '11,089'  │ 95.6354   │ 248.451   │ 6.78  │
│ 4       │ 'flat_medium'     │ 'token' │ 641   │ '21,057'  │ 47.6597   │ 54.3068   │ 12.87 │
│ 5       │ 'flat_medium'     │ 'chunk' │ 641   │ '35,933'  │ 27.9659   │ 33.7088   │ 21.97 │
│ 6       │ 'flat_large'      │ 'char'  │ 1448  │ '935'     │ 1072.5061 │ 1180.7902 │ 1.29  │
│ 7       │ 'flat_large'      │ 'token' │ 1448  │ '2,265'   │ 442.1528  │ 509.9364  │ 3.13  │
│ 8       │ 'flat_large'      │ 'chunk' │ 1448  │ '7,519'   │ 133.3254  │ 173.25    │ 10.38 │
│ 9       │ 'nested_deep'     │ 'char'  │ 130   │ '71,457'  │ 14.0775   │ 16.792    │ 8.86  │
│ 10      │ 'nested_deep'     │ 'token' │ 130   │ '105,273' │ 9.549     │ 10.916    │ 13.05 │
│ 11      │ 'nested_deep'     │ 'chunk' │ 130   │ '137,771' │ 7.3162    │ 8.583     │ 17.08 │
│ 12      │ 'array_objects'   │ 'char'  │ 2799  │ '137'     │ 7328.8383 │ 8031.7438 │ 0.36  │
│ 13      │ 'array_objects'   │ 'token' │ 2799  │ '329'     │ 3056.8696 │ 4628.3772 │ 0.88  │
│ 14      │ 'array_objects'   │ 'chunk' │ 2799  │ '1,233'   │ 813.2764  │ 956.6695  │ 3.29  │
│ 15      │ 'strings_unicode' │ 'char'  │ 229   │ '67,010'  │ 15.0022   │ 17.584    │ 14.63 │
│ 16      │ 'strings_unicode' │ 'token' │ 229   │ '96,290'  │ 10.4446   │ 12.292    │ 21.03 │
│ 17      │ 'strings_unicode' │ 'chunk' │ 229   │ '127,012' │ 7.9449    │ 9.75      │ 27.74 │
│ 18      │ 'tool_call'       │ 'char'  │ 210   │ '44,048'  │ 22.9508   │ 26.25     │ 8.82  │
│ 19      │ 'tool_call'       │ 'token' │ 210   │ '63,198'  │ 15.9057   │ 18.666    │ 12.66 │
│ 20      │ 'tool_call'       │ 'chunk' │ 210   │ '82,181'  │ 13.0545   │ 30.1238   │ 16.46 │
│ 21      │ 'ai_analysis'     │ 'char'  │ 368   │ '19,528'  │ 53.0539   │ 121.666   │ 6.85  │
│ 22      │ 'ai_analysis'     │ 'token' │ 368   │ '31,178'  │ 33.1496   │ 73.7917   │ 10.94 │
│ 23      │ 'ai_analysis'     │ 'chunk' │ 368   │ '46,167'  │ 21.7618   │ 25        │ 16.2  │
│ 24      │ 'long_strings'    │ 'char'  │ 1331  │ '8,560'   │ 120.6253  │ 296.5164  │ 10.87 │
│ 25      │ 'long_strings'    │ 'token' │ 1331  │ '11,017'  │ 91.0745   │ 110.592   │ 13.98 │
│ 26      │ 'long_strings'    │ 'chunk' │ 1331  │ '13,431'  │ 74.6432   │ 85.7115   │ 17.05 │
│ 27      │ 'numbers_heavy'   │ 'char'  │ 589   │ '8,691'   │ 115.3693  │ 144.9563  │ 4.88  │
│ 28      │ 'numbers_heavy'   │ 'token' │ 589   │ '15,884'  │ 64.1867   │ 142.9164  │ 8.92  │
│ 29      │ 'numbers_heavy'   │ 'chunk' │ 589   │ '28,496'  │ 35.232    │ 40.542    │ 16.01 │
└─────────┴───────────────────┴─────────┴───────┴───────────┴───────────┴───────────┴───────┘

Saved to benchmarks/results/
*/
