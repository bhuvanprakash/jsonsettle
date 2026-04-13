# Benchmarks

## Running

```bash
# Throughput (all fixtures × all chunk modes)
npm run bench

# vs partial-json and @streamparser/json
npm run bench:compare

# Memory usage (requires --expose-gc)
npm run bench:memory

# Certainty latency (how early fields lock in)
npx tsx benchmarks/certainty_latency.ts

# Generate markdown graphs from latest JSON results
npx tsx benchmarks/graph.ts
```

`npm run bench`, `npm run bench:compare`, and `npm run bench:memory` also refresh `benchmarks/results/graphs.md` automatically.

## What we measure

| Benchmark | What it proves |
|-----------|----------------|
| `run.ts` | Raw parse throughput in ops/sec and MB/s |
| `compare.ts` | Speed vs alternatives + unique certainty/schema features |
| `certainty_latency.ts` | How early fields are usable vs waiting for full parse |
| `memory.ts` | Heap overhead per parse operation |

## Interpreting results

- **certainty_latency** is the most important. It shows the core value prop: fields are usable early in stream progression, not only at completion.
- **compare.ts** shows that jsonsettle is competitive on speed while being the only library that tracks certainty and supports schema validation.
- **memory.ts** confirms the parser is GC-friendly with low per-parse heap overhead.
