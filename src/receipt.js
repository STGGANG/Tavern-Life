import { escapeHtml, formatDayKey, formatDuration, josa, josaOnly, mergeByAlias, num, pct } from './util.js';
import { stats } from './data.js';
import { getSettings, isOn, today } from './settings.js';
import { ACH_BY_ID, unlock, evaluate } from './achievements.js';
import { showCard } from './celebrate.js';
import { openModal } from './modal.js';
import { saveAsImage } from './share.js';

const FOOTERS = [
    '이날도 수고 많았어요',
    '물 한 잔 마시고 시작해요',
    '다음 이야기도 기대할게요',
    '적립 포인트: 설렘 +1',
    '교환·환불 불가 (스와이프는 가능)',
];

export const hasActivity = (d) => !!d && ((d.sent || 0) + (d.recv || 0) + (d.swipes || 0)) > 0;

function row(label, value, cls = '') {
    return `<div class="tlr-r-row ${cls}"><span class="tlr-r-label">${escapeHtml(label)}</span><span class="tlr-r-dots" aria-hidden="true"></span><span class="tlr-r-val">${value}</span></div>`;
}

function section(tag, title, lines) {
    if (!lines.length) return '';
    return `<section class="tlr-r-sec"><div class="tlr-r-sec-title"><span class="tlr-r-tag">${escapeHtml(tag)}</span>${escapeHtml(title)}</div>${lines.join('')}</section>`;
}

const seedOf = (key) => [...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

function barcode(key) {
    let x = seedOf(key) || 1;
    const bars = [];
    for (let i = 0; i < 46; i++) {
        x = (x * 1103515245 + 12345) >>> 0;
        bars.push(`<i style="flex-grow:${1 + ((x >>> 8) % 3)}"></i>`);
    }
    return `<div class="tlr-r-barcode" aria-hidden="true">${bars.join('')}</div>`;
}

function receiptHtml(key, { live = false } = {}) {
    const d = stats.data.days?.[key] || {};
    const s = getSettings();
    const startHour = Number(s.receipt.dayStartHour) || 0;

    const basics = [
        row('활동 시간', `${formatDuration(d.activeMs || 0)}`),
        row('보낸 메시지', num(d.sent)),
        row('받은 답', num(d.recv)),
        row('새로 뽑은 답', num(d.swipes)),
    ];
    if (d.continues) basics.push(row('이어쓰기', num(d.continues)));
    if (d.adopt) basics.push(row('리롤 없이 진행', `${pct(d.oneShot || 0, d.adopt)}%`));

    const chars = Object.values(d.chars || {}).sort((a, b) => b.n - a.n).slice(0, 3)
        .map((c, i) => row(`${i + 1}  ${c.name}`, `${num(c.n)}턴`));

    const aliasText = s.words.aliases;
    const models = Object.entries(mergeByAlias(d.models, aliasText)).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([m, n]) => row(m, `${num(n)}회`));

    const wordLines = [];
    for (const [alias, words] of Object.entries(mergeByAlias(d.words, aliasText))) {
        for (const [label, n] of Object.entries(words || {})) wordLines.push({ alias, label, n });
    }
    wordLines.sort((a, b) => b.n - a.n);
    const WORD_LINES = 10;
    const words = wordLines.slice(0, WORD_LINES).map(w =>
        `<div class="tlr-r-word">${escapeHtml(josa(w.alias, '이', '가'))} ‘${escapeHtml(w.label)}’${josaOnly(w.label, '을', '를')} <b>${num(w.n)}번</b> 썼어요</div>`);

    if (wordLines.length > WORD_LINES) words.push(`<div class="tlr-r-word tlr-r-more">외 ${wordLines.length - WORD_LINES}건</div>`);

    const extras = [];
    if (d.longest?.chars) extras.push(row(`가장 긴 답 · ${d.longest.name || ''}`, `${num(d.longest.chars)}자`));
    if (d.letters) extras.push(row('받은 편지', `${num(d.letters)}통`));
    const achList = (d.ach || []).map(id => ACH_BY_ID[id]).filter(Boolean);
    const ach = achList.map(a => `<div class="tlr-r-ach"><span class="tlr-emoji">${escapeHtml(a.icon)}</span>${escapeHtml(a.name)}</div>`);

    const turns = (d.sent || 0) + (d.recv || 0);
    const footer = FOOTERS[seedOf(key) % FOOTERS.length];
    const no = key.replace(/-/g, '').slice(2);

    return `
    <article class="tlr-receipt">
        ${achList.length ? `<div class="tlr-r-stamp" aria-hidden="true"><span>업적</span><b>+${achList.length}</b></div>` : ''}
        <header class="tlr-r-head">
            <div class="tlr-r-title">생활기록부</div>
            <div class="tlr-r-meta"><span>${escapeHtml(formatDayKey(key))}</span><span>No.${escapeHtml(no)}</span></div>
            ${live ? '<div class="tlr-r-live">진행 중</div>' : ''}
        </header>
        ${section('ITEMS', '활동', basics)}
        ${section('CAST', '함께한 캐릭터', chars)}
        ${section('MODEL', '사용한 모델', models)}
        ${section('WORDS', '단어 체크', words)}
        ${section('EXTRA', '기타', extras)}
        ${section('BADGE', '새로 딴 업적', ach)}
        <div class="tlr-r-total"><span>합계</span><span><i class="fa-solid fa-heart" aria-hidden="true"></i> ${num(turns)}턴</span></div>
        ${barcode(key)}
        <footer class="tlr-r-foot">
            <div>${escapeHtml(footer)}</div>
            <div class="tlr-r-small">${startHour ? `하루 기준 · ${startHour}시` : '하루 기준 · 자정'}</div>
        </footer>
    </article>`;
}

