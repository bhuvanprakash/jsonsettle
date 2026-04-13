# streamjson (Python)

Schema-aware streaming JSON parser for LLMs: know which fields are **certain** vs still **streaming**, token by token.

This package mirrors the TypeScript `streamjson` library’s core state machine (certainty rules, nested objects/arrays, optional top-level schema checks).

## Install

```bash
pip install streamjson
```

Optional Pydantic v2 helpers:

```bash
pip install streamjson[pydantic]
```

## Usage

```python
from streamjson import StreamingJSONParser, ParserOptions, Certainty

def on_update(ev):
    for path, fi in ev.fields.items():
        if fi.certainty == Certainty.CERTAIN:
            print(path, fi.value)

parser = StreamingJSONParser(ParserOptions(on_update=on_update))
parser.write('{"name":"Ada","age":41}')
parser.flush()
```

## Async

```python
from streamjson import parse_async_iterable

async def consume(stream):
    async for ev in parse_async_iterable(stream):
        ...
```

## License

MIT
