'use strict';

/* 全局表单模型 */
let model = { variables: [], rules: [] };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- 枚举文本解析 ---------- */
function parseEnumText(text) {
  return String(text || '')
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      if (s === 'true') return true;
      if (s === 'false') return false;
      const n = Number(s);
      return s !== '' && !Number.isNaN(n) ? n : s;
    });
}

/* ---------- 默认行 ---------- */
function emptyVariable() {
  return { name: '', kind: 'range', min: 0, max: 10, enumText: '', initial: 0 };
}

function emptyRule(varName) {
  return {
    name: '',
    condition: '',
    group: '',
    actions: [{ target: varName || '', expr: '' }],
  };
}

/* ---------- 渲染 ---------- */
function renderVariables() {
  const container = $('#variables-list');
  container.innerHTML = model.variables.map((v, i) => {
    const isEnum = v.kind === 'enum';
    const initialControl = isEnum
      ? `<input type="text" list="enum-options-${i}" data-ui="var-initial" data-idx="${i}"
               value="${escapeHtml(v.initial)}" placeholder="枚举中的一个值" />`
      : `<input type="number" data-ui="var-initial" data-idx="${i}" value="${escapeHtml(v.initial)}" />`;
    return `
    <div class="card">
      <div class="card-head">
        <span class="card-index">V${i + 1}</span>
        <input type="text" data-ui="var-name" data-idx="${i}" value="${escapeHtml(v.name)}" placeholder="变量名，如 能量 / phase" />
        <button type="button" class="btn btn-small btn-danger" data-ui="var-del" data-idx="${i}">删除</button>
      </div>
      <div class="field-row">
        <label class="field">类型
          <select data-ui="var-kind" data-idx="${i}">
            <option value="range" ${!isEnum ? 'selected' : ''}>整数区间</option>
            <option value="enum" ${isEnum ? 'selected' : ''}>枚举</option>
          </select>
        </label>
        ${isEnum ? `
        <label class="field field-grow">可选值（逗号或换行分隔）
          <input type="text" data-ui="var-enum" data-idx="${i}" value="${escapeHtml(v.enumText)}"
                 placeholder="抽牌, 行动, 结束" />
        </label>` : `
        <label class="field">最小值
          <input type="number" data-ui="var-min" data-idx="${i}" value="${escapeHtml(v.min)}" />
        </label>
        <label class="field">最大值
          <input type="number" data-ui="var-max" data-idx="${i}" value="${escapeHtml(v.max)}" />
        </label>`}
        <label class="field">初始值
          ${initialControl}
        </label>
      </div>
      ${isEnum ? `<datalist id="enum-options-${i}">
        ${parseEnumText(v.enumText).map((opt) => `<option value="${escapeHtml(String(opt))}"></option>`).join('')}
      </datalist>` : ''}
    </div>`;
  }).join('');
}