export function openReceipt(key, { live = false } = {}) {
    return openPaper(receiptHtml(key, { live }), `receipt-${key}.png`, '생활기록부 영수증');
}

function openPaper(html, fileName, label) {
    const stage = document.createElement('div');
    stage.className = 'tlr-receipt-stage';
    stage.innerHTML = `
        <div class="tlr-receipt-actions">
            <button class="tlr-icon-btn tlr-receipt-save" title="이미지로 저장" aria-label="이미지로 저장"><i class="fa-solid fa-image"></i></button>
            <button class="tlr-icon-btn" data-close title="닫기" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="tlr-printer" aria-hidden="true"><span></span></div>
        <div class="tlr-receipt-roll">${html}</div>`;
    stage.querySelector('.tlr-receipt-save').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
            await saveAsImage(stage.querySelector('.tlr-receipt'), { fileName, background: '#2b2b2e' });
        } catch (err) {
            toastr.warning(err?.message || String(err), '이미지 저장');
        } finally {
            btn.disabled = false;
        }
    });
    return openModal({ content: stage, className: 'tlr-overlay-receipt', label }).closed;
}

export function devPreviewRollover() {
    const past = pastDays();
    return past.length ? openReceipt(past[0]) : openReceipt(today(), { live: true });
}

export function pastDays() {
    const t = today();
    return Object.keys(stats.data.days || {}).filter(k => k < t && hasActivity(stats.data.days[k])).sort().reverse();
}

let popupOpen = false;

const monthOf = (dayKeyStr) => dayKeyStr.slice(0, 7);
export const monthLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;

