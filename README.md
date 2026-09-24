# RAW Studio

אפליקציית ווב לעריכת קבצי RAW (מותאמת ל-Sony ARW, תומכת גם ב-CR3/NEF/DNG ועוד) — עריכה אוטומטית ברמה מקצועית, ואחריה כלים פשוטים לתיקון.

> **סטטוס:** שלב 2 מתוך 4 — עריכה ידנית בזמן אמת. ראו [מפת דרכים](#מפת-דרכים).

## דרישות

- Node.js 20 ומעלה
- דפדפן מודרני עם WebGL2 (Chrome, Edge, Firefox, Safari 16+)

## התקנה והרצה

```bash
npm install
cp .env.example .env      # אופציונלי בשלב זה; מפתח ה-API יידרש בשלב 3
npm run dev
```

פתחו את http://localhost:5173 וגררו קובץ RAW אחד או יותר לחלון (או לחצו **Open RAW…**).

- `npm run dev` מריץ שני תהליכים: שרת ה-API (Express, פורט 8787) ו-Vite (פורט 5173), ש-proxy-מעביר אליו את `/api`.
- הרצת production מקומית: `npm run build && npm start` ← האפליקציה כולה מוגשת מ-http://localhost:8787.
- אין לכם מחשב? ראו [העלאה ל-Vercel](#העלאה-ל-vercel-עובד-גם-מאייפדטלפון).

### משתני סביבה (`.env`)

| משתנה | תיאור | ברירת מחדל |
|---|---|---|
| `ANTHROPIC_API_KEY` | מפתח Claude API. נשמר בשרת בלבד ולא נשלח לדפדפן | — |
| `CLAUDE_MODEL` | המודל לניתוח תמונות ולבקשות בשפה חופשית | `claude-sonnet-5` |
| `PORT` | פורט שרת ה-API | `8787` |

## שימוש

| פעולה | איך |
|---|---|
| פתיחת קבצים | גרירה לחלון, או **Open RAW…** |
| עריכה | סליידרים בפאנל: White balance, Light, Color, HSL, Tone curve, Detail, Straighten |
| איפוס סליידר בודד | דאבל-קליק / דאבל-טאפ על השם שלו |
| זום | דאבל-טאפ על התמונה (Fit ↔ 100%), צביטה, או גלגלת העכבר; גרירה להזזה |
| לפני/אחרי | **Compare** (או `\`) — קו מפריד שאפשר לגרור; **Hold** — לחיצה ממושכת מציגה את המקור |
| Undo / Redo | הכפתורים למעלה, או `Ctrl/⌘+Z` ו-`Ctrl/⌘+Shift+Z` |
| איפוס כל העריכה | **Reset** (אפשר לבטל עם Undo) |

בעקומת הטונים: טאפ מוסיף נקודה, גרירה מזיזה, דאבל-טאפ על נקודה מוחק אותה.
אחוז הזום מחושב ביחס לרזולוציה המלאה של הקובץ. בזמן העריכה עובדים על תצוגה מקדימה בחצי רזולוציה, ולכן הזום המקסימלי החד הוא 50%.

## העלאה ל-Vercel (עובד גם מאייפד/טלפון)

כל ההגדרות כבר בריפו (`vercel.json` + `scripts/build-vercel.mjs`). הבנייה יוצרת תיקיית `.vercel/output` מוכנה:
האתר הסטטי, שרת ה-API כפונקציה אחת, וכותרות ה-COOP/COEP שהמפענח צריך.

1. היכנסו ל-[vercel.com](https://vercel.com) ← **Sign Up** ← **Continue with GitHub**.
2. **Add New… → Project** ← בחרו את הריפו `image-editor` (אם הוא לא מופיע: **Adjust GitHub App Permissions** ותנו גישה לריפו).
3. במסך ההגדרות לא צריך לשנות כלום (Framework Preset: **Other**, הבנייה נלקחת מ-`vercel.json`).
4. תחת **Environment Variables** הוסיפו `ANTHROPIC_API_KEY` (נדרש משלב 3) ואופציונלית `CLAUDE_MODEL`.
5. **Deploy**.

- כל push לענף מקבל כתובת **Preview** משלו (ב-Vercel תחת **Deployments**). ה-**Production** נבנה מ-`main`.
- כתובות Preview מוגנות כברירת מחדל ב-Vercel Authentication — נפתחות רק כשאתם מחוברים ל-Vercel באותו דפדפן.
- באייפד: שמרו את קבצי ה-ARW באפליקציית **Files** ובחרו אותם דרך **Open RAW…** ← **Browse**.
  בחירה מ-"ספריית התמונות" עלולה להמיר את הקובץ ל-JPEG.

## בדיקות

```bash
npm run typecheck   # בדיקת טיפוסים בכל החבילות
npm test            # בדיקות יחידה (vitest): סכמה, עקומות, מיפוי טונים, זום, Undo/Redo
npm run test:e2e    # בדיקת קצה-לקצה ב-Chromium headless (דורש `npm run dev` רץ)
```

בדיקת ה-e2e פותחת קובץ ARW לדוגמה (Sony FX30, יורד אוטומטית בפעם הראשונה ל-`e2e/output/`),
מחכה לפענוח, מזיזה את סליידר החשיפה ובודקת שהתמונה התבהרה, בודקת Undo/Redo ומצב Compare,
ושומרת צילומי מסך ב-`e2e/output/`.
לבדיקה עם קובץ משלכם: `RAW_SAMPLE=/path/to/DSC01234.ARW npm run test:e2e`.

## ארכיטקטורה

```
client/   React + Vite + TypeScript — פענוח RAW, רינדור GPU, ממשק
server/   Express — פרוקסי ל-Claude API (מחזיק את המפתח), ובייצור מגיש גם את ה-client
          (src/app.ts משותף לשרת המקומי ולפונקציה של Vercel)
scripts/  build-vercel.mjs — בונה את .vercel/output לפריסה
shared/   קוד משותף ללקוח ולשרת (סכמת הפרמטרים וכו')
e2e/      בדיקות קצה-לקצה עם Playwright
```

### למה הפענוח קורה בדפדפן (LibRaw → WebAssembly) ולא בשרת?

- **אין העלאה של 25–60MB** — הקובץ נקרא מקומית מהדיסק. מהיר, עובד גם בחיבור איטי ובטלפון, והתמונות לא יוצאות מהמחשב.
- **השרת נשאר דק** — הוא רק מחזיק את מפתח ה-API ומדבר עם Claude; אין צורך ב-Python/rawpy או בקימפול ספריות native.
- **ביצועים** — קודם מוצגת תמונת ה-JPEG שהמצלמה הטמיעה בקובץ (מיידי), ובמקביל LibRaw מפענח גרסת "half size" (רבע מהפיקסלים, ~1.5 שניות לקובץ 24MP) שעליה עובדים בזמן העריכה. פענוח ברזולוציה מלאה יתבצע רק בייצוא.

הספרייה [`libraw-wasm`](https://github.com/ybouane/LibRaw-Wasm) מריצה את LibRaw ב-Web Worker מרובה-threads. זה דורש שהדף יהיה
*cross-origin isolated*, ולכן גם Vite וגם שרת ה-Express שולחים את הכותרות `Cross-Origin-Opener-Policy: same-origin`
ו-`Cross-Origin-Embedder-Policy: require-corp`. אם פותחים את `dist/` דרך שרת אחר — צריך להגדיר בו את אותן כותרות.

### צינור התמונה (GPU)

1. LibRaw מפיק RGB **ליניארי** 16-ביט (איזון לבן של המצלמה, ללא עקומת טונים). הנתונים עולים ל-GPU פעם אחת.
2. **Develop** (shader אחד): איזון לבן → חשיפה → מיפוי טונים → צבע → עקומות RGB.
   - חשיפה, ניגודיות, Highlights/Shadows/Whites/Blacks ועקומת ה-RGB הראשית מחושבים ב-CPU לטבלת חיפוש (LUT) אחת
     בתחום לוגריתמי, ומוחלים על הבהירות בלבד — כך הגוונים לא זזים (`client/src/develop/toneLut.ts`).
   - Vibrance, Saturation ו-HSL מחושבים במרחב הצבע **OKLab/OKLCh**, שבו שינוי גוון/רוויה נראה אחיד לעין.
     Vibrance מגן על גווני עור.
3. **Detail**: הפחתת רעש bilateral (בהירות וצבע בנפרד), ואחריה unsharp mask על הבהירות עם מסכת "Detail".
4. **Display**: יישור, חיתוך, זום, וסליידר לפני/אחרי. זום והזזה מריצים רק את השלב הזה, ולכן הם מהירים.

פרמטרי העריכה מוגדרים פעם אחת ב-`shared/src/params.ts` (סכמת zod): ממנה נגזרים הטיפוסים, טווחי הסליידרים,
ובהמשך גם פורמט ה-JSON שמחזיר Claude וקובץ העריכה ששומרים.

## מפת דרכים

- [x] **שלב 1** — פענוח RAW, תצוגה, קבצים מרובים (filmstrip), מטא-דאטה
- [x] **שלב 2** — סליידרים בזמן אמת (WebGL), עקומת טונים, HSL, חידוד והפחתת רעש, יישור, זום, לפני/אחרי, Undo/Redo, היסטוגרמה
- [ ] **שלב 3** — עריכה אוטומטית: אלגוריתם היסטוגרמה + ניתוח Claude vision, בקשות בשפה חופשית
- [ ] **שלב 4** — Presets, ייצוא JPEG ברזולוציה מלאה, קובץ עריכה JSON (non-destructive)
