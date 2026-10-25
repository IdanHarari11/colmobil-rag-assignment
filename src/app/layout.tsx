import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata:Metadata={title:'כלמוביל | העוזר הדיגיטלי לרכב שלך',description:'עוזר שירות בעברית המבוסס על ספר הרכב, בכתיבה ובשיחה קולית רציפה. הדגמת מטלת בית.'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="he" dir="rtl"><body>{children}</body></html>;}
