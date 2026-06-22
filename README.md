# jsonapi-qs

A strict [JSON:API 1.1](https://jsonapi.org/) compliant URL query string and endpoint parser for Node.js 18+. Takes a request URL and returns a structured JavaScript object — no surprises, no opinions, just the spec.

```js
const JsonApiQs = require('jsonapi-qs');
const parser = new JsonApiQs();

parser.parseRequest('/articles/5?include=author&fields[article]=title,body&sort=-createdon');
// → { resourceType: 'articles', identifier: '5', … }
```

## Install

```sh
npm install jsonapi-qs
```

## Quick Start

Drop it into any consumer. `parseRequest(url)` does the rest. For example, in  a Node HTTP server

```js
const http = require('node:http');
const JsonApiQs = require('jsonapi-qs');

const parser = new JsonApiQs();

http.createServer((req, res) => {
  const parsed = parser.parseRequest(req.url);
  // parsed.resourceType → 'articles'
  // parsed.identifier    → '5'
  // parsed.queryData     → { include: …, fields: …, sort: …, page: …, filter: … }
}).listen(3000);
```

## Output Shape

`parseRequest(url)` always returns the same structure. No optional keys.

```js
{
  resourceType:    string | null,   // e.g. 'articles'
  identifier:      string | null,   // e.g. '5'
  relationships:   boolean,         // true when endpoint contains '/relationships/'
  relationshipType: string | null,  // e.g. 'comments'
  queryData: {
    include: string[][],            // e.g. [['author'], ['comments', 'user']]
    fields:  Record<string, string[]>, // e.g. { article: ['title','body'] }
    sort:    string[],              // e.g. ['-createdon', 'title']
    page:    Record<string, string>,// e.g. { limit: '20', offset: '0' }
    filter:  Record<string, string | Record<string, string>>,
    unknown: string[],               // unrecognized query params (empty when all matched)
  }
}
```

---

## Features

### Endpoint Parsing

The path before the `?` is split into segments and mapped positionally.

| URL | `resourceType` | `identifier` | `relationships` | `relationshipType` |
|---|---|---|---|---|
| `/articles` | `'articles'` | `null` | `false` | `null` |
| `/articles/5` | `'articles'` | `'5'` | `false` | `null` |
| `/articles/5/comments` | `'articles'` | `'5'` | `false` | `'comments'` |
| `/articles/5/relationships/comments` | `'articles'` | `'5'` | `true` | `'comments'` |

The `/relationships/` keyword is matched **case-insensitively**. The shorthand form (`/articles/5/comments`) sets `relationships: false` but still populates `relationshipType` — consumer decides how to handle it.

Slashes are normalized. `//articles//5//comments//` is the same as `/articles/5/comments`.

---

### `include` — Inclusion of Related Resources

Spec: [jsonapi.org/format/#fetching-includes](https://jsonapi.org/format/#fetching-includes)

Dot-separated paths are parsed into structured arrays.

| Input | Output |
|---|---|
| `include=author` | `[['author']]` |
| `include=author,ratings` | `[['author'], ['ratings']]` |
| `include=comments.author,ratings` | `[['comments','author'], ['ratings']]` |
| `include=` | `[]` |

```js
const r = parser.parseRequest('/articles?include=comments.author');
r.queryData.include;  // → [['comments', 'author']]
```

---

### `fields` — Sparse Fieldsets

Spec: [jsonapi.org/format/#fetching-sparse-fieldsets](https://jsonapi.org/format/#fetching-sparse-fieldsets)

Request only the fields required for each resource type.

| Input | Output |
|---|---|
| `fields[article]=title,body` | `{ article: ['title','body'] }` |
| `fields[article]=` | `{ article: [] }` |
| `fields[article]=title&fields[people]=name` | `{ article: ['title'], people: ['name'] }` |

Multiple `fields[article]` params **accumulate**. Passing `fields[article]=title` and `fields[article]=body` in the same request produces `{ article: ['title','body'] }`.

---

### `sort` — Sorting

Spec: [jsonapi.org/format/#fetching-sorting](https://jsonapi.org/format/#fetching-sorting)

Ascending by default. Prefix with `-` for descending. Comma-separated for multi-field sort.

| Input | Output |
|---|---|
| `sort=age` | `['age']` |
| `sort=-createdon` | `['-createdon']` |
| `sort=-createdon,title` | `['-createdon', 'title']` |
| `sort=` | `[]` |

The `-` is preserved in the output. Consumer interprets it:

```js
const field = sort[0];                        // '-createdon'
const descending = field.startsWith('-');     // true
const column = descending ? field.slice(1) : field;  // 'createdon'
```

---

### `page` — Pagination

Spec: [jsonapi.org/format/#fetching-pagination](https://jsonapi.org/format/#fetching-pagination)

The spec is strategy-agnostic. Any `page[key]=value` is accepted and stored as-is (strings).

| Input | Output |
|---|---|
| `page[limit]=20` | `{ limit: '20' }` |
| `page[offset]=0` | `{ offset: '0' }` |
| `page[limit]=20&page[offset]=0` | `{ limit: '20', offset: '0' }` |
| `page[cursor]=abc123` | `{ cursor: 'abc123' }` |

Values are kept as **strings**.

---

### `filter` — Filtering

Spec: [jsonapi.org/format/#fetching-filtering](https://jsonapi.org/format/#fetching-filtering)

The spec reserves the `filter` family without mandating a strategy. Simple equality is supported out of the box.

| Input | Output |
|---|---|
| `filter[name]=john` | `{ name: 'john' }` |
| `filter[age]=15` | `{ age: '15' }` |
| `filter[author.status]=active` | `{ 'author.status': 'active' }` |
| `filter[name]=` | `{ name: '' }` |

**Dot-separated keys** (e.g. `filter[author.status]=active`) are kept as flat strings. The dot follows the same convention as `include` and `sort` for relationship paths.

**Bare brackets** (`filter[]=value`) are supported by the spec's query parameter family rules. They're stored with an empty-string key: `{ '': 'value' }`.

#### Filter Operators

The JSON:API spec is silent on comparison operators (`<`, `>`, etc.) and string matching (`LIKE`). This parser supports the community-adopted **column-first nested bracket** convention. It's always on — `filter[col][op]=val` is structurally valid JSON:API syntax.

```
filter[age][lt]=15
       ^^^  ^^
     column operator
```

```js
const parser = new JsonApiQs();
parser.parseRequest('/articles?filter[age][lt]=15&filter[name][like]=%john%');
// → filter: { age: { lt: '15' }, name: { like: '%john%' } }
```

**Default operators** — the parser ships with a built-in set. Operators not in this set are treated as unknown (routed to `unknown[]`):

| Operator | Meaning | Example |
|---|---|---|
| `eq` | Equals | `filter[status][eq]=active` |
| `ne` | Not equals | `filter[status][ne]=deleted` |
| `lt` | Less than | `filter[age][lt]=18` |
| `lte` | Less than or equal | `filter[age][lte]=65` |
| `gt` | Greater than | `filter[score][gt]=50` |
| `gte` | Greater than or equal | `filter[score][gte]=90` |
| `in` | In list (comma-separated) | `filter[status][in]=active,pending` |
| `like` | Pattern match | `filter[name][like]=%john%` |
| `contains` | Substring | `filter[title][contains]=json` |
| `startswith` | Starts with | `filter[email][startswith]=admin` |
| `endswith` | Ends with | `filter[email][endswith]=.com` |
| `isnull` | Null check | `filter[deleted_at][isnull]=true` |

**Custom operators** — override the default set via the `operators` option. Accepts an array of operator names:

```js
const parser = new JsonApiQs({ operators: ['eq', 'lt', 'gt', 'regex'] });
parser.parseRequest('/articles?filter[name][regex]=^john');
// → filter: { name: { regex: '^john' } }
```

---

### `basePath` — Version / Namespace Prefix Stripping

When API lives under a prefix like `/api/v1`, the parser would otherwise interpret `v1` as the resource type. Set `basePath` to strip it before parsing:

```js
const parser = new JsonApiQs({ basePath: '/api/v1.3' });

parser.parseRequest('/api/v1.3/articles/5?include=comments');
// → resourceType: 'articles', identifier: '5'
```

**Segment-boundary safety:** `basePath: '/api/v1'` does **not** match `/api/v1beta/articles`. The prefix must end at a `/` segment boundary or the end of the path.

**When the URL doesn't match:** Parsing falls through normally — the full path is used. No error is thrown.

---

### Unknown Parameter Reporting

By default, any query parameter that doesn't match a known JSON:API pattern is collected in `queryData.unknown[]`. This lets your server return `400 Bad Request` as the [spec requires](https://jsonapi.org/format/#query-parameters-custom):

```js
const parsed = parser.parseRequest('/articles?foo=bar&sort=-createdon');
parsed.queryData.unknown;  // → ['foo=bar']
parsed.queryData.sort;     // → ['-createdon']
```

Disable with `{ reportUnknownParams: false }` to silently drop unrecognized params.

---

### Parameter Name Case Sensitivity

By default, parameter names are matched **case-sensitively** — `include` works, `INCLUDE` goes to `unknown`. This follows the spec's member-name case sensitivity rule.

Enable case-insensitive matching for lenient handling:

```js
const parser = new JsonApiQs({ caseInsensitiveParams: true });
parser.parseRequest('/articles?INCLUDE=author&Sort=-createdon');
// Both are parsed correctly.
```

---

## Options Reference

All options have spec-compliant defaults. Set them in the constructor:

```js
new JsonApiQs({
  basePath: undefined,           // string — strip this path prefix before parsing
  caseInsensitiveParams: false,  // bool   — case-insensitive param name matching
  reportUnknownParams: true,     // bool   — collect unrecognized params into unknown[]
  operators: undefined,          // array — override the 12 built-in filter operators (see table above)
})
```

---

## For Developers

### Run Tests

```sh
npm test
npm run test:watch   # re-run on file changes
npm run coverage     # c8 — 100% statement, branch, function, line coverage
```

Uses Node.js's built-in test runner and `c8` for coverage. No build step.

### File Layout

```
src/
  jsonapi-qs.js      — the parser (single file, 200 lines)
test/
  jsonapi-qs.test.js — test suite (95 cases, node:test + node:assert)
```

### How It Works

```
parseRequest(url)
  ├─ validate input
  ├─ split on '?' → [path, queryString]
  ├─ _stripBasePath(path)       — if basePath is set
  ├─ _parseEndpoint(path)       — split on '/', map segments positionally
  └─ _parseQueryParameters(qs)  — split on '&', decode, dispatch
       ├─ _formUrlDecode         — '+' → space, then decodeURIComponent
       └─ for each param:
            ├─ exec against regex map
            ├─ on parseFilterOperator match → check operator against operators set
            ├─ on match → call static parser(matchResult, queryData)
            └─ no match → push to unknown[] (if reportUnknownParams)
```

Static parsers receive the `RegExp.exec()` match result. No redundant string re-parsing.

### Add a New Query Parameter Parser

1. Add a regex to `_buildParseParams` in the constructor builder.
2. Add a `static parseYourParam(match, queryData)` method.
3. Add `queryData.yourParam` to the initial object in `parseRequest`.
4. Add tests.

---

## License

ISC — Asif R. Porosh
