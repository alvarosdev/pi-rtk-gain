import { test } from 'node:test';
import assert from 'node:assert/strict';
import extension from '../index.js';

function setup(exec) {
  const handlers = new Map();
  const calls = [];
  const widgets = new Map();
  const tui = { renders: 0, requestRender() { this.renders++; } };
  const pi = { on(name, handler) { handlers.set(name, handler); }, exec };
  const ctx = {
    mode: 'tui', cwd: '/example/project',
    ui: { setWidget(...args) {
      calls.push(args);
      widgets.delete(args[0]);
      if (args[1] !== undefined) widgets.set(args[0], args[1](tui, theme));
    } },
  };
  extension(pi);
  return { handlers, calls, ctx, widgets, tui };
}
const result = (summary) => ({ code: 0, stdout: JSON.stringify({ summary }), stderr: '', killed: false });
const summary = { avg_savings_pct: 39.2369, total_saved: 842612, total_time_ms: 989334, total_commands: 2593 };
const theme = { fg: (_role, text) => text, bg: (_role, text) => text, bold: (text) => text };
const render = (call, width = 80) => call[1]({}, theme).render(width);

test('renders a themed, width-safe card with an efficiency meter', async () => {
  const { handlers, calls, ctx } = setup(async () => result(summary));
  try {
    await handlers.get('session_start')({}, ctx);
    for (const width of [80, 120]) {
      const lines = render(calls.at(-1), width);
      assert.equal(lines.length, 2);
      assert.equal([...lines[0]].length, width);
      assert.equal(lines[0], ` ${'─'.repeat(width - 2)} `);
      assert.match(lines[1], /▎.*RTK.*Eff.*39\.24%.*█.*Saved.*842\.6K.*Cmds.*2\.6K.*Time.*16m 29s/);
      assert.doesNotMatch(lines[1], /[╭╮╰╯│]/);
    }
    for (const width of [8, 20, 50, 80, 120]) {
      const lines = render(calls.at(-1), width);
      assert.equal(lines.length, 2);
      assert.equal(lines[0], ` ${'─'.repeat(width - 2)} `);
      assert.ok(lines.every((line) => [...line].length <= width));
    }
    const roles = [];
    calls.at(-1)[1]({}, { fg: (_role, text) => text, bg: (role, text) => { roles.push(role); return text; } }).render(80);
    assert.deepEqual(roles, ['toolSuccessBg']);
  } finally { handlers.get('session_shutdown')({}, ctx); }
});

test('shows project efficiency, saved tokens and total execution time below the editor', async () => {
  const commands = [];
  const { handlers, calls, ctx } = setup(async (...args) => { commands.push(args); return result(summary); });
  try {
    await handlers.get('session_start')({}, ctx);
    assert.deepEqual(commands[0], ['rtk', ['gain', '--project', '-f', 'json'], { cwd: ctx.cwd, timeout: 5000 }]);
    const call = calls.at(-1);
    assert.equal(call[0], 'rtk-gain-widget');
    assert.deepEqual(call[2], { placement: 'belowEditor' });
    const lines = render(call).join('\n');
    assert.match(lines, /39\.24%/);
    assert.match(lines, /842\.6K/);
    assert.match(lines, /Cmds 2\.6K/);
    assert.match(lines, /16m 29s/);
  } finally { handlers.get('session_shutdown')({}, ctx); }
});

test('refreshes after an agent settles, including zero values', async () => {
  let n = 0;
  const { handlers, calls, ctx } = setup(async () => result(n++ ? { avg_savings_pct: 0, total_saved: 0, total_time_ms: 0, total_commands: 0 } : summary));
  try {
    await handlers.get('session_start')({}, ctx);
    await handlers.get('agent_settled')({}, ctx);
    const lines = render(calls.at(-1)).join('\n');
    assert.match(lines, /0\.00%/);
    assert.match(lines, /Saved.*0/);
    assert.match(lines, /Time.*0s/);
  } finally { handlers.get('session_shutdown')({}, ctx); }
});

test('refreshes metrics without re-registering or changing widget order', async () => {
  let n = 0;
  const { handlers, calls, ctx, widgets, tui } = setup(async () => result(n++ ? { avg_savings_pct: 25, total_saved: 321, total_time_ms: 3000, total_commands: 2 } : summary));
  try {
    await handlers.get('session_start')({}, ctx);
    ctx.ui.setWidget('pi-lens', () => ({ render: () => [], invalidate() {} }), { placement: 'belowEditor' });
    await handlers.get('agent_settled')({}, ctx);
    assert.deepEqual([...widgets.keys()], ['rtk-gain-widget', 'pi-lens']);
    assert.equal(calls.filter(([key]) => key === 'rtk-gain-widget').length, 1);
    assert.match(widgets.get('rtk-gain-widget').render(80)[1], /25\.00%.*Saved 321.*Cmds 2.*Time 3s/);
    assert.ok(tui.renders > 0);
  } finally { handlers.get('session_shutdown')({}, ctx); }
});

test('formats counts with technical K, M and B units', async () => {
  for (const [value, expected] of [[0, '0'], [999, '999'], [1000, '1K'], [1500, '1.5K'], [999950, '1M'], [1000000, '1M'], [1000000000, '1B']]) {
    const { handlers, calls, ctx } = setup(async () => result({ ...summary, total_saved: value, total_commands: value }));
    try {
      await handlers.get('session_start')({}, ctx);
      const line = render(calls.at(-1), 120)[1];
      assert.ok(line.includes(`Saved ${expected} `), line);
      assert.ok(line.includes(`Cmds ${expected} `), line);
    } finally { handlers.get('session_shutdown')({}, ctx); }
  }
});

test('uses theme accent, muted labels and bold values', async () => {
  const { handlers, calls, ctx } = setup(async () => result(summary));
  try {
    await handlers.get('session_start')({}, ctx);
    const foregrounds = [];
    const bold = [];
    const themed = {
      fg: (role, text) => { foregrounds.push([role, text]); return text; },
      bg: (_role, text) => text,
      bold: (text) => { bold.push(text); return text; },
    };
    calls.at(-1)[1]({ requestRender() {} }, themed).render(120);
    assert.ok(foregrounds.some(([role, text]) => role === 'accent' && text.includes('█')));
    assert.ok(foregrounds.some(([role, text]) => role === 'muted' && text.includes('Saved')));
    assert.ok(bold.some((text) => text.includes('842.6K')));
  } finally { handlers.get('session_shutdown')({}, ctx); }
});

test('shows unavailable rather than fabricated metrics on failure or invalid JSON', async () => {
  for (const exec of [async () => { throw Error('missing'); }, async () => ({ code: 0, stdout: '{', stderr: '', killed: false }), async () => ({ code: 1, stdout: '', stderr: 'error', killed: false })]) {
    const { handlers, calls, ctx } = setup(exec);
    try {
      await handlers.get('session_start')({}, ctx);
      assert.match(render(calls.at(-1)).join(' '), /unavailable/i);
    } finally { handlers.get('session_shutdown')({}, ctx); }
  }
});

test('does not run in non-TUI mode or publish an in-flight result after shutdown', async () => {
  let resolve;
  const { handlers, calls, ctx } = setup(() => new Promise((r) => { resolve = r; }));
  await handlers.get('session_start')({}, { ...ctx, mode: 'print' });
  assert.equal(calls.length, 0);
  const pending = handlers.get('session_start')({}, ctx);
  handlers.get('session_shutdown')({}, ctx);
  resolve(result(summary));
  await pending;
  assert.equal(calls.length, 0);
});
