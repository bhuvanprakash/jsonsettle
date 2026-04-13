from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Union

JSONPrimitive = Union[str, int, float, bool, None]
JSONValue = Union[JSONPrimitive, "JSONObject", "JSONArray"]
JSONObject = Dict[str, Any]
JSONArray = List[Any]


class Certainty(str, Enum):
    STREAMING = "streaming"
    CERTAIN = "certain"


@dataclass
class FieldInfo:
    path: str
    certainty: Certainty
    value: Any


@dataclass
class StreamEvent:
    partial: Union[Dict[str, Any], List[Any]]
    fields: Dict[str, FieldInfo]
    is_complete: bool


@dataclass
class ParserOptions:
    on_update: Optional[Callable[[StreamEvent], None]] = None
    on_complete: Optional[Callable[[Union[JSONObject, JSONArray]], None]] = None
    on_error: Optional[Callable[[Exception], None]] = None
    schema: Optional[Dict[str, str]] = None  # field name → JSON kind (string, number, ...)


class SchemaError(Exception):
    def __init__(self, message: str, field: str, expected: str) -> None:
        super().__init__(message)
        self.field = field
        self.expected = expected


class ParseAbort(BaseException):
    """Internal control flow after on_error (mirrors TS ParseAbort)."""

    pass