function renderRules() {
  const varNames = model.variables.map((v) => v.name).filter(Boolean);
  const optionsFor = (selected) => {
    const base = '<option value="">— 选择变量 —</option>' +
      varNames.map((n) => `<option value="${escapeHtml(n)}" ${n === selected ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
    // 允许目标变量已被删除时仍显示
    if (selected && !varNames.includes(selected)) {
      return `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}（未声明）</option>` + base;
    }
    return base;
  };

  $('#rules-list').innerHTML = model.rules.map((r, i) => `
    <div class="card">
      <div class="card-head">
        <span class="card-index">R${i + 1}</span>
        <input type="text" data-ui="rule-name" data-idx="${i}" value="${escapeHtml(r.name)}" placeholder="规则名，如 攻击" />
        <input type="text" data-ui="rule-group" data-idx="${i}" value="${escapeHtml(r.group)}"
               placeholder="互斥组（可空），如 行动" style="max-width:180px" />
        <button type="button" class="btn btn-small btn-danger" data-ui="rule-del" data-idx="${i}">删除</button>
      </div>
      <div class="field-row">
        <label class="field field-grow">触发条件（表达式）
          <input type="text" class="code" data-ui="rule-cond" data-idx="${i}" value="${escapeHtml(r.condition)}"
                 placeholder='阶段=="行动" && 能量>=2' />
        </label>
      </div>
      <div class="field-row" style="margin-top:8px">
        <span class="field" style="color:#6b7280;font-size:12px">并行赋值：</span>
      </div>
      ${r.actions.map((a, j) => `
      <div class="field-row" style="margin-top:6px">
        <label class="field">目标
          <select data-ui="action-target" data-idx="${i}" data-aidx="${j}">${optionsFor(a.target)}</select>
        </label>
        <label class="field field-grow">赋值表达式（基于赋值前状态）
          <input type="text" class="code" data-ui="action-expr" data-idx="${i}" data-aidx="${j}"
                 value="${escapeHtml(a.expr)}" placeholder="能量 - 2" />
        </label>
        <button type="button" class="btn btn-small btn-danger" data-ui="action-del" data-idx="${i}" data-aidx="${j}">移除</button>
      </div>`).join('')}
      <div style="margin-top:8px">
        <button type="button" class="btn btn-small" data-ui="action-add" data-idx="${i}">+ 添加赋值</button>
      </div>
    </div>
  `).join('');
}

function renderAll() {
  renderVariables();
  renderRules();
}

/* ---------- 表单事件委托 ---------- */
$('#variables-list').addEventListener('input', (e) => {
  const t = e.target;
  const ui = t.dataset.ui;
  if (!ui) return;
  const i = Number(t.dataset.idx);
  const v = model.variables[i];
  if (ui === 'var-name') v.name = t.value;
  else if (ui === 'var-min') v.min = t.value === '' ? '' : Number(t.value);
  else if (ui === 'var-max') v.max = t.value === '' ? '' : Number(t.value);
  else if (ui === 'var-enum') {
    v.enumText = t.value;
    renderVariables(); // 刷新 datalist
  } else if (ui === 'var-initial') {
    v.initial = v.kind === 'enum' ? t.value : (t.value === '' ? '' : Number(t.value));
  }
});

$('#variables-list').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.ui === 'var-kind') {
    const i = Number(t.dataset.idx);
    model.variables[i].kind = t.value;
    if (t.value === 'enum') model.variables[i].initial = '';
    else model.variables[i].initial = Number(model.variables[i].min) || 0;
    renderVariables();
  }
});

$('#variables-list').addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.ui === 'var-del') {
    model.variables.splice(Number(t.dataset.idx), 1);
    renderAll();
  }
});

$('#rules-list').addEventListener('input', (e) => {
  const t = e.target;
  const ui = t.dataset.ui;
  if (!ui) return;
  const i = Number(t.dataset.idx);
  const r = model.rules[i];
  if (ui === 'rule-name') r.name = t.value;
  else if (ui === 'rule-group') r.group = t.value;
  else if (ui === 'rule-cond') r.condition = t.value;
  else if (ui === 'action-expr') r.actions[Number(t.dataset.aidx)].expr = t.value;
});

$('#rules-list').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.ui === 'action-target') {
    model.rules[Number(t.dataset.idx)].actions[Number(t.dataset.aidx)].target = t.value;
  }
});

$('#rules-list').addEventListener('click', (e) => {
  const t = e.target;
  const i = t.dataset ? Number(t.dataset.idx) : NaN;
  if (t.dataset.ui === 'rule-del') {
    model.rules.splice(i, 1);
    renderRules();
  } else if (t.dataset.ui === 'action-add') {
    const firstName = model.variables.map((v) => v.name).find(Boolean) || '';
    model.rules[i].actions.push({ target: firstName, expr: '' });
    renderRules();
  } else if (t.dataset.ui === 'action-del') {
    model.rules[i].actions.splice(Number(t.dataset.aidx), 1);
    renderRules();
  }
});

$('#btn-add-var').addEventListener('click', () => {
  model.variables.push(emptyVariable());
  renderVariables();
});
$('#btn-add-rule').addEventListener('click', () => {
  model.rules.push(emptyRule(model.variables.map((v) => v.name).find(Boolean)));
  renderRules();
});

/* ---------- 构造请求 ---------- */
function buildPayload() {
  if (model.variables.length === 0) throw new Error('请至少添加一个状态变量');
  if (model.rules.length === 0) throw new Error('请至少添加一条规则');

  const variables = model.variables.map((v, i) => {
    const name = (v.name || '').trim();
    if (!name) throw new Error(`第 ${i + 1} 个变量缺少名称`);
    if (v.kind === 'enum') {
      const values = parseEnumText(v.enumText);
      if (values.length === 0) throw new Error(`变量 "${name}" 至少需要一个枚举值`);
      let initial = v.initial;
      if (typeof initial === 'string') {
        const parsed = parseEnumText(initial)[0];
        initial = parsed === undefined ? '' : parsed;
      }
      return { name, kind: 'enum', values, initial };
    }
    const min = Number(v.min);
    const max = Number(v.max);
    const initial = Number(v.initial);
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new Error(`变量 "${name}" 的最小/最大值必须为整数`);
    }
    if (!Number.isInteger(initial)) throw new Error(`变量 "${name}" 的初始值必须为整数`);
    return { name, kind: 'range', min, max, initial };
  });

  const names = new Set(variables.map((v) => v.name));
  const dupNames = variables.filter((v, i) => variables.findIndex((x) => x.name === v.name) !== i);
  if (dupNames.length) throw new Error(`变量名重复：${dupNames[0].name}`);

  const rules = model.rules.map((r, i) => {
    const name = (r.name || '').trim() || `规则${i + 1}`;
    if (!(r.condition || '').trim()) throw new Error(`规则 "${name}" 缺少触发条件`);
    const actions = r.actions
      .filter((a) => (a.target || '').trim() || (a.expr || '').trim())
      .map((a) => {
        const target = (a.target || '').trim();
        if (!names.has(target)) throw new Error(`规则 "${name}" 的赋值目标 "${target}" 未声明`);
        if (!(a.expr || '').trim()) throw new Error(`规则 "${name}" 对 "${target}" 的赋值表达式为空`);
        return { target, expr: a.expr };
      });
    return { name, condition: r.condition, group: (r.group || '').trim() || null, actions };
  });

  const ruleNames = new Set();
  for (const r of rules) {
    if (ruleNames.has(r.name)) throw new Error(`规则名重复：${r.name}`);
    ruleNames.add(r.name);
  }

  return {
    variables,
    rules,
    maxSteps: Number($('#cfg-max-steps').value),
    stateLimit: Number($('#cfg-state-limit').value),
    defaultMutex: $('#cfg-default-mutex').checked,
  };
}

/* ---------- 导入 / 导出 ---------- */
function exportDocument() {
  let payload;
  try {
    payload = buildPayload();
  } catch (err) {
    showFormError(err.message);
    return;
  }
  const doc = {
    format: 'turn-rule-validator/1',
    exportedAt: new Date().toISOString(),
    variables: payload.variables,
    rules: payload.rules.map((r) => ({
      name: r.name, condition: r.condition, group: r.group, actions: r.actions,
    })),
    options: {
      maxSteps: payload.maxSteps,
      stateLimit: payload.stateLimit,
      defaultMutex: payload.defaultMutex,
    },
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ruleset.json';
  a.click();
  URL.revokeObjectURL(url);
}

function loadDocument(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('JSON 顶层必须是对象');
  const variables = doc.variables;
  const rules = doc.rules;
  if (!Array.isArray(variables)) throw new Error('缺少 variables 数组');
  if (!Array.isArray(rules)) throw new Error('缺少 rules 数组');

  model.variables = variables.map((v) => {
    const kind = v.kind === 'enum' ? 'enum' : 'range';
    if (kind === 'enum') {
      return {
        name: String(v.name ?? ''),
        kind,
        enumText: Array.isArray(v.values) ? v.values.join(', ') : '',
        initial: v.initial !== undefined ? String(v.initial) : '',
      };
    }
    return {
      name: String(v.name ?? ''),
      kind,
      min: v.min, max: v.max,
      initial: v.initial,
    };
  });

  model.rules = rules.map((r) => {
    let actions;
    if (Array.isArray(r.actions)) {
      actions = r.actions.map((a) => ({ target: String(a.target ?? ''), expr: String(a.expr ?? '') }));
    } else if (r.assignments && typeof r.assignments === 'object') {
      actions = Object.entries(r.assignments).map(([target, expr]) => ({ target, expr: String(expr) }));
    } else {
      actions = [];
    }
    return {
      name: String(r.name ?? ''),
      condition: String(r.condition ?? ''),
      group: r.group ? String(r.group) : '',
      actions: actions.length ? actions : [{ target: '', expr: '' }],
    };
  });

  const opts = doc.options || {};
  if (Number.isFinite(Number(opts.maxSteps))) $('#cfg-max-steps').value = Number(opts.maxSteps);
  if (Number.isFinite(Number(opts.stateLimit))) $('#cfg-state-limit').value = Number(opts.stateLimit);
  $('#cfg-default-mutex').checked = Boolean(opts.defaultMutex);

  renderAll();
}

$('#btn-export').addEventListener('click', exportDocument);

$('#btn-import-file').addEventListener('click', () => $('#import-file-input').click());
$('#import-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadDocument(JSON.parse(reader.result));
      hideFormError();
    } catch (err) {
      showFormError(`导入失败：${err.message}`);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

$('#btn-import-text').addEventListener('click', () => {
  const box = $('#import-text-area');
  box.hidden = !box.hidden;
});
$('#btn-import-cancel').addEventListener('click', () => {
  $('#import-text-area').hidden = true;
  $('#import-text').value = '';
});
$('#btn-import-confirm').addEventListener('click', () => {
  try {
    loadDocument(JSON.parse($('#import-text').value));
    $('#import-text-area').hidden = true;
    $('#import-text').value = '';
    hideFormError();
  } catch (err) {
    showFormError(`导入失败：${err.message}`);
  }
});

/* ---------- 错误提示 ---------- */
function showFormError(msg) {
  const el = $('#form-error');
  el.textContent = msg;
  el.hidden = false;
}
function hideFormError() {
  $('#form-error').hidden = true;
}

/* ---------- 结果渲染 ---------- */
function stateTable(state) {
  const rows = Object.entries(state)
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td><code>${escapeHtml(JSON.stringify(v))}</code></td></tr>`)
    .join('');
  return `<table class="state-table">${rows}</table>`;
}