function monthHtml(ym) {
    const s = getSettings();
    const cal = Object.entries(stats.data.cal || {}).filter(([k]) => monthOf(k) === ym);
    const days = Object.entries(stats.data.days || {}).filter(([k]) => monthOf(k) === ym).map(([, d]) => d);
    const sum = (f) => days.reduce((a, d) => a + (Number(f(d)) || 0), 0);
    const turns = cal.reduce((a, [, n]) => a + n, 0);
    const best = cal.sort((a, b) => b[1] - a[1])[0];

    const basics = [
        row('롤플한 날', `${num(cal.length)}일`),
        row('주고받은 턴', `${num(turns)}턴`),
    ];
    if (best) basics.push(row(`가장 많이 한 날 · ${formatDayKey(best[0]).slice(5)}`, `${num(best[1])}턴`));
    if (days.length) {
        basics.push(row('활동 시간', formatDuration(sum(d => d.activeMs))));
        basics.push(row('새로 뽑은 답', num(sum(d => d.swipes))));
    }

    const chars = {};
    for (const d of days) for (const [k, c] of Object.entries(d.chars || {})) {
        const t = (chars[k] ||= { name: c.name, n: 0 });
        t.n += c.n;
    }
    const cast = Object.values(chars).sort((a, b) => b.n - a.n).slice(0, 3).map((c, i) => row(`${i + 1}  ${c.name}`, `${num(c.n)}턴`));

    const models = {};
    const words = {};
    for (const d of days) {
        for (const [m, n] of Object.entries(d.models || {})) models[m] = (models[m] || 0) + n;
        for (const [m, w] of Object.entries(d.words || {})) {
            const t = (words[m] ||= {});
            for (const [label, n] of Object.entries(w)) t[label] = (t[label] || 0) + n;
        }
    }
    const modelRows = Object.entries(mergeByAlias(models, s.words.aliases)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m, n]) => row(m, `${num(n)}회`));
    const wordList = [];
    for (const [alias, w] of Object.entries(mergeByAlias(words, s.words.aliases))) for (const [label, n] of Object.entries(w)) wordList.push({ alias, label, n });
    const wordRows = wordList.sort((a, b) => b.n - a.n).slice(0, 3).map(w =>
        `<div class="tlr-r-word">${escapeHtml(josa(w.alias, '이', '가'))} ‘${escapeHtml(w.label)}’${josaOnly(w.label, '을', '를')} <b>${num(w.n)}번</b> 썼어요</div>`);

    const ach = days.flatMap(d => d.ach || []).map(id => ACH_BY_ID[id]).filter(Boolean)
        .map(a => `<div class="tlr-r-ach"><span class="tlr-emoji">${escapeHtml(a.icon)}</span>${escapeHtml(a.name)}</div>`);
    const extras = [];
    const letters = sum(d => d.letters);
    if (letters) extras.push(row('받은 편지', `${num(letters)}통`));

    return `
    <article class="tlr-receipt tlr-receipt-month">
        ${ach.length ? `<div class="tlr-r-stamp" aria-hidden="true"><span>업적</span><b>+${ach.length}</b></div>` : ''}
        <header class="tlr-r-head">
            <div class="tlr-r-title">${escapeHtml(`${Number(ym.slice(5, 7))}월의 생활기록부`)}</div>
            <div class="tlr-r-meta"><span>${escapeHtml(monthLabel(ym))}</span><span>No.${escapeHtml(ym.replace('-', ''))}</span></div>
            <div class="tlr-r-live">월간 결산</div>
        </header>
        ${section('MONTH', '한 달', basics)}
        ${section('CAST', '함께한 캐릭터', cast)}
        ${section('MODEL', '사용한 모델', modelRows)}
        ${section('WORDS', '이달의 단어', wordRows)}
        ${section('EXTRA', '기타', extras)}
        ${section('BADGE', '새로 딴 업적', ach)}
        <div class="tlr-r-total"><span>합계</span><span><i class="fa-solid fa-heart" aria-hidden="true"></i> ${num(turns)}턴</span></div>
        ${barcode(ym)}
        <footer class="tlr-r-foot">
            <div>한 달 동안 수고 많았어요</div>
            ${days.length < cal.length ? '<div class="tlr-r-small">일부 날짜는 기록 보관 기간이 지나 턴 수만 셌어요</div>' : ''}
        </footer>
    </article>`;
}

export function openMonthly(ym) {
    return openPaper(monthHtml(ym), `receipt-${ym}.png`, '월간 결산');
}

export function pastMonths() {
    const cur = monthOf(today());
    return [...new Set(Object.keys(stats.data.cal || {}).map(monthOf))].filter(m => m < cur).sort().reverse();
}

function checkMonthly() {
    if (!isOn('receipt')) return;
    const meta = stats.data.meta || {};
    const months = pastMonths();
    const target = months[0];
    if (!target || (meta.monthShown && target <= meta.monthShown)) return;
    stats.commit([['set', ['meta', 'monthShown'], target]]);
    showCard({
        key: `month:${target}`,
        kind: 'receipt',
        icon: 'fa-calendar-check',
        title: `${Number(target.slice(5, 7))}월 결산이 나왔어요`,
        body: '눌러서 한 달 영수증 보기',
        onClick: () => openMonthly(target),
        duration: 8000,
    });
}

export function checkRollover(trigger, isBusy = () => false) {
    if (!stats.loaded) return;
    checkMonthly();
    const t = today();
    const meta = stats.data.meta || {};
    const days = stats.data.days || {};
    const shown = meta.receiptShown || '';
    const fresh = Object.keys(days).filter(k => k < t && k > shown && hasActivity(days[k])).sort();
    if (!fresh.length) return;
    const target = fresh[fresh.length - 1];

    const actions = [['set', ['meta', 'receiptShown'], target]];
    if (isOn('receipt')) actions.push(['inc', ['life', 'receipts'], 1]);
    stats.commit(actions);

    for (const k of fresh) {
        const d = days[k];
        if ((d.recv || 0) >= 20 && !(d.swipes || 0)) unlock('clean_day');
    }
    evaluate();

    if (!isOn('receipt')) return;
    const open = () => {
        if (popupOpen) return;
        popupOpen = true;
        openReceipt(target).finally(() => { popupOpen = false; });
    };
    const s = getSettings();
    if (s.receipt.autoShow && trigger !== 'chat' && !isBusy() && !document.hidden) {
        setTimeout(open, 800);
    } else {
        showCard({ kind: 'receipt', icon: 'fa-receipt', title: '지난 하루의 영수증이 나왔어요', body: `${formatDayKey(target)} · 눌러서 보기`, onClick: open, duration: 7000 });
    }
}
