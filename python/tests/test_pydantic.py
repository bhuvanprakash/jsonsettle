"""Pydantic v2 integration tests."""

from __future__ import annotations

import pytest
from pydantic import BaseModel

from streamjson import ParserOptions, SchemaError, StreamingJSONParser
from streamjson.pydantic_ext import create_typed_parser


class TestCreateTypedParser:
    def test_none_until_certain_then_partial_model(self):
        class M(BaseModel):
            name: str
            age: int

        parser, get_certain = create_typed_parser(M)
        assert get_certain() is None

        parser.write('{"name":"Bo')
        assert get_certain() is None

        parser.write('b","age":7}')
        parser.flush()
        m = get_certain()
        assert m is not None
        assert m.name == "Bob"
        assert m.age == 7

    def test_schema_mismatch_schema_error_attrs(self):
        received = []

        def on_error(e: Exception):
            received.append(e)

        parser = StreamingJSONParser(
            ParserOptions(
                schema={"age": "number"},
                on_error=on_error,
            )
        )
        parser.write('{"age":"')
        assert len(received) == 1
        err = received[0]
        assert isinstance(err, SchemaError)
        assert err.field == "age"
        assert err.expected == "number"

    def test_nested_model(self):
        class Address(BaseModel):
            city: str

        class User(BaseModel):
            name: str
            address: Address

        parser, get_certain = create_typed_parser(User)
        parser.write('{"name":"Nina","address":{"city":"SF"}}')
        parser.flush()
        u = get_certain()
        assert u is not None
        assert u.name == "Nina"
        assert u.address.city == "SF"
