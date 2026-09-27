import { ctx, messageModel, prefersReducedMotion } from './util.js';
import { getSettings, isOn } from './settings.js';
import { showCard } from './celebrate.js';

// 실리태번 시스템 메시지 종류 (내레이터·코멘트·도움말 등). 다른 확장이 extra.type에 다른 값을 넣는 경우가 있어서 목록으로만 판단
const SYSTEM_TYPES = new Set(['help', 'welcome', 'empty', 'generic', 'narrator', 'comment', 'slash_commands', 'formatting', 'hotkeys', 'macros', 'welcome_prompt', 'assistant_note', 'assistant_message']);
export const isNarration = (m) => SYSTEM_TYPES.has(m?.extra?.type);
/**
 * 내가 보낸 메시지인지. is_user가 꺼진 채 저장된 채팅(다른 도구로 옮겨온 채팅 등)도 있어서
 * 페르소나 아바타·이름으로도 판단
 */
export function isUserMessage(m) {
    if (!m) return false;
    if (m.is_user) return true;
    if (isNarration(m)) return false;
    const fa = String(m.force_avatar || '');
    if (fa.includes('type=persona') || fa.includes('User Avatars/') || fa.includes('User%20Avatars/')) return true;
    const c = names();
    return !!m.name && m.name === c.name1 && m.name !== c.name2 && !c.groupId;
}

// getContext()는 매번 큰 객체를 만들어서, 긴 채팅을 훑을 때는 잠깐 캐시
let nameCache = null;
let nameCacheAt = 0;
function names() {
    const now = Date.now();
    if (!nameCache || now - nameCacheAt > 200) {
        const c = ctx();
        const group = c.groupId ? (c.groups || []).find(g => g.id === c.groupId) : null;
        nameCache = { name1: c.name1, name2: c.name2, groupId: c.groupId, groupSize: group?.members?.length || 1 };
        nameCacheAt = now;
    }
    return nameCache;
}
export const isAiMessage = (m) => !!m && !isUserMessage(m) && !isNarration(m);
/**
 * 인사말: 채팅 맨 앞의 AI 메시지 (그룹 채팅은 멤버 수만큼).
 * 유저 메시지 없이 AI 답만 이어 받는 채팅도 있어서 "첫 유저 메시지 앞 전부"로 보지 않음
 */
export function isGreeting(chat, i) {
    if (!chat[i] || isUserMessage(chat[i])) return false;
    const c = names();
    const limit = c.groupId ? Math.max(1, c.groupSize) : 1;
    let n = 0;
    for (let k = 0; k <= i; k++) {
        if (isUserMessage(chat[k])) return false;
        if (isNarration(chat[k])) continue;
        if (++n > limit) return false;
    }
    return n <= limit;
}

export const swipeTotal = (m) => (Array.isArray(m?.swipes) && m.swipes.length ? m.swipes.length : 1);

function tierOf(total) {
    if (total >= 10) return { key: 'ceil', label: '천장' };
    if (total >= 8) return { key: 'ur', label: 'UR' };
    if (total >= 6) return { key: 'ssr', label: 'SSR' };
    if (total >= 4) return { key: 'sr', label: 'SR' };
    if (total >= 2) return { key: 'r', label: 'R' };
    return null;
}

function findMessageEl(mesId) {
    return document.querySelector(`#chat .mes[mesid="${mesId}"]`);
}

