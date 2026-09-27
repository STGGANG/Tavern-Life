import { ctx, cleanText, escapeHtml, formatDate, formatDayKey, formatDuration, josa, num, pct, compileWordGroups, messageModel, modelAlias, DEFAULT_ALIASES, DEFAULT_WORD_GROUPS } from './util.js';
import { stats, mail } from './data.js';
import { COLOR_DEFAULTS, DEFAULTS, applyColors, getSettings, isOn, resetSettings, saveSettings, today } from './settings.js';
import { computeChatStats, devPreviewGacha, isAiMessage, isUserMessage, renderAllBadges, removeAllBadges } from './gacha.js';
import { MESSAGE_MILESTONES, chatTitle, computeDday, devPreviewDday, devPreviewMessageMilestone, devResetChatCelebrations, nextMessageMilestone, parseAnnivList } from './milestones.js';
import { ACHIEVEMENTS, TIER_LABEL, devPreviewAchievements, progressOf, evaluate } from './achievements.js';
import { devPreviewRollover, hasActivity, monthLabel, openMonthly, openReceipt, pastDays, pastMonths } from './receipt.js';
import { captureSnapshot, connectionProfiles, devArrivalPreview, devRandomLetter, kickLetters, letterDebugInfo, onLettersChanged, renderMailbox, resetLetterRetry, setLetterOpener, testLetter, unreadCount } from './letters.js';
import { playSound, showCard } from './celebrate.js';
import { openModal } from './modal.js';
import { resetSessionCaches } from './tracker.js';

const LOG = '[생활기록부]';
const icon = (name, cls = '') => `<i class="fa-solid ${name}${cls ? ` ${cls}` : ''}" aria-hidden="true"></i>`;

export function mountWand() {
    if (document.getElementById('tlr_wand')) return;
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    const item = document.createElement('div');
    item.id = 'tlr_wand';
    item.className = 'list-group-item flex-container flexGap5';
    item.title = '태번 생활기록부';
    item.innerHTML = '<div class="fa-solid fa-receipt extensionsMenuExtensionButton"></div><span>생활기록부</span><span class="tlr-wand-badge" hidden><i class="fa-solid fa-envelope"></i><span></span></span>';
    item.addEventListener('click', () => openMain());
    menu.appendChild(item);
    updateWandBadge();
    onLettersChanged(updateWandBadge);
    mail.onChange(updateWandBadge);
}

export function updateWandBadge() {
    const badge = document.querySelector('#tlr_wand .tlr-wand-badge');
    if (!badge) return;
    const n = unreadCount();
    badge.hidden = !n;
    badge.querySelector('span').textContent = n ? String(n) : '';
    badge.title = n ? `안 읽은 편지 ${n}통` : '';
}

const TABS = [
    ['chat', 'fa-chart-simple', '이 채팅'],
    ['record', 'fa-clock-rotate-left', '전체 기록'],
    ['ach', 'fa-trophy', '업적'],
    ['mail', 'fa-envelope', '편지함'],
    ['settings', 'fa-sliders', '설정'],
];

let current = null;

function openMain(tab = 'chat', opts = {}) {
    if (current) {
        current.show(tab, opts);
        return current.closed;
    }
    const root = document.createElement('div');
    root.className = 'tlr-window';
    root.innerHTML = `
        <header class="tlr-win-head">
            <div class="tlr-win-title">${icon('fa-receipt')}<span>생활기록부</span></div>
            <button class="tlr-icon-btn" data-close title="닫기" aria-label="닫기">${icon('fa-xmark')}</button>
        </header>
        <nav class="tlr-tabs" role="tablist">
            ${TABS.map(([id, ic, label]) => `
            <button class="tlr-tab" data-tab="${id}" role="tab">
                <span class="tlr-tab-icon">${icon(ic)}${id === 'mail' ? '<span class="tlr-dot" hidden></span>' : ''}</span>
                <span class="tlr-tab-label">${label}</span>
            </button>`).join('')}
        </nav>
        <div class="tlr-panel" role="tabpanel"></div>`;
    let panel = root.querySelector('.tlr-panel');
    const dot = root.querySelector('.tlr-dot');
    const refreshDot = () => { dot.hidden = !unreadCount(); };
    refreshDot();
    const off = onLettersChanged(refreshDot);

    const show = (id, o = {}) => {
        root.querySelectorAll('.tlr-tab').forEach(b => {
            const on = b.dataset.tab === id;
            b.classList.toggle('tlr-active', on);
            b.setAttribute('aria-selected', String(on));
        });
        // 탭마다 새 스크롤 영역: 긴 탭에서 내려온 스크롤 위치(iOS는 관성 스크롤까지)가 짧은 탭에 남아 빈 화면이 되는 것 방지
        const fresh = panel.cloneNode(false);
        panel.replaceWith(fresh);
        panel = fresh;
        try {
            if (id === 'chat') renderChatTab(panel);
            else if (id === 'record') renderRecordTab(panel);
            else if (id === 'ach') renderAchTab(panel);
            else if (id === 'mail') renderMailbox(panel, o.letterId, { openSettings: () => show('settings', { section: 'letters' }) });
            else if (id === 'settings') renderSettingsTab(panel, o.section);
        } catch (e) {
            console.error(LOG, e);
            panel.innerHTML = emptyState('fa-triangle-exclamation', '화면을 그리다 문제가 생겼어요', '브라우저 콘솔을 확인해주세요.');
        }
    };
    root.querySelectorAll('.tlr-tab').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    show(tab, opts);

    const modal = openModal({ content: root, className: 'tlr-overlay-main', label: '생활기록부' });
    current = { show, closed: modal.closed };
    modal.closed.then(() => {
        off();
        current = null;
    });
    return modal.closed;
}

setLetterOpener((id) => openMain('mail', { letterId: id }));

function emptyState(ic, title, sub = '') {
    return `
        <div class="tlr-empty">
            <div class="tlr-empty-icon">${icon(ic)}</div>
            <div class="tlr-empty-title">${title}</div>
            ${sub ? `<div class="tlr-empty-sub">${sub}</div>` : ''}
        </div>`;
}

const scope = (ic, text) => `<div class="tlr-scope">${icon(ic)}<span>${text}</span></div>`;

const secHead = (title, side = '') => `<div class="tlr-sec-head"><span>${title}</span>${side}</div>`;

function statTile(label, value, sub = '') {
    return `<div class="tlr-tile"><div class="tlr-tile-label">${escapeHtml(label)}</div><div class="tlr-tile-value">${value}</div>${sub ? `<div class="tlr-tile-sub">${sub}</div>` : ''}</div>`;
}

