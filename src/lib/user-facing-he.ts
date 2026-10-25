/**
 * User-facing Hebrew copy for the Ofek RAG demo UI and API.
 * Kept in Hebrew by product requirement. Not a full i18n framework.
 */

/** Neutral server copy when status=insufficient_evidence. */
export const HE_INSUFFICIENT_EVIDENCE =
  "לא מצאתי במקורות שסופקו מידע מספיק כדי לענות על השאלה.";

export const HE_API_ERRORS = {
  invalidQuestion:
    "השאלה אינה תקינה. בדקו שהטקסט אינו ריק ואינו ארוך מדי.",
  invalidHistory:
    "היסטוריית השיחה אינה תקינה. רעננו את העמוד ונסו שוב.",
  serviceUnavailable:
    "שירות המענה אינו זמין כרגע. נסו שוב מאוחר יותר.",
  rewriteFailed:
    "לא הצלחנו לנסח את שאלת ההמשך מההקשר. נסו שוב.",
  answerReviewFailed:
    "לא הצלחנו לאמת את התשובה מול המקורות. נסו לנסח מחדש או לפצל את השאלה.",
  answerReviewError:
    "אירעה שגיאה טכנית בבדיקת התשובה. נסו שוב.",
  internalError:
    "אירעה שגיאת מערכת בעת יצירת התשובה. נסו שוב.",
  invalidServerPayload: "התקבל פלט לא תקין מהשרת.",
  missingUserQuestion: "לא נמצאה שאלת משתמש לשליחה.",
} as const;

export const HE_UI = {
  appTitle: "אופק ביטוח — RAG",
  brandName: "אופק ביטוח",
  heroPrompt: "במה אפשר לעזור לנציג היום?",
  composerPlaceholder: "כתבו שאלה…",
  send: "שלח",
  openThreadList: "פתיחת רשימת השיחות",
  threadOptions: "אפשרויות שיחה",
  threads: "שיחות",
  citedSources: "מקורות שצוטטו בתשובה",
  sourcePrefix: "מקור",
  copyAnswer: "העתקת תשובה",
  regenerate: "יצירה מחדש",
  editMessage: "עריכת הודעה",
  attachUnavailable: "הוספת קובץ (לא זמין)",
  micUnavailable: "הקלטה (לא זמין)",
  modelLabel: (model: string) => `מודל: ${model}`,
} as const;
