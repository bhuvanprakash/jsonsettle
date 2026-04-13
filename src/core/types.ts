// ─── Core Value Types ─────────────────────────────────────────────────────────
export type JSONPrimitive = string | number | boolean | null
export type JSONValue = JSONPrimitive | JSONObject | JSONArray
export type JSONObject = { [key: string]: JSONValue }
export type JSONArray = JSONValue[]

export type PartialValue = JSONPrimitive | PartialObject | PartialArray | undefined
export type PartialObject = { [key: string]: PartialValue }
export type PartialArray = PartialValue[]

// ─── Certainty ────────────────────────────────────────────────────────────────
// 'streaming' = value arrived but may still grow (e.g. "Joh" in "John", 12 in 123)
// 'certain'   = value is definitively closed (saw the closing `"`, `,`, `}`, or `]`)
export type Certainty = 'streaming' | 'certain'

export interface FieldInfo {
  path: string        // dot-notation path, e.g. "user.name"
  certainty: Certainty
  value: PartialValue
}

export interface StreamEvent {
  partial: PartialObject | PartialArray
  fields: Record<string, FieldInfo>
  isComplete: boolean
}

/** Top-level object field name → expected JSON value kind (opt-in validation). */
export type JSONSchemaFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'object'
  | 'array'

export class SchemaError extends Error {
  readonly field: string
  readonly expected: JSONSchemaFieldType

  constructor(message: string, field: string, expected: JSONSchemaFieldType) {
    super(message)
    this.name = 'SchemaError'
    this.field = field
    this.expected = expected
  }
}

export interface ParserOptions {
  onUpdate?: (event: StreamEvent) => void
  onComplete?: (value: JSONObject | JSONArray) => void
  /** When set, errors are delivered here instead of throwing (parser enters a dead state). */
  onError?: (error: Error) => void
  /** Flat map of root-object keys → expected types; only enforced for direct children of the top-level `{ ... }`. */
  schema?: Record<string, JSONSchemaFieldType>
}

// ─── Stack Frame ─────────────────────────────────────────────────────────────
export type StackFrame =
  | { type: 'object'; obj: PartialObject; key: string | null; certainKeys: Set<string> }
  | { type: 'array'; arr: PartialArray; index: number; certainIndices: Set<number> }
