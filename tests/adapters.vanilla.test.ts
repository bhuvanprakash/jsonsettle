import { describe, it, expect } from 'vitest'
import { fromAsyncIterable } from '../src/adapters/vanilla.js'

async function* chars(s: string) {
  for (const c of s) yield c
}

describe('vanilla fromAsyncIterable', () => {
  it('parses JSON and invokes onComplete', async () => {
    let complete: unknown
    await fromAsyncIterable(chars('{"a":1}'), {
      onComplete(v) {
        complete = v
      },
    })
    expect(complete).toEqual({ a: 1 })
  })
})
