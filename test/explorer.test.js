'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { explore } = require('../src/explorer');

const counter = (max = 3, initial = 0) => ({
  variables: [
    { name: 'x', kind: 'range', min: 0, max, initial },
  ],
  rules: [
    { name: '递增', condition: 'x < ' + max, actions: [{ target: 'x', expr: 'x + 1' }] },
  ],
});

test('BFS：尽头状态被报告为死锁，路径最短', () => {
  const r = explore(counter(3, 0), { maxSteps: 10, stateLimit: 100 });
  assert.equal(r.complete, true);
  assert.equal(r.safe, false);
  assert.equal(r.counts.deadlock, 1);
  assert.equal(r.counts.statesVisited, 4);
  const d = r.findings.find((f) => f.type === 'deadlock');
  assert.deepEqual(d.state, { x: 3 });
  assert.deepEqual(d.path.rulePath, ['递增', '递增', '递增']);
  assert.equal(d.path.length, 3);
});

test('BFS：状态去重（双向转移不重复访问）', () => {
  const input = {
    variables: [{ name: 'x', kind: 'range', min: 0, max: 2, initial: 0 }],
    rules: [
      { name: '加一', condition: 'x < 2', actions: [{ target: 'x', expr: 'x + 1' }] },
      { name: '减一', condition: 'x > 0', actions: [{ target: 'x', expr: 'x - 1' }] },
    ],
  };
  const r = explore(input, { maxSteps: 50, stateLimit: 1000 });
  assert.equal(r.counts.statesVisited, 3);
  assert.equal(r.complete, true);
  // 状态 1 上加一、减一都在默认非互斥模式下可执行，但不冲突
  assert.equal(r.counts.conflict, 0);
});

test('BFS：同互斥组两条规则同时可执行 => 冲突', () => {
  const input = {
    variables: [{ name: 'x', kind: 'range', min: 0, max: 5, initial: 1 }],
    rules: [
      { name: 'A', condition: 'x > 0', group: '行动', actions: [{ target: 'x', expr: 'x + 1' }] },
      { name: 'B', condition: 'x < 5', group: '行动', actions: [{ target: 'x', expr: 'x + 2' }] },
      { name: 'C', condition: 'x == 5', group: '行动', actions: [{ target: 'x', expr: 'x' }] },
    ],
  };
  const r = explore(input, { maxSteps: 5, stateLimit: 100 });
  assert.equal(r.counts.conflict >= 1, true);
  const c0 = r.findings.find((f) => f.type === 'conflict' && f.depth === 0);
  assert.ok(c0);
  assert.deepEqual(c0.conflictingRules.sort(), ['A', 'B']);
});

test('BFS：未分组规则默认不冲突', () => {
  const r = explore({
    variables: [{ name: 'x', kind: 'range', min: 0, max: 1, initial: 0 }],
    rules: [
      { name: 'R1', condition: 'x == 0', actions: [{ target: 'x', expr: 'x + 1' }] },
    ],
  }, { maxSteps: 3, stateLimit: 10 });
  assert.equal(r.counts.conflict, 0);
});

test('BFS：defaultMutex 打开后未分组规则也互斥', () => {
  const r = explore({
    variables: [{ name: 'x', kind: 'range', min: 0, max: 2, initial: 1 }],
    rules: [
      { name: 'R1', condition: 'x > 0', actions: [{ target: 'x', expr: 'x - 1' }] },
      { name: 'R2', condition: 'x < 2', actions: [{ target: 'x', expr: 'x + 1' }] },
    ],
  }, { maxSteps: 3, stateLimit: 10, defaultMutex: true });
  assert.equal(r.counts.conflict, 1);
});

test('BFS：越界赋值被报告', () => {
  const r = explore(counter(3, 0), { maxSteps: 10, stateLimit: 100 });
  // 递增规则条件 x<3，不会越界；构造一条会越界的规则
  const input = {
    variables: [{ name: 'x', kind: 'range', min: 0, max: 2, initial: 2 }],
    rules: [{ name: '溢出', condition: 'x == 2', actions: [{ target: 'x', expr: 'x + 1' }] }],
  };
  const r2 = explore(input, { maxSteps: 3, stateLimit: 10 });
  assert.equal(r2.counts.invalidAssignment, 1);
  assert.deepEqual(r2.findings[0].violations[0].target, 'x');
  assert.equal(r2.counts.statesVisited, 1); // 越界状态不入队
});

