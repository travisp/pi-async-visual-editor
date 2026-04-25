# pi async-visual-editor

A pi extension that replaces `Ctrl+G` with an async external-editor flow.

## Why?

Pi's built-in `Ctrl+G` stops the TUI while `$VISUAL` or `$EDITOR` runs. If you are using an external editor and opening it results in pi getting resized, then pi will no longer be legible because the TUI won't redraw. For my editor, I have used both the Aerospace window tiling manager with a GUI text editor (which will automatically resize my pi terminal) and also used a cmux wrapper that opens vim in a pane to the right. In both of those cases, I lose my ability to scroll through pi while I'm typing my prompt.

This extension keeps pi alive, shows a waiting UI, starts the editor asynchronously, and loads the edited file back into pi's input when the editor exits successfully.

Use this with editors or wrapper scripts that open outside pi's own terminal pane, such as a GUI editor or a cmux split. Do not use plain same-pane `vim`; it may compete with pi for the same terminal, and there's really no purpose for this extension if that's what you are doing.

## Usage

Set `VISUAL` or `EDITOR` to a command that waits until editing is complete:

```bash
VISUAL="code --wait"
```

Then press `Ctrl+G` in pi.

The command receives the temporary Markdown file path as its final argument. If it exits with status `0`, the file content replaces pi's current input. Non-zero exits leave pi's input unchanged.

While the editor is open, pi shows a boxed waiting message. Press Escape in pi to cancel and kill the editor process (if possible).
