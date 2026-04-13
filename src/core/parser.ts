import type {
  PartialObject, PartialArray, PartialValue,
  StackFrame, StreamEvent, FieldInfo, ParserOptions,
  JSONObject, JSONArray, Certainty, JSONSchemaFieldType,
} from './types.js'
import { SchemaError } from './types.js'

// ─── Parser State Machine ─────────────────────────────────────────────────────
type State =
  | 'ROOT'
  | 'OBJ_OPEN'        // saw '{', waiting for key or '}'
  | 'OBJ_KEY'         // inside key string
  | 'OBJ_POST_KEY'    // after closing '"' of key, waiting for ':'
  | 'OBJ_COLON'       // after ':', waiting for value
  | 'OBJ_POST_VAL'    // after value, waiting for ',' or '}'
  | 'OBJ_NEXT_KEY'    // after ',', waiting for next key '"'
  | 'ARR_OPEN'        // saw '[', waiting for value or ']'
  | 'ARR_POST_VAL'    // after array value, waiting for ',' or ']'
  | 'STR_VAL'         // inside a string value
  | 'STR_ESCAPE'      // after '\' inside a string value
  | 'STR_UNICODE'     // reading \uXXXX
  | 'STR_KEY'         // inside a key string
  | 'STR_KEY_ESCAPE'  // after '\' inside a key string
  | 'NUM'             // reading a number
  | 'LITERAL'         // reading true/false/null
  | 'DONE'

const WHITESPACE = new Set([' ', '\t', '\r', '\n'])
const LITERALS: Record<string, boolean | null> = { t: true, f: false, n: null }
const LITERAL_FULL: Record<string, string> = { t: 'true', f: 'false', n: 'null' }

/** Internal: thrown after onError so unwind skips invalid stack frames. */
class ParseAbort extends Error {
  constructor() {
    super('')
    this.name = 'ParseAbort'
  }
}

export class StreamingJSONParser {
  private state: State = 'ROOT'
  private stack: StackFrame[] = []
  private root: PartialObject | PartialArray | null = null
  private buf = ''           // accumulates strings, numbers, literals
  private escBuf = ''        // \uXXXX accumulator (4 hex digits)
  private escCount = 0
  private returnState: State = 'OBJ_POST_VAL'  // where to go after string/literal
  private literalExpected = ''
  private literalPos = 0
  private literalVal: boolean | null = false
  private pos = 0
  private fields: Record<string, FieldInfo> = {}
  private readonly opts: ParserOptions
  private dead = false

