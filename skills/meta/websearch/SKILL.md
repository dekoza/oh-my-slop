---
name: websearch
description: >
  Use when the user wants a live web search run against their local SearXNG instance —
  looking something up online, finding current information, or configuring the SearXNG
  endpoint. Triggers on: "websearch", "search the web", "look this up online", "find
  online", "searx", "/skill:websearch".
---

# Websearch via SearXNG

Search the web using a locally installed SearXNG instance.

## Endpoint Configuration

The SearXNG endpoint persists across session turns. Store it once, reuse until changed.

**Config file:** `~/.pi/agent/websearch-config.json`

**Set endpoint:**
```
/skill:websearch url <endpoint_url>
```

Example:
```
/skill:websearch url http://localhost:8080
```

This writes `{"endpoint": "http://localhost:8080"}` to the config file. All subsequent
searches use this endpoint until the user sets a new one.

**If no endpoint is configured**, tell the user:
> No SearXNG endpoint configured. Set one with: `/skill:websearch url <endpoint_url>`

Do NOT guess or assume a default endpoint. If the config file doesn't exist, ask.

## Performing Searches

When the user wants to search the web:

1. Read the endpoint from `~/.pi/agent/websearch-config.json`
2. Build the search URL: `{endpoint}/search?q={url_encoded_query}&format=json`
3. Fetch results with `curl` (or equivalent)
4. Parse the JSON response and present results

### Search URL Construction

```
GET {endpoint}/search?q={query}&format=json&language={lang}&categories={cats}&time_range={range}&pageno={page}&safesearch={level}
```

Only include optional parameters when the user explicitly requests them. Always URL-encode
the query string.

### Example

```bash
curl -s 'http://localhost:8080/search?q=python+async+patterns&format=json&language=en' | python3 -m json.tool
```

### Optional Parameters

| Parameter | Values | When to use |
|-----------|--------|-------------|
| `language` | ISO 639-1 code (e.g., `en`, `pl`, `de`) | User specifies a language |
| `categories` | Comma-separated (e.g., `general,news`) | User narrows to specific categories |
| `time_range` | `day`, `month`, `year` | User specifies recency |
| `pageno` | Integer (default `1`) | User paginates |
| `safesearch` | `0`, `1`, `2` | User requests safe search |

## Result Format

Present results in this format:

```
## Search Results: "{query}"

1. [{Title}]({url})
   {snippet}

2. [{Title}]({url})
   {snippet}
```

Rules:
- Show title as a link with the URL
- Include the snippet/description below each result
- Number the results
- If results are empty, say "No results found for: {query}"
- If the request fails, show the error clearly

## Error Handling

- **Connection refused / timeout:** "Cannot reach SearXNG at {endpoint}. Is it running? Check with `curl {endpoint}`"
- **HTTP 403:** "Format not enabled on this instance. The SearXNG admin must enable JSON (or CSV/RSS) output in settings.yml under the `search.formats` key. Without it, all /search?format=json requests return 403."
- **HTTP 4xx/5xx:** Show the status code and response body
- **Invalid JSON:** Show raw response for debugging
- **Missing results field:** Show full response structure for debugging

### Enabling formats on the instance

If the instance returns 403, the admin needs to ensure `formats` includes `json` in `settings.yml`:

```yaml
search:
  formats:
    - html
    - json
    - csv
    - rss
```

Then restart SearXNG.

## Response Parsing

SearXNG JSON response structure:
```json
{
  "results": [
    {
      "title": "...",
      "url": "...",
      "content": "snippet text...",
      "engine": "google",
      "score": 1.0
    }
  ],
  "number_of_results": 42,
  "query": "...",
  "engines": [...]
}
```

Extract from each result: `title`, `url`, `content` (snippet), `engine`.
