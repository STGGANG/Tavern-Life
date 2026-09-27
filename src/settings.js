import { ctx, dayKey, DEFAULT_ALIASES, DEFAULT_WORD_GROUPS, LEGACY_WORD_GROUPS } from './util.js';

const MODULE_KEY = 'tavernLifeRecord';
const SETTINGS_VERSION = 2;

export const DEFAULTS = {
    modules: {
        gacha: true,
        achievements: true,
        milestones: true,
        receipt: true,
        words: true,
        letters: false,
    },
    gacha: {
        badge: true,
        effect: true,
        toast: true,
    },
    effects: {
        confetti: true,
        sound: true,
        volume: 50,
        soundUrl: '',
    },
    receipt: {
        dayStartHour: 5,
        autoShow: true,
    },
    anniv: {
        days: '5, 10, 30, 100, 200, 1y, 3y',
        preview: true,
    },
    words: {
        groups: DEFAULT_WORD_GROUPS,
        aliases: DEFAULT_ALIASES,
    },
    letters: {
        mode: 'inworld',
        mixRatio: 30,
        minAbsentDays: 3,
        maxInactiveDays: 30,
        dailyMax: 2,
        perAbsenceMax: 3,
        resetDays: 10,
        contextCount: 10,
        lang: 'auto',
        fourthView: 'same',
        connection: 'auto',
        extraPrompt: '',
        excluded: [],
    },
    colors: {
        accent: '',
        point: '',
        receipt: '',
    },
    dev: false,
    v: 0,
};

export const COLOR_DEFAULTS = {
    accent: '#e18a24',
    point: '#ff7aa2',
    receipt: '#fbf8f1',
};

function fillDefaults(target, defaults) {
    for (const [k, v] of Object.entries(defaults)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
            fillDefaults(target[k], v);
        } else if (target[k] === undefined || (typeof target[k] !== typeof v)) {
            target[k] = Array.isArray(v) ? [...v] : v;
        }
    }
    return target;
}

const stripComments = (text) => String(text ?? '').split('\n').filter(l => !l.trim().startsWith('#')).join('\n').trim();

function migrate(s) {
    if ((s.v || 0) >= SETTINGS_VERSION) return false;
    const groups = stripComments(s.words.groups);
    s.words.groups = groups === LEGACY_WORD_GROUPS ? DEFAULT_WORD_GROUPS : groups;
    s.words.aliases = stripComments(s.words.aliases);
    s.v = SETTINGS_VERSION;
    return true;
}

let checked = false;

export function getSettings() {
    const all = ctx().extensionSettings;
    if (!all[MODULE_KEY] || typeof all[MODULE_KEY] !== 'object') all[MODULE_KEY] = {};
    const s = fillDefaults(all[MODULE_KEY], DEFAULTS);
    if (!checked) {
        checked = true;
        if (migrate(s)) saveSettings();
    }
    return s;
}

export function resetSettings() {
    ctx().extensionSettings[MODULE_KEY] = {};
    checked = false;
    getSettings();
    saveSettings();
    applyColors();
}

export function saveSettings() {
    ctx().saveSettingsDebounced();
}

export const isOn = (module) => !!getSettings().modules[module];

export const today = (ts = Date.now()) => dayKey(ts, Number(getSettings().receipt.dayStartHour) || 0);

const COLOR_VARS = {
    accent: '--tlr-c-accent',
    point: '--tlr-c-point',
    receipt: '--tlr-c-receipt',
};

export function applyColors() {
    const colors = getSettings().colors;
    const root = document.documentElement;
    for (const [key, cssVar] of Object.entries(COLOR_VARS)) {
        const v = String(colors[key] || '').trim();
        if (/^#[0-9a-f]{3,8}$/i.test(v)) root.style.setProperty(cssVar, v);
        else root.style.removeProperty(cssVar);
    }
}
