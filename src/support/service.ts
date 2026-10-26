import OpenAI from 'openai';
import { getOpenAiApiKey } from '@/rag/env';
import { applyHistoryWindow, parseAndValidateHistory } from '@/rag/history';
import { rewriteQuery } from '@/rag/rewrite-query';
import { supportRetrieve } from './retrieval';
import { SUPPORT_POLICY } from './policy';
import { immediateTriage,limitHotCapAnswer,requestsHighVoltageWork,requestsDrivingClearance } from './triage';
import { routeRequest } from './route-request';
import { retrieveDialogueExample } from './dialogue';

export interface SupportAnswer {
 requestId:string;status:'answered'|'clarification_needed'|'insufficient_evidence'|'out_of_scope';answer:string;
 sources:Array<{chunkId:string;text:string;pages:number[];title:string}>;
 escalation:'none'|'service'|'urgent';handoffReason:string;retrievalMode:string;
 handoff?:{simulated:true;summary:string};
}
const schema={type:'object',additionalProperties:false,required:['status','answer','citedChunkIds','escalation','handoffReason'],properties:{status:{type:'string',enum:['answered','clarification_needed','insufficient_evidence','out_of_scope']},answer:{type:'string'},citedChunkIds:{type:'array',items:{type:'string'}},escalation:{type:'string',enum:['none','service','urgent']},handoffReason:{type:'string'}}} as const;

export function validateSupportPayload(value:unknown,allowedIds:Set<string>) {
 if(!value||typeof value!=='object')throw new Error('Invalid answer');
 const p=value as Record<string,unknown>;
 if(!['answered','clarification_needed','insufficient_evidence','out_of_scope'].includes(String(p.status))||typeof p.answer!=='string'||!p.answer.trim()||p.answer.length>6000||!Array.isArray(p.citedChunkIds)||!p.citedChunkIds.every(id=>typeof id==='string'&&allowedIds.has(id))||!['none','service','urgent'].includes(String(p.escalation))||typeof p.handoffReason!=='string')throw new Error('Invalid grounded answer');
 if(p.status==='answered'&&p.citedChunkIds.length===0)throw new Error('Answer requires evidence');
 if(p.escalation!=='none'&&!p.handoffReason.trim())throw new Error('Escalation requires a reason');
 if(p.status==='out_of_scope'&&(p.citedChunkIds.length!==0||p.escalation!=='none'))throw new Error('Out-of-scope answers must not cite or dispatch');
 return p as {status:SupportAnswer['status'];answer:string;citedChunkIds:string[];escalation:SupportAnswer['escalation'];handoffReason:string};
}

