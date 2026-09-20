'use strict';

const { evaluate } = require('./expr');
const { prepare } = require('./model');

/**
 * BFS 状态空间探索。
 *
 * 发现三类问题（finding）：
 *   deadlock  —— 状态上没有任何规则可执行
 *   conflict  —— 同一互斥组内有多条规则同时满足（互斥规则冲突）
 *   invalidAssignment —— 某规则的赋值结果超出变量域（规则永远无法合法生效）
 *
 * 完备性（complete）：
 *   仅当所有可达状态在步数内被完整展开时才为 true。
 *   触发状态上限（truncatedStateLimit）或存在未展开的深度边界（truncatedDepth）
 *   都会令 complete=false，此时 safe 恒为 null，绝不误报安全。
 */

const MAX_LIMIT = 1_000_000;
const MAX_DEPTH = 1000;
const MAX_FINDINGS = 200;

function stateKey(state, order) {
  // 按变量声明顺序拼接，避免依赖键遍历顺序
  let key = '';
  for (const name of order) {
    const v = state[name];
    key += `${typeof v === 'string' ? 's' : 'n'}:${JSON.stringify(v)};`;
  }
  return key;
}

function cloneState(state, order) {
  const next = {};
  for (const name of order) next[name] = state[name];
  return next;
}

/** 求值规则条件，返回布尔值；条件自身抛错时按“不可执行”处理并记录。 */
function ruleEnabled(rule, state) {
  const value = evaluate(rule.conditionAst, state);
  return Boolean(value);
}

/**
 * 应用规则：并行赋值（所有右式基于旧状态求值），
 * 返回 { state, invalid: [{ target, value }] }。
 */
function applyRule(rule, state, order, varMap) {
  const next = cloneState(state, order);
  const updates = new Map();
  for (const action of rule.actions) {
    const value = evaluate(action.ast, state);
    if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
      throw new Error(`赋值目标 "${action.target}" 的结果类型不受支持`);
    }
    updates.set(action.target, value);
  }

  const invalid = [];
  for (const [target, rawValue] of updates) {
    const def = varMap.get(target);
    const value = def.kind === 'range' && typeof rawValue === 'boolean'
      ? (rawValue ? 1 : 0)
      : rawValue;
    if (def.kind === 'range') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        invalid.push({ target, value: rawValue, reason: '结果不是数字' });
        continue;
      }
      if (!Number.isInteger(value)) {
        invalid.push({ target, value, reason: '结果不是整数' });
        continue;
      }
      if (value < def.min || value > def.max) {
        invalid.push({ target, value, reason: `超出区间 [${def.min}, ${def.max}]` });
        continue;
      }
    } else if (!def.values.includes(value)) {
      invalid.push({ target, value, reason: '不在枚举取值范围内' });
    }
    next[target] = value;
  }
  return { state: next, invalid };
}

function findConflicts(enabled, defaultMutex) {
  // 互斥组 -> 同时可执行的规则名列表
  const groups = new Map();
  for (const rule of enabled) {
    const group = rule.group !== null ? rule.group : (defaultMutex ? '__default__' : null);
    if (group === null) continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(rule.name);
  }
  const conflicts = [];
  for (const [group, names] of groups) {
    if (names.length > 1) {
      conflicts.push({
        group: group === '__default__' ? '（默认互斥）' : group,
        rules: names,
      });
    }
  }
  return conflicts;
}

function reconstructPath(parentMap, key, finalEdge, initialKey) {
  // 收集 finalEdge（触发问题的最后一步），再沿 parent 链回溯
  const reversedEdges = finalEdge ? [finalEdge] : [];
  let cur = key;
  while (cur !== initialKey) {
    const parent = parentMap.get(cur);
    if (!parent) break;
    reversedEdges.push(parent.edge);
    cur = parent.key;
  }
  reversedEdges.reverse();
  return {
    rulePath: reversedEdges.filter(Boolean).map((e) => e.rule),
    length: reversedEdges.filter(Boolean).length,
    transitions: reversedEdges.filter(Boolean).map((e) => ({ rule: e.rule, to: e.to })),
  };
}

