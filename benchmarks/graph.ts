import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type ThroughputRow = {
  fixture: string
  mode: 'char' | 'token' | 'chunk'
  ops_per_sec: number
  throughput_mb_s: number
}

type CompareRow = {
  fixture: string
  library: 'jsonsettle' | 'partial-json' | '@streamparser/json'
  ops_per_sec: number
}

type CertaintyRow = {
  fixture: string
  first_certain_at: number
  total_chars: number
}

type MemoryRow = {
  fixture: string
  heap_delta_kb: number
}

const resultsDir = join(process.cwd(), 'benchmarks', 'results')

function latestFile(prefix: string): string {
  const files = readdirSync(resultsDir).filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
  if (files.length === 0) throw new Error(`No results found for prefix "${prefix}" in benchmarks/results`)
  return files.sort().at(-1)!
}

function parseJsonFile<T>(file: string): T {
  return JSON.parse(readFileSync(join(resultsDir, file), 'utf8')) as T
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Number(((numerator / denominator) * 100).toFixed(2))
}

const throughputFile = latestFile('throughput_')
const compareFile = latestFile('compare_')
const certaintyFile = latestFile('certainty_latency_')
const memoryFile = latestFile('memory_')

const throughput = parseJsonFile<ThroughputRow[]>(throughputFile)
const compare = parseJsonFile<CompareRow[]>(compareFile)
const certainty = parseJsonFile<CertaintyRow[]>(certaintyFile)
const memory = parseJsonFile<MemoryRow[]>(memoryFile)

const tokenRows = throughput.filter((r) => r.mode === 'token').sort((a, b) => b.ops_per_sec - a.ops_per_sec)
const certaintyRows = certainty
  .map((r) => ({ fixture: r.fixture, early_pct: pct(r.first_certain_at, r.total_chars) }))
  .sort((a, b) => a.early_pct - b.early_pct)

const jsonsettleByFixture = new Map(compare.filter((r) => r.library === 'jsonsettle').map((r) => [r.fixture, r.ops_per_sec]))
const partialByFixture = new Map(compare.filter((r) => r.library === 'partial-json').map((r) => [r.fixture, r.ops_per_sec]))
const streamparserByFixture = new Map(compare.filter((r) => r.library === '@streamparser/json').map((r) => [r.fixture, r.ops_per_sec]))

const compareTable = [...jsonsettleByFixture.keys()].map((fixture) => {
  const sj = jsonsettleByFixture.get(fixture) ?? 0
  const pj = partialByFixture.get(fixture) ?? 1
  const sp = streamparserByFixture.get(fixture) ?? 1
  return {
    fixture,
    vs_partial_json: Number((sj / pj).toFixed(2)),
    vs_streamparser: Number((sj / sp).toFixed(2)),
  }
})

const memoryRows = [...memory].sort((a, b) => a.heap_delta_kb - b.heap_delta_kb)

const markdown = `# Benchmark Graphs

Generated from:
- \`${throughputFile}\`
- \`${compareFile}\`
- \`${certaintyFile}\`
- \`${memoryFile}\`

## Token Mode Throughput (ops/s)

\`\`\`mermaid
xychart-beta
  title "jsonsettle throughput (token mode)"
  x-axis [${tokenRows.map((r) => `"${r.fixture}"`).join(', ')}]
  y-axis "ops/s" 0 --> ${Math.max(...tokenRows.map((r) => r.ops_per_sec))}
  bar [${tokenRows.map((r) => r.ops_per_sec).join(', ')}]
\`\`\`

## Certainty Starts Early (% of stream consumed at first certain field)

\`\`\`mermaid
xychart-beta
  title "first certain field appears early"
  x-axis [${certaintyRows.map((r) => `"${r.fixture}"`).join(', ')}]
  y-axis "first certain %" 0 --> 100
  bar [${certaintyRows.map((r) => r.early_pct).join(', ')}]
\`\`\`

## Speedup vs Other Parsers

| fixture | jsonsettle vs partial-json | jsonsettle vs @streamparser/json |
|---|---:|---:|
${compareTable.map((r) => `| ${r.fixture} | ${r.vs_partial_json}x | ${r.vs_streamparser}x |`).join('\n')}

## Heap Delta per Parse (KB/op)

\`\`\`mermaid
xychart-beta
  title "heap delta per parse operation"
  x-axis [${memoryRows.map((r) => `"${r.fixture}"`).join(', ')}]
  y-axis "KB/op" ${Math.min(0, ...memoryRows.map((r) => Math.floor(r.heap_delta_kb)))} --> ${Math.max(...memoryRows.map((r) => Math.ceil(r.heap_delta_kb + 0.1)))}
  bar [${memoryRows.map((r) => r.heap_delta_kb).join(', ')}]
\`\`\`
`

writeFileSync(join(resultsDir, 'graphs.md'), markdown)
console.log('Wrote benchmarks/results/graphs.md')
