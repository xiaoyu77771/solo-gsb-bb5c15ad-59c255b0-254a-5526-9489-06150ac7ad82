'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compile, evaluate } = require('../src/expr');

function ev(source, vars = {}) {
  return evaluate(compile(source), vars);
}

test('表达式：算术与取模', () => {
  assert.equal(ev('1 + 2 * 3'), 7);
  assert.equal(ev('(1 + 2) * 3'), 9);
  assert.equal(ev('10 % 3'), 1);
  assert.equal(ev('7 / 2'), 3.5);
  assert.equal(ev('-5 + 2'), -3);
});

test('表达式：比较与逻辑', () => {
  assert.equal(ev('能量 >= 2 && 阶段 == "行动"', { 能量: 3, 阶段: '行动' }), true);
  assert.equal(ev('能量 >= 2 && 阶段 == "行动"', { 能量: 1, 阶段: '行动' }), false);
  assert.equal(ev('!(a || b)', { a: false, b: false }), true);
  assert.equal(ev('a != b', { a: 1, b: 2 }), true);
  assert.equal(ev('a < b <= c', { a: 1, b: 2, c: 2 }), true); // 左结合
});

test('表达式：中文标识符与字符串', () => {
  assert.equal(ev('生命值 - 2 == 0', { 生命值: 2 }), true);
  assert.equal(ev('phase != "出局"', { phase: '抽牌' }), true);
});

test('表达式：逻辑短路避免除零', () => {
  assert.equal(ev('b != 0 && a / b > 1', { a: 10, b: 0 }), false);
});

test('表达式：布尔参与算术', () => {
  assert.equal(ev('true + false'), 1);
});

test('表达式：语法错误抛出并带位置', () => {
  assert.throws(() => compile('1 +'), /表达式不完整/);
  assert.throws(() => compile('a > > 3'), /意外/);
  assert.throws(() => compile('1 2'), /无法解析/);
  assert.throws(() => compile(''), /为空/);
});

test('表达式：未定义变量与除零', () => {
  assert.throws(() => ev('x + 1', {}), /未定义/);
  assert.throws(() => ev('1 / 0'), /除数为 0/);
});
