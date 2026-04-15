// ============================================================
// DAZURA AI ENGINE v5.3 + SEMANTIC TF-IDF
// Built by מוטי קריחלי 🏆
// ============================================================

const DazuraAI = (() => {

// ─────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────
const MAX_HISTORY = 20;
const MONTH_NAMES = ['', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const DAY_NAMES   = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAY_INDEX   = {ראשון:0, שני:1, שלישי:2, רביעי:3, חמישי:4, שישי:5, שבת:6};
const TYPE_ICON   = { full: '🏖️', half: '🌅', wfh: '🏠', sick: '🤒' };
const CREATOR     = 'מוטי קריחלי';

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
let history = [];
let ctx = { subject: null, dept: null, resultList: [], dateInfo: null };
let _pendingAction = null;

// ─────────────────────────────────────────────────────────
// SEMANTIC ENGINE (TF-IDF + Cosine Similarity)
// ─────────────────────────────────────────────────────────
const SemanticEngine = {
    kb: [],
    built: false,

    normalize(str) {
        return (str || '').toLowerCase()
            .replace(/[\u0591-\u05C7]/g, '')
            .replace(/[’”‘’\u05f3\u05f4]/g, '')
            .replace(/\s+/g, ' ').trim();
    },

    tokenize(text) {
        const stops = new Set(['של','על','ב','ל','מ','את','ה','ו','כן','לא','מה','מי','איך','למה','איפה','זה','שזה','עם','או','אבל','יותר','פחות']);
        return this.normalize(text).split(/\s+/).filter(w => w.length > 1 && !stops.has(w));
    },

    build() {
        if (this.kb.length === 0) return;
        const docs = this.kb.map(item => this.normalize(item.q || item.question) + " " + this.normalize(item.a || item.answer));
        const docTokens = docs.map(d => this.tokenize(d));

        const idf = {};
        const N = docs.length;
        docTokens.forEach(tokens => new Set(tokens).forEach(w => idf[w] = (idf[w] || 0) + 1));
        Object.keys(idf).forEach(w => idf[w] = Math.log(N / (idf[w] || 1)));

        this.kb.forEach((item, i) => {
            const tokens = docTokens[i];
            const tf = {};
            tokens.forEach(w => tf[w] = (tf[w] || 0) + 1);
            const vec = {};
            Object.keys(tf).forEach(w => { if (idf[w]) vec[w] = tf[w] * idf[w]; });

            let norm = Math.sqrt(Object.values(vec).reduce((a, b) => a + b * b, 0)) || 1;
            Object.keys(vec).forEach(w => vec[w] /= norm);
            item.vector = vec;
        });

        this.built = true;
        console.log(`✅ SemanticEngine: נבנה על ${this.kb.length} פריטי ידע`);
    },

    similarity(vec1, vec2) {
        let dot = 0;
        Object.keys(vec1).forEach(k => { if (vec2[k]) dot += vec1[k] * vec2[k]; });
        return dot;
    },

    search(query) {
        if (!this.built) this.build();
        if (this.kb.length === 0) return null;

        const qVec = {};
        this.tokenize(query).forEach(w => qVec[w] = (qVec[w] || 0) + 1);

        let best = { score: 0, item: null };
        this.kb.forEach(item => {
            if (!item.vector) return;
            const score = this.similarity(qVec, item.vector);
            if (score > best.score) {
                best.score = score;
                best.item = item;
            }
        });

        return best.score > 0.28 ? {
            answer: best.item.a || best.item.answer,
            confidence: best.score
        } : null;
    }
};

// ─────────────────────────────────────────────────────────
// UTILITIES (השאר כמו שהיה)
// ─────────────────────────────────────────────────────────
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function norm(str) {
    return (str || '').replace(/[\u0591-\u05C7]/g, '').replace(/[’”‘’\u05f4\u05f3]/g, '')
        .toLowerCase().trim().replace(/\s+/g, ' ');
}

function dateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function formatDate(d) {
    return d.getDate() + '/' + (d.getMonth()+1) + '/' + d.getFullYear() + ' (' + DAY_NAMES[d.getDay()] + ')';
}

function extractYear(text) {
    const m = text.match(/20[2-3]\d/);
    return m ? parseInt(m[0]) : new Date().getFullYear();
}

function fn(user) { return (user.fullName || '').split(' ')[0]; }

function isWeekendDay(d) { return d.getDay() === 5 || d.getDay() === 6; }

function isPublicHoliday(dateStr) {
    try {
        if (typeof HOLIDAYS === 'undefined') return false;
        const parts = dateStr.split('-');
        const key = parts[0] + '-' + parseInt(parts[1]) + '-' + parseInt(parts[2]);
        return !!(HOLIDAYS[key] && HOLIDAYS[key].blocked);
    } catch(e) { return false; }
}

// ─────────────────────────────────────────────────────────
// FUSE ENGINE (נשאר כמו שהיה)
// ─────────────────────────────────────────────────────────
class BuiltinFuse { /* ... כל הקלאס כמו שהיה אצלך ... */ }

// (השאר את כל פונקציות fuzzyFindEmployee, fuzzyFindDept, isAdmin, isMgr, parseDate כמו שהיו)

// ─────────────────────────────────────────────────────────
// ACTIONS ENGINE (נשאר כמו שהיה)
// ─────────────────────────────────────────────────────────
function detectActionType(t) { /* ... כמו שהיה ... */ }
function extractWeekdays(text) { /* ... */ }
function buildDateList(text, di) { /* ... */ }
function describeAction(actionType, dates, di) { /* ... */ }
function executeAction(actionType, dates, user, db) { /* ... */ }
function runActions(rawInput, user, db) { /* ... כל הפונקציה כמו שהיתה ... */ }

// ─────────────────────────────────────────────────────────
// BALANCE + STATS + HELP + CONVERSATION + LIVE DATA (נשארים כמו שהיו)
// ─────────────────────────────────────────────────────────
function calcBalance(...) { /* ... */ }
function respondHelp(...) { /* ... */ }
function runConversation(...) { /* ... */ }
function respondBalance(...) { /* ... */ }
function respondUsed(...) { /* ... */ }
// ... כל שאר הפונקציות של LIVE DATA

// ─────────────────────────────────────────────────────────
// KNOWLEDGE + SEMANTIC
// ─────────────────────────────────────────────────────────
const KB = [ /* כל ה-KB שלך נשאר כמו שהיה */ ];

function initSemanticEngine() {
    SemanticEngine.kb = [];
    if (typeof KB !== 'undefined') {
        KB.forEach(entry => {
            entry.q.forEach(qText => {
                SemanticEngine.kb.push({ q: qText, a: entry.a });
            });
        });
    }
    if (typeof AI_KNOWLEDGE !== 'undefined') {
        AI_KNOWLEDGE.forEach(item => {
            SemanticEngine.kb.push({
                q: item.q,
                a: Array.isArray(item.a) ? item.a[0] : item.a
            });
        });
    }
    SemanticEngine.build();
}

function runKnowledge(raw) {
    const t = norm(raw);

    // === SEMANTIC SEARCH קודם ===
    const semantic = SemanticEngine.search(t);
    if (semantic) {
        console.log(`🔍 Semantic Match: ${semantic.confidence.toFixed(2)}`);
        return semantic.answer + `\n\n(התאמה חכמה: ${Math.round(semantic.confidence * 100)}%)`;
    }

    // אם לא נמצא – המשך עם ה-Fuse הישן שלך
    for (const entry of KB) {
        if (entry.q.some(q => {
            const qn = norm(q);
            return t === qn || (qn.length >= 6 && t.includes(qn)) || (t.length >= 6 && qn.includes(t));
        })) return entry.a;
    }

    const fuse = getKBFuse(); // אם יש לך
    const results = fuse ? fuse.search(t) : [];
    if (results.length && results[0].score < 0.32) {
        return results[0].item._answer;
    }

    return null;
}

// ─────────────────────────────────────────────────────────
// FALLBACK
// ─────────────────────────────────────────────────────────
function runFallback(raw, user, db) {
    // ... כמו שהיה אצלך ...
    // (אפשר להוסיף כאן גם Semantic אם תרצה)
}

// ─────────────────────────────────────────────────────────
// MAIN respond()
// ─────────────────────────────────────────────────────────
function respond(rawInput, currentUser, db) {
    if (!rawInput?.trim()) return 'בבקשה הקלד שאלה.';
    if (!currentUser) return 'יש להתחבר למערכת.';

    history.push({role:'user', text:rawInput});
    if (history.length > MAX_HISTORY*2) history = history.slice(-MAX_HISTORY*2);

    let r = null;

    if (/^(עזרה|help|מה אתה יכול|מה ניתן לשאול)/.test(norm(rawInput)))
        r = respondHelp(currentUser, db);

    if (!r) r = runActions(rawInput, currentUser, db);
    if (!r) r = runConversation(rawInput, currentUser, db);
    if (!r) r = runLiveData(rawInput, currentUser, db);
    if (!r) r = runKnowledge(rawInput);        // כאן נכנס ה-Semantic
    if (!r) r = runFallback(rawInput, currentUser, db);

    history.push({role:'ai', text:r});
    return r;
}

function clearHistory() {
    history = [];
    ctx = { subject:null, dept:null, resultList:[], dateInfo:null };
    _pendingAction = null;
}

// ─────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────
initSemanticEngine();

console.log('🚀 DazuraAI v5.3 + Semantic TF-IDF מוכן!');

return { respond, clearHistory };

})();