function explore(input, options = {}) {
  const prepared = prepare(input);
  const { variables, rules, varMap, initialState } = prepared;
  const order = variables.map((v) => v.name);

  let maxSteps = Number.isInteger(options.maxSteps) ? options.maxSteps : Number(options.maxSteps);
  if (!Number.isFinite(maxSteps)) throw new Error('maxSteps 必须为整数');
  maxSteps = Math.max(0, Math.min(MAX_DEPTH, Math.trunc(maxSteps)));

  let stateLimit = Number(options.stateLimit);
  if (!Number.isFinite(stateLimit) || stateLimit <= 0) throw new Error('stateLimit 必须为正整数');
  stateLimit = Math.min(MAX_LIMIT, Math.trunc(stateLimit));

  const defaultMutex = Boolean(options.defaultMutex);

  const initialKey = stateKey(initialState, order);
  const visited = new Set([initialKey]);
  // key -> { key: parentKey, edge: { rule, from, to } }
  const parentMap = new Map();
  const queue = [{ key: initialKey, state: initialState, depth: 0 }];

  const findings = [];
  const seenFindings = new Set();
  let exploredTransitions = 0;
  let truncatedDepth = false;
  let truncatedStateLimit = false;

  function addFinding(type, data) {
    const dedupKey = `${type}|${data.stateKey}|${data.dedup || ''}`;
    if (seenFindings.has(dedupKey)) return;
    seenFindings.add(dedupKey);
    findings.push({ type, ...data });
  }

  while (queue.length > 0) {
    const node = queue.shift();
    const { state, depth, key } = node;

    let enabled;
    try {
      enabled = rules.filter((rule) => ruleEnabled(rule, state));
    } catch (err) {
      addFinding('evalError', {
        state, stateKey: key, depth,
        message: `条件求值失败：${err.message}`,
        dedup: err.message,
      });
      enabled = [];
    }

    // 死锁：无规则可执行
    if (enabled.length === 0) {
      const path = reconstructPath(parentMap, key, null, initialKey);
      addFinding('deadlock', {
        state, stateKey: key, depth,
        path,
        dedup: '',
      });
    }

    // 冲突：同一互斥组内多条可执行
    const conflicts = findConflicts(enabled, defaultMutex);
    for (const conflict of conflicts) {
      const path = reconstructPath(parentMap, key, null, initialKey);
      addFinding('conflict', {
        state, stateKey: key, depth,
        group: conflict.group,
        conflictingRules: conflict.rules,
        path,
        dedup: `g:${conflict.group}`,
      });
    }

    // 到达步数边界：子状态不再展开
    if (depth >= maxSteps) {
      if (enabled.length > 0) truncatedDepth = true;
      continue;
    }

    for (const rule of enabled) {
      let result;
      try {
        result = applyRule(rule, state, order, varMap);
      } catch (err) {
        addFinding('evalError', {
          state, stateKey: key, depth: depth + 1,
          rule: rule.name,
          message: `规则 "${rule.name}" 赋值求值失败：${err.message}`,
          dedup: `a:${rule.name}:${err.message}`,
        });
        continue;
      }
      exploredTransitions += 1;

      if (result.invalid.length > 0) {
        const edge = { rule: rule.name, from: state, to: result.state };
        const path = reconstructPath(parentMap, key, edge, initialKey);
        addFinding('invalidAssignment', {
          state: result.state,
          stateKey: stateKey(result.state, order),
          depth: depth + 1,
          rule: rule.name,
          violations: result.invalid,
          path,
          dedup: `r:${rule.name}:${result.invalid.map((v) => `${v.target}=${v.value}`).join(',')}`,
        });
        continue; // 越界状态不入队
      }

      const nextKey = stateKey(result.state, order);
      if (visited.has(nextKey)) continue;

      if (visited.size >= stateLimit) {
        truncatedStateLimit = true;
        continue;
      }
      visited.add(nextKey);
      parentMap.set(nextKey, { key, edge: { rule: rule.name, from: state, to: result.state } });
      queue.push({ key: nextKey, state: result.state, depth: depth + 1 });
    }
  }

  // 排序：最短路径优先，同深度按类型与规则名稳定排列
  const typeRank = { deadlock: 0, conflict: 1, invalidAssignment: 2, evalError: 3 };
  findings.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (typeRank[a.type] !== typeRank[b.type]) return typeRank[a.type] - typeRank[b.type];
    return (a.rule || a.group || '').localeCompare(b.rule || b.group || '');
  });
  const limitedFindings = findings.slice(0, MAX_FINDINGS);

  const complete = !truncatedDepth && !truncatedStateLimit;
  const hasFindings = limitedFindings.length > 0;
  let safe;
  if (!complete) safe = null;        // 不完备 => 不能声称安全
  else safe = !hasFindings;          // 完备且无发现 => 安全

  const warnings = [];
  if (findings.length > MAX_FINDINGS) {
    warnings.push(`发现的问题超过 ${MAX_FINDINGS} 条，仅保留路径最短的前 ${MAX_FINDINGS} 条`);
  }

  return {
    safe,
    complete,
    truncatedDepth,
    truncatedStateLimit,
    status: !complete
      ? (truncatedStateLimit ? 'truncatedStateLimit' : 'truncatedDepth')
      : (hasFindings ? 'unsafe' : 'safe'),
    counts: {
      statesVisited: visited.size,
      transitions: exploredTransitions,
      findings: limitedFindings.length,
      findingsTotal: findings.length,
      deadlock: limitedFindings.filter((f) => f.type === 'deadlock').length,
      conflict: limitedFindings.filter((f) => f.type === 'conflict').length,
      invalidAssignment: limitedFindings.filter((f) => f.type === 'invalidAssignment').length,
      evalError: limitedFindings.filter((f) => f.type === 'evalError').length,
    },
    bounds: { maxSteps, stateLimit, defaultMutex, maxStatesHardLimit: MAX_LIMIT },
    initialState,
    findings: limitedFindings,
    warnings,
  };
}

module.exports = { explore, stateKey };