export function renderBadge(mesId, { pop = false } = {}) {
    const el = findMessageEl(mesId);
    if (!el) return;
    let badge = el.querySelector('.tlr-badge');
    const s = getSettings();
    const chat = ctx().chat || [];
    const m = chat[mesId];
    const enabled = isOn('gacha') && s.gacha.badge;
    if (!enabled || !isAiMessage(m) || isGreeting(chat, mesId)) {
        badge?.remove();
        return;
    }
    const total = swipeTotal(m);
    const pos = (Number(m.swipe_id) || 0) + 1;
    const rolling = pos > total;
    if (!rolling && total < 2) {
        badge?.remove();
        return;
    }
    if (!badge) {
        // 전용 태그: 테마의 "이름 줄 span" 같은 규칙에 끌려가지 않게.
        // 시간 안에 붙여서 테마가 시간을 어디로 옮기든, 줄이 바뀌든 같이 다님 (시간을 숨긴 테마면 이름 뒤)
        badge = document.createElement('tlr-badge');
        const ts = el.querySelector('.ch_name .timestamp');
        const name = el.querySelector('.ch_name .name_text');
        if (ts && getComputedStyle(ts).display !== 'none') ts.appendChild(badge);
        else if (name) name.after(badge);
        else {
            const line = el.querySelector('.ch_name');
            if (!line) return;
            line.appendChild(badge);
        }
    }
    if (rolling) {
        badge.className = 'tlr-badge tlr-rolling';
        badge.textContent = `🎲 ${pos}연차`;
        badge.title = `${pos}번째 답을 뽑는 중…`;
        return;
    }
    const tier = tierOf(total);
    const proceeded = mesId < chat.length - 1;
    const popping = badge.classList.contains('tlr-pop');
    badge.className = `tlr-badge tlr-tier-${tier.key}${popping ? ' tlr-pop' : ''}`;
    badge.textContent = `${tier.label} ${pos}/${total}`;
    badge.title = proceeded
        ? `${total}번 뽑아서 ${pos}번째 답으로 진행했어요`
        : `${total}번 뽑았어요 · 지금 ${pos}번째 답을 보는 중`;
    if (pop && s.gacha.effect && !prefersReducedMotion()) {
        badge.classList.remove('tlr-pop');
        void badge.offsetWidth;
        badge.classList.add('tlr-pop');
        const done = (e) => {
            if (e.pseudoElement) return;
            badge.classList.remove('tlr-pop');
            badge.removeEventListener('animationend', done);
        };
        badge.addEventListener('animationend', done);
    }
}

export function renderAllBadges() {
    const nodes = document.querySelectorAll('#chat .mes[mesid]');
    for (const node of nodes) renderBadge(Number(node.getAttribute('mesid')));
}

export function removeAllBadges() {
    document.querySelectorAll('#chat .tlr-badge').forEach(b => b.remove());
}

const ROLL_TOASTS = {
    3: ['3연차', '두 번 다시 뽑았어요. 이번엔 마음에 들까요?'],
    5: ['5연차', '슬슬 손이 가는 대로 뽑는 중'],
    7: ['7연차 · SSR', '오늘 운은 여기서 쓰는 걸로'],
    10: ['10연차 · 천장', '프롬프트를 살짝 바꿔보는 건 어때요?'],
    15: ['15연차', '…존경합니다'],
};

export function rollToast(pulls, { force = false } = {}) {
    const s = getSettings();
    if (!force && (!isOn('gacha') || !s.gacha.toast)) return;
    const t = ROLL_TOASTS[pulls];
    if (t) showCard({ kind: 'gacha', icon: 'fa-dice', title: t[0], body: t[1], duration: 3200 });
}

export function devPreviewGacha() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        if (isAiMessage(chat[i])) {
            renderBadge(i, { pop: true });
            break;
        }
    }
    const keys = Object.keys(ROLL_TOASTS);
    rollToast(Number(keys[Math.floor(Math.random() * keys.length)]), { force: true });
}

export function computeChatStats() {
    const chat = ctx().chat || [];
    const out = {
        messages: chat.length,
        ai: 0,
        rerolls: 0,
        proceeded: 0,
        oneShot: 0,
        posSum: 0,
        dist: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6~9': 0, '10+': 0 },
        maxRoll: { n: 0, idx: -1 },
        models: {},
    };
    const last = chat.length - 1;

    chat.forEach((m, i) => {
        if (!isAiMessage(m) || isGreeting(chat, i)) return;
        out.ai++;
        const total = swipeTotal(m);
        out.rerolls += total - 1;
        if (total - 1 > out.maxRoll.n) out.maxRoll = { n: total - 1, idx: i };
        const model = String(messageModel(m) || '').trim() || '알 수 없음';
        out.models[model] = (out.models[model] || 0) + 1;
        if (i < last) {
            out.proceeded++;
            const pos = Math.min((Number(m.swipe_id) || 0) + 1, total);
            out.posSum += pos;
            const bucket = pos >= 10 ? '10+' : pos >= 6 ? '6~9' : String(pos);
            out.dist[bucket]++;
            if (total === 1) out.oneShot++;
        }
    });
    return out;
}
