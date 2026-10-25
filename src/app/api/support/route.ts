import { NextResponse } from 'next/server';
import { supportAsk } from '@/support/service';
import { HistoryValidationError } from '@/rag/history';
import { MissingApiKeyError } from '@/rag/types';
export const maxDuration=60;
export async function POST(request:Request){
 let body;
 try {body=await request.json();}catch{return NextResponse.json({error:'בקשה לא תקינה'},{status:400});}
 if(typeof body?.question!=='string'||!body.question.trim()||body.question.length>2000)return NextResponse.json({error:'יש להזין שאלה של עד 2,000 תווים'},{status:400});
 try{return NextResponse.json(await supportAsk(body.question.trim(),body.history,request.signal));}
 catch(error){if(error instanceof HistoryValidationError)return NextResponse.json({error:'היסטוריית השיחה אינה תקינה'},{status:400});
 if(error instanceof MissingApiKeyError)return NextResponse.json({error:'טרם הוגדר מפתח OpenAI ייעודי למטלה. אפשר לעיין במקורות עד לחיבור.',code:'missing_key'},{status:503});
 return NextResponse.json({error:'לא הצלחתי להפיק תשובה מבוססת כרגע. כדאי לנסות שוב או לפנות לנציג שירות.'},{status:502});}
}
export async function GET(){return NextResponse.json({configured:Boolean(process.env.OPENAI_API_KEY),voice:'OpenAI Realtime',scope:'Hyundai Tucson Hybrid 2025'});}
