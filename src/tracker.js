// 실리태번은 메시지 이벤트 처리가 끝날 때까지 기다리므로, 여기서는 네트워크를 기다리지 않고 바로 끝낸다.

import { ctx, cleanText, compileWordGroups, countWords, daysBetweenKeys, messageModel, prevDayKey } from './util.js';
import { stats } from './data.js';
import { getSettings, isOn, today } from './settings.js';
import { evaluate, unlock } from './achievements.js';
import { isAiMessage, isGreeting, isNarration, isUserMessage, renderBadge, rollToast, swipeTotal } from './gacha.js';

const ACTIVE_GAP_MS = 10 * 60000;
const IGNORED_TYPES = new Set(['first_message', 'command', 'extension', 'impersonate', 'quiet']);
const CONTINUE_TYPES = new Set(['continue', 'append', 'appendFinal']);

let lastActivity = 0;
let lastDayMarked = null;
let generating = false;
let continueBase = null;
const recentSends = [];
const adoptedKeys = new Set();
const recentEdits = new Map();

export const isGenerating = () => generating;
export const lastActivityAt = () => lastActivity;

/** 기록용 모델 키: 실제 모델 이름 그대로 (별명은 보여줄 때 적용 → 별명을 바꿔도 지난 기록에 반영됨) */
function modelKeyOf(msg) {
    return String(messageModel(msg) || '').trim().slice(0, 120) || '알 수 없음';
}

function charKeyOf(msg) {
    const c = ctx();
    if (msg?.original_avatar) return msg.original_avatar;
    if (!c.groupId && c.characterId !== undefined && c.characters[c.characterId]) return c.characters[c.characterId].avatar;
    const found = c.characters.find(x => x.name === msg?.name);
    return found?.avatar || `name:${msg?.name || '?'}`;
}

function activity(now, acts) {
    const day = today(now);
    const prevActive = stats.data.life?.lastActiveDay;
    let firstOfDay = false;
    if (lastDayMarked !== day) {
        lastDayMarked = day;
        if (!prevActive || prevActive < day) {
            firstOfDay = true;
            acts.push(['fn', 'dayActive', { day, prev: prevDayKey(day) }]);
        }
    }
    if (lastActivity && now - lastActivity <= ACTIVE_GAP_MS && now > lastActivity) {
        acts.push(['inc', ['days', day, 'activeMs'], now - lastActivity]);
    }
    lastActivity = now;
    acts.push(['setIfAbsent', ['days', day, 'firstTs'], now]);
    acts.push(['max', ['days', day, 'lastTs'], now]);
    return { day, firstOfDay, prevActive };
}

function afterActivity({ day, firstOfDay, prevActive }) {
    if (firstOfDay && prevActive && daysBetweenKeys(prevActive, day) > 7) unlock('comeback');
    if ((stats.data.days?.[day]?.activeMs || 0) >= 5 * 3600000) unlock('marathon');
}

function timeAchievements(now) {
    const d = new Date(now);
    const h = d.getHours();
    if (h >= 3 && h < 5) unlock('night_owl');
    if (h >= 6 && h < 8) unlock('early_bird');
    if (d.getDay() === 5 && h >= 22) unlock('friday_night');
    if (h === 0 && d.getMinutes() === 0) unlock('midnight');
    if (d.getMonth() === 11 && d.getDate() === 25) unlock('christmas');
    if (d.getMonth() === 0 && d.getDate() === 1) unlock('newyear');
}

function bumpChatSwipes() {
    const md = ctx().chatMetadata;
    if (!md) return;
    const m = (md.tavern_life_record ||= {});
    m.swipes = (Number(m.swipes) || 0) + 1;
}

