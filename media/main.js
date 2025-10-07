/* media/main.js */

(function() {
    const vscode = acquireVsCodeApi();

    const findInput = document.getElementById('find-input');
    const replaceInput = document.getElementById('replace-input');
    const addRuleBtn = document.getElementById('add-rule-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const executeBtn = document.getElementById('execute-btn');
    const ruleList = document.getElementById('rule-list');

    let editingIndex = -1;

    function enterEditMode(index, rule) {
        findInput.value = rule.find;
        replaceInput.value = rule.replace;
        addRuleBtn.textContent = 'ルールを更新';
        cancelEditBtn.style.display = 'inline-block';
        editingIndex = index;
        findInput.focus();
    }

    function exitEditMode() {
        findInput.value = '';
        replaceInput.value = '';
        addRuleBtn.textContent = 'ルールを追加';
        cancelEditBtn.style.display = 'none';
        editingIndex = -1;
    }

    addRuleBtn.addEventListener('click', () => {
        const findValue = findInput.value;
        const replaceValue = replaceInput.value;

        if (findValue) {
            if (editingIndex > -1) {
                vscode.postMessage({
                    type: 'saveRule',
                    index: editingIndex,
                    rule: { find: findValue, replace: replaceValue, flags: 'g' }
                });
            } else {
                vscode.postMessage({
                    type: 'addRule',
                    find: findValue,
                    replace: replaceValue
                });
            }
            exitEditMode();
        }
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

            li.innerHTML = `
                <div class="rule-content">
                    <span class="rule-find" title="Find: /${rule.find}/${rule.flags}">Find: /${rule.find}/${rule.flags}</span>
                    <span class="rule-replace" title="Replace: '${rule.replace}'">Replace: '${rule.replace}'</span>
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