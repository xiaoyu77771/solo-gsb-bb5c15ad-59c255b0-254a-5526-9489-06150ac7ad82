'use strict';

/**
 * 安全的小型表达式引擎（词法分析 + 递归下降 + 求值器）。
 *
 * 支持：
 *   字面量： 123, 1.5, true, false, "text"（单/双引号）
 *   变量引用：合法标识符，包括中文，如 血量、player_1
 *   一元： ! -
 *   二元算术： + - * / %
 *   比较： > >= < <= == !=
 *   逻辑： && ||
 *   括号
 *
 * 不使用 eval / new Function，任何访问都限制在显式声明的状态变量上。
 */

const TWO_CHAR_OPS = ['>=', '<=', '==', '!=', '&&', '||'];
const ONE_CHAR_OPS = new Set('+-*/%><!()');

const PRECEDENCE = {
  '||': 1,
  '&&': 2,
  '==': 3, '!=': 3,
  '>': 4, '>=': 4, '<': 4, '<=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

function isIdentStart(ch) {
  return /[A-Za-z_一-龥]/.test(ch);
}

function isIdentPart(ch) {
  return /[A-Za-z0-9_一-龥]/.test(ch);
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (isWhitespace(ch)) { i += 1; continue; }

    if (isDigit(ch) || (ch === '.' && isDigit(source[i + 1] || ''))) {
      let j = i + 1;
      let dot = ch === '.';
      while (j < source.length) {
        const c = source[j];
        if (isDigit(c)) { j += 1; continue; }
        if (c === '.' && !dot) { dot = true; j += 1; continue; }
        break;
      }
      const text = source.slice(i, j);
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error(`无法解析的数字 "${text}"`);
      tokens.push({ type: 'number', value, pos: i });
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let value = '';
      while (j < source.length && source[j] !== quote) {
        if (source[j] === '\\') {
          const next = source[j + 1];
          if (next === undefined) throw new Error(`字符串在位置 ${i} 处未闭合`);
          const escapes = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'" };
          value += escapes[next] !== undefined ? escapes[next] : next;
          j += 2;
        } else {
          value += source[j];
          j += 1;
        }
      }
      if (source[j] !== quote) throw new Error(`字符串在位置 ${i} 处未闭合`);
      tokens.push({ type: 'string', value, pos: i });
      i = j + 1;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < source.length && isIdentPart(source[j])) j += 1;
      const word = source.slice(i, j);
      if (word === 'true') tokens.push({ type: 'bool', value: true, pos: i });
      else if (word === 'false') tokens.push({ type: 'bool', value: false, pos: i });
      else tokens.push({ type: 'ident', name: word, pos: i });
      i = j;
      continue;
    }

    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      tokens.push({ type: 'op', value: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(ch)) {
      tokens.push({ type: 'op', value: ch, pos: i });
      i += 1;
      continue;
    }

    throw new Error(`位置 ${i} 出现无法识别的字符 "${ch}"`);
  }
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() { return this.tokens[this.pos] || null; }

  next() { return this.tokens[this.pos++]; }

  expectOp(op) {
    const tok = this.next();
    if (!tok || tok.type !== 'op' || tok.value !== op) {
      const at = tok ? `位置 ${tok.pos}` : '表达式末尾';
      throw new Error(`${at} 应为 "${op}"`);
    }
  }

  parseExpression(minPrec = 0) {
    let left = this.parseUnary();
    for (;;) {
      const tok = this.peek();
      if (!tok || tok.type !== 'op') break;
      const prec = PRECEDENCE[tok.value];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.parseExpression(prec + 1);
      left = { kind: 'binary', op: tok.value, left, right };
    }
    return left;
  }

  parseUnary() {
    const tok = this.peek();
    if (tok && tok.type === 'op' && (tok.value === '!' || tok.value === '-')) {
      this.next();
      return { kind: 'unary', op: tok.value, arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const tok = this.next();
    if (!tok) throw new Error('表达式不完整');

    if (tok.type === 'number' || tok.type === 'string' || tok.type === 'bool') {
      return { kind: 'literal', value: tok.value };
    }
    if (tok.type === 'ident') {
      return { kind: 'var', name: tok.name };
    }
    if (tok.type === 'op' && tok.value === '(') {
      const expr = this.parseExpression();
      this.expectOp(')');
      return expr;
    }
    throw new Error(`位置 ${tok.pos} 出现意外的符号 "${tok.value}"`);
  }
}

function collectVars(node, set) {
  if (!node) return;
  if (node.kind === 'var') set.add(node.name);
  if (node.kind === 'binary') { collectVars(node.left, set); collectVars(node.right, set); }
  if (node.kind === 'unary') collectVars(node.arg, set);
}

function truthy(value) {
  return Boolean(value);
}

function evaluate(node, vars) {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'var':
      if (!Object.prototype.hasOwnProperty.call(vars, node.name)) {
        throw new Error(`引用了未定义的变量 "${node.name}"`);
      }
      return vars[node.name];
    case 'unary': {
      const v = evaluate(node.arg, vars);
      return node.op === '!' ? !truthy(v) : -toNumber(v, node.op);
    }
    case 'binary': {
      // 逻辑短路
      if (node.op === '&&') {
        return truthy(evaluate(node.left, vars)) && truthy(evaluate(node.right, vars));
      }
      if (node.op === '||') {
        return truthy(evaluate(node.left, vars)) || truthy(evaluate(node.right, vars));
      }
      const a = evaluate(node.left, vars);
      const b = evaluate(node.right, vars);
      switch (node.op) {
        case '==': return a === b;
        case '!=': return a !== b;
        case '>': return toComparable(a, node.op) > toComparable(b, node.op);
        case '>=': return toComparable(a, node.op) >= toComparable(b, node.op);
        case '<': return toComparable(a, node.op) < toComparable(b, node.op);
        case '<=': return toComparable(a, node.op) <= toComparable(b, node.op);
        case '+': return toNumber(a, node.op) + toNumber(b, node.op);
        case '-': return toNumber(a, node.op) - toNumber(b, node.op);
        case '*': return toNumber(a, node.op) * toNumber(b, node.op);
        case '/': {
          const d = toNumber(b, node.op);
          if (d === 0) throw new Error('除数为 0');
          return toNumber(a, node.op) / d;
        }
        case '%': {
          const d = toNumber(b, node.op);
          if (d === 0) throw new Error('对 0 取模');
          return toNumber(a, node.op) % d;
        }
        default:
          throw new Error(`不支持的运算符 "${node.op}"`);
      }
    }
    default:
      throw new Error('未知的表达式节点');
  }
}

function toNumber(value, op) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  throw new Error(`运算符 "${op}" 要求数字，实际得到 ${describeValue(value)}`);
}

function toComparable(value, op) {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  throw new Error(`运算符 "${op}" 无法比较 ${describeValue(value)}`);
}

function describeValue(value) {
  if (value === null) return 'null';
  return typeof value === 'string' ? `字符串 "${value}"` : typeof value;
}

/** 编译表达式字符串为 AST，语法错误会抛出带位置信息的 Error。 */
function compile(source) {
  const text = String(source ?? '').trim();
  if (!text) throw new Error('条件表达式为空');
  const tokens = tokenize(text);
  const parser = new Parser(tokens);
  const ast = parser.parseExpression();
  if (parser.peek() !== null) {
    const tok = parser.peek();
    throw new Error(`位置 ${tok.pos} 之后存在无法解析的内容 "${tok.value}"`);
  }
  return ast;
}

module.exports = { compile, evaluate, collectVars };
