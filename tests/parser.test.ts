import { describe, it, expect } from 'vitest'
import { StreamingJSONParser } from '../src/core/parser.js'

function parse(input: string) {
  const events: any[] = []
  const parser = new StreamingJSONParser({ onUpdate: (e) => events.push(e) })
  // Feed char by char (worst-case streaming)
  for (const ch of input) parser.write(ch)
  parser.flush()
  return events
}

describe('StreamingJSONParser — basic values', () => {
  it('parses a flat object all at once', () => {
    const events = parse('{"name":"Alice","age":30}')
    const last = events[events.length - 1]
    expect(last.partial).toEqual({ name: 'Alice', age: 30 })
    expect(last.isComplete).toBe(true)
  })

  it('certifies string only after closing quote', () => {
    const events: any[] = []
    const parser = new StreamingJSONParser({ onUpdate: (e) => events.push(e) })
    // Feed up to partial string
    parser.write('{"name":"Ali')
    const mid = parser.getSnapshot()
    expect(mid.fields['name']?.certainty).toBe('streaming')
    expect(mid.partial).toMatchObject({ name: 'Ali' })

    parser.write('ce"}')
    parser.flush()
    const final = parser.getSnapshot()
    expect(final.fields['name']?.certainty).toBe('certain')
    expect(final.partial).toMatchObject({ name: 'Alice' })
  })

  it('certifies number only after terminating character', () => {
    const events: any[] = []
    const parser = new StreamingJSONParser({ onUpdate: (e) => events.push(e) })
    parser.write('{"age":2')
    expect(parser.getSnapshot().fields['age']?.certainty).toBe('streaming')
    parser.write('5}')
    parser.flush()
    expect(parser.getSnapshot().fields['age']?.certainty).toBe('certain')
    expect(parser.getSnapshot().partial).toMatchObject({ age: 25 })
  })

  it('handles nested objects', () => {
    const events = parse('{"user":{"name":"Bob","active":true}}')
    const last = events[events.length - 1]
    expect(last.partial).toMatchObject({ user: { name: 'Bob', active: true } })
    expect(last.isComplete).toBe(true)
  })

  it('handles arrays', () => {
    const events = parse('{"tags":["ai","llm","streaming"]}')
    const last = events[events.length - 1]
    expect(last.partial).toMatchObject({ tags: ['ai', 'llm', 'streaming'] })
  })

  it('handles unicode escapes', () => {
    const events = parse('{"emoji":"\\u2728"}')
    const last = events[events.length - 1]
    expect(last.partial).toMatchObject({ emoji: '✨' })
  })

  it('handles escaped quotes in strings', () => {
    const events = parse('{"msg":"say \\"hello\\""}')
    const last = events[events.length - 1]
    expect(last.partial).toMatchObject({ msg: 'say "hello"' })
  })

  it('emits partial events for every character (streaming simulation)', () => {
    const json = '{"name":"Alice"}'
    const events: any[] = []
    const parser = new StreamingJSONParser({ onUpdate: (e) => events.push(e) })
    for (const ch of json) parser.write(ch)
    parser.flush()
    // Should have emitted one event per char (minus whitespace transitions)
    expect(events.length).toBeGreaterThan(5)
    // Final event is complete
    expect(events[events.length - 1].isComplete).toBe(true)
  })
})

describe('StreamingJSONParser — edge cases', () => {
  it('parses empty object', () => {
    const events = parse('{}')
    expect(events[events.length - 1].isComplete).toBe(true)
  })

  it('parses empty array', () => {
    const events = parse('[]')
    expect(events[events.length - 1].isComplete).toBe(true)
  })

  it('handles null values', () => {
    const events = parse('{"x":null}')
    expect(events[events.length - 1].partial).toMatchObject({ x: null })
  })

  it('handles boolean values', () => {
    const events = parse('{"a":true,"b":false}')
    const last = events[events.length - 1]
    expect(last.partial).toMatchObject({ a: true, b: false })
  })

  it('handles float numbers', () => {
    const events = parse('{"score":3.14}')
    expect(events[events.length - 1].partial).toMatchObject({ score: 3.14 })
  })
})
