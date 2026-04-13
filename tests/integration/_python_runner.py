import json
import sys

sys.path.insert(0, 'python/src')
from jsonsettle import StreamingJSONParser, ParserOptions

json_str = sys.argv[1]
events = []

def on_update(e):
    events.append({
        'fields': {k: {'certainty': v.certainty.value, 'value': v.value}
                   for k, v in e.fields.items()},
        'is_complete': e.is_complete
    })

parser = StreamingJSONParser(ParserOptions(on_update=on_update))
for ch in json_str:
    parser.write(ch)
parser.flush()

print(json.dumps(events))
