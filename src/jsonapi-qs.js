'use strict';

const DEFAULT_OPERATORS = Object.freeze(new Set([
  'eq', 'ne', 'lt', 'lte', 'gt', 'gte',
  'in', 'like', 'contains', 'startswith', 'endswith', 'isnull',
]));

class JsonApiQs {
  constructor(options = {}) {
    const {
      basePath,
      caseInsensitiveParams = false,
      reportUnknownParams = true,
      operators,
    } = options;

    if (basePath !== undefined) {
      if (typeof basePath !== 'string' || basePath.trim() === '') {
        throw new TypeError('basePath must be a non-empty string');
      }
      if (basePath.includes('?')) {
        throw new TypeError('basePath must not contain a query string');
      }
    }

    this._options = {
      basePath,
      caseInsensitiveParams,
      reportUnknownParams,
      operators: operators !== undefined
        ? JsonApiQs._normalizeOperators(operators)
        : DEFAULT_OPERATORS,
    };
    this._PARSE_PARAM = JsonApiQs._buildParseParams(caseInsensitiveParams);
  }

  static _normalizeOperators(input) {
    return Array.isArray(input) ? new Set(input) : new Set();
  }

  static _buildParseParams(caseInsensitive) {
    const flags = caseInsensitive ? 'i' : '';

    const params = {
      parseInclude:         new RegExp(`^include=(.*?)$`, flags),
      parseFields:          new RegExp(`^fields\\[([^\\]]*)\\]=(.*?)$`, flags),
      parsePage:            new RegExp(`^page\\[([^\\]]*)\\]=(.*?)$`, flags),
      parseSort:            new RegExp(`^sort=(.*?)$`, flags),
      parseFilter:          new RegExp(`^filter\\[([^\\]]*)\\]=(.*?)$`, flags),
      parseFilterOperator:  new RegExp(`^filter\\[([^\\]]+)\\]\\[([^\\]]+)\\]=(.*?)$`, flags),
    };

    return Object.freeze(params);
  }

  static _formUrlDecode(str) {
    try {
      return decodeURIComponent(str.replace(/\+/g, ' '));
    } catch {
      throw new URIError(`Malformed percent-encoding in query parameter: "${str}"`);
    }
  }

  parseRequest(url) {
    if (typeof url !== 'string' || url.trim() === '') {
      throw new TypeError('url must be a non-empty string');
    }

    const requestData = {
      resourceType: null,
      identifier: null,
      relationships: false,
      relationshipType: null,
      queryData: {
        include: [],
        fields: {},
        sort: [],
        page: {},
        filter: {},
        unknown: [],
      },
    };

    const [path, queryString] = url.split('?');

    const endpointPath = this._stripBasePath(path);
    this._parseEndpoint(endpointPath, requestData);

    if (queryString) {
      this._parseQueryParameters(queryString, requestData);
    }

    return requestData;
  }

  _stripBasePath(path) {
    if (!this._options.basePath) return path;

    const normBase = JsonApiQs._trimSlashes(this._options.basePath);
    const normPath = JsonApiQs._trimSlashes(path);

    if (normPath === normBase) return '';
    if (normPath.startsWith(normBase + '/')) return normPath.slice(normBase.length);

    return path;
  }

  _parseEndpoint(endpointString, requestObject) {
    const trimmed = JsonApiQs._trimSlashes(endpointString);
    const segments = trimmed ? trimmed.split('/') : [];

    requestObject.resourceType = segments[0] || null;
    requestObject.identifier = segments[1] || null;

    const isRelationships = !!(segments[2] && segments[2].toLowerCase() === 'relationships');
    requestObject.relationships = isRelationships;

    if (isRelationships) {
      if (!segments[3]) {
        throw new TypeError('Endpoint declares "/relationships" but missing relationship type');
      }
      requestObject.relationshipType = segments[3];
    } else {
      requestObject.relationshipType = segments[2] || null;
    }

    return requestObject;
  }

  _parseQueryParameters(queryString, requestData) {
    const pieces = queryString.split('&');
    const { operators, reportUnknownParams } = this._options;

    for (const raw of pieces) {
      const decoded = JsonApiQs._formUrlDecode(raw);
      if (decoded === '') continue;

      let matched = false;
      for (const fnName in this._PARSE_PARAM) {
        const match = this._PARSE_PARAM[fnName].exec(decoded);
        if (match) {
          if (fnName === 'parseFilterOperator' && !operators.has(match[2])) {
            break;
          }
          JsonApiQs[fnName](match, requestData.queryData);
          matched = true;
          break;
        }
      }
      if (!matched && reportUnknownParams) {
        requestData.queryData.unknown.push(decoded);
      }
    }
  }

  static parseInclude(match, queryData) {
    const value = match[1];
    queryData.include = value === ''
      ? []
      : value.split(',').filter(s => s !== '').map(path => path.split('.'));
  }

  static parseFields(match, queryData) {
    const [, resource, value] = match;
    queryData.fields[resource] ??= [];
    if (value !== '') {
      queryData.fields[resource].push(...value.split(',').filter(s => s !== ''));
    }
  }

  static parsePage(match, queryData) {
    const [, key, value] = match;
    queryData.page[key] = value;
  }

  static parseSort(match, queryData) {
    const value = match[1];
    queryData.sort = value === '' ? [] : value.split(',').filter(s => s !== '');
  }

  static parseFilter(match, queryData) {
    const [, key, value] = match;
    queryData.filter[key] = value;
  }

  static parseFilterOperator(match, queryData) {
    const [, column, operator, value] = match;
    const current = queryData.filter[column];
    if (current === undefined || typeof current === 'string') {
      queryData.filter[column] = {};
    }
    queryData.filter[column][operator] = value;
  }

  static _trimSlashes(input) {
    return input.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  }
}

module.exports = JsonApiQs;
