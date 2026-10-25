import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildBm25Index } from '@/rag/bm25';
interface Example{id:string;synthetic:true;manualPdfPages:number[];messages:Array<{role:string;content:string}>}
/** Separate style/example retrieval: synthetic text never enters technical source IDs. */
export async function retrieveDialogueExample(question:string){
 const examples=JSON.parse(await readFile(path.join(process.cwd(),'corpus/colmobil/synthetic-conversations.json'),'utf8')) as Example[];
 const bm25=buildBm25Index(examples.map(e=>({id:e.id,text:e.messages.map(m=>m.content).join(' ')})));
 const hit=bm25.search(question)[0];
 if(!hit)return null;
 const e=examples.find(e=>e.id===hit.id)!;
 return {synthetic:true,role:'Dialogue style only. Do not use any technical statements as evidence.',messages:e.messages};
}
