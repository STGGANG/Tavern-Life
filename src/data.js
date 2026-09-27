import { FileStore } from './store.js';
import { dayKey, DAY_MS } from './util.js';

const DAYS_KEEP = 62;
const LETTERS_READ_KEEP_DAYS = 45;
const LETTERS_UNREAD_KEEP_DAYS = 90;
const LETTERS_MAX = 60;
const SNAPS_KEEP_DAYS = 120;
const SNAPS_MAX = 50;
const MAIL_LOG_KEEP_DAYS = 14;
const CAL_KEEP_DAYS = 1100;
const ANNIV_MAX = 60;

export const stats = new FileStore({
    file: 'tavern-life-record.stats.json',
    defaults: () => ({
        v: 1,
        life: {},
        days: {},
        ach: {},
        meta: {},
        cal: {},
        anniv: {},
    }),
    reducers: {
        dayActive(data, { day, prev }) {
            const life = data.life;
            if (life.lastActiveDay && life.lastActiveDay >= day) return;
            life.streak = life.lastActiveDay === prev ? (life.streak || 0) + 1 : 1;
            life.bestStreak = Math.max(life.bestStreak || 0, life.streak);
            life.activeDays = (life.activeDays || 0) + 1;
            life.prevActiveDay = life.lastActiveDay || null;
            life.lastActiveDay = day;
        },
        longest(data, { day, chars, name }) {
            const d = (data.days[day] ||= {});
            if (!d.longest || d.longest.chars < chars) d.longest = { chars, name };
        },
        unlock(data, { id, ts, day }) {
            if (data.ach[id]) return;
            data.ach[id] = ts;
            const d = (data.days[day] ||= {});
            (d.ach ||= []).push(id);
        },
        annivSeen(data, { key, name, first, seen }) {
            data.anniv[key] = { name, first, seen };
        },
        charSeen(data, { day, key, name }) {
            const d = (data.days[day] ||= {});
            const c = ((d.chars ||= {})[key] ||= { name, n: 0 });
            c.name = name;
            c.n++;
            (data.life.chars ||= {})[key] = 1;
        },
    },
    migrate(data) {
        if (!data.cal || typeof data.cal !== 'object') data.cal = {};
        if (!data.anniv || typeof data.anniv !== 'object') data.anniv = {};
        for (const [k, d] of Object.entries(data.days || {})) {
            const turns = (d.sent || 0) + (d.recv || 0);
            if (turns && !data.cal[k]) data.cal[k] = turns;
        }
        return data;
    },
    prune(data) {
        const cutoff = dayKey(Date.now() - DAYS_KEEP * DAY_MS);
        for (const k of Object.keys(data.days)) if (k < cutoff) delete data.days[k];
        const calCutoff = dayKey(Date.now() - CAL_KEEP_DAYS * DAY_MS);
        for (const k of Object.keys(data.cal)) if (k < calCutoff) delete data.cal[k];
        const anniv = Object.entries(data.anniv).sort((a, b) => (b[1].seen || 0) - (a[1].seen || 0)).slice(0, ANNIV_MAX);
        data.anniv = Object.fromEntries(anniv);
    },
});

export const mail = new FileStore({
    file: 'tavern-life-record.mail.json',
    defaults: () => ({
        v: 1,
        snaps: {},
        letters: [],
        log: {},
    }),
    reducers: {
        snap(data, snap) {
            const cur = data.snaps[snap.avatar];
            if (cur && (cur.lastActive || 0) > (snap.lastActive || 0)) return;
            data.snaps[snap.avatar] = snap;
        },
        snapDel(data, { avatar }) {
            delete data.snaps[avatar];
        },
        addLetter(data, letter) {
            if (data.letters.some(l => l.id === letter.id)) return;
            data.letters.push(letter);
        },
        patchLetter(data, { id, patch }) {
            const l = data.letters.find(x => x.id === id);
            if (l) Object.assign(l, patch);
        },
        delLetter(data, { id }) {
            data.letters = data.letters.filter(l => l.id !== id);
        },
    },
    migrate(data) {
        if (!Array.isArray(data.letters)) data.letters = [];
        if (!data.snaps || typeof data.snaps !== 'object') data.snaps = {};
        if (!data.log || typeof data.log !== 'object') data.log = {};
        return data;
    },
    prune(data) {
        const now = Date.now();
        const starred = data.letters.filter(l => l.star);
        const rest = data.letters
            .filter(l => !l.star && now - l.ts < (l.read ? LETTERS_READ_KEEP_DAYS : LETTERS_UNREAD_KEEP_DAYS) * DAY_MS)
            .sort((a, b) => b.ts - a.ts)
            .slice(0, LETTERS_MAX);
        data.letters = [...starred, ...rest];
        const snaps = Object.values(data.snaps)
            .filter(s => now - (s.lastActive || 0) < SNAPS_KEEP_DAYS * DAY_MS)
            .sort((a, b) => b.lastActive - a.lastActive)
            .slice(0, SNAPS_MAX);
        data.snaps = Object.fromEntries(snaps.map(s => [s.avatar, s]));
        const cutoff = dayKey(now - MAIL_LOG_KEEP_DAYS * DAY_MS);
        for (const k of Object.keys(data.log)) if (k < cutoff) delete data.log[k];
    },
});
