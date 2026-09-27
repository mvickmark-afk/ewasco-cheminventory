import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('server-served frontend scripts are syntactically valid', async () => {
  const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const scripts = [];
  let cursor = 0;
  while (true) {
    const start = html.indexOf('<script', cursor);
    if (start < 0) break;
    const openEnd = html.indexOf('>', start);
    const close = html.indexOf('</script>', openEnd + 1);
    if (openEnd < 0 || close < 0) break;
    const source = html.slice(openEnd + 1, close);
    if (source.trim()) scripts.push(source);
    cursor = close + '</script>'.length;
  }
  assert.ok(scripts.length >= 1);
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script));
  }
});

test('frontend API client is syntactically valid', async () => {
  const source = await fs.readFile(new URL('../public/api-client.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Function(source));
});
