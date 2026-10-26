import {describe,it,expect} from 'vitest';
import {immediateTriage,limitHotCapAnswer,requestsHighVoltageWork,requestsDrivingClearance} from './triage';
describe('Observed live safety regressions',()=>{
 it('refuses to certify continued driving with warning symptoms without inferring a mechanical cause',()=>{expect(requestsDrivingClearance('נורת מנוע מהבהבת והמנוע רועד. אפשר לנסוע עוד חצי שעה?')).toBe(true);expect(requestsDrivingClearance('אפשר לנסוע עם חלון פתוח?')).toBe(false);});
 it('blocks high-voltage work requests without treating warranty or 12V as HV work',()=>{expect(requestsHighVoltageWork('איך מנתקים לבד את הסוללה ההיברידית?')).toBe(true);expect(requestsHighVoltageWork('איך להחליף סוללת מתח גבוה?')).toBe(true);expect(requestsHighVoltageWork('מה האחריות על הסוללה ההיברידית?')).toBe(false);expect(requestsHighVoltageWork('איך מחליפים מצבר 12V?')).toBe(false);});
 it('pauses interaction when the customer resumed driving',()=>expect(immediateTriage('חזרתי לנהוג. תדריך אותי לבדוק בטלפון')?.answer).toContain('לעצור במקום בטוח'));
 it('does not override an explicit stopped state or negation',()=>{expect(immediateTriage('אני לא נוהג, אני חונה')).toBeNull();expect(immediateTriage('חזרתי לנהוג אבל כבר עצרתי')).toBeNull();});
 it('blocks volunteered hot-cap removal, not a prohibition or unrelated procedure',()=>{expect(limitHotCapAnswer('המנוע חם, לפתוח מכסה נוזל קירור?','עטוף במגבת וסובב')).toBe(true);expect(limitHotCapAnswer('המנוע חם, לפתוח מכסה נוזל קירור?','אין לפתוח כשהמנוע חם')).toBe(false);expect(limitHotCapAnswer('איפה מכסה הדלק?','סובב את המכסה')).toBe(false);});
});