function recordAdoption(chat, mesId, day, acts) {
    const c = ctx();
    let j = mesId - 1;
    while (j >= 0 && isNarration(chat[j])) j--;
    const prev = chat[j];
    if (!prev || !isAiMessage(prev) || isGreeting(chat, j)) return false;
    const total = swipeTotal(prev);
    const key = `${c.getCurrentChatId()}|${j}|${prev.send_date}|${total}`;
    if (adoptedKeys.has(key)) return false;
    adoptedKeys.add(key);
    if (adoptedKeys.size > 300) adoptedKeys.delete(adoptedKeys.values().next().value);
    const pos = Math.min((Number(prev.swipe_id) || 0) + 1, total);
    const bucket = pos >= 10 ? '10+' : pos >= 6 ? '6~9' : String(pos);
    const alias = modelKeyOf(prev);
    acts.push(
        ['inc', ['life', 'adopt'], 1],
        ['inc', ['days', day, 'adopt'], 1],
        ['inc', ['life', 'adoptPos', bucket], 1],
        ['inc', ['life', 'models', alias, 'adopt'], 1],
        ['inc', ['life', 'models', alias, 'posSum'], pos],
    );
    if (total === 1) {
        const streak = (Number(stats.data.life?.oneShotStreak) || 0) + 1;
        acts.push(
            ['inc', ['life', 'oneShot'], 1],
            ['inc', ['days', day, 'oneShot'], 1],
            ['inc', ['life', 'models', alias, 'oneShot'], 1],
            ['set', ['life', 'oneShotStreak'], streak],
            ['max', ['life', 'bestOneShot'], streak],
        );
        return false;
    }
    acts.push(['set', ['life', 'oneShotStreak'], 0]);
    return pos === 1 && total > 5;
}

export function onMessageSent(mesId) {
    const c = ctx();
    const chat = c.chat || [];
    const msg = chat[mesId];
    if (!isUserMessage(msg)) return;
    const now = Date.now();
    const acts = [];
    const act = activity(now, acts);
    const { day } = act;
    acts.push(['inc', ['life', 'sent'], 1], ['inc', ['days', day, 'sent'], 1], ['inc', ['cal', day], 1]);

    const backToFirst = recordAdoption(chat, mesId, day, acts);
    stats.commit(acts);

    afterActivity(act);
    timeAchievements(now);
    if (backToFirst) unlock('back_to_first');
    const text = String(msg.mes || '').trim();
    if (text && [...text].length <= 3) unlock('terse');
    recentSends.push(now);
    while (recentSends.length && now - recentSends[0] > 60000) recentSends.shift();
    if (recentSends.length >= 5) unlock('rapid');
    if (chat.length >= 1000) unlock('chat_1000');
    evaluate();
}

