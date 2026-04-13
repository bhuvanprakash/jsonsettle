import { mkdirSync, writeFileSync } from 'node:fs'
import { StreamingJSONParser } from '../src/core/parser.ts'
import { FIXTURES, tokenize } from './fixtures.ts'

type GcFn = (() => void) | undefined

interface MemoryRow {
  fixture: string
  fixture_bytes: number
  heap_before_kb: number
  heap_after_kb: number
  heap_delta_kb: number
  heap_per_byte: string
}

const gcFn = (globalThis as { gc?: GcFn }).gc
if (typeof gcFn !== 'function') {
  throw new Error('GC is unavailable. Run with --expose-gc.')
}

const rows: MemoryRow[] = []
const encoder = new TextEncoder()
const ITERATIONS = 1000

for (const [fixtureName, json] of Object.entries(FIXTURES)) {
  const chunks = tokenize(json, 'token')
  const bytes = encoder.encode(json).length

  gcFn()
  const before = process.memoryUsage().heapUsed

  for (let i = 0; i < ITERATIONS; i++) {
    const parser = new StreamingJSONParser({})
    for (const chunk of chunks) parser.write(chunk)
    parser.flush()
  }

  gcFn()
  const after = process.memoryUsage().heapUsed

  const deltaKbTotal = (after - before) / 1024
  const deltaKbPerOp = deltaKbTotal / ITERATIONS

  rows.push({
    fixture: fixtureName,
    fixture_bytes: bytes,
    heap_before_kb: Math.round(before / 1024),
    heap_after_kb: Math.round(after / 1024),
    heap_delta_kb: Number(deltaKbPerOp.toFixed(3)),
    heap_per_byte: `${((deltaKbPerOp / bytes) * 1024).toFixed(2)}x`,
  })
}

console.log('\n── memory usage per parse operation ─────────────────────────\n')
console.table(rows.map((r) => ({
  fixture: r.fixture,
  'input bytes': r.fixture_bytes,
  'heap delta/op': `${r.heap_delta_kb} KB`,
  ratio: r.heap_per_byte,
})))

mkdirSync('benchmarks/results', { recursive: true })
writeFileSync(
  `benchmarks/results/memory_${Date.now()}.json`,
  JSON.stringify(rows, null, 2),
)

/* BENCHMARK RESULTS — run on Apple M-series, Node v20, 2026-04-13
> jsonsettle@0.1.1 bench:memory
> node --expose-gc --import tsx benchmarks/memory.ts

── memory usage per parse operation ─────────────────────────

┌─────────┬───────────────────┬─────────────┬───────────────┬──────────┐
│ (index) │ fixture           │ input bytes │ heap delta/op │ ratio    │
├─────────┼───────────────────┼─────────────┼───────────────┼──────────┤
│ 0       │ 'flat_small'      │ 70          │ '-0.026 KB'   │ '-0.39x' │
│ 1       │ 'flat_medium'     │ 641         │ '-0.015 KB'   │ '-0.02x' │
│ 2       │ 'flat_large'      │ 1448        │ '0.044 KB'    │ '0.03x'  │
│ 3       │ 'nested_deep'     │ 130         │ '0.036 KB'    │ '0.28x'  │
│ 4       │ 'array_objects'   │ 2799        │ '0.097 KB'    │ '0.04x'  │
│ 5       │ 'strings_unicode' │ 229         │ '0.059 KB'    │ '0.26x'  │
│ 6       │ 'tool_call'       │ 210         │ '0.019 KB'    │ '0.09x'  │
│ 7       │ 'ai_analysis'     │ 368         │ '0.033 KB'    │ '0.09x'  │
│ 8       │ 'long_strings'    │ 1331        │ '0.011 KB'    │ '0.01x'  │
│ 9       │ 'numbers_heavy'   │ 589         │ '0.07 KB'     │ '0.12x'  │
└─────────┴───────────────────┴─────────────┴───────────────┴──────────┘
*/