  constructor(opts: ParserOptions = {}) {
    this.opts = opts
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  write(chunk: string): void {
    if (this.dead) return
    try {
      for (let i = 0; i < chunk.length; i++) {
        if (this.dead) return
        try {
          this.step(chunk[i])
        } catch (e) {
          if (e instanceof ParseAbort) return
          this.dead = true
          throw e
        }
        this.pos++
      }
      if (!this.dead) this.emit()
    } catch (e) {
      if (e instanceof ParseAbort) return
      this.dead = true
      throw e
    }
  }

  flush(): void {
    if (this.dead) return
    // Finalize any in-progress number (numbers are only certain on termination)
    if (this.state === 'NUM') {
      this.commitNumber(true)
      this.state = 'DONE'
      this.emit()
    }
  }

  getSnapshot(): StreamEvent {
    return {
      partial: this.root ?? {},
      fields: { ...this.fields },
      isComplete: this.state === 'DONE',
    }
  }

  // ─── Core Step ──────────────────────────────────────────────────────────────
  private step(ch: string): void {
    if (this.dead) return
    switch (this.state) {
      case 'ROOT':
        if (WHITESPACE.has(ch)) return
        if (ch === '{') { this.pushObject(); this.state = 'OBJ_OPEN' }
        else if (ch === '[') { this.pushArray(); this.state = 'ARR_OPEN' }
        else this.error(`Expected '{' or '[', got '${ch}'`)
        break

      case 'OBJ_OPEN':
        if (WHITESPACE.has(ch)) return
        if (ch === '}') { this.popObject(true); }
        else if (ch === '"') { this.buf = ''; this.state = 'STR_KEY' }
        else this.error(`Expected '"' or '}', got '${ch}'`)
        break

      case 'OBJ_NEXT_KEY':
        if (WHITESPACE.has(ch)) return
        if (ch === '"') { this.buf = ''; this.state = 'STR_KEY' }
        else this.error(`Expected '"', got '${ch}'`)
        break

      case 'STR_KEY':
        if (ch === '"') {
          const frame = this.topObj()
          frame.key = this.buf
          this.buf = ''
          this.state = 'OBJ_POST_KEY'
        } else if (ch === '\\') {
          this.state = 'STR_KEY_ESCAPE'
        } else {
          this.buf += ch
        }
        break

      case 'STR_KEY_ESCAPE':
        this.buf += this.unescape(ch)
        this.state = 'STR_KEY'
        break

      case 'OBJ_POST_KEY':
        if (WHITESPACE.has(ch)) return
        if (ch === ':') this.state = 'OBJ_COLON'
        else this.error(`Expected ':', got '${ch}'`)
        break

      case 'OBJ_COLON':
        if (WHITESPACE.has(ch)) return
        this.returnState = 'OBJ_POST_VAL'
        this.startValue(ch)
        break

      case 'OBJ_POST_VAL':
        if (WHITESPACE.has(ch)) return
        if (ch === ',') {
          this.certifyCurrentObjKey()
          this.state = 'OBJ_NEXT_KEY'
        } else if (ch === '}') {
          this.certifyCurrentObjKey()
          this.popObject(true)
        } else this.error(`Expected ',' or '}', got '${ch}'`)
        break

      case 'ARR_OPEN':
        if (WHITESPACE.has(ch)) return
        if (ch === ']') { this.popArray(true) }
        else { this.returnState = 'ARR_POST_VAL'; this.startValue(ch) }
        break

      case 'ARR_POST_VAL':
        if (WHITESPACE.has(ch)) return
        if (ch === ',') {
          this.certifyCurrentArrItem()
          this.topArr().index++
          this.returnState = 'ARR_POST_VAL'
          this.state = 'ARR_OPEN'
        } else if (ch === ']') {
          this.certifyCurrentArrItem()
          this.popArray(true)
        } else this.error(`Expected ',' or ']', got '${ch}'`)
        break

      case 'STR_VAL':
        if (ch === '"') {
          this.commitString()
          this.state = this.returnState
        } else if (ch === '\\') {
          this.state = 'STR_ESCAPE'
        } else {
          this.buf += ch
          this.setCurrentValue(this.buf, 'streaming')
        }
        break

      case 'STR_ESCAPE':
        if (ch === 'u') {
          this.escBuf = ''
          this.escCount = 0
          this.state = 'STR_UNICODE'
        } else {
          this.buf += this.unescape(ch)
          this.setCurrentValue(this.buf, 'streaming')
          this.state = 'STR_VAL'
        }
        break

      case 'STR_UNICODE':
        this.escBuf += ch
        this.escCount++
        if (this.escCount === 4) {
          this.buf += String.fromCodePoint(parseInt(this.escBuf, 16))
          this.setCurrentValue(this.buf, 'streaming')
          this.state = 'STR_VAL'
        }
        break

      case 'NUM':
        if ('0123456789.eE+-'.includes(ch)) {
          this.buf += ch
          this.setCurrentValue(parseFloat(this.buf), 'streaming')
        } else {
          // Number ended — commit it, then reprocess this char
          this.commitNumber(true)
          this.state = this.returnState
          this.step(ch) // reprocess the terminator
        }
        break

      case 'LITERAL':
        if (ch === this.literalExpected[this.literalPos]) {
          this.literalPos++
          if (this.literalPos === this.literalExpected.length) {
            this.setCurrentValue(this.literalVal, 'certain')
            this.state = this.returnState
          }
        } else {
          this.error(`Expected '${this.literalExpected[this.literalPos]}', got '${ch}'`)
        }
        break

      case 'DONE':
        if (!WHITESPACE.has(ch)) this.error(`Unexpected character after end: '${ch}'`)
        break
    }
  }

  // ─── Value Dispatch ──────────────────────────────────────────────────────────
  private startValue(ch: string): void {
    this.assertTopLevelSchema(ch)

    if (ch === '"') {
      this.buf = ''
      this.state = 'STR_VAL'
    } else if (ch === '{') {
      this.pushObject()
      this.state = 'OBJ_OPEN'
    } else if (ch === '[') {
      this.pushArray()
      this.state = 'ARR_OPEN'
    } else if ('0123456789-'.includes(ch)) {
      this.buf = ch
      this.setCurrentValue(parseFloat(ch) || 0, 'streaming')
      this.state = 'NUM'
    } else if (ch === 't' || ch === 'f' || ch === 'n') {
      this.literalExpected = LITERAL_FULL[ch]
      this.literalVal = LITERALS[ch] as boolean | null
      this.literalPos = 1
      this.state = 'LITERAL'
      if (this.literalPos === this.literalExpected.length) {
        this.setCurrentValue(this.literalVal, 'certain')
        this.state = this.returnState
      }
    } else {
      this.error(`Unexpected character starting value: '${ch}'`)
    }
  }

  // ─── Stack Operations ────────────────────────────────────────────────────────
  private pushObject(): void {
    const obj: PartialObject = {}
    if (this.stack.length === 0) {
      this.root = obj
    } else {
      this.setCurrentValue(obj, 'streaming')
    }
    this.stack.push({ type: 'object', obj, key: null, certainKeys: new Set() })
  }

  private pushArray(): void {
    const arr: PartialArray = []
    if (this.stack.length === 0) {
      this.root = arr
    } else {
      this.setCurrentValue(arr, 'streaming')
    }
    this.stack.push({ type: 'array', arr, index: 0, certainIndices: new Set() })
  }

  /** After closing a nested value, resume in the parent object or array post-value state. */
  private parentPostCloseState(): State {
    const top = this.stack[this.stack.length - 1]
    if (!top) return 'DONE'
    return top.type === 'object' ? 'OBJ_POST_VAL' : 'ARR_POST_VAL'
  }

  private popObject(certain: boolean): void {
    const frame = this.stack.pop()!
    if (frame.type !== 'object') this.error('Stack mismatch: expected object frame')
    if (this.stack.length === 0) {
      this.state = 'DONE'
    } else {
      this.setCurrentValue(frame.obj, certain ? 'certain' : 'streaming')
      this.state = this.parentPostCloseState()
    }
  }

  private popArray(certain: boolean): void {
    const frame = this.stack.pop()!
    if (frame.type !== 'array') this.error('Stack mismatch: expected array frame')
    if (this.stack.length === 0) {
      this.state = 'DONE'
    } else {
      this.setCurrentValue(frame.arr, certain ? 'certain' : 'streaming')
      this.state = this.parentPostCloseState()
    }
  }

  // ─── Value Assignment ────────────────────────────────────────────────────────
  private setCurrentValue(val: PartialValue, certainty: Certainty): void {
    const top = this.stack[this.stack.length - 1]
    if (!top) return
    const path = this.currentPath()
    if (top.type === 'object') {
      if (top.key === null) return
      top.obj[top.key] = val
      this.fields[path] = { path, certainty, value: val }
    } else {
      top.arr[top.index] = val
      this.fields[path] = { path, certainty, value: val }
    }
  }

  private certifyCurrentObjKey(): void {
    const top = this.topObj()
    if (top.key !== null) {
      top.certainKeys.add(top.key)
      const path = this.currentPath()
      if (this.fields[path]) {
        this.fields[path] = { ...this.fields[path], certainty: 'certain' }
      }
    }
  }

  private certifyCurrentArrItem(): void {
    const top = this.topArr()
    top.certainIndices.add(top.index)
    const path = this.currentPath()
    if (this.fields[path]) {
      this.fields[path] = { ...this.fields[path], certainty: 'certain' }
    }
  }

  private commitString(): void {
    this.setCurrentValue(this.buf, 'certain')
    this.buf = ''
  }

  private commitNumber(certain: boolean): void {
    const n = this.buf.includes('.') || this.buf.includes('e') || this.buf.includes('E')
      ? parseFloat(this.buf)
      : parseInt(this.buf, 10)
    this.setCurrentValue(n, certain ? 'certain' : 'streaming')
    this.buf = ''
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  private currentPath(): string {
    return this.stack.map((f, i) => {
      if (f.type === 'object') return f.key ?? ''
      return String(f.index)
    }).join('.')
  }

  private topObj(): Extract<StackFrame, { type: 'object' }> {
    const top = this.stack[this.stack.length - 1]
    if (!top || top.type !== 'object') this.error('Expected object frame on stack')
    return top as Extract<StackFrame, { type: 'object' }>
  }

  private topArr(): Extract<StackFrame, { type: 'array' }> {
    const top = this.stack[this.stack.length - 1]
    if (!top || top.type !== 'array') this.error('Expected array frame on stack')
    return top as Extract<StackFrame, { type: 'array' }>
  }

  private unescape(ch: string): string {
    const map: Record<string, string> = {
      '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t'
    }
    return map[ch] ?? ch
  }

  private emit(): void {
    if (this.dead) return
    if (!this.root) return
    const event: StreamEvent = {
      partial: this.root,
      fields: { ...this.fields },
      isComplete: this.state === 'DONE',
    }
    this.opts.onUpdate?.(event)
    if (this.state === 'DONE') {
      this.opts.onComplete?.(this.root as JSONObject | JSONArray)
    }
  }

  /** First character of a JSON value → logical kind for optional top-level schema checks. */
  private jsonKindFromStartChar(ch: string): JSONSchemaFieldType | null {
    if (ch === '"') return 'string'
    if (ch === '{') return 'object'
    if (ch === '[') return 'array'
    if ('0123456789-'.includes(ch)) return 'number'
    if (ch === 't' || ch === 'f') return 'boolean'
    if (ch === 'n') return 'null'
    return null
  }

  /**
   * If `opts.schema` is set, validate that the value about to be parsed for a **top-level**
   * object key matches the expected kind (root must be `{ ... }`, stack depth 1).
   */
  private assertTopLevelSchema(ch: string): void {
    const spec = this.opts.schema
    if (!spec || this.dead) return
    if (this.stack.length !== 1) return
    const frame = this.stack[0]!
    if (frame.type !== 'object' || frame.key === null) return

    const field = frame.key
    const expected = spec[field]
    if (expected === undefined) return

    const kind = this.jsonKindFromStartChar(ch)
    if (kind === null || kind !== expected) {
      const got = kind ?? 'unknown'
      const err = new SchemaError(
        `[jsonsettle] Schema mismatch for field "${field}": expected JSON ${expected}, got ${got} (pos ${this.pos})`,
        field,
        expected,
      )
      this.fail(err)
    }
  }

  /** Deliver error via onError + abort, or throw; always stops the parser. */
  private fail(err: Error): never {
    this.dead = true
    if (this.opts.onError) {
      this.opts.onError(err)
      throw new ParseAbort()
    }
    throw err
  }

  private error(msg: string): never {
    const err = new Error(`[jsonsettle] ${msg} (pos ${this.pos})`)
    return this.fail(err)
  }
}
