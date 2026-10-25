import {createRoot} from 'react-dom/client';
import {SupportChat} from './support-chat';
import {buildBm25Index} from './bm25';
import type {SupportAnswer} from './types';
interface Chunk{chunkId:string;text:string;metadata:{pages:number[];documentTitle:string}}
const nativeFetch=window.fetch.bind(window);
let data:Promise<{chunks:Chunk[]}>|null=null;
// Local retrieval only. This static preview does NOT call OpenAI or fabricate generated answers.
window.fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.pathname:input.url;
 if(url==='/api/support'){
  if(!init?.method||init.method==='GET')return Response.json({configured:false});
  const {question}=JSON.parse(String(init.body));
  data??=nativeFetch('/chunks.json').then(r=>r.json());
  const {chunks}=await data;const byId=new Map(chunks.map(c=>[c.chunkId,c]));
  const index=buildBm25Index(chunks.map(c=>({id:c.chunkId,text:c.text})));
  const hits=index.search(String(question)).slice(0,4);
  const result:SupportAnswer={requestId:(crypto.randomUUID?.() ?? 'preview-'+Date.now()),status:'insufficient_evidence',answer:hits.length?'זו תצוגת ממשק עם חיפוש אמיתי בספר הרכב, ללא יצירת תשובת AI. אפשר לפתוח את המקורות שנמצאו להלן. לאחר חיבור המפתח, הסוכן יפיק תשובה מבוססת מקורות ויאפשר שיחה קולית רציפה.':'בתצוגה זו לא נמצאו מקורות מתאימים לשאלה. תשובות AI ושיחה קולית עדיין אינן מחוברות.',sources:hits.map(h=>{const c=byId.get(h.id)!;return {chunkId:c.chunkId,text:c.text,pages:c.metadata.pages,title:c.metadata.documentTitle};}),escalation:'none',handoffReason:'',retrievalMode:'lexical_preview'};
  return Response.json(result);
 }
 if(url==='/api/voice')return Response.json({error:'נדרש חיבור מפתח OpenAI ייעודי לשיחה קולית.'},{status:503});
 return nativeFetch(input,init);
};
createRoot(document.getElementById('root')!).render(<SupportChat/>);
