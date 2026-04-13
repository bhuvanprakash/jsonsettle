/**
 * Vue 3 composable for jsonsettle.
 * Peer dependency: vue >= 3
 */
/// <reference types="vue" />
/// <reference lib="dom" />
import { onUnmounted, ref, shallowReadonly, watch } from 'vue'
import type { Ref } from 'vue'
import { StreamingJSONParser } from '../core/parser.js'
import type { PartialObject, StreamEvent, ParserOptions } from '../core/types.js'

export interface UseStreamingJSONVueReturn<T extends PartialObject = PartialObject> {
  partial: Readonly<Ref<Partial<T>>>
  fields: Readonly<Ref<StreamEvent['fields']>>
  isComplete: Readonly<Ref<boolean>>
  reset: () => void
}

export function useStreamingJSON<T extends PartialObject = PartialObject>(
  stream: Ref<ReadableStream<string> | AsyncIterable<string> | null>,
  opts?: Omit<ParserOptions, 'onUpdate' | 'onComplete'>,
): UseStreamingJSONVueReturn<T> {
  const partial = ref({}) as Ref<Partial<T>>
  const fields = ref<StreamEvent['fields']>({})
  const isComplete = ref(false)

  function reset() {
    partial.value = {} as Partial<T>
    fields.value = {}
    isComplete.value = false
  }

  let generation = 0

  watch(
    () => stream.value,
    async (s) => {
      generation += 1
      const myGen = generation

      if (s == null) {
        reset()
        return
      }

      const latest = opts ?? {}
      const { onError, ...parserOpts } = latest
      const parser = new StreamingJSONParser({
        ...parserOpts,
        onError,
        onUpdate: (ev) => {
          if (myGen !== generation) return
          partial.value = ev.partial as Partial<T>
          fields.value = { ...ev.fields }
          isComplete.value = ev.isComplete
        },
      })

      try {
        if (s instanceof ReadableStream) {
          const reader = s.getReader()
          try {
            while (myGen === generation) {
              const { done, value } = await reader.read()
              if (done) {
                parser.flush()
                break
              }
              parser.write(value)
            }
          } finally {
            reader.releaseLock()
          }
        } else {
          for await (const chunk of s) {
            if (myGen !== generation) break
            parser.write(chunk)
          }
          if (myGen === generation) parser.flush()
        }
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)))
      }
    },
    { immediate: true, flush: 'post' },
  )

  onUnmounted(() => {
    generation += 1
  })

  return {
    partial: shallowReadonly(partial),
    fields: shallowReadonly(fields),
    isComplete: shallowReadonly(isComplete),
    reset,
  } as UseStreamingJSONVueReturn<T>
}
