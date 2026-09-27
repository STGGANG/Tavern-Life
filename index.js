import { ctx, debounce } from './src/util.js';
import { stats, mail } from './src/data.js';
import { applyColors, getSettings, isOn, today } from './src/settings.js';
import { primeAudio } from './src/celebrate.js';
import { evaluate } from './src/achievements.js';
import { renderBadge, renderAllBadges, isAiMessage } from './src/gacha.js';
import { checkAnnivPreview, checkDdayOnEnter, checkMessageMilestone, rememberChatStart } from './src/milestones.js';
import { checkRollover } from './src/receipt.js';
import { captureSnapshot, commitPendingSnapshot, kickLetters, resetLetterRetry } from './src/letters.js';
import * as tracker from './src/tracker.js';
import { mountWand, updateWandBadge } from './src/ui.js';

const LOG = '[생활기록부]';
const RELOAD_AFTER_HIDDEN_MS = 60000;

let started = false;
let prevChatLen = 0;
let hiddenAt = 0;

const guard = (fn) => (...args) => {
    try {
        fn(...args);
    } catch (e) {
        console.error(LOG, e);
    }
};

const snapshotSoon = debounce(guard(() => captureSnapshot({ active: true })), 4000);

function lastAiIndex() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) if (isAiMessage(chat[i])) return i;
    return -1;
}

function milestoneCheck() {
    const len = ctx().chat?.length || 0;
    checkMessageMilestone(prevChatLen, len);
    prevChatLen = len;
}

function enterChat({ rollover }) {
    const c = ctx();
    prevChatLen = c.chat?.length || 0;
    snapshotSoon.cancel();
    commitPendingSnapshot();
    renderAllBadges();
    if (!c.chat?.length) return;
    rememberChatStart();
    checkDdayOnEnter();
    captureSnapshot();
    if (rollover) checkRollover('chat', tracker.isGenerating);
}

const onChatChanged = () => enterChat({ rollover: true });

function onSent(mesId) {
    tracker.onMessageSent(mesId);
    renderBadge(mesId - 1);
    milestoneCheck();
    snapshotSoon();
}

function onReceived(mesId, type) {
    tracker.onMessageReceived(mesId, type);
    milestoneCheck();
    if (type !== 'first_message') snapshotSoon();
}

function onGenerationDone() {
    setTimeout(guard(() => {
        const i = lastAiIndex();
        if (i >= 0) renderBadge(i);
    }), 300);
}

function registerEvents() {
    const { eventSource, eventTypes: E } = ctx();
    const on = (name, fn) => {
        if (name) eventSource.on(name, guard(fn));
    };

    on(E.CHAT_CHANGED, onChatChanged);
    on(E.MESSAGE_SENT, onSent);
    on(E.MESSAGE_RECEIVED, onReceived);
    on(E.CHARACTER_MESSAGE_RENDERED, (mesId) => renderBadge(Number(mesId)));
    on(E.MORE_MESSAGES_LOADED, renderAllBadges);
    on(E.MESSAGE_SWIPED, (mesId) => {
        renderBadge(Number(mesId));
        tracker.onSwipeBrowse();
    });
    on(E.MESSAGE_SWIPE_DELETED, (data) => renderBadge(Number(data?.messageId)));
    on(E.MESSAGE_EDITED, tracker.onMessageEdited);
    on(E.MESSAGE_UPDATED, (mesId) => renderBadge(Number(mesId)));
    on(E.MESSAGE_DELETED, () => {
        tracker.onMessageDeleted();
        prevChatLen = ctx().chat?.length || 0;
    });
    on(E.GENERATION_STARTED, tracker.onGenerationStarted);
    on(E.GENERATION_ENDED, () => {
        tracker.onGenerationEnded();
        onGenerationDone();
    });
    on(E.GENERATION_STOPPED, () => {
        tracker.onGenerationStopped();
        onGenerationDone();
    });
    on(E.IMPERSONATE_READY, tracker.onImpersonated);
    on(E.ONLINE_STATUS_CHANGED, () => {
        resetLetterRetry();
        kickLetters(20000);
    });
    on(E.CONNECTION_PROFILE_LOADED, () => {
        resetLetterRetry();
        kickLetters(20000);
    });
    on(E.CHARACTER_DELETED, (data) => {
        const avatar = data?.character?.avatar;
        if (avatar && mail.data.snaps?.[avatar]) mail.commit([['fn', 'snapDel', { avatar }]]);
    });

    document.addEventListener('visibilitychange', guard(async () => {
        if (document.hidden) {
            hiddenAt = Date.now();
            commitPendingSnapshot();
            stats.flush();
            mail.flush();
            return;
        }
        if (hiddenAt && Date.now() - hiddenAt > RELOAD_AFTER_HIDDEN_MS) {
            await Promise.all([stats.load(), mail.load()]);
            updateWandBadge();
            checkRollover('return', tracker.isGenerating);
            checkAnnivPreview();
        }
        kickLetters(20000);
    }));
    window.addEventListener('pagehide', () => {
        commitPendingSnapshot();
        stats.flush();
        mail.flush();
    });
}

function markSince() {
    if (!stats.loaded || stats.data.meta?.since) return;
    const days = Object.keys(stats.data.days || {}).sort();
    stats.commit([['setIfAbsent', ['meta', 'since'], days[0] || today()]]);
}

/** Pretendard: CSS @import 대신 CORS 링크로 (실리태번이 스타일시트를 읽다 경고를 내지 않도록) */
function loadFonts() {
    const id = 'tlr-font-pretendard';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.crossOrigin = 'anonymous';
    link.href = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css';
    document.head.appendChild(link);
}

async function start() {
    if (started) return;
    started = true;
    getSettings();
    loadFonts();
    applyColors();
    primeAudio();
    mountWand();
    await Promise.all([stats.load(), mail.load()]);
    markSince();
    evaluate();
    updateWandBadge();
    enterChat({ rollover: false });
    setTimeout(guard(() => checkRollover('startup', tracker.isGenerating)), 1500);
    setTimeout(guard(checkAnnivPreview), 4000);
    kickLetters(20000);
    console.log(`${LOG} 준비 완료`, { stats: stats.loaded, mail: mail.loaded, letters: isOn('letters') });
}

registerEvents();
ctx().eventSource.on(ctx().eventTypes.APP_READY, () => {
    start().catch(e => console.error(LOG, '시작 실패', e));
});
