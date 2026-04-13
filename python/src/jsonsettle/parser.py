from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Set, Union

from .types import (
    Certainty,
    FieldInfo,
    JSONArray,
    JSONObject,
    ParseAbort,
    ParserOptions,
    SchemaError,
    StreamEvent,
)

State = Literal[
    "ROOT",
    "OBJ_OPEN",
    "OBJ_KEY",
    "OBJ_POST_KEY",
    "OBJ_COLON",
    "OBJ_POST_VAL",
    "OBJ_NEXT_KEY",
    "ARR_OPEN",
    "ARR_POST_VAL",
    "STR_VAL",
    "STR_ESCAPE",
    "STR_UNICODE",
    "STR_KEY",
    "STR_KEY_ESCAPE",
    "NUM",
    "LITERAL",
    "DONE",
]

WHITESPACE = frozenset(" \t\r\n")
LITERALS: Dict[str, Union[bool, None]] = {"t": True, "f": False, "n": None}
LITERAL_FULL = {"t": "true", "f": "false", "n": "null"}


@dataclass
class ObjFrame:
    obj: Dict[str, Any]
    key: Optional[str]
    certain_keys: Set[str] = field(default_factory=set)


@dataclass
class ArrFrame:
    arr: List[Any]
    index: int
    certain_indices: Set[int] = field(default_factory=set)


StackFrame = Union[ObjFrame, ArrFrame]


def _is_obj(f: StackFrame) -> bool:
    return isinstance(f, ObjFrame)


def _is_arr(f: StackFrame) -> bool:
    return isinstance(f, ArrFrame)


def _ensure_arr_len(arr: List[Any], idx: int) -> None:
    while len(arr) <= idx:
        arr.append(None)


