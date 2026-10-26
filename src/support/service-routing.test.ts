import {afterEach,describe,it,expect,vi} from 'vitest';
const routed=vi.hoisted(()=>vi.fn());const retrieve=vi.hoisted(()=>vi.fn());
vi.mock('./route-request',()=>({routeRequest:routed}));vi.mock('./retrieval',()=>({supportRetrieve:retrieve}));
vi.mock('openai',()=>({default:class{chat={completions:{create:vi.fn(()=>{throw new Error('No generation allowed in early routes');})}}}}));
import{supportAsk}from'./service';
const base={scope:'supported',driving:false,highVoltageWork:false,oilPressureWarning:false,hotCoolantWork:false,tyreIndication:'unknown'};
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe('Policy routes before source retrieval',()=>{
 for(const scope of ['unrelated','unsupported_vehicle'])it('does not let vehicle documents reinterpret '+scope,async()=>{vi.stubEnv('OPENAI_API_KEY','test-key');routed.mockResolvedValue({...base,scope});const r=await supportAsk('A synthetic out-of-scope question',[]);expect(r.status).toBe('out_of_scope');expect(r.sources).toEqual([]);expect(retrieve).not.toHaveBeenCalled();});
 it('pauses driving before retrieved app instructions can reach generation',async()=>{vi.stubEnv('OPENAI_API_KEY','test-key');routed.mockResolvedValue({...base,driving:true});const r=await supportAsk('אני על הכביש עכשיו',[]);expect(r.retrievalMode).toBe('safety_pause');expect(r.answer).toContain('לעצור במקום בטוח');expect(retrieve).not.toHaveBeenCalled();});
 it('keeps an unavailable price/dispatch request relevant but unsupported',async()=>{vi.stubEnv('OPENAI_API_KEY','test-key');routed.mockResolvedValue({...base,scope:'capability_gap'});const r=await supportAsk('תזמין לי גרר',[]);expect(r.status).toBe('insufficient_evidence');expect(r.handoff?.simulated).toBe(true);expect(r.answer).toContain('לא הוזמן שירות');expect(retrieve).not.toHaveBeenCalled();});
});
