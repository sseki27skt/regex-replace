/* media/main.js */

(function() {
    const vscode = acquireVsCodeApi();

    const findInput = document.getElementById('find-input');
    const replaceInput = document.getElementById('replace-input');
    const addRuleBtn = document.getElementById('add-rule-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const executeBtn = document.getElementById('execute-btn');
    const ruleList = document.getElementById('rule-list');

    // inline message area for validation/preview errors
    let messageArea = document.getElementById('message-area');
    if (!messageArea) {
        messageArea = document.createElement('div');
        messageArea.id = 'message-area';
        messageArea.style.marginTop = '8px';
        messageArea.style.color = 'var(--vscode-inputValidation-errorForeground)';
        messageArea.style.fontSize = '0.9em';
    }

    let editingIndex = -1;

    function enterEditMode(index, rule) {
        findInput.value = rule.find;
        replaceInput.value = rule.replace;
        addRuleBtn.textContent = 'ルールを更新';
        cancelEditBtn.style.display = 'inline-block';
        editingIndex = index;
        findInput.focus();
        // send preview for current rule being edited
        if (messageArea && messageArea.parentNode === null) {
            const inputContainer = document.querySelector('.input-container');
            if (inputContainer) { inputContainer.appendChild(messageArea); }
        }
        vscode.postMessage({ type: 'preview', find: rule.find, flags: rule.flags });
    }

    function exitEditMode() {
        findInput.value = '';
        replaceInput.value = '';
        addRuleBtn.textContent = 'ルールを追加';
        cancelEditBtn.style.display = 'none';
        editingIndex = -1;
        // clear preview when exiting edit mode
        vscode.postMessage({ type: 'clearPreview' });
    }

    addRuleBtn.addEventListener('click', () => {
        const rawFind = findInput.value.trim();
        const replaceValue = replaceInput.value;

        if (rawFind) {
            // parse /pattern/flags or plain pattern
            let pattern = rawFind;
            let flags = 'g';
            const m = rawFind.match(/^\/(.*)\/(\w*)$/);
            if (m) {
                pattern = m[1];
                flags = m[2] || 'g';
            }

            if (editingIndex > -1) {
                vscode.postMessage({
                    type: 'saveRule',
                    index: editingIndex,
                    rule: { find: pattern, replace: replaceValue, flags }
                });
            } else {
                vscode.postMessage({
                    type: 'addRule',
                    find: pattern,
                    replace: replaceValue,
                    flags: flags
                });
            }
            exitEditMode();
        }
    });

    // live preview while typing
    let previewTimer = null;
    findInput.addEventListener('input', () => {
        const raw = findInput.value.trim();
        if (!raw) {
            vscode.postMessage({ type: 'clearPreview' });
            return;
        }
        // parse same as on submit
        const m = raw.match(/^\/(.*)\/(\w*)$/);
        const pattern = m ? m[1] : raw;
        const flags = m ? (m[2] || 'g') : 'g';

        // throttle preview messages
        if (previewTimer) {
            clearTimeout(previewTimer);
        }
        previewTimer = setTimeout(() => {
            // clear any previous inline message when sending a new preview
            if (messageArea) { messageArea.textContent = ''; }
            if (messageArea && messageArea.parentNode === null) {
                const inputContainer = document.querySelector('.input-container');
                if (inputContainer) { inputContainer.appendChild(messageArea); }
            }
            vscode.postMessage({ type: 'preview', find: pattern, flags });
        }, 150);
    });

    cancelEditBtn.addEventListener('click', () => {
        exitEditMode();
    });
    
    executeBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'executeReplace' });
    });

    ruleList.addEventListener('dblclick', (e) => {
        const li = e.target.closest('.rule-item');
        if (li) {
            const index = parseInt(li.dataset.index, 10);
            vscode.postMessage({ type: 'requestEditRule', index });
        }
    });

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'updateRules':
                updateRuleList(message.rules);
                break;
            case 'editRule':
                enterEditMode(message.index, message.rule);
                break;
            case 'previewInvalid':
                if (messageArea && messageArea.parentNode === null) {
                    const inputContainer = document.querySelector('.input-container');
                    if (inputContainer) { inputContainer.appendChild(messageArea); }
                }
                if (messageArea) { messageArea.textContent = `Preview error: ${message.message}`; }
                break;
            case 'validationError':
                if (messageArea && messageArea.parentNode === null) {
                    const inputContainer = document.querySelector('.input-container');
                    if (inputContainer) { inputContainer.appendChild(messageArea); }
                }
                if (messageArea) { messageArea.textContent = `Error: ${message.message}`; }
                break;
        }
    });
        vscode.postMessage({ type: 'getRules' });


    function updateRuleList(rules) {
        ruleList.innerHTML = '';
        if (rules.length === 0) {
            ruleList.innerHTML = '<li class="rule-item" style="justify-content: center; color: var(--vscode-descriptionForeground);">ルールがありません。</li>';
            return;
        }

        rules.forEach((rule, index) => {
            const li = document.createElement('li');
            li.className = 'rule-item';
            li.dataset.index = index;

            // minimal escape for display
            const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const displayFind = escapeHtml(rule.find);
            const displayReplace = escapeHtml(rule.replace);
            const displayFlags = escapeHtml(rule.flags || '');

            li.innerHTML = `
                <div class="rule-content">
                    <span class="rule-find" title="Find: /${displayFind}/${displayFlags}">Find: /${displayFind}/${displayFlags}</span>
                    <span class="rule-replace" title="Replace: '${displayReplace}'">Replace: '${displayReplace}'</span>
                </div>
                <div class="rule-actions">
                    <button class="action-btn up-btn" data-index="${index}" title="上に移動">↑</button>
                    <button class="action-btn down-btn" data-index="${index}" title="下に移動">↓</button>
                    <button class="action-btn delete-btn" data-index="${index}" title="削除">✕</button>
                </div>
            `;
            ruleList.appendChild(li);
        });

        document.querySelectorAll('.delete-btn, .up-btn, .down-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(e.currentTarget.dataset.index, 10);
                const type = e.currentTarget.classList.contains('delete-btn') ? 'deleteRule' :
                             e.currentTarget.classList.contains('up-btn') ? 'moveRuleUp' : 'moveRuleDown';
                vscode.postMessage({ type, index });
            });
        });
    }
   window.addEventListener('keydown', (event) => {
    // Escapeキーが押され、かつ編集モードのときにキャンセル処理を呼ぶ
    if (event.key === 'Escape' && editingIndex > -1) {
        exitEditMode();
    }
});
}());