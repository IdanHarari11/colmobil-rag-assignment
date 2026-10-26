'use client';
import { useEffect,useRef,useState } from 'react';
import Link from 'next/link';
import { ArrowUp,AudioLines,CarFront,ChevronDown,FileText,Headphones,Mic,MicOff,PhoneOff,ShieldCheck,Plus,MessageSquare,ExternalLink,Menu,X } from 'lucide-react';
import { SupportVoice,type VoiceState } from './voice-client';
import type { SupportAnswer } from './service';
type Message={id:string;role:'user'|'assistant';text:string;result?:SupportAnswer;interrupted?:boolean};
const states:Record<VoiceState,string>={connecting:'מתחברים לשיחה…',listening:'מקשיבים לך',thinking:'בודקים בספר הרכב…',speaking:'משיבים לך',disconnected:'שיחה קולית רציפה'};
const examples=['נדלקה לי נורה בלוח המחוונים','איך בודקים לחץ אוויר בצמיגים?','הרכב לא מניע — מה עושים?'];
function SidebarContent({onNewChat}:{onNewChat:()=>void}){return <><Link className="brand" href="/" aria-label="כלמוביל שירות"><span className="brand-mark"><CarFront size={26}/></span><span>כלמוביל<span className="brand-sub">תמיד בדרך שלך</span></span></Link>
   <button className="new-chat" onClick={onNewChat}><Plus size={18}/>שיחה חדשה</button>
   <div className="sidebar-caption">מרכז השירות הדיגיטלי</div><div className="sidebar-current"><MessageSquare size={18}/>העוזר האישי לרכב שלך</div>
   <div className="sidebar-bottom"><div className="sidebar-car"><CarFront/><div><strong>יונדאי טוסון היברידי</strong><span>ספר רכב · 2025</span></div></div><p>הדגמת מטלת בית · ללא חיבור למוקד שירות</p></div></>;}
