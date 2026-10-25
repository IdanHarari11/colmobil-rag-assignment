import { NextResponse } from 'next/server';
import { getOpenAiApiKey } from '@/rag/env';
import { VOICE_POLICY } from '@/support/policy';
export const maxDuration=60;
export async function POST(request:Request){
 const key=getOpenAiApiKey();
 if(!key)return NextResponse.json({error:'נדרש מפתח OpenAI ייעודי כדי להתחיל שיחה קולית.'},{status:503});
 const sdp=await request.text();
 if(sdp.length>30000||!sdp.startsWith('v=0'))return NextResponse.json({error:'בקשת חיבור לא תקינה'},{status:400});
 const form=new FormData();form.set('sdp',sdp);
 form.set('session',JSON.stringify({type:'realtime',model:process.env.REALTIME_MODEL||'gpt-realtime',instructions:VOICE_POLICY,output_modalities:['audio'],max_output_tokens:1200,audio:{input:{transcription:{model:'gpt-4o-transcribe',language:'he'},turn_detection:{type:'server_vad',threshold:0.5,prefix_padding_ms:300,silence_duration_ms:650,create_response:false,interrupt_response:true}},output:{voice:'marin'}}}));
 try{
 const response=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(30000)});
 if(!response.ok)return NextResponse.json({error:'לא ניתן לחבר את השיחה הקולית כרגע. אפשר להמשיך בטקסט.'},{status:502});
 return new Response(await response.text(),{headers:{'Content-Type':'application/sdp','Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'החיבור הקולי נכשל. אפשר לנסות שוב.'},{status:502});}
}
