import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadValidatedIndex } from '../src/rag/index-store';
import { createOpenAiEmbedder } from '../src/rag/embedder';
import { retrieve } from '../src/rag/retrieve';

async function main() {
 const cases = JSON.parse(await readFile('eval/colmobil-cases.json','utf8')).cases.filter((c:{category:string;referencePdfPages:number[]}) => c.category==='manual' && c.referencePdfPages.length);
 const index = await loadValidatedIndex({chunksPath:'data/colmobil-chunks.json',indexPath:'data/colmobil-index.json'});
 const embedder = createOpenAiEmbedder();
 const rows:Array<{id:string;question:string;referencePdfPages:number[];mode:string;pages:number[];rank:number|null;hitAt6:boolean;reciprocalRank:number}>=[];
 for(const c of cases){
  const queryEmbedding=(await embedder.embedTexts([c.question])).embeddings[0];
  for(const mode of ['lexical','vector','hybrid'] as const){
   const r=await retrieve(c.question,{mode,topK:6,queryEmbedding},{index});
   const rank=r.hits.findIndex(h=>h.pages?.some(p=>c.referencePdfPages.includes(p)))+1;
   rows.push({id:c.id,question:c.question,referencePdfPages:c.referencePdfPages,mode,pages:r.hits.flatMap(h=>h.pages??[]),rank:rank||null,hitAt6:rank>0,reciprocalRank:rank?1/rank:0});
  }
 }
 const summary=['lexical','vector','hybrid'].map(mode=>{const xs=rows.filter(r=>r.mode===mode);return {mode,count:xs.length,hitAt6:xs.filter(r=>r.hitAt6).length/xs.length,mrr:xs.reduce((s,r)=>s+r.reciprocalRank,0)/xs.length};});
 const report={createdAt:new Date().toISOString(),kind:'exposed development page-hit comparison; not answer accuracy',manifest:index.manifest,pdfSha256:createHash('sha256').update(await readFile('corpus/colmobil/manual.pdf')).digest('hex'),summary,rows};
 await writeFile('eval_results/colmobil-retrieval-comparison.json',JSON.stringify(report,null,2));console.log(JSON.stringify(summary));
}
main().catch(e=>{console.error(e instanceof Error?e.name:'error');process.exitCode=1;});
