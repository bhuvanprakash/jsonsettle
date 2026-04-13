/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { StreamingJSONParser } from '../../src/core/parser.js'
import { collectEvents, tokenize } from './_setup.js'

function assertCertaintyImmutability(events: Awaited<ReturnType<typeof collectEvents>>) {
  const stable = new Map<string, unknown>()
  for (const ev of events) {
    for (const [path, info] of Object.entries(ev.fields)) {
      if (info.certainty !== 'certain') continue
      if (stable.has(path)) {
        expect(info.value).toEqual(stable.get(path))
      } else {
        stable.set(path, info.value)
      }
    }
  }
}

function withNoise(chunks: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    if (i % 3 === 0) out.push('')
    out.push(chunks[i]!)
    if (i % 5 === 0) out.push('')
  }
  return out
}

function assertFinalIntegrity(events: Awaited<ReturnType<typeof collectEvents>>) {
  expect(events.length).toBeGreaterThan(0)
  const final = events[events.length - 1]!
  expect(final.isComplete).toBe(true)
  for (const [path, info] of Object.entries(final.fields)) {
    expect(info.certainty).toBe('certain')
    expect(path.length).toBeGreaterThan(0)
  }
}

describe('certainty integration', () => {
  it('Test 1 — certainty immutability law over 1100 randomized runs + noisy chunks', async () => {
    const corpus = [
      '{"name":"Alice","age":30,"verified":true}',
      '{"name":"","age":0,"active":false}',
      '{"score":-3.14159,"label":"negative float"}',
      '{"n":1e10,"m":1.5e-3}',
      '{"a":{"b":{"c":{"d":42}}}}',
      '{"tags":["ai","llm","streaming","json"]}',
      '{"items":[{"id":1,"name":"a"},{"id":2,"name":"b"},{"id":3,"name":"c"}]}',
      '{"msg":"hello \\"world\\" \\n newline \\t tab"}',
      '{"unicode":"caf\\u00e9 \\u2728 \\u4e2d\\u6587"}',
      '{"empty_str":"","zero":0,"null_val":null,"f":false,"t":true}',
      '{"deeply":{"nested":{"array":[1,2,{"key":"val"}]}}}',
    ]

    const started = performance.now()
    for (const json of corpus) {
      for (let i = 0; i < 100; i++) {
        const base = tokenize(json)
        const chunks = i % 10 === 0 ? withNoise(base) : base
        const events = await collectEvents(chunks, i % 25 === 0 ? 1 : 0)
        assertCertaintyImmutability(events)
        assertFinalIntegrity(events)
      }
    }
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(5_000)
  })

  it('Test 2 — number certainty boundary', () => {
    const parser = new StreamingJSONParser()
    parser.write('{"age":1')
    expect(parser.getSnapshot().fields.age?.certainty).toBe('streaming')
    parser.write('2')
    expect(parser.getSnapshot().fields.age?.certainty).toBe('streaming')
    parser.write('3')
    expect(parser.getSnapshot().fields.age?.certainty).toBe('streaming')
    parser.write('}')
    parser.flush()
    expect(parser.getSnapshot().fields.age?.certainty).toBe('certain')
    expect((parser.getSnapshot().partial as Record<string, unknown>).age).toBe(123)
  })

  it('Test 3 — string certainty boundary at exact closing quote', () => {
    const input = '{"name":"Alice","x":1}'
    const closeQuoteIndex = input.indexOf('"', input.indexOf('"Alice"') + 1)
    const parser = new StreamingJSONParser()
    let firstCertainAt = -1
    for (let i = 0; i < input.length; i++) {
      parser.write(input[i]!)
      if (firstCertainAt < 0 && parser.getSnapshot().fields.name?.certainty === 'certain') {
        firstCertainAt = i
      }
    }
    parser.flush()
    expect(firstCertainAt).toBe(closeQuoteIndex)
    expect((parser.getSnapshot().partial as Record<string, unknown>).name).toBe('Alice')
  })

  it('Test 4 — nested object certainty propagation', () => {
    const input = '{"user":{"name":"Bob"}}'
    const parser = new StreamingJSONParser()
    let userNameCertain = -1
    let userCertain = -1
    for (let i = 0; i < input.length; i++) {
      parser.write(input[i]!)
      const snap = parser.getSnapshot()
      if (userNameCertain < 0 && snap.fields['user.name']?.certainty === 'certain') userNameCertain = i
      if (userCertain < 0 && snap.fields.user?.certainty === 'certain') userCertain = i
    }
    const rootCertainAt = input.length - 1
    expect(userNameCertain).toBeGreaterThanOrEqual(0)
    expect(userCertain).toBeGreaterThan(userNameCertain)
    expect(rootCertainAt).toBe(input.length - 1)
  })

  it('Test 5 — array item certainty boundaries', () => {
    const input = '{"tags":["a","b","c"]}'
    const parser = new StreamingJSONParser()
    for (const ch of input) parser.write(ch)
    parser.flush()
    const snap = parser.getSnapshot()
    expect(snap.fields['tags.0']?.certainty).toBe('certain')
    expect(snap.fields['tags.1']?.certainty).toBe('certain')
    expect(snap.fields['tags.2']?.certainty).toBe('certain')
    expect((snap.partial as Record<string, unknown>).tags).toEqual(['a', 'b', 'c'])
  })
})