function renderPath(path, initialState) {
  if (!path || path.length === 0) {
    return '<div class="path-line">触发路径：<strong>问题直接出现在初始状态</strong>（0 步）</div>';
  }
  const route = ['初始状态', ...path.rulePath]
    .map((step, i) => (i === 0
      ? `<span class="path-route">${escapeHtml(step)}</span>`
      : `→<span class="path-route">${escapeHtml(step)}</span>`))
    .join('');
  const stepsHtml = path.transitions.map((tr, i) => `
    <li>第 ${i + 1} 步 触发 <code>${escapeHtml(tr.rule)}</code>，到达：${stateTable(tr.to)}</li>`).join('');
  return `
    <div class="path-line"><strong>最短触发路径（${path.length} 步）：</strong>${route}</div>
    <details><summary>查看路径上的每个状态</summary>
      <ol style="font-size:12px">
        <li>初始状态：${stateTable(initialState)}</li>
        ${stepsHtml}
      </ol>
    </details>`;
}

function renderFinding(f, initialState) {
  const head = {
    deadlock: '<span class="badge deadlock">死锁</span> 无任何规则可执行',
    conflict: `<span class="badge conflict">互斥冲突</span> 互斥组 <code>${escapeHtml(f.group)}</code> 中多条规则同时满足`,
    invalidAssignment: '<span class="badge invalidAssignment">越界赋值</span>',
    evalError: '<span class="badge evalError">表达式错误</span>',
  }[f.type];

  let detail = '';
  if (f.type === 'conflict') {
    detail = `<p class="finding-detail">同时可执行：${f.conflictingRules.map((r) => `<code>${escapeHtml(r)}</code>`).join('、')}</p>`;
  } else if (f.type === 'invalidAssignment') {
    detail = `<p class="finding-detail">规则 <code>${escapeHtml(f.rule)}</code> 的赋值超出变量域：</p>
      <ul class="finding-detail">
        ${f.violations.map((vio) => `<li><code>${escapeHtml(vio.target)}</code> = <code>${escapeHtml(JSON.stringify(vio.value))}</code>（${escapeHtml(vio.reason)}）</li>`).join('')}
      </ul>`;
  } else if (f.type === 'evalError') {
    detail = `<p class="finding-detail">${escapeHtml(f.message)}${f.rule ? `（规则 <code>${escapeHtml(f.rule)}</code>）` : ''}</p>`;
  }

  return `
    <div class="finding ${f.type}">
      <div class="finding-head">
        ${head}
        <span class="badge depth">深度 ${f.depth}</span>
      </div>
      ${detail}
      <details><summary>问题状态</summary>${stateTable(f.state)}</details>
      ${renderPath(f.path, initialState)}
    </div>`;
}

