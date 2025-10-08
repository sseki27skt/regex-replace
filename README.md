# Batch Regex Replace (一括正規表現置換)

This Visual Studio Code extension provides a compact sidebar UI to manage multiple regex-based search-and-replace rules and apply them to the active editor.

---

## 日本語 — 概要

この拡張機能は、複数の正規表現ルールを作成・管理し、現在アクティブなエディタに対して一括置換を実行できるツールです。主な特徴は以下の通りです。

- サイドバー内の専用 UI でルールの追加・編集・削除・並べ替えが可能。
- ライブプレビュー: 検索入力中にアクティブなエディタ内のマッチ箇所をハイライトします（プレビューは入力のバリデーションを行い、無効な正規表現はインラインでエラーメッセージを表示します）。
- ルールごとの有効/無効切替（チェックボックス）により、一時的にルールを無効化できます。無効なルールはハイライト・置換処理の対象外になります。
- 置換実行は保存されたルールを上から順に現在のファイルに適用します。

注意: 以前にあった「ルールセットの保存／インポート／エクスポート」機能は撤回されています（実装されていません）。

### 使い方（簡潔）

1. 左のアクティビティバーで「一括置換ルール」ビューを開く。
2. `検索 (正規表現)` と `置換` に入力し、「ルールを追加」を押す。
3. ルールがリストに追加され、エディタ上でマッチ箇所がハイライトされる。
4. ルールを無効化したい場合、リストのチェックボックスをオフにする。
5. 「現在のエディタで置換を実行」ボタンで置換を適用。

### コマンド

コマンドパレットから利用可能なコマンド:

- `batch-regex-replace.execute` — 現在のエディタに対して全ルールを適用します。

---

## English — Overview

This extension provides a sidebar UI to manage regex search-and-replace rules and apply them to the active editor.

Key features:

- Add / edit / delete / reorder rules in the sidebar.
- Live preview: while typing a search pattern, matches in the active editor are highlighted. Invalid regex input is detected and an inline error message is shown in the sidebar preview area.
- Per-rule enable/disable toggle (checkbox). Disabled rules are ignored by both highlighting and execution.
- Apply all saved rules to the active file in order with a single command.

Note: The previous idea to provide named rule set save/load/import/export has been removed and is not available in this version.

### Quick usage

1. Open the "Regex Replace" view from the activity bar.
2. Enter the search (regex) and replacement strings and click "Add Rule".
3. Observe highlighted matches in the active editor while typing.
4. Toggle a rule off to temporarily exclude it from preview and execution.
5. Use the "Apply to current editor" button or run `batch-regex-replace.execute` to perform the replacements.

### Command

- `batch-regex-replace.execute` — Apply all rules to the active editor.

---

## Development / Notes

- The extension stores rules in the extension global state. Rules include: `find` (pattern), `replace` (string), `flags` (RegExp flags), and `enabled` (boolean).
- Live preview is implemented via messages from the webview to the extension which validates the regex and updates decorations in the active editor.
- If you want re-introduce export/import or named sets, we can add a safe implementation that either downloads JSON from the webview or uses VS Code's save dialog.

## License

MIT

---

## 詳細: 入力形式・フラグ・挙動

- 検索パターンはプレーンな正規表現文字列、または `/pattern/flags` の形式で入力できます。例: `/foo/i` や `\bword\b`。
- プレビューでは自動的に global フラグ (`g`) が付与されて全マッチをハイライトします。ルール保存時は `flags` を保存して実行時にも使用します。
- 置換の適用は現在の実装では「上から順にルールを適用」します。あるルールによる置換が次のルールのマッチ対象に影響する点に注意してください。

## よくある問題と対処

- 無効な正規表現が入力された
	- サイドバーにインラインでエラーメッセージが表示され、プレビューと保存は行われません。正規表現の構文を確認してください。
- 大きなファイルでプレビューが遅い／負荷が高い
	- プレビューはデバウンスされていますが、非常に大きなファイルや複雑な正規表現では処理に時間がかかります。必要ならデバウンス間隔を長くするか、プレビューをオフにするオプションを検討してください。
- 期待通りに置換されない（順序の問題）
	- ルールは上から順に適用されます。置換の相互作用がある場合はルールの並び替えを調整してください。

---

## Troubleshooting / FAQ (English)

- Invalid regular expression
	- If the search input is not a valid RegExp, an inline message appears in the sidebar and preview/save will be blocked. Fix the regex syntax.
- Preview is slow on very large files
	- Preview is debounced but may still be expensive for very large files or complex patterns. Consider increasing the debounce timeout or disabling live preview for such files.
- Replacements not matching expectations (order effects)
	- Rules are applied in order. If one rule affects the text that later rules match, adjust the rule order accordingly.

---

## Developer guide / Build & Debug

Quick steps to build and run locally:

1. Install dependencies:

```bash
npm install
```

2. Compile TypeScript:

```bash
npm run compile
```

3. Run the extension in the Extension Development Host (press F5 in VS Code).

4. Tests (if present) can be run with:

```bash
npm test
```

Notes for contributors:

- Code lives in `src/` and compiles to `out/`.
- Webview assets are in `media/`.
- Keep the webview messages and their handlers in sync when modifying the UI.

---

If you'd like, I can also add screenshots, a quick GIF demonstrating live preview + toggle, and a short examples section showing typical regex patterns and expected replacement results.