import { describe, test, expect } from 'vitest'
import OpenAI from 'openai'
import { StreamingJSONParser } from '../../src/core/parser.js'
import type { StreamEvent } from '../../src/core/types.js'

// DeepSeek uses the OpenAI SDK — just point baseURL to DeepSeek's endpoint
const DEEPSEEK_KEY = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env?.DEEPSEEK_API_KEY
const SKIP = !DEEPSEEK_KEY

const client = DEEPSEEK_KEY ? new OpenAI({
  apiKey: DEEPSEEK_KEY,
  baseURL: 'https://api.deepseek.com',
}) : null

function makeDeterministicRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function splitAdversarial(input: string, seed = 1): string[] {
  const rand = makeDeterministicRng(seed)
  const chunks: string[] = []
  let i = 0
  while (i < input.length) {
    const mode = Math.floor(rand() * 5)
    const max = mode === 0 ? 1 : mode === 1 ? 2 : mode === 2 ? 3 : mode === 3 ? 5 : 8
    const len = Math.max(1, Math.min(max, input.length - i))
    chunks.push(input.slice(i, i + len))
    if (rand() < 0.2) chunks.push('')
    i += len
  }
  return chunks
}

function assertCertaintyNeverChanges(events: StreamEvent[]): void {
  const firstCertainValues: Record<string, unknown> = {}
  for (const event of events) {
    for (const [key, info] of Object.entries(event.fields)) {
      if (info.certainty !== 'certain') continue
      if (!(key in firstCertainValues)) {
        firstCertainValues[key] = info.value
        continue
      }
      expect(info.value).toEqual(firstCertainValues[key])
    }
  }
}

describe('DeepSeek real API — streaming JSON certainty', () => {

  test.skipIf(SKIP)('fields become certain before completion under adversarial local chunking', async () => {
    const stream = await client!.chat.completions.create({
      model: 'deepseek-chat',
      stream: true,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'system',
        content: 'You output only raw JSON. No explanation. No markdown.',
      }, {
        role: 'user',
        content: 'Return this exact JSON (including nested fields): {"name":"Priya Sharma","age":28,"city":"Mumbai","verified":true,"email":"priya@example.com","score":0.95,"profile":{"bio":"Loves unicode: नमस्ते and emoji 🚀","tags":["ml","systems","streaming"]},"history":[{"year":2022,"status":"active"},{"year":2023,"status":"promoted"}]}',
      }],
    })

    const events: StreamEvent[] = []
    let totalTokens = 0
    let firstCertainToken = -1

    const parser = new StreamingJSONParser({
      onUpdate: (e) => {
        events.push(e)
        const hasCertain = Object.values(e.fields).some(f => f.certainty === 'certain')
        if (hasCertain && firstCertainToken === -1) {
          firstCertainToken = totalTokens
        }
      },
    })

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? ''
      if (content) {
        const adversarialChunks = splitAdversarial(content, totalTokens + 17)
        for (const part of adversarialChunks) {
          parser.write(part)
          totalTokens += part.length
        }
      }
    }
    parser.flush()

    // THE CORE ASSERTION — certainty arrives before the stream ends
    expect(firstCertainToken).toBeGreaterThan(0)
    expect(firstCertainToken).toBeLessThan(totalTokens)
    console.log(`✓ Certainty arrived at token ${firstCertainToken} / ${totalTokens} total chars`)

    // Final state must be complete
    const final = events[events.length - 1]
    expect(final.isComplete).toBe(true)

    // All expected fields present
    const partial = final.partial as Record<string, unknown>
    expect(partial.name).toBeDefined()
    expect(partial.age).toBeDefined()
    expect(partial.city).toBeDefined()
    expect(partial.verified).toBeDefined()

    assertCertaintyNeverChanges(events)
    expect(final.fields['profile.bio']?.certainty).toBe('certain')
    expect(final.fields['history.0.year']?.certainty).toBe('certain')
    expect(final.fields['history.1.status']?.certainty).toBe('certain')
  }, 45_000)

  test.skipIf(SKIP)('JSON mode remains parseable after repeated write fragmentation', async () => {
    const stream = await client!.chat.completions.create({
      model: 'deepseek-chat',
      stream: true,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'system',
        content: 'Output only raw JSON.',
      }, {
        role: 'user',
        content: 'Return JSON with fields: product (string), price (number), available (boolean)',
      }],
    })

    let raw = ''
    const parser = new StreamingJSONParser({
      onUpdate: () => {},
    })

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? ''
      if (content) {
        raw += content
        for (const part of splitAdversarial(content, raw.length + 31)) {
          parser.write(part)
        }
      }
    }
    parser.flush()

    const snap = parser.getSnapshot()
    expect(snap.isComplete).toBe(true)

    // Must be valid JSON
    expect(() => JSON.parse(raw)).not.toThrow()

    // product, price, available must all be certain at end
    expect(snap.fields['product']?.certainty).toBe('certain')
    expect(snap.fields['price']?.certainty).toBe('certain')
    expect(snap.fields['available']?.certainty).toBe('certain')
  }, 45_000)

  test.skipIf(SKIP)('certainty immutability survives complex escapes and nested updates', async () => {
    const stream = await client!.chat.completions.create({
      model: 'deepseek-chat',
      stream: true,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'system',
        content: 'Output only raw JSON. No extra text.',
      }, {
        role: 'user',
        content: 'Return JSON: {"username":"bhuvan_prakash","role":"engineer","level":5,"active":true,"joined":"2024-01-15","meta":{"quote":"He said: \\"stream safely\\"","path":"C:\\\\temp\\\\data","unicode":"नमस्ते","emoji":"🚀"},"scores":[0.1,0.25,0.5,0.75]}',
      }],
    })

    const events: StreamEvent[] = []

    const parser = new StreamingJSONParser({
      onUpdate: (e) => {
        events.push(e)
      },
    })

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? ''
      if (!content) continue
      for (const part of splitAdversarial(content, content.length * 7 + 5)) {
        parser.write(part)
      }
    }
    parser.flush()

    const final = events[events.length - 1]
    expect(final.isComplete).toBe(true)
    assertCertaintyNeverChanges(events)
    expect(final.fields['meta.path']?.certainty).toBe('certain')
    expect(final.fields['meta.quote']?.certainty).toBe('certain')
    expect(final.fields['scores.3']?.certainty).toBe('certain')
  }, 45_000)

  test.skipIf(SKIP)('parser remains stable across repeated real-stream runs', async () => {
    for (let run = 0; run < 3; run++) {
      const stream = await client!.chat.completions.create({
        model: 'deepseek-chat',
        stream: true,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'system',
          content: 'Output only raw JSON.',
        }, {
          role: 'user',
          content: `Return JSON: {"run":${run},"name":"jsonsettle","ok":true,"nested":{"index":${run},"label":"pass-${run}"}}`,
        }],
      })

      const events: StreamEvent[] = []
      const parser = new StreamingJSONParser({
        onUpdate: (event) => events.push(event),
      })

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content ?? ''
        if (!content) continue
        for (const part of splitAdversarial(content, run * 100 + content.length)) {
          parser.write(part)
        }
      }
      parser.flush()

      const final = events[events.length - 1]
      expect(final.isComplete).toBe(true)
      expect(final.fields['ok']?.certainty).toBe('certain')
      expect(final.fields['nested.label']?.certainty).toBe('certain')
      assertCertaintyNeverChanges(events)
    }
  }, 90_000)

})