function renderResult(data) {
  const r = data.result;
  const c = r.counts;
  let banner;
  if (r.safe === true) {
    banner = `<div class="result-banner banner-safe">
      <h3>✓ 验证通过（结果完备）</h3>
      <p>在 ${r.bounds.maxSteps} 步内可达的 ${c.statesVisited} 个状态已全部探索，未发现死锁、互斥冲突或越界赋值。</p>
    </div>`;
  } else if (r.safe === false) {
    banner = `<div class="result-banner banner-unsafe">
      <h3>✗ 发现问题（结果完备）</h3>
      <p>状态空间已完整展开，共发现 ${c.findingsTotal} 个异常状态：死锁 ${c.deadlock} 个、互斥冲突 ${c.conflict} 个、越界赋值 ${c.invalidAssignment} 个${c.evalError ? `、表达式错误 ${c.evalError} 个` : ''}。</p>
    </div>`;
  } else {
    const reasons = [];
    if (r.truncatedStateLimit) reasons.push(`已达到状态上限 ${r.bounds.stateLimit}，部分可达状态未被探索`);
    if (r.truncatedDepth) reasons.push(`已达到最大步数 ${r.bounds.maxSteps}，边界上的状态仍有可执行规则但未继续展开`);
    banner = `<div class="result-banner banner-incomplete">
      <h3>⚠ 结果不完备 —— 不能判定为安全</h3>
      <p>${reasons.join('；')}。以下发现仅是<b>已探索部分</b>中的问题，提高「状态上限 / 最大步数」后重新验证才能获得完备结论。</p>
    </div>`;
  }

  const stats = [
    ['访问状态数', c.statesVisited],
    ['尝试转移数', c.transitions],
    ['问题状态数', c.findingsTotal],
    ['死锁', c.deadlock],
    ['互斥冲突', c.conflict],
    ['越界赋值', c.invalidAssignment],
  ].map(([label, num]) => `<div class="stat"><div class="num">${num}</div><div class="label">${label}</div></div>`).join('');

  const warnings = (r.warnings || [])
    .map((w) => `<p class="finding-detail" style="color:var(--warn-text)">⚠ ${escapeHtml(w)}</p>`).join('');

  $('#result-body').innerHTML = `
    ${banner}
    <div class="stat-grid">${stats}</div>
    ${warnings}
    <h3 style="font-size:15px">问题清单（按最短路径排序）</h3>
    ${r.findings.length ? r.findings.map((f) => renderFinding(f, r.initialState)).join('') :
      '<p class="finding-detail" style="color:var(--muted)">已探索范围内未发现问题。</p>'}`;
  $('#result-panel').hidden = false;
  $('#result-panel').scrollIntoView({ behavior: 'smooth' });
}

