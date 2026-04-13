from __future__ import annotations

__version__ = "0.1.2"

from typing import Any, AsyncGenerator, AsyncIterable, Optional

from .parser import StreamingJSONParser
from .types import (
    Certainty,
    FieldInfo,
    ParserOptions,
    SchemaError,
    StreamEvent,
)

__all__ = [
    "StreamingJSONParser",
    "ParserOptions",
    "StreamEvent",
    "FieldInfo",
    "Certainty",
    "SchemaError",
    "parse_async_iterable",
    "parse_openai_stream",
]


async def parse_async_iterable(
    iterable: AsyncIterable[str],
    options: Optional[ParserOptions] = None,
) -> AsyncGenerator[StreamEvent, None]:
    """Yields a StreamEvent after every chunk."""
    opts = options if options is not None else ParserOptions()
    parser = StreamingJSONParser(opts)
    async for chunk in iterable:
        parser.write(chunk)
        yield parser.get_snapshot()
    parser.flush()
    yield parser.get_snapshot()


async def parse_openai_stream(
    stream: Any,
    options: Optional[ParserOptions] = None,
) -> AsyncGenerator[StreamEvent, None]:
    """
    Convenience wrapper for OpenAI streaming chat completions.
    Accepts the raw async stream object from openai>=1.0.
    Yields StreamEvent after each token.
    """

    async def _iter() -> AsyncGenerator[str, None]:
        async for chunk in stream:
            choices = getattr(chunk, "choices", None)
            if not choices:
                continue
            delta = getattr(choices[0], "delta", None)
            content = getattr(delta, "content", None) if delta is not None else None
            if content:
                yield content

    async for event in parse_async_iterable(_iter(), options):
        yield event
