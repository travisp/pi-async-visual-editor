# pi async visual editor

A very simple pi extension that makes `Ctrl+G` open your external editor asynchronously.

Pi's built-in `Ctrl+G` opens `$VISUAL`/`$EDITOR`, but it stops pi's TUI until the editor exits. That is fine for an editor running in the same terminal pane. It is awkward for GUI editors, cmux splits, tmux popups, or anything else that opens outside pi's pane: pi cannot redraw while you are editing, so resizing the terminal can leave pi hard to read.

This extension keeps pi active while your editor is open. It uses pi's built-in editor component and replaces only the `Ctrl+G` external-editor handler with an async version. When you press `Ctrl+G`, pi still hands the current input to `$VISUAL` or `$EDITOR` as a temporary Markdown file and reads the file back after the editor exits successfully. The difference is that pi stays alive and shows a boxed waiting message while the editor is open.

Use this with editors that open outside pi's terminal pane and wait until editing is complete, such as `code --wait`, `zed --wait`, a cmux split wrapper, or a terminal multiplexer popup.

Do not use this with plain same-pane `vim`/`nano`. Those editors need to control the same terminal pi is using, and pi's built-in `Ctrl+G` is the better fit for that case.

## Install from GitHub

Install globally:

```bash
pi install git:github.com/travisp/pi-async-visual-editor
```

Try it for one pi run without installing:

```bash
pi -e git:github.com/travisp/pi-async-visual-editor
```

## Usage

Set `VISUAL` or `EDITOR` to a command that waits until editing is complete, then start pi.

For VS Code:

```bash
VISUAL="code --wait"
```

For Zed:

```bash
VISUAL="zed --wait"
```

You can also write a wrapper script to open a pane to the right in your favorite terminal emulator (ask pi for help).

Then press `Ctrl+G` in pi.

The editor command receives the temporary Markdown file path as its final argument. If the command exits with status `0`, the file content replaces pi's current input. If it exits with a non-zero status, pi leaves the input unchanged.

While the editor is open, pi shows a boxed waiting message. Press Escape in pi to cancel waiting and kill the spawned editor process if possible. Some (most?) GUI editors may keep their app window open after the CLI process is killed.
