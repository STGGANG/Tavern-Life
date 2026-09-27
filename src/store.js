// 실리태번 설정(settings.json)은 저장할 때 확장 설정 전체를 통째로 덮어써서,
// PC 탭을 켜둔 채 폰으로 쓰면 오래된 쪽이 새 기록을 덮을 수 있다.
// 그래서 기록은 사용자 파일(data/<사용자>/user/files/)에 따로 두고,
// "내 로컬 사본"을 쓰는 대신 "변경 내역(op)"만 모았다가 저장할 때마다
// 서버의 최신 파일을 다시 읽어 그 위에 적용한다. 여러 기기·탭이 동시에 써도
// 서로의 기록을 지우지 않는다. op마다 id가 있어 같은 op가 두 번 적용되지 않는다.

import { ctx, safeLocalSet, randomId } from './util.js';

const KEEP_OP_IDS = 500;
const DEBOUNCE_MS = 3000;
const MAX_WAIT_MS = 15000;
const ORPHAN_AGE_MS = 60000;

const TAB_ID = randomId();

function walk(obj, path, create = true) {
    let cur = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') {
            if (!create) return [null, null];
            cur[k] = {};
        }
        cur = cur[k];
    }
    return [cur, path[path.length - 1]];
}

const BUILTIN = {
    inc(data, path, v) {
        const [o, k] = walk(data, path);
        o[k] = (Number(o[k]) || 0) + Number(v || 0);
    },
    max(data, path, v) {
        const [o, k] = walk(data, path);
        if (!(Number(o[k]) >= v)) o[k] = v;
    },
    set(data, path, v) {
        const [o, k] = walk(data, path);
        o[k] = v;
    },
    setIfAbsent(data, path, v) {
        const [o, k] = walk(data, path);
        if (o[k] === undefined) o[k] = v;
    },
    del(data, path) {
        const [o, k] = walk(data, path, false);
        if (o) delete o[k];
    },
};