test('BFS：初始状态即死锁，路径长度为 0', () => {
  const input = {
    variables: [{ name: 'x', kind: 'range', min: 0, max: 2, initial: 2 }],
    rules: [{ name: 'R', condition: 'x < 2', actions: [{ target: 'x', expr: 'x + 1' }] }],
  };
  const r = explore(input, { maxSteps: 5, stateLimit: 10 });
  const d = r.findings.find((f) => f.type === 'deadlock');
  assert.equal(d.depth, 0);
  assert.equal(d.path.length, 0);
});

test('BFS：达到状态上限 => complete=false 且 safe=null（绝不误报安全）', () => {
  // 线性链 0..99，上限只允许 10 个状态
  const r = explore(counter(99, 0), { maxSteps: 200, stateLimit: 10 });
  assert.equal(r.truncatedStateLimit, true);
  assert.equal(r.complete, false);
  assert.equal(r.safe, null);
  assert.equal(r.status, 'truncatedStateLimit');
});

test('BFS：达到步数边界 => complete=false 且 safe=null', () => {
  const r = explore(counter(100, 0), { maxSteps: 3, stateLimit: 100000 });
  assert.equal(r.truncatedDepth, true);
  assert.equal(r.complete, false);
  assert.equal(r.safe, null);
});

test('BFS：完备且无问题 => safe=true', () => {
  // 2 状态循环：x 0/1 之间来回，永不死锁
  const input = {
    variables: [{ name: 'x', kind: 'range', min: 0, max: 1, initial: 0 }],
    rules: [
      { name: '翻转', condition: 'true', actions: [{ target: 'x', expr: '1 - x' }] },
    ],
  };
  const r = explore(input, { maxSteps: 5, stateLimit: 100 });
  assert.equal(r.complete, true);
  assert.equal(r.safe, true);
  assert.equal(r.counts.findings, 0);
});

test('BFS：并行赋值基于旧状态（swap 可行）', () => {
  const input = {
    variables: [
      { name: 'a', kind: 'range', min: 0, max: 5, initial: 1 },
      { name: 'b', kind: 'range', min: 0, max: 5, initial: 2 },
    ],
    rules: [{
      name: '交换',
      condition: 'a == 1',
      actions: [
        { target: 'a', expr: 'b' },
        { target: 'b', expr: 'a' },
      ],
    }],
  };
  const r = explore(input, { maxSteps: 3, stateLimit: 10 });
  // 第一次：a=2,b=1；第二次条件不再满足 => 死锁
  const d = r.findings.find((f) => f.type === 'deadlock');
  assert.deepEqual(d.state, { a: 2, b: 1 });
});

test('BFS：字符串枚举变量', () => {
  const input = {
    variables: [{ name: 'phase', kind: 'enum', values: ['a', 'b'], initial: 'a' }],
    rules: [{
      name: '前进',
      condition: 'phase == "a"',
      actions: [{ target: 'phase', expr: '"b"' }],
    }],
  };
  const r = explore(input, { maxSteps: 3, stateLimit: 10 });
  const d = r.findings.find((f) => f.type === 'deadlock');
  assert.deepEqual(d.state, { phase: 'b' });
  assert.deepEqual(d.path.rulePath, ['前进']);
});

test('模型校验：重复变量名、越界初始值等给出 400 风格错误', () => {
  assert.throws(() => explore({
    variables: [
      { name: 'x', kind: 'range', min: 0, max: 1, initial: 0 },
      { name: 'x', kind: 'range', min: 0, max: 1, initial: 0 },
    ],
    rules: [{ name: 'r', condition: 'true', actions: [] }],
  }, { maxSteps: 1, stateLimit: 10 }), /重复/);

  assert.throws(() => explore({
    variables: [{ name: 'x', kind: 'range', min: 0, max: 2, initial: 5 }],
    rules: [{ name: 'r', condition: 'true', actions: [] }],
  }, { maxSteps: 1, stateLimit: 10 }), /超出区间/);

  assert.throws(() => explore({
    variables: [{ name: 'x', kind: 'range', min: 0, max: 2, initial: 0 }],
    rules: [{ name: 'r', condition: 'y > 0', actions: [] }],
  }, { maxSteps: 1, stateLimit: 10 }), /未声明/);
});
