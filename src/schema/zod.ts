/**
 * Zod schema binding for streamjson.
 * Validates certainty-gated fields against your Zod schema.
 * Peer dependency: zod >= 3
 *
 * @example
 * const schema = z.object({ name: z.string(), age: z.number() })
 * const parser = createSchemaParser(schema, { onUpdate: console.log })
 */
import type { AnyZodObject, ZodTypeAny, z } from 'zod'
import { StreamingJSONParser } from '../core/parser.js'
import type { FieldInfo, ParserOptions, StreamEvent } from '../core/types.js'

type ZodDef = {
  typeName?: string
  shape?: () => Record<string, ZodTypeAny>
  type?: ZodTypeAny
  innerType?: ZodTypeAny
  schema?: ZodTypeAny
}

function unwrapZodType(schema: ZodTypeAny): ZodTypeAny {
  let s: ZodTypeAny = schema
  for (;;) {
    const d = s._def as ZodDef
    const tn = d?.typeName
    if (tn === 'ZodOptional' || tn === 'ZodNullable' || tn === 'ZodDefault' || tn === 'ZodCatch') {
      if (d.innerType) {
        s = d.innerType
        continue
      }
      return s
    }
    if (tn === 'ZodEffects') {
      if (d.schema) {
        s = d.schema
        continue
      }
      return s
    }
    return s
  }
}

/**
 * Walk `schema` following dot segments (object keys and numeric array indices) and return
 * the Zod schema for the leaf path, or `null` if the path is invalid for this schema.
 */
export function getLeafSchemaAtPath(root: ZodTypeAny, path: string): ZodTypeAny | null {
  const parts = path.split('.').filter((p) => p.length > 0)
  if (parts.length === 0) return null

  let cur: ZodTypeAny = root
  for (const part of parts) {
    cur = unwrapZodType(cur)
    const d = cur._def as ZodDef
    const tn = d.typeName

    if (tn === 'ZodObject') {
      const shape =
        typeof d.shape === 'function'
          ? d.shape()
          : ((cur as AnyZodObject).shape as Record<string, ZodTypeAny>)
      const next = shape[part]
      if (!next) return null
      cur = next
    } else if (tn === 'ZodArray') {
      if (!/^\d+$/.test(part)) return null
      const el = (d as { type?: ZodTypeAny }).type
      if (!el) return null
      cur = el
    } else {
      return null
    }
  }
  return unwrapZodType(cur)
}

/** Write a value at a dotted path into a tree of plain objects / arrays. */
export function setValueAtPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').filter((p) => p.length > 0)
  if (parts.length === 0) return

  let cur: unknown = root
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]!
    const isLast = i === parts.length - 1
    if (isLast) {
      if (Array.isArray(cur)) {
        const idx = Number(key)
        while (cur.length <= idx) cur.push(undefined)
        cur[idx] = value
      } else {
        ;(cur as Record<string, unknown>)[key] = value
      }
      return
    }

    const nextKey = parts[i + 1]!
    const childIsIndex = /^\d+$/.test(nextKey)

    if (Array.isArray(cur)) {
      const idx = Number(key)
      while (cur.length <= idx) cur.push(undefined)
      if (cur[idx] === undefined || cur[idx] === null) {
        cur[idx] = childIsIndex ? [] : {}
      }
      cur = cur[idx]
    } else {
      const o = cur as Record<string, unknown>
      if (o[key] === undefined || o[key] === null) {
        o[key] = childIsIndex ? [] : {}
      }
      cur = o[key]
    }
  }
}

export interface SchemaParserOptions<T extends ZodTypeAny> extends Omit<ParserOptions, 'schema'> {
  schema: T
  /**
   * Called when a field becomes `certain` and its value passes `safeParse` on the resolved
   * leaf schema for `path` (supports nested paths like `user.name` and `items.0.id`).
   */
  onCertainField?: (path: string, value: unknown, leafSchema: ZodTypeAny) => void
}

export function createSchemaParser<T extends ZodTypeAny>(
  schema: T,
  opts: SchemaParserOptions<T>,
): StreamingJSONParser {
  const { schema: zodSchema, onCertainField, onUpdate, ...rest } = opts

  return new StreamingJSONParser({
    ...rest,
    onUpdate(event: StreamEvent) {
      if (onCertainField) {
        for (const [path, info] of Object.entries(event.fields)) {
          if (info.certainty !== 'certain') continue
          const leaf = getLeafSchemaAtPath(zodSchema, path)
          if (!leaf) continue
          const result = leaf.safeParse(info.value)
          if (result.success) {
            onCertainField(path, result.data as unknown, leaf)
          }
        }
      }
      onUpdate?.(event)
    },
  })
}

export function createTypedParser<T extends ZodTypeAny>(
  schema: T,
  opts?: Omit<SchemaParserOptions<T>, 'schema'>,
): {
  parser: StreamingJSONParser
  getCertain: () => Partial<z.infer<T>>
} {
  const parser = createSchemaParser(schema, { ...opts, schema })

  return {
    parser,
    getCertain(): Partial<z.infer<T>> {
      const snap = parser.getSnapshot()
      const out: Record<string, unknown> = {}
      for (const [path, info] of Object.entries(snap.fields) as [string, FieldInfo][]) {
        if (info.certainty !== 'certain') continue
        const leaf = getLeafSchemaAtPath(schema, path)
        if (!leaf) continue
        const result = leaf.safeParse(info.value)
        if (result.success) {
          setValueAtPath(out, path, result.data as unknown)
        }
      }
      return out as Partial<z.infer<T>>
    },
  }
}
