import { stats } from './data.js';
import { getSettings, isOn, today } from './settings.js';
import { modelAlias } from './util.js';
import { showCard } from './celebrate.js';

const count = (o) => (o && typeof o === 'object' ? Object.keys(o).length : 0);
const modelCount = (life) => {
    const aliases = getSettings().words.aliases;
    return new Set(Object.keys(life.models || {}).filter(k => k !== '알 수 없음').map(k => modelAlias(k, aliases))).size;
};

export const ACHIEVEMENTS = [
    { id: 'first_msg', icon: '👋', name: '첫 인사', desc: '첫 메시지 보내기', tier: 'normal', goal: 1, value: l => l.sent },
    { id: 'sent_100', icon: '💬', name: '수다 한 판', desc: '메시지 100개 보내기', tier: 'normal', goal: 100, value: l => l.sent },
    { id: 'sent_1000', icon: '📚', name: '이야기꾼', desc: '메시지 1,000개 보내기', tier: 'normal', goal: 1000, value: l => l.sent },
    { id: 'swipe_1', icon: '🎲', name: '첫 리롤', desc: '스와이프로 답 처음 다시 뽑기', tier: 'normal', goal: 1, value: l => l.swipes },
    { id: 'swipe_100', icon: '🎰', name: '가챠 입문', desc: '스와이프 100번', tier: 'normal', goal: 100, value: l => l.swipes },
    { id: 'streak_3', icon: '📅', name: '사흘 연속', desc: '3일 연속으로 롤플하기', tier: 'normal', goal: 3, value: l => l.bestStreak },
    { id: 'streak_7', icon: '🗓️', name: '개근상', desc: '7일 연속으로 롤플하기', tier: 'normal', goal: 7, value: l => l.bestStreak },
    { id: 'chars_5', icon: '🤝', name: '인사 나누기', desc: '캐릭터 5명과 대화하기', tier: 'normal', goal: 5, value: l => count(l.chars) },
    { id: 'models_3', icon: '🍱', name: '편식 금지', desc: '모델 3종류 이상 써보기', tier: 'normal', goal: 3, value: modelCount },
    { id: 'receipt_1', icon: '🧾', name: '첫 영수증', desc: '하루 영수증 처음 받기', tier: 'normal', goal: 1, value: l => l.receipts },
    { id: 'letter_1', icon: '💌', name: '우편함 개시', desc: '부재중 편지 처음 받기', tier: 'normal', goal: 1, value: l => l.lettersRecv },
    { id: 'oneshot_5', icon: '🍀', name: '오늘은 운이 좋아', desc: '5턴 연속 리롤 없이 진행하기', tier: 'normal', goal: 5, value: l => l.bestOneShot },
    { id: 'continue_10', icon: '➡️', name: '이어서 해줘', desc: '이어쓰기 10번', tier: 'normal', goal: 10, value: l => l.continues },
    { id: 'dday_100', icon: '💯', name: '백일잔치', desc: '한 채팅에서 100일 맞이하기', tier: 'normal' },
    { id: 'meta_10', icon: '🎖️', name: '수집 시작', desc: '업적 10개 달성', tier: 'normal', goal: 10, value: (l, d) => count(d.ach) },
    { id: 'sent_300', icon: '🗨️', name: '수다쟁이', desc: '메시지 300개 보내기', tier: 'normal', goal: 300, value: l => l.sent },
    { id: 'streak_5', icon: '🔆', name: '닷새 연속', desc: '5일 연속으로 롤플하기', tier: 'normal', goal: 5, value: l => l.bestStreak },
    { id: 'chars_10', icon: '👥', name: '발 넓은 사람', desc: '캐릭터 10명과 대화하기', tier: 'normal', goal: 10, value: l => count(l.chars) },
    { id: 'letter_3', icon: '📬', name: '답장 대기 중', desc: '부재중 편지 3통 받기', tier: 'normal', goal: 3, value: l => l.lettersRecv },
    { id: 'receipt_30', icon: '🗂️', name: '영수증 수집가', desc: '하루 영수증 30장 받기', tier: 'normal', goal: 30, value: l => l.receipts },
    { id: 'meta_20', icon: '🎗️', name: '업적 사냥꾼', desc: '업적 20개 달성', tier: 'normal', goal: 20, value: (l, d) => count(d.ach) },

    { id: 'night_owl', icon: '🦉', name: '새벽 4시의 롤플러', desc: '새벽 3~5시 사이에 메시지 보내기', tier: 'fun' },
    { id: 'early_bird', icon: '🐤', name: '아침형 인간', desc: '아침 6~8시 사이에 메시지 보내기', tier: 'fun' },
    { id: 'friday_night', icon: '🍻', name: '불금', desc: '금요일 밤 10시 이후에 롤플하기', tier: 'fun' },
    { id: 'terse', icon: '🤐', name: '과묵한 자', desc: '3글자 이하로 답장하기', tier: 'fun' },
    { id: 'perfectionist', icon: '✏️', name: '완벽주의자', desc: '메시지 편집 50번', tier: 'fun', goal: 50, value: l => l.edits },
    { id: 'revisionist', icon: '🗑️', name: '없던 일로 하자', desc: '메시지 삭제 30번', tier: 'fun', goal: 30, value: l => l.deletes },
    { id: 'stop_30', icon: '✋', name: '급브레이크', desc: '생성 중지 30번', tier: 'fun', goal: 30, value: l => l.stops },
    { id: 'impersonate_20', icon: '🎭', name: '대필 작가', desc: 'AI에게 내 대사 대신 쓰게 하기 20번', tier: 'fun', goal: 20, value: l => l.impersonates },
    { id: 'roll_20', icon: '🌀', name: '운명을 거스르는 자', desc: '한 메시지에서 10번 다시 뽑기', tier: 'fun', goal: 10, value: l => l.maxRoll },
    { id: 'back_to_first', icon: '🔁', name: '돌고 돌아 첫 번째', desc: '5번 넘게 뽑고 결국 첫 번째 답으로 진행하기', tier: 'fun' },
    { id: 'greedy', icon: '🧺', name: '싹쓸이', desc: '하루에 스와이프 100번', tier: 'fun' },
    { id: 'rapid', icon: '🔥', name: '속사포', desc: '1분 안에 메시지 5개 보내기', tier: 'fun' },
    { id: 'slop_100', icon: '🐺', name: '짐승 조련사', desc: '체크 단어가 누적 100번 등장', tier: 'fun', goal: 100, value: l => l.wordsTotal },
    { id: 'long_reply', icon: '📜', name: '두루마리', desc: '5,000자 넘는 답 받기', tier: 'fun', goal: 5000, value: l => l.longestReply },
    { id: 'marathon', icon: '🏃', name: '물 좀 마셔요', desc: '하루 활동 시간 5시간 넘기기', tier: 'fun' },
    { id: 'comeback', icon: '🚪', name: '돌아온 탕아', desc: '7일 넘게 쉬었다가 돌아오기', tier: 'fun' },
    { id: 'swipe_1000', icon: '💸', name: '가챠 중독', desc: '스와이프 1,000번', tier: 'fun', goal: 1000, value: l => l.swipes },
    { id: 'chars_30', icon: '🐙', name: '문어발', desc: '캐릭터 30명과 대화하기', tier: 'fun', goal: 30, value: l => count(l.chars) },
    { id: 'midnight', icon: '🕛', name: '신데렐라', desc: '정확히 자정(0시 0분)에 메시지 보내기', tier: 'fun', hidden: true },
    { id: 'christmas', icon: '🎄', name: '메리 롤플마스', desc: '크리스마스에 롤플하기', tier: 'fun', hidden: true },
    { id: 'newyear', icon: '🎍', name: '새해 첫 롤플', desc: '1월 1일에 롤플하기', tier: 'fun', hidden: true },
    { id: 'fourth_wall', icon: '🪟', name: '벽 너머의 편지', desc: '제4의 벽을 넘어온 편지 받기', tier: 'fun', hidden: true },
    { id: 'swipe_3000', icon: '🎡', name: '가챠 중수', desc: '스와이프 3,000번', tier: 'fun', goal: 3000, value: l => l.swipes },
    { id: 'letter_10', icon: '🖋', name: '펜팔', desc: '부재중 편지 10통 받기', tier: 'fun', goal: 10, value: l => l.lettersRecv },
    { id: 'slop_300', icon: '🔍', name: '슬롭 감별사', desc: '체크 단어가 누적 300번 등장', tier: 'fun', goal: 300, value: l => l.wordsTotal },

    { id: 'sent_10000', icon: '🖋️', name: '전설의 필력', desc: '메시지 10,000개 보내기', tier: 'hard', goal: 10000, value: l => l.sent },
    { id: 'swipe_10000', icon: '🏦', name: '가챠 재벌', desc: '스와이프 10,000번', tier: 'hard', goal: 10000, value: l => l.swipes },
    { id: 'streak_30', icon: '🏅', name: '한 달 개근', desc: '30일 연속으로 롤플하기', tier: 'hard', goal: 30, value: l => l.bestStreak },
    { id: 'days_365', icon: '🌳', name: '연중무휴', desc: '롤플한 날 누적 365일', tier: 'hard', goal: 365, value: l => l.activeDays },
    { id: 'chars_100', icon: '🏰', name: '대가족', desc: '캐릭터 100명과 대화하기', tier: 'hard', goal: 100, value: l => count(l.chars) },
    { id: 'models_6', icon: '🧪', name: '모델 감별사', desc: '모델 6종류 이상 써보기', tier: 'hard', goal: 6, value: modelCount },
    { id: 'oneshot_20', icon: '🎯', name: '망설임 없는 자', desc: '20턴 연속 리롤 없이 진행하기', tier: 'hard', goal: 20, value: l => l.bestOneShot },
    { id: 'slop_1000', icon: '🦴', name: '슬롭 도감 완성', desc: '체크 단어가 누적 1,000번 등장', tier: 'hard', goal: 1000, value: l => l.wordsTotal },
    { id: 'chat_1000', icon: '🏯', name: '천일야화', desc: '한 채팅에서 메시지 1,000개 넘기기', tier: 'hard' },
    { id: 'dday_365', icon: '🎂', name: '1주년', desc: '한 채팅에서 1년 맞이하기', tier: 'hard' },
    { id: 'clean_day', icon: '💎', name: '무결점 하루', desc: '하루에 답 20개 넘게 받으면서 스와이프 0번', tier: 'hard' },
    { id: 'roll_50', icon: '🫠', name: '천장 뚫기', desc: '한 메시지에서 20번 다시 뽑기', tier: 'hard', goal: 20, value: l => l.maxRoll, hidden: true },
    { id: 'meta_30', icon: '🏆', name: '명예의 전당', desc: '업적 30개 달성', tier: 'hard', goal: 30, value: (l, d) => count(d.ach) },
    { id: 'sent_3000', icon: '☕', name: '단골손님', desc: '메시지 3,000개 보내기', tier: 'hard', goal: 3000, value: l => l.sent },
    { id: 'streak_14', icon: '📆', name: '2주 개근', desc: '14일 연속으로 롤플하기', tier: 'hard', goal: 14, value: l => l.bestStreak },
    { id: 'days_100', icon: '🌱', name: '백일장', desc: '롤플한 날 누적 100일', tier: 'hard', goal: 100, value: l => l.activeDays },
    { id: 'oneshot_10', icon: '🏹', name: '직감', desc: '10턴 연속 리롤 없이 진행하기', tier: 'hard', goal: 10, value: l => l.bestOneShot },
];

