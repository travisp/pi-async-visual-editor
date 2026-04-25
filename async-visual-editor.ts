import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CustomEditor, type ExtensionAPI, type ExtensionCommandContext, type KeybindingsManager } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, type EditorTheme, type TUI } from "@mariozechner/pi-tui";

type WaitingResult = "escape" | "done";
type ActiveEditor = {
	child?: ChildProcess;
	dismissWaitingUI?: () => void;
};

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function startCommand(command: string): { child: ChildProcess; exit: Promise<number | null> } {
	const child = spawn(command, { shell: true, stdio: "ignore" });
	const exit = new Promise<number | null>((resolve, reject) => {
		child.on("error", reject);
		child.on("exit", resolve);
	});
	return { child, exit };
}

function showWaitingUI(ctx: ExtensionCommandContext): { promise: Promise<WaitingResult>; dismiss: () => void } {
	let finish: (result: WaitingResult) => void = () => {};

	const promise = ctx.ui.custom<WaitingResult>((_tui, theme, _keybindings, done) => {
		finish = done;
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
				if (matchesKey(data, "escape")) finish("escape");
			},
			invalidate(): void {},
		};
	});

	return { promise, dismiss: () => finish("done") };
}

async function editText(
	ctx: ExtensionCommandContext,
	command: string,
	initialText: string,
	activeEditor: ActiveEditor,
): Promise<string | undefined> {
	const dir = await mkdtemp(join(tmpdir(), "pi-async-visual-editor-"));
	const file = join(dir, "prompt.md");

	try {
		await writeFile(file, initialText, "utf8");

		const waitingUI = showWaitingUI(ctx);
		const { child, exit } = startCommand(`${command} ${shellQuote(file)}`);
		activeEditor.child = child;
		activeEditor.dismissWaitingUI = waitingUI.dismiss;

		const result = await Promise.race([
			exit.then((code) => ({ type: "editor" as const, code })),
			waitingUI.promise.then((reason) => ({ type: "ui" as const, reason })),
		]);

		if (result.type === "ui") {
			if (result.reason === "escape") child.kill();
			return undefined;
		}

		waitingUI.dismiss();
		await waitingUI.promise;

		if (result.code !== 0) return undefined;
		return (await readFile(file, "utf8")).replace(/\n$/, "");
	} finally {
		activeEditor.child = undefined;
		activeEditor.dismissWaitingUI = undefined;
		await rm(dir, { recursive: true, force: true });
	}
}

class AsyncVisualEditor extends CustomEditor {
	private isEditorOpen = false;

	constructor(
		private readonly tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly openEditor: (text: string) => Promise<string | undefined>,
		private readonly showError: (message: string) => void,
	) {
		super(tui, theme, keybindings);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "ctrl+g")) {
			void this.handleExternalEditor();
			return;
		}

		super.handleInput(data);
	}

	private async handleExternalEditor(): Promise<void> {
		if (this.isEditorOpen) return;
		this.isEditorOpen = true;

		try {
			const editedText = await this.openEditor(this.getText());
			if (editedText !== undefined) this.setText(editedText);
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		} finally {
			this.isEditorOpen = false;
			this.tui.requestRender(true);
		}
	}
}

export default function (pi: ExtensionAPI) {
	const activeEditor: ActiveEditor = {};

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) =>
				new AsyncVisualEditor(
					tui,
					theme,
					keybindings,
					(text) => {
						const command = process.env.VISUAL || process.env.EDITOR;
						if (!command) throw new Error("No editor configured. Set $VISUAL or $EDITOR.");
						return editText(ctx, command, text, activeEditor);
					},
					(message) => ctx.ui.notify(message, "error"),
				),
		);
	});

	pi.on("session_shutdown", () => {
		activeEditor.dismissWaitingUI?.();
		activeEditor.child?.kill();
		activeEditor.dismissWaitingUI = undefined;
		activeEditor.child = undefined;
	});
}
