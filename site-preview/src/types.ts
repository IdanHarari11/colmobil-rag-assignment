export interface SupportAnswer {
 requestId:string;status:'answered'|'clarification_needed'|'insufficient_evidence'|'out_of_scope';answer:string;
 sources:Array<{chunkId:string;text:string;pages:number[];title:string}>;
 escalation:'none'|'service'|'urgent';handoffReason:string;retrievalMode:string;
 handoff?:{simulated:true;summary:string};
}