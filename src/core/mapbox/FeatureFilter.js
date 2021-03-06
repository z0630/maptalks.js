/*eslint-disable no-var*/
/*!
    Feature Filter by

    (c) mapbox 2016
    www.mapbox.com
    License: MIT, header required.
*/
var types = ['Unknown', 'Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection'];

/**
 * Given a filter expressed as nested arrays, return a new function
 * that evaluates whether a given feature (with a .properties or .tags property)
 * passes its test.
 *
 * @param {Array} filter mapbox gl filter
 * @returns {Function} filter-evaluating function
 * @memberOf MapboxUtil
 */
export function createFilter(filter) {
    return new Function('f', 'var p = (f && f.properties || {}); return ' + compile(filter));
}

function compile(filter) {
    if (!filter) return 'true';
    var op = filter[0];
    if (filter.length <= 1) return op === 'any' ? 'false' : 'true';
    var str =
        op === '==' ? compileComparisonOp(filter[1], filter[2], '===', false) :
        op === '!=' ? compileComparisonOp(filter[1], filter[2], '!==', false) :
        op === '<' ||
        op === '>' ||
        op === '<=' ||
        op === '>=' ? compileComparisonOp(filter[1], filter[2], op, true) :
        op === 'any' ? compileLogicalOp(filter.slice(1), '||') :
        op === 'all' ? compileLogicalOp(filter.slice(1), '&&') :
        op === 'none' ? compileNegation(compileLogicalOp(filter.slice(1), '||')) :
        op === 'in' ? compileInOp(filter[1], filter.slice(2)) :
        op === '!in' ? compileNegation(compileInOp(filter[1], filter.slice(2))) :
        op === 'has' ? compileHasOp(filter[1]) :
        op === '!has' ? compileNegation(compileHasOp([filter[1]])) :
        'true';
    return '(' + str + ')';
}

function compilePropertyReference(property) {
    return property[0] === '$' ? 'f.' + property.substring(1) : 'p[' + JSON.stringify(property) + ']';
}

function compileComparisonOp(property, value, op, checkType) {
    var left = compilePropertyReference(property);
    var right = property === '$type' ? types.indexOf(value) : JSON.stringify(value);
    return (checkType ? 'typeof ' + left + '=== typeof ' + right + '&&' : '') + left + op + right;
}

function compileLogicalOp(expressions, op) {
    return expressions.map(compile).join(op);
}

function compileInOp(property, values) {
    if (property === '$type') values = values.map(function (value) { return types.indexOf(value); });
    var left = JSON.stringify(values.sort(compare));
    var right = compilePropertyReference(property);

    if (values.length <= 200) return left + '.indexOf(' + right + ') !== -1';
    return 'function(v, a, i, j) {' +
        'while (i <= j) { var m = (i + j) >> 1;' +
        '    if (a[m] === v) return true; if (a[m] > v) j = m - 1; else i = m + 1;' +
        '}' +
    'return false; }(' + right + ', ' + left + ',0,' + (values.length - 1) + ')';
}

function compileHasOp(property) {
    return JSON.stringify(property) + ' in p';
}

function compileNegation(expression) {
    return '!(' + expression + ')';
}

// Comparison function to sort numbers and strings
function compare(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Get feature object from a geometry for filter functions.
 * @param  {Geometry} geometry geometry
 * @return {Object}          feature for filter functions
 * @memberOf MapboxUtil
 */
export function getFilterFeature(geometry) {
    const json = geometry._toJSON(),
        g = json['feature'];
    g['type'] = types.indexOf(g['geometry']['type']);
    g['subType'] = json['subType'];
    return g;
}

/**
 * Compile layer's style, styles to symbolize layer's geometries, e.g.<br>
 * <pre>
 * [
 *   {
 *     'filter' : ['==', 'foo', 'val'],
 *     'symbol' : {'markerFile':'foo.png'}
 *   }
 * ]
 * </pre>
 * @param  {Object|Object[]} styles - style to compile
 * @return {Object[]}       compiled styles
 * @memberOf MapboxUtil
 */
export function compileStyle(styles) {
    if (!Array.isArray(styles)) {
        return compileStyle([styles]);
    }
    const compiled = [];
    for (let i = 0; i < styles.length; i++) {
        if (styles[i]['filter'] === true) {
            compiled.push({
                filter: function () {
                    return true;
                },
                symbol: styles[i].symbol
            });
        } else {
            compiled.push({
                filter: createFilter(styles[i]['filter']),
                symbol: styles[i].symbol
            });
        }
    }
    return compiled;
}
/*eslint-enable no-var*/
