import { describe,it,expect } from 'vitest';
import { validateSupportPayload } from './service';
import { supportRetrieve } from './retrieval';
import { SUPPORT_POLICY } from './policy';
describe('Colmobil grounding contract',()=>{
 const valid={status:'answered',answer:'תשובה מבוססת',citedChunkIds:['manual-p131-1'],escalation:'none',handoffReason:''};
 it('rejects invented citations',()=>expect(()=>validateSupportPayload({...valid,citedChunkIds:['invented']},new Set(['manual-p131-1']))).toThrow());
 it('rejects uncited routine technical answers',()=>expect(()=>validateSupportPayload({...valid,citedChunkIds:[]},new Set())).toThrow());
 it('does not let escalation bypass the evidence requirement',()=>expect(()=>validateSupportPayload({...valid,citedChunkIds:[],escalation:'urgent',handoffReason:'סכנה'},new Set())).toThrow());
 it('requires a reason for human handoff',()=>expect(()=>validateSupportPayload({...valid,escalation:'service',handoffReason:' '},new Set(['manual-p131-1']))).toThrow());
 it('allows an evidence-free clarification',()=>expect(validateSupportPayload({...valid,status:'clarification_needed',citedChunkIds:[]},new Set()).status).toBe('clarification_needed'));
 it('accepts an explicit scope refusal without sources or handoff',()=>expect(validateSupportPayload({...valid,status:'out_of_scope',answer:'אפשר לעזור רק בנושאי טוסון היברידי 2025.',citedChunkIds:[]},new Set()).status).toBe('out_of_scope'));
 it('rejects source-backed or escalated scope refusals',()=>{expect(()=>validateSupportPayload({...valid,status:'out_of_scope'},new Set(['manual-p131-1']))).toThrow();expect(()=>validateSupportPayload({...valid,status:'out_of_scope',citedChunkIds:[],escalation:'service'},new Set())).toThrow();});
 it('retains a cited answer',()=>expect(validateSupportPayload(valid,new Set(['manual-p131-1']))).toEqual(valid));
 it('keeps manufacturer and synthetic roles explicit',()=>{expect(SUPPORT_POLICY).toContain('Synthetic service conversations');expect(SUPPORT_POLICY).toContain('Handoff is a DEMO only');});
});
describe('Hebrew manual retrieval without fabricated vectors',()=>{
 it('finds the oil warning page and exact PDF provenance',async()=>{const result=await supportRetrieve('נורית אזהרת לחץ שמן מנוע נמוך');expect(result.hits.some(h=>h.pages?.includes(131))).toBe(true);expect(result.hits.every(h=>h.relativePath==='corpus/colmobil/manual.pdf')).toBe(true);});
 it('finds the TPMS manufacturer guidance',async()=>{const result=await supportRetrieve('מערכת TPMS לחץ אוויר בצמיגים');expect(result.hits.some(h=>h.pages?.some(p=>[133,509,510,511,512,513].includes(p)))).toBe(true);});
});
