/**
 * React adapter for jsonsettle.
 * Peer dependency: react >= 18
 *
 * @example
 * const { partial, fields, isComplete } = useStreamingJSON<User>(stream)
 */
/// <reference lib="dom" />
import { useCallback, useEffect, useRef, useState } from 'react'
import { StreamingJSONParser } from '../core/parser.js'
import type { PartialObject, StreamEvent, ParserOptions } from '../core/types.js'

export interface UseStreamingJSONResult<T extends PartialObject> {
  partial: Partial<T>
  fields: StreamEvent['fields']
  isComplete: boolean
  reset: () => void
}

export function useStreamingJSON<T extends PartialObject = PartialObject>(
  stream: ReadableStream<string> | AsyncIterable<string> | null,
  opts?: Omit<ParserOptions, 'onUpdate' | 'onComplete'>,
): UseStreamingJSONResult<T> {
  const [event, setEvent] = useState<StreamEvent>({
    partial: {},
    fields: {},
    isComplete: false,
  })

  const parserRef = useRef<StreamingJSONParser | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const reset = useCallback(() => {
    setEvent({ partial: {}, fields: {}, isComplete: false })
    parserRef.current = null
  }, [])

  useEffect(() => {
    if (!stream) return
    const latest = optsRef.current ?? {}
    const { onError, ...parserOpts } = latest
    parserRef.current = new StreamingJSONParser({
      ...parserOpts,
      onError,
      onUpdate: setEvent,
    })
    const parser = parserRef.current

    async function consume() {
      if (stream instanceof ReadableStream) {
        const reader = stream.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) { parser.flush(); break }
            parser.write(value)
          }
        } finally {
          reader.releaseLock()
        }
      } else {
        for await (const chunk of stream as AsyncIterable<string>) {
          parser.write(chunk)
        }
        parser.flush()
      }
    }

    consume().catch((e) => onError?.(e instanceof Error ? e : new Error(String(e))))
  }, [stream])

  return {
    partial: event.partial as Partial<T>,
    fields: event.fields,
    isComplete: event.isComplete,
    reset,
  }
}
