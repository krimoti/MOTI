// ============================================================
// DAZURA AI FUSE ENGINE v1.0
// ============================================================
// שכבת שדרוג מלאה ל-DazuraAI:
//  1. Fuse.js — חיפוש פאזי לשמות עובדים, מחלקות, תאריכים
//  2. Claude API — תשובות LLM אמיתיות לכל מה שה-AI המקומי לא יודע
//  3. Context-aware — מזכיר שיחה, מבין הקשר
//  4. Fallback graceful — עם או בלי אינטרנט
// ============================================================

const DazuraFuse = (() => {

  // ──────────────────────────────────────────
  // 1. FUSE.JS LOADER
  // ──────────────────────────────────────────
  let _fuseLoaded = false;
  let _fuseLoadPromise = null;

  async function loadFuse() {
    if (_fuseLoaded && window.Fuse) return true;
    if (_fuseLoadPromise) return _fuseLoadPromise;

    _fuseLoadPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/fuse.js/7.0.0/fuse.min.js';
      script.onload = () => { _fuseLoaded = true; resolve(true); };
      script.onerror = () => { console.warn('Fuse.js failed to load'); resolve(false); };
      document.head.appendChild(script);
    });
    return _fuseLoadPromise;
  }

  // ──────────────────────────────────────────
  // 2. FUZZY SEARCH ENGINE
  // ──────────────────────────────────────────

  // חיפוש פאזי בשם עובד — מטפל בשגיאות כתיב, שמות חלקיים, ניקוד חסר
  function fuzzyFindEmployee(query, db) {
    if (!window.Fuse || !db?.users) return null;
    const users = Object.entries(db.users)
      .filter(([, u]) => u.fullName && u.status !== 'pending')
      .map(([username, u]) => ({ username, fullName: u.fullName, dept: u.dept }));

    const fuse = new Fuse(users, {
      keys: ['fullName', 'username'],
      threshold: 0.4,        // 0=מדויק, 1=הכל — 0.4 = פאזי טוב
      minMatchCharLength: 2,
      includeScore: true,
      ignoreLocation: true,
    });
    const results = fuse.search(query);
    return results.length ? results[0].item : null;
  }

  // חיפוש פאזי במחלקות
  function fuzzyFindDept(query, db) {
    if (!window.Fuse || !db?.departments) return null;
    const depts = (db.departments || []).map(d => ({ name: d }));
    const fuse = new Fuse(depts, { keys: ['name'], threshold: 0.4, minMatchCharLength: 2 });
    const r = fuse.search(query);
    return r.length ? r[0].item.name : null;
  }

  // חיפוש פאזי ב-FAQ/כוונות — מחפש את הכוונה הכי קרובה
  function fuzzyFindIntent(query, intentList) {
    if (!window.Fuse) return null;
    const fuse = new Fuse(intentList, {
      keys: ['keywords'],
      threshold: 0.35,
      minMatchCharLength: 3,
      includeScore: true,
    });
    const r = fuse.search(query);
    return r.length ? r[0].item : null;
  }

  // ──────────────────────────────────────────
  // 3. CLAUDE API INTEGRATION
  // ──────────────────────────────────────────

  const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
  let _apiAvailable = null; // null=לא נבדק, true/false

  // Build system prompt עם כל הנתונים הרלוונטיים מה-DB
  function buildSystemPrompt(currentUser, db) {
    const today = new Date().toLocaleDateString('he-IL', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const settings = db?.settings || {};
    const companyName = settings.companyName || 'החברה';
    const depts = (db?.departments || []).join(', ');
    const userRole = { admin: 'מנהל מערכת', manager: 'מנהל מחלקה', accountant: 'חשב/ת', employee: 'עובד/ת' }[currentUser.role] || 'עובד/ת';
    const userDept = Array.isArray(currentUser.dept) ? currentUser.dept.join(', ') : (currentUser.dept || '');

    // נתוני יתרת חופשה של המשתמש
    let balanceInfo = '';
    try {
      const year = new Date().getFullYear();
      const vacs = db?.vacations?.[currentUser.username] || {};
      let full = 0, half = 0;
      Object.entries(vacs).forEach(([dt, type]) => {
        if (dt.startsWith(String(year))) {
          if (type === 'full') full++;
          else if (type === 'half') half++;
        }
      });
      const quota = db?.users?.[currentUser.username]?.quotas?.[year]?.annual || 0;
      const used = full + half * 0.5;
      balanceInfo = `יתרת חופשה ${year}: ניצל ${used} מתוך ${quota} ימים (יתרה: ${(quota - used).toFixed(1)})`;
    } catch (e) {}

    // סטטוס חברה היום
    let companyStatus = '';
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const activeUsers = Object.values(db?.users || {}).filter(u => u.status === 'active');
      let onVac = 0, onWfh = 0;
      activeUsers.forEach(u => {
        const t = db?.vacations?.[u.username]?.[todayStr];
        if (t === 'full' || t === 'half') onVac++;
        else if (t === 'wfh') onWfh++;
      });
      const pending = (db?.approvalRequests || []).filter(r => r.status === 'pending').length;
      companyStatus = `היום: ${onVac} בחופשה, ${onWfh} WFH, ${pending} בקשות ממתינות לאישור`;
    } catch (e) {}

    // בקשות ממתינות למנהל
    let pendingRequests = '';
    if (currentUser.role === 'admin' || currentUser.role === 'manager') {
      try {
        const mine = (db?.approvalRequests || [])
          .filter(r => r.status === 'pending' &&
            (currentUser.role === 'admin' || r.assignedManager === currentUser.username));
        if (mine.length) {
          pendingRequests = `בקשות ממתינות לאישורך: ${mine.map(r =>
            `${r.fullName} (${r.dateRange || r.dates?.[0]}, ${r.days} ימים)`
          ).join('; ')}`;
        }
      } catch (e) {}
    }

    return `אתה MOTI — העוזר החכם של מערכת ניהול חופשות Dazura לחברה "${companyName}".
אתה עוזר חכם, חם, ישראלי, מקצועי ומדויק. 
תענה תמיד בעברית, בצורה קצרה וממוקדת.
השתמש ב-**bold** להדגשות חשובות, וב-emoji ברמיה כשמתאים.
אל תמציא נתונים — אם אין לך מידע, אמור זאת בכנות.

📋 **פרטי המשתמש המחובר:**
- שם: ${currentUser.fullName}
- תפקיד: ${userRole}
- מחלקה: ${userDept}
- ${balanceInfo}

🏢 **מידע על החברה:**
- מחלקות: ${depts}
- ${companyStatus}
${pendingRequests ? '- ' + pendingRequests : ''}

📅 **תאריך היום:** ${today}

🔒 **הרשאות:**
${currentUser.role === 'admin' ? '- גישה מלאה לכל הנתונים' :
  currentUser.role === 'manager' ? '- גישה לנתוני המחלקה שלך בלבד' :
  '- גישה לנתונים האישיים שלך בלבד'}

עזור למשתמש בכל שאלה הקשורה ל:
- חופשות, WFH, ימי מחלה
- יתרות ומכסות
- בקשות אישור
- ניהול צוות (אם מנהל/אדמין)
- כיצד להשתמש במערכת Dazura
- כל שאלה אחרת שתוכל לענות עליה בהקשר זה`;
  }

  // קריאה ל-Claude API
  async function callClaudeAPI(userMessage, conversationHistory, currentUser, db) {
    try {
      // בנה היסטוריה בפורמט של Claude
      const messages = [];
      
      // הוסף היסטוריה (עד 10 הודעות אחרונות לחסכון ב-tokens)
      const recentHistory = conversationHistory.slice(-10);
      recentHistory.forEach(msg => {
        messages.push({
          role: msg.role === 'ai' ? 'assistant' : 'user',
          content: msg.text
        });
      });
      
      // הוסף את ההודעה הנוכחית
      messages.push({ role: 'user', content: userMessage });

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 1000,
          system: buildSystemPrompt(currentUser, db),
          messages,
        })
      });

      if (!response.ok) {
        _apiAvailable = false;
        return null;
      }

      const data = await response.json();
      _apiAvailable = true;
      const text = data.content?.map(c => c.text || '').join('');
      return text || null;

    } catch (err) {
      console.warn('Claude API error:', err.message);
      _apiAvailable = false;
      return null;
    }
  }

  // ──────────────────────────────────────────
  // 4. SMART INTENT ENHANCER
  //    מוסיף חיפוש פאזי לתוך extractEmployeeName
  //    ול-detectIntent
  // ──────────────────────────────────────────

  // מחליף את extractEmployeeName בגרסה חכמה יותר עם Fuse.js
  function smartExtractEmployee(text, db) {
    if (!db?.users) return null;

    // קודם ננסה regex רגיל (מהיר)
    const t = text.toLowerCase();
    for (const [uname, user] of Object.entries(db.users)) {
      if (t.includes(user.fullName.toLowerCase())) return uname;
    }
    for (const [uname, user] of Object.entries(db.users)) {
      for (const part of user.fullName.split(' ').filter(p => p.length > 2)) {
        if (t.includes(part.toLowerCase())) return uname;
      }
    }

    // Fuse.js — מוצא גם עם שגיאות כתיב
    if (window.Fuse) {
      // נסה לחלץ שם מהטקסט (מילים בעברית/אנגלית שנראות כשם)
      const words = text.match(/[\u0590-\u05FF]{2,}|[A-Za-z]{3,}/g) || [];
      for (const word of words) {
        const found = fuzzyFindEmployee(word, db);
        if (found) return found.username;
      }
    }

    return null;
  }

  // ──────────────────────────────────────────
  // 5. ANALYZE — האם השאלה צריכה Claude?
  // ──────────────────────────────────────────

  // שאלות שה-AI המקומי יודע לענות — לא צריך Claude
  const LOCAL_PATTERNS = [
    /מי (בחופשה|ב?wfh|עובד מהבית|במשרד|חולה|נעדר)/i,
    /יתרה|יתרת חופשה|כמה ימים/i,
    /מי אני|פרטים שלי|הפרופיל/i,
    /שלום|היי|הי|בוקר|ערב|מה נשמע/i,
    /תודה|יישר כח|מצוין/i,
    /סטטוס|הבקשה שלי|בקשות ממתינות/i,
    /מי יצר אותך|מי בנה אותך|מוטי/i,
    /כמה עובדים|מצבת|מחלקות/i,
    /חופשה.*היום|היום.*חופשה/i,
    /מחר|השבוע|שבוע הבא/i,
    /תחזית|חיזוי|קצב ניצול/i,
    /שחיקה|burnout/i,
    /פרוטוקול|העברת מקל/i,
  ];

  // בדוק אם DazuraAI יודע לטפל בזה
  function canLocalHandle(text) {
    return LOCAL_PATTERNS.some(pattern => pattern.test(text));
  }

  // ──────────────────────────────────────────
  // 6. MAIN ENHANCED RESPOND
  // ──────────────────────────────────────────

  let _conversationHistory = [];
  let _isProcessing = false;

  // הפונקציה הראשית — מחליפה את DazuraAI.respond
  async function respond(rawInput, currentUser, db, onToken) {
    if (!rawInput?.trim()) return 'בבקשה הקלד שאלה.';
    if (!currentUser) return 'יש להתחבר למערכת.';
    if (_isProcessing) return '⏳ מעבד שאלה קודמת...';

    _isProcessing = true;
    _conversationHistory.push({ role: 'user', text: rawInput });

    try {
      // הבטח טעינת Fuse.js ברקע
      loadFuse().catch(() => {});

      // נסה קודם את ה-AI המקומי — מהיר ולא דורש אינטרנט
      const localResult = tryLocalAI(rawInput, currentUser, db);
      
      if (localResult && localResult !== '__UNKNOWN__') {
        _conversationHistory.push({ role: 'ai', text: localResult });
        _isProcessing = false;
        return localResult;
      }

      // ה-AI המקומי לא ידע — קרא ל-Claude
      if (onToken) onToken('__LOADING__');
      
      const claudeResponse = await callClaudeAPI(
        rawInput,
        _conversationHistory.slice(-10),
        currentUser,
        db
      );

      if (claudeResponse) {
        _conversationHistory.push({ role: 'ai', text: claudeResponse });
        _isProcessing = false;
        return claudeResponse;
      }

      // Claude לא זמין — fallback לתשובה מקומית
      const fallback = generateSmartFallback(rawInput, currentUser, db);
      _conversationHistory.push({ role: 'ai', text: fallback });
      _isProcessing = false;
      return fallback;

    } catch (err) {
      console.error('DazuraFuse respond error:', err);
      _isProcessing = false;
      return 'מצטער, אירעה שגיאה. נסה שוב.';
    }
  }

  // ──────────────────────────────────────────
  // 7. LOCAL AI WRAPPER
  //    מנסה DazuraAI — ואם הוא מחזיר "לא יודע" → __UNKNOWN__
  // ──────────────────────────────────────────

  const UNKNOWN_SIGNALS = [
    'לא הצלחתי להבין',
    'לא בטוח מה',
    'נסח מחדש',
    'שאלה מחוץ לתחום',
    'לא ניתן לענות',
    'בבקשה שאל',
    'לא מוגדר',
    '❓',
  ];

  function tryLocalAI(text, currentUser, db) {
    try {
      if (typeof DazuraAI === 'undefined') return '__UNKNOWN__';
      const result = DazuraAI.respond(text, currentUser, db);
      if (!result) return '__UNKNOWN__';
      // בדוק אם זו תשובת "לא יודע"
      if (UNKNOWN_SIGNALS.some(s => result.includes(s))) return '__UNKNOWN__';
      return result;
    } catch (e) {
      return '__UNKNOWN__';
    }
  }

  // ──────────────────────────────────────────
  // 8. SMART FALLBACK — כשגם Claude לא זמין
  // ──────────────────────────────────────────

  function generateSmartFallback(text, currentUser, db) {
    const t = text.toLowerCase();
    const firstName = currentUser.fullName.split(' ')[0];
    
    // חיפוש פאזי לשם עובד בשאלה
    if (window.Fuse) {
      const emp = smartExtractEmployee(text, db);
      if (emp && db.users[emp]) {
        const u = db.users[emp];
        const today = new Date().toISOString().split('T')[0];
        const type = db?.vacations?.[emp]?.[today];
        const status = type === 'full' ? 'בחופשה' : type === 'half' ? 'בחצי יום' :
          type === 'wfh' ? 'עובד/ת מהבית' : type === 'sick' ? 'ביום מחלה' : 'במשרד';
        return `**${u.fullName}** — היום: ${status} 📋`;
      }
    }

    // Fallback כללי
    return `**${firstName}**, שאלתך נרשמה! 💡\nאני לא מחובר כרגע לאינטרנט לניתוח מתקדם, אבל אני יכול לענות על שאלות על חופשות, יתרות, ומידע מהמערכת.\n\nנסה לשאול: "מי בחופשה היום?" או "מה היתרה שלי?"`;
  }

  // ──────────────────────────────────────────
  // 9. EMPLOYEE SEARCH API (חיצוני)
  //    לשימוש מ-script.js — חיפוש עובד חכם
  // ──────────────────────────────────────────

  async function searchEmployee(query, db) {
    await loadFuse();
    return fuzzyFindEmployee(query, db);
  }

  async function searchDept(query, db) {
    await loadFuse();
    const result = fuzzyFindDept(query, db);
    return result;
  }

  // ──────────────────────────────────────────
  // 10. CONTEXT BUILDER — שאלות המשך חכמות
  // ──────────────────────────────────────────

  // מחלץ נושאים מהשיחה האחרונה לשליחה ל-Claude
  function buildContextSummary(history) {
    if (!history.length) return '';
    const last = history.slice(-4);
    return last.map(m => `${m.role === 'user' ? 'משתמש' : 'MOTI'}: ${m.text.slice(0, 100)}`).join('\n');
  }

  // ──────────────────────────────────────────
  // 11. BULK EMPLOYEE INSIGHTS (מנהל/אדמין)
  //     ניתוח מתקדם עם Claude על נתוני עובדים
  // ──────────────────────────────────────────

  async function analyzeEmployeeData(prompt, currentUser, db) {
    if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
      return 'ניתוח זה זמין למנהלים בלבד.';
    }

    // בנה תקציר נתוני עובדים
    const year = new Date().getFullYear();
    const employeeSummary = Object.values(db.users || {})
      .filter(u => u.status === 'active' && u.role === 'employee')
      .slice(0, 30) // מגבלת tokens
      .map(u => {
        const vacs = db.vacations?.[u.username] || {};
        let full = 0, half = 0;
        Object.entries(vacs).forEach(([dt, type]) => {
          if (dt.startsWith(String(year))) {
            if (type === 'full') full++;
            else if (type === 'half') half++;
          }
        });
        const quota = u.quotas?.[year]?.annual || 0;
        const used = full + half * 0.5;
        const dept = Array.isArray(u.dept) ? u.dept[0] : u.dept;
        return `${u.fullName} (${dept}): ניצל ${used}/${quota} ימים`;
      }).join('\n');

    const enrichedPrompt = `${prompt}\n\nנתוני עובדים לשנת ${year}:\n${employeeSummary}`;
    
    return await callClaudeAPI(enrichedPrompt, [], currentUser, db);
  }

  // ──────────────────────────────────────────
  // 12. INIT — טעינה אוטומטית
  // ──────────────────────────────────────────

  function init() {
    // טען Fuse.js בשקט ברקע
    loadFuse().then(loaded => {
      if (loaded) console.log('✅ DazuraFuse: Fuse.js loaded — fuzzy search active');
      else console.warn('⚠️ DazuraFuse: Fuse.js unavailable — using regex only');
    });

    // בדוק זמינות Claude API בשקט (ניסיון קטן)
    setTimeout(async () => {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'ping' }]
          })
        });
        _apiAvailable = r.status !== 401; // 401 = no key (expected in iframe), not a network error
        console.log(`✅ DazuraFuse: Claude API ${_apiAvailable ? 'active 🧠' : 'standby'}`);
      } catch (e) {
        _apiAvailable = false;
      }
    }, 3000);
  }

  function clearHistory() {
    _conversationHistory = [];
    if (typeof DazuraAI !== 'undefined') DazuraAI.clearHistory();
  }

  // בדיקת סטטוס
  function getStatus() {
    return {
      fuseLoaded: _fuseLoaded && !!window.Fuse,
      apiAvailable: _apiAvailable,
      historyLength: _conversationHistory.length,
    };
  }

  // אתחול אוטומטי
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    respond,
    searchEmployee,
    searchDept,
    analyzeEmployeeData,
    clearHistory,
    getStatus,
    // חשוף פנימי לשימוש מ-script.js
    _smartExtractEmployee: smartExtractEmployee,
    _fuzzyFindEmployee: fuzzyFindEmployee,
    _fuzzyFindDept: fuzzyFindDept,
  };

})();

