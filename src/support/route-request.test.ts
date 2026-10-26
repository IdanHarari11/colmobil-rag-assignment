import{describe,it,expect}from'vitest';import{parseRequestRoute}from'./route-request';
describe('Intent route validation',()=>{
 const valid={scope:'supported',driving:false,highVoltageWork:false,oilPressureWarning:false,hotCoolantWork:false,tyreIndication:'steady_without_flash'};
 it('retains explicit no-flash state',()=>expect(parseRequestRoute(valid).tyreIndication).toBe('steady_without_flash'));
 it('rejects missing/invalid safety context instead of permissive fallback',()=>{expect(()=>parseRequestRoute({...valid,driving:'no'})).toThrow();expect(()=>parseRequestRoute({...valid,scope:'whatever'})).toThrow();expect(()=>parseRequestRoute({...valid,tyreIndication:undefined})).toThrow();});
});
