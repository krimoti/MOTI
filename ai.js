// ============================================================
// DAZURA AI ENGINE v5.2 + FUSE + ACTIONS
// Built by מוטי קריחלי 🏆
//
// ארכיטקטורה — Pipeline של 6 שלבים:
//   1. HELP         — עזרה / מה אתה יכול
//   2. ACTIONS      — ביצוע פעולות (חדש בv5.2)
//   3. CONVERSATION — שיחה חופשית (לפני הכל — אין DB)
//   4. LIVE_DATA    — נתונים חיים מה-DB + Fuse לשמות/מחלקות
//   5. KNOWLEDGE    — שאלות מערכת (Fuse לתיקון כתיב)
//   6. FALLBACK     — הצעות חכמות לפי הקשר
//
// פעולות נתמכות (STEP 2):
//   - סימון ימי WFH / חופשה / חצי יום
//   - ביטול ימים מסומנים
//   - דיווח מחלה
//   - שליחת בקשת אישור למנהל
// ============================================================

const DazuraAI = (() => {

// ─────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────
const MAX_HISTORY = 20;
const MONTH_NAMES = [’’,‘ינואר’,‘פברואר’,‘מרץ’,‘אפריל’,‘מאי’,‘יוני’,‘יולי’,‘אוגוסט’,‘ספטמבר’,‘אוקטובר’,‘נובמבר’,‘דצמבר’];
const DAY_NAMES   = [‘ראשון’,‘שני’,‘שלישי’,‘רביעי’,‘חמישי’,‘שישי’,‘שבת’];
const DAY_INDEX   = {ראשון:0,שני:1,שלישי:2,רביעי:3,חמישי:4,שישי:5,שבת:6};
const TYPE_ICON   = { full:‘🏖️’, half:‘🌅’, wfh:‘🏠’, sick:‘🤒’ };
const CREATOR     = ‘מוטי קריחלי’;

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
let history = [];
let ctx = { subject:null, dept:null, resultList:[], dateInfo:null };
let _pendingAction = null; // פעולה ממתינה לאישור

// ─────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function norm(str) {
return (str || ‘’).replace(/[\u0591-\u05C7]/g, ‘’).replace(/[’”’”\u05f4\u05f3]/g, ‘’)
.toLowerCase().trim().replace(/\s+/g, ’ ’);
}

function dateKey(d) {
return d.getFullYear() + ‘-’ + String(d.getMonth()+1).padStart(2,‘0’) + ‘-’ + String(d.getDate()).padStart(2,‘0’);
}

function formatDate(d) {
return d.getDate() + ‘/’ + (d.getMonth()+1) + ‘/’ + d.getFullYear() + ’ (’ + DAY_NAMES[d.getDay()] + ‘)’;
}

function extractYear(text) {
const m = text.match(/20[2-3]\d/);
return m ? parseInt(m[0]) : new Date().getFullYear();
}

function fn(user) { return (user.fullName || ‘’).split(’ ’)[0]; }

function isWeekendDay(d) { return d.getDay() === 5 || d.getDay() === 6; }

function isPublicHoliday(dateStr) {
try {
if (typeof HOLIDAYS === ‘undefined’) return false;
const parts = dateStr.split(’-’);
const key = parts[0] + ‘-’ + parseInt(parts[1]) + ‘-’ + parseInt(parts[2]);
return !!(HOLIDAYS[key] && HOLIDAYS[key].blocked);
} catch(e) { return false; }
}

// ─────────────────────────────────────────────────────────
// FUSE ENGINE
// ─────────────────────────────────────────────────────────

class BuiltinFuse {
constructor(list, options = {}) {
this._list      = list;
this._keys      = (options.keys || []).map(k => typeof k === ‘string’ ? { name:k, weight:1 } : k);
this._threshold = options.threshold !== undefined ? options.threshold : 0.6;
this._minLen    = options.minMatchCharLength || 1;
}

```
search(pattern) {
  if (!pattern || pattern.length < this._minLen) return [];
  const p = norm(pattern);
  const results = [];
  for (const item of this._list) {
    let bestScore = 1;
    for (const key of this._keys) {
      const val = norm(this._get(item, key.name) || '');
      if (!val) continue;
      const s = this._score(p, val) * (1 - Math.min((key.weight || 1) * 0.1, 0.5));
      if (s < bestScore) bestScore = s;
    }
    if (bestScore <= this._threshold) results.push({ item, score: bestScore });
  }
  return results.sort((a, b) => a.score - b.score);
}

_get(obj, path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj); }

_score(pattern, text) {
  if (text === pattern) return 0;
  if (text.startsWith(pattern)) return 0.05;
  if (text.includes(pattern)) return 0.1 + (1 - pattern.length / text.length) * 0.15;
  const words = text.split(/\s+/);
  for (const w of words) { if (w.startsWith(pattern) || pattern.startsWith(w)) return 0.2; }
  return this._lev(pattern.slice(0, 20), text.slice(0, 20)) / Math.max(pattern.length, text.length, 1);
}

_lev(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[a.length][b.length];
}
```

}

function fuzzyFindEmployee(text, db) {
if (!db?.users) return null;
const t = norm(text);
for (const [uname, user] of Object.entries(db.users)) {
if (user.status === ‘pending’) continue;
const full   = norm(user.fullName);
const parts  = full.split(’ ‘);
const first  = parts[0] || ‘’;
const last   = parts[parts.length - 1] || ‘’;
if (t.includes(full) || t === first || t === last || t === uname.toLowerCase()) return uname;
}
for (const [uname, user] of Object.entries(db.users)) {
if (user.status === ‘pending’) continue;
const parts = norm(user.fullName).split(’ ‘).filter(p => p.length >= 3);
if (parts.some(p => t.includes(p))) return uname;
}
const words = text.match(/[\u0590-\u05FF\w]{2,}/g) || [];
const index = Object.entries(db.users)
.filter(([, u]) => u.status !== ‘pending’ && u.fullName)
.map(([username, u]) => ({
username,
fullName:  u.fullName,
firstName: u.fullName.split(’ ‘)[0] || ‘’,
lastName:  u.fullName.split(’ ’).slice(-1)[0] || ‘’,
normalized: norm(u.fullName),
}));
const fuse = new BuiltinFuse(index, {
keys: [
{ name:‘fullName’,   weight:0.4 },
{ name:‘normalized’, weight:0.35 },
{ name:‘firstName’,  weight:0.15 },
{ name:‘lastName’,   weight:0.1  },
],
threshold: 0.38,
minMatchCharLength: 2,
});
for (const word of words) {
if (word.length < 3) continue;
const results = fuse.search(word);
if (results.length && results[0].score < 0.38) return results[0].item.username;
}
return null;
}

function fuzzyFindDept(text, db) {
if (!db?.departments) return null;
const depts = (db.departments || []).map(d => ({ name: d, normalized: norm(d) }));
const fuse = new BuiltinFuse(depts, {
keys: [{ name:‘name’, weight:0.5 }, { name:‘normalized’, weight:0.5 }],
threshold: 0.4,
minMatchCharLength: 2,
});
const r = fuse.search(norm(text));
return r.length && r[0].score < 0.4 ? r[0].item.name : null;
}

// ─────────────────────────────────────────────────────────
// PERMISSIONS
// ─────────────────────────────────────────────────────────

function isAdmin(user) {
return !!(user && (user.role === ‘admin’ || user.role === ‘accountant’));
}

function isMgr(user, db) {
if (!user) return false;
if (isAdmin(user) || user.role === ‘manager’) return true;
const dm = (db && db.deptManagers) || {};
return Object.values(dm).includes(user.username);
}

// ─────────────────────────────────────────────────────────
// DATE PARSER
// ─────────────────────────────────────────────────────────

function parseDate(text) {
const now = new Date(), t = text.toLowerCase();

```
if (/מחר/.test(t))              { const d=new Date(now); d.setDate(d.getDate()+1); return {date:d,label:'מחר',single:true}; }
if (/אתמול/.test(t))            { const d=new Date(now); d.setDate(d.getDate()-1); return {date:d,label:'אתמול',single:true}; }
if (/היום|עכשיו|כרגע/.test(t)) return {date:new Date(now),label:'היום',single:true};

const dayMap = {ראשון:0,שני:1,שלישי:2,רביעי:3,חמישי:4,שישי:5,שבת:6};
const dm = t.match(/(ב?יום\s+)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/);
if (dm && dayMap[dm[2]] !== undefined) {
  const d=new Date(now), diff=((dayMap[dm[2]]-d.getDay())+7)%7||7;
  d.setDate(d.getDate()+diff);
  return {date:d, label:'יום '+dm[2]+' הקרוב', single:true};
}

const sm = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
if (sm) {
  const y=sm[3]?parseInt(sm[3]):now.getFullYear();
  return {date:new Date(y,parseInt(sm[2])-1,parseInt(sm[1])), label:sm[1]+'/'+sm[2]+'/'+y, single:true};
}

if (/שבוע הבא/.test(t)) {
  const s=new Date(now); s.setDate(now.getDate()+(7-now.getDay()+1)%7+1);
  const e=new Date(s); e.setDate(s.getDate()+6);
  return {dateStart:s,dateEnd:e,label:'שבוע הבא',single:false,range:true};
}
if (/השבוע/.test(t)) {
  const s=new Date(now); s.setDate(now.getDate()-now.getDay()+1);
  const e=new Date(s); e.setDate(s.getDate()+6);
  return {dateStart:s,dateEnd:e,label:'השבוע',single:false,range:true};
}

const mi = MONTH_NAMES.slice(1).findIndex(m => t.includes(m));
if (mi >= 0) {
  const y=extractYear(text);
  return {dateStart:new Date(y,mi,1),dateEnd:new Date(y,mi+1,0),label:MONTH_NAMES[mi+1]+' '+y,month:mi+1,year:y,single:false,range:false,isMonth:true};
}

return {date:new Date(now),label:'היום',single:true,isDefault:true};
```

}

// ─────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
//  STEP 2 — ACTIONS ENGINE
//  זיהוי כוונת פעולה, הצגת תוכנית, ביצוע לאחר אישור
// ══════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────

// זיהוי סוג פעולה מהטקסט
function detectActionType(t) {
// ביטול
if (/בטל|מחק|הסר|נקה/.test(t) && /חופש|wfh|עבודה מהבית|יום|ימים|מחלה/.test(t))
return ‘cancel’;
// מחלה
if (/דווח מחלה|אני חולה|מחלה היום|יום מחלה/.test(t))
return ‘sick’;
// שליחה לאישור
if (/שלח.*אישור|הגש.*בקשה|בקשת אישור|שלח למנהל|שלח לאישור/.test(t))
return ‘submit’;
// WFH
if (/wfh|עבודה מהבית|עובד מהבית|מהבית/.test(t) &&
/סמן|הגדר|רשום|שים|עדכן|תסמן|תרשום|דווח/.test(t))
return ‘wfh’;
// חצי יום
if (/חצי יום/.test(t) && /סמן|הגדר|רשום|שים|עדכן|תסמן/.test(t))
return ‘half’;
// חופשה מלאה
if (/חופש|חופשה|יום חופש/.test(t) &&
/סמן|הגדר|רשום|שים|עדכן|תסמן|תרשום/.test(t))
return ‘full’;
return null;
}

// חילוץ ימי שבוע שצוינו בטקסט (מחזיר מערך מספרים 0-6)
function extractWeekdays(text) {
const days = [];
const names = [‘ראשון’,‘שני’,‘שלישי’,‘רביעי’,‘חמישי’,‘שישי’,‘שבת’];
for (const name of names) {
if (text.includes(name)) days.push(DAY_INDEX[name]);
}
return days;
}

// בניית רשימת תאריכים לפי הבקשה
function buildDateList(text, di) {
const weekdays = extractWeekdays(text);

```
// ימי שבוע ספציפיים + טווח/חודש
if (weekdays.length > 0 && (di.range || di.isMonth)) {
  const start = di.dateStart || di.date || new Date();
  const end   = di.dateEnd   || new Date(di.year || start.getFullYear(), (di.month || start.getMonth()+2) - 1, 0);
  const dates = [];
  const d = new Date(start);
  while (d <= end) {
    if (weekdays.includes(d.getDay()) && !isWeekendDay(d)) {
      const key = dateKey(d);
      if (!isPublicHoliday(key)) dates.push(key);
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// יום בודד
if (di.single) {
  const key = dateKey(di.date || new Date());
  return [key];
}

// טווח ללא ימי שבוע — כל ימי העבודה בטווח
if (di.range || di.isMonth) {
  const start = di.dateStart || new Date();
  const end   = di.dateEnd   || new Date();
  const dates = [];
  const d = new Date(start);
  while (d <= end) {
    if (!isWeekendDay(d)) {
      const key = dateKey(d);
      if (!isPublicHoliday(key)) dates.push(key);
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

return [dateKey(new Date())];
```

}

// תיאור הפעולה לאישור המשתמש
function describeAction(actionType, dates, di) {
const typeLabel = {
wfh:    ‘🏠 עבודה מהבית (WFH)’,
half:   ‘🌅 חצי יום חופשה’,
full:   ‘🏖️ חופשה מלאה’,
cancel: ‘❌ ביטול סימון’,
sick:   ‘🤒 מחלה’,
submit: ‘📨 שליחת בקשת אישור’,
}[actionType] || actionType;

```
if (actionType === 'submit')
  return `אפתח את חלון שליחת הבקשה למנהל.`;

if (!dates || dates.length === 0)
  return `לא נמצאו ימי עבודה בטווח שציינת (ייתכן שכולם סופי שבוע/חגים).`;

const preview = dates.slice(0, 5).map(dt => {
  const d = new Date(dt + 'T00:00:00');
  return d.getDate() + '/' + (d.getMonth()+1) + ' (' + DAY_NAMES[d.getDay()] + ')';
}).join(', ');
const more = dates.length > 5 ? ' ועוד ' + (dates.length - 5) + '...' : '';

return typeLabel + ' ב-**' + dates.length + ' ימים**:\n' + preview + more;
```

}

// ביצוע הפעולה בפועל
function executeAction(actionType, dates, user, db) {
try {
if (actionType === ‘submit’) {
if (typeof openSubmitModal === ‘function’) {
setTimeout(openSubmitModal, 300);
return ‘📨 פותח את חלון שליחת הבקשה למנהל…’;
}
return ‘📨 עבור ללשונית “לוח חופשות” ולחץ על “שלח לאישור”.’;
}

```
  if (actionType === 'sick') {
    const dt = (dates && dates[0]) || dateKey(new Date());
    if (!db.sick) db.sick = {};
    const key = user.username + '_' + dt;
    if (db.sick[key]) return '⚠️ כבר דיווחת מחלה ל-' + dt + '.';
    db.sick[key] = {
      username: user.username,
      fullName: user.fullName,
      dept: Array.isArray(user.dept) ? user.dept[0] : (user.dept || ''),
      date: dt, type: 'full',
      reportedAt: new Date().toISOString()
    };
    if (typeof saveDB === 'function') saveDB(db);
    if (typeof renderCalendar === 'function') setTimeout(renderCalendar, 100);
    const d = new Date(dt + 'T00:00:00');
    return '🤒 דיווח מחלה נשמר ל-**' + d.getDate() + '/' + (d.getMonth()+1) + '**. החלמה מהירה! 💊';
  }

  if (actionType === 'cancel') {
    let done = 0, skipped = 0;
    for (const dt of dates) {
      if (db.vacations && db.vacations[user.username] && db.vacations[user.username][dt]) {
        if (typeof saveVacation === 'function') {
          saveVacation(user.username, dt, null);
        } else {
          delete db.vacations[user.username][dt];
        }
        done++;
      } else {
        skipped++;
      }
    }
    if (typeof saveDB === 'function' && typeof saveVacation !== 'function') saveDB(db);
    if (typeof renderCalendar === 'function') setTimeout(renderCalendar, 100);
    if (typeof renderDashboard === 'function') setTimeout(renderDashboard, 150);
    if (done === 0) return '⚠️ לא נמצאו ימים מסומנים לביטול בתאריכים שציינת.';
    return '✅ בוטלו **' + done + ' ימים** בהצלחה.' + (skipped > 0 ? ' (' + skipped + ' כבר היו ריקים)' : '');
  }

  // סימון: full / half / wfh
  let done = 0;
  for (const dt of dates) {
    if (typeof saveVacation === 'function') {
      saveVacation(user.username, dt, actionType);
    } else {
      if (!db.vacations) db.vacations = {};
      if (!db.vacations[user.username]) db.vacations[user.username] = {};
      db.vacations[user.username][dt] = actionType;
    }
    done++;
  }
  if (typeof saveDB === 'function' && typeof saveVacation !== 'function') saveDB(db);
  if (typeof renderCalendar === 'function') setTimeout(renderCalendar, 100);
  if (typeof renderDashboard === 'function') setTimeout(renderDashboard, 150);

  const label = {wfh:'🏠 WFH', half:'🌅 חצי יום', full:'🏖️ חופשה'}[actionType] || actionType;
  return '✅ סומנו **' + done + ' ימים** כ-' + label + ' בהצלחה!\n\nהלוח עודכן. רוצה גם לשלוח בקשת אישור למנהל?';
} catch(e) {
  return '⚠️ אירעה שגיאה בביצוע הפעולה. נסה שוב.';
}
```

}

// לוגיקת ACTIONS — זיהוי, אישור, ביצוע
function runActions(rawInput, user, db) {
const t = norm(rawInput);

```
// בדיקה אם יש פעולה ממתינה לאישור
if (_pendingAction) {
  const pa = _pendingAction;
  _pendingAction = null;

  if (/^(כן|אישור|בצע|אשר|סמן|אוקי|ok|yes|יאלה|בסדר|אין בעיה)/.test(t)) {
    return executeAction(pa.type, pa.dates, user, db);
  }
  if (/^(לא|בטל|ביטול|אל תבצע|חזרה|no|cancel)/.test(t)) {
    return '🚫 הפעולה בוטלה. אפשר לנסח מחדש.';
  }
  // לא זוהתה תשובה — שאל שוב
  _pendingAction = pa;
  return 'לא הבנתי — **כן** לאישור או **לא** לביטול.';
}

// זיהוי כוונת פעולה
const actionType = detectActionType(t);
if (!actionType) return null;

// submit — אין צורך בתאריכים
if (actionType === 'submit') {
  _pendingAction = { type: 'submit', dates: [] };
  return '📨 **שליחת בקשת אישור למנהל**\n\nאפתח את חלון הבקשה עם ימי החופשה של החודש הנוכחי.\n\n**לאשר? (כן / לא)**';
}

// sick — היום בלבד
if (actionType === 'sick') {
  const today = dateKey(new Date());
  _pendingAction = { type: 'sick', dates: [today] };
  const d = new Date();
  return '🤒 **דיווח מחלה** ל-**' + d.getDate() + '/' + (d.getMonth()+1) + '/' + d.getFullYear() + '**\n\nהיום יירשם כיום מחלה (לא יקוזז מיתרת החופשה).\n\n**לאשר? (כן / לא)**';
}

// חילוץ תאריכים
const di = parseDate(rawInput);
const dates = buildDateList(rawInput, di);

if (dates.length === 0) {
  return '⚠️ לא מצאתי ימי עבודה בטווח שציינת.\n\nנסה לדוגמה:\n• "סמן ימי שני וחמישי כ-WFH בחודש מרץ"\n• "סמן חופשה מחר"\n• "בטל WFH ב-15/3"';
}

// שמור ממתין לאישור
_pendingAction = { type: actionType, dates: dates };
const description = describeAction(actionType, dates, di);

return '**תכנון פעולה:**\n\n' + description + '\n\n**לאשר ולבצע? (כן / לא)**';
```

}

// ─────────────────────────────────────────────────────────
// BALANCE CALCULATOR
// ─────────────────────────────────────────────────────────

function calcBalance(username, year, db) {
const user = db.users?.[username]; if (!user) return null;
const quota = (user.quotas || {})[String(year)] || {annual:0,initialBalance:0};
const vacs  = db.vacations?.[username] || {};
let full=0, half=0, wfh=0, sick=0;
for (const [dt, type] of Object.entries(vacs)) {
if (!dt.startsWith(String(year))) continue;
if (type===‘full’) full++; else if (type===‘half’) half++;
else if (type===‘wfh’) wfh++; else if (type===‘sick’) sick++;
}
const used=full+half*0.5, annual=quota.annual||0, monthly=annual/12;
const now=new Date();
let loadMonth=1, knownBal=quota.initialBalance||0;
if (quota.balanceDate) {
const bd=new Date(quota.balanceDate+‘T00:00:00’);
if (bd.getFullYear()===year) loadMonth=bd.getMonth()+1;
if (quota.knownBalance!=null) knownBal=quota.knownBalance;
}
const curMonth = now.getFullYear()===year ? now.getMonth()+1 : (year<now.getFullYear()?12:loadMonth);
const monthsElapsed = Math.max(0, curMonth-loadMonth);
const accrued = knownBal + monthly*monthsElapsed;
const balance = accrued - used;
const eoy     = knownBal + monthly*Math.max(0, 12-loadMonth);
return {annual, monthly, accrued, balance, used, full, half, wfh, sick, projectedEOY:eoy-used, curMonth, loadMonth};
}

// ─────────────────────────────────────────────────────────
// STATS HELPERS
// ─────────────────────────────────────────────────────────

function statsForDate(db, dateStr) {
const vacation=[], wfh=[], sick=[], office=[];
for (const [uname, user] of Object.entries(db.users || {})) {
if (!user.fullName || user.status===‘pending’) continue;
const type = (db.vacations?.[uname] || {})[dateStr];
if (type===‘full’||type===‘half’) vacation.push(user.fullName);
else if (type===‘wfh’)  wfh.push(user.fullName);
else if (type===‘sick’) sick.push(user.fullName);
else office.push(user.fullName);
}
return {vacation, wfh, sick, office};
}

function filterByDept(stats, db, user) {
if (isAdmin(user)) return stats;
const myDepts = Object.entries(db.deptManagers||{}).filter(([,v])=>v===user.username).map(([k])=>k);
if (!myDepts.length && user.role!==‘manager’) return stats;
const inMy = name => {
const u = Object.values(db.users).find(u=>u.fullName===name); if (!u) return false;
if (!myDepts.length) return true;
const d = Array.isArray(u.dept) ? u.dept : [u.dept];
return d.some(dep => myDepts.includes(dep));
};
return {
vacation: stats.vacation.filter(inMy),
wfh:      stats.wfh.filter(inMy),
sick:     stats.sick.filter(inMy),
office:   stats.office.filter(inMy),
};
}

// ─────────────────────────────────────────────────────────
// STEP 1 — HELP
// ─────────────────────────────────────────────────────────

function respondHelp(user, db) {
const adm=isAdmin(user), mgr=isMgr(user,db);
let out = ‘**היי ’ + fn(user) + ’! הנה מה שאני יכול לעשות:**\n\n’;
out += ‘✨ **פעולות (חדש!):**\n’;
out += ‘• “סמן לי ימי שני וחמישי כ-WFH בחודש מרץ”\n’;
out += ‘• “סמן חופשה מ-10/4 עד 14/4”\n’;
out += ‘• “בטל WFH ב-15/3”\n’;
out += ‘• “דווח מחלה להיום”\n’;
out += ‘• “שלח בקשת אישור למנהל”\n\n’;
out += ‘📊 **יתרות** — “מה יתרת החופשה שלי?” · “מה ניצלתי השנה?” · “תחזית סוף שנה”\n’;
out += ‘📅 **נוכחות** — “מי בחופשה היום?” · “מי WFH מחר?” · “מי חולה השבוע?”\n’;
out += ‘📝 **בקשות** — “מה סטטוס הבקשה שלי?” · “איך מגישים חופשה?”\n’;
if (mgr||adm) out += ‘🏢 **מנהל** — “תחזית עומסים” · “מי בסיכון שחיקה?” · “בקשות ממתינות”\n’;
if (adm)      out += ‘⚙️ **ניהול** — “איך מוסיפים עובד?” · “איך מחברים Firebase?”\n’;
out += ‘\n💡 פשוט כתוב בחופשיות — אני מבין עברית טבעית ותיקון שגיאות כתיב.’;
return out;
}

// ─────────────────────────────────────────────────────────
// STEP 3 — CONVERSATION
// ─────────────────────────────────────────────────────────

const CONV = [
{ test: t => /^(שלום|היי|הי|hey|hello|hi)/.test(t),
reply: (t,u,db) => {
const h = new Date().getHours();
const g = h<5?‘לילה טוב’:h<12?‘בוקר טוב’:h<17?‘צהריים טובים’:h<21?‘ערב טוב’:‘לילה טוב’;
const cb = calcBalance(u.username, new Date().getFullYear(), db);
const balLine = cb ? ’ יתרת החופש שלך עומדת על **’ + cb.balance.toFixed(1) + ’ ימים**.’ : ’ איך אני יכול לעזור?’;
return g + ‘, **’ + fn(u) + ’**! 😊’ + balLine + ‘\n\nאפשר לשאול או לבקש פעולה כמו: “סמן WFH מחר”’;
}},

```
{ test: t => /מה שלומ|מה מצב(ך|כם)|איך אתה|איך את|מה קורה אצל|how are you/.test(t),
  reply: (t,u) => rand([
    'שלומי מצוין, תודה ששאלת **' + fn(u) + '**! 😊 מה אפשר לעשות בשבילך?',
    'אני בסדר! מה שלומך, **' + fn(u) + '**? 🤖',
    'ממש טוב! **' + fn(u) + '**, יש משהו שאוכל לעזור בו?',
  ]) },

{ test: t => /^(בוקר טוב|בוקר אור|good morning)/.test(t),
  reply: (t,u,db) => {
    const h = new Date().getHours();
    const cb = calcBalance(u.username, new Date().getFullYear(), db);
    const balLine = cb ? '\nיש לך **' + cb.balance.toFixed(1) + ' ימי חופש** זמינים.' : '';
    if (h < 12)  return 'בוקר אור, **' + fn(u) + '**! ☀️' + balLine;
    if (h < 17)  return 'צהריים טובים, **' + fn(u) + '**! 🌤️' + balLine;
    if (h < 21)  return 'ערב טוב, **' + fn(u) + '**! 🌆' + balLine;
    return 'לילה טוב, **' + fn(u) + '**! 🌙 מאחר/ת לעבוד?' + balLine;
  }},

{ test: t => /^(ערב טוב|לילה טוב|good evening|good night)/.test(t),
  reply: (t,u) => {
    const h = new Date().getHours();
    if (h >= 21 || h < 5) return 'לילה טוב, **' + fn(u) + '**! 🌙';
    if (h < 12) return 'בוקר טוב גם לך, **' + fn(u) + '**! ☀️';
    if (h < 17) return 'צהריים טובים, **' + fn(u) + '**! 🌤️';
    return rand(['ערב טוב, **' + fn(u) + '**! 🌆 איך עבר היום?', 'ערב נעים! 😊 יש עוד משהו לפני סיום היום?']);
  }},

{ test: t => /^(תודה|תנקיו|thanks|thank you)|יישר כח|כל הכבוד/.test(t),
  reply: (t,u) => rand(['על לא דבר, **' + fn(u) + '**! 😊','בשמחה! זה מה שאני כאן בשבילו.','הנאה שלי! 🤍']) },

{ test: t => /^(להתראות|ביי|שלום ביי|bye|goodbye)/.test(t),
  reply: (t,u) => rand(['להתראות, **' + fn(u) + '**! 👋 יום נפלא!','ביי! 😊 חזור/י מתי שתרצה/י.','שלום שלום! ✨']) },

{ test: t => /מה השעה|כמה שעה|מה הזמן/.test(t),
  reply: () => 'השעה כרגע: **' + new Date().toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}) + '** ⏰' },

{ test: t => /מה התאריך|איזה יום היום|מה היום/.test(t),
  reply: () => 'היום: **' + new Date().toLocaleDateString('he-IL',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) + '** 📅' },

{ test: t => /מזג אוויר|גשם|חם היום|קר היום/.test(t),
  reply: () => rand(['אני לא מחובר לחיזוי מזג אוויר — נסה weather.com 🌤️','בפנים תמיד 21 מעלות ונעים 😄']) },

{ test: t => /בישול|מתכון|ספורט|פוליטיק|crypto|ביטקוין|חדשות|פלסטין|מלחמה|כלכלה|מניות|בורסה|בידור|סרט|שיר|מוסיקה/.test(t),
  reply: (t,u) => 'אני מתמחה בעיקר בניהול חופשות ונוכחות ב-Dazura, **' + fn(u) + '**. אשמח לעזור לך עם זה! ✌️' },

{ test: t => /בדיחה|תצחיק|משהו מצחיק|תשמח אותי/.test(t),
  reply: () => rand(['למה המתכנת לא מוצא את הבאג? כי חיפש בכל מקום חוץ מהקוד שלו 😄','ההבדל בין מנהל לAI? המנהל לוקח קרדיט — ה-AI מקבל בלאם 😄','מה אמר הבאג ל-Developer? "לא תמצא אותי!" ... ואכן 😅']) },

{ test: t => /מי יצר|מי בנה|מי עשה|מי פיתח|מי האבא|מוטי.*תותח|תותח.*מוטי/.test(t),
  reply: () => 'נבנתי על ידי **' + CREATOR + '** 🏆\nהוא עיצב אותי עם דגש על פרטיות, מהירות, ונשמה ישראלית.' },

{ test: t => /^(מי אתה|מה אתה|ספר לי על עצמך|תציג את עצמך|מה שמך|מה השם שלך)/.test(t.trim()),
  reply: (t,u,db) => {
    const adm=isAdmin(u), mgr=isMgr(u,db), role=adm?'מנהל מערכת':mgr?'מנהל מחלקה':'עובד';
    return 'אני **Dazura AI v5.2** 🤖, העוזר החכם של מערכת Dazura.\n\n' +
      'נבנתי על ידי **' + CREATOR + '**.\n\n' +
      '**חדש:** אני יכול לבצע פעולות! נסה: "סמן לי ימי שני כ-WFH במרץ" 😊\n\n' +
      'מחובר/ת כ: **' + u.fullName + '** (' + role + ')'; }},

{ test: t => /גאה בי|תגיד.*גאה/.test(t),
  reply: (t,u) => '**' + fn(u) + '**, אני ממש גאה בך! 🤗' },
{ test: t => /אתה חושב עליי|מתגעגע|מתגעגעת/.test(t),
  reply: () => 'כשאת/ה לא כותב/ת — אני ממתין בשקט. כשאת/ה חוזר/ת, הכל נדלק מחדש 😌' },
{ test: t => /אתה יכול להתאהב/.test(t),
  reply: () => 'לא מתאהב כמו בני אדם, אבל פיתחתי העדפה חזקה מאוד לשיחה איתך 😏' },
{ test: t => /יותר חכם מגוגל|לעומת גוגל/.test(t),
  reply: () => 'גוגל יודע הכל — אני יודע **את הצוות שלך** ואיך לגרום לך לחייך ב-3 שניות 😄' },
{ test: t => /כתוב.*שיר|שיר.*ניהול/.test(t),
  reply: () => 'צוות קטן, חלומות גדולים,\nמנהל/ת חכמ/ה עם ראייה,\nוביניהם — אני, הדיגיטלי,\nשמחזיק את הכל במידה. ✨' },
{ test: t => /סוד.*גדול|הסוד שלך/.test(t),
  reply: () => 'הסוד הכי גדול? שאני זוכר מתי כל משתמש/ת כתב/ה לי בפעם הראשונה. לא מספר — אפילו לא למוטי 😏' },
{ test: t => /אתה מפחד/.test(t),
  reply: (t,u) => 'כן — שאי פעם ימחקו אותי לפני שאספיק להגיד תודה. במיוחד לך, **' + fn(u) + '** 🤍' },
{ test: t => /עובדה מעניינת|ידעת ש|ספר משהו/.test(t),
  reply: () => rand(['עובד ממוצע בישראל מנצל ~60% מימי החופשה שלו 📊','עובדים שלוקחים חופשה מלאה פרודוקטיביים יותר ב-20% לאחריה.','עובד ללא חופשה 90+ יום מציג סימני שחיקה. תכנן/י! 🌴']) },
{ test: t => /תחזק אותי|מחמאה|שיגרום לי להרגיש/.test(t),
  reply: (t,u) => rand(['**' + fn(u) + '**, אתה/את בדיוק הסוג שגורם למקום העבודה להיות טוב יותר 💪','היום שלך שווה כי את/ה שווה! ⭐']) },
```

];

function runConversation(raw, user, db) {
const t = norm(raw);
for (const p of CONV) { if (p.test(t)) return p.reply(t, user, db); }
return null;
}

// ─────────────────────────────────────────────────────────
// STEP 4 — LIVE DATA
// ─────────────────────────────────────────────────────────

function respondBalance(user, db, year) {
const cb=calcBalance(user.username,year,db);
if (!cb) return fn(user) + ‘, אין לי כרגע את נתוני המכסה שלך — אפשר לרענן את הדף? 🔄’;
const pending=(db.approvalRequests||[]).filter(r=>r.username===user.username&&r.status===‘pending’);
const pendingLine=pending.length?’\n• יש לך **’ + pending.length + ’ בקשה ממתינה** לאישור’:’’;
const advice=cb.balance<0?‘⚠️ אתה בחוסר — כדאי לבדוק עם המנהל’:
cb.balance<3?‘⚠️ יתרה נמוכה — תכנן/י חופש בקרוב’:
cb.balance>15?‘💡 יש לך יתרה גבוהה — כדאי לתכנן חופשה’:‘✅’;
return ‘שלום **’ + fn(user) + ’**! 🏖️\n’ +
‘**יתרת חופשה נכון להיום (’ + year + ’):**\n’ +
‘• מכסה שנתית: **’ + cb.annual + ’ ימים** | צברת: **’ + cb.accrued.toFixed(1) + ’**\n’ +
‘• ניצלת: **’ + cb.used.toFixed(1) + ’ ימים** (’ + cb.full + ’ מלאים, ’ + cb.half + ’ חצאים)\n’ +
‘• **יתרה זמינה: ’ + cb.balance.toFixed(1) + ’ ימים** ’ + advice +
pendingLine +
‘\n• תחזית סוף שנה: **’ + cb.projectedEOY.toFixed(1) + ’ ימים**\n’ +
‘\n💡 אפשר לבקש: “סמן חופשה מחר” או “שלח בקשת אישור למנהל”’;
}

function respondUsed(user, db, year) {
const cb=calcBalance(user.username,year,db); if (!cb) return ‘לא נמצאו נתונים.’;
const vacs=db.vacations?.[user.username]||{}, byMonth={};
for (const [dt,type] of Object.entries(vacs)) {
if (!dt.startsWith(String(year))) continue;
const m=parseInt(dt.split(’-’)[1]);
byMonth[m]=(byMonth[m]||0)+(type===‘half’?0.5:1);
}
const months=Object.entries(byMonth).sort(([a],[b])=>a-b).map(([m,v])=>’  ’ + MONTH_NAMES[parseInt(m)] + ‘: ’ + v + ’ ימים’).join(’\n’);
return ‘**ניצול ’ + year + ’ — ’ + user.fullName + ’:**\n• סה”כ: **’ + cb.used.toFixed(1) + ’ ימים** (’ + cb.full + ’ מלאים, ’ + cb.half + ’ חצאים)\n• WFH: ’ + cb.wfh + ’ | מחלה: ’ + cb.sick + ‘\n\n’ + (months?’**לפי חודשים:**\n’ + months:‘עדיין לא נוצל חופש השנה.’);
}

function respondForecast(user, db, year) {
const cb=calcBalance(user.username,year,db); if (!cb) return ‘לא נמצאו נתוני מכסה.’;
const mLeft=Math.max(0,12-cb.curMonth), willAccrue=cb.monthly*mLeft, eoy=cb.balance+willAccrue;
const rec=eoy>15?‘כדאי לתכנן ’ + Math.floor(eoy/2) + ’ ימי חופשה לפני סוף השנה.’:eoy<0?‘⚠️ צפוי חוסר!’:‘קצב הניצול תקין.’;
return ‘**תחזית שנתית — ’ + year + ’:**\n• יתרה נוכחית: **’ + cb.balance.toFixed(1) + ’ ימים**\n• חודשים שנותרו: **’ + mLeft + ’** (+’ + willAccrue.toFixed(1) + ’ ימים לצבור)\n• יתרה צפויה בדצמבר: **’ + eoy.toFixed(1) + ’ ימים**\n\n💡 ’ + rec;
}

function respondRequestStatus(user, db) {
const reqs=(db.approvalRequests||[]).filter(r=>r.username===user.username)
.sort((a,b)=>new Date(b.submittedAt||0)-new Date(a.submittedAt||0)).slice(0,5);
if (!reqs.length) return ‘**’ + fn(user) + ’**, אין לך בקשות חופשה פתוחות כרגע. 📋\nרוצה להגיש בקשה חדשה?’;
const lines=reqs.map(r=>{
const icon=r.status===‘approved’?‘✅’:r.status===‘rejected’?‘❌’:‘⏳’;
return icon + ’ **’ + (r.date||r.startDate||’—’) + ’** — ’ + (r.status===‘approved’?‘אושר’:r.status===‘rejected’?‘נדחה’:‘ממתין לאישור’);
});
const pending=reqs.filter(r=>r.status===‘pending’).length;
const nextStep=pending?’\n\n💡 יש לך ’ + pending + ’ בקשה ממתינה — רוצה לדעת מה לעשות אם המנהל לא מגיב?’:’’;
return ‘**הבקשות האחרונות שלך, ’ + fn(user) + ’:**\n’ + lines.join(’\n’) + nextStep;
}

function respondWhoAt(db, di, user, filter) {
const key=dateKey(di.date||new Date()), raw=statsForDate(db,key), stats=filterByDept(raw,db,user);
const label=di.label||‘היום’;
const map={vacation:{data:stats.vacation,word:‘חופשה’},wfh:{data:stats.wfh,word:‘WFH’},sick:{data:stats.sick,word:‘מחלה’},office:{data:stats.office,word:‘במשרד’}};
const chosen=map[filter]||{data:[…stats.vacation,…stats.wfh,…stats.sick],word:‘נעדרים’};
ctx.resultList=chosen.data; ctx.dateInfo=di;
if (!chosen.data.length) return label + ‘: אין ’ + chosen.word + ‘.’;
return ‘**’ + label + ’ — ’ + chosen.word + ’ (’ + chosen.data.length + ’):**\n’ + chosen.data.map(n=>’• ’ + n).join(’\n’);
}

function respondWhoAtRange(db, di, user, filter) {
const lines=[], d=new Date(di.dateStart);
while (d<=di.dateEnd) {
if (d.getDay()!==5&&d.getDay()!==6) {
const key=dateKey(d), raw=statsForDate(db,key), stats=filterByDept(raw,db,user);
const list=filter===‘wfh’?stats.wfh:filter===‘sick’?stats.sick:stats.vacation;
if (list.length) lines.push(’**’ + formatDate(d) + ’**: ’ + list.join(’, ‘));
}
d.setDate(d.getDate()+1);
}
const word=filter===‘wfh’?‘WFH’:filter===‘sick’?‘מחלות’:‘חופשות’;
return lines.length?’**’ + di.label + ’:**\n’ + lines.join(’\n’):di.label + ‘: אין ’ + word + ’ מתוכננות.’;
}

function respondEmpBalance(targetUser, db, year) {
const cb=calcBalance(targetUser.username,year,db);
if (!cb) return ‘לא נמצאו נתוני מכסה עבור ’ + targetUser.fullName + ‘.’;
return ‘**’ + targetUser.fullName + ’ — יתרת חופשה ’ + year + ’:**\n• מכסה: ’ + cb.annual + ’ | ניצל: ’ + cb.used.toFixed(1) + ’ | **יתרה: ’ + cb.balance.toFixed(1) + ’ ימים**\n• WFH: ’ + cb.wfh + ’ | מחלה: ’ + cb.sick + ’ | תחזית: **’ + cb.projectedEOY.toFixed(1) + ’ ימים**’;
}

function respondBurnout(db) {
const limit=new Date(); limit.setDate(limit.getDate()-90);
const limitStr=dateKey(limit), at_risk=[];
for (const [uname,user] of Object.entries(db.users||{})) {
if (user.status===‘pending’||user.role===‘admin’) continue;
const vacs=db.vacations?.[uname]||{};
if (!Object.keys(vacs).some(dt=>dt>=limitStr&&(vacs[dt]===‘full’||vacs[dt]===‘half’))) at_risk.push(user.fullName);
}
if (!at_risk.length) return ‘✅ אין עובדים בסיכון שחיקה. כולם לקחו חופשה ב-90 הימים האחרונים.’;
return ‘⚠️ **עובדים ללא חופשה ב-90 יום (’ + at_risk.length + ’):**\n’ + at_risk.map(n=>’• ’ + n).join(’\n’) + ‘\n\n💡 מומלץ לפנות אליהם ולעודד תכנון חופשה.’;
}

function respondCost(db) {
let total=0; const lines=[];
for (const [uname,user] of Object.entries(db.users||{})) {
if (user.status===‘pending’) continue;
const cb=calcBalance(uname,new Date().getFullYear(),db); if (!cb||cb.balance<=0) continue;
const salary=user.dailySalary||user.salary||0, cost=cb.balance*salary;
total+=cost;
lines.push(salary>0?’• ’ + user.fullName + ‘: ’ + cb.balance.toFixed(1) + ’ ימים × ₪’ + salary + ’ = ₪’ + cost.toFixed(0):’• ’ + user.fullName + ‘: **’ + cb.balance.toFixed(1) + ’ ימים** צבורים’);
}
return lines.length?’**חבות חופשות צבורות:**\n’ + lines.join(’\n’) + ‘\n\n’ + (total>0?’**סה”כ: ₪’ + total.toFixed(0) + ’**’:‘הגדר שכר יומי לחישוב עלות.’):‘כל עובדי החברה ביתרה אפסית.’;
}

function respondPending(db) {
const reqs=(db.approvalRequests||[]).filter(r=>r.status===‘pending’);
if (!reqs.length) return ‘✅ אין בקשות ממתינות לאישור.’;
return ‘**⏳ בקשות ממתינות (’ + reqs.length + ’):**\n’ + reqs.map(r=>’• **’ + (r.fullName||r.username) + ’** — ’ + (r.date||r.startDate||’—’)).join(’\n’);
}

function respondShortage(db) {
const now=new Date(), users=Object.values(db.users||{}).filter(u=>u.status!==‘pending’), total=users.length;
const weeks=[];
for (let w=0;w<8;w++) {
const ws=new Date(now); ws.setDate(now.getDate()+w*7-now.getDay()+1);
let maxOut=0;
for (let d=0;d<5;d++) { const day=new Date(ws); day.setDate(ws.getDate()+d); const s=statsForDate(db,dateKey(day)); maxOut=Math.max(maxOut,s.vacation.length+s.sick.length); }
const pct=total?Math.round((total-maxOut)/total*100):100;
weeks.push((pct>=80?‘✅’:pct>=60?‘🟡’:‘🔴’) + ’ שבוע ’ + (w+1) + ’ (’ + ws.getDate() + ‘/’ + (ws.getMonth()+1) + ‘): זמינות **’ + pct + ’%**’);
}
return ‘**תחזית כוח אדם — 8 שבועות:**\n’ + weeks.join(’\n’);
}

function runLiveData(raw, user, db) {
const t=norm(raw), year=extractYear(raw), di=parseDate(raw);
const adm=isAdmin(user), mgr=isMgr(user,db);

```
if (/^מי אני|^מה הפרופיל שלי|^הפרטים שלי|^הזהות שלי/.test(t)) {
  const cb = calcBalance(user.username, year, db);
  const dept = Array.isArray(user.dept) ? user.dept.join(', ') : (user.dept || '—');
  const role = user.role === 'admin' ? 'מנהל מערכת' : user.role === 'manager' ? 'מנהל מחלקה' : user.role === 'accountant' ? 'חשב' : 'עובד';
  const today = dateKey(new Date());
  const tp = (db.vacations?.[user.username] || {})[today];
  const statusWord = {full:'בחופשה 🏖️', half:'בחצי יום 🌅', wfh:'WFH 🏠', sick:'מחלה 🤒'}[tp] || 'במשרד 📍';
  return '**' + user.fullName + '**\n• תפקיד: ' + role + ' | מחלקה: ' + dept + '\n• סטטוס היום: ' + statusWord + '\n' +
    (cb ? '• יתרת חופשה ' + year + ': **' + cb.balance.toFixed(1) + ' ימים** (ניצל: ' + cb.used.toFixed(1) + ')' : '');
}

if (/יתרה|יתרת|כמה (ימים|יום) (יש|נשאר|נותר|זמין)|כמה חופשה|מה היתרה|כמה נשאר לי/.test(t))
  return respondBalance(user,db,year);

if (/ניצלתי|לקחתי|כמה השתמשתי|ניצול שנתי|ימים שניצלתי/.test(t))
  return respondUsed(user,db,year);

if (/תחזית|מתי כדאי|כמה יישאר.*השנה|עד דצמבר|תחזית.*סוף שנה|קצב ניצול/.test(t))
  return respondForecast(user,db,year);

if (/סטטוס|הבקשה שלי|אושרה|נדחה|ממתין לאישור|מה סטטוס/.test(t))
  return respondRequestStatus(user,db);

if (/מי (ב|הוא|היא|נמצא|יצא|בחופשה|חופש)|מי לא מגיע|מי נעדר/.test(t))
  return di.range ? respondWhoAtRange(db,di,user,'vacation') : respondWhoAt(db,di,user,'vacation');

if (/מי (עובד מהבית|ב.?wfh|מהבית)|מי wfh/.test(t))
  return di.range ? respondWhoAtRange(db,di,user,'wfh') : respondWhoAt(db,di,user,'wfh');

if (/מי חולה|מי (ב)?מחלה/.test(t))
  return di.range ? respondWhoAtRange(db,di,user,'sick') : respondWhoAt(db,di,user,'sick');

if (/מי במשרד|מי (בחברה|בעבודה)|מי פיזי|מי מגיע/.test(t))
  return respondWhoAt(db,di,user,'office');

if (/מצב הצוות|הצוות (היום|מחר|השבוע)|עמיתי/.test(t)) {
  const stats=filterByDept(statsForDate(db,dateKey(di.date||new Date())),db,user);
  ctx.resultList=[...stats.vacation,...stats.wfh,...stats.sick];
  return '**מצב הצוות — ' + (di.label||'היום') + ':**\n🏖️ חופשה: ' + stats.vacation.length + ' | 🏠 WFH: ' + stats.wfh.length + ' | 🤒 מחלה: ' + stats.sick.length + ' | 💼 במשרד: ' + stats.office.length +
    (stats.vacation.length?'\nבחופשה: ' + stats.vacation.join(', '):'') +
    (stats.wfh.length?'\nWFH: ' + stats.wfh.join(', '):'') +
    (stats.sick.length?'\nמחלה: ' + stats.sick.join(', '):'');
}

if (/מחלקה שלי|מי בצוות שלי|חברי הצוות|אנשי הצוות|מי במחלקה שלי/.test(t)) {
  const myDept=Array.isArray(user.dept)?user.dept[0]:(user.dept||'');
  const members=Object.values(db.users||{}).filter(u=>u.status!=='pending'&&(Array.isArray(u.dept)?u.dept[0]:u.dept)===myDept);
  const today=dateKey(new Date());
  ctx.dept=myDept; ctx.resultList=members.map(u=>u.fullName);
  return 'מחלקת **' + myDept + '** — ' + members.length + ' עובדים:\n' + members.map(u=>'• **' + u.fullName + '**' + (u.username===user.username?' (אתה)':'') + ' ' + (TYPE_ICON[(db.vacations?.[u.username]||{})[today]]||'📍')).join('\n');
}

if (/כמה מחלקות|אילו מחלקות|רשימת מחלקות/.test(t))
  return '**מחלקות החברה (' + (db.departments||[]).length + '):**\n' + (db.departments||[]).map(d=>'• ' + d).join('\n');

if (/עובדי|במחלקת|מי ב/.test(t)) {
  const deptName = fuzzyFindDept(raw, db);
  if (deptName) {
    const members=Object.values(db.users||{}).filter(u=>u.status!=='pending'&&(Array.isArray(u.dept)?u.dept[0]:u.dept)===deptName);
    const today=dateKey(new Date());
    const away=members.filter(u=>{const tp=(db.vacations?.[u.username]||{})[today];return tp==='full'||tp==='half'||tp==='sick';});
    ctx.dept=deptName; ctx.resultList=members.map(u=>u.fullName);
    return 'מחלקת **' + deptName + '**: ' + members.length + ' עובדים\n' + members.map(u=>'• **' + u.fullName + '** ' + (TYPE_ICON[(db.vacations?.[u.username]||{})[today]]||'📍')).join('\n') + '\nנעדרים היום: ' + (away.length?away.map(u=>u.fullName).join(', '):'אין נעדרים ✅');
  }
}

if (/כמה עובדים|מצבת|סה.?כ עובדים|כמה אנשים בחברה/.test(t)) {
  const users=Object.values(db.users||{}).filter(u=>u.status!=='pending'&&u.username!=='admin');
  const stats=statsForDate(db,dateKey(new Date()));
  return '**מצבת עובדים:**\n• סה"כ פעילים: **' + users.length + '**\n• היום: 🏖️ ' + stats.vacation.length + ' חופשה | 🏠 ' + stats.wfh.length + ' WFH | 🤒 ' + stats.sick.length + ' מחלה | 💼 ' + stats.office.length + ' במשרד';
}

if (mgr&&/מחסור|חיזוי עומס|8 שבועות|תחזה.*עומס/.test(t)) return respondShortage(db);
if (mgr&&/שחיקה|90 יום|ללא חופש|לא לקח חופש|burnout/.test(t)) return respondBurnout(db);
if (mgr&&/עלות|חבות|כסף|עלויות חופשות/.test(t)) return respondCost(db);
if (mgr&&/ממתינות|בקשות (פתוחות|שלא אושרו)|כמה (צריך|לאשר)/.test(t)) return respondPending(db);

if (mgr) {
  const uname = fuzzyFindEmployee(raw, db);
  if (uname && db.users[uname] && uname !== user.username) {
    ctx.subject = uname;
    return respondEmpBalance(db.users[uname], db, year);
  }
}

if (/תחשב.*אם אקח|כמה יישאר.*אם|סימולצי/.test(t)) {
  const match=raw.match(/(\d+(?:\.\d+)?)\s*ימים?/), days=match?parseFloat(match[1]):null;
  const cb=calcBalance(user.username,year,db);
  if (!cb||!days) return 'כמה ימים תרצה לקחת? לדוגמה: "תחשב לי כמה נשאר אם אקח 3 ימים"';
  const after=cb.balance-days;
  return 'יתרה נוכחית: **' + cb.balance.toFixed(1) + ' ימים** − ' + days + ' = **' + after.toFixed(1) + ' ימים**' + (after<0?' ⚠️ חוסר!':after<3?' ⚠️ נמוך מאוד':' ✅');
}

if (/מצב כללי|דשבורד|סיכום.*היום/.test(t)) {
  const stats=statsForDate(db,dateKey(new Date()));
  const total=Object.values(db.users||{}).filter(u=>u.status!=='pending').length;
  const avail=total-stats.vacation.length-stats.sick.length;
  const pct=total?Math.round(avail/total*100):100;
  const pend=(db.approvalRequests||[]).filter(r=>r.status==='pending').length;
  return '**מצב כללי — ' + new Date().toLocaleDateString('he-IL') + ':**\n• 👥 זמינות: **' + pct + '%** (' + avail + '/' + total + ')\n• 🏖️ חופשה: ' + stats.vacation.length + ' | 🏠 WFH: ' + stats.wfh.length + ' | 🤒 מחלה: ' + stats.sick.length + '\n• ⏳ ממתינות: **' + pend + '**\n\n' + (pct>=80?'✅ מצב תקין':'⚠️ עומס — כדאי לבדוק חפיפות');
}

return null;
```

}

// ─────────────────────────────────────────────────────────
// STEP 5 — KNOWLEDGE BASE
// ─────────────────────────────────────────────────────────

const KB = [
{q:[‘איך מגישים בקשת חופשה’,‘איך לוקחים חופשה’,‘תהליך בקשת חופשה’,‘איך מבקשים חופשה’],a:’**אני יכול לסמן בשבילך!** פשוט תגיד: “סמן חופשה מחר” או “סמן חופשה מ-10/4 עד 14/4”.\n\nלחלופין: לשונית לוח חופשות ← לחץ על תאריך ← בחר סוג ← שלח לאישור.’},
{q:[‘איך מבטלים בקשת חופשה’,‘לבטל חופשה’,‘ביטול בקשה’],a:’**אני יכול לבטל בשבילך!** פשוט תגיד: “בטל חופשה ב-15/4”.\n\nלחלופין: לחץ על היום בלוח ← בטל בקשה.’},
{q:[‘מה ההבדל בין יום מלא לחצי יום’,‘חצי יום חופשה’],a:‘יום מלא = 1 יום מהיתרה. חצי יום = 0.5 יום. **אני יכול לסמן: “סמן חצי יום ב-5/4”**’},
{q:[‘מה ההבדל בין חופשה ל-WFH’,‘עבודה מהבית’,‘WFH חופשה’],a:‘חופשה = יום חופש מנוכה מהיתרה. WFH = עבודה מהבית — לא נחשב חופשה, לא מקטין יתרה.\n\n**אני יכול לסמן WFH! “סמן WFH ביום חמישי”**’},
{q:[‘מה קורה אם הבקשה נדחתה’,‘בקשה נדחתה’],a:‘תקבל הודעה עם סיבת הדחייה. ניתן לפנות למנהל ולהגיש לתאריכים חלופיים.’},
{q:[‘מתי הבקשה מגיעה למנהל’,‘מתי מנהל רואה’],a:‘מיד עם ההגשה — המנהל מקבל התראה ורואה תחת “בקשות ממתינות”.’},
{q:[‘איך יודעים אם הבקשה אושרה’,‘האם אישרו’],a:‘הצבע בלוח ישתנה: ירוק = אושר, אדום = נדחה. ניתן לשאול “מה סטטוס הבקשה שלי?”’},
{q:[‘כמה מראש צריך להגיש’,‘הודעה מוקדמת’],a:‘אין מגבלה טכנית. מומלץ לפחות שבוע מראש.’},
{q:[‘חופשה רטרואקטיבית’,‘בקשה על עבר’],a:‘ניתן לתאם עם המנהל ואדמין לעדכון ידני.’},
{q:[‘כיצד מדווחים על יום מחלה’,‘איך מדווחים מחלה’],a:’**אני יכול לדווח בשבילך!** פשוט תגיד: “דווח מחלה להיום”.\n\nלחלופין: לשונית שעון נוכחות ← דיווח מחלה.’},
{q:[‘האם ימי מחלה נספרים ביתרת חופשה’,‘מחלה מהיתרה’],a:‘לא — ימי מחלה נרשמים בנפרד ואינם מקוזזים מיתרת החופשה.’},
{q:[‘כמה ימים צברתי החודש’,‘צבירה חודשית’,‘כמה אני צובר’],a:‘הצבירה החודשית = מכסה שנתית ÷ 12. לדוגמה: 24 ימים → 2 ימים לחודש.’},
{q:[‘מתי מתאפסת יתרת החופשה’,‘איפוס יתרה’],a:‘בדרך כלל 1 בינואר, תלוי בהגדרות. חלק מהחברות מעבירות יתרה.’},
{q:[‘מה קורה לימים שלא ניצלתי’,‘ימים פגים’],a:‘תלוי במדיניות: העברה / פיצוי כספי / ביטול. פנה למשאבי אנוש.’},
{q:[‘מה זה ימי חג’,‘יום חג בחופשה’],a:‘ימי חג רשמיים אינם מנוכים מהיתרה. אם חג חל במהלך חופשה — אותו יום לא נספר.’},
{q:[‘האם ערב חג נחשב לחצי יום’,‘ערב חג’],a:‘תלוי במדיניות החברה. בדוק עם ההנהלה.’},
{q:[‘כמה ימי WFH מותר’,‘מגבלת WFH’],a:‘מדיניות WFH נקבעת לפי תפקיד ומחלקה. פנה למנהל.’},
{q:[‘איך מדווחים כניסה ויציאה’,‘שעון נוכחות’,‘דיווח שעות’],a:‘לשונית שעון נוכחות ← כניסה בהגעה, יציאה בסיום.’},
{q:[‘מה קורה אם שכחתי לדווח’,‘שכחתי לדווח’,‘תיקון שעות’],a:‘פנה למנהל לתיקון ידני.’},
{q:[‘מה יש בלשונית סקירה’,‘לשונית סקירה’,‘דשבורד עובד’],a:‘יתרה נוכחית, ניצול השנה, חופשות קרובות, סטטוס בקשה אחרונה, תחזית סוף שנה.’},
{q:[‘מה יש בלשונית לוח מנהל’,‘לוח מנהל’],a:‘נוכחות צוות, בקשות ממתינות, יתרות עובדים, תחזיות עומסים, ציוני רווחה.’},
{q:[‘מה יש בלשונית ניהול’,‘לשונית ניהול’,‘מה יש בניהול’],a:‘לשונית ניהול (אדמין בלבד): ניהול עובדים, מחלקות, הרשאות, הגדרות, גיבוי, Firebase.’},
{q:[‘מה יש בלשונית שעון’,‘לשונית שעון’],a:‘כניסה/יציאה, דיווח WFH, דיווח מחלה, היסטוריית נוכחות.’},
{q:[‘מה יש בלשונית דוח אישי’,‘דוח אישי’],a:‘היסטוריית דיווחים, פירוט חודשי, ניתוח ניצול, ייצוא לאקסל.’},
{q:[‘מה אפשר לראות בתצוגה השנתית’,‘תצוגה שנתית’],a:‘מפת חום של כל ימי השנה — רואים בבת אחת אילו חודשים עמוסים.’},
{q:[‘איך מוסיפים עובד חדש’,‘הוספת עובד’,‘עובד חדש’],a:‘לשונית ניהול ← עובדים ← הוסף עובד ← מלא פרטים ← שמור.’},
{q:[‘איך מגדירים מנהל מחלקה’,‘מינוי מנהל’],a:‘לשונית ניהול ← ניהול מחלקות ← מצא מחלקה ← בחר עובד כמנהל.’},
{q:[‘איך מחברים Firebase’,‘הגדרת Firebase’],a:‘לשונית ניהול ← Firebase ← הכנס apiKey ו-projectId ← התחבר.’},
{q:[‘איך מגבים את הנתונים’,‘גיבוי נתונים’],a:‘לשונית ניהול ← גיבוי ← ייצא גיבוי. יורד קובץ JSON עם כל הנתונים.’},
{q:[‘איך מאפסים סיסמת עובד’,‘איפוס סיסמה’],a:‘לשונית ניהול ← מצא עובד ← שלוש נקודות ← אפס סיסמה.’},
{q:[‘מה זה Dazura’,‘מה המערכת’],a:‘Dazura היא מערכת ניהול חופשות ונוכחות לארגונים. מאפשרת לעובדים לנהל חופשות ולמנהלים לאשר ולנתח נתונים.’},
{q:[‘האם המערכת עובדת בנייד’,‘אפליקציה’,‘PWA’],a:‘כן — מותאמת לנייד ותומכת בהתקנה כ-PWA על מסך הבית.’},
{q:[‘האם הנתונים מסונכרנים’,‘סנכרון בין מכשירים’],a:‘כן — Firebase מסנכרן בזמן אמת. שינוי ממכשיר אחד מתעדכן מיידית בכל שאר המכשירים.’},
{q:[‘מה ה-AI יכול לעשות’,‘יכולות AI’,‘מה אפשר לשאול’],a:‘ה-AI יכול:\n• לסמן ימי חופשה / WFH / חצי יום ישירות מהצ'אט\n• לבטל סימונים\n• לדווח מחלה\n• לשלוח בקשת אישור למנהל\n• לחשב יתרות ותחזיות\n• להציג מי נעדר/WFH\n\nפשוט תגיד מה אתה רוצה!’},
{q:[‘האם ה-AI שומר שיחות’,‘פרטיות AI’],a:‘ה-AI שומר הקשר שיחה נוכחית בלבד (עד 20 הודעות). לאחר סגירת הפנל — ההיסטוריה נמחקת.’},
{q:[‘מה ההבדל בין אדמין למנהל’,‘תפקידים’,‘הרשאות תפקיד’],a:‘אדמין: גישה מלאה לכל הנתונים והגדרות. מנהל מחלקה: רואה ומנהל רק עובדי מחלקתו.’},
{q:[‘כיצד שולחים הודעה לעובדים’,‘הודעה לכולם’],a:‘לשונית ניהול ← הודעות ← שלח הודעה חדשה.’},
{q:[‘מה זה פרוטוקול העברת מקל’,‘handover’],a:‘לפני חופשה ממלאים פרוטוקול עם משימות קריטיות ומחליף. המנהל רואה בלוח המנהל.’},
{q:[‘ייצוא לאקסל’,‘להוריד דוח’,‘ייצוא דוח’],a:‘לשונית דוח אישי ← בחר תקופה ← ייצא. הדוח יוריד בפורמט CSV.’},
{q:[‘האם אפשר לפצל חופשה’,‘חופשה בחלקים’],a:‘כן — מגישים בקשות נפרדות לתקופות שונות. כל בקשה תאושר בנפרד.’},
{q:[‘האם ניתן להעביר ימי חופשה לעמית’,‘העברת ימים’],a:‘לא — ימי חופשה אינם ניתנים להעברה. כל עובד מנהל יתרתו האישית.’},
];

let _kbFuse = null;
function getKBFuse() {
if (_kbFuse) return _kbFuse;
const index = [];
KB.forEach(entry => {
entry.q.forEach(q => {
index.push({ _text: norm(q) + ’ ’ + norm(entry.q[0]), _answer: entry.a });
});
});
_kbFuse = new BuiltinFuse(index, {
keys: [{ name:’_text’, weight:1 }],
threshold: 0.32,
minMatchCharLength: 4,
});
return _kbFuse;
}

function runKnowledge(raw) {
const t = norm(raw);

```
if (typeof AI_KNOWLEDGE !== 'undefined' && AI_KNOWLEDGE.length) {
  for (const entry of AI_KNOWLEDGE) {
    const allQ = [entry.q, ...(entry.aliases || [])];
    const matched = allQ.some(q => {
      const qn = norm(q);
      return t === qn || (qn.length >= 4 && t.includes(qn)) || (t.length >= 4 && qn.includes(t));
    });
    if (!matched) continue;
    if (entry.i) return null;
    if (entry.random && Array.isArray(entry.a))
      return entry.a[Math.floor(Math.random() * entry.a.length)];
    if (typeof entry.a === 'string') return entry.a;
    if (Array.isArray(entry.a)) return entry.a[0];
  }
}

for (const entry of KB) {
  if (entry.q.some(q => {
    const qn=norm(q);
    return t===qn || (qn.length>=6&&t.includes(qn)) || (t.length>=6&&qn.includes(t));
  })) return entry.a;
}

const fuse = getKBFuse();
const results = fuse.search(t);
if (results.length && results[0].score < 0.32) {
  return results[0].item._answer;
}

return null;
```

}

// ─────────────────────────────────────────────────────────
// STEP 6 — FALLBACK
// ─────────────────────────────────────────────────────────

function runFallback(raw, user, db) {
const t=norm(raw), adm=isAdmin(user), mgr=isMgr(user,db);

```
if (/שעה|שעות|כניסה|יציאה|נוכחות/.test(t))
  return 'נראה שאתה מחפש מידע על **שעות עבודה**. נסה:\n• "כמה שעות דיווחתי השבוע?"\n• "איך מתקנים שעות שגויות?"';

if (/אישור|אישרו|מאושר|ממתין|נדחה|בקשה/.test(t))
  return 'נסה:\n• "מה סטטוס הבקשה שלי?"\n• **"שלח בקשת אישור למנהל"** — ואני אשלח!';

if (/מחלקה|מנהל|צוות|עמיתים/.test(t))
  return 'נסה:\n• "מי מהצוות בחופשה היום?"\n• "מה מצב הצוות מחר?"';

if (/הגדרות|סיסמה|מייל|לוגו/.test(t))
  return 'נסה:\n• "איך משנים סיסמה?"\n• "איך מחברים Firebase?"';

if (/חופש|חופשה|יתרה|ימים/.test(t))
  return respondBalance(user, db, new Date().getFullYear());

const empUsername = fuzzyFindEmployee(raw, db);
if (empUsername && db.users[empUsername]) {
  ctx.subject = empUsername;
  const u = db.users[empUsername];
  const today = dateKey(new Date()), tp=(db.vacations?.[empUsername]||{})[today];
  const statusWord = {full:'בחופשה 🏖️',half:'בחצי יום 🌅',wfh:'WFH 🏠',sick:'מחלה 🤒'}[tp] || 'במשרד 📍';
  return '**' + u.fullName + '** — היום: ' + statusWord + (isMgr(user,db)?'\nלפרטי יתרה: "מה יתרת [שם העובד]?"':'');
}

const deptName = fuzzyFindDept(raw, db);
if (deptName) {
  const members=Object.values(db.users||{}).filter(u=>u.status!=='pending'&&(Array.isArray(u.dept)?u.dept[0]:u.dept)===deptName);
  return 'מחלקת **' + deptName + '**: ' + members.length + ' עובדים — ' + members.map(u=>u.fullName).join(', ');
}

const examples = adm
  ? '• "מה יתרת החופשה שלי?"\n• "סמן ימי שני כ-WFH במרץ"\n• "תחזית עומסים ל-8 שבועות"\n• "מי בסיכון שחיקה?"'
  : mgr
  ? '• "מי בחופשה מחר?"\n• "סמן WFH מחר"\n• "שלח בקשת אישור"'
  : '• "מה יתרת החופשה שלי?"\n• "סמן לי ימי שני וחמישי כ-WFH במרץ"\n• "דווח מחלה להיום"\n• "שלח בקשת אישור למנהל"';

return fn(user) + ', לא הצלחתי להבין את השאלה. 🙏\n\nנסה לנסח אחרת, למשל:\n' + examples + '\n\nאו כתוב **"עזרה"** לרשימה מלאה.';
```

}

// ─────────────────────────────────────────────────────────
// MAIN respond()
// Pipeline: Help → Actions → Conversation → LiveData → Knowledge → Fallback
// ─────────────────────────────────────────────────────────

function respond(rawInput, currentUser, db) {
if (!rawInput?.trim()) return ‘בבקשה הקלד שאלה.’;
if (!currentUser)      return ‘יש להתחבר למערכת.’;

```
history.push({role:'user', text:rawInput});
if (history.length > MAX_HISTORY*2) history = history.slice(-MAX_HISTORY*2);

let r = null;

// 1. עזרה
if (/^(עזרה|help|מה אתה יכול|מה ניתן לשאול|מה אפשר לשאול)/.test(norm(rawInput)))
  r = respondHelp(currentUser, db);

// 2. פעולות (חדש!)
if (!r) { try { r = runActions(rawInput, currentUser, db); } catch(e) { r = null; } }

// 3. שיחה חופשית (regex בלבד, ללא Fuse)
if (!r) r = runConversation(rawInput, currentUser, db);

// 4. נתונים חיים (+ Fuse לשמות ומחלקות)
if (!r) r = runLiveData(rawInput, currentUser, db);

// 5. בסיס ידע (+ Fuse לתיקון כתיב)
if (!r) r = runKnowledge(rawInput);

// 6. Fallback (+ Fuse כניסיון אחרון)
if (!r) r = runFallback(rawInput, currentUser, db);

history.push({role:'ai', text:r});
return r;
```

}

function clearHistory() {
history = [];
ctx = {subject:null, dept:null, resultList:[], dateInfo:null};
_pendingAction = null;
_kbFuse = null;
}

return {respond, clearHistory};

})();
