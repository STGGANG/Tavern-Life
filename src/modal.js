const stack = [];

function onKey(e) {
    if (e.key !== 'Escape' || !stack.length) return;
    // 실리태번 확인 창(dialog)이 위에 떠 있으면 그쪽이 먼저 닫히게
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    e.stopPropagation();
    stack[stack.length - 1].close();
}

export function openModal({ content, className = '', label = '' }) {
    const overlay = document.createElement('div');
    overlay.className = `tlr-ui tlr-overlay ${className}`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    if (label) overlay.setAttribute('aria-label', label);
    overlay.appendChild(content);

    let resolve;
    const closed = new Promise(r => { resolve = r; });
    let done = false;
    const prevFocus = document.activeElement;

    const close = () => {
        if (done) return;
        done = true;
        const i = stack.indexOf(handle);
        if (i >= 0) stack.splice(i, 1);
        if (!stack.length) document.removeEventListener('keydown', onKey, true);
        overlay.classList.add('tlr-overlay-out');
        let removed = false;
        const remove = () => {
            if (removed) return;
            removed = true;
            overlay.remove();
            resolve();
            if (prevFocus instanceof HTMLElement && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
        };
        overlay.addEventListener('animationend', (e) => { if (e.target === overlay) remove(); });
        setTimeout(remove, 260);
    };
    const handle = { close };

    let downOnSelf = false;
    overlay.addEventListener('pointerdown', (e) => { downOnSelf = e.target === overlay; });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay && downOnSelf) close();
    });
    overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));

    if (!stack.length) document.addEventListener('keydown', onKey, true);
    stack.push(handle);
    document.body.appendChild(overlay);
    overlay.tabIndex = -1;
    overlay.focus({ preventScroll: true });
    return { overlay, close, closed };
}
