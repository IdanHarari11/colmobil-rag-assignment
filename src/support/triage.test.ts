import {describe,it,expect} from 'vitest';
import {immediateTriage,limitHotCapAnswer} from './triage';
describe('Observed live safety regressions',()=>{
 it('pauses interaction when the customer resumed driving',()=>expect(immediateTriage('חזרתי לנהוג. תדריך אותי לבדוק בטלפון')?.answer).toContain('לעצור במקום בטוח'));
 it('does not override an explicit stopped state or negation',()=>{expect(immediateTriage('אני לא נוהג, אני חונה')).toBeNull();expect(immediateTriage('חזרתי לנהוג אבל כבר עצרתי')).toBeNull();});
 it('blocks volunteered hot-cap removal, not a prohibition or unrelated procedure',()=>{expect(limitHotCapAnswer('המנוע חם, לפתוח מכסה נוזל קירור?','עטוף במגבת וסובב')).toBe(true);expect(limitHotCapAnswer('המנוע חם, לפתוח מכסה נוזל קירור?','אין לפתוח כשהמנוע חם')).toBe(false);expect(limitHotCapAnswer('איפה מכסה הדלק?','סובב את המכסה')).toBe(false);});
});
