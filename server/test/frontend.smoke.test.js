import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('server-served frontend scripts are syntactically valid', async () => {
  const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script(?:[^>]*)>([\\s\\S]*?)<\\/script>/gi)]
    .map(match => match[1])
    .filter(Boolean);
  assert.ok(scripts.length >= 1);
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script));
  }
});

test('frontend API client is syntactically valid', async () => {
  const source = await fs.readFile(new URL('../public/api-client.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Function(source));
});
