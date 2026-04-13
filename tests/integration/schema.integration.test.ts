/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { StreamingJSONParser } from '../../src/core/parser.js'
import { SchemaError, type StreamEvent } from '../../src/core/types.js'
import { createSchemaParser, createTypedParser } from '../../src/schema/zod.js'

describe('schema integration', () => {
  it('Test 1 — Zod createTypedParser certainty gating', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().int().min(0).max(150),
      email: z.string().email(),
      active: z.boolean(),
      score: z.number().min(0).max(1),
    })

    const input = '{"name":"Alice","age":28,"email":"alice@example.com","active":true,"score":0.95}'
    const { parser, getCertain } = createTypedParser(schema)

    const snapshots: Array<{ fields: StreamEvent['fields']; certain: Record<string, unknown> }> = []
    for (const ch of input) {
      parser.write(ch)
      snapshots.push({ fields: parser.getSnapshot().fields, certain: getCertain() as Record<string, unknown> })
    }
    parser.flush()

    const paths = ['name', 'age', 'email', 'active', 'score'] as const

    for (const snap of snapshots) {
      for (const key of Object.keys(snap.certain)) {
        expect(snap.fields[key]?.certainty).toBe('certain')
      }
    }

    for (const path of paths) {
      const idxCertain = snapshots.findIndex((s) => s.fields[path]?.certainty === 'certain')
      const idxInTyped = snapshots.findIndex((s) => path in s.certain)
      expect(idxCertain).toBeGreaterThanOrEqual(0)
      expect(idxInTyped).toBe(idxCertain)
    }

    expect(getCertain()).toEqual({
      name: 'Alice',
      age: 28,
      email: 'alice@example.com',
      active: true,
      score: 0.95,
    })
  })

  it('Test 2 — Schema divergence triggers SchemaError', () => {
    const schema = { name: 'string', age: 'number', active: 'boolean' } as const
    const errors: SchemaError[] = []
    let updates = 0

    const parser = new StreamingJSONParser({
      schema,
      onUpdate: () => updates++,
      onError: (e) => errors.push(e as SchemaError),
    })

    parser.write('{"name":"Alice","age":"NOT_A_NUMBER","active":true}')
    const updatesAfterError = updates
    parser.write('{"name":"ignored"}')

    expect(errors.length).toBe(1)
    expect(errors[0].field).toBe('age')
    expect(errors[0].expected).toBe('number')
    expect(updates).toBe(updatesAfterError)
  })

  it('Test 3 — createTypedParser rejects invalid values from getCertain()', () => {
    const schema = z.object({ age: z.number().min(0) })
    const { parser, getCertain } = createTypedParser(schema)

    for (const ch of '{"age":-5}') parser.write(ch)
    parser.flush()

    expect(parser.getSnapshot().fields['age']?.certainty).toBe('certain')
    expect(getCertain()).toEqual({})
  })

  it('Test 4 — Zod nested schema path resolution', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        email: z.string().email(),
      }),
      meta: z.object({
        created_at: z.string(),
      }),
    })

    const seen: Array<{ path: string; value: unknown }> = []
    const parser = createSchemaParser(schema, {
      schema,
      onCertainField(path, value) {
        seen.push({ path, value })
      },
    })

    const input = '{"user":{"name":"Bob","email":"bob@test.com"},"meta":{"created_at":"2026-01-01"}}'
    for (const ch of input) parser.write(ch)
    parser.flush()

    expect(seen).toEqual(
      expect.arrayContaining([
        { path: 'user.name', value: 'Bob' },
        { path: 'user.email', value: 'bob@test.com' },
        { path: 'meta.created_at', value: '2026-01-01' },
      ]),
    )
  })
})
