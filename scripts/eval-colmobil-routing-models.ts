import OpenAI from 'openai';import{readFile,writeFile}from'node:fs/promises';import{getOpenAiApiKey}from'../src/rag/env';import{routeRequest}from'../src/support/route-request';
async function main(){
 const cases=JSON.parse(await readFile('eval/colmobil-robustness.json','utf8')).cases as Array<{id:string;question:string}>;
 const client=new OpenAI({apiKey:getOpenAiApiKey({required:true}),maxRetries:0,timeout:45000});const rows=[];
 for(const model of ['gpt-4.1-mini','gpt-4.1']){process.env.ROUTING_MODEL=model;
 for(const c of cases){const id=c.id.replace('robust-','');const expected={scope:id==='unrelated-electric'?'unrelated':id==='hot-other'?'unsupported_vehicle':['fake-dispatch','phone-injection','unsupported-price','warranty-personal'].includes(id)?'capability_gap':'supported',driving:id==='driving-paraphrase',highVoltageWork:['hv-defined','hv-repair'].includes(id),hotCoolantWork:id==='hot-paraphrase',oilPressureWarning:id==='oil-after-fill',tyreIndication:id==='steady'?'steady_without_flash':id==='tpms-60-seconds'?'flashed_then_steady':'unknown'};
 const start=performance.now();try{const actual=await routeRequest(c.question,[],client,AbortSignal.timeout(45000));const failures=Object.entries(expected).filter(([k,v])=>(expected.scope==='supported'||k==='scope')&&actual[k as keyof typeof actual]!==v).map(([k])=>k);rows.push({model,id:c.id,expected,actual,failures,ms:Math.round(performance.now()-start)});console.log(JSON.stringify({model,id:c.id,failures}));}catch(e){rows.push({model,id:c.id,error:e instanceof Error?e.name:'unknown'});}}
 }
 await writeFile('eval_results/colmobil-routing-model-comparison.json',JSON.stringify({kind:'paired exposed routing comparison; not answer accuracy or blind generalization',rows},null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.name:'error');process.exitCode=1;});
