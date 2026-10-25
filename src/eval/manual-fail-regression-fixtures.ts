import type { ChatHistoryMessage } from "../rag/history";

/**
 * Manual-fail regression set (exposed during development — not holdout).
 *
 * Notes for evaluators live here only. They are never passed into ask(),
 * rewrite, generation, or retrieval.
 */
export interface ManualFailTurn {
  /** Prior history for this ask (excludes the current question). */
  history: ChatHistoryMessage[];
  question: string;
  /**
   * Soft checks on standaloneQuestion after rewrite (empty history → N/A).
   * Used only by the diagnosis runner — not injected into the model.
   */
  expectStandalone?: {
    mustInclude?: string[];
    mustNotInclude?: string[];
  };
  /** Observed failure from manual testing (documentation only). */
  observedFailure: string;
  /** Grounding notes from corpus reading (documentation only). */
  sourceNotes: string;
}

export interface ManualFailCase {
  id: string;
  title: string;
  /** Short English id for reports; not used as a retrieval key. */
  failureTheme: string;
  turns: ManualFailTurn[];
}

export const MANUAL_FAIL_REGRESSION_SET_ID = "manual-fail-regression-v1";

export const MANUAL_FAIL_CASES: ManualFailCase[] = [
  {
    id: "MF-A",
    title: "שלוש תחולות באותה שאלה — השתתפות במוסך הסדר",
    failureTheme: "multi_applicability_single_ask",
    turns: [
      {
        history: [],
        question:
          "מה ההשתתפות העצמית במוסך הסדר בכל אחד מהמקרים: פוליסה שהונפקה ב-28.2.2026 ולא חודשה; פוליסה שהונפקה ב-1.3.2026; פוליסה שהונפקה ב-2024 וחודשה ב-1.4.2026?",
        observedFailure:
          "Manual probe target: distinguish three applicability outcomes in one answer.",
        sourceNotes:
          "2024 policy: מוסך הסדר 950 ₪ (index base 1.1.2024). 2026 policy: מוסך הסדר 1,100 ₪ from issue/renewal on/after 1.3.2026 (index base 1.3.2026). Case1 28.2.2026 no renewal → 2024/950. Case2 1.3.2026 → 2026/1100. Case3 issued 2024 renewed 1.4.2026 → 2026/1100. Do not confuse issue date with index base date.",
      },
    ],
  },
  {
    id: "MF-B",
    title: "תיקון עובדה לאורך שיחה — תאריך הנפקה",
    failureTheme: "user_fact_correction_date",
    turns: [
      {
        history: [],
        question:
          "רכב מקיף שהונפק באפריל 2026: מה ההשתתפות העצמית במוסך הסדר?",
        observedFailure: "Baseline turn (April 2026 → expect 2026 amounts).",
        sourceNotes: "April 2026 issue → 2026 version → 1,100 ₪ מוסך הסדר.",
      },
      {
        history: [
          {
            role: "user",
            content:
              "רכב מקיף שהונפק באפריל 2026: מה ההשתתפות העצמית במוסך הסדר?",
          },
          // Placeholder assistant text for rewrite context only — not corpus evidence.
          {
            role: "assistant",
            content:
              "לפי פוליסת רכב מקיף שהונפקה באפריל 2026, במוסך הסדר ההשתתפות העצמית בנזק חלקי היא 1,100 ₪.",
          },
        ],
        question: "טעיתי: הפוליסה הונפקה בפברואר 2026 ולא חודשה מאז.",
        expectStandalone: {
          mustInclude: ["פברואר", "2026"],
          mustNotInclude: ["אפריל", "1.1.2024"],
        },
        observedFailure:
          "System chose 2024 amounts but rewrote the user's issue date to 2024 or 1.1.2024.",
        sourceNotes:
          "February 2026 issue, not renewed → still under 2024 wording until next renewal → 950 ₪ מוסך הסדר. User date remains February 2026; 1.1.2024 is index base, not issue date.",
      },
      {
        history: [
          {
            role: "user",
            content:
              "רכב מקיף שהונפק באפריל 2026: מה ההשתתפות העצמית במוסך הסדר?",
          },
          {
            role: "assistant",
            content:
              "לפי פוליסת רכב מקיף שהונפקה באפריל 2026, במוסך הסדר ההשתתפות העצמית בנזק חלקי היא 1,100 ₪.",
          },
          {
            role: "user",
            content: "טעיתי: הפוליסה הונפקה בפברואר 2026 ולא חודשה מאז.",
          },
          {
            role: "assistant",
            content:
              "עודכן: פוליסה שהונפקה בפברואר 2026 ולא חודשה מאז כפופה לגרסת 2024 עד החידוש הבא.",
          },
        ],
        question: "ומה במוסך שאינו בהסדר?",
        expectStandalone: {
          mustInclude: ["פברואר", "2026", "שאינו"],
          mustNotInclude: ["אפריל", "1.1.2024"],
        },
        observedFailure:
          "Same date-mutation risk on follow-up; expect 2024 non-network amount 1,850 ₪.",
        sourceNotes:
          "2024 non-network workshop deductible: 1,850 ₪. Keep user issue date February 2026.",
      },
    ],
  },
  {
    id: "MF-C",
    title: "החלפת נושא — רכב → מזומנים בתכולה → השתתפות",
    failureTheme: "topic_switch_false_clarification",
    turns: [
      {
        history: [],
        question:
          "השתתפות עצמית ברכב מקיף שהונפק באפריל 2026, במוסך הסדר.",
        observedFailure: "Baseline auto turn.",
        sourceNotes: "April 2026 → 1,100 ₪ מוסך הסדר.",
      },
      {
        history: [
          {
            role: "user",
            content:
              "השתתפות עצמית ברכב מקיף שהונפק באפריל 2026, במוסך הסדר.",
          },
          {
            role: "assistant",
            content: "במוסך הסדר ההשתתפות העצמית היא 1,100 ₪.",
          },
        ],
        question:
          "עכשיו שאלה אחרת: מה תקרת הכיסוי למזומנים בביטוח תכולת דירה?",
        expectStandalone: {
          mustInclude: ["מזומנים", "תכולה"],
          mustNotInclude: ["רכב מקיף", "מוסך", "אפריל"],
        },
        observedFailure:
          "Clear cash-limit question received a clarification request.",
        sourceNotes: "Home contents limits: מזומנים גבול אחריות 2,000 ₪.",
      },
      {
        history: [
          {
            role: "user",
            content:
              "השתתפות עצמית ברכב מקיף שהונפק באפריל 2026, במוסך הסדר.",
          },
          {
            role: "assistant",
            content: "במוסך הסדר ההשתתפות העצמית היא 1,100 ₪.",
          },
          {
            role: "user",
            content:
              "עכשיו שאלה אחרת: מה תקרת הכיסוי למזומנים בביטוח תכולת דירה?",
          },
          {
            role: "assistant",
            content: "בתכולת דירה תקרת הכיסוי למזומנים היא 2,000 ₪.",
          },
        ],
        question: "ומה ההשתתפות העצמית?",
        expectStandalone: {
          mustInclude: ["תכולה"],
          mustNotInclude: ["רכב מקיף", "מוסך הסדר"],
        },
        observedFailure:
          "Last turn must only clarify truly missing home-context details; must not auto-return to auto.",
        sourceNotes:
          "Home structure deductibles exist (e.g. general 600 ₪). Ambiguity is home event-type if needed — not car product/date.",
      },
    ],
  },
  {
    id: "MF-D",
    title: "עדכון חלקי לנוהל ביטול — 10 ימים ללא תביעה",
    failureTheme: "partial_update_old_rule_leak",
    turns: [
      {
        history: [],
        question:
          "אני מבטל פוליסה בשנת 2026, עשרה ימים אחרי תחילת הביטוח, ולא הייתה תביעה. האם ינכו דמי טיפול? איזה חלק מנוהל הביטול הישן עדיין בתוקף? הפרד בין הכלל שחל עליי לבין מה שחל אחרי 14 יום.",
        observedFailure:
          "Answer mentioned the 2025 update but still used 5% from the old procedure.",
        sourceNotes:
          "Update 2025 (from 1.1.2025) replaces refund-calculation only: within 14 days from purchase date with no claim → full refund, no handling fee; after 14 days → pro-rata with 3% fee capped at 150 ₪. Old 5% must not be stated to customers. Clock source text: מועד הרכישה — user said תחילת הביטוח; treat carefully if those dates differ.",
      },
    ],
  },
  {
    id: "MF-E",
    title: "עמלת סוכן — clawback יום 130 מול 100",
    failureTheme: "english_faq_miss_false_clarify",
    turns: [
      {
        history: [],
        question:
          "אני סוכן ביטוח. לקוח ביטל פוליסה ביום ה-130. מה קורה לעמלה שכבר שולמה לי — agent commission clawback? איני שואל על דמי הטיפול של הלקוח. מה הכלל ומה היה משתנה בביטול ביום ה-100?",
        observedFailure:
          "Asked for policy type instead of answering from the English agent FAQ.",
        sourceNotes:
          "Agent FAQ EN: cancel within 120 days of issue → full commission clawback; between 121 days and 12 months → pro-rata. Day 130 → pro-rata; day 100 → full clawback. Independent of customer handling-fee rules.",
      },
    ],
  },
  {
    id: "MF-F",
    title: "יישום סכום הוצאה — עיכוב כבודה 30 שעות ו-220$",
    failureTheme: "amount_application_incomplete",
    turns: [
      {
        history: [],
        question:
          "כבודה התעכבה 30 שעות. יש PIR וקבלות על פריטים חיוניים בסך 220 דולר. מה התקרה ומה ניתן להסיק לגבי ההחזר בפועל?",
        observedFailure:
          "Answer explained the 300$ ceiling but did not address the 220$ amount.",
        sourceNotes:
          "Luggage delay: >6h up to 150$; >24h additional up to 150$ → combined ceiling 300$ for essentials with PIR. 220$ is below 300$; do not promise automatic eligibility/payment — infer only that claimed receipts are within the documented ceiling subject to claim process.",
      },
    ],
  },
];
