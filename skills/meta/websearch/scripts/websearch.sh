#!/usr/bin/env bash
# websearch.sh — perform a search against a local SearXNG instance
# Usage: websearch.sh <query> [language] [time_range] [pageno]
#
# Reads endpoint from ~/.pi/agent/websearch-config.json

set -euo pipefail

CONFIG="$HOME/.pi/agent/websearch-config.json"

if [[ ! -f "$CONFIG" ]]; then
  echo "ERROR: No SearXNG endpoint configured."
  echo "Set one with: /skill:websearch url <endpoint_url>"
  exit 1
fi

ENDPOINT=$(python3 -c "import json; print(json.load(open('$CONFIG'))['endpoint'])")

if [[ $# -lt 1 ]]; then
  echo "Usage: websearch.sh <query> [language] [time_range] [pageno]"
  exit 1
fi

QUERY="$1"
LANG="${2:-}"
TIME_RANGE="${3:-}"
PAGENO="${4:-1}"

# Build URL
URL="${ENDPOINT}/search?q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")&format=json"

if [[ -n "$LANG" ]]; then
  URL="${URL}&language=${LANG}"
fi

if [[ -n "$TIME_RANGE" ]]; then
  URL="${URL}&time_range=${TIME_RANGE}"
fi

if [[ "$PAGENO" != "1" ]]; then
  URL="${URL}&pageno=${PAGENO}"
fi

RESPONSE=$(curl -sfS --max-time 15 "$URL")

# Parse and format results
python3 -c "
import json, sys

data = json.loads('''$RESPONSE''')

if 'results' not in data:
    print('ERROR: Unexpected response structure')
    print(json.dumps(data, indent=2))
    sys.exit(1)

results = data['results']
query = data.get('query', '$QUERY')
total = data.get('number_of_results', len(results))

print(f'## Search Results: \"{query}\" ({total} total)')
print()

if not results:
    print(f'No results found for: {query}')
    sys.exit(0)

for i, r in enumerate(results, 1):
    title = r.get('title', 'No title')
    url = r.get('url', '')
    content = r.get('content', '')
    engine = r.get('engine', '')

    print(f'{i}. [{title}]({url})')
    if content:
        print(f'   {content}')
    if engine:
        print(f'   _via {engine}_')
    print()
"
