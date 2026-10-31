# RTK Gain Widget

A Pi extension that displays RTK statistics for the current project below the editor.
It shows efficiency, tokens saved, command count, and total command execution time.

## Requirements

- Pi with the `setWidget` extension API.
- `rtk` available on the PATH of the Pi process, with support for `gain --project -f json`.

## Try it

Launch from the project you want to monitor:

```sh
pi -e /home/alvarog/dev/rtk-gain-widget/index.js
```

For a persistent installation into the active Pi agent home, use:

```sh
pi install /home/alvarog/dev/rtk-gain-widget
```

Restart or reload the relevant session after installation. A local package is loaded from this directory, not copied, so keep it in place. No existing Pi files need to be patched.

## Behavior

The borderless widget uses the active Pi theme, a floating background, an accent stripe, colored labels and bold values. It shows an efficiency meter and the metrics on one line, expanding to the available width. Counts use technical units K (1,000), M (1,000,000), and B (1,000,000,000), rounded to one decimal place when abbreviated. On very narrow terminals, the row is truncated rather than wrapped. The extension executes `rtk gain --project -f json` with the session's project directory as its working directory. It refreshes on session start, after an agent run settles, and every 30 seconds while the session is open. It keeps the same widget instance across refreshes so those refreshes do not reorder it relative to other widgets. The initial order still depends on when each extension mounts, and another extension can change the order by remounting its own widget. RTK defines project membership and the underlying metrics; total execution time is the sum reported by RTK, not session elapsed time. If RTK cannot run or returns invalid data, the widget displays `Statistics unavailable`. It does not run in non-interactive modes.

## Test

```sh
node --test test/*.test.js
```
