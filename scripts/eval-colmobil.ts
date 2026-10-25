import { supportRetrieve } from '../src/support/retrieval';
import { writeFile,mkdir } from 'node:fs/promises';
async function main(){
const cases=[
 {id:'oil',q:'נורית אזהרת לחץ שמן מנוע נמוך',pages:[131]},
 {id:'tpms',q:'מערכת TPMS לחץ אוויר בצמיגים',pages:[133,510,511,512,513]},
 {id:'mil',q:'נורית תקלה MIL מערכת בקרת הפליטה מנוע',pages:[132]},
 {id:'charging',q:'נורית אזהרה מערכת הטעינה אלטרנטור',pages:[132]},
 {id:'hot',q:'המנוע מתחמם אדים נוזל קירור',pages:[507,508]},
];
const rows=[];
for(const c of cases){const r=await supportRetrieve(c.q);const rank=r.hits.findIndex(h=>h.pages?.some(p=>c.pages.includes(p)));rows.push({...c,mode:r.mode,pagesRetrieved:r.hits.flatMap(h=>h.pages||[]),hitAt6:rank>=0,reciprocalRank:rank<0?0:1/(rank+1)});}
await mkdir('eval_results',{recursive:true});
const result={kind:'small keyword-heavy retrieval smoke set; not an unseen benchmark or answer accuracy',count:rows.length,hitRateAt6:rows.filter(r=>r.hitAt6).length/rows.length,mrr:rows.reduce((n,r)=>n+r.reciprocalRank,0)/rows.length,rows};
await writeFile('eval_results/colmobil-retrieval.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
