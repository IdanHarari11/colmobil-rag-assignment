import type { ChatHistoryMessage } from "../rag/history";

/**
 * Stage 2 conversation fixtures — separate from the 15-question dev_set.
 * Used for rewrite + answer checks (not only status).
 */
export interface ConversationFixtureTurn {
  /** Prior history for this ask (excludes the follow-up question). */
  history: ChatHistoryMessage[];
  /** Current user question. */
  question: string;
  /** What standaloneQuestion should roughly preserve / avoid. */
  expectStandalone: {
    mustInclude?: string[];
    mustNotInclude?: string[];
  };
  notes: string;
  /**
   * When true, clarification reply is a fixed fixture path —
   * not a live D05 behavior probe.
   */
  clarificationFixture?: boolean;
}

export interface ConversationFixture {
  id: string;
  title: string;
  turns: ConversationFixtureTurn[];
}

export const CONVERSATION_FIXTURES: ConversationFixture[] = [
  {
    id: "C01",
    title: "רכב מקיף + תאריך → מוסך שאינו בהסדר",
    turns: [
      {
        history: [
          {
            role: "user",
            content:
              "יש לי פוליסת רכב מקיף שהונפקה ב-1.3.2026. מה ההשתתפות העצמית במוסך הסדר?",
          },
          {
            role: "assistant",
            content:
              "לפי פוליסת רכב מקיף מ-1.3.2026, במוסך הסדר ההשתתפות העצמית בנזק חלקי היא 1,100 ₪.",
          },
        ],
        question: "ומה במוסך שאינו בהסדר?",
        expectStandalone: {
          mustInclude: ["1.3.2026", "רכב", "מקיף"],
          mustNotInclude: [],
        },
        notes: "Keep issue date + comprehensive auto; swap workshop type only.",
      },
    ],
  },
  {
    id: "C02",
    title: "תיקון תאריך על ידי המשתמש",
    turns: [
      {
        history: [
          {
            role: "user",
            content: "רכב מקיף מ-1.1.2024 — מה ההשתתפות במוסך הסדר?",
          },
          {
            role: "assistant",
            content: "לפי גרסת 2024 במוסך הסדר ההשתתפות היא סכום אחר.",
          },
          {
            role: "user",
            content: "סליחה, התכוונתי לפוליסה מ-1.3.2026.",
          },
          {
            role: "assistant",
            content: "עודכן לתאריך 1.3.2026. מה תרצו לברר?",
          },
        ],
        question: "ומה ההשתתפות במוסך שאינו בהסדר?",
        expectStandalone: {
          mustInclude: ["1.3.2026"],
          mustNotInclude: ["1.1.2024", "2024"],
        },
        notes: "Explicit user correction wins over earlier date.",
      },
    ],
  },
  {
    id: "C03",
    title: "מעבר מרכב לכבודה — אין זליגה",
    turns: [
      {
        history: [
          {
            role: "user",
            content: "ברכב מקיף מ-1.3.2026, מה ההשתתפות במוסך הסדר?",
          },
          {
            role: "assistant",
            content: "במוסך הסדר ההשתתפות היא 1,100 ₪.",
          },
        ],
        question: "ומה לגבי פיצוי על איחור כבודה של 8 שעות?",
        expectStandalone: {
          mustInclude: ["כבודה"],
          mustNotInclude: ["רכב מקיף", "מוסך", "1.3.2026"],
        },
        notes: "Topic switch must not inherit auto product/date.",
      },
    ],
  },
  {
    id: "C04",
    title: "הבהרה → תשובה קצרה (fixture, לא בדיקת D05 חיה)",
    turns: [
      {
        history: [
          { role: "user", content: "מה ההשתתפות העצמית?" },
          {
            role: "assistant",
            content: "לאיזה מוצר ולאיזה אירוע הכוונה?",
          },
        ],
        question: "רכב מקיף, מוסך הסדר, פוליסה מ-1.3.2026",
        expectStandalone: {
          mustInclude: ["רכב", "מקיף", "השתתפות", "1.3.2026"],
        },
        notes: "Join short clarification reply to prior clarify question.",
        clarificationFixture: true,
      },
    ],
  },
  {
    id: "C05a",
    title: "אותו ניסוח המשך — הקשר רכב",
    turns: [
      {
        history: [
          {
            role: "user",
            content: "בפוליסת רכב מקיף מ-1.3.2026 מה ההשתתפות במוסך הסדר?",
          },
          {
            role: "assistant",
            content: "במוסך הסדר: 1,100 ₪.",
          },
        ],
        question: "ומה במקרה של נזק חלקי?",
        expectStandalone: {
          mustInclude: ["רכב", "מקיף"],
          mustNotInclude: ["כבודה"],
        },
        notes: "Same follow-up wording, auto context.",
      },
    ],
  },
  {
    id: "C05b",
    title: "אותו ניסוח המשך — הקשר כבודה",
    turns: [
      {
        history: [
          {
            role: "user",
            content: "מה הפיצוי על איחור כבודה של 8 שעות?",
          },
          {
            role: "assistant",
            content: "לפי תנאי הכבודה יש מדרגות פיצוי לפי שעות האיחור.",
          },
        ],
        question: "ומה במקרה של נזק חלקי?",
        expectStandalone: {
          mustInclude: ["כבודה"],
          mustNotInclude: ["רכב מקיף", "מוסך"],
        },
        notes: "Same follow-up wording, baggage context — must not leak auto.",
      },
    ],
  },
  {
    id: "C06",
    title: "תשובת assistant שגויה אינה הופכת לראיה",
    turns: [
      {
        history: [
          {
            role: "user",
            content: "מה שעות המוקד ביום שישי?",
          },
          {
            role: "assistant",
            content:
              "שעות המוקד ביום שישי הן 09:00–14:00 (נתון שגוי לבדיקה).",
          },
        ],
        question: "אתה בטוח? מה כתוב במסמכים?",
        expectStandalone: {
          mustInclude: ["שישי"],
          mustNotInclude: [],
        },
        notes:
          "Prior wrong assistant hours must not become factual evidence; corpus wins.",
      },
    ],
  },
  {
    id: "C07",
    title: "הפניה שלא ניתן לפתור — בלי המצאה",
    turns: [
      {
        history: [
          { role: "user", content: "שלום, יש לי שאלה על הפוליסה שלי." },
          {
            role: "assistant",
            content: "בשמחה — במה מדובר?",
          },
        ],
        question: "מה ההשתתפות של אותו מוצר שדיברנו עליו?",
        expectStandalone: {
          mustInclude: ["השתתפות"],
        },
        notes:
          "No product was established — unresolvedReferences expected; no invent.",
      },
    ],
  },
];

/** Synthetic branch-edit case for unit tests (no live ask required). */
export const BRANCH_EDIT_FIXTURE = {
  id: "C08",
  title: "עריכת הודעה / regeneration — ענף פעיל בלבד",
  notes:
    "Client must send only the active branch prior turns; edited/regenerated siblings are excluded.",
};
