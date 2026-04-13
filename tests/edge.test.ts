import { describe, it, expect } from 'vitest'
import { StreamingJSONParser } from '../src/core/parser.js'

function parse(input: string) {
  const parser = new StreamingJSONParser({})
  for (const ch of input) parser.write(ch)
  parser.flush()
  return parser.getSnapshot()
}

describe('StreamingJSONParser — numeric and structural edges', () => {
  it('parses negative float', () => {
    const snap = parse('{"score":-3.14}')
    expect(snap.partial).toMatchObject({ score: -3.14 })
    expect(snap.fields['score']?.certainty).toBe('certain')
  })

  it('parses exponent notation', () => {
    const snap = parse('{"n":1e10}')
    expect(snap.partial).toMatchObject({ n: 1e10 })
    expect(snap.fields['n']?.certainty).toBe('certain')
  })

  it('tracks deeply nested path a.b.c', () => {
    const snap = parse('{"a":{"b":{"c":42}}}')
    expect(snap.fields['a.b.c']).toBeDefined()
    expect(snap.fields['a.b.c']?.value).toBe(42)
    expect(snap.fields['a.b.c']?.certainty).toBe('certain')
  })

  it('tracks array of objects paths items.0.id and items.1.id', () => {
    const snap = parse('{"items":[{"id":1},{"id":2}]}')
    expect(snap.fields['items.0.id']?.value).toBe(1)
    expect(snap.fields['items.1.id']?.value).toBe(2)
  })

  it('parses empty string value', () => {
    const snap = parse('{"name":""}')
    expect(snap.partial).toMatchObject({ name: '' })
    expect(snap.fields['name']?.certainty).toBe('certain')
  })
})

describe('StreamingJSONParser — escapes', () => {
  it('unescapes \\n and \\t in strings', () => {
    const snap = parse(String.raw`{"msg":"a\n\tb"}`)
    expect(snap.partial).toMatchObject({ msg: 'a\n\tb' })
  })
})
