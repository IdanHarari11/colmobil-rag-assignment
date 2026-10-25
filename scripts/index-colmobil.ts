import { buildLocalIndex } from '../src/rag/build-index';
async function main(){
const result = await buildLocalIndex({chunksPath:'data/colmobil-chunks.json',indexPath:'data/colmobil-index.json'});
console.log(JSON.stringify({embeddedCount:result.embeddedCount,reused:result.reused,indexPath:result.indexPath}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