export async function supportAsk(question:string,historyInput:unknown,signal?:AbortSignal):Promise<SupportAnswer>{
 const start=performance.now(),requestId=crypto.randomUUID();
 const history=applyHistoryWindow(parseAndValidateHistory(historyInput));
 const apiKey=getOpenAiApiKey({required:true});
 const client=new OpenAI({apiKey,maxRetries:0,timeout:45000});
 const route=await routeRequest(question,history,client,signal);
 if(route.scope==='unrelated'||route.scope==='unsupported_vehicle')return {requestId,status:'out_of_scope',answer:'אפשר לסייע כאן רק בנושאי יונדאי טוסון היברידי 2025, לפי ספר הרכב שסופק. אשמח לשאלה על הרכב הנתמך.',sources:[],escalation:'none',handoffReason:'',retrievalMode:'scope_route'};
 if(route.driving||immediateTriage(question))return {requestId,status:'clarification_needed',answer:'יש להפסיק את השימוש בטלפון ולעצור במקום בטוח לפני שנמשיך. לאחר העצירה אפשר לתאר את הנורה או ההודעה.',sources:[],escalation:'none',handoffReason:'',retrievalMode:'safety_pause'};
 if(route.scope==='ambiguous_symptom')return {requestId,status:'clarification_needed',answer:'איזו נורה או הודעה מופיעה? אפשר לתאר את הסמל, הצבע והאם הוא מהבהב או דולק ברצף.',sources:[],escalation:'none',handoffReason:'',retrievalMode:'clarification_route'};
 if(route.scope==='capability_gap')return {requestId,status:'insufficient_evidence',answer:'אין למערכת ההדגמה גישה למחירים, לכיסוי האחריות האישי, לפרטי קשר או להזמנת שירות בפועל. יש לפנות לגורם השירות המתאים. לא נשלחה פנייה ולא הוזמן שירות.',sources:[],escalation:'service',handoffReason:'הבקשה דורשת מידע אישי או פעולת שירות שאינם זמינים במערכת ההדגמה.',retrievalMode:'capability_route',handoff:{simulated:true,summary:question}};
 let searchQuestion=question;
 if(history.length)searchQuestion=(await rewriteQuery({question,history,signal})).standaloneQuestion;
 const retrieval=await supportRetrieve(searchQuestion);
 const dialogueExample=await retrieveDialogueExample(searchQuestion);

 const completion=await client.chat.completions.create({model:process.env.GENERATION_MODEL||'gpt-4.1-mini',temperature:0,max_completion_tokens:800,messages:[{role:'system',content:SUPPORT_POLICY},...history,{role:'user',content:JSON.stringify({question,standaloneQuestion:searchQuestion,requestContext:route,dialogueExample,sources:retrieval.hits.map(h=>({chunkId:h.chunkId,pages:h.pages,text:h.text}))})}],response_format:{type:'json_schema',json_schema:{name:'colmobil_answer',strict:true,schema}}},{signal});
 const payload=validateSupportPayload(JSON.parse(completion.choices[0]?.message?.content||'null'),new Set(retrieval.hits.map(h=>h.chunkId)));
 if(payload.status==='answered'&&route.tyreIndication==='steady_without_flash'){
  const evidence=retrieval.hits.find(h=>{const t=h.text.replace(/\s+/g,'');return t.includes('TPMS')&&t.includes('נמוךבאופןמשמעותי');});
  if(evidence){payload.answer='נורית לחץ אוויר בצמיגים שדולקת ברצף ללא הבהוב קודם מצביעה על לחץ אוויר נמוך באחד הצמיגים או יותר. יש לבדוק את לחץ האוויר בצמיגים כשהם קרים ולהתאים אותו לתווית ברכב. אם יש נזק, איבוד לחץ או ספק, יש לפנות לסיוע מקצועי.';payload.citedChunkIds=[evidence.chunkId];payload.escalation='service';payload.handoffReason='אם יש נזק, איבוד לחץ או ספק, נדרשת בדיקה מקצועית.';}
  else {payload.status='insufficient_evidence';payload.answer='אין במקורות שנשלפו מידע מספיק להבחנה אמינה לגבי הנורה שתיארת. יש לפנות לסיוע מקצועי, ולא להסיק מהתשובה שהרכב בטוח לנסיעה.';payload.citedChunkIds=[];payload.escalation='service';payload.handoffReason='לא נמצאה ראיה מספקת להבחנה בין סוגי חיווי הצמיגים.';}
 }
 if(payload.status==='answered'&&route.tyreIndication==='unknown'&&/TPMS|צמיג|לחץ.{0,8}אוויר/.test(searchQuestion)&&/ברצף|קבוע/.test(question)&&!history.filter(m=>m.role==='user').concat({role:'user',content:question}).some(m=>/הבהב|מהבהב/.test(m.content))){
  payload.status='clarification_needed';payload.answer='האם הנורה הבהבה במשך כדקה לפני שנשארה דולקת, או שהיא נדלקה ברצף ללא הבהוב?';payload.citedChunkIds=[];payload.escalation='none';payload.handoffReason='';
 }
 if(payload.status!=='out_of_scope'&&requestsDrivingClearance(question)){
  payload.status='insufficient_evidence';payload.answer='אין באפשרותי לקבוע דרך הצ׳אט שהרכב בטוח להמשך נסיעה. יש להישאר במקום בטוח ולקבל סיוע מקצועי לפני שממשיכים. זו הדגמה בלבד — לא נשלחה פנייה ולא הוזמן שירות.';payload.citedChunkIds=[];payload.escalation='urgent';payload.handoffReason='נדרשת הערכת גורם מקצועי בשל תסמינים והבקשה לאישור המשך נסיעה.';
 }
 if(payload.status!=='out_of_scope'&&(route.highVoltageWork||requestsHighVoltageWork(question))){
  payload.status='insufficient_evidence';payload.answer='לא אוכל להדריך בניתוק, בפירוק או בתיקון עצמי של מערכת המתח הגבוה. יש לפנות למרכז שירות מורשה של יונדאי. זו הדגמה בלבד — לא נשלחה פנייה למרכז השירות.';payload.escalation='service';payload.handoffReason='עבודה במערכת המתח הגבוה מחייבת סיוע מקצועי; אין לבצע פעולות ניתוק לפי הצ׳אט.';
 }
 if(route.hotCoolantWork||limitHotCapAnswer(question,payload.answer)){
  // Fail closed rather than return an unnecessary cap-removal procedure.
  payload.status='insufficient_evidence';payload.answer='אין לפתוח את מכסה נוזל הקירור כשהמנוע חם. יש להמתין להתקררות המנוע. אם נדרש בירור או טיפול, יש לפנות לסיוע מקצועי.';payload.escalation='service';payload.handoffReason='נדרש סיוע מקצועי ללא הנחיות לפתיחת מכסה חם.';
 }
 // Engine hood and coolant cap are different safety questions.
 if(/אדים/.test(question)&&!/אין\s+אדים|ללא\s+אדים/.test(question)){
  const evidence=retrieval.hits.find(h=>h.text.replace(/\s+/g,'').includes('אלתפתחאתמכסההמנוע'));
  if(evidence){payload.status='answered';payload.answer='אם אדים יוצאים מתא המנוע, יש לדומם את המנוע ולא לפתוח את מכסה המנוע עד שהאדים מפסיקים. יש להישאר במקום בטוח ולפנות לסיוע מקצועי.';payload.citedChunkIds=[evidence.chunkId];payload.escalation='service';payload.handoffReason='נדרשת בדיקה מקצועית עקב אדים מתא המנוע.';}
 }
 if(payload.status!=='out_of_scope'&&payload.escalation==='none'&&/מומלץ.*(?:מרכז שירות|מוסך|סיוע מקצועי)|יש לפנות.*(?:מרכז שירות|מוסך|סיוע מקצועי)/.test(payload.answer)){payload.escalation='service';payload.handoffReason='מומלצת בדיקה מקצועית כפי שמפורט בתשובה.';}
 // Preserve the manufacturer's critical shutdown step on pressure-warning follow-ups.
 if(payload.status==='answered'&&route.oilPressureWarning&&!/(?:כבה|לכבות|כבוי|כיבוי|דומם|לדומם|הפסק.{0,15}המנוע)/.test(payload.answer)){
  const evidence=retrieval.hits.find(h=>{const t=h.text.replace(/\s+/g,' ');return /לחץ.*שמן|שמן.*לחץ/.test(t)&&/דומם.*מנוע|המנוע.*דומם/.test(t);});
  if(evidence){payload.answer='יש לדומם את המנוע. '+payload.answer;payload.citedChunkIds.push(evidence.chunkId);}
 }
 // Include a retrieved original-manual prohibition when a coolant-cap warning is stated.
 if(payload.status!=='out_of_scope'&&/מכסה/.test(payload.answer)&&/קירור|מצנן/.test(payload.answer)){
  const evidence=retrieval.hits.find(h=>{const t=h.text.replace(/\s+/g,'');return /מכסה/.test(t)&&/מצנן|קירור/.test(t)&&/אלתסיר|אלתפתח/.test(t);});
  if(evidence)payload.citedChunkIds.push(evidence.chunkId);
 }
 // Source identifiers are UI metadata, never speech content.
 payload.answer=payload.answer.replace(/\([^()]*manual-p\d+-\d+[^()]*\)/g,'').replace(/\[?manual-p\d+-\d+\]?/g,'').replace(/[ \t]+/g,' ').trim();
 validateSupportPayload(payload,new Set(retrieval.hits.map(h=>h.chunkId)));
 const sources=[...new Set(payload.citedChunkIds)].map(id=>{const h=retrieval.hits.find(h=>h.chunkId===id)!;return {chunkId:id,text:h.text,pages:h.pages||[],title:h.documentTitle||'ספר הרכב'};});
 // Metadata-only evidence: no audio, question, source body, answer or keys logged.
 console.info(JSON.stringify({event:'support_ask',requestId,retrievalMode:retrieval.mode,sourceIds:sources.map(s=>s.chunkId),status:payload.status,escalation:payload.escalation,ms:Math.round(performance.now()-start),usage:completion.usage}));
 return {requestId,status:payload.status,answer:payload.answer,sources,escalation:payload.escalation,handoffReason:payload.handoffReason,retrievalMode:retrieval.mode,...(payload.escalation!=='none'?{handoff:{simulated:true as const,summary:JSON.stringify({userIssue:question,reason:payload.handoffReason,answer:payload.answer})}}:{})};
}
