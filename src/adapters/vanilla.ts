/**
 * Framework-agnostic helpers for ReadableStream / fetch / async iterables.
 * Zero runtime dependencies beyond the core parser.
 */
/// <reference lib="dom" />
import { StreamingJSONParser } from '../core/parser.js'
import type { ParserOptions } from '../core/types.js'

export type VanillaParserOptions = ParserOptions & { encoding?: string }

function decodeChunk(
  chunk: Uint8Array | string,
  decoder: TextDecoder,
): string {
  if (typeof chunk === 'string') return chunk
  return decoder.decode(chunk, { stream: true })
}

/**
 * Feed a byte or string stream into a parser. Returns a cancel function that
 * aborts the reader (stops further writes).
 */
export function fromReadableStream(
  stream: ReadableStream<Uint8Array | string>,
  opts: VanillaParserOptions,
): () => void {
  const { encoding = 'utf-8', ...parserOpts } = opts
  const parser = new StreamingJSONParser(parserOpts)
  const decoder = new TextDecoder(encoding)
  const reader = stream.getReader()
  let cancelled = false

  ;(async () => {
    try {
      while (!cancelled) {
        const { done, value } = await reader.read()
        if (done) {
          parser.flush()
          break
        }
        if (value !== undefined) {
          parser.write(decodeChunk(value, decoder))
        }
      }
    } catch (e) {
      parserOpts.onError?.(e instanceof Error ? e : new Error(String(e)))
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* already released */
      }
    }
  })()

  return () => {
    cancelled = true
    void reader.cancel()
  }
}

/** Consume string chunks from an async iterable until completion, then flush. */
export async function fromAsyncIterable(
  iterable: AsyncIterable<string>,
  opts: ParserOptions,
): Promise<void> {
  const parser = new StreamingJSONParser(opts)
  try {
    for await (const chunk of iterable) {
      parser.write(chunk)
    }
    parser.flush()
  } catch (e) {
    opts.onError?.(e instanceof Error ? e : new Error(String(e)))
    throw e
  }
}

/**
 * Use the response body as a UTF-8 (or custom encoding) stream of JSON text.
 * Returns cancel() like {@link fromReadableStream}.
 */
export function fromFetchResponse(
  response: Response,
  opts: VanillaParserOptions,
): () => void {
  const body = response.body
  if (!body) {
    const err = new Error('[streamjson] Response has no body')
    opts.onError?.(err)
    throw err
  }
  return fromReadableStream(body, opts)
}
