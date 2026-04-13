import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { createSchemaParser, createTypedParser } from '../src/schema/zod.js'
import { StreamingJSONParser } from '../src/core/parser.js'
import { SchemaError } from '../src/core/types.js'

function feedByChar(parser: StreamingJSONParser, s: string) {
  for (const ch of s) parser.write(ch)
  parser.flush()
}

describe('createSchemaParser', () => {
  it('fires onCertainField for flat z.string / z.number / z.boolean when fed token by token', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      ok: z.boolean(),
    })
    const calls: { path: string; value: unknown }[] = []
    const parser = createSchemaParser(schema, {
      schema,
      onCertainField(path, value) {
        calls.push({ path, value })
      },
    })

    feedByChar(parser, '{"name":"Ada","age":41,"ok":true}')

    expect(calls).toEqual(
      expect.arrayContaining([
        { path: 'name', value: 'Ada' },
        { path: 'age', value: 41 },
        { path: 'ok', value: true },
      ]),
    )
    expect(calls.length).toBeGreaterThanOrEqual(3)
  })

  it('resolves nested paths (user.name) against the Zod shape', () => {
    const schema = z.object({
      user: z.object({ name: z.string() }),
    })
    const paths: string[] = []
    const parser = createSchemaParser(schema, {
      schema,
      onCertainField(path) {
        paths.push(path)
      },
    })

    feedByChar(parser, '{"user":{"name":"Nina"}}')

    expect(paths).toContain('user.name')
  })

  it('passes leafSchema as the third argument to onCertainField', () => {
    const schema = z.object({ title: z.string() })
    const schemas: unknown[] = []
    const parser = createSchemaParser(schema, {
      schema,
      onCertainField(_path, _value, leaf) {
        schemas.push(leaf)
      },
    })
    feedByChar(parser, '{"title":"x"}')
    expect(schemas.length).toBeGreaterThanOrEqual(1)
    expect((schemas[0] as { _def?: { typeName?: string } })._def?.typeName).toBe('ZodString')
  })
})

describe('createTypedParser', () => {
  it('getCertain returns only validated certain fields', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })
    const { parser, getCertain } = createTypedParser(schema)

    parser.write('{"name":"Bo')
    expect(getCertain()).toEqual({})

    parser.write('b","age":7}')
    parser.flush()

    expect(getCertain()).toMatchObject({ name: 'Bob', age: 7 })
  })
})

describe('schema divergence (opt-in ParserOptions.schema)', () => {
  it('calls onError with SchemaError field and expected', () => {
    const onError = vi.fn()
    const parser = new StreamingJSONParser({
      schema: { age: 'number' },
      onError,
    })

    parser.write('{"age":"')

    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0][0] as SchemaError
    expect(err).toBeInstanceOf(SchemaError)
    expect(err.field).toBe('age')
    expect(err.expected).toBe('number')

    parser.write('oops"}')
    expect(parser.getSnapshot().isComplete).toBe(false)
  })
})
