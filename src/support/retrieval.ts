import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Chunk } from '@/chunking/types';
import { buildBm25Index } from '@/rag/bm25';
import { retrieve } from '@/rag/retrieve';

export function manualSearchQuery(question: string) {
  // Bridge everyday warning-light wording to the manufacturer's terms; search only.
  const normalized=question.replace(/נורת/g,'נורית');
  return /לחץ.*שמן|שמן.*לחץ/.test(normalized)
    ? normalized+' נורית אזהרת לחץ שמן מנוע נמוך' : normalized;
}

export async function supportRetrieve(question: string) {
  question=manualSearchQuery(question);
  const chunksPath=path.join(process.cwd(),'data/colmobil-chunks.json');
  const indexPath=path.join(process.cwd(),'data/colmobil-index.json');
  // Hybrid is used only with real embeddings. No fabricated vectors or silent fallback on API failures.
  let hasIndex=true;
  try { await readFile(indexPath,'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code==='ENOENT') hasIndex=false; else throw e; }
  if(hasIndex) {
    const result=await retrieve(question,{mode:'hybrid',topK:6,indexPath},{chunksPath});
    return {mode:'hybrid' as const,hits:result.hits};
  }
  const {chunks}=JSON.parse(await readFile(chunksPath,'utf8')) as {chunks:Chunk[]};
  const bm25=buildBm25Index(chunks.map(c=>({id:c.chunkId,text:c.text})));
  const byId=new Map(chunks.map(c=>[c.chunkId,c]));
  const hits=bm25.search(question).slice(0,6).map(h=>{
    const c=byId.get(h.id)!;
    return {chunkId:c.chunkId,documentId:c.metadata.documentId,relativePath:c.metadata.relativePath,text:c.text,documentTitle:c.metadata.documentTitle,pages:c.metadata.pages,sectionPath:c.metadata.sectionPath,warnings:c.metadata.warnings,score:h.score};
  });
  return {mode:'lexical_pending_embeddings' as const,hits};
}
