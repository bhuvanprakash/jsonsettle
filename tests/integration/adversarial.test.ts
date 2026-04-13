/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { StreamingJSONParser } from '../../src/core/parser.js'

function parseByChars(s: string) {
  const parser = new StreamingJSONParser()
  for (const ch of s) parser.write(ch)
  parser.flush()
  return parser.getSnapshot()
}

describe('adversarial integration', () => {
  it('Test 1 — split inside unicode escape at every position', () => {
    const source = '{"e":"caf\\u00e9"}'
    for (let i = 0; i <= source.length; i++) {
      const parser = new StreamingJSONParser()
      parser.write(source.slice(0, i))
      parser.write(source.slice(i))
      parser.flush()
      const snap = parser.getSnapshot()
      expect((snap.partial as Record<string, unknown>).e).toBe('café')
      expect(snap.fields.e?.certainty).toBe('certain')
      expect(snap.isComplete).toBe(true)
    }
  })

  it('Test 2 — splits inside true/false/null', () => {
    const literals = [
      { json: '{"a":true}', value: true },
      { json: '{"a":false}', value: false },
      { json: '{"a":null}', value: null },
    ]
    for (const { json, value } of literals) {
      for (let i = 0; i <= json.length; i++) {
        const parser = new StreamingJSONParser()
        parser.write(json.slice(0, i))
        parser.write(json.slice(i))
        parser.flush()
        const snap = parser.getSnapshot()
        expect((snap.partial as Record<string, unknown>).a).toBe(value)
        expect(snap.fields.a?.certainty).toBe('certain')
      }
    }
  })

  it('Test 3 — negative and scientific numbers', () => {
    const cases = [
      { json: '{"a":-0}', expected: 0 },
      { json: '{"a":-123.456}', expected: -123.456 },
      { json: '{"a":1e3}', expected: 1000 },
      { json: '{"a":1.5E-4}', expected: 0.00015 },
      { json: '{"a":-1.5e+10}', expected: -15000000000 },
    ]
    for (const { json, expected } of cases) {
      const snap = parseByChars(json)
      const got = (snap.partial as Record<string, unknown>).a as number
      if (json === '{"a":-0}') {
        expect(Math.abs(got)).toBe(0)
      } else {
        expect(got).toBe(expected)
      }
      expect(snap.fields.a?.certainty).toBe('certain')
    }
  })

  it('Test 4 — deeply nested stack stress to depth 50', () => {
    const depth = 50
    const source = `${'{"a":'.repeat(depth)}{"val":42}${'}'.repeat(depth)}`
    const snap = parseByChars(source)
    const deepestPath = `${'a.'.repeat(depth)}val`
    expect(snap.fields[deepestPath]?.value).toBe(42)
    expect(snap.isComplete).toBe(true)
  })

  it('Test 5 — large JSON performance + correctness', () => {
    const source = `{${Array.from({ length: 1000 }, (_, i) => `"key${i}":"val${i}"`).join(',')}}`

    // warmup
    {
      const warm = new StreamingJSONParser()
      for (let i = 0; i < source.length; i += 3) warm.write(source.slice(i, i + 3))
      warm.flush()
    }

    const runs: number[] = []
    let snap = parseByChars('{}')
    for (let r = 0; r < 3; r++) {
      const parser = new StreamingJSONParser()
      const started = performance.now()
      for (let i = 0; i < source.length; i += 3) parser.write(source.slice(i, i + 3))
      parser.flush()
      runs.push(performance.now() - started)
      snap = parser.getSnapshot()
    }

    expect(snap.isComplete).toBe(true)
    for (let i = 0; i < 1000; i++) {
      expect(snap.fields[`key${i}`]?.certainty).toBe('certain')
      expect((snap.partial as Record<string, unknown>)[`key${i}`]).toBe(`val${i}`)
    }
    expect(Math.min(...runs)).toBeLessThan(200)
  })

  it('Test 6 — back-to-back instances have no shared state', async () => {
    const inputs = Array.from({ length: 10 }, (_, i) => `{"id":${i},"name":"u${i}"}`)
    const results = await Promise.all(
      inputs.map(async (input, i) => {
        const parser = new StreamingJSONParser()
        for (const ch of input) {
          parser.write(ch)
          await Promise.resolve()
        }
        parser.flush()
        return { i, snap: parser.getSnapshot() }
      }),
    )
    for (const { i, snap } of results) {
      expect((snap.partial as Record<string, unknown>).id).toBe(i)
      expect((snap.partial as Record<string, unknown>).name).toBe(`u${i}`)
    }
  })

  it('Test 7 — write after flush should not corrupt silently', () => {
    let count = 0
    const parser = new StreamingJSONParser({ onUpdate: () => count++ })
    parser.write('{"a":1}')
    parser.flush()
    const countAfterFlush = count
    let threw = false
    try {
      parser.write('{"b":2}')
    } catch {
      threw = true
    }
    expect(threw || count === countAfterFlush).toBe(true)
  })

  it('Test 8 — empty string chunks', () => {
    const chunks = ['', '{', '', '"', 'name', '', '"', ':', '"', 'Ali', 'ce', '"', '}']
    const parser = new StreamingJSONParser()
    for (const c of chunks) parser.write(c)
    parser.flush()
    const snap = parser.getSnapshot()
    expect((snap.partial as Record<string, unknown>).name).toBe('Alice')
    expect(snap.fields.name?.certainty).toBe('certain')
  })

  it('Test 9 — whitespace everywhere parses correctly', () => {
    const source = `{
  "name"  :  "Alice"  ,
  "age"  :  30  ,
  "active"  :  true
}`
    const snap = parseByChars(source)
    expect(snap.partial).toMatchObject({ name: 'Alice', age: 30, active: true })
  })

  it('Test 10 — onError called once and parser halts updates', () => {
    const errors: Error[] = []
    let updates = 0
    const parser = new StreamingJSONParser({
      onUpdate: () => updates++,
      onError: (e) => errors.push(e),
    })
    parser.write('{"name": INVALID_TOKEN}')
    const updatesAfter = updates
    parser.write('{"name":"ignored"}')
    expect(errors.length).toBe(1)
    expect(errors[0]).toBeInstanceOf(Error)
    expect(updates).toBe(updatesAfter)
  })
})