class StreamingJSONParser:
    def __init__(self, options: Optional[ParserOptions] = None) -> None:
        self._opts = options if options is not None else ParserOptions()
        self._state: State = "ROOT"
        self._stack: List[StackFrame] = []
        self._root: Optional[Union[Dict[str, Any], List[Any]]] = None
        self._buf = ""
        self._esc_buf = ""
        self._esc_count = 0
        self._return_state: State = "OBJ_POST_VAL"
        self._literal_expected = ""
        self._literal_pos = 0
        self._literal_val: Union[bool, None] = False
        self._pos = 0
        self._fields: Dict[str, FieldInfo] = {}
        self._dead = False

    def write(self, chunk: str) -> None:
        if self._dead:
            return
        try:
            for ch in chunk:
                if self._dead:
                    return
                try:
                    self._step(ch)
                except ParseAbort:
                    return
                except Exception:
                    self._dead = True
                    raise
                self._pos += 1
            if not self._dead:
                self._emit()
        except ParseAbort:
            return
        except Exception:
            self._dead = True
            raise

    def flush(self) -> None:
        if self._dead:
            return
        if self._state == "NUM":
            self._commit_number(True)
            self._state = "DONE"
            self._emit()

    def get_snapshot(self) -> StreamEvent:
        return StreamEvent(
            partial=self._root if self._root is not None else {},
            fields=dict(self._fields),
            is_complete=self._state == "DONE",
        )

    def _step(self, ch: str) -> None:
        if self._dead:
            return
        st = self._state

        if st == "ROOT":
            if ch in WHITESPACE:
                return
            if ch == "{":
                self._push_object()
                self._state = "OBJ_OPEN"
            elif ch == "[":
                self._push_array()
                self._state = "ARR_OPEN"
            else:
                self._error(f"Expected '{{' or '[', got '{ch}'")
            return

        if st == "OBJ_OPEN":
            if ch in WHITESPACE:
                return
            if ch == "}":
                self._pop_object(True)
            elif ch == '"':
                self._buf = ""
                self._state = "STR_KEY"
            else:
                self._error(f'Expected \'"\' or \'}}\', got \'{ch}\'')
            return

        if st == "OBJ_NEXT_KEY":
            if ch in WHITESPACE:
                return
            if ch == '"':
                self._buf = ""
                self._state = "STR_KEY"
            else:
                self._error(f'Expected \'"\', got \'{ch}\'')
            return

        if st == "STR_KEY":
            if ch == '"':
                frame = self._top_obj()
                frame.key = self._buf
                self._buf = ""
                self._state = "OBJ_POST_KEY"
            elif ch == "\\":
                self._state = "STR_KEY_ESCAPE"
            else:
                self._buf += ch
            return

        if st == "STR_KEY_ESCAPE":
            self._buf += self._unescape(ch)
            self._state = "STR_KEY"
            return

        if st == "OBJ_POST_KEY":
            if ch in WHITESPACE:
                return
            if ch == ":":
                self._state = "OBJ_COLON"
            else:
                self._error(f"Expected ':', got '{ch}'")
            return

        if st == "OBJ_COLON":
            if ch in WHITESPACE:
                return
            self._return_state = "OBJ_POST_VAL"
            self._start_value(ch)
            return

        if st == "OBJ_POST_VAL":
            if ch in WHITESPACE:
                return
            if ch == ",":
                self._certify_current_obj_key()
                self._state = "OBJ_NEXT_KEY"
            elif ch == "}":
                self._certify_current_obj_key()
                self._pop_object(True)
            else:
                self._error(f"Expected ',' or '}}', got '{ch}'")
            return

        if st == "ARR_OPEN":
            if ch in WHITESPACE:
                return
            if ch == "]":
                self._pop_array(True)
            else:
                self._return_state = "ARR_POST_VAL"
                self._start_value(ch)
            return

        if st == "ARR_POST_VAL":
            if ch in WHITESPACE:
                return
            if ch == ",":
                self._certify_current_arr_item()
                self._top_arr().index += 1
                self._return_state = "ARR_POST_VAL"
                self._state = "ARR_OPEN"
            elif ch == "]":
                self._certify_current_arr_item()
                self._pop_array(True)
            else:
                self._error(f"Expected ',' or ']', got '{ch}'")
            return

        if st == "STR_VAL":
            if ch == '"':
                self._commit_string()
                self._state = self._return_state
            elif ch == "\\":
                self._state = "STR_ESCAPE"
            else:
                self._buf += ch
                self._set_current_value(self._buf, Certainty.STREAMING)
            return

        if st == "STR_ESCAPE":
            if ch == "u":
                self._esc_buf = ""
                self._esc_count = 0
                self._state = "STR_UNICODE"
            else:
                self._buf += self._unescape(ch)
                self._set_current_value(self._buf, Certainty.STREAMING)
                self._state = "STR_VAL"
            return

        if st == "STR_UNICODE":
            self._esc_buf += ch
            self._esc_count += 1
            if self._esc_count == 4:
                self._buf += chr(int(self._esc_buf, 16))
                self._set_current_value(self._buf, Certainty.STREAMING)
                self._state = "STR_VAL"
            return

        if st == "NUM":
            if ch in "0123456789.eE+-":
                self._buf += ch
                self._set_current_value(float(self._buf), Certainty.STREAMING)
            else:
                self._commit_number(True)
                self._state = self._return_state
                self._step(ch)
            return

        if st == "LITERAL":
            if self._literal_pos < len(self._literal_expected) and ch == self._literal_expected[self._literal_pos]:
                self._literal_pos += 1
                if self._literal_pos == len(self._literal_expected):
                    self._set_current_value(self._literal_val, Certainty.CERTAIN)
                    self._state = self._return_state
            else:
                exp = self._literal_expected[self._literal_pos] if self._literal_pos < len(self._literal_expected) else "?"
                self._error(f"Expected '{exp}', got '{ch}'")
            return

        if st == "DONE":
            if ch not in WHITESPACE:
                self._error(f"Unexpected character after end: '{ch}'")
            return

    def _start_value(self, ch: str) -> None:
        self._assert_top_level_schema(ch)

        if ch == '"':
            self._buf = ""
            self._state = "STR_VAL"
        elif ch == "{":
            self._push_object()
            self._state = "OBJ_OPEN"
        elif ch == "[":
            self._push_array()
            self._state = "ARR_OPEN"
        elif ch in "0123456789-":
            self._buf = ch
            self._set_current_value(float(ch) if ch != "-" else 0.0, Certainty.STREAMING)
            self._state = "NUM"
        elif ch in "tfn":
            self._literal_expected = LITERAL_FULL[ch]
            self._literal_val = LITERALS[ch]
            self._literal_pos = 1
            self._state = "LITERAL"
            if self._literal_pos == len(self._literal_expected):
                self._set_current_value(self._literal_val, Certainty.CERTAIN)
                self._state = self._return_state
        else:
            self._error(f"Unexpected character starting value: '{ch}'")

    def _push_object(self) -> None:
        obj: Dict[str, Any] = {}
        if len(self._stack) == 0:
            self._root = obj
        else:
            self._set_current_value(obj, Certainty.STREAMING)
        self._stack.append(ObjFrame(obj=obj, key=None))

    def _push_array(self) -> None:
        arr: List[Any] = []
        if len(self._stack) == 0:
            self._root = arr
        else:
            self._set_current_value(arr, Certainty.STREAMING)
        self._stack.append(ArrFrame(arr=arr, index=0))

    def _parent_post_close_state(self) -> State:
        top = self._stack[-1] if self._stack else None
        if top is None:
            return "DONE"
        return "OBJ_POST_VAL" if _is_obj(top) else "ARR_POST_VAL"

    def _pop_object(self, certain: bool) -> None:
        frame = self._stack.pop()
        if not _is_obj(frame):
            self._error("Stack mismatch: expected object frame")
        assert isinstance(frame, ObjFrame)
        if len(self._stack) == 0:
            self._state = "DONE"
        else:
            self._set_current_value(frame.obj, Certainty.CERTAIN if certain else Certainty.STREAMING)
            self._state = self._parent_post_close_state()

    def _pop_array(self, certain: bool) -> None:
        frame = self._stack.pop()
        if not _is_arr(frame):
            self._error("Stack mismatch: expected array frame")
        assert isinstance(frame, ArrFrame)
        if len(self._stack) == 0:
            self._state = "DONE"
        else:
            self._set_current_value(frame.arr, Certainty.CERTAIN if certain else Certainty.STREAMING)
            self._state = self._parent_post_close_state()

    def _current_path(self) -> str:
        parts: List[str] = []
        for f in self._stack:
            if _is_obj(f):
                parts.append(f.key or "")
            else:
                parts.append(str(f.index))
        return ".".join(parts)

    def _set_current_value(self, val: Any, certainty: Certainty) -> None:
        if not self._stack:
            return
        top = self._stack[-1]
        path = self._current_path()
        if _is_obj(top):
            if top.key is None:
                return
            top.obj[top.key] = val
            self._fields[path] = FieldInfo(path=path, certainty=certainty, value=val)
        else:
            _ensure_arr_len(top.arr, top.index)
            top.arr[top.index] = val
            self._fields[path] = FieldInfo(path=path, certainty=certainty, value=val)

    def _certify_current_obj_key(self) -> None:
        top = self._top_obj()
        if top.key is not None:
            top.certain_keys.add(top.key)
            path = self._current_path()
            if path in self._fields:
                fi = self._fields[path]
                self._fields[path] = FieldInfo(path=fi.path, certainty=Certainty.CERTAIN, value=fi.value)

    def _certify_current_arr_item(self) -> None:
        top = self._top_arr()
        top.certain_indices.add(top.index)
        path = self._current_path()
        if path in self._fields:
            fi = self._fields[path]
            self._fields[path] = FieldInfo(path=fi.path, certainty=Certainty.CERTAIN, value=fi.value)

    def _commit_string(self) -> None:
        self._set_current_value(self._buf, Certainty.CERTAIN)
        self._buf = ""

    def _commit_number(self, certain: bool) -> None:
        raw = self._buf
        if "." in raw or "e" in raw or "E" in raw:
            n: Union[int, float] = float(raw)
        else:
            n = int(raw, 10)
        self._set_current_value(n, Certainty.CERTAIN if certain else Certainty.STREAMING)
        self._buf = ""

    def _top_obj(self) -> ObjFrame:
        top = self._stack[-1] if self._stack else None
        if top is None or not _is_obj(top):
            self._error("Expected object frame on stack")
        assert isinstance(top, ObjFrame)
        return top

    def _top_arr(self) -> ArrFrame:
        top = self._stack[-1] if self._stack else None
        if top is None or not _is_arr(top):
            self._error("Expected array frame on stack")
        assert isinstance(top, ArrFrame)
        return top

    @staticmethod
    def _unescape(ch: str) -> str:
        m = {
            '"': '"',
            "\\": "\\",
            "/": "/",
            "b": "\b",
            "f": "\f",
            "n": "\n",
            "r": "\r",
            "t": "\t",
        }
        return m.get(ch, ch)

    def _emit(self) -> None:
        if self._dead or self._root is None:
            return
        ev = StreamEvent(
            partial=self._root,
            fields=dict(self._fields),
            is_complete=self._state == "DONE",
        )
        if self._opts.on_update:
            self._opts.on_update(ev)
        if self._state == "DONE" and self._opts.on_complete:
            self._opts.on_complete(self._root)  # type: ignore[arg-type]

    def _json_kind_from_start_char(self, ch: str) -> Optional[str]:
        if ch == '"':
            return "string"
        if ch == "{":
            return "object"
        if ch == "[":
            return "array"
        if ch in "0123456789-":
            return "number"
        if ch in "tf":
            return "boolean"
        if ch == "n":
            return "null"
        return None

    def _assert_top_level_schema(self, ch: str) -> None:
        spec = self._opts.schema
        if not spec or self._dead:
            return
        if len(self._stack) != 1:
            return
        frame = self._stack[0]
        if not _is_obj(frame) or frame.key is None:
            return
        field_name = frame.key
        expected = spec.get(field_name)
        if expected is None:
            return
        kind = self._json_kind_from_start_char(ch)
        if kind is None or kind != expected:
            got = kind or "unknown"
            err = SchemaError(
                f'[jsonsettle] Schema mismatch for field "{field_name}": expected JSON {expected}, got {got} (pos {self._pos})',
                field_name,
                expected,
            )
            self._fail(err)

    def _fail(self, err: Exception) -> None:
        self._dead = True
        if self._opts.on_error:
            self._opts.on_error(err)
            raise ParseAbort()
        raise err

    def _error(self, msg: str) -> None:
        err = Exception(f"[jsonsettle] {msg} (pos {self._pos})")
        self._fail(err)
