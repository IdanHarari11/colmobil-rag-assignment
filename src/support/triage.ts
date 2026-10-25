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
