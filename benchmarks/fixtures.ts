type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
type JsonObject = Record<string, JsonValue>

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function buildDeepNested(depth: number): JsonObject {
  let obj: JsonObject = { val: 42 }
  for (let i = depth - 1; i >= 0; i--) obj = { [`level_${i}`]: obj }
  return obj
}

const userName = ['bhuvan', 'prakash'].join('_')
const userMail = ['bhuvan', '@', 'nascentist.ai'].join('')
const longBodyPart = ['The', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog.'].join(' ')

const numbersRng = seededRandom(20260413)
const numbersHeavy = Object.fromEntries(
  Array.from({ length: 30 }, (_, i) => [`score_${i}`, Number(numbersRng().toFixed(6))]),
)

export const FIXTURES = {
  flat_small: JSON.stringify({
    name: 'Alice',
    age: 28,
    city: 'Mumbai',
    verified: true,
    score: 0.95,
  }),
  flat_medium: JSON.stringify(
    Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`field_${i}`, `value_${i}_${'x'.repeat(10)}`]),
    ),
  ),
  flat_large: JSON.stringify(
    Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`key_${i}`, i % 3 === 0 ? i : i % 3 === 1 ? `str_${i}` : true]),
    ),
  ),
  nested_deep: JSON.stringify(buildDeepNested(10)),
  array_objects: JSON.stringify({
    items: Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `item_${i}`,
      active: i % 2 === 0,
      score: Number((Math.sin(i) * 0.5 + 0.5).toFixed(4)),
    })),
  }),
  strings_unicode: JSON.stringify({
    greeting: 'नमस्ते',
    emoji: '🚀🌍✨',
    escaped: 'He said "hello" and she said "world"',
    path: String.raw`C:\Users\bhuvan\data\model.bin`,
    multiline: ['line one', 'line two', 'line three'].join('\n'),
    mixed: 'café naïve résumé',
  }),
  tool_call: JSON.stringify({
    function_name: 'create_user',
    arguments: {
      username: userName,
      email: userMail,
      role: 'admin',
      permissions: ['read', 'write', 'deploy'],
      metadata: { created_at: '2026-04-13', version: 3 },
    },
  }),
  ai_analysis: JSON.stringify({
    intent: 'technical_support',
    confidence: 0.94,
    summary: `User reports GPU inference bottleneck at ${40}ms TTFT with batch size ${8}.`,
    entities: [
      { type: 'metric', value: '40ms', label: 'TTFT' },
      { type: 'config', value: '8', label: 'batch_size' },
    ],
    action_required: true,
    priority: 'high',
    suggested_actions: ['reduce batch size', 'enable KV cache', 'check memory bandwidth'],
  }),
  long_strings: JSON.stringify({
    title: 'A'.repeat(100),
    body: `${longBodyPart} `.repeat(20),
    tags: Array.from({ length: 10 }, (_, i) => `tag_number_${i}_with_long_name`),
  }),
  numbers_heavy: JSON.stringify(numbersHeavy),
} as const

export function tokenize(
  input: string,
  mode: 'char' | 'token' | 'chunk' = 'token',
  seed = 42,
): string[] {
  if (mode === 'char') return input.split('')

  const chunks: string[] = []
  let i = 0
  const rand = seededRandom(seed)
  const sizes = mode === 'token' ? [1, 2, 3, 4] : [8, 10, 12, 14, 16]

  while (i < input.length) {
    const size = sizes[Math.floor(rand() * sizes.length)]!
    chunks.push(input.slice(i, i + size))
    i += size
  }
  return chunks
}
