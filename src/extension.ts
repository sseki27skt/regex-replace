// src/extension.ts

import * as vscode from 'vscode';

const STORAGE_KEY = 'batchRegexReplaceRules';
const PREVIEW_KEY = 'batchRegexReplacePreview';

interface ReplaceRule {
	find: string;
	replace: string;
	flags: string;
}

// 拡張機能のメイン処理
export function activate(context: vscode.ExtensionContext) {

	// --- ハイライト処理のコアロジック ---

	let activeEditor = vscode.window.activeTextEditor;
	let timeout: NodeJS.Timeout | undefined = undefined;
	let decorationTypes: vscode.TextEditorDecorationType[] = [];
	
	const highlightColors = [
		'rgba(255, 215, 0, 0.3)', 'rgba(135, 206, 235, 0.3)',
		'rgba(144, 238, 144, 0.3)', 'rgba(255, 182, 193, 0.3)',
		'rgba(255, 165, 0, 0.3)',   'rgba(173, 216, 230, 0.3)',
	];

	function updateDecorations() {
		const editor = activeEditor;
		if (!editor) {
			return;
		}

		decorationTypes.forEach(decorationType => editor.setDecorations(decorationType, []));
		decorationTypes = [];

		const rules = context.globalState.get<ReplaceRule[]>(STORAGE_KEY, []);
		const text = editor.document.getText();
		
		rules.forEach((rule, index) => {
			if (!rule.find) { return; } // ★修正点: {}を追加

			const color = highlightColors[index % highlightColors.length];
			const decorationType = vscode.window.createTextEditorDecorationType({
				backgroundColor: color,
				border: `1px solid ${color.replace('0.3', '1')}`,
			});
			decorationTypes.push(decorationType);

			const decorations: vscode.DecorationOptions[] = [];
			
			try {
				// Respect flags stored in the rule. Ensure global flag for highlighting so all matches are found.
				const flags = rule.flags && rule.flags.length ? (rule.flags.includes('g') ? rule.flags : `${rule.flags}g`) : 'g';
				const regex = new RegExp(rule.find, flags);
				let match;
				while ((match = regex.exec(text))) {
					const startPos = editor.document.positionAt(match.index);
					const endPos = editor.document.positionAt(match.index + match[0].length);
					const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: `Rule #${index + 1}: /${rule.find}/` };
					decorations.push(decoration);
				}
				editor.setDecorations(decorationType, decorations);
			} catch (e) { /* 不正な正規表現は無視 */ }
		});

		// handle live-preview pattern from webview (stored in workspaceState)
		const preview = context.workspaceState.get<{ find: string; flags?: string }>(PREVIEW_KEY);
		if (preview && preview.find) {
			try {
				const pflags = preview.flags && preview.flags.length ? (preview.flags.includes('g') ? preview.flags : `${preview.flags}g`) : 'g';
				const previewRegex = new RegExp(preview.find, pflags);
				const previewDecorations: vscode.DecorationOptions[] = [];
				let m;
				while ((m = previewRegex.exec(text))) {
					const startPos = editor.document.positionAt(m.index);
					const endPos = editor.document.positionAt(m.index + m[0].length);
					previewDecorations.push({ range: new vscode.Range(startPos, endPos), hoverMessage: `Preview: /${preview.find}/` });
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
			timeout = setTimeout(updateDecorations, 500);
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
				currentText = currentText.replace(new RegExp(rule.find, rule.flags), rule.replace);
			}
		} catch(e) {
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

			switch (data.type) {
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
					<div>
						<label for="find-input">検索 (正規表現):</label>
						<input type="text" id="find-input" class="vscode-input" placeholder="例: /(hello|hi)/">
					</div>
					<div>
						<label for="replace-input">置換:</label>
						<input type="text" id="replace-input" class="vscode-input" placeholder="例: こんにちは">
					</div>
                    <div class="button-group">
                        <button id="add-rule-btn" class="vscode-button">ルールを追加</button>
                        <button id="cancel-edit-btn" class="vscode-button vscode-button--secondary" style="display: none;">キャンセル</button>
                    </div>
				</div>
				<button id="execute-btn" class="vscode-button vscode-button--secondary">現在のエディタで置換を実行</button>
				<ul id="rule-list"></ul>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}