function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
}

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export class FileStore {
    constructor({ file, defaults, reducers = {}, prune = () => { }, migrate = (d) => d }) {
        this.file = file;
        this.defaults = defaults;
        this.reducers = reducers;
        this.prune = prune;
        this.migrate = migrate;
        this.lsPrefix = `tlr:pending:${file}:`;
        this.lsKey = this.lsPrefix + TAB_ID;
        this.pending = [];
        this.view = defaults();
        this.loaded = false;
        this.loadedAt = 0;
        this.chain = Promise.resolve();
        this.flushTimer = null;
        this.firstPendingAt = 0;
        this.failCount = 0;
        this.listeners = new Set();
        this.adoptOrphans();
    }

    get data() {
        return this.view;
    }

    onChange(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    emit() {
        for (const fn of this.listeners) {
            try {
                fn(this.view);
            } catch (e) {
                console.error('[생활기록부]', e);
            }
        }
    }

    adoptOrphans() {
        try {
            const now = Date.now();
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith(this.lsPrefix) || key === this.lsKey) continue;
                const saved = JSON.parse(localStorage.getItem(key) || 'null');
                if (!saved || now - (saved.t || 0) < ORPHAN_AGE_MS) continue;
                if (Array.isArray(saved.ops)) this.pending.push(...saved.ops);
                localStorage.removeItem(key);
            }
        } catch { }
        if (this.pending.length) this.persistPending();
    }

    persistPending() {
        if (!this.pending.length) {
            safeLocalSet(this.lsKey, null);
            return;
        }
        if (this.pending.length > 3000) this.pending.splice(0, this.pending.length - 3000);
        safeLocalSet(this.lsKey, JSON.stringify({ t: Date.now(), ops: this.pending }));
    }

    applyOp(data, op) {
        if (!Array.isArray(data._ops)) data._ops = [];
        if (data._ops.includes(op.id)) return;
        for (const action of op.a) {
            const [kind, path, value] = action;
            try {
                if (BUILTIN[kind]) BUILTIN[kind](data, path, value);
                else if (kind === 'fn' && this.reducers[path]) this.reducers[path](data, value);
            } catch (e) {
                console.warn('[생활기록부] op 적용 실패', action, e);
            }
        }
        data._ops.push(op.id);
        if (data._ops.length > KEEP_OP_IDS) data._ops.splice(0, data._ops.length - KEEP_OP_IDS);
    }

    rebuildView(base) {
        const view = clone(base);
        for (const op of this.pending) this.applyOp(view, op);
        this.view = view;
    }

    commit(actions) {
        if (!actions?.length) return;
        const op = { id: randomId(), a: actions };
        this.pending.push(op);
        this.applyOp(this.view, op);
        this.persistPending();
        this.scheduleFlush();
        this.emit();
    }

    scheduleFlush(delay = DEBOUNCE_MS) {
        if (!this.firstPendingAt) this.firstPendingAt = Date.now();
        const waited = Date.now() - this.firstPendingAt;
        const wait = Math.max(0, Math.min(delay, MAX_WAIT_MS - waited));
        clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => this.flush(), wait);
    }

    async fetchRemote() {
        const res = await fetch(`/user/files/${this.file}?_=${Date.now()}`, { cache: 'no-store' });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`불러오기 실패 (HTTP ${res.status})`);
        const type = res.headers.get('content-type') || '';
        const text = await res.text();
        // 로그인 페이지 같은 HTML이 오면 절대 "빈 파일"로 취급하지 않는다 (덮어쓰기 방지)
        if (type.includes('text/html') || /^\s*</.test(text)) throw new Error('예상치 못한 응답');
        if (!text.trim()) return null;
        try {
            return JSON.parse(text);
        } catch {
            await this.upload(`${this.file.replace(/\.json$/, '')}.broken-${Date.now()}.json`, text, true);
            console.warn(`[생활기록부] ${this.file} 이(가) 손상되어 백업 후 새로 시작합니다`);
            return null;
        }
    }

    async upload(name, text, raw = false) {
        const res = await fetch('/api/files/upload', {
            method: 'POST',
            headers: ctx().getRequestHeaders(),
            body: JSON.stringify({ name, data: toBase64(raw ? text : JSON.stringify(text)) }),
        });
        if (!res.ok) throw new Error(`저장 실패 (HTTP ${res.status})`);
    }

    normalize(remote) {
        const base = remote && typeof remote === 'object' ? remote : this.defaults();
        const merged = { ...this.defaults(), ...base };
        return this.migrate(merged) || merged;
    }

    load() {
        this.chain = this.chain.then(async () => {
            const remote = await this.fetchRemote();
            this.rebuildView(this.normalize(remote));
            this.loaded = true;
            this.loadedAt = Date.now();
            this.emit();
        }).catch(e => {
            console.warn(`[생활기록부] ${this.file} 불러오기 실패`, e);
        });
        return this.chain;
    }

    flush() {
        clearTimeout(this.flushTimer);
        this.chain = this.chain.then(async () => {
            if (!this.pending.length) return;
            const ops = this.pending.slice();
            const latest = this.normalize(await this.fetchRemote());
            for (const op of ops) this.applyOp(latest, op);
            this.prune(latest);
            await this.upload(this.file, latest);
            this.pending.splice(0, ops.length);
            this.firstPendingAt = this.pending.length ? Date.now() : 0;
            this.persistPending();
            this.failCount = 0;
            this.rebuildView(latest);
            this.loaded = true;
            this.loadedAt = Date.now();
            if (this.pending.length) this.scheduleFlush();
        }).catch(e => {
            this.failCount++;
            const retry = Math.min(60000 * 2 ** (this.failCount - 1), 600000);
            console.warn(`[생활기록부] ${this.file} 저장 실패, ${Math.round(retry / 1000)}초 뒤 재시도`, e);
            clearTimeout(this.flushTimer);
            this.flushTimer = setTimeout(() => this.flush(), retry);
        });
        return this.chain;
    }

    async reset() {
        await this.chain;
        clearTimeout(this.flushTimer);
        this.pending = [];
        this.persistPending();
        const res = await fetch('/api/files/delete', {
            method: 'POST',
            headers: ctx().getRequestHeaders(),
            body: JSON.stringify({ path: `user/files/${this.file}` }),
        });
        if (!res.ok && res.status !== 404) throw new Error(`삭제 실패 (HTTP ${res.status})`);
        this.view = this.defaults();
        this.emit();
    }
}
