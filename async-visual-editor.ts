import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, type EditorTheme, type TUI } from "@mariozechner/pi-tui";

type CancelOpenEditor = () => void;
type RegisterCancelOpenEditor = (cancel: CancelOpenEditor | undefined) => void;

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function waitForExit(child: ChildProcess): Promise<number | null> {
	return new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("exit", resolve);
	});
}

function showWaitingUI(ctx: ExtensionContext): { closed: Promise<void>; close: () => void } {
	let closeUI: () => void = () => {};

	const closed = ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
		closeUI = () => done();
		return {
			render(width: number): string[] {
				const innerWidth = Math.max(24, width - 2);
				const lines = [
					theme.fg("accent", theme.bold("Waiting for external editor")),
					"The editor is open outside pi's terminal pane.",
					"Press Escape to cancel.",
				];

				return [
					theme.fg("border", `╭${"─".repeat(innerWidth)}╮`),
					...lines.map((line) => {
						const content = truncateToWidth(line, innerWidth, "...", true).padEnd(innerWidth, " ");
						return `${theme.fg("border", "│")}${content}${theme.fg("border", "│")}`;
					}),
					theme.fg("border", `╰${"─".repeat(innerWidth)}╯`),
				];
			},
			handleInput(data: string): void {
				if (matchesKey(data, "escape")) closeUI();
			},
			invalidate(): void {},
		};
	});

	return { closed, close: () => closeUI() };
}

async function editText(
	ctx: ExtensionContext,
	initialText: string,
	registerCancelOpenEditor: RegisterCancelOpenEditor,
): Promise<string | undefined> {
	const command = process.env.VISUAL ?? process.env.EDITOR;
	if (!command) throw new Error("No editor configured. Set $VISUAL or $EDITOR.");

	const dir = await mkdtemp(join(tmpdir(), "pi-async-visual-editor-"));
	const file = join(dir, "prompt.md");

	try {
		await writeFile(file, initialText, "utf8");

		const waitingUI = showWaitingUI(ctx);
		const child = spawn(`${command} ${shellQuote(file)}`, { shell: true, stdio: "ignore" });
		registerCancelOpenEditor(() => {
			waitingUI.close();
			child.kill();
		});

		const exitCode = await Promise.race([waitForExit(child), waitingUI.closed.then(() => undefined)]);

		if (exitCode === undefined) {
			child.kill();
			return undefined;
		}

		waitingUI.close();
		await waitingUI.closed;

		if (exitCode !== 0) return undefined;
		return (await readFile(file, "utf8")).replace(/\n$/, "");
	} finally {
		registerCancelOpenEditor(undefined);
		await rm(dir, { recursive: true, force: true });
	}
}

class AsyncVisualEditor extends CustomEditor {
	private isEditorOpen = false;
	private readonly ctx: ExtensionContext;
	private readonly registerCancelOpenEditor: RegisterCancelOpenEditor;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		ctx: ExtensionContext,
		registerCancelOpenEditor: RegisterCancelOpenEditor,
	) {
		super(tui, theme, keybindings);
		this.ctx = ctx;
		this.registerCancelOpenEditor = registerCancelOpenEditor;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "ctrl+g")) {
			void this.openExternalEditor();
			return;
		}

		super.handleInput(data);
	}

	private async openExternalEditor(): Promise<void> {
		if (this.isEditorOpen) return;
		this.isEditorOpen = true;

		try {
			const editedText = await editText(this.ctx, this.getText(), this.registerCancelOpenEditor);
			if (editedText !== undefined) this.setText(editedText);
		} catch (error) {
			this.ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		} finally {
			this.isEditorOpen = false;
			this.tui.requestRender(true);
		}
	}
}

export default function (pi: ExtensionAPI) {
	let cancelOpenEditor: CancelOpenEditor | undefined;
	const registerCancelOpenEditor: RegisterCancelOpenEditor = (cancel) => {
		cancelOpenEditor = cancel;
	};

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) => new AsyncVisualEditor(tui, theme, keybindings, ctx, registerCancelOpenEditor),
		);
	});

	pi.on("session_shutdown", () => {
		cancelOpenEditor?.();
		cancelOpenEditor = undefined;
	});
}
