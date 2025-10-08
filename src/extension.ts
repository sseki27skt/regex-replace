// src/extension.ts

import * as vscode from 'vscode';

const STORAGE_KEY = 'batchRegexReplaceRules';
const PREVIEW_KEY = 'batchRegexReplacePreview';

interface ReplaceRule {
	find: string;
	replace: string;
	flags: string;
	enabled?: boolean;
}

// 拡張機能のメイン処理
export function activate(context: vscode.ExtensionContext) {

	// --- ハイライト処理のコアロジック ---

	let activeEditor = vscode.window.activeTextEditor;
	let timeout: NodeJS.Timeout | undefined = undefined;
	let decorationTypes: vscode.TextEditorDecorationType[] = [];
	// Reusable map for rule -> decoration type to avoid creating many types repeatedly
	const decorationTypeMap: Map<number, vscode.TextEditorDecorationType> = new Map();

	const highlightColors = [
		'rgba(255, 215, 0, 0.3)', 'rgba(135, 206, 235, 0.3)',
		'rgba(144, 238, 144, 0.3)', 'rgba(255, 182, 193, 0.3)',
		'rgba(255, 165, 0, 0.3)', 'rgba(173, 216, 230, 0.3)',
	];

	function updateDecorations() {
		const editor = activeEditor;
		if (!editor) {
			return;
		}

		// Clear previous decorations and dispose types that are no longer used
		decorationTypes.forEach(decorationType => editor.setDecorations(decorationType, []));
		// do not dispose types here; we manage lifecycle in decorationTypeMap
		decorationTypes = [];

		const rules = context.globalState.get<ReplaceRule[]>(STORAGE_KEY, []);
		// Dispose decoration types that are no longer needed (e.g., rule was removed)
		for (const key of Array.from(decorationTypeMap.keys())) {
			if (key >= rules.length) {
				const dt = decorationTypeMap.get(key);
				if (dt) {
					dt.dispose();
					decorationTypeMap.delete(key);
				}
			}
		}
		// To reduce work on large files, only scan visible ranges (with a small margin)
		const visibleRanges = editor.visibleRanges.length ? editor.visibleRanges : [new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(0))];
		const margin = 5000; // characters to include before/after visible range to avoid missing context
		const docText = editor.document.getText();
		rules.forEach((rule, index) => {
			if (!rule.find || rule.enabled === false) { return; }

			const color = highlightColors[index % highlightColors.length];
			let decorationType = decorationTypeMap.get(index);
			if (!decorationType) {
				decorationType = vscode.window.createTextEditorDecorationType({
					backgroundColor: color,
					border: `1px solid ${color.replace('0.3', '1')}`,
				});
				decorationTypeMap.set(index, decorationType);
			}
			decorationTypes.push(decorationType);

			const decorations: vscode.DecorationOptions[] = [];
			try {
				const flags = rule.flags && rule.flags.length ? (rule.flags.includes('g') ? rule.flags : `${rule.flags}g`) : 'g';
				const regex = new RegExp(rule.find, flags);
				// scan only around visible ranges
				for (const vr of visibleRanges) {
					const startOffset = Math.max(0, editor.document.offsetAt(vr.start) - margin);
					const endOffset = Math.min(docText.length, editor.document.offsetAt(vr.end) + margin);
					const slice = docText.substring(startOffset, endOffset);
					let match;
					while ((match = regex.exec(slice))) {
						const globalIndex = startOffset + match.index;
						const startPos = editor.document.positionAt(globalIndex);
						const endPos = editor.document.positionAt(globalIndex + match[0].length);
						decorations.push({ range: new vscode.Range(startPos, endPos), hoverMessage: `Rule #${index + 1}: /${rule.find}/` });
						// avoid infinite loops for zero-length matches
						if (match.index === regex.lastIndex) { regex.lastIndex++; }
					}
				}
				editor.setDecorations(decorationType, decorations);
			} catch (e) { /* invalid regex - ignore */ }
		});

		// handle live-preview pattern from webview (stored in workspaceState)
		const preview = context.workspaceState.get<{ find: string; flags?: string }>(PREVIEW_KEY);
		if (preview && preview.find) {
			try {
				const pflags = preview.flags && preview.flags.length ? (preview.flags.includes('g') ? preview.flags : `${preview.flags}g`) : 'g';
				const previewRegex = new RegExp(preview.find, pflags);
				const previewDecorations: vscode.DecorationOptions[] = [];
				let matchCount = 0;
				const maxMatches = 500; // limit number of preview highlights

				for (const vr of visibleRanges) {
					const startOffset = Math.max(0, editor.document.offsetAt(vr.start) - margin);
					const endOffset = Math.min(docText.length, editor.document.offsetAt(vr.end) + margin);
					const slice = docText.substring(startOffset, endOffset);
					let m;
					while ((m = previewRegex.exec(slice))) {
						// avoid zero-length match infinite loop
						if (m[0].length === 0) {
							if (previewRegex.lastIndex >= slice.length) { break; }
							previewRegex.lastIndex++;
							continue;
						}
						const globalIndex = startOffset + m.index;
						const startPos = editor.document.positionAt(globalIndex);
						const endPos = editor.document.positionAt(globalIndex + m[0].length);
						previewDecorations.push({ range: new vscode.Range(startPos, endPos), hoverMessage: `Preview: /${preview.find}/` });
						matchCount++;
						if (matchCount >= maxMatches) {
							vscode.window.showInformationMessage(`多数のマッチが見つかったため、最初の${maxMatches}件のみハイライトしました。`);
							break;
						}
					}
					if (matchCount >= maxMatches) { break; }
				}
				// create a distinct decoration type for preview (more prominent)
				const previewDecorationType = vscode.window.createTextEditorDecorationType({
					backgroundColor: 'rgba(255, 235, 59, 0.35)',
					border: '1px dashed rgba(255, 193, 7, 0.9)'
				});
				decorationTypes.push(previewDecorationType);
				editor.setDecorations(previewDecorationType, previewDecorations);
			} catch (e) { /* invalid preview regex - ignore silently */ }
		}
	}

	function triggerUpdateDecorations(throttle = false) {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		if (throttle) {
			timeout = setTimeout(updateDecorations, 3000);
		} else {
			updateDecorations();
		}
	}

	if (activeEditor) {
		triggerUpdateDecorations();
	}

	vscode.window.onDidChangeActiveTextEditor(editor => {
		activeEditor = editor;
		if (editor) {
			triggerUpdateDecorations();
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		if (activeEditor && event.document === activeEditor.document) {
			triggerUpdateDecorations(true);
		}
	}, null, context.subscriptions);

	const internalUpdateCommand = vscode.commands.registerCommand('_batch-regex-replace.updateDecorations', () => {
		triggerUpdateDecorations();
	});
	context.subscriptions.push(internalUpdateCommand);

	const provider = new RuleWebviewViewProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(RuleWebviewViewProvider.viewType, provider));

	const executeCommand = vscode.commands.registerCommand('batch-regex-replace.execute', async () => {
		const rules = context.globalState.get<ReplaceRule[]>(STORAGE_KEY, []);
		if (rules.length === 0) {
			vscode.window.showWarningMessage('実行するルールがありません。');
			return;
		}
		const editor = vscode.window.activeTextEditor;
		if (!editor) { return; } // ★修正点: {}を追加

		let currentText = editor.document.getText();
		try {
			for (const rule of rules) {
				if (rule.enabled === false) { continue; }
				currentText = currentText.replace(new RegExp(rule.find, rule.flags), rule.replace);
			}
		} catch (e) {
			vscode.window.showErrorMessage('正規表現の処理中にエラーが発生しました。');
			return;
		}
		const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));
		await editor.edit(editBuilder => editBuilder.replace(fullRange, currentText));
		vscode.window.showInformationMessage(`${rules.length}件のルールで一括置換を実行しました。`);
	});
	context.subscriptions.push(executeCommand);
}


class RuleWebviewViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'regexRuleView';
	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext,
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async data => {
			// handle copy requests from webview
			if (data.type === 'copyRule') {
				const idx = data.index;
				const rules = this._context.globalState.get<ReplaceRule[]>(STORAGE_KEY, []);
				if (typeof idx === 'number' && rules[idx]) {
					const r = rules[idx];
					const text = `find: ${r.find}\nreplace: ${r.replace}\nflags: ${r.flags || ''}`;
					try {
						await vscode.env.clipboard.writeText(text);
						vscode.window.showInformationMessage(`ルール #${idx + 1} をクリップボードにコピーしました。`);
					} catch (e) {
						vscode.window.showErrorMessage('クリップボードへのコピーに失敗しました。');
					}
				}
				return;
			}
			if (data.type === 'copyAllRules') {
				const rules = this._context.globalState.get<ReplaceRule[]>(STORAGE_KEY, []);
				if (!rules || rules.length === 0) {
					vscode.window.showInformationMessage('コピーするルールがありません。');
					return;
				}
				const text = rules.map((r, i) => `${i + 1}:\nfind: ${r.find}\nreplace: ${r.replace}\nflags: ${r.flags || ''}`).join('\n\n');
				try {
					await vscode.env.clipboard.writeText(text);
					vscode.window.showInformationMessage(`${rules.length}件のルールをクリップボードにコピーしました。`);
				} catch (e) {
					vscode.window.showErrorMessage('クリップボードへのコピーに失敗しました。');
				}
				return;
			}

			if (data.type === 'duplicateRule') {
				const idx = data.index;
				const rules = this._context.globalState.get<ReplaceRule[]>(STORAGE_KEY, []);
				if (typeof idx === 'number' && rules[idx]) {
					const copy = { ...rules[idx] };
					const newRules = [...rules];
					newRules.splice(idx + 1, 0, copy);
					await this._context.globalState.update(STORAGE_KEY, newRules);
					vscode.window.showInformationMessage(`ルール #${idx + 1} を複製しました。`);
					this.updateRuleList();
					vscode.commands.executeCommand('_batch-regex-replace.updateDecorations');
				}
				return;
			}

			if (data.type === 'moveRule') {
				const from = data.from;
				const to = data.to;
				const rules = this._context.globalState.get<ReplaceRule[]>(STORAGE_KEY, []);
				if (typeof from === 'number' && typeof to === 'number' && rules[from]) {
					const newRules = [...rules];
					const [moved] = newRules.splice(from, 1);
					// insert before the target index; if from < to, adjust index because of removal
					const insertIndex = from < to ? to : to;
					newRules.splice(insertIndex, 0, moved);
					await this._context.globalState.update(STORAGE_KEY, newRules);
					this.updateRuleList();
					vscode.commands.executeCommand('_batch-regex-replace.updateDecorations');
				}
				return;
			}
			const rules = this._context.globalState.get<ReplaceRule[]>(STORAGE_KEY, []);
			let newRules: ReplaceRule[];

			// preview messages from webview
			if (data.type === 'preview') {
				// validate preview pattern and inform webview if invalid
				try {
					new RegExp(data.find, data.flags || 'g');
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					this._view?.webview.postMessage({ type: 'previewInvalid', message: msg });
					return;
				}
				await this._context.workspaceState.update(PREVIEW_KEY, { find: data.find, flags: data.flags });
				vscode.commands.executeCommand('_batch-regex-replace.updateDecorations');
				return;
			}
			if (data.type === 'clearPreview') {
				await this._context.workspaceState.update(PREVIEW_KEY, undefined);
				vscode.commands.executeCommand('_batch-regex-replace.updateDecorations');
				return;
			}

			// (named sets feature removed)

			switch (data.type) {
				case 'enableRule':
					{
						const idx = data.index;
						const current = this._context.globalState.get<ReplaceRule[]>(STORAGE_KEY, []);
						if (typeof idx === 'number' && current[idx]) {
							current[idx].enabled = true;
							await this._context.globalState.update(STORAGE_KEY, current);
						}
					}
					break;
				case 'disableRule':
					{
						const idx = data.index;
						const current = this._context.globalState.get<ReplaceRule[]>(STORAGE_KEY, []);
						if (typeof idx === 'number' && current[idx]) {
							current[idx].enabled = false;
							await this._context.globalState.update(STORAGE_KEY, current);
						}
					}
					break;
				case 'getRules':
					this.updateRuleList();
					return;
				case 'addRule':
					{
						const flags = data.flags || 'g';
						// validate regex
						try {
							new RegExp(data.find, flags);
						} catch (e) {
							vscode.window.showErrorMessage('追加しようとしたルールの正規表現が無効です。');
							this._view?.webview.postMessage({ type: 'validationError', message: '追加しようとしたルールの正規表現が無効です。' });
							return;
						}
						newRules = [...rules, { find: data.find, replace: data.replace, flags }];
						await this._context.globalState.update(STORAGE_KEY, newRules);
					}
					break;
				case 'deleteRule':
					newRules = rules.filter((_, i) => i !== data.index);
					await this._context.globalState.update(STORAGE_KEY, newRules);
					break;
				case 'moveRuleUp':
					if (data.index > 0) {
						newRules = [...rules];
						[newRules[data.index], newRules[data.index - 1]] = [newRules[data.index - 1], newRules[data.index]];
						await this._context.globalState.update(STORAGE_KEY, newRules);
					}
					break;
				case 'moveRuleDown':
					if (data.index < rules.length - 1) {
						newRules = [...rules];
						[newRules[data.index], newRules[data.index + 1]] = [newRules[data.index + 1], newRules[data.index]];
						await this._context.globalState.update(STORAGE_KEY, newRules);
					}
					break;
				case 'requestEditRule': {
					const ruleToEdit = rules[data.index];
					if (ruleToEdit) {
						this._view?.webview.postMessage({ type: 'editRule', index: data.index, rule: ruleToEdit });
					}
					return;
				}
				case 'saveRule':
					{
						const rule = data.rule as ReplaceRule;
						const flags = rule.flags || 'g';
						try {
							new RegExp(rule.find, flags);
						} catch (e) {
							vscode.window.showErrorMessage('保存しようとしたルールの正規表現が無効です。');
							this._view?.webview.postMessage({ type: 'validationError', message: '保存しようとしたルールの正規表現が無効です。' });
							return;
						}
						newRules = [...rules];
						newRules[data.index] = { find: rule.find, replace: rule.replace, flags };
						await this._context.globalState.update(STORAGE_KEY, newRules);
					}
					break;
				case 'executeReplace':
					vscode.commands.executeCommand('batch-regex-replace.execute');
					return;
			}

			this.updateRuleList();
			vscode.commands.executeCommand('_batch-regex-replace.updateDecorations');
		});

		this.updateRuleList();
	}

	public updateRuleList() {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'updateRules',
				rules: this._context.globalState.get<ReplaceRule[]>(STORAGE_KEY, [])
			});
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));

		return `<!DOCTYPE html>
			<html lang="ja">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<title>一括置換ルール</title>
			</head>
			<body>
				<div class="input-container">
					<div class="input-line">
						<input type="text" id="find-input" class="vscode-input" placeholder="検索">
					</div>
					<div class="input-line">
						<input type="text" id="replace-input" class="vscode-input" placeholder="置換">
					</div>
	                    <div class="button-group">
	                        <button id="add-rule-btn" class="vscode-button">ルールを追加</button>
	                        <button id="cancel-edit-btn" class="vscode-button vscode-button--secondary" style="display: none;">キャンセル</button>
	                    </div>
				</div>
				<div style="margin-bottom:8px;">
					<button id="execute-btn" class="vscode-button vscode-button--secondary">現在のエディタで置換を実行</button>
				</div>
				<details id="search-panel" style="margin-bottom:12px;">
					<summary>ルール検索</summary>
					<div style="display:flex; gap:8px; align-items:center; margin-top:8px;">
						<input type="search" id="rule-search" class="vscode-input" placeholder="ルールを検索 (find/replace/flags)" />
						<button id="clear-search-btn" class="vscode-button">クリア</button>
					</div>
				</details>
				<ul id="rule-list"></ul>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}