export function SupportChat(){
 const [messages,setMessages]=useState<Message[]>([]),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[voiceState,setVoiceState]=useState<VoiceState>('disconnected'),[muted,setMuted]=useState(false),[ready,setReady]=useState<boolean|null>(null);
 const history=useRef<Message[]>([]),voice=useRef<SupportVoice|null>(null),scroll=useRef<HTMLDivElement>(null),request=useRef<AbortController|null>(null),generation=useRef(0);
 const [sidebarOpen,setSidebarOpen]=useState(false);
 const sidebarDialog=useRef<HTMLDialogElement>(null);
 const active=voiceState!=='disconnected';
 useEffect(()=>{void fetch('/api/support').then(r=>r.json()).then(r=>setReady(r.configured)).catch(()=>setReady(false));return()=>{voice.current?.stop();request.current?.abort();};},[]);
 useEffect(()=>{scroll.current?.scrollIntoView({behavior:'smooth'});},[messages,busy]);
 async function ask(text:string,signal?:AbortSignal){
  const epoch=++generation.current;setError('');setBusy(true);
  const prior=history.current.slice(-12).map(m=>({role:m.role,content:m.text}));
  const user:Message={id:crypto.randomUUID(),role:'user',text};history.current=[...history.current,user];setMessages(history.current);
  try{
   const response=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:text,history:prior}),signal});
   const result=await response.json();if(!response.ok)throw new Error(result.error||'לא ניתן להפיק תשובה');
   if(signal?.aborted||epoch!==generation.current)throw new DOMException('Cancelled','AbortError');
   const assistant:Message={id:crypto.randomUUID(),role:'assistant',text:result.answer,result};history.current=[...history.current,assistant];setMessages(history.current);return result.answer as string;
  }finally{if(epoch===generation.current)setBusy(false);}
 }
 async function submit(text:string){if(busy||active||!text.trim())return;setInput('');request.current=new AbortController();try{await ask(text.trim(),request.current.signal);}catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setError(e instanceof Error?e.message:'אירעה שגיאה');}}
 function toggleVoice(){
  if(active){voice.current?.stop();voice.current=null;return;}
  setError('');setMuted(false);
  const session=new SupportVoice({onState:setVoiceState,onError:setError,onQuestion:ask});voice.current=session;void session.start();
 }
 function reset(){sidebarDialog.current?.close();setInput('');generation.current++;request.current?.abort();voice.current?.stop();history.current=[];setMessages([]);setError('');setBusy(false);}
 return <div className="support-app">
  <aside className="support-sidebar"><SidebarContent onNewChat={reset}/></aside>
  <dialog ref={sidebarDialog} id="mobile-sidebar" className="sidebar-drawer" aria-label="תפריט שיחה" onClose={()=>setSidebarOpen(false)} onClick={e=>{if(e.target===e.currentTarget)sidebarDialog.current?.close();}}>
   <button type="button" className="sidebar-close" aria-label="סגירת תפריט" autoFocus onClick={()=>sidebarDialog.current?.close()}><X size={22}/></button>
   <div className="sidebar-drawer-content"><SidebarContent onNewChat={reset}/></div>
  </dialog>
  <main className="support-main"><header className="support-header"><div><button type="button" className="mobile-menu" aria-label="פתיחת תפריט" aria-haspopup="dialog" aria-controls="mobile-sidebar" aria-expanded={sidebarOpen} onClick={()=>{sidebarDialog.current?.showModal();setSidebarOpen(true);}}><Menu size={22}/></button><span className="online-dot"/>העוזר הדיגיטלי של כלמוביל</div><span className="header-badge"><ShieldCheck size={15}/>מבוסס על ספר הרכב</span></header>
   <div className={'conversation '+(!messages.length?'empty':'')}>
    {!messages.length?<section className="welcome"><div className="welcome-icon"><AudioLines size={32}/></div><div className="eyebrow">קצת יותר ביטחון. בכל נסיעה.</div><h1>איך אפשר לעזור<br/><span>עם הרכב שלך?</span></h1><p>נורה נדלקה? משהו לא ברור?<br/>אפשר לשאול בעברית, בכתיבה או בשיחה קולית.</p>
     <div className="suggestions">{examples.map((s,i)=><button key={s} onClick={()=>void submit(s)}><span className="suggestion-number">0{i+1}</span>{s}<span className="suggestion-arrow">↖</span></button>)}</div>
     <div className="scope-note"><FileText size={15}/>המידע מבוסס על ספר יונדאי טוסון היברידי 2025</div>
    </section>:<div className="message-list">{messages.map(m=><article key={m.id} className={'chat-message '+m.role}><div className="message-avatar">{m.role==='assistant'?<CarFront size={18}/>:<span>אני</span>}</div><div className="message-content"><span className="message-author">{m.role==='assistant'?'העוזר של כלמוביל':'ההודעה שלך'}</span><div className="message-text">{m.text}</div>{m.result&&<>
     {m.result.escalation!=='none'&&<div className={'handoff '+m.result.escalation}><Headphones size={17}/><div><strong>{m.result.escalation==='urgent'?'מומלץ לקבל סיוע אנושי בדחיפות':'מומלץ לפנות לנציג שירות'}</strong><p>{m.result.handoffReason}</p><small>הדגמה בלבד — לא נשלחה פנייה ולא הוזמן שירות.</small><details><summary>סיכום להעברה לנציג</summary><p>{m.result.handoff?.summary}</p></details></div></div>}
     {!!m.result.sources.length&&<details className="sources"><summary><FileText size={15}/>{m.result.sources.length} מקורות מספר הרכב<ChevronDown size={14}/></summary>{m.result.sources.map((s,i)=><div key={s.chunkId} className="source"><a href={'/api/manual#page='+s.pages[0]} target="_blank" rel="noreferrer">[{i+1}] {s.title} · עמוד PDF {s.pages.join(', ')}<ExternalLink size={13}/></a><p>{s.text}</p></div>)}</details>}
    </>}</div></article>)}{busy&&<div className="thinking"><span/><span/><span/>בודקים את המידע בשבילך</div>}<div ref={scroll}/></div>}
   </div>
   <div className="composer-area">{ready===false&&<div className="setup-notice">הדמו בהכנה — יש לחבר מפתח OpenAI ייעודי להפעלת התשובות והשיחה הקולית.</div>}{error&&<div role="alert" className="error-notice">{error}</div>}
    {active&&<div className="voice-session" aria-live="polite"><div className={'voice-wave '+voiceState}>{[1,2,3,4,5,6,7].map(n=><i key={n}/>)}</div><span>{states[voiceState]}</span><small>אפשר לדבר כרגיל ולקטוע את התשובה בכל רגע</small><button aria-label={muted?'הפעלת מיקרופון':'השתקת מיקרופון'} onClick={()=>{voice.current?.setMuted(!muted);setMuted(!muted);}}>{muted?<MicOff size={19}/>:<Mic size={19}/>}</button></div>}
    <form className="composer" onSubmit={e=>{e.preventDefault();void submit(input);}}><input aria-label="השאלה שלך" placeholder={active?'השיחה הקולית פעילה…':'מה קורה עם הרכב שלך?'} value={input} onChange={e=>setInput(e.target.value)} disabled={active} maxLength={2000}/><button type={input.trim()&&!active?'submit':'button'} className={'send composer-action '+(active?'voice-active':'')} aria-label={active?'סיום שיחה':input.trim()?'שליחת שאלה':'התחלת שיחה קולית'} title={active?'סיום שיחה':input.trim()?'שליחת שאלה':'התחלת שיחה קולית'} disabled={busy&&!active} onClick={()=>{if(active||!input.trim())toggleVoice();}}>{active?<PhoneOff size={21}/>:input.trim()?<ArrowUp size={24}/>:<AudioLines size={23}/>}</button></form>
    <div className="composer-footer"><span className="voice-hint">{active?states[voiceState]:'לשיחה קולית, לחצו על גלי הקול בשדה'}</span><span>קול שנוצר באמצעות AI · ייתכנו טעויות</span></div>
    <p className="safety-note">אם כרגע נוהגים, יש לעצור במקום בטוח לפני שימוש במערכת.</p>
   </div>
  </main>
 </div>;
}
