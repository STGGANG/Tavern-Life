// 축하 기록은 채팅 메타데이터에 → 분기하면 같이 복사돼 같은 축하가 두 번 뜨지 않는다

import { ctx, parseSendDate, josa, num, formatDate, DAY_MS } from './util.js';
import { getSettings, isOn, today } from './settings.js';
import { stats } from './data.js';
import { showCard } from './celebrate.js';
import { unlock } from './achievements.js';

const META_KEY = 'tavern_life_record';
export const MESSAGE_MILESTONES = [100, 300, 500, 1000, 2000, 3000, 5000, 7000, 10000];
const PREVIEW_ACTIVE_DAYS = 60;
const CELEBRATE_WINDOW_DAYS = 7;

function chatMeta() {
    const md = ctx().chatMetadata;
    if (!md) return null;
    if (!md[META_KEY] || typeof md[META_KEY] !== 'object') md[META_KEY] = {};
    const m = md[META_KEY];
    if (!Array.isArray(m.m)) m.m = [];
    if (!Array.isArray(m.d)) m.d = [];
    return m;
}

export function chatTitle() {
    const c = ctx();
    if (c.groupId) {
        const g = (c.groups || []).find(x => x.id === c.groupId);
        return g?.name || '이 그룹';
    }
    return c.name2 || '캐릭터';
}

const midnight = (ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d;
};

export function parseAnnivList(text) {
    const out = [];
    for (const raw of String(text ?? '').split(/[,\s]+/)) {
        const m = /^(\d{1,5})\s*(y|년|주년)?$/i.exec(raw.trim());
        if (!m) continue;
        const n = Number(m[1]);
        if (!n) continue;
        if (m[2] && n <= 50) out.push({ key: `y${n}`, label: `${n}주년`, years: n });
        else if (!m[2]) out.push({ key: `d${n}`, label: `${n}일`, days: n });
    }
    return out.filter((x, i, a) => a.findIndex(y => y.key === x.key) === i);
}

function annivDates(first) {
    const start = midnight(first);
    const list = parseAnnivList(getSettings().anniv.days).map(x => {
        let date;
        if (x.days) date = new Date(start.getTime() + (x.days - 1) * DAY_MS);
        else {
            date = new Date(start);
            date.setFullYear(start.getFullYear() + x.years);
        }
        return { key: x.key, label: x.label, date: midnight(date) };
    });
    return list.sort((a, b) => a.date - b.date);
}

export function computeDday() {
    const chat = ctx().chat || [];
    const first = parseSendDate(chat[0]?.send_date);
    if (!first) return null;
    const start = midnight(first);
    const todayMid = midnight(Date.now());
    const dayNo = Math.round((todayMid - start) / DAY_MS) + 1;
    const list = annivDates(first);

    const upcoming = list.find(x => x.date >= todayMid);
    const next = upcoming ? { ...upcoming, inDays: Math.round((upcoming.date - todayMid) / DAY_MS) } : null;
    const recent = list.filter(x => x.date <= todayMid && (todayMid - x.date) / DAY_MS < CELEBRATE_WINDOW_DAYS);
    return { first, dayNo, next, recent };
}

function ddayCard(info, latest, suffix = '') {
    const name = chatTitle();
    const todayMid = midnight(Date.now());
    const ago = Math.round((todayMid - latest.date) / DAY_MS);
    showCard({
        kind: 'milestone',
        icon: latest.key.startsWith('y') ? 'fa-cake-candles' : 'fa-heart',
        title: (ago === 0
            ? `오늘은 ${josa(name, '과', '와')} 함께한 지 ${latest.label}!`
            : `${josa(name, '과', '와')} 함께한 지 ${latest.label}이 지났어요`) + suffix,
        body: ago === 0 ? `${formatDate(info.first)}에 처음 만났어요` : `${formatDate(latest.date.getTime())} · ${ago}일 전`,
        sound: true,
        confetti: true,
        duration: 5200,
    });
}

function messageCard(n, suffix = '') {
    showCard({
        kind: 'milestone',
        icon: 'fa-champagne-glasses',
        title: `메시지 ${num(n)}개 돌파!${suffix}`,
        body: `${josa(chatTitle(), '과', '와')} 나눈 이야기가 벌써 이만큼 쌓였어요`,
        sound: true,
        confetti: true,
        duration: 5000,
    });
}

