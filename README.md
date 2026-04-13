<div align="center">
  <h1>jsonsettle</h1>
  <p><strong>Schema-aware streaming JSON parser for LLMs.</strong><br>
  Know exactly which fields are <code>certain</code> vs still <code>streaming</code> — token by token.</p>
  <img alt="npm" src="https://img.shields.io/npm/v/jsonsettle?color=7c6dfa&style=flat-square">
  <img alt="license" src="https://img.shields.io/github/license/bhuvan/jsonsettle?color=4ade80&style=flat-square">
  <img alt="zero deps" src="https://img.shields.io/badge/dependencies-zero-4ade80?style=flat-square">
  <img src="https://raw.githubusercontent.com/YOUR_USERNAME/jsonsettle/main/assets/demo.gif" alt="jsonsettle demo" width="700">
</div>

---

## The Problem

Every LLM app that uses structured output (tool calls, JSON mode) does this:

```
{"name":"Pri                  ← can't use yet, JSON is broken
{"name":"Priya","age":2       ← still broken
{"name":"Priya","age":28}     ← ONLY NOW can you JSON.parse()
```

So every app **waits**. `name` was done 40 tokens ago. You're blocking the UI for no reason.

## The Solution

```ts
import { StreamingJSONParser } from 'jsonsettle'

const parser = new StreamingJSONParser({
  onUpdate({ partial, fields }) {
    // fires every token
    if (fields['name']?.certainty === 'certain') {
      renderName(partial.name) // ← called 40 tokens before JSON.parse() would work
    }
  }
})

parser.write('{"name":"Priya","age":28}')
```

`certainty: 'certain'` means the value **will not change**. Period.

## What's Different

|  | `partial-json` | `@streamparser/json` | **jsonsettle** |
|--|:--:|:--:|:--:|
| Parses partial JSON | ✅ | ✅ | ✅ |
| Field-level certainty | ❌ | ❌ | ✅ |
| Schema / Zod binding | ❌ | ❌ | ✅ |
| TypeScript inference | ❌ | ❌ | ✅ |
| React hook | ❌ | ❌ | ✅ |
| Zero dependencies | ✅ | ✅ | ✅ |

## Install

```sh
npm install jsonsettle
```

## Usage

### Vanilla JS / Node

```ts
import { StreamingJSONParser } from 'jsonsettle'

const parser = new StreamingJSONParser({
  onUpdate({ partial, fields, isComplete }) {
    for (const [key, info] of Object.entries(fields)) {
      if (info.certainty === 'certain') {
        console.log(`✓ ${key} = ${info.value}`)
      }
    }
  },
  onComplete(value) {
    console.log('Done:', value)
  }
})

// Feed any stream — one char, one chunk, whatever
for (const chunk of llmStream) {
  parser.write(chunk)
}
parser.flush()
```

### React Hook

```ts
import { useStreamingJSON } from 'jsonsettle/react'

function UserCard({ stream }: { stream: ReadableStream<string> }) {
  const { partial, fields, isComplete } = useStreamingJSON<User>(stream)

  return (
    <div>
      <input
        value={partial.name ?? ''}
        disabled={fields['name']?.certainty !== 'certain'}
      />
      {fields['email']?.certainty === 'certain' && (
        <span>✓ {partial.email}</span>
      )}
    </div>
  )
}
```

### Zod Schema Binding

```ts
import { createSchemaParser } from 'jsonsettle/zod'
import { z } from 'zod'

const UserSchema = z.object({
  name:   z.string(),
  age:    z.number().int().positive(),
  email:  z.string().email(),
  active: z.boolean(),
})

const parser = createSchemaParser(UserSchema, {
  schema: UserSchema,
  onCertainField(path, value, leafSchema) {
    // `value` passed `leafSchema.safeParse` (paths like `user.name`, `items.0.id`)
    handleField(path, value, leafSchema)
  },
})

// `createTypedParser(schema, opts)` → `{ parser, getCertain }` where `getCertain()`
// returns `Partial<z.infer<typeof schema>>` with only fields that are already `certain`.
```

## API

### `StreamingJSONParser`

```ts
const parser = new StreamingJSONParser(options)
parser.write(chunk: string)   // feed a chunk (any size, including 1 char)
parser.flush()                // call after stream ends (finalizes trailing numbers)
parser.getSnapshot()          // get current StreamEvent without waiting for onUpdate
```

### `StreamEvent`

```ts
interface StreamEvent {
  partial: PartialObject | PartialArray  // current parsed state
  fields: Record<string, FieldInfo>      // per-field metadata
  isComplete: boolean                    // true when JSON is fully closed
}

interface FieldInfo {
  path: string        // dot-notation: "user.name", "tags.0"
  certainty: 'streaming' | 'certain'
  value: PartialValue
}
```

### Certainty Rules

| Value type | When it becomes `certain` |
|---|---|
| String `"hello"` | After the closing `"` |
| Number `42` | After the next `,` or `}` or `]` |
| Boolean `true/false` | After the full literal is consumed |
| Null `null` | After the full literal is consumed |
| Nested object `{}` | After its closing `}` |
| Array `[]` | After its closing `]` |

## Works With

Any LLM provider that streams JSON:

```ts
// OpenAI
const stream = await openai.chat.completions.create({ stream: true, ... })
for await (const chunk of stream) {
  parser.write(chunk.choices[0]?.delta?.content ?? '')
}

// Anthropic
const stream = await anthropic.messages.create({ stream: true, ... })
stream.on('text', (text) => parser.write(text))

// Vercel AI SDK
const { textStream } = streamText({ ... })
for await (const chunk of textStream) parser.write(chunk)
```

## License

Apache-2.0 © [Bhuvan Prakash](https://github.com/bhuvan)
