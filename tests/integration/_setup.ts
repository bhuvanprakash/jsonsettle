import type { StreamEvent } from '../../src/core/types.js'
import { StreamingJSONParser } from '../../src/core/parser.js'

// reads API keys from env — never hardcode
export const OPENAI_KEY = process.env.OPENAI_API_KEY
export const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

export const SKIP_OPENAI = !OPENAI_KEY
export const SKIP_ANTHROPIC = !ANTHROPIC_KEY

// Helper: collect all StreamEvents from a parser run
export async function collectEvents(
  chunks: string[],
  delayMs = 0,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  const parser = new StreamingJSONParser({ onUpdate: (e) => events.push(e) })
  for (const chunk of chunks) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    parser.write(chunk)
  }
  parser.flush()
  return events
}

// Helper: split a JSON string into realistic LLM-style chunks (1–4 chars)
export function tokenize(json: string): string[] {
  const chunks: string[] = []
  let i = 0
  while (i < json.length) {
    const size = Math.floor(Math.random() * 4) + 1
    chunks.push(json.slice(i, i + size))
    i += size
  }
  return chunks
}