$('#btn-close-result').addEventListener('click', () => { $('#result-panel').hidden = true; });

/* ---------- 运行 ---------- */
$('#btn-run').addEventListener('click', async () => {
  let payload;
  try {
    payload = buildPayload();
  } catch (err) {
    showFormError(err.message);
    return;
  }
  hideFormError();
  const btn = $('#btn-run');
  btn.disabled = true;
  btn.textContent = '探索中…';
  try {
    const resp = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || `服务器错误（${resp.status}）`);
    renderResult(data);
  } catch (err) {
    showFormError(`验证失败：${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ 开始验证';
  }
});

/* ---------- 示例 ---------- */
const EXAMPLE = {
  format: 'turn-rule-validator/1',
  options: { maxSteps: 15, stateLimit: 10000, defaultMutex: false },
  variables: [
    { name: '阶段', kind: 'enum', values: ['抽牌', '行动', '结束', '出局'], initial: '抽牌' },
    { name: '能量', kind: 'range', min: 0, max: 10, initial: 0 },
    { name: '生命值', kind: 'range', min: 0, max: 20, initial: 6 },
    { name: '击杀数', kind: 'range', min: 0, max: 99, initial: 0 },
    { name: '护甲', kind: 'range', min: 0, max: 5, initial: 0 },
  ],
  rules: [
    { name: '开始行动', condition: '阶段=="抽牌"', group: null,
      actions: [{ target: '阶段', expr: '"行动"' }, { target: '能量', expr: '能量+3' }] },
    { name: '回合结束', condition: '阶段=="结束"', group: null,
      actions: [{ target: '阶段', expr: '"抽牌"' }, { target: '能量', expr: '0' }] },
    { name: '攻击', condition: '阶段=="行动" && 能量>=2', group: '行动',
      actions: [
        { target: '能量', expr: '能量-2' },
        { target: '击杀数', expr: '击杀数+1' },
        { target: '生命值', expr: '生命值-2' },
      ] },
    { name: '防御', condition: '阶段=="行动" && 能量>=1', group: '行动',
      actions: [{ target: '能量', expr: '能量-1' }, { target: '阶段', expr: '"结束"' }] },
    { name: '蓄力', condition: '阶段=="行动"', group: '行动',
      actions: [{ target: '能量', expr: '能量+3' }, { target: '阶段', expr: '"结束"' }] },
    { name: '护甲充能', condition: '阶段=="行动"', group: '行动',
      actions: [{ target: '护甲', expr: '护甲+2' }, { target: '阶段', expr: '"结束"' }] },
    { name: '淘汰', condition: '阶段=="行动" && 生命值==0', group: null,
      actions: [{ target: '阶段', expr: '"出局"' }] },
  ],
};

$('#btn-example').addEventListener('click', () => {
  loadDocument(EXAMPLE);
  hideFormError();
});

/* 初始化 */
loadDocument(EXAMPLE);
