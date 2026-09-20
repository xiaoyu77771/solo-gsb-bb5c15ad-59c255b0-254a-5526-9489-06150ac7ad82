'use strict';

const { compile, collectVars } = require('./expr');

/**
 * 变量域定义：
 *   { name, kind: 'range', min, max, initial }          整数区间
 *   { name, kind: 'enum',  values: [...], initial }     枚举（数字或字符串）
 *
 * 规则定义：
 *   { name, condition: 表达式字符串,
 *     actions: [{ target, expr }] 或 assignments: { 变量: "表达式" },
 *     group?: 互斥组名 }
 */

function isInt(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

function normalizeVariable(raw, index, label) {
  const prefix = label || `第 ${index + 1} 个变量`;
  if (!raw || typeof raw !== 'object') throw new Error(`${prefix}：格式无效`);

  const name = String(raw.name ?? '').trim();
  if (!name) throw new Error(`${prefix}：缺少变量名`);
  if (!/^[A-Za-z_一-龥][A-Za-z0-9_一-龥]*$/.test(name)) {
    throw new Error(`${prefix}：变量名 "${name}" 不合法（字母/下划线/中文开头）`);
  }

  const kind = raw.kind === 'enum' ? 'enum' : 'range';
  let values;
  let min;
  let max;

  if (kind === 'range') {
    min = raw.min;
    max = raw.max;
    if (!isInt(min) || !isInt(max)) throw new Error(`${prefix}（${name}）：min/max 必须为整数`);
    if (min > max) throw new Error(`${prefix}（${name}）：min 不能大于 max`);
    if (max - min + 1 > 100000) throw new Error(`${prefix}（${name}）：区间过大（上限 100000 个值）`);
    values = null;
  } else {
    if (!Array.isArray(raw.values) || raw.values.length === 0) {
      throw new Error(`${prefix}（${name}）：枚举至少需要一个可选值`);
    }
    if (raw.values.length > 1000) throw new Error(`${prefix}（${name}）：枚举值过多（上限 1000 个）`);
    values = [];
    const seen = new Set();
    for (const v of raw.values) {
      if (typeof v !== 'number' && typeof v !== 'string') {
        throw new Error(`${prefix}（${name}）：枚举值只能是数字或字符串`);
      }
      const key = `${typeof v}:${v}`;
      if (seen.has(key)) throw new Error(`${prefix}（${name}）：枚举值重复 "${v}"`);
      seen.add(key);
      values.push(v);
    }
  }

  const initial = raw.initial;
  if (kind === 'range') {
    if (!isInt(initial)) throw new Error(`${prefix}（${name}）：初始值必须为整数`);
    if (initial < min || initial > max) {
      throw new Error(`${prefix}（${name}）：初始值 ${initial} 超出区间 [${min}, ${max}]`);
    }
  } else if (!values.includes(initial)) {
    throw new Error(`${prefix}（${name}）：初始值 "${initial}" 不在枚举列表中`);
  }

  return { name, kind, min, max, values, initial };
}

function normalizeActions(rawActions, ruleName, varNames) {
  let list;
  if (Array.isArray(rawActions)) {
    list = rawActions;
  } else if (rawActions && typeof rawActions === 'object') {
    list = Object.entries(rawActions).map(([target, expr]) => ({ target, expr }));
  } else {
    list = [];
  }

  const actions = [];
  const targets = new Set();
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`规则 "${ruleName}"：第 ${i + 1} 条赋值格式无效`);
    const target = String(raw.target ?? '').trim();
    if (!target) throw new Error(`规则 "${ruleName}"：第 ${i + 1} 条赋值缺少目标变量`);
    if (!varNames.has(target)) throw new Error(`规则 "${ruleName}"：赋值目标 "${target}" 未在变量中声明`);
    if (targets.has(target)) throw new Error(`规则 "${ruleName}"：对变量 "${target}" 重复赋值`);
    targets.add(target);
    const ast = compile(raw.expr);
    const refs = new Set();
    collectVars(ast, refs);
    for (const ref of refs) {
      if (!varNames.has(ref)) throw new Error(`规则 "${ruleName}"：表达式引用了未声明的变量 "${ref}"`);
    }
    actions.push({ target, source: String(raw.expr), ast });
  });
  return actions;
}

function normalizeRule(raw, index, varNames) {
  if (!raw || typeof raw !== 'object') throw new Error(`第 ${index + 1} 条规则格式无效`);
  const name = String(raw.name ?? '').trim() || `规则${index + 1}`;

  const conditionAst = compile(raw.condition);
  const condRefs = new Set();
  collectVars(conditionAst, condRefs);
  for (const ref of condRefs) {
    if (!varNames.has(ref)) throw new Error(`规则 "${name}"：条件引用了未声明的变量 "${ref}"`);
  }

  const actions = normalizeActions(raw.actions ?? raw.assignments, name, varNames);
  const group = raw.group === undefined || raw.group === null || raw.group === ''
    ? null
    : String(raw.group);

  return {
    name,
    condition: String(raw.condition).trim(),
    conditionAst,
    actions,
    group,
  };
}

/**
 * 编译并校验整个规则集。
 * 返回 { variables, rules, varMap, initialState }。
 */
function prepare(input) {
  if (!input || typeof input !== 'object') throw new Error('请求体必须为 JSON 对象');

  const rawVars = input.variables;
  if (!Array.isArray(rawVars) || rawVars.length === 0) throw new Error('至少需要定义一个状态变量');
  if (rawVars.length > 100) throw new Error('变量数量过多（上限 100 个）');

  const variables = [];
  const varMap = new Map();
  for (let i = 0; i < rawVars.length; i += 1) {
    const v = normalizeVariable(rawVars[i], i);
    if (varMap.has(v.name)) throw new Error(`变量名 "${v.name}" 重复`);
    variables.push(v);
    varMap.set(v.name, v);
  }

  const rawRules = input.rules;
  if (!Array.isArray(rawRules) || rawRules.length === 0) throw new Error('至少需要定义一条规则');
  if (rawRules.length > 500) throw new Error('规则数量过多（上限 500 条）');

  const rules = [];
  const ruleNames = new Set();
  for (let i = 0; i < rawRules.length; i += 1) {
    const rule = normalizeRule(rawRules[i], i, new Set(variables.map((v) => v.name)));
    if (ruleNames.has(rule.name)) throw new Error(`规则名 "${rule.name}" 重复`);
    ruleNames.add(rule.name);
    rules.push(rule);
  }

  const initialState = {};
  for (const v of variables) initialState[v.name] = v.initial;

  return { variables, rules, varMap, initialState };
}

module.exports = { prepare, normalizeVariable };
