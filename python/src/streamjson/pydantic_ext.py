from __future__ import annotations

from typing import Any, Callable, Dict, Optional, Tuple, Type, TypeVar

try:
    from pydantic import BaseModel, ValidationError
except ImportError as e:  # pragma: no cover - import guard
    raise ImportError("pydantic>=2 required for streamjson.pydantic_ext") from e

from .parser import StreamingJSONParser
from .types import Certainty, ParserOptions

BaseModelT = TypeVar("BaseModelT", bound=BaseModel)


def _set_at_path(root: Dict[str, Any], path: str, value: Any) -> None:
    parts = [p for p in path.split(".") if p]
    if not parts:
        return
    cur: Any = root
    for i, key in enumerate(parts):
        is_last = i == len(parts) - 1
        if is_last:
            if isinstance(cur, list):
                idx = int(key)
                while len(cur) <= idx:
                    cur.append(None)
                cur[idx] = value
            else:
                cur[key] = value
            return
        next_key = parts[i + 1]
        child_is_index = next_key.isdigit()
        if isinstance(cur, list):
            idx = int(key)
            while len(cur) <= idx:
                cur.append(None)
            if cur[idx] is None:
                cur[idx] = [] if child_is_index else {}
            cur = cur[idx]
        else:
            if key not in cur or cur[key] is None:
                cur[key] = [] if child_is_index else {}
            cur = cur[key]


def create_typed_parser(
    model: Type[BaseModelT],
    options: Optional[ParserOptions] = None,
) -> Tuple[StreamingJSONParser, Callable[[], Optional[BaseModelT]]]:
    """
    Returns (parser, get_certain) where get_certain() returns a model instance
    populated only with fields that are 'certain' and pass model validation,
    all other fields are omitted (uses model_validate with strict=False).
    Returns None if no certain fields yet.
    """
    opts = options if options is not None else ParserOptions()
    parser = StreamingJSONParser(opts)

    def get_certain() -> Optional[BaseModelT]:
        snap = parser.get_snapshot()
        data: Dict[str, Any] = {}
        for path, fi in snap.fields.items():
            if fi.certainty != Certainty.CERTAIN:
                continue
            _set_at_path(data, path, fi.value)
        if not data:
            return None
        try:
            return model.model_validate(data, strict=False)
        except ValidationError:
            return None

    return parser, get_certain
