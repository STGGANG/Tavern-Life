// - 글꼴은 실제로 쓰인 글자가 들어 있는 조각만 넣어서 가볍게 (프리텐다드는 조각이 90개 가까이 됨)

const LIB_URL = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js';

let libPromise = null;
function loadLib() {
    if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
    libPromise ||= new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = LIB_URL;
        s.crossOrigin = 'anonymous';
        s.onload = () => (window.htmlToImage ? resolve(window.htmlToImage) : reject(new Error('이미지 도구를 불러오지 못했어요')));
        s.onerror = () => {
            libPromise = null;
            reject(new Error('이미지 도구를 불러오지 못했어요 (인터넷 연결 확인)'));
        };
        document.head.appendChild(s);
    });
    return libPromise;
}

const dataUrlCache = new Map();
async function toDataUrl(url) {
    if (dataUrlCache.has(url)) return dataUrlCache.get(url);
    const p = fetch(url).then(r => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
    }).then(blob => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
    }));
    dataUrlCache.set(url, p);
    p.catch(() => dataUrlCache.delete(url));
    return p;
}

function parseRanges(text) {
    if (!text) return null;
    return text.split(',').map(part => {
        const m = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
        if (!m) return null;
        if (m[1].includes('?')) return [parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'F'), 16)];
        const a = parseInt(m[1], 16);
        return [a, m[2] ? parseInt(m[2], 16) : a];
    }).filter(Boolean);
}

const clean = (f) => f.trim().replace(/^["']|["']$/g, '');

async function buildFontCss(root) {
    const families = new Set();
    const codes = new Set();
    const walk = (el) => {
        getComputedStyle(el).fontFamily.split(',').forEach(f => families.add(clean(f)));
        for (const ch of el.children) walk(ch);
    };
    walk(root);
    for (const ch of root.textContent) codes.add(ch.codePointAt(0));
    root.querySelectorAll('i[class*="fa-"]').forEach(i => {
        const c = getComputedStyle(i, '::before').content.replace(/["']/g, '');
        if (c) codes.add(c.codePointAt(0));
    });

    const faces = [];
    for (const sheet of document.styleSheets) {
        let rules;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }
        for (const rule of rules || []) {
            if (!(rule instanceof CSSFontFaceRule)) continue;
            if (!families.has(clean(rule.style.getPropertyValue('font-family')))) continue;
            const ranges = parseRanges(rule.style.getPropertyValue('unicode-range'));
            if (ranges && ![...codes].some(c => ranges.some(([a, b]) => c >= a && c <= b))) continue;
            faces.push({ css: rule.cssText, base: sheet.href || location.href });
        }
    }
    const out = await Promise.all(faces.map(async ({ css, base }) => {
        const urls = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map(m => m[2]).filter(u => !u.startsWith('data:'));
        let result = css;
        for (const u of urls) {
            try {
                result = result.split(u).join(await toDataUrl(new URL(u, base).href));
            } catch {
                return '';
            }
        }
        return result;
    }));
    return out.filter(Boolean).join('\n');
}

const isTouch = () => matchMedia('(pointer: coarse)').matches;

async function deliverFile(blob, fileName) {
    const file = new File([blob], fileName, { type: 'image/png' });
    if (isTouch() && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file] });
            return;
        } catch (e) {
            if (e?.name === 'AbortError') return;
        }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function saveAsImage(el, { fileName, padding = 24, background = '#e9e5dc' }) {
    const lib = await loadLib();
    const holder = document.createElement('div');
    holder.className = 'tlr-ui tlr-export-holder';
    holder.style.padding = `${padding}px`;
    holder.style.background = background;
    holder.style.width = `${Math.ceil(el.getBoundingClientRect().width) + padding * 2}px`;
    const clone = el.cloneNode(true);
    holder.appendChild(clone);
    document.body.appendChild(holder);
    try {
        await document.fonts?.ready;
        const fontEmbedCSS = await buildFontCss(holder);
        // 화면 밖에 두려고 준 위치 값이 이미지에 그대로 옮지 않게 덮어씀
        const blob = await lib.toBlob(holder, { pixelRatio: 2, fontEmbedCSS, cacheBust: false, style: { position: 'static', left: '0', top: '0', margin: '0' } });
        if (!blob) throw new Error('이미지를 만들지 못했어요');
        await deliverFile(blob, fileName);
    } finally {
        holder.remove();
    }
}
