const fs = require('fs');
const path = require('path');

function parseEnv(content) {
  const map = {};
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    map[key] = val;
  });
  return map;
}

function stringifyEnv(original, updates) {
  const lines = original.split(/\r?\n/);
  const keys = Object.keys(updates);
  const updated = new Set();
  const out = lines.map(line => {
    const idx = line.indexOf('=');
    const raw = line.trim();
    if (!raw || raw.startsWith('#') || idx === -1) return line;
    const key = line.slice(0, idx).trim();
    if (keys.includes(key)) {
      updated.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });
  keys.forEach(k => {
    if (!updated.has(k)) out.push(`${k}=${updates[k]}`);
  });
  return out.join('\n');
}

function readEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { content, map: parseEnv(content) };
  } catch (e) {
    return { content: '', map: {} };
  }
}

function writeEnv(filePath, updates) {
  const abs = path.resolve(filePath);
  const { content } = readEnv(abs);
  const next = stringifyEnv(content, updates);
  fs.writeFileSync(abs, next, 'utf8');
}

module.exports = { readEnv, writeEnv };
