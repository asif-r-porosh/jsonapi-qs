'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const JsonApiQs = require('../src/jsonapi-qs');

describe('JsonApiQs', () => {

  describe('constructor', () => {
    it('default options', () => {
      const p = new JsonApiQs();
      assert.deepStrictEqual(p._options, {
        basePath: undefined,
        caseInsensitiveParams: false,
        reportUnknownParams: true,
        operators: new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'like', 'contains', 'startswith', 'endswith', 'isnull']),
      });
    });

    it('custom options', () => {
      const p = new JsonApiQs({
        basePath: '/api/v1',
        caseInsensitiveParams: true,
        reportUnknownParams: false,
        operators: ['eq', 'lt'],
      });
      assert.deepStrictEqual(p._options, {
        basePath: '/api/v1',
        caseInsensitiveParams: true,
        reportUnknownParams: false,
        operators: new Set(['eq', 'lt']),
      });
    });

    it('throws when basePath contains a query string', () => {
      assert.throws(
        () => new JsonApiQs({ basePath: '/api?x=1' }),
        { name: 'TypeError', message: 'basePath must not contain a query string' },
      );
    });

    it('throws when basePath is empty string', () => {
      assert.throws(
        () => new JsonApiQs({ basePath: '' }),
        { name: 'TypeError', message: 'basePath must be a non-empty string' },
      );
    });

    it('throws when basePath is not a string', () => {
      assert.throws(
        () => new JsonApiQs({ basePath: 123 }),
        { name: 'TypeError', message: 'basePath must be a non-empty string' },
      );
    });

    it('normalizes operators from an array', () => {
      const p = new JsonApiQs({ operators: ['eq', 'lt', 'gt'] });
      assert.deepStrictEqual(p._options.operators, new Set(['eq', 'lt', 'gt']));
    });

    it('overrides default operators with custom set', () => {
      const p = new JsonApiQs({ operators: ['eq', 'xyzzy'] });
      const result = p.parseRequest('/article?filter[age][lt]=15&filter[age][xyzzy]=ok');
      assert.deepStrictEqual(result.queryData.filter, { age: { xyzzy: 'ok' } });
      // 'lt' is not in custom set → unknown
      assert.deepStrictEqual(result.queryData.unknown, ['filter[age][lt]=15']);
    });

    it('default operators reject unknown operator names', () => {
      const p = new JsonApiQs();
      const result = p.parseRequest('/article?filter[age][xyzzy]=15');
      assert.deepStrictEqual(result.queryData.filter, {});
      assert.deepStrictEqual(result.queryData.unknown, ['filter[age][xyzzy]=15']);
    });

    it('handles empty operators array (no operators recognized)', () => {
      const p = new JsonApiQs({ operators: [] });
      assert.deepStrictEqual(p._options.operators, new Set());
      const result = p.parseRequest('/article?filter[age][lt]=15');
      assert.deepStrictEqual(result.queryData.filter, {});
      assert.deepStrictEqual(result.queryData.unknown, ['filter[age][lt]=15']);
    });

    it('operators: null produces empty set', () => {
      const p = new JsonApiQs({ operators: null });
      assert.deepStrictEqual(p._options.operators, new Set());
    });

    it('_normalizeOperators returns empty Set for non-array', () => {
      assert.deepStrictEqual(JsonApiQs._normalizeOperators(undefined), new Set());
      assert.deepStrictEqual(JsonApiQs._normalizeOperators(null), new Set());
      assert.deepStrictEqual(JsonApiQs._normalizeOperators({ eq: '=' }), new Set());
    });

    it('_normalizeOperators returns Set from array', () => {
      assert.deepStrictEqual(JsonApiQs._normalizeOperators(['a', 'b']), new Set(['a', 'b']));
    });

    it('PARSE_PARAM always includes parseFilterOperator', () => {
      const p = new JsonApiQs();
      assert.strictEqual('parseFilterOperator' in p._PARSE_PARAM, true);
    });

    it('builds case-insensitive regexes when caseInsensitiveParams is true', () => {
      const p = new JsonApiQs({ caseInsensitiveParams: true });
      assert.strictEqual(p._PARSE_PARAM.parseInclude.ignoreCase, true);
    });

    it('builds case-sensitive regexes by default', () => {
      const p = new JsonApiQs();
      assert.strictEqual(p._PARSE_PARAM.parseInclude.ignoreCase, false);
    });
  });

  describe('parseRequest', () => {
    let parser;

    beforeEach(() => { parser = new JsonApiQs(); });

    it('parses a full URL with all query parameters', () => {
      const result = parser.parseRequest(
        '/article/5/relationships/comment?include=user,testComment&sort=Age,firstName&fields[user]=name,email&page[limit]=20&filter[name]=john+doe&filter[age]=15'
      );

      assert.deepStrictEqual(result, {
        resourceType: 'article',
        identifier: '5',
        relationships: true,
        relationshipType: 'comment',
        queryData: {
          include: [['user'], ['testComment']],
          sort: ['Age', 'firstName'],
          fields: { user: ['name', 'email'] },
          page: { limit: '20' },
          filter: { name: 'john doe', age: '15' },
          unknown: [],
        },
      });
    });

    it('parses a URL with only a path, no query string', () => {
      const result = parser.parseRequest('/article/5');
      assert.strictEqual(result.resourceType, 'article');
      assert.strictEqual(result.identifier, '5');
      assert.strictEqual(result.relationships, false);
      assert.strictEqual(result.relationshipType, null);
      assert.deepStrictEqual(result.queryData.include, []);
      assert.deepStrictEqual(result.queryData.fields, {});
      assert.deepStrictEqual(result.queryData.sort, []);
      assert.deepStrictEqual(result.queryData.page, {});
      assert.deepStrictEqual(result.queryData.filter, {});
      assert.deepStrictEqual(result.queryData.unknown, []);
    });

    it('parses a URL with only a query string, no path', () => {
      const result = parser.parseRequest('?include=comments');
      assert.strictEqual(result.resourceType, null);
      assert.strictEqual(result.identifier, null);
      assert.deepStrictEqual(result.queryData.include, [['comments']]);
    });

    it('throws on empty string', () => {
      assert.throws(
        () => parser.parseRequest(''),
        { name: 'TypeError', message: 'url must be a non-empty string' },
      );
    });

    it('throws on null', () => {
      assert.throws(
        () => parser.parseRequest(null),
        { name: 'TypeError', message: 'url must be a non-empty string' },
      );
    });

    it('throws on a number', () => {
      assert.throws(
        () => parser.parseRequest(123),
        { name: 'TypeError', message: 'url must be a non-empty string' },
      );
    });

    it('trims whitespace from URL before validation', () => {
      assert.throws(
        () => parser.parseRequest('   '),
        { name: 'TypeError', message: 'url must be a non-empty string' },
      );
    });

    it('handles mixed flat and operator filters end-to-end', () => {
      const result = parser.parseRequest(
        '/article?filter[name]=john&filter[age][lt]=15&filter[age][gt]=5&filter[status]=active'
      );
      assert.deepStrictEqual(result.queryData.filter, {
        name: 'john',
        age: { lt: '15', gt: '5' },
        status: 'active',
      });
      assert.deepStrictEqual(result.queryData.unknown, []);
    });
  });

  describe('basePath', () => {
    it('strips basePath prefix from the endpoint', () => {
      const parser = new JsonApiQs({ basePath: '/api/v1.3' });
      const result = parser.parseRequest('/api/v1.3/article/5?include=comments');
      assert.strictEqual(result.resourceType, 'article');
      assert.strictEqual(result.identifier, '5');
    });

    it('strips basePath with leading/trailing slashes', () => {
      const parser = new JsonApiQs({ basePath: '//api///v1//' });
      const result = parser.parseRequest('/api/v1/article/5');
      assert.strictEqual(result.resourceType, 'article');
    });

    it('handles exact match of basePath (returns empty segments)', () => {
      const parser = new JsonApiQs({ basePath: '/api/v1' });
      const result = parser.parseRequest('/api/v1?include=comments');
      assert.strictEqual(result.resourceType, null);
      assert.strictEqual(result.identifier, null);
    });

    it('enforces segment boundary — does not match partial segment', () => {
      const parser = new JsonApiQs({ basePath: '/api/v1' });
      const result = parser.parseRequest('/api/v1beta/article/5');
      assert.strictEqual(result.resourceType, 'api');
      assert.strictEqual(result.identifier, 'v1beta');
    });

    it('fallthrough when URL does not match basePath', () => {
      const parser = new JsonApiQs({ basePath: '/api/v2' });
      const result = parser.parseRequest('/other/article/5');
      assert.strictEqual(result.resourceType, 'other');
    });
  });

  describe('parseEndpoint', () => {
    let parser;

    beforeEach(() => { parser = new JsonApiQs(); });

    it('parses a bare resource type', () => {
      const result = {};
      parser._parseEndpoint('article', result);
      assert.strictEqual(result.resourceType, 'article');
      assert.strictEqual(result.identifier, null);
      assert.strictEqual(result.relationships, false);
      assert.strictEqual(result.relationshipType, null);
    });

    it('parses resource type and identifier', () => {
      const result = {};
      parser._parseEndpoint('article/5', result);
      assert.strictEqual(result.resourceType, 'article');
      assert.strictEqual(result.identifier, '5');
      assert.strictEqual(result.relationships, false);
      assert.strictEqual(result.relationshipType, null);
    });

    it('parses relationships with relationshipType', () => {
      const result = {};
      parser._parseEndpoint('article/5/relationships/comment', result);
      assert.strictEqual(result.resourceType, 'article');
      assert.strictEqual(result.identifier, '5');
      assert.strictEqual(result.relationships, true);
      assert.strictEqual(result.relationshipType, 'comment');
    });

    it('parses related resource shorthand (no explicit "relationships")', () => {
      const result = {};
      parser._parseEndpoint('article/5/comment', result);
      assert.strictEqual(result.resourceType, 'article');
      assert.strictEqual(result.identifier, '5');
      assert.strictEqual(result.relationships, false);
      assert.strictEqual(result.relationshipType, 'comment');
    });

    it('throws when relationships is declared but type is missing', () => {
      assert.throws(
        () => parser._parseEndpoint('article/5/relationships/', {}),
        { name: 'TypeError', message: 'Endpoint declares "/relationships" but missing relationship type' },
      );
    });

    it('collapses double slashes', () => {
      const result = {};
      parser._parseEndpoint('//article//5//comment//', result);
      assert.strictEqual(result.resourceType, 'article');
      assert.strictEqual(result.identifier, '5');
      assert.strictEqual(result.relationshipType, 'comment');
    });

    it('handles trailing slash on resource', () => {
      const result = {};
      parser._parseEndpoint('article/', result);
      assert.strictEqual(result.resourceType, 'article');
      assert.strictEqual(result.identifier, null);
      assert.strictEqual(result.relationships, false);
      assert.strictEqual(result.relationshipType, null);
    });

    it('handles empty path', () => {
      const result = {};
      parser._parseEndpoint('', result);
      assert.strictEqual(result.resourceType, null);
      assert.strictEqual(result.identifier, null);
      assert.strictEqual(result.relationships, false);
      assert.strictEqual(result.relationshipType, null);
    });

    it('relationship keyword matching is case-insensitive', () => {
      const result = {};
      parser._parseEndpoint('article/5/RELATIONSHIPS/comment', result);
      assert.strictEqual(result.relationships, true);
      assert.strictEqual(result.relationshipType, 'comment');
    });
  });

  describe('parseQueryParameters', () => {
    let parser;

    beforeEach(() => { parser = new JsonApiQs(); });

    it('parses mixed query parameters', () => {
      const requestData = { queryData: { include: [], fields: {}, sort: [], page: {}, filter: {}, unknown: [] } };
      parser._parseQueryParameters('include=user&sort=age&fields[user]=name&page[limit]=20&filter[name]=test', requestData);

      assert.deepStrictEqual(requestData.queryData.include, [['user']]);
      assert.deepStrictEqual(requestData.queryData.sort, ['age']);
      assert.deepStrictEqual(requestData.queryData.fields, { user: ['name'] });
      assert.deepStrictEqual(requestData.queryData.page, { limit: '20' });
      assert.deepStrictEqual(requestData.queryData.filter, { name: 'test' });
      assert.deepStrictEqual(requestData.queryData.unknown, []);
    });

    it('handles empty query string', () => {
      const requestData = { queryData: { include: [], fields: {}, sort: [], page: {}, filter: {}, unknown: [] } };
      parser._parseQueryParameters('', requestData);
      assert.deepStrictEqual(requestData.queryData.include, []);
      assert.deepStrictEqual(requestData.queryData.unknown, []);
    });

    it('skips empty & fragments', () => {
      const requestData = { queryData: { include: [], fields: {}, sort: [], page: {}, filter: {}, unknown: [] } };
      parser._parseQueryParameters('&&include=user&&&', requestData);
      assert.deepStrictEqual(requestData.queryData.include, [['user']]);
    });

    it('decodes + as space in values', () => {
      const requestData = { queryData: { include: [], fields: {}, sort: [], page: {}, filter: {}, unknown: [] } };
      parser._parseQueryParameters('filter[name]=john+doe', requestData);
      assert.deepStrictEqual(requestData.queryData.filter, { name: 'john doe' });
    });

    it('decodes + as space in parameter names', () => {
      const requestData = { queryData: { include: [], fields: {}, sort: [], page: {}, filter: {}, unknown: [] } };
      parser._parseQueryParameters('filter[full+name]=john', requestData);
      assert.deepStrictEqual(requestData.queryData.filter, { 'full name': 'john' });
    });

    it('preserves literal + when encoded as %2B', () => {
      const requestData = { queryData: { include: [], fields: {}, sort: [], page: {}, filter: {}, unknown: [] } };
      parser._parseQueryParameters('filter[name]=a%2Bb', requestData);
      assert.deepStrictEqual(requestData.queryData.filter, { name: 'a+b' });
    });

    it('handles percent-encoded square brackets', () => {
      const requestData = { queryData: { include: [], fields: {}, sort: [], page: {}, filter: {}, unknown: [] } };
      parser._parseQueryParameters('fields%5Barticle%5D=title', requestData);
      assert.deepStrictEqual(requestData.queryData.fields, { article: ['title'] });
    });

    it('throws on malformed percent-encoding', () => {
      const requestData = { queryData: { include: [], fields: {}, sort: [], page: {}, filter: {}, unknown: [] } };
      assert.throws(
        () => parser._parseQueryParameters('filter[name]=%ZZ', requestData),
        { name: 'URIError' },
      );
    });

    it('collects unknown parameters by default', () => {
      const requestData = { queryData: { include: [], fields: {}, sort: [], page: {}, filter: {}, unknown: [] } };
      parser._parseQueryParameters('customParam=value&another=123', requestData);
      assert.deepStrictEqual(requestData.queryData.unknown, ['customParam=value', 'another=123']);
    });

    it('silently drops unknown parameters when reportUnknownParams is false', () => {
      const p = new JsonApiQs({ reportUnknownParams: false });
      const requestData = { queryData: { include: [], fields: {}, sort: [], page: {}, filter: {}, unknown: [] } };
      p._parseQueryParameters('customParam=value', requestData);
      assert.deepStrictEqual(requestData.queryData.unknown, []);
    });
  });

  describe('parseInclude', () => {
    it('parses a single include path', () => {
      const queryData = { include: [] };
      JsonApiQs.parseInclude(['include=user', 'user'], queryData);
      assert.deepStrictEqual(queryData.include, [['user']]);
    });

    it('parses multiple include paths', () => {
      const queryData = { include: [] };
      JsonApiQs.parseInclude(['include=user,comment', 'user,comment'], queryData);
      assert.deepStrictEqual(queryData.include, [['user'], ['comment']]);
    });

    it('parses dot-separated paths into structured arrays', () => {
      const queryData = { include: [] };
      JsonApiQs.parseInclude(['include=comments.author,ratings', 'comments.author,ratings'], queryData);
      assert.deepStrictEqual(queryData.include, [['comments', 'author'], ['ratings']]);
    });

    it('handles empty include value', () => {
      const queryData = { include: ['should-be-cleared'] };
      JsonApiQs.parseInclude(['include=', ''], queryData);
      assert.deepStrictEqual(queryData.include, []);
    });

    it('last include param wins (duplicate handling)', () => {
      const queryData = { include: [['first']] };
      JsonApiQs.parseInclude(['include=second', 'second'], queryData);
      assert.deepStrictEqual(queryData.include, [['second']]);
    });

    it('filters empty segments between commas', () => {
      const queryData = { include: [] };
      JsonApiQs.parseInclude(['include=a,,b', 'a,,b'], queryData);
      assert.deepStrictEqual(queryData.include, [['a'], ['b']]);
    });
  });

  describe('parseFields', () => {
    it('parses fields for a single resource type', () => {
      const queryData = { fields: {} };
      JsonApiQs.parseFields(['fields[article]=title,body', 'article', 'title,body'], queryData);
      assert.deepStrictEqual(queryData.fields, { article: ['title', 'body'] });
    });

    it('accumulates fields across multiple params for the same resource', () => {
      const queryData = { fields: {} };
      JsonApiQs.parseFields(['fields[article]=title', 'article', 'title'], queryData);
      JsonApiQs.parseFields(['fields[article]=body', 'article', 'body'], queryData);
      assert.deepStrictEqual(queryData.fields, { article: ['title', 'body'] });
    });

    it('parses fields for multiple resource types', () => {
      const queryData = { fields: {} };
      JsonApiQs.parseFields(['fields[article]=title', 'article', 'title'], queryData);
      JsonApiQs.parseFields(['fields[people]=name,email', 'people', 'name,email'], queryData);
      assert.deepStrictEqual(queryData.fields, {
        article: ['title'],
        people: ['name', 'email'],
      });
    });

    it('handles empty fields value', () => {
      const queryData = { fields: {} };
      JsonApiQs.parseFields(['fields[article]=', 'article', ''], queryData);
      assert.deepStrictEqual(queryData.fields, { article: [] });
    });

    it('filters empty segments between commas', () => {
      const queryData = { fields: {} };
      JsonApiQs.parseFields(['fields[article]=a,,b', 'article', 'a,,b'], queryData);
      assert.deepStrictEqual(queryData.fields, { article: ['a', 'b'] });
    });
  });

  describe('parseSort', () => {
    it('parses ascending sort', () => {
      const queryData = { sort: [] };
      JsonApiQs.parseSort(['sort=age', 'age'], queryData);
      assert.deepStrictEqual(queryData.sort, ['age']);
    });

    it('parses descending sort with - prefix', () => {
      const queryData = { sort: [] };
      JsonApiQs.parseSort(['sort=-createdon', '-createdon'], queryData);
      assert.deepStrictEqual(queryData.sort, ['-createdon']);
    });

    it('parses multiple sort fields', () => {
      const queryData = { sort: [] };
      JsonApiQs.parseSort(['sort=-createdon,title', '-createdon,title'], queryData);
      assert.deepStrictEqual(queryData.sort, ['-createdon', 'title']);
    });

    it('handles empty sort value', () => {
      const queryData = { sort: ['existing'] };
      JsonApiQs.parseSort(['sort=', ''], queryData);
      assert.deepStrictEqual(queryData.sort, []);
    });

    it('last sort param wins (duplicate handling)', () => {
      const queryData = { sort: ['first'] };
      JsonApiQs.parseSort(['sort=second', 'second'], queryData);
      assert.deepStrictEqual(queryData.sort, ['second']);
    });

    it('filters empty segments between commas', () => {
      const queryData = { sort: [] };
      JsonApiQs.parseSort(['sort=-a,,b', '-a,,b'], queryData);
      assert.deepStrictEqual(queryData.sort, ['-a', 'b']);
    });
  });

  describe('parsePage', () => {
    it('parses a single page key', () => {
      const queryData = { page: {} };
      JsonApiQs.parsePage(['page[limit]=20', 'limit', '20'], queryData);
      assert.deepStrictEqual(queryData.page, { limit: '20' });
    });

    it('parses multiple page keys', () => {
      const queryData = { page: {} };
      JsonApiQs.parsePage(['page[limit]=20', 'limit', '20'], queryData);
      JsonApiQs.parsePage(['page[offset]=180', 'offset', '180'], queryData);
      assert.deepStrictEqual(queryData.page, { limit: '20', offset: '180' });
    });

    it('keeps values as strings', () => {
      const queryData = { page: {} };
      JsonApiQs.parsePage(['page[limit]=20', 'limit', '20'], queryData);
      assert.strictEqual(typeof queryData.page.limit, 'string');
    });

    it('last wins for duplicate page keys', () => {
      const queryData = { page: {} };
      JsonApiQs.parsePage(['page[limit]=20', 'limit', '20'], queryData);
      JsonApiQs.parsePage(['page[limit]=50', 'limit', '50'], queryData);
      assert.deepStrictEqual(queryData.page, { limit: '50' });
    });
  });

  describe('parseFilter', () => {
    it('parses simple equality filter', () => {
      const queryData = { filter: {} };
      JsonApiQs.parseFilter(['filter[name]=john', 'name', 'john'], queryData);
      assert.deepStrictEqual(queryData.filter, { name: 'john' });
    });

    it('parses filter with empty value', () => {
      const queryData = { filter: {} };
      JsonApiQs.parseFilter(['filter[name]=', 'name', ''], queryData);
      assert.deepStrictEqual(queryData.filter, { name: '' });
    });

    it('keeps dot-separated key as flat string', () => {
      const queryData = { filter: {} };
      JsonApiQs.parseFilter(['filter[author.status]=active', 'author.status', 'active'], queryData);
      assert.deepStrictEqual(queryData.filter, { 'author.status': 'active' });
    });

    it('decodes URL-encoded filter value', () => {
      const queryData = { filter: {} };
      JsonApiQs.parseFilter(['filter[name]=john%20doe', 'name', 'john doe'], queryData);
      assert.deepStrictEqual(queryData.filter, { name: 'john doe' });
    });

    it('last wins for duplicate filter keys', () => {
      const queryData = { filter: {} };
      JsonApiQs.parseFilter(['filter[name]=first', 'name', 'first'], queryData);
      JsonApiQs.parseFilter(['filter[name]=second', 'name', 'second'], queryData);
      assert.deepStrictEqual(queryData.filter, { name: 'second' });
    });

    it('handles bare brackets filter[]=value', () => {
      const queryData = { filter: {} };
      JsonApiQs.parseFilter(['filter[]=all', '', 'all'], queryData);
      assert.deepStrictEqual(queryData.filter, { '': 'all' });
    });
  });

  describe('parseFilterOperator', () => {
    it('parses a single operator on a column', () => {
      const queryData = { filter: {} };
      JsonApiQs.parseFilterOperator(['filter[age][lt]=15', 'age', 'lt', '15'], queryData);
      assert.deepStrictEqual(queryData.filter, { age: { lt: '15' } });
    });

    it('parses multiple operators on the same column', () => {
      const queryData = { filter: {} };
      JsonApiQs.parseFilterOperator(['filter[age][gt]=5', 'age', 'gt', '5'], queryData);
      JsonApiQs.parseFilterOperator(['filter[age][lt]=15', 'age', 'lt', '15'], queryData);
      assert.deepStrictEqual(queryData.filter, { age: { gt: '5', lt: '15' } });
    });

    it('operator overwrites flat equality value when operator comes after', () => {
      const queryData = { filter: { age: '10' } };
      JsonApiQs.parseFilterOperator(['filter[age][lt]=15', 'age', 'lt', '15'], queryData);
      assert.deepStrictEqual(queryData.filter, { age: { lt: '15' } });
    });

    it('flat equality overwrites operator object when flat comes after', () => {
      const queryData = { filter: { age: { lt: '15' } } };
      JsonApiQs.parseFilter(['filter[age]=10', 'age', '10'], queryData);
      assert.deepStrictEqual(queryData.filter, { age: '10' });
    });

    it('passes through all supported operator names', () => {
      const ops = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'like', 'contains', 'startswith', 'endswith', 'isnull'];
      const queryData = { filter: {} };
      for (const op of ops) {
        JsonApiQs.parseFilterOperator([`filter[col][${op}]=v`, 'col', op, 'v'], queryData);
      }
      const expected = {};
      for (const op of ops) {
        expected[op] = 'v';
      }
      assert.deepStrictEqual(queryData.filter, { col: expected });
    });

    it('parses multiple columns with operators', () => {
      const queryData = { filter: {} };
      JsonApiQs.parseFilterOperator(['filter[age][lt]=15', 'age', 'lt', '15'], queryData);
      JsonApiQs.parseFilterOperator(['filter[name][like]=john', 'name', 'like', 'john'], queryData);
      assert.deepStrictEqual(queryData.filter, {
        age: { lt: '15' },
        name: { like: 'john' },
      });
    });

    it('handles empty operator value', () => {
      const queryData = { filter: {} };
      JsonApiQs.parseFilterOperator(['filter[age][lt]=', 'age', 'lt', ''], queryData);
      assert.deepStrictEqual(queryData.filter, { age: { lt: '' } });
    });

    it('duplicate operator on same column — last wins', () => {
      const queryData = { filter: {} };
      JsonApiQs.parseFilterOperator(['filter[age][lt]=10', 'age', 'lt', '10'], queryData);
      JsonApiQs.parseFilterOperator(['filter[age][lt]=20', 'age', 'lt', '20'], queryData);
      assert.deepStrictEqual(queryData.filter, { age: { lt: '20' } });
    });

    it('operator params are parsed by default', () => {
      const parser = new JsonApiQs();
      const result = parser.parseRequest('/article?filter[age][lt]=15');
      assert.deepStrictEqual(result.queryData.filter, { age: { lt: '15' } });
      assert.deepStrictEqual(result.queryData.unknown, []);
    });
  });

  describe('caseInsensitiveParams', () => {
    it('by default, INCLUDE=x is treated as unknown', () => {
      const parser = new JsonApiQs();
      const result = parser.parseRequest('/article?INCLUDE=comments');
      assert.deepStrictEqual(result.queryData.include, []);
      assert.deepStrictEqual(result.queryData.unknown, ['INCLUDE=comments']);
    });

    it('when caseInsensitiveParams is true, INCLUDE=x is parsed', () => {
      const parser = new JsonApiQs({ caseInsensitiveParams: true });
      const result = parser.parseRequest('/article?INCLUDE=comments');
      assert.deepStrictEqual(result.queryData.include, [['comments']]);
    });

    it('when caseInsensitiveParams is true, mixed-case param names match', () => {
      const parser = new JsonApiQs({ caseInsensitiveParams: true });
      const result = parser.parseRequest('/article?Sort=age&Fields[user]=name');
      assert.deepStrictEqual(result.queryData.sort, ['age']);
      assert.deepStrictEqual(result.queryData.fields, { user: ['name'] });
    });
  });

  describe('_trimSlashes', () => {
    it('trims leading slashes', () => {
      assert.strictEqual(JsonApiQs._trimSlashes('/article'), 'article');
      assert.strictEqual(JsonApiQs._trimSlashes('//article'), 'article');
    });

    it('trims trailing slashes', () => {
      assert.strictEqual(JsonApiQs._trimSlashes('article/'), 'article');
      assert.strictEqual(JsonApiQs._trimSlashes('article//'), 'article');
    });

    it('collapses mid-path double slashes', () => {
      assert.strictEqual(JsonApiQs._trimSlashes('article//5//comment'), 'article/5/comment');
    });

    it('handles all slashes combined', () => {
      assert.strictEqual(JsonApiQs._trimSlashes('//article//5//comment//'), 'article/5/comment');
    });

    it('returns empty string for slash-only input', () => {
      assert.strictEqual(JsonApiQs._trimSlashes('/'), '');
      assert.strictEqual(JsonApiQs._trimSlashes('///'), '');
    });

    it('preserves string with no slashes', () => {
      assert.strictEqual(JsonApiQs._trimSlashes('article'), 'article');
    });
  });

  describe('output shape consistency', () => {
    it('always returns the same top-level keys', () => {
      const parser = new JsonApiQs();
      const result = parser.parseRequest('/article');
      const keys = Object.keys(result);
      assert.deepStrictEqual(keys.sort(), ['identifier', 'queryData', 'relationshipType', 'relationships', 'resourceType']);
    });

    it('always returns the same queryData keys', () => {
      const parser = new JsonApiQs();
      const result = parser.parseRequest('/article');
      const keys = Object.keys(result.queryData);
      assert.deepStrictEqual(keys.sort(), ['fields', 'filter', 'include', 'page', 'sort', 'unknown']);
    });

    it('queryData is never null or undefined', () => {
      const parser = new JsonApiQs();
      const result = parser.parseRequest('/article');
      assert.strictEqual(typeof result.queryData, 'object');
      assert.notStrictEqual(result.queryData, null);
    });
  });
});
