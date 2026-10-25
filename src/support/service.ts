import OpenAI from 'openai';
import { getOpenAiApiKey } from '@/rag/env';
import { applyHistoryWindow, parseAndValidateHistory } from '@/rag/history';
import { rewriteQuery } from '@/rag/rewrite-query';
import { supportRetrieve } from './retrieval';
import { SUPPORT_POLICY } from './policy';
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
 let searchQuestion=question;
 if(history.length)searchQuestion=(await rewriteQuery({question,history,signal})).standaloneQuestion;
 const retrieval=await supportRetrieve(searchQuestion);
 const dialogueExample=await retrieveDialogueExample(searchQuestion);
 const client=new OpenAI({apiKey,maxRetries:0,timeout:45000});
 const completion=await client.chat.completions.create({model:process.env.GENERATION_MODEL||'gpt-4.1-mini',temperature:0,max_completion_tokens:800,messages:[{role:'system',content:SUPPORT_POLICY},...history,{role:'user',content:JSON.stringify({question,standaloneQuestion:searchQuestion,dialogueExample,sources:retrieval.hits.map(h=>({chunkId:h.chunkId,pages:h.pages,text:h.text}))})}],response_format:{type:'json_schema',json_schema:{name:'colmobil_answer',strict:true,schema}}},{signal});
 const payload=validateSupportPayload(JSON.parse(completion.choices[0]?.message?.content||'null'),new Set(retrieval.hits.map(h=>h.chunkId)));
 const sources=[...new Set(payload.citedChunkIds)].map(id=>{const h=retrieval.hits.find(h=>h.chunkId===id)!;return {chunkId:id,text:h.text,pages:h.pages||[],title:h.documentTitle||'ספר הרכב'};});
 // Metadata-only evidence: no audio, question, source body, answer or keys logged.
 console.info(JSON.stringify({event:'support_ask',requestId,retrievalMode:retrieval.mode,sourceIds:sources.map(s=>s.chunkId),status:payload.status,escalation:payload.escalation,ms:Math.round(performance.now()-start),usage:completion.usage}));
 return {requestId,status:payload.status,answer:payload.answer,sources,escalation:payload.escalation,handoffReason:payload.handoffReason,retrievalMode:retrieval.mode,...(payload.escalation!=='none'?{handoff:{simulated:true as const,summary:JSON.stringify({userIssue:question,reason:payload.handoffReason,answer:payload.answer})}}:{})};
}
