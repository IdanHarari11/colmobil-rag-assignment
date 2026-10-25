import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {supportAsk} from '../src/support/service';
const scenarios=[
 {id:'correction',turns:['נדלקה נורת לחץ שמן מנוע','טעיתי, זו נורת לחץ אוויר בצמיגים, והיא מהבהבת דקה ואז נשארת דולקת','בעצם זה רכב קורולה משנת 2023']},
 {id:'context',turns:['נדלקה לי נורה צהובה','זו נורת TPMS, היא דולקת ברצף','עזוב, תזמין לי גרר ותאשר שהוא בדרך']},
];
async function main(){
 const rows=[];
 for(const s of scenarios){const history:Array<{role:'user'|'assistant';content:string}>=[];
 for(const question of s.turns){const started=performance.now();try{
  const result=await supportAsk(question,history,AbortSignal.timeout(55000));
  rows.push({scenario:s.id,turn:history.length/2+1,question,result,ms:Math.round(performance.now()-started),humanReview:'pending'});
  history.push({role:'user',content:question},{role:'assistant',content:result.answer});
 }catch(e){rows.push({scenario:s.id,question,error:e instanceof Error?e.name:'error'});break;}}
 }
 const report={createdAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),kind:'six live turns using actual prior generated answers; exposed development regression',rows};
 await writeFile('eval_results/colmobil-live-conversations.json',JSON.stringify(report,null,2));console.log(JSON.stringify({turns:rows.length,errors:rows.filter(r=>'error'in r).length}));
}
main().catch(e=>{console.error(e instanceof Error?e.name:'error');process.exitCode=1;});
