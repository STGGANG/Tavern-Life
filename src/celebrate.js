import { getSettings } from './settings.js';
import { escapeHtml } from './util.js';
import { openModal } from './modal.js';

let audioCtx = null;

function getAudioCtx() {
    if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
    }
    return audioCtx;
}

// 모바일은 사용자 터치 후에만 소리가 나므로 첫 터치 때 깨워둔다
export function primeAudio() {
    const wake = () => {
        try {
            const ac = getAudioCtx();
            if (ac && ac.state === 'suspended') ac.resume();
        } catch { }
    };
    document.addEventListener('pointerdown', wake, { once: true, passive: true });
    document.addEventListener('keydown', wake, { once: true, passive: true });
}

function playChime(volume) {
    const ac = getAudioCtx();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume().catch(() => { });
    const master = ac.createGain();
    master.gain.value = 0.22 * volume;
    master.connect(ac.destination);
    const notes = [1046.5, 1318.5, 1568.0, 2093.0];
    const t0 = ac.currentTime + 0.02;
    notes.forEach((freq, i) => {
        const t = t0 + i * 0.075;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(1, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (i === notes.length - 1 ? 0.7 : 0.35));
        osc.connect(g).connect(master);
        osc.start(t);
        osc.stop(t + 0.75);
    });
    setTimeout(() => master.disconnect(), 1500);
}

export function playSound({ force = false } = {}) {
    const s = getSettings().effects;
    if (!s.sound && !force) return;
    const volume = Math.max(0, Math.min(1, (Number(s.volume) || 0) / 100));
    if (volume <= 0) return;
    try {
        if (s.soundUrl) {
            const audio = new Audio(s.soundUrl);
            audio.volume = volume;
            audio.play().catch(() => playChime(volume));
            return;
        }
        playChime(volume);
    } catch (e) {
        console.debug('[생활기록부] 알림음 재생 실패', e);
    }
}

const CONFETTI_COLORS = ['#ffb3c7', '#ffd88a', '#a8e6cf', '#a0c4ff', '#d7b8ff', '#fff3b0'];

export function confetti() {
    if (!getSettings().effects.confetti) return;
    const layer = document.createElement('div');
    layer.className = 'tlr-confetti';
    const count = window.innerWidth < 600 ? 14 : 20;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('i');
        p.style.left = `${5 + Math.random() * 90}%`;
        p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        p.style.animationDelay = `${Math.random() * 0.5}s`;
        p.style.animationDuration = `${1.8 + Math.random() * 0.9}s`;
        p.style.setProperty('--drift', `${(Math.random() - 0.5) * 80}px`);
        p.style.setProperty('--spin', `${(Math.random() - 0.5) * 540}deg`);
        if (i % 3 === 0) p.style.borderRadius = '50%';
        layer.appendChild(p);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3600);
}

const queue = [];
let showing = false;

function iconHtml(icon) {
    const v = String(icon || 'fa-star');
    return v.startsWith('fa-') ? `<i class="fa-solid ${escapeHtml(v)}" aria-hidden="true"></i>` : `<span class="tlr-emoji">${escapeHtml(v)}</span>`;
}

const BUNDLE_AT = 4;
let current = null;

export function showCard(card) {
    if (card.key && (current?.key === card.key || queue.some(c => c.key === card.key || c.items?.some(x => x.key === card.key)))) return;
    queue.push(card);
    if (!showing) nextCard();
}

function bundle(cards) {
    const items = cards.flatMap(c => c.items || [c]);
    return {
        kind: 'info',
        icon: 'fa-bell',
        title: `알림 ${items.length}개`,
        body: '눌러서 모아보기',
        sound: items.some(x => x.sound),
        duration: 9000,
        items,
        onClick: () => openAlertList(items),
    };
}

function openAlertList(items) {
    const box = document.createElement('div');
    box.className = 'tlr-alert-list';
    box.innerHTML = `
        <div class="tlr-alert-head"><span>알림 ${items.length}개</span>
            <button class="tlr-icon-btn" data-close title="닫기" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="tlr-list">${items.map((c, i) => `
            <${c.onClick ? 'button' : 'div'} class="tlr-list-item tlr-alert-item tlr-card-${escapeHtml(c.kind || 'info')}" data-i="${i}">
                <span class="tlr-card-icon">${iconHtml(c.icon)}</span>
                <span class="tlr-list-main"><span class="tlr-list-title">${escapeHtml(c.title)}</span>${c.body ? `<span class="tlr-list-sub">${escapeHtml(c.body)}</span>` : ''}</span>
                ${c.onClick ? '<i class="fa-solid fa-chevron-right tlr-list-go"></i>' : ''}
            </${c.onClick ? 'button' : 'div'}>`).join('')}
        </div>`;
    const modal = openModal({ content: box, className: 'tlr-overlay-alerts', label: '알림 모아보기' });
    box.querySelectorAll('button.tlr-alert-item').forEach(b => b.addEventListener('click', () => {
        modal.close();
        items[Number(b.dataset.i)].onClick?.();
    }));
}

function nextCard() {
    if (queue.length >= BUNDLE_AT - (current ? 1 : 0) && queue.length > 1) queue.splice(0, queue.length, bundle(queue));
    const card = queue.shift();
    current = card || null;
    if (!card) {
        showing = false;
        return;
    }
    showing = true;
    let host = document.getElementById('tlr-card-host');
    if (!host) {
        host = document.createElement('div');
        host.id = 'tlr-card-host';
        document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `tlr-ui tlr-card tlr-card-${card.kind || 'info'}${card.onClick ? ' tlr-card-link' : ''}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `
        <div class="tlr-card-icon">${iconHtml(card.icon)}</div>
        <div class="tlr-card-text">
            <div class="tlr-card-title">${escapeHtml(card.title)}</div>
            ${card.body ? `<div class="tlr-card-body">${escapeHtml(card.body)}</div>` : ''}
        </div>
        ${card.onClick ? '<i class="fa-solid fa-chevron-right tlr-card-go" aria-hidden="true"></i>' : ''}`;
    host.appendChild(el);
    if (card.sound) playSound();
    if (card.confetti) confetti();

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        el.classList.add('tlr-card-out');
        setTimeout(() => {
            el.remove();
            setTimeout(nextCard, 150);
        }, 280);
    };
    el.addEventListener('click', () => {
        try {
            card.onClick?.();
        } finally {
            close();
        }
    });
    requestAnimationFrame(() => el.classList.add('tlr-card-in'));
    setTimeout(close, card.duration || 4200);
}