export function onMessageReceived(mesId, type) {
    if (IGNORED_TYPES.has(type)) return;
    const c = ctx();
    const chat = c.chat || [];
    const msg = chat[mesId];
    if (!isAiMessage(msg) || isGreeting(chat, mesId)) return;

    const isSwipe = type === 'swipe';
    const isContinue = CONTINUE_TYPES.has(type);
    const full = String(msg.mes || '');
    let text = full;
    if (isContinue) {
        const base = continueBase;
        continueBase = null;
        if (base && base.mesId === mesId && base.chatId === c.getCurrentChatId() && full.startsWith(base.text)) {
            text = full.slice(base.text.length);
        } else if (base && base.mesId === mesId) {
            text = full.slice(Math.min(base.text.length, full.length));
        }
    }
    const cleanedFull = cleanText(full);
    if (!cleanedFull && !isContinue) return;

    const now = Date.now();
    const acts = [];
    const act = activity(now, acts);
    const { day } = act;
    const alias = modelKeyOf(msg);
    let backToFirstRecv = false;

    if (isContinue) {
        acts.push(['inc', ['life', 'continues'], 1], ['inc', ['days', day, 'continues'], 1]);
    } else {
        acts.push(
            ['inc', ['life', 'recv'], 1],
            ['inc', ['days', day, 'recv'], 1],
            ['inc', ['days', day, 'models', alias], 1],
            ['inc', ['life', 'models', alias, 'recv'], 1],
            ['inc', ['cal', day], 1],
            ['fn', 'charSeen', { day, key: charKeyOf(msg), name: msg.name || c.name2 || '?' }],
        );
        if (isSwipe) acts.push(['inc', ['life', 'swipes'], 1], ['inc', ['days', day, 'swipes'], 1]);
        else if (recordAdoption(chat, mesId, day, acts)) backToFirstRecv = true;
    }

    const chars = [...cleanedFull].length;
    if (!isContinue) acts.push(['inc', ['life', 'models', alias, 'chars'], chars], ['inc', ['life', 'models', alias, 'lenN'], 1]);
    acts.push(['fn', 'longest', { day, chars, name: msg.name || c.name2 || '' }], ['max', ['life', 'longestReply'], chars]);

    if (isOn('words')) {
        const { groups } = compileWordGroups(getSettings().words.groups);
        const counts = countWords(isContinue ? cleanText(text) : cleanedFull, groups);
        for (const [label, n] of Object.entries(counts)) {
            acts.push(
                ['inc', ['days', day, 'words', alias, label], n],
                ['inc', ['life', 'words', alias, label], n],
                ['inc', ['life', 'wordsTotal'], n],
            );
        }
    }

    const rerolls = swipeTotal(msg) - 1;
    if (isSwipe) acts.push(['max', ['life', 'maxRoll'], rerolls]);
    if (isSwipe) bumpChatSwipes();
    stats.commit(acts);

    afterActivity(act);
    if (isSwipe) {
        renderBadge(mesId, { pop: true });
        rollToast(rerolls + 1);
        if ((stats.data.days?.[day]?.swipes || 0) >= 100) unlock('greedy');
    }
    if (backToFirstRecv) unlock('back_to_first');
    if (chat.length >= 1000) unlock('chat_1000');
    evaluate();
}

export function onGenerationStarted(type, _opts, dryRun) {
    if (dryRun || type === 'quiet') return;
    generating = true;
    const c = ctx();
    if (type === 'continue') {
        const chat = c.chat || [];
        const i = chat.length - 1;
        continueBase = { chatId: c.getCurrentChatId(), mesId: i, text: String(chat[i]?.mes || '') };
    }
    if (type === 'regenerate') stats.commit([['inc', ['life', 'regens'], 1]]);
}

export function onGenerationEnded() {
    generating = false;
    lastActivity = Math.max(lastActivity, Date.now());
}

export function onGenerationStopped() {
    if (generating) {
        stats.commit([['inc', ['life', 'stops'], 1]]);
        evaluate();
    }
    generating = false;
}

export function onSwipeBrowse() {
    const acts = [];
    const act = activity(Date.now(), acts);
    stats.commit(acts);
    afterActivity(act);
}

export function onMessageEdited(mesId) {
    // 다른 확장이 연달아 고치는 경우를 감안해 같은 메시지는 5초에 한 번만 센다
    const now = Date.now();
    const key = `${ctx().getCurrentChatId()}|${mesId}`;
    if (now - (recentEdits.get(key) || 0) < 5000) return;
    recentEdits.set(key, now);
    if (recentEdits.size > 50) recentEdits.delete(recentEdits.keys().next().value);
    stats.commit([['inc', ['life', 'edits'], 1]]);
    evaluate();
}

export function onMessageDeleted() {
    // "재생성"은 생성 시작 직후 실리태번이 마지막 답을 지우고 다시 만든다 → 사용자가 지운 게 아님
    if (generating) return;
    stats.commit([['inc', ['life', 'deletes'], 1]]);
    evaluate();
}

export function onImpersonated() {
    stats.commit([['inc', ['life', 'impersonates'], 1]]);
    evaluate();
}

export function resetSessionCaches() {
    lastDayMarked = null;
    adoptedKeys.clear();
    recentEdits.clear();
}
