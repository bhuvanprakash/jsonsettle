/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { StreamingJSONParser } from '../../src/core/parser.js'

type Ev = {
  fields: Record<string, { certainty: string; value: unknown }>
  isComplete: boolean
}

function runTs(json: string): Ev[] {
  const events: Array<{ fields: Record<string, { certainty: string; value: unknown }>; isComplete: boolean }> = []
  const parser = new StreamingJSONParser({
    onUpdate: (e) => {
      const fields: Record<string, { certainty: string; value: unknown }> = {}
      for (const [k, v] of Object.entries(e.fields)) {
        fields[k] = { certainty: v.certainty, value: v.value }
      }
      events.push({ fields, isComplete: e.isComplete })
    },
  })
  for (const ch of json) parser.write(ch)
  parser.flush()
  return events
}

function runPy(json: string): Ev[] {
  const root = process.cwd()
  const py = `${root}/python/.venv/bin/python`
  const script = `${root}/tests/integration/_python_runner.py`
  const out = execFileSync(py, [script, json], { encoding: 'utf8' })
  const parsed = JSON.parse(out) as Array<{ fields: Record<string, { certainty: string; value: unknown }>; is_complete: boolean }>
  return parsed.map((e) => ({ fields: e.fields, isComplete: e.is_complete }))
}

describe('python compatibility integration', () => {
  const cases = [
    '{"name":"Alice","age":30}',
    '{"a":true,"b":false,"c":null}',
    '{"score":-3.14}',
    '{"tags":["x","y"]}',
    '{"u":{"v":42}}',
  ]

  it.each(cases)('matches TS certainty progression for %s', (json) => {
    const tsEvents = runTs(json)
    const pyEvents = runPy(json)

    expect(pyEvents.length).toBe(tsEvents.length)
    for (let i = 0; i < tsEvents.length; i++) {
      const ts = tsEvents[i]!
      const py = pyEvents[i]!
      expect(py.isComplete).toBe(ts.isComplete)
      expect(py.fields).toEqual(ts.fields)
    }

    const firstCertainTs: Record<string, number> = {}
    const firstCertainPy: Record<string, number> = {}
    tsEvents.forEach((e, idx) => {
      for (const [k, v] of Object.entries(e.fields)) {
        if (v.certainty === 'certain' && firstCertainTs[k] === undefined) firstCertainTs[k] = idx
      }
    })
    pyEvents.forEach((e, idx) => {
      for (const [k, v] of Object.entries(e.fields)) {
        if (v.certainty === 'certain' && firstCertainPy[k] === undefined) firstCertainPy[k] = idx
      }
    })
    expect(firstCertainPy).toEqual(firstCertainTs)
  })
})
