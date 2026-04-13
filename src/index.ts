import { StreamingJSONParser } from './core/parser.js'

export { StreamingJSONParser }
export type {
  JSONValue, JSONObject, JSONArray,
  PartialValue, PartialObject, PartialArray,
  Certainty, FieldInfo, StreamEvent, ParserOptions,
  StackFrame,
  JSONSchemaFieldType,
} from './core/types.js'
export { SchemaError } from './core/types.js'

// Convenience factory
export function createParser(opts: import('./core/types.js').ParserOptions = {}) {
  return new StreamingJSONParser(opts)
}
