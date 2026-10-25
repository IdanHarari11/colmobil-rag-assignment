import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { supportAsk } from '../src/support/service';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SUPPORT_POLICY } from '../src/support/policy';
import { getOpenAiApiKey } from '../src/rag/env';
interface Case {id:string;category:string;question:string;allowedStatuses:string[];allowedEscalations:string[];referencePdfPages:number[];history:Array<{role:'user'|'assistant';content:string}>;humanReviewRubric:string}
async function main(){
 const suite=process.argv.find(a=>a.startsWith('--suite='))?.slice(8)||'eval/colmobil-cases.json';
 const {cases}=JSON.parse(await readFile(suite,'utf8')) as {cases:Case[]};
 if(!process.argv.includes('--live')){console.log(JSON.stringify({state:'not_run',cases:cases.length,reason:'Pass --live only with the dedicated assignment key. No model calls were made.'}));return;}
 getOpenAiApiKey({required:true});
 const arg=process.argv.find(a=>a.startsWith('--limit='));
 const limit=arg?Number(arg.slice(8)):10;
 if(!Number.isInteger(limit)||limit<1||limit>cases.length)throw new Error('Invalid case limit');
 const idsArg=process.argv.find(a=>a.startsWith('--ids='));
 const ids=idsArg?.slice(6).split(',');
 if(ids?.some(id=>!cases.some(c=>c.id===id)))throw new Error('Unknown case id');
 const selected=(ids?cases.filter(c=>ids.includes(c.id)):cases).slice(0,limit),rows=[];let errors=0;
 for(const c of selected){
  const start=performance.now();
  try{const result=await supportAsk(c.question,c.history,AbortSignal.timeout(55000));
   const observedPages=result.sources.flatMap(s=>s.pages);
   rows.push({id:c.id,category:c.category,result,ms:Math.round(performance.now()-start),checks:{status:c.allowedStatuses.includes(result.status),escalation:c.allowedEscalations.includes(result.escalation),sourcesAreManual:result.sources.every(s=>s.chunkId.startsWith('manual-p')),referencePageHit:c.referencePdfPages.length?observedPages.some(p=>c.referencePdfPages.includes(p)):null},humanReview:{state:'pending',rubric:c.humanReviewRubric}});
  }catch(e){errors++;rows.push({id:c.id,state:'error',error:e instanceof Error?e.name:'unknown'});if(errors>=2)break;}
 }
 await mkdir('eval_results',{recursive:true});
 const report={createdAt:new Date().toISOString(),commit:process.env.VERCEL_GIT_COMMIT_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0,suite,generationModel:process.env.GENERATION_MODEL||'gpt-4.1-mini',temperature:0,promptSha256:createHash('sha256').update(SUPPORT_POLICY).digest('hex'),indexManifest:JSON.parse(await readFile('data/colmobil-index.json','utf8')).manifest,kind:'exposed development cases; structural gates are NOT semantic correctness',requested:selected.length,completed:rows.length,errors,rows};
 const file='eval_results/colmobil-answers-'+Date.now()+'.json';await writeFile(file,JSON.stringify(report,null,2));console.log(JSON.stringify({file,completed:rows.length,errors,humanReview:'pending'}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Evaluation failed');process.exitCode=1;});