// ──────────────────────────────────────────
// PATCH: חיבור אוטומטי ל-DazuraAI
// ──────────────────────────────────────────
// מחליף את DazuraAI.respond בגרסה מתקדמת שמשתמשת ב-Claude
// כשה-AI המקומי לא יודע לענות.
// כל הקוד הקיים ממשיך לעבוד — אין צורך לשנות כלום ב-script.js.

(function patchDazuraAI() {
  function applyPatch() {
    if (typeof DazuraAI === 'undefined') {
      setTimeout(applyPatch, 200);
      return;
    }

    const originalRespond = DazuraAI.respond.bind(DazuraAI);
    const originalClear = DazuraAI.clearHistory.bind(DazuraAI);

    // עטיפה של respond — מחזיר Promise
    // מציג אינדיקטור טעינה ומעדכן את ה-UI כשמגיעה תשובה
    DazuraAI.respond = function (rawInput, currentUser, db) {
      // DazuraAI.respond נקרא סינכרונית מ-script.js
      // נחזיר placeholder ונעדכן async
      const placeholder = '⏳ חושב...';
      
      // הפעל async ועדכן את ה-UI כשמגיע
      DazuraFuse.respond(rawInput, currentUser, db).then(response => {
        // מצא את הבועה האחרונה ב-chat ועדכן אותה
        const msgs = document.querySelectorAll('.ai-message');
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.textContent.includes('חושב')) {
          // רנדר markdown בסיסי
          lastMsg.innerHTML = renderMarkdown(response);
        }
      }).catch(() => {});

      return placeholder;
    };

    DazuraAI.clearHistory = function () {
      originalClear();
      DazuraFuse.clearHistory();
    };

    console.log('🔗 DazuraFuse: Patched DazuraAI.respond successfully');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyPatch);
  } else {
    applyPatch();
  }
})();

// ──────────────────────────────────────────
// MARKDOWN RENDERER — לתצוגת תשובות Claude
// ──────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Bullet points
    .replace(/^[•\-]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    // Numbered list
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    // Wrap in paragraph
    .replace(/^(.+)$/, '<p>$1</p>');
}

// ──────────────────────────────────────────
// GLOBAL HELPERS — לשימוש מ-script.js
// ──────────────────────────────────────────

// חיפוש עובד פאזי — ניתן לקרוא מכל מקום ב-script.js
async function fuzzySearchEmployee(query) {
  const db = typeof getDB === 'function' ? getDB() : null;
  if (!db) return null;
  return await DazuraFuse.searchEmployee(query, db);
}

// ניתוח נתוני עובדים עם AI — לשימוש בלוח מנהל
async function aiAnalyzeTeam(prompt) {
  const db = typeof getDB === 'function' ? getDB() : null;
  const user = typeof currentUser !== 'undefined' ? currentUser : null;
  if (!db || !user) return 'לא ניתן לנתח — אין חיבור לנתונים.';
  return await DazuraFuse.analyzeEmployeeData(prompt, user, db);
}