function bars(dist) {
    const entries = Object.entries(dist);
    const max = Math.max(1, ...entries.map(([, n]) => n));
    const total = entries.reduce((a, [, n]) => a + n, 0);
    return `<div class="tlr-bars">${entries.map(([k, n]) => `
        <div class="tlr-bar-row">
            <span class="tlr-bar-label">${k === '10+' ? '10~' : escapeHtml(k)}</span>
            <span class="tlr-bar-track"><span class="tlr-bar-fill" style="width:${(n / max) * 100}%"></span></span>
            <span class="tlr-bar-value">${total ? `${pct(n, total)}%` : '-'}<small>${num(n)}</small></span>
        </div>`).join('')}</div>`;
}

const progress = (cur, goal) => `<span class="tlr-progress"><span style="width:${pct(cur, goal)}%"></span></span>`;

const chatSwipeLog = () => Number(ctx().chatMetadata?.tavern_life_record?.swipes) || 0;

function renderChatTab(panel) {
    const c = ctx();
    if (!c.chat?.length || (c.characterId === undefined && !c.groupId)) {
        panel.innerHTML = emptyState('fa-comments', '열린 채팅이 없어요', '채팅을 열면 이 채팅의 기록을 볼 수 있어요.');
        return;
    }
    const st = computeChatStats();
    const dd = computeDday();
    const name = chatTitle();
    const nextMsg = nextMessageMilestone(st.messages);

    const hero = dd ? `
        <div class="tlr-hero">
            <div class="tlr-hero-num">${num(dd.dayNo)}<small>일째</small></div>
            <div class="tlr-hero-text">
                <div class="tlr-hero-title">${escapeHtml(josa(name, '과', '와'))} 함께한 날</div>
                <div class="tlr-hero-sub">${escapeHtml(formatDate(dd.first))} 첫 메시지</div>
            </div>
            ${dd.next ? `<span class="tlr-pill ${dd.next.inDays === 0 ? 'tlr-pill-point' : ''}">${dd.next.inDays === 0 ? `오늘 ${dd.next.label}` : `${dd.next.label} D-${dd.next.inDays}`}</span>` : ''}
        </div>` : '';

    const models = Object.entries(st.models).sort((a, b) => b[1] - a[1]);
    const prevMsg = [0, ...MESSAGE_MILESTONES].filter(n => n <= st.messages).pop() || 0;
    panel.innerHTML = `
        ${scope('fa-comment-dots', `<b>${escapeHtml(name)}</b> 채팅에 지금 남아 있는 메시지 기준 · 설치 전 대화도 포함`)}
        ${hero}
        <div class="tlr-box">
            <div class="tlr-between">
                <span>메시지 <b>${num(st.messages)}개</b></span>
                <span class="tlr-muted">${nextMsg ? `${num(nextMsg)}개까지 ${num(nextMsg - st.messages)}개` : '모든 기념 달성'}</span>
            </div>
            ${nextMsg ? progress(st.messages - prevMsg, nextMsg - prevMsg) : ''}
        </div>
        <div class="tlr-tiles">
            ${statTile('총 스와이프', num(st.rerolls), chatSwipeLog() > st.rerolls ? `지운 것 포함 누적 ${num(chatSwipeLog())}` : '')}
            ${statTile('받은 답', num(st.ai))}
            ${statTile('리롤 없이 진행', `${pct(st.oneShot, st.proceeded)}<small>%</small>`, `${num(st.oneShot)} / ${num(st.proceeded)}`)}
            ${statTile('평균 채택 위치', st.proceeded ? `${(st.posSum / st.proceeded).toFixed(1)}<small>번째</small>` : '-')}
        </div>
        ${secHead('몇 번째 답으로 진행했나', st.maxRoll.n ? `<span class="tlr-muted">최다 #${st.maxRoll.idx} · ${num(st.maxRoll.n + 1)}번 뽑음</span>` : '')}
        <div class="tlr-box">${st.proceeded ? bars(st.dist) : '<div class="tlr-muted">아직 진행한 답이 없어요.</div>'}</div>
        ${models.length ? `${secHead('이 채팅의 모델')}<div class="tlr-chips">${models.map(([m, n]) => `<span class="tlr-chip tlr-chip-model" title="${escapeHtml(m)}"><span>${escapeHtml(m)}</span><b>${num(n)}</b></span>`).join('')}</div>` : ''}
        <p class="tlr-note">${icon('fa-circle-info')}채팅에 저장된 메시지·스와이프로 매번 계산해서, 지우거나 분기하면 지금 상태에 맞게 바뀌어요 (지운 스와이프는 "누적"에만 남아요). 첫 인사말과 아직 진행 전인 마지막 답은 빠져요.</p>`;
}

function renderRecordTab(panel) {
    const days = pastDays();
    const t = today();
    const life = stats.data.life || {};
    const todayData = stats.data.days?.[t];

    const lifeModels = Object.entries(life.models || {}).sort((a, b) => (b[1].recv || 0) - (a[1].recv || 0));
    const months = pastMonths();
    const wordRows = Object.entries(life.words || {})
        .map(([alias, words]) => ({ alias, list: Object.entries(words || {}).sort((a, b) => b[1] - a[1]) }))
        .filter(x => x.list.length)
        .sort((a, b) => b.list.reduce((s, [, n]) => s + n, 0) - a.list.reduce((s, [, n]) => s + n, 0));
    const adoptPos = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6~9': 0, '10+': 0, ...(life.adoptPos || {}) };

    const receiptItem = (k, live) => {
        const d = stats.data.days[k] || {};
        return `
            <button class="tlr-list-item tlr-receipt-item" data-day="${k}" ${live ? 'data-live="1"' : ''}>
                <span class="tlr-list-icon">${icon('fa-receipt')}</span>
                <span class="tlr-list-main">
                    <span class="tlr-list-title">${live ? '오늘' : escapeHtml(formatDayKey(k))}${live ? '<span class="tlr-pill tlr-pill-sm">진행 중</span>' : ''}</span>
                    <span class="tlr-list-sub">${num((d.sent || 0) + (d.recv || 0))}턴 · ${formatDuration(d.activeMs || 0)}</span>
                </span>
                ${icon('fa-chevron-right', 'tlr-list-go')}
            </button>`;
    };

    const since = stats.data.meta?.since;
    panel.innerHTML = `
        ${scope('fa-layer-group', `<b>모든 캐릭터·채팅</b> 합계 · ${since ? `${escapeHtml(formatDayKey(since))}부터` : '설치한 뒤부터'} 쌓인 기록`)}
        ${secHead('활동 캘린더')}
        <div class="tlr-box tlr-cal-box"></div>
        ${months.length ? `
        ${secHead('월간 결산')}
        <div class="tlr-list">
            ${months.slice(0, 12).map(m => `
            <button class="tlr-list-item tlr-month-item" data-month="${m}">
                <span class="tlr-list-icon">${icon('fa-calendar-check')}</span>
                <span class="tlr-list-main"><span class="tlr-list-title">${escapeHtml(monthLabel(m))}</span>
                <span class="tlr-list-sub">${num(Object.keys(stats.data.cal || {}).filter(k => k.startsWith(m)).length)}일 롤플</span></span>
                ${icon('fa-chevron-right', 'tlr-list-go')}
            </button>`).join('')}
        </div>` : ''}
        ${secHead('하루 영수증', days.length ? `<span class="tlr-muted">${days.length}장</span>` : '')}
        <div class="tlr-list">
            ${hasActivity(todayData) ? receiptItem(t, true) : ''}
            ${days.map(k => receiptItem(k, false)).join('')}
            ${!days.length && !hasActivity(todayData) ? '<div class="tlr-list-empty">아직 기록이 없어요. 롤플을 하면 쌓여요.</div>' : ''}
        </div>

        ${secHead('누적')}
        <div class="tlr-tiles tlr-tiles-3">
            ${statTile('보낸 메시지', num(life.sent))}
            ${statTile('받은 답', num(life.recv))}
            ${statTile('스와이프', num(life.swipes))}
            ${statTile('롤플한 날', `${num(life.activeDays)}<small>일</small>`, `연속 ${num(life.streak)} · 최고 ${num(life.bestStreak)}`)}
            ${statTile('리롤 없이 진행', `${pct(life.oneShot, life.adopt)}<small>%</small>`, `최고 연속 ${num(life.bestOneShot)}턴`)}
            ${statTile('받은 편지', `${num(life.lettersRecv)}<small>통</small>`)}
        </div>
        ${life.adopt ? `${secHead('몇 번째 답으로 진행했나')}<div class="tlr-box">${bars(adoptPos)}</div>` : ''}
        ${lifeModels.length ? `
        ${secHead('모델 성적표')}
        <div class="tlr-model-grid">${lifeModels.map(([m, v]) => modelCard(m, v, life.words?.[m])).join('')}</div>` : ''}
        ${isOn('words') || wordRows.length ? `
        ${secHead('단어 체크')}
        ${wordRows.length ? `<div class="tlr-box tlr-stack">${wordRows.map(x => `
            <div class="tlr-word-model"><div class="tlr-word-alias" title="${escapeHtml(x.alias)}">${escapeHtml(x.alias)}</div>
                <div class="tlr-chips">${x.list.map(([w, n]) => `<span class="tlr-chip">${escapeHtml(w)}<b>${num(n)}</b></span>`).join('')}</div>
            </div>`).join('')}</div>` : '<div class="tlr-muted">아직 체크 단어가 나오지 않았어요.</div>'}` : ''}
        <p class="tlr-note">${icon('fa-circle-info')}확장이 켜진 동안 일어난 일을 그때그때 적어둔 기록이라, 설치 전 대화는 들어가지 않고 채팅을 지우거나 분기해도 줄지 않아요. 한 채팅의 예전 기록은 "이 채팅" 탭에서 볼 수 있어요. 일별 기록은 두 달 정도 보관돼요.</p>`;

    panel.querySelectorAll('.tlr-receipt-item').forEach(btn => btn.addEventListener('click', () => {
        openReceipt(btn.dataset.day, { live: !!btn.dataset.live });
    }));
    panel.querySelectorAll('.tlr-month-item').forEach(btn => btn.addEventListener('click', () => openMonthly(btn.dataset.month)));
    renderCalendar(panel.querySelector('.tlr-cal-box'), today().slice(0, 7));
}

function modelCard(name, v, words) {
    const topWord = Object.entries(words || {}).sort((a, b) => b[1] - a[1])[0];
    const cell = (label, value) => `<div class="tlr-mc-cell"><span>${label}</span><b>${value}</b></div>`;
    return `
        <div class="tlr-model-card">
            <div class="tlr-model-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
            <div class="tlr-mc-grid">
                ${cell('받은 답', num(v.recv))}
                ${cell('리롤 없이', v.adopt ? `${pct(v.oneShot, v.adopt)}%` : '-')}
                ${cell('평균 채택', v.adopt && v.posSum ? `${(v.posSum / v.adopt).toFixed(1)}번째` : '-')}
                ${cell('평균 길이', v.lenN ? `${num(Math.round(v.chars / v.lenN))}자` : '-')}
            </div>
            ${topWord ? `<div class="tlr-mc-word">자주 쓴 단어 <b>‘${escapeHtml(topWord[0])}’ ${num(topWord[1])}번</b></div>` : ''}
        </div>`;
}

const pad2 = (n) => String(n).padStart(2, '0');

function renderCalendar(box, ym) {
    const cal = stats.data.cal || {};
    const t = today();
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const daysIn = new Date(y, m, 0).getDate();
    const oldest = Object.keys(cal).sort()[0]?.slice(0, 7) || t.slice(0, 7);
    const prev = `${m === 1 ? y - 1 : y}-${pad2(m === 1 ? 12 : m - 1)}`;
    const next = `${m === 12 ? y + 1 : y}-${pad2(m === 12 ? 1 : m + 1)}`;
    const active = Object.keys(cal).filter(k => k.startsWith(ym)).length;
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push('<span class="tlr-cal-cell tlr-cal-blank"></span>');
    for (let d = 1; d <= daysIn; d++) {
        const k = `${ym}-${pad2(d)}`;
        const n = cal[k] || 0;
        cells.push(`<button class="tlr-cal-cell ${n ? 'tlr-cal-on' : ''} ${k === t ? 'tlr-cal-today' : ''}" data-day="${k}" ${n ? '' : 'disabled'} title="${n ? `${num(n)}턴` : ''}">
            <span class="tlr-cal-num">${d}</span>
        </button>`);
    }
    box.innerHTML = `
        <div class="tlr-cal-head">
            <button class="tlr-icon-btn tlr-icon-btn-sm" data-go="${prev}" ${prev < oldest ? 'disabled' : ''} aria-label="이전 달">${icon('fa-chevron-left')}</button>
            <span class="tlr-cal-title">${escapeHtml(monthLabel(ym))}<small>${num(active)}일</small></span>
            <button class="tlr-icon-btn tlr-icon-btn-sm" data-go="${next}" ${next > t.slice(0, 7) ? 'disabled' : ''} aria-label="다음 달">${icon('fa-chevron-right')}</button>
        </div>
        <div class="tlr-cal-grid">
            ${['일', '월', '화', '수', '목', '금', '토'].map(w => `<span class="tlr-cal-week">${w}</span>`).join('')}
            ${cells.join('')}
        </div>
        <div class="tlr-cal-note">도장은 채팅을 주고받은 날에 찍혀요 · 두 달이 지난 날은 영수증 없이 도장만 남아요</div>`;
    box.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => renderCalendar(box, b.dataset.go)));
    box.querySelectorAll('.tlr-cal-on').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.day;
        if (hasActivity(stats.data.days?.[k])) openReceipt(k, { live: k === t });
        else toastr.info('두 달이 지난 날은 영수증 없이 도장만 남아요', formatDayKey(k));
    }));
}

function renderAchTab(panel, filter = 'all') {
    const got = stats.data.ach || {};
    const total = ACHIEVEMENTS.length;
    const done = ACHIEVEMENTS.filter(a => got[a.id]).length;
    const list = ACHIEVEMENTS.filter(a => filter === 'all' || a.tier === filter)
        .sort((a, b) => (got[b.id] ? 1 : 0) - (got[a.id] ? 1 : 0));

    panel.innerHTML = `
        ${!isOn('achievements') ? `<p class="tlr-note">${icon('fa-circle-info')}업적 기능이 꺼져 있어요. 켜면 그동안의 누적 기록으로 다시 판정해요.</p>` : ''}
        <div class="tlr-box">
            <div class="tlr-between"><span><b class="tlr-big">${done}</b> / ${total} 달성</span><span class="tlr-muted">${pct(done, total)}%</span></div>
            ${progress(done, total)}
        </div>
        <div class="tlr-seg" role="tablist">
            ${[['all', '전체'], ['normal', '평범'], ['fun', '재미'], ['hard', '도전']].map(([id, label]) => `<button class="tlr-seg-btn ${filter === id ? 'tlr-active' : ''}" data-f="${id}">${label}</button>`).join('')}
        </div>
        <div class="tlr-ach-grid">
            ${list.map(a => {
        const ok = !!got[a.id];
        const secret = a.hidden && !ok;
        const prog = !ok ? progressOf(a) : null;
        return `
                <div class="tlr-ach tlr-ach-${a.tier} ${ok ? 'tlr-ach-ok' : ''}">
                    <div class="tlr-ach-icon">${secret ? icon('fa-question') : `<span class="tlr-emoji">${escapeHtml(a.icon)}</span>`}</div>
                    <div class="tlr-ach-body">
                        <div class="tlr-ach-name">${secret ? '숨겨진 업적' : escapeHtml(a.name)}<span class="tlr-tier tlr-tier-${a.tier}">${TIER_LABEL[a.tier]}</span></div>
                        <div class="tlr-ach-desc">${secret ? '조건을 만족하면 공개돼요' : escapeHtml(a.desc)}</div>
                        ${ok ? `<div class="tlr-ach-date">${icon('fa-check')}${escapeHtml(formatDate(got[a.id]))}</div>` : ''}
                        ${prog && !secret ? `<div class="tlr-ach-prog">${progress(prog.cur, prog.goal)}<small>${num(prog.cur)} / ${num(prog.goal)}</small></div>` : ''}
                    </div>
                </div>`;
    }).join('')}
        </div>`;
    panel.querySelectorAll('.tlr-seg-btn').forEach(b => b.addEventListener('click', () => renderAchTab(panel, b.dataset.f)));
}

const HOURS = Array.from({ length: 13 }, (_, h) => h);

const sw = (path) => `<input type="checkbox" class="tlr-switch" data-tlr="${path}">`;
const numInput = (path, min, max, unit) =>
    `<span class="tlr-num-wrap"><input type="number" class="text_pole tlr-num" min="${min}" max="${max}" data-tlr="${path}" data-type="number"><span>${unit}</span></span>`;
const range = (path, min, max, step, suffix = '') =>
    `<span class="tlr-range-wrap"><input type="range" min="${min}" max="${max}" step="${step}" data-tlr="${path}" data-type="number"><span class="tlr-range-val" data-for="${path}" data-suffix="${suffix}"></span></span>`;

function row({ ic = '', title, desc = '', control = '', stack = false, cls = '', toggle = false }) {
    const tag = toggle ? 'label' : 'div';
    return `
        <${tag} class="tlr-row${stack ? ' tlr-row-stack' : ''}${cls ? ` ${cls}` : ''}">
            ${ic ? `<span class="tlr-row-icon">${icon(ic)}</span>` : ''}
            <span class="tlr-row-text"><span class="tlr-row-title">${title}</span>${desc ? `<span class="tlr-row-desc">${desc}</span>` : ''}</span>
            ${control ? `<span class="tlr-row-ctrl">${control}</span>` : ''}
        </${tag}>`;
}

const toggleRow = (path, title, desc = '', ic = '') => row({ ic, title, desc, control: sw(path), toggle: true });

function group(id, title, body, note = '') {
    return `
        <section class="tlr-group" data-section="${id}">
            <h5 class="tlr-group-title">${title}</h5>
            <div class="tlr-group-body">${body}</div>
            ${note ? `<p class="tlr-group-note">${note}</p>` : ''}
        </section>`;
}

const btn = (attrs, ic, label, cls = '') => `<button class="tlr-btn${cls ? ` ${cls}` : ''}" ${attrs}>${ic ? icon(ic) : ''}<span>${label}</span></button>`;

const TIER_LEGEND = [['r', 'R', '2~3'], ['sr', 'SR', '4~5'], ['ssr', 'SSR', '6~7'], ['ur', 'UR', '8~9'], ['ceil', '천장', '10+']];

const COLOR_ROWS = [
    ['accent', '강조색', '버튼·막대·선택 표시 (비우면 테마의 인용문 색)'],
    ['point', '포인트색', '안 읽은 편지, 하트 같은 작은 포인트'],
    ['receipt', '영수증 종이', ''],
];

function settingsHtml() {
    const s = getSettings();
    return `
    <div class="tlr-settings">
        ${group('modules', '기능', [
        toggleRow('modules.gacha', '스와이프 가챠', '메시지 뱃지 · 채팅 통계', 'fa-dice'),
        toggleRow('modules.achievements', '업적', `평범 · 재미 · 도전 ${ACHIEVEMENTS.length}개`, 'fa-trophy'),
        toggleRow('modules.milestones', '마일스톤 축하', '메시지 수 · 함께한 날', 'fa-champagne-glasses'),
        toggleRow('modules.receipt', '하루 영수증', '날이 바뀌면 지난 하루 요약', 'fa-receipt'),
        toggleRow('modules.words', '단어 체크', '모델별로 자주 쓰는 표현 세기', 'fa-spell-check'),
        toggleRow('modules.letters', '부재중 편지', '한동안 안 온 캐릭터가 편지를 써요 · API 사용', 'fa-envelope'),
    ].join(''))}

        ${group('gacha', '스와이프 가챠', [
        toggleRow('gacha.badge', '메시지에 뱃지 표시', '예: SR 3/5 — 5번 뽑아서 3번째로 진행'),
        toggleRow('gacha.effect', '새 답이 나올 때 뱃지 효과'),
        toggleRow('gacha.toast', '연차 알림', '3 · 5 · 7 · 10 · 15번째 답이 나올 때 (첫 답 포함)'),
        `<div class="tlr-row tlr-row-stack"><span class="tlr-row-text"><span class="tlr-row-title">등급</span><span class="tlr-row-desc">한 메시지에서 뽑은 횟수 (첫 답 포함)</span></span>
            <span class="tlr-tier-legend">${TIER_LEGEND.map(([k, l, n]) => `<span class="tlr-legend-item"><span class="tlr-badge tlr-tier-${k}">${l}</span><small>${n}</small></span>`).join('')}</span></div>`,
    ].join(''))}

        ${group('effects', '축하 효과', [
        toggleRow('effects.confetti', '꽃가루'),
        toggleRow('effects.sound', '알림음'),
        row({ title: '볼륨', control: range('effects.volume', 0, 100, 5) }),
        row({ title: '알림음 주소', desc: "비우면 기본 '띠리링'", stack: true, control: '<input type="text" class="text_pole" placeholder="https://…/sound.mp3" data-tlr="effects.soundUrl">' }),
        `<div class="tlr-btn-row">${btn('data-act="sound"', 'fa-volume-high', '들어보기')}${btn('data-act="card"', 'fa-wand-magic-sparkles', '축하 미리보기')}</div>`,
    ].join(''))}

        ${group('anniv', '기념일', [
        row({ title: '축하할 날', desc: '쉼표로 구분 · 일수는 숫자, 년은 y (예: 5, 10, 100, 1y) · 첫 메시지 날이 1일째', stack: true, control: '<input type="text" class="text_pole" data-tlr="anniv.days" placeholder="5, 10, 30, 100, 200, 1y, 3y">' }),
        '<div class="tlr-row tlr-anniv-preview"></div>',
        toggleRow('anniv.preview', '하루 전 예고 알림', '최근 대화한 채팅의 기념일을 전날 알려줘요 · 하루 최대 1번'),
    ].join(''))}

        ${group('receipt', '하루 영수증', [
        row({ title: '하루가 바뀌는 시각', desc: '<span class="tlr-daystart-desc"></span>', control: `<select class="text_pole" data-tlr="receipt.dayStartHour" data-type="number">${HOURS.map(h => `<option value="${h}">${h === 0 ? '자정 (0시)' : h < 12 ? `새벽·아침 ${h}시` : '낮 12시'}</option>`).join('')}</select>` }),
        toggleRow('receipt.autoShow', '날이 바뀌면 바로 보여주기', '끄면 작은 알림만 떠요'),
    ].join(''))}

        ${group('words', '단어 체크', `
            <div class="tlr-help">
                <div class="tlr-help-title">${icon('fa-circle-info')}쓰는 법</div>
                <ul>
                    <li>한 줄에 하나씩 <code>표시 이름 = 표현, 표현, …</code></li>
                    <li>한글·일본어는 부분 일치 — <code>짐승</code>은 "짐승처럼"도 1번으로 세요</li>
                    <li>영어는 단어 시작 기준, 대소문자 무시 — <code>beast</code>는 beasts도 세요</li>
                    <li>정규식은 <code>/…/</code> 로 감싸기 — 예: <code>/뇌수(?!술)/</code></li>
                    <li>새로 받은 답에서만 세요. 이어쓰기는 이어 쓴 부분만, 코드·HTML은 빼요</li>
                </ul>
            </div>
            <textarea class="text_pole tlr-textarea" rows="7" spellcheck="false" data-tlr="words.groups"></textarea>
            <div class="tlr-field-foot"><span class="tlr-word-errors tlr-warn" hidden></span>${btn('data-reset="words.groups"', 'fa-rotate-left', '기본값', 'tlr-btn-sm')}</div>
        `)}

        ${group('aliases', '모델 별명', `
            <div class="tlr-help">
                <div class="tlr-help-title">${icon('fa-circle-info')}어디에 쓰이나요</div>
                <ul>
                    <li>영수증의 "제미니가 '짐승'을 6번 썼어요", 사용한 모델 목록</li>
                    <li>기록 탭의 모델별 표 · 단어 체크, 이 채팅 탭의 모델 목록</li>
                    <li>한 줄에 하나씩 <code>패턴, 패턴 = 별명</code> — 모델 이름에 패턴이 들어 있으면 그 별명으로 묶어요. 위에서부터 먼저 맞는 것</li>
                    <li>누적 기록은 기록할 때의 별명으로 저장돼요. 바꾸면 그 뒤부터 새 별명으로 쌓여요</li>
                </ul>
            </div>
            <textarea class="text_pole tlr-textarea" rows="6" spellcheck="false" data-tlr="words.aliases"></textarea>
            <div class="tlr-field-foot"><span></span>${btn('data-reset="words.aliases"', 'fa-rotate-left', '기본값', 'tlr-btn-sm')}</div>
        `)}

        ${group('letters', '부재중 편지', [
        row({ title: '편지 분위기', control: '<select class="text_pole" data-tlr="letters.mode"><option value="inworld">세계관 안에서</option><option value="fourth">제4의 벽 넘어서</option><option value="mix">가끔 섞기</option></select>' }),
        row({ title: '제4의 벽 확률', control: range('letters.mixRatio', 0, 100, 5, '%'), cls: 'tlr-mix-line' }),
        row({ title: '화면 너머의 사람', desc: '제4의 벽 편지에서, 화면 너머의 작가를 캐릭터가 어떻게 여기는지', cls: 'tlr-fourth-line', control: '<select class="text_pole" data-tlr="letters.fourthView"><option value="same">작가 = 페르소나 (같은 사람)</option><option value="author">작가 ≠ 페르소나 (이야기를 쓰는 사람)</option></select>' }),
        row({ title: '편지 언어', control: '<select class="text_pole" data-tlr="letters.lang"><option value="auto">대화 언어 따라가기</option><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option></select>' }),
        row({ title: '참고할 최근 대화', desc: '편지 쓸 때 보는 마지막 메시지 수 · 캐릭터 설명·성격과 페르소나 설명은 항상 함께 봐요', control: range('letters.contextCount', 0, 20, 1, '개') }),
        row({ title: '며칠 안 오면 편지', control: numInput('letters.minAbsentDays', 1, 60, '일') }),
        row({ title: '대상 캐릭터', desc: '최근 이 기간 안에 대화한 캐릭터만', control: numInput('letters.maxInactiveDays', 2, 365, '일') }),
        row({ title: '하루 최대', desc: '모든 캐릭터를 합친 하루 편지 수 (한 캐릭터는 하루 1통까지)', control: numInput('letters.dailyMax', 0, 10, '통') }),
        row({ title: '받을 편지', desc: '한 캐릭터와 대화하지 않는 동안 최대 몇 통까지 받을지. 다시 대화하면 새로 세요', control: numInput('letters.perAbsenceMax', 1, 10, '통') }),
        row({ title: '다시 받기까지', desc: '위 한도를 다 채워도, 마지막 편지에서 이만큼 지나면 다시 올 수 있어요', control: numInput('letters.resetDays', 1, 60, '일') }),
        row({ title: '편지 쓸 연결', desc: '저렴한 서브 모델 프로필을 추천해요', stack: true, control: '<select class="text_pole" id="tlr_conn" data-tlr="letters.connection"></select>' }),
        row({ title: '추가 지시', desc: '선택', stack: true, control: '<textarea class="text_pole tlr-textarea" rows="2" placeholder="예: 반말로 써줘 / P.S.를 꼭 붙여줘" data-tlr="letters.extraPrompt"></textarea>' }),
        row({ title: '편지 받지 않는 캐릭터', stack: true, control: '<div class="tlr-chips tlr-excluded"></div>' }),
        `<div class="tlr-btn-row tlr-btn-row-full">${btn('id="tlr_test_letter"', 'fa-paper-plane', '지금 이 캐릭터에게서 테스트 편지 받기', 'tlr-btn-primary')}</div>`,
    ].join(''), '실리태번이 한가할 때(생성 중이 아니고 30초 이상 조용할 때) 조건에 맞는 캐릭터 중 하나를 골라 써요. 편지와 편지 사이는 최소 20분 띄워요. 실패하면 1분 → 3분 → 5분 뒤 다시, 그래도 안 되면 30분 뒤 한 바퀴 더 (하루 3바퀴). 실패한 건 할당량에서 빠지지 않아요.')}

        ${group('colors', '색상', COLOR_ROWS.map(([k, title, desc]) => row({
        title, desc,
        control: `<span class="tlr-color-wrap"><input type="color" data-tlr="colors.${k}" data-color="${k}"><button class="tlr-icon-btn tlr-icon-btn-sm" data-color-reset="${k}" title="기본값" aria-label="기본값">${icon('fa-rotate-left')}</button></span>`,
    })).join(''), '나머지 색은 실리태번 테마를 따라가요.')}

        ${group('data', '데이터', [
        row({ title: '기록 파일', desc: '실리태번 설정과 따로 <code>user/files/tavern-life-record.*.json</code> 에 저장 · 오래된 기록은 자동 정리', ic: 'fa-database' }),
        toggleRow('dev', '개발자 모드', '각 기능을 바로 발동해보는 테스트 버튼', 'fa-flask'),
        `<div class="tlr-btn-row">${btn('id="tlr_reset_settings"', 'fa-rotate-left', '모든 설정 초기화', 'tlr-btn-danger')}${btn('id="tlr_reset"', 'fa-trash-can', '모든 기록 초기화', 'tlr-btn-danger')}</div>`,
    ].join(''))}

        ${s.dev ? group('dev', '개발자 테스트', `
            <div class="tlr-dev-grid">
                ${btn('data-dev="gacha"', 'fa-dice', '뱃지 · 연차 알림')}
                ${btn('data-dev="ach1"', 'fa-trophy', '업적 1개')}
                ${btn('data-dev="ach5"', 'fa-layer-group', '업적 여러 개')}
                ${btn('data-dev="msg"', 'fa-champagne-glasses', '메시지 수 축하')}
                ${btn('data-dev="dday"', 'fa-heart', 'D-day 축하')}
                ${btn('data-dev="rollover"', 'fa-receipt', '영수증 미리보기')}
                ${btn('data-dev="month"', 'fa-calendar-check', '월간 결산')}
                ${btn('data-dev="annivPreview"', 'fa-calendar-day', '기념일 예고')}
                ${btn('data-dev="words"', 'fa-spell-check', '마지막 답 단어')}
                ${btn('data-dev="arrival"', 'fa-envelope', '편지 도착 알림')}
                ${btn('data-dev="randomLetter"', 'fa-paper-plane', '랜덤 편지 (API)')}
                ${btn('data-dev="letterInfo"', 'fa-stethoscope', '편지 상태')}
                ${btn('data-dev="chatDiag"', 'fa-magnifying-glass', '채팅 진단')}
                ${btn('data-dev="resetCeleb"', 'fa-eraser', '축하 기록 지우기', 'tlr-btn-danger')}
            </div>`, '미리보기는 통계·업적·할당량에 남지 않아요. 랜덤 편지는 실제로 API를 부르고 편지함에 들어가요 (할당량은 안 써요).') : ''}
    </div>`;
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
    target[last] = value;
}

function fillConnectionOptions(select) {
    const cur = getSettings().letters.connection;
    const profiles = connectionProfiles();
    const opts = [
        ['auto', '자동 — 선택된 연결 프로필, 없으면 현재 API'],
        ['main', '현재 메인 API'],
        ...profiles.map(p => [p.id, `프로필: ${p.name}`]),
    ];
    if (!opts.some(([v]) => v === cur)) opts.push([cur, '(삭제된 프로필 → 자동으로 동작)']);
    select.innerHTML = opts.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('');
    select.value = cur;
}

function renderExcluded(root) {
    const box = root.querySelector('.tlr-excluded');
    if (!box) return;
    const list = getSettings().letters.excluded || [];
    if (!list.length) {
        box.innerHTML = '<span class="tlr-muted">없음</span>';
        return;
    }
    const chars = ctx().characters || [];
    box.innerHTML = list.map(av => {
        const name = chars.find(c => c.avatar === av)?.name || av;
        return `<span class="tlr-chip">${escapeHtml(name)}<button class="tlr-x" data-av="${escapeHtml(av)}" title="다시 받기" aria-label="다시 받기">${icon('fa-xmark')}</button></span>`;
    }).join('');
    box.querySelectorAll('.tlr-x').forEach(b => b.addEventListener('click', () => {
        const ls = getSettings().letters;
        ls.excluded = ls.excluded.filter(a => a !== b.dataset.av);
        saveSettings();
        renderExcluded(root);
        kickLetters(5000);
    }));
}

function updateWordErrors(root) {
    const box = root.querySelector('.tlr-word-errors');
    if (!box) return;
    const { errors } = compileWordGroups(getSettings().words.groups);
    box.hidden = !errors.length;
    box.textContent = errors.length ? `잘못된 표현이라 건너뛰었어요: ${errors.join(', ')}` : '';
}

function syncControls(root) {
    const s = getSettings();
    root.querySelectorAll('[data-tlr]').forEach(el => {
        const v = getPath(s, el.dataset.tlr);
        if (el.type === 'checkbox') el.checked = !!v;
        else if (el.type === 'color') {
            el.value = v || COLOR_DEFAULTS[el.dataset.color];
            el.closest('.tlr-color-wrap')?.classList.toggle('tlr-color-default', !v);
        } else if (document.activeElement !== el) el.value = v ?? '';
    });
    root.querySelectorAll('.tlr-range-val').forEach(el => {
        el.textContent = `${getPath(s, el.dataset.for)}${el.dataset.suffix || ''}`;
    });
    const h = Number(s.receipt.dayStartHour) || 0;
    const pad = (n) => String(n).padStart(2, '0');
    const dayDesc = root.querySelector('.tlr-daystart-desc');
    if (dayDesc) dayDesc.textContent = h ? `매일 ${pad(h)}:00 ~ 다음 날 ${pad(h - 1)}:59 를 하루로 쳐요 (새벽 롤플도 전날로)` : '매일 00:00 ~ 23:59 를 하루로 쳐요';
    const annivBox = root.querySelector('.tlr-anniv-preview');
    if (annivBox) {
        const list = parseAnnivList(s.anniv.days);
        annivBox.innerHTML = list.length
            ? `<span class="tlr-chips">${list.map(x => `<span class="tlr-chip">${escapeHtml(x.label)}</span>`).join('')}</span>`
            : '<span class="tlr-warn">알아볼 수 있는 날이 없어요. 기념일 축하가 뜨지 않아요</span>';
    }
    const mix = root.querySelector('.tlr-mix-line');
    if (mix) mix.hidden = s.letters.mode !== 'mix';
    const fourth = root.querySelector('.tlr-fourth-line');
    if (fourth) fourth.hidden = s.letters.mode === 'inworld';
}

function devCountWords() {
    const chat = ctx().chat || [];
    let m = null;
    for (let i = chat.length - 1; i >= 0 && !m; i--) if (isAiMessage(chat[i])) m = chat[i];
    if (!m) return toastr.info('AI 답이 없어요', '단어 세보기');
    const text = cleanText(m.mes);
    const lines = compileWordGroups(getSettings().words.groups).groups
        .map(g => [g.label, (text.match(g.re) || []).length])
        .filter(([, n]) => n > 0)
        .map(([l, n]) => `${escapeHtml(l)}: ${n}번`);
    const alias = modelAlias(messageModel(m), getSettings().words.aliases);
    toastr.info(lines.length ? lines.join('<br>') : '체크 단어가 없어요', `${alias} · 마지막 답`, { escapeHtml: false });
}

function devChatDiag() {
    const chat = ctx().chat || [];
    const types = {};
    let user = 0;
    let ai = 0;
    let narr = 0;
    let hidden = 0;
    let rawUser = 0;
    const names = {};
    for (const m of chat) {
        if (m?.extra?.type) types[m.extra.type] = (types[m.extra.type] || 0) + 1;
        if (m?.is_system) hidden++;
        if (m?.is_user) rawUser++;
        const nm = String(m?.name || '?');
        names[nm] = (names[nm] || 0) + 1;
        if (isAiMessage(m)) ai++;
        else if (isUserMessage(m)) user++;
        else narr++;
    }
    const st = computeChatStats();
    toastr.info([
        `메시지 ${chat.length}개 · 내 메시지 ${user} · AI ${ai} · 시스템 ${narr}`,
        `is_user 표시 ${rawUser} · 숨김 ${hidden} · 페르소나 이름 ${escapeHtml(ctx().name1 || '?')}`,
        `보낸 이: ${Object.entries(names).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, n]) => `${escapeHtml(k)} ${n}`).join(', ')}`,
        `extra.type: ${Object.entries(types).map(([k, n]) => `${escapeHtml(k)} ${n}`).join(', ') || '없음'}`,
        `통계에 잡힌 AI 답 ${st.ai} · 진행 ${st.proceeded} · 스와이프 ${st.rerolls}`,
    ].join('<br>'), '채팅 진단', { escapeHtml: false, timeOut: 12000 });
}

const DEV_ACTIONS = {
    month: () => openMonthly(pastMonths()[0] || today().slice(0, 7)),
    annivPreview: () => showCard({ kind: 'milestone', icon: 'fa-calendar-day', title: `내일은 ${josa(chatTitle(), '과', '와')} 함께한 지 100일이에요 (미리보기)`, body: '기념일 전날 이렇게 알려줘요', duration: 6000 }),
    chatDiag: () => devChatDiag(),
    gacha: () => devPreviewGacha(),
    ach1: () => devPreviewAchievements(1),
    ach5: () => devPreviewAchievements(5),
    msg: () => devPreviewMessageMilestone(),
    dday: () => devPreviewDday(),
    resetCeleb: () => toastr.info(devResetChatCelebrations() ? '이 채팅의 축하 기록을 지웠어요. 다시 들어오면 해당되는 D-day 축하가 떠요' : '채팅을 먼저 열어주세요'),
    rollover: () => devPreviewRollover(),
    words: () => devCountWords(),
    arrival: () => devArrivalPreview(),
    randomLetter: () => devRandomLetter(),
    letterInfo: () => {
        const i = letterDebugInfo();
        const conn = i.conn ? (i.conn.kind === 'profile' ? `프로필 (${i.conn.id})` : '메인 API') : '없음';
        let retry = '정상';
        if (i.gaveUp) retry = '오늘 3바퀴 모두 실패 — 내일 다시';
        else if (i.retryAt > Date.now()) retry = `${i.failStreak}번째 실패 · ${Math.ceil((i.retryAt - Date.now()) / 60000)}분 뒤 다시`;
        toastr.info([
            `편지 기능: ${i.on ? '켜짐' : '꺼짐'}`,
            `파일 불러옴: ${i.loaded ? '예' : '아니오'}`,
            `연결: ${escapeHtml(conn)}`,
            `저장된 대화 스냅샷: ${i.snaps}명`,
            `재시도: ${retry}`,
        ].join('<br>'), '편지 상태', { escapeHtml: false, timeOut: 9000 });
    },
};

function onSettingChanged(path, panel) {
    if (path === 'modules.gacha' || path === 'gacha.badge') {
        if (isOn('gacha') && getSettings().gacha.badge) renderAllBadges();
        else removeAllBadges();
    }
    if (path === 'modules.letters') {
        if (isOn('letters')) {
            resetLetterRetry();
            captureSnapshot();
            kickLetters(15000);
        } else {
            kickLetters();
        }
    }
    if (path === 'modules.achievements' && isOn('achievements')) evaluate();
    if (path === 'letters.connection') resetLetterRetry();
    if (path.startsWith('letters.')) kickLetters(15000);
    if (path.startsWith('colors.')) applyColors();
    if (path === 'dev') renderSettingsTab(panel, 'data');
}

async function withBusy(button, label, fn) {
    const prev = button.innerHTML;
    button.disabled = true;
    if (label) button.innerHTML = `${icon('fa-spinner', 'fa-spin')}<span>${label}</span>`;
    try {
        await fn();
    } finally {
        button.disabled = false;
        button.innerHTML = prev;
    }
}

function renderSettingsTab(panel, section = '') {
    panel.innerHTML = settingsHtml();
    const root = panel.querySelector('.tlr-settings');
    const conn = root.querySelector('#tlr_conn');
    fillConnectionOptions(conn);
    conn.addEventListener('focus', () => fillConnectionOptions(conn));
    conn.addEventListener('pointerdown', () => fillConnectionOptions(conn));
    syncControls(root);
    renderExcluded(root);
    updateWordErrors(root);

    root.querySelectorAll('[data-tlr]').forEach(el => {
        const handler = () => {
            const path = el.dataset.tlr;
            let value;
            if (el.type === 'checkbox') value = el.checked;
            else if (el.dataset.type === 'number') {
                value = Number(el.value);
                const min = el.getAttribute('min') ? Number(el.min) : -Infinity;
                const max = el.getAttribute('max') ? Number(el.max) : Infinity;
                if (el.value === '' || !Number.isFinite(value)) value = getPath(DEFAULTS, path);
                value = Math.min(max, Math.max(min, value));
            } else value = el.value;
            setPath(getSettings(), path, value);
            saveSettings();
            syncControls(root);
            if (path === 'words.groups') updateWordErrors(root);
            onSettingChanged(path, panel);
        };
        const isText = el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'color';
        el.addEventListener(isText ? 'input' : 'change', handler);
        if (el.type === 'range') el.addEventListener('input', handler);
        // 숫자 칸은 다 지우고 입력하는 중에 값이 튀지 않게, 칸을 벗어날 때 정리
        if (el.type === 'number') el.addEventListener('blur', () => { el.value = String(getPath(getSettings(), el.dataset.tlr)); });
    });

    root.querySelectorAll('[data-color-reset]').forEach(b => b.addEventListener('click', () => {
        getSettings().colors[b.dataset.colorReset] = '';
        saveSettings();
        applyColors();
        syncControls(root);
    }));

    root.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', () => {
        const path = b.dataset.reset;
        setPath(getSettings(), path, path === 'words.groups' ? DEFAULT_WORD_GROUPS : DEFAULT_ALIASES);
        saveSettings();
        syncControls(root);
        updateWordErrors(root);
    }));

    root.querySelector('[data-act="sound"]').addEventListener('click', () => playSound({ force: true }));
    root.querySelector('[data-act="card"]').addEventListener('click', () => showCard({
        kind: 'milestone', icon: 'fa-champagne-glasses', title: '메시지 1,000개 돌파! (미리보기)', body: '축하는 이런 느낌으로 떠요', sound: true, confetti: true,
    }));
    root.querySelector('#tlr_test_letter').addEventListener('click', (e) => withBusy(e.currentTarget, '편지 쓰는 중…', async () => {
        try {
            await testLetter();
        } catch (err) {
            toastr.warning(err?.message || String(err), '테스트 편지');
        }
    }));
    root.querySelector('#tlr_reset_settings').addEventListener('click', async () => {
        const c = ctx();
        const ok = await c.callGenericPopup('모든 설정을 처음 상태로 되돌릴까요? 단어 목록·모델 별명·색상·편지 설정도 기본값이 돼요. (기록은 그대로 남아요)', c.POPUP_TYPE.CONFIRM);
        if (!ok) return;
        resetSettings();
        resetLetterRetry();
        kickLetters();
        if (isOn('gacha') && getSettings().gacha.badge) renderAllBadges();
        else removeAllBadges();
        renderSettingsTab(panel);
        toastr.success('설정을 초기화했어요');
    });
    root.querySelector('#tlr_reset').addEventListener('click', async () => {
        const c = ctx();
        const ok = await c.callGenericPopup('통계·업적·영수증·편지 기록을 모두 지울까요? 되돌릴 수 없어요. (설정은 그대로 남아요)', c.POPUP_TYPE.CONFIRM);
        if (!ok) return;
        try {
            await stats.reset();
            await mail.reset();
            resetSessionCaches();
            updateWandBadge();
            toastr.success('기록을 초기화했어요');
        } catch (err) {
            toastr.error(err?.message || String(err), '초기화 실패');
        }
    });
    root.querySelectorAll('[data-dev]').forEach(b => b.addEventListener('click', (e) => {
        const button = e.currentTarget;
        withBusy(button, button.dataset.dev === 'randomLetter' ? '편지 쓰는 중…' : '', async () => {
            try {
                await DEV_ACTIONS[button.dataset.dev]?.();
            } catch (err) {
                toastr.warning(err?.message || String(err), '개발자 테스트');
            }
        });
    }));
    const offLetters = onLettersChanged(() => {
        if (!document.contains(root)) return offLetters();
        renderExcluded(root);
    });

    if (section) root.querySelector(`[data-section="${section}"]`)?.scrollIntoView({ block: 'start' });
}
