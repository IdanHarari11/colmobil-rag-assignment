import { describe,it,expect,vi } from 'vitest';
vi.mock('./service',()=>({supportAsk:vi.fn(async()=>{throw new Error('No upstream request in contract tests');})}));
import { POST as support } from '../app/api/support/route';
import { POST as voice } from '../app/api/voice/route';
describe('Public HTTP validation',()=>{
 it('rejects malformed JSON',async()=>{expect((await support(new Request('http://test/api/support',{method:'POST',body:'{'}))).status).toBe(400);});
 it('rejects empty and oversize questions',async()=>{for(const question of ['', 'x'.repeat(2001)]){const r=await support(new Request('http://test/api/support',{method:'POST',body:JSON.stringify({question})}));expect(r.status).toBe(400);}});
 it('reports a missing voice key without network access or fake audio',async()=>{const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY="";try{const r=await voice(new Request('http://test/api/voice',{method:'POST',body:'v=0'}));expect(r.status).toBe(503);expect(await r.text()).not.toContain('sk-');}finally{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;}});
});
