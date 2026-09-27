export const ctx = () => SillyTavern.getContext();

export const DAY_MS = 86400000;

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(ts, startHour = 0) {
    const d = new Date(ts - startHour * 3600000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function keyToDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function prevDayKey(key) {
    const d = keyToDate(key);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysBetweenKeys(a, b) {
    return Math.round((keyToDate(b) - keyToDate(a)) / DAY_MS);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function formatDayKey(key) {
    const d = keyToDate(key);
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${WEEKDAYS[d.getDay()]})`;
}

export function formatDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

export function formatDateTime(ts) {
    const d = new Date(ts);
    return `${formatDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDuration(ms) {
    const min = Math.round(ms / 60000);
    if (min < 1) return '1분 미만';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (!h) return `${m}분`;
    return m ? `${h}시간 ${m}분` : `${h}시간`;
}

export function parseSendDate(value) {
    if (!value) return 0;
    try {
        const m = ctx().timestampToMoment(value);
        if (m && m.isValid()) return m.valueOf();
    } catch { }
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
}

export const num = (n) => Number(n || 0).toLocaleString('ko-KR');

export const pct = (a, b) => {
    const x = Number(a) || 0;
    const y = Number(b) || 0;
    return y > 0 ? Math.round((x / y) * 100) : 0;
};

function hasBatchim(word) {
    const ch = [...String(word).trim()].pop();
    if (!ch) return false;
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 !== 0;
    if (/[0-9]/.test(ch)) return '013678'.includes(ch); // 영 일 삼 육 칠 팔
    if (/[a-z]/i.test(ch)) return 'lmnr'.includes(ch.toLowerCase()); // 엘 엠 엔 알
    return false;
}

export const josa = (word, withBatchim, without) => `${word}${hasBatchim(word) ? withBatchim : without}`;

export const josaOnly = (word, withBatchim, without) => (hasBatchim(word) ? withBatchim : without);

export function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function cleanText(text) {
    return String(text ?? '')
        .replace(/<(status|choice|image_generation|details|summary|pic)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<pic\s[^>]*>/gi, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

export function detectLanguage(text) {
    const s = String(text ?? '');
    const hangul = (s.match(/[가-힣]/g) || []).length;
    const kana = (s.match(/[぀-ヿ]/g) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    const han = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    if (hangul >= kana && hangul * 2 >= latin && hangul > 0) return 'ko';
    if (!kana && !hangul && han > 0 && han * 2 >= latin) return 'zh';
    if (kana > 0 && kana * 2 >= latin * 0.5) return 'ja';
    return latin > 0 ? 'en' : 'ko';
}

export const DEFAULT_ALIASES = [
    'gemini = 제미니',
    'claude, opus, sonnet, haiku = 클로드',
    'deepseek = 딥시크',
    'gpt, chatgpt, /(^|[/:])o[1-9]/ = GPT',
    'glm, zhipu, z-ai = GLM',
    'grok = 그록',
    'kimi, moonshot = 키미',
    'qwen = 큐웬',
    'mistral, mixtral = 미스트랄',
    'llama = 라마',
].join('\n');

function parseRegexLiteral(term) {
    const m = /^\/(.+)\/([a-z]*)$/i.exec(term);
    if (!m) return null;
    try {
        return new RegExp(m[1], m[2].replace(/[gy]/g, ''));
    } catch {
        return undefined;
    }
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let aliasCache = { text: null, rules: [] };

function compileAliases(text) {
    if (aliasCache.text === text) return aliasCache.rules;
    const rules = [];
    for (const raw of String(text ?? '').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.lastIndexOf('=');
        if (eq < 0) continue;
        const alias = line.slice(eq + 1).trim();
        if (!alias) continue;
        const tests = [];
        for (const t of line.slice(0, eq).split(',').map(x => x.trim()).filter(Boolean)) {
            const re = parseRegexLiteral(t);
            if (re === undefined) continue;
            tests.push(re ? (s) => re.test(s) : (s) => s.includes(t.toLowerCase()));
        }
        if (tests.length) rules.push({ alias, tests });
    }
    aliasCache = { text, rules };
    return rules;
}

export function modelAlias(modelId, aliasText) {
    const id = String(modelId ?? '').trim();
    if (!id) return '알 수 없음';
    const lower = id.toLowerCase();
    for (const rule of compileAliases(aliasText)) {
        if (rule.tests.some(test => test(lower))) return rule.alias;
    }
    const tail = id.split('/').pop();
    return tail.length > 28 ? `${tail.slice(0, 27)}…` : tail;
}

export function mergeByAlias(obj, aliasText) {
    const out = {};
    for (const [key, v] of Object.entries(obj || {})) {
        const a = key === '알 수 없음' ? key : modelAlias(key, aliasText);
        if (typeof v === 'number') out[a] = (out[a] || 0) + v;
        else if (v && typeof v === 'object') {
            const t = (out[a] ||= {});
            for (const [k, n] of Object.entries(v)) if (typeof n === 'number') t[k] = (t[k] || 0) + n;
        }
    }
    return out;
}

export function messageModel(msg) {
    return msg?.extra?.model || msg?.swipe_info?.[msg?.swipe_id]?.extra?.model || msg?.extra?.api || '';
}

export const DEFAULT_WORD_GROUPS = [
    '짐승 = 짐승, beast, けだもの, ケダモノ, 獣のよう, 獣じみ',
    '포식자 = 포식자, 포식적, predator, predatory, 捕食者',
    '변수 = 변수, variable, 変数',
    '서늘한 = 서늘',
    '활처럼 휘었다 = 활처럼 휘, 활창처럼 휘, arched like a bow, arching like a bow, arches like a bow, 弓なりに, 弓のように反',
    '뇌수 = /뇌수(?!술)/, 脳髄',
    '육봉 = 육봉, meat rod, 肉棒',
    '소유욕 = 소유욕, possessive, 独占欲, 所有欲',
    '얄팍한 = 얄팍, 알량, 薄っぺら',
].join('\n');

export const LEGACY_WORD_GROUPS = [
    '짐승 = 짐승, beast, けだもの, ケダモノ, 獣のよう, 獣じみ',
    '포식자 = 포식자, 포식적, predator, predatory, 捕食者',
    '변수 = 변수, variable, 変数',
    '서늘한 = 서늘',
].join('\n');

const isLatinTerm = (t) => /^[\x20-\x7E]+$/.test(t);

let wordCache = { text: null, groups: [], errors: [] };

export function compileWordGroups(text) {
    if (wordCache.text === text) return wordCache;
    const groups = [];
    const errors = [];
    for (const raw of String(text ?? '').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        const terms = (eq >= 0 ? line.slice(eq + 1) : line).split(',').map(x => x.trim()).filter(Boolean);
        const label = (eq >= 0 ? line.slice(0, eq).trim() : terms[0]) || terms[0];
        if (!label || !terms.length) continue;
        const parts = [];
        for (const t of terms) {
            const re = parseRegexLiteral(t);
            if (re === undefined) {
                errors.push(t);
                continue;
            }
            if (re) parts.push(`(?:${re.source})`);
            else if (isLatinTerm(t)) parts.push(`\\b${escapeRegex(t)}`);
            else parts.push(escapeRegex(t));
        }
        if (!parts.length) continue;
        try {
            groups.push({ label, re: new RegExp(parts.join('|'), 'gi') });
        } catch {
            errors.push(line);
        }
    }
    wordCache = { text, groups, errors };
    return wordCache;
}

export function countWords(text, groups) {
    const out = {};
    if (!text) return out;
    for (const { label, re } of groups) {
        re.lastIndex = 0;
        const n = (text.match(re) || []).length;
        if (n) out[label] = (out[label] || 0) + n;
    }
    return out;
}

export function debounce(fn, ms) {
    let t = null;
    const wrapped = (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
}

export function safeLocalSet(key, value) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch { }
}

export function prefersReducedMotion() {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

export function avatarThumb(avatar) {
    return avatar ? `/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}` : '';
}

export function randomId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
