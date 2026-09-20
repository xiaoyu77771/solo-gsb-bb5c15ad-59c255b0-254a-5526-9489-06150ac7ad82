'use strict';

const path = require('path');
const express = require('express');
const { explore } = require('./src/explorer');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'turn-rule-validator' });
});

app.post('/api/analyze', (req, res) => {
  const body = req.body || {};
  const options = {
    maxSteps: body.maxSteps,
    stateLimit: body.stateLimit,
    defaultMutex: body.defaultMutex,
  };
  try {
    const result = explore(
      { variables: body.variables, rules: body.rules },
      options,
    );
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`桌游回合规则验证器已启动: http://localhost:${PORT}`);
});

module.exports = app;
