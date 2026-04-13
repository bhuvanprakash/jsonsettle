"""Async API tests."""

from __future__ import annotations

from typing import AsyncGenerator

import pytest

from jsonsettle import Certainty, ParserOptions, parse_async_iterable


async def chars(s: str) -> AsyncGenerator[str, None]:
    for ch in s:
        yield ch


class TestParseAsyncIterable:
    @pytest.mark.asyncio
    async def test_char_by_char_final_complete(self):
        json_s = '{"name":"Ada"}'
        events = []
        async for ev in parse_async_iterable(chars(json_s)):
            events.append(ev)
        assert events[-1].is_complete is True
        assert events[-1].partial["name"] == "Ada"

    @pytest.mark.asyncio
    async def test_certainty_progression(self):
        seen_streaming_name = False
        seen_certain_name = False

        def check(ev):
            nonlocal seen_streaming_name, seen_certain_name
            fi = ev.fields.get("name")
            if fi is None:
                return
            if fi.certainty == Certainty.STREAMING and fi.value:
                seen_streaming_name = True
            if fi.certainty == Certainty.CERTAIN:
                seen_certain_name = True

        opts = ParserOptions(
            on_update=check,
        )
        async for _ in parse_async_iterable(chars('{"name":"X"}'), opts):
            pass
        assert seen_streaming_name
        assert seen_certain_name
