// ============================================================
// DAZURA AI FUSE ENGINE v2.1
// ============================================================
// ללא LLM — מקומי לחלוטין, עובד על כל מכשיר ודפדפן
//  1. Fuse.js  — חיפוש פאזי לשמות עובדים ומחלקות
//  2. DazuraAI — מנוע תשובות מקומי (ai.js)
//  3. Fallback — תשובה חכמה לפי מילות מפתח
// ============================================================

const DazuraFuse = (() => {

  // ──────────────────────────────────────────
  // 1. BUILT-IN FUZZY SEARCH (ללא CDN — 100% מקומי)
  // ──────────────────────────────────────────

  // Minimal Fuse.js-compatible implementation — no network needed
  // Supports: keys with weight, threshold, includeScore, ignoreLocation
  class BuiltinFuse {
    constructor(list, options = {}) {
      this._list      = list;
      this._keys      = (options.keys || []).map(k => typeof k === 'string' ? { name: k, weight: 1 } : k);
      this._threshold = options.threshold !== undefined ? options.threshold : 0.6;
      this._minLen    = options.minMatchCharLength || 1;
    }

    search(pattern) {
      if (!pattern || pattern.length < this._minLen) return [];
      const p = pattern.toLowerCase();
      const results = [];

      for (const item of this._list) {
        let bestScore = 1; // 0 = perfect, 1 = no match
        for (const key of this._keys) {
          const val = String(this._get(item, key.name) || '').toLowerCase();
          if (!val) continue;
          const score = this._score(p, val) * (1 - (key.weight || 1) * 0.1);
          if (score < bestScore) bestScore = score;
        }
        if (bestScore <= this._threshold) {
          results.push({ item, score: bestScore });
        }
      }

      return results.sort((a, b) => a.score - b.score);
    }

    _get(obj, path) {
      return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
    }

    _score(pattern, text) {
      if (text === pattern) return 0;
      if (text.includes(pattern)) return 0.1 + (1 - pattern.length / text.length) * 0.2;

      // Levenshtein-based score
      const d = this._lev(pattern, text);
      const maxLen = Math.max(pattern.length, text.length);
      return d / maxLen;
    }

    _lev(a, b) {
      if (a.length === 0) return b.length;
      if (b.length === 0) return a.length;
      // Cap at 20 chars for performance
      if (a.length > 20) a = a.slice(0, 20);
      if (b.length > 20) b = b.slice(0, 20);
      const m = a.length, n = b.length;
      const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] = a[i-1] === b[j-1]
            ? dp[i-1][j-1]
            : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        }
      }
      return dp[m][n];
    }
  }

  // Expose as window.Fuse so existing fuzzyFind* code works unchanged
  if (typeof window !== 'undefined') window.Fuse = BuiltinFuse;

  let _fuseLoaded = true; // always ready — no network needed

  function loadFuse() {
    if (typeof window !== 'undefined') window.Fuse = BuiltinFuse;
    _fuseLoaded = true;
    return Promise.resolve(true);
  }

  // ──────────────────────────────────────────
  // 2. FUZZY SEARCH
  // ──────────────────────────────────────────

  // נרמול — מסיר ניקוד עברי, גרשיים, רווחים כפולים
  function normalizeText(text) {
    return (text || '')
      .replace(/[\u0591-\u05C7]/g, '')  // ניקוד עברי
      .replace(/['"״׳]/g, '')            // גרש/גרשיים
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  function buildUserIndex(db) {
    if (!db?.users) return [];
    return Object.entries(db.users)
      .filter(([, u]) => u.fullName && u.status !== 'pending')
      .map(([username, u]) => ({
        username,
        fullName:   u.fullName,
        normalized: normalizeText(u.fullName),
        firstName:  u.fullName.split(' ')[0] || '',
        lastName:   u.fullName.split(' ').slice(-1)[0] || '',
        nickname:   u.nickname || u.fullName.split(' ')[0] || '',
      }));
  }

  function fuzzyFindEmployee(query, db) {
    if (!window.Fuse || !db?.users) return null;
    const q     = normalizeText(query);
    const users = buildUserIndex(db);

    // חיפוש מדויק קודם
    const exact = users.find(u =>
      u.normalized === q ||
      u.firstName.toLowerCase() === q ||
      u.lastName.toLowerCase() === q ||
      u.username.toLowerCase() === q
    );
    if (exact) return exact;

    // חיפוש פאזי
    const fuse = new Fuse(users, {
      keys: [
        { name: 'fullName',   weight: 0.4 },
        { name: 'normalized', weight: 0.3 },
        { name: 'firstName',  weight: 0.15 },
        { name: 'lastName',   weight: 0.1 },
        { name: 'nickname',   weight: 0.05 },
      ],
      threshold: 0.42,
      minMatchCharLength: 2,
      includeScore: true,
      ignoreLocation: true,
    });

    const results = fuse.search(q);
    if (results.length && results[0].score < 0.5) return results[0].item;
    return null;
  }

  function fuzzyFindDept(query, db) {
    if (!window.Fuse || !db?.departments) return null;
    const depts = (db.departments || []).map(d => ({
      name: d, normalized: normalizeText(d),
    }));
    const fuse = new Fuse(depts, {
      keys: ['name', 'normalized'],
      threshold: 0.4,
      minMatchCharLength: 2,
    });
    const r = fuse.search(normalizeText(query));
    return r.length ? r[0].item.name : null;
  }

  function smartExtractEmployee(text, db) {
    if (!db?.users) return null;
    const t = normalizeText(text);

    // שם מלא
    for (const [uname, user] of Object.entries(db.users)) {
      if (user.status === 'pending') continue;
      if (t.includes(normalizeText(user.fullName))) return uname;
    }
    // חלק מהשם (מינימום 3 תווים)
    for (const [uname, user] of Object.entries(db.users)) {
      if (user.status === 'pending') continue;
      const parts = normalizeText(user.fullName).split(' ').filter(p => p.length >= 3);
      if (parts.some(p => t.includes(p))) return uname;
    }
    // Fuse על מילים בודדות בטקסט
    if (window.Fuse) {
      const words = text.match(/[\u0590-\u05FF\w]{2,}/g) || [];
      for (const word of words) {
        if (word.length < 3) continue;
        const found = fuzzyFindEmployee(word, db);
        if (found) return found.username;
      }
    }
    return null;
  }

  // ──────────────────────────────────────────
  // 3. UNKNOWN DETECTION
  // ──────────────────────────────────────────

  const UNKNOWN_SIGNALS = [
    'לא הצלחתי להבין', 'לא בטוח מה', 'נסח מחדש',
    'שאלה מחוץ לתחום', '❓', 'לא הבנתי את', 'אנסה שוב',
    'אין לי תשובה', 'לא מצאתי', 'לא יכול לעזור',
  ];

  function isUnknown(text) {
    if (!text || text.trim().length < 5) return true;
    return UNKNOWN_SIGNALS.some(s => text.includes(s));
  }

  // ──────────────────────────────────────────
  // 4. SMART FALLBACK (ללא LLM)
  // ──────────────────────────────────────────

  function fallback(text, currentUser, db) {
    const today = new Date().toISOString().split('T')[0];

    // עובד לפי שם בטקסט
    const empUsername = smartExtractEmployee(text, db);
    if (empUsername && db?.users?.[empUsername]) {
      const u    = db.users[empUsername];
      const type = db?.vacations?.[empUsername]?.[today];
      const statusMap = {
        full: 'בחופשה 🏖️', half: 'בחצי יום 🌅',
        wfh:  'עובד/ת מהבית 🏠', sick: 'ביום מחלה 🤒',
      };
      return `**${u.fullName}** — היום: ${statusMap[type] || 'במשרד 📍'}`;
    }

    // מחלקה לפי שם בטקסט
    const deptName = fuzzyFindDept(text, db);
    if (deptName) {
      const inDept = Object.values(db?.users || {}).filter(u => {
        const d = Array.isArray(u.dept) ? u.dept[0] : u.dept;
        return d === deptName && u.status !== 'pending';
      });
      const away = inDept.filter(u => {
        const t = db?.vacations?.[u.username]?.[today];
        return t === 'full' || t === 'half' || t === 'sick';
      });
      return `מחלקת **${deptName}**: ${inDept.length} עובדים, ${away.length} נעדרים היום.`;
    }

    // הצעה לפי מילות מפתח
    const t = text.toLowerCase();
    if (/חופש|חופשה|יתרה|ימים/.test(t))  return `שאל/י: "מה היתרה שלי?" או "מי בחופשה היום?" 💡`;
    if (/מחלקה|צוות|עובדים/.test(t))      return `שאל/י: "מצב הצוות היום" או "מי במחלקה X?" 💡`;
    if (/מחר|השבוע|שבוע הבא/.test(t))     return `שאל/י: "מי בחופשה מחר?" או "מצב השבוע הבא" 💡`;
    if (/שעות|כניסה|יציאה/.test(t))       return `שאל/י: "איך מתקנים שעות?" או "למי מדווחות השעות?" 💡`;
    if (/אישור|בקשה|סטטוס/.test(t))       return `שאל/י: "מה סטטוס הבקשה שלי?" 💡`;

    return `שאל אותי: "מי בחופשה היום?" | "מה היתרה שלי?" | "מצב הצוות" 💡`;
  }

  // ──────────────────────────────────────────
  // 5. HISTORY + MAIN RESPOND
  // ──────────────────────────────────────────

  let _history = [];
  const MAX_HISTORY = 16;

  async function respondAsync(msg, currentUser, db) {
    _history.push({ role: 'user', text: msg });
    if (_history.length > MAX_HISTORY) _history = _history.slice(-MAX_HISTORY);

    // שלב 1: DazuraAI מקומי (ai.js + ai-patch.js)
    let local = null;
    try {
      if (typeof DazuraAI !== 'undefined') {
        local = DazuraAI.respond(msg, currentUser, db);
      }
    } catch (e) {}

    if (!isUnknown(local)) {
      _history.push({ role: 'ai', text: local });
      return local;
    }

    // שלב 2: Fallback חכם מקומי
    const fb = fallback(msg, currentUser, db);
    _history.push({ role: 'ai', text: fb });
    return fb;
  }

  function clearHistory() { _history = []; }

  // ──────────────────────────────────────────
  // 6. PUBLIC API
  // ──────────────────────────────────────────

  async function searchEmployee(q, db)  { await loadFuse(); return fuzzyFindEmployee(q, db); }
  async function searchDept(q, db)      { await loadFuse(); return fuzzyFindDept(q, db); }
  async function extractEmployee(t, db) { await loadFuse(); return smartExtractEmployee(t, db); }

  // analyzeTeam — ניתוח סטטיסטי מקומי (ללא LLM)
  async function analyzeTeam(prompt, user, db) {
    if (user.role !== 'admin' && user.role !== 'manager') return 'זמין למנהלים בלבד.';

    const year      = new Date().getFullYear();
    const employees = Object.values(db.users || {})
      .filter(u => u.status === 'active' && u.role === 'employee');

    const deptSummary = {};
    employees.forEach(u => {
      const dept = Array.isArray(u.dept) ? u.dept[0] : (u.dept || 'ללא');
      if (!deptSummary[dept]) deptSummary[dept] = { count: 0, used: 0, quota: 0 };
      const vacs = db.vacations?.[u.username] || {};
      let used = 0;
      Object.entries(vacs).forEach(([dt, t]) => {
        if (dt.startsWith(String(year))) used += t === 'full' ? 1 : t === 'half' ? 0.5 : 0;
      });
      deptSummary[dept].count++;
      deptSummary[dept].used  += used;
      deptSummary[dept].quota += u.quotas?.[year]?.annual || 0;
    });

    const rows = Object.entries(deptSummary).map(([dept, s]) => {
      const avg   = (s.used  / Math.max(s.count, 1)).toFixed(1);
      const quota = (s.quota / Math.max(s.count, 1)).toFixed(1);
      const pct   = s.quota > 0 ? Math.round(s.used / s.quota * 100) : 0;
      const flag  = pct > 70 ? '⚠️' : pct < 30 ? '💡' : '✅';
      return `${flag} **${dept}**: ${s.count} עובדים | ניצול ממוצע ${avg}/${quota} ימים (${pct}%)`;
    });

    return `**ניתוח צוות ${year}** (${employees.length} עובדים):\n${rows.join('\n')}`;
  }

  // טען Fuse.js ברקע לאחר שה-splash נעלם
  setTimeout(() => loadFuse(), 2500);

  return {
    respondAsync,
    searchEmployee,
    searchDept,
    extractEmployee,
    analyzeTeam,
    clearHistory,
  };

})();
