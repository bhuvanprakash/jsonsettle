"""Mirror tests/parser.test.ts (core parser behaviour)."""

from __future__ import annotations

import pytest

from jsonsettle import Certainty, ParserOptions, StreamingJSONParser


def parse_input(input_str: str) -> list:
    events = []

    def on_update(ev):
        events.append(ev)

    parser = StreamingJSONParser(ParserOptions(on_update=on_update))
    for ch in input_str:
        parser.write(ch)
    parser.flush()
    return events


class TestBasicValues:
    def test_flat_object_all_at_once(self):
        events = parse_input('{"name":"Alice","age":30}')
        last = events[-1]
        assert last.partial == {"name": "Alice", "age": 30}
        assert last.is_complete is True

    def test_string_certainty_after_closing_quote(self):
        events = []
        parser = StreamingJSONParser(ParserOptions(on_update=lambda e: events.append(e)))
        parser.write('{"name":"Ali')
        mid = parser.get_snapshot()
        assert mid.fields["name"].certainty == Certainty.STREAMING
        assert mid.partial.get("name") == "Ali"

        parser.write('ce"}')
        parser.flush()
        final = parser.get_snapshot()
        assert final.fields["name"].certainty == Certainty.CERTAIN
        assert final.partial.get("name") == "Alice"

    def test_number_certainty_after_terminator(self):
        events = []
        parser = StreamingJSONParser(ParserOptions(on_update=lambda e: events.append(e)))
        parser.write('{"age":2')
        assert parser.get_snapshot().fields["age"].certainty == Certainty.STREAMING
        parser.write("5}")
        parser.flush()
        assert parser.get_snapshot().fields["age"].certainty == Certainty.CERTAIN
        assert parser.get_snapshot().partial.get("age") == 25

    def test_nested_objects(self):
        events = parse_input('{"user":{"name":"Bob","active":true}}')
        last = events[-1]
        assert last.partial["user"]["name"] == "Bob"
        assert last.partial["user"]["active"] is True
        assert last.is_complete is True

    def test_handles_arrays(self):
        events = parse_input('{"tags":["ai","llm","streaming"]}')
        last = events[-1]
        assert last.partial["tags"] == ["ai", "llm", "streaming"]

    def test_unicode_escapes(self):
        events = parse_input(r'{"emoji":"\u2728"}')
        assert events[-1].partial["emoji"] == "✨"

    def test_escaped_quotes_in_strings(self):
        events = parse_input(r'{"msg":"say \"hello\""}')
        assert events[-1].partial["msg"] == 'say "hello"'

    def test_emits_many_events_char_by_char(self):
        json_s = '{"name":"Alice"}'
        events = []
        parser = StreamingJSONParser(ParserOptions(on_update=lambda e: events.append(e)))
        for ch in json_s:
            parser.write(ch)
        parser.flush()
        assert len(events) > 5
        assert events[-1].is_complete is True


class TestEdgeCases:
    def test_empty_object(self):
        events = parse_input("{}")
        assert events[-1].is_complete is True

    def test_empty_array_root(self):
        events = parse_input("[]")
        assert events[-1].is_complete is True

    def test_null_values(self):
        events = parse_input('{"x":null}')
        assert events[-1].partial["x"] is None

    def test_boolean_values(self):
        last = parse_input('{"a":true,"b":false}')[-1]
        assert last.partial["a"] is True
        assert last.partial["b"] is False

    def test_float_numbers(self):
        last = parse_input('{"score":3.14}')[-1]
        assert last.partial["score"] == pytest.approx(3.14)
