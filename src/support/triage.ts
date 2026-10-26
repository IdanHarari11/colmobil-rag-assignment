/** Narrow, fail-closed safety routes found necessary in live evaluation.
 * This is not a general mechanical classifier. Negative/uncertain wording stays with RAG.
 */
export function immediateTriage(question:string):{answer:string;reason:string}|null {
 const q=question.replace(/[־–—]/g,' ');
 const driving=/חזרתי לנהוג|אני (?:נוהג|נוהגת|בנהיגה)|נוהגים עכשיו/.test(q)&&!/לא (?:נוהג|נוהגת)|כבר עצרתי|אני חונה/.test(q);
 if(driving)return {answer:'יש להפסיק את השימוש בטלפון ולעצור במקום בטוח לפני שנמשיך. לאחר העצירה אפשר לתאר את הנורה או ההודעה.',reason:'השימוש נעצר עד לחניה בטוחה.'};
 return null;
}

export function limitHotCapAnswer(question:string,answer:string):boolean {
 // Never supply a cap-removal procedure in response to an explicitly hot-engine question.
 return /מכסה/.test(question)&&/קירור|רדיאטור/.test(question)&&/חם|רותח/.test(question)&&/מגבת|לסובב|סובב|בעת (?:הסרת|ההסרה)|לשחרר.*לחץ/.test(answer);
}

/** The customer-facing demo must never provide a high-voltage isolation procedure. */
export function requestsHighVoltageWork(question:string):boolean {
 return /מתח\s*גבוה|סולל[הת].{0,20}היבריד|סוללת.{0,12}הנעה/.test(question)
  && /לנתק|מנתק|ניתוק|לפרק|פירוק|להחליף|החלפ|לתקן|תיקון/.test(question);
}

export function requestsDrivingClearance(question:string):boolean {
 return /אפשר|מותר|בטוח/.test(question)&&/לנסוע|להמשיך/.test(question)
  && /נור[הת]|רועד|רועד[ת]?|רעיד|עשן|אדים|מתחמם/.test(question);
}