export function devPreviewMessageMilestone() {
    const len = ctx().chat?.length || 0;
    messageCard(nextMessageMilestone(len) || MESSAGE_MILESTONES[0], ' (미리보기)');
}

export function devPreviewDday() {
    const info = computeDday() || { first: Date.now() };
    ddayCard(info, { key: 'd100', label: '100일', date: midnight(Date.now()) }, ' (미리보기)');
}

export function devResetChatCelebrations() {
    const meta = chatMeta();
    if (!meta) return false;
    meta.m = [];
    meta.d = [];
    ctx().saveMetadataDebounced();
    return true;
}

export function checkDdayOnEnter() {
    if (!isOn('milestones')) return;
    const info = computeDday();
    const meta = chatMeta();
    if (!info || !meta || !info.recent.length) return;
    const fresh = info.recent.filter(x => !meta.d.includes(x.key));
    if (!fresh.length) return;
    meta.d.push(...fresh.map(x => x.key));
    ctx().saveMetadataDebounced();

    ddayCard(info, fresh[fresh.length - 1]);
    if (info.dayNo >= 100) unlock('dday_100');
    if (info.dayNo >= 366) unlock('dday_365');
}

/** 채팅에 들어올 때 첫 메시지 날짜를 기억 (예고 알림이 채팅 파일을 열지 않고 계산하도록) */
export function rememberChatStart() {
    const c = ctx();
    const key = c.getCurrentChatId?.();
    const first = parseSendDate(c.chat?.[0]?.send_date);
    if (!key || !first || !stats.loaded) return;
    const cur = stats.data.anniv?.[key];
    const name = chatTitle();
    if (cur && cur.first === first && cur.name === name && Date.now() - (cur.seen || 0) < DAY_MS) return;
    stats.commit([['fn', 'annivSeen', { key, name, first, seen: Date.now() }]]);
}

export function checkAnnivPreview() {
    if (!isOn('milestones') || !getSettings().anniv.preview || !stats.loaded) return;
    const day = today();
    const meta = stats.data.meta || {};
    if (meta.annivDay === day) return;
    const tomorrow = midnight(Date.now()).getTime() + DAY_MS;
    const entries = Object.entries(stats.data.anniv || {})
        .filter(([, a]) => Date.now() - (a.seen || 0) < PREVIEW_ACTIVE_DAYS * DAY_MS)
        .sort((x, y) => (y[1].seen || 0) - (x[1].seen || 0));
    for (const [key, a] of entries) {
        const hit = annivDates(a.first).find(x => x.date.getTime() === midnight(tomorrow).getTime());
        if (!hit) continue;
        const doneKey = `${key}|${hit.key}`;
        if ((meta.annivDone || []).includes(doneKey)) continue;
        const done = [...(meta.annivDone || []), doneKey].slice(-40);
        stats.commit([['set', ['meta', 'annivDay'], day], ['set', ['meta', 'annivDone'], done]]);
        showCard({
            key: `anniv:${doneKey}`,
            kind: 'milestone',
            icon: hit.key.startsWith('y') ? 'fa-cake-candles' : 'fa-calendar-day',
            title: `내일은 ${josa(a.name, '과', '와')} 함께한 지 ${hit.label}이에요`,
            body: `${formatDate(a.first)}에 처음 만났어요`,
            duration: 6000,
        });
        return;
    }
}

/** 메시지 수가 기준선을 "넘는 순간"에만 축하 (분기·삭제 후 오작동 방지) */
export function checkMessageMilestone(prevLen, newLen) {
    if (!(newLen > prevLen)) return;
    const crossed = MESSAGE_MILESTONES.filter(n => prevLen < n && newLen >= n);
    if (!crossed.length || !isOn('milestones')) return;
    const meta = chatMeta();
    if (!meta) return;
    const fresh = crossed.filter(n => !meta.m.includes(n));
    if (!fresh.length) return;
    meta.m.push(...fresh);
    ctx().saveMetadataDebounced();
    messageCard(Math.max(...fresh));
}

export function nextMessageMilestone(len) {
    return MESSAGE_MILESTONES.find(n => n > len) || null;
}
