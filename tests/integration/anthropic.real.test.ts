/// <reference types="node" />
import { describe, expect, test } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { StreamingJSONParser } from '../../src/core/parser.js'
import { ANTHROPIC_KEY, SKIP_ANTHROPIC } from './_setup.js'

const itAnthropic = test.skipIf(SKIP_ANTHROPIC)

describe('anthropic real streaming integration', () => {
  itAnthropic('Test 1 — Real Anthropic structured output stream', async () => {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY })
    const parser = new StreamingJSONParser()

    let sawCertainBeforeComplete = false
    const stream = anthropic.messages.stream({
      model: 'claude-haiku-20240307',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content:
            'Reply with ONLY this JSON: {"product":"laptop","price":999.99,"in_stock":true,"tags":["electronics","portable"]}',
        },
      ],
    } as any)

    for await (const event of stream as any) {
      const text = (event?.delta?.text as string | undefined) ?? ''
      if (!text) continue
      parser.write(text)
      const snap = parser.getSnapshot()
      if (!snap.isComplete && Object.values(snap.fields).some((f) => f.certainty === 'certain')) {
        sawCertainBeforeComplete = true
      }
    }
    parser.flush()

    const finalSnap = parser.getSnapshot()
    expect(sawCertainBeforeComplete).toBe(true)
    expect(finalSnap.isComplete).toBe(true)

    const obj = finalSnap.partial as Record<string, unknown>
    expect(obj.product).toBeDefined()
    expect(obj.price).toBeDefined()
    expect(obj.in_stock).toBeDefined()
    expect(obj.tags).toBeDefined()
  }, 90_000)

  itAnthropic('Test 2 — Multi-field early certainty from Anthropic', async () => {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY })
    const parser = new StreamingJSONParser()

    let maxCertainBeforeEnd = 0
    const stream = anthropic.messages.stream({
      model: 'claude-haiku-20240307',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content:
            'Return JSON user profile with at least 6 keys: name, age, city, email, role, active, and a short bio.',
        },
      ],
    } as any)

    for await (const event of stream as any) {
      const text = (event?.delta?.text as string | undefined) ?? ''
      if (!text) continue
      parser.write(text)
      const snap = parser.getSnapshot()
      if (!snap.isComplete) {
        const c = Object.values(snap.fields).filter((f) => f.certainty === 'certain').length
        maxCertainBeforeEnd = Math.max(maxCertainBeforeEnd, c)
      }
    }
    parser.flush()

    expect(parser.getSnapshot().isComplete).toBe(true)
    expect(maxCertainBeforeEnd).toBeGreaterThanOrEqual(2)
  }, 90_000)
})