export const ACH_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

export const TIER_LABEL = { normal: '평범', hard: '도전', fun: '재미' };

const cardFor = (a) => ({ key: `ach:${a.id}`, kind: 'achievement', icon: a.icon, title: `업적 달성 · ${a.name}`, body: a.desc, sound: true });

export function devPreviewAchievements(n = 1) {
    for (const a of [...ACHIEVEMENTS].sort(() => Math.random() - 0.5).slice(0, n)) showCard(cardFor(a));
}

export function unlock(id) {
    if (!isOn('achievements') || !stats.loaded) return;
    const def = ACH_BY_ID[id];
    if (!def || stats.data.ach?.[id]) return;
    stats.commit([['fn', 'unlock', { id, ts: Date.now(), day: today() }]]);
    showCard(cardFor(def));
    evaluate();
}

export function evaluate() {
    if (!isOn('achievements') || !stats.loaded) return;
    const data = stats.data;
    const life = data.life || {};
    for (const def of ACHIEVEMENTS) {
        if (!def.value || data.ach?.[def.id]) continue;
        if ((Number(def.value(life, data)) || 0) >= def.goal) unlock(def.id);
    }
}

export function progressOf(def) {
    if (!def.value) return null;
    const data = stats.data;
    const cur = Math.min(Number(def.value(data.life || {}, data)) || 0, def.goal);
    return { cur, goal: def.goal };
}
