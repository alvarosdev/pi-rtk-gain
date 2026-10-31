const WIDGET_KEY = 'rtk-gain-widget';
const REFRESH_MS = 30_000;
function formatCount(value) {
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (let i = 0; i < units.length; i++) {
    let [scale, suffix] = units[i];
    if (value < scale) continue;
    let rounded = Math.round(value / scale * 10) / 10;
    if (rounded >= 1000 && i > 0) {
      [scale, suffix] = units[i - 1];
      rounded = Math.round(value / scale * 10) / 10;
    }
    return `${rounded}${suffix}`;
  }
  return String(value);
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours && `${hours}h`, (hours || minutes) && `${minutes}m`, `${remaining}s`].filter(Boolean).join(' ');
}

function renderSummary(stdout) {
  const { summary } = JSON.parse(stdout);
  const { avg_savings_pct: efficiency, total_saved: saved, total_time_ms: time, total_commands: commands } = summary ?? {};
  if (![efficiency, saved, time, commands].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
    throw new Error('Invalid RTK summary');
  }
  return { efficiency, saved: formatCount(saved), commands: formatCount(commands), time: formatDuration(time) };
}

function card(getSummary, theme) {
  return {
    invalidate() {},
    render(width) {
      const summary = getSummary();
      const cardWidth = Math.floor(width);
      if (cardWidth < 8) return [];
      // Match the prompt's floating treatment: transparent outer margins,
      // a themed background, and a single accent stripe rather than a frame.
      const textWidth = cardWidth - 4;
      let segments = [
        { text: 'RTK', role: 'accent', bold: true },
        { text: ' · Statistics unavailable', role: 'muted' },
      ];
      if (summary) {
        const percent = `${summary.efficiency.toFixed(2)}%`;
        const prefix = `RTK · Eff ${percent} `;
        const suffix = `  Saved ${summary.saved}  Cmds ${summary.commands}  Time ${summary.time}`;
        const barWidth = Math.max(0, textWidth - prefix.length - suffix.length);
        const units = Math.round(barWidth * Math.min(summary.efficiency, 100) / 100 * 8);
        const full = Math.floor(units / 8);
        const fraction = units % 8;
        const partial = fraction ? '▏▎▍▌▋▊▉'[fraction - 1] : '';
        segments = [
          { text: 'RTK', role: 'accent', bold: true },
          { text: ' · Eff ', role: 'muted' },
          { text: percent, role: 'text', bold: true },
          { text: ' ', role: 'text' },
          { text: '█'.repeat(full) + partial, role: 'accent' },
          { text: '░'.repeat(barWidth - full - (partial ? 1 : 0)), role: 'muted' },
          { text: '  Saved ', role: 'muted' },
          { text: summary.saved, role: 'text', bold: true },
          { text: '  Cmds ', role: 'muted' },
          { text: summary.commands, role: 'text', bold: true },
          { text: '  Time ', role: 'muted' },
          { text: summary.time, role: 'text', bold: true },
        ];
      }
      const length = segments.reduce((total, segment) => total + segment.text.length, 0);
      const truncated = length > textWidth;
      let remaining = truncated ? textWidth - 1 : textWidth;
      let styled = '';
      for (const segment of segments) {
        const text = segment.text.slice(0, remaining);
        remaining -= text.length;
        if (text) styled += theme.fg(segment.role, segment.bold && typeof theme.bold === 'function' ? theme.bold(text) : text);
        if (remaining === 0) break;
      }
      if (truncated) styled += theme.fg('muted', '…');
      else styled += ' '.repeat(remaining);
      const content = theme.fg('accent', '▎') + ' ' + styled;
      let painted = content;
      try { if (typeof theme.bg === 'function') painted = theme.bg('toolSuccessBg', content); } catch { /* Keep text visible without a background. */ }
      return [` ${theme.fg('border', '─'.repeat(cardWidth - 2))} `, ` ${painted} `];
    },
  };
}

export default function rtkGainWidget(pi) {
  let timer;
  let generation = 0;
  let inFlight;
  let widget;

  function stop() {
    generation++;
    if (timer) clearInterval(timer);
    timer = undefined;
    inFlight = undefined;
    widget = undefined;
  }

  function refresh(ctx) {
    if (inFlight) return inFlight;
    const current = generation;
    const currentWidget = widget;
    const task = (async () => {
      let summary;
      try {
        const result = await pi.exec('rtk', ['gain', '--project', '-f', 'json'], { cwd: ctx.cwd, timeout: 5000 });
        if (result.code !== 0 || result.killed) throw new Error('RTK failed');
        summary = renderSummary(result.stdout);
      } catch {
        summary = undefined;
      }
      if (current !== generation || !currentWidget) return;
      currentWidget.summary = summary;
      if (!currentWidget.mounted) {
        currentWidget.mounted = true;
        ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
          currentWidget.tui = tui;
          return card(() => currentWidget.summary, theme);
        }, { placement: 'belowEditor' });
      } else {
        currentWidget.tui?.requestRender();
      }
    })();
    inFlight = task;
    void task.finally(() => { if (inFlight === task) inFlight = undefined; });
    return task;
  }

  pi.on('session_start', async (_event, ctx) => {
    stop();
    if (ctx.mode !== 'tui') return;
    widget = { mounted: false, summary: undefined, tui: undefined };
    timer = setInterval(() => { void refresh(ctx); }, REFRESH_MS);
    await refresh(ctx);
  });
  pi.on('agent_settled', async (_event, ctx) => {
    if (ctx.mode === 'tui' && timer) await refresh(ctx);
  });
  pi.on('session_shutdown', () => { stop(); });
}
