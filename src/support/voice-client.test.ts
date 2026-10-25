import { describe,it,expect,vi,afterEach } from 'vitest';
import { SupportVoice } from './voice-client';
// Lifecycle contract tests; these do NOT simulate acoustic quality or the provider.
function harness(onQuestion=vi.fn(async()=> 'תשובה מאושרת')){
 const sent:unknown[]=[];const track={stop:vi.fn(),enabled:true};
 const dc={readyState:'open',send:(s:string)=>sent.push(JSON.parse(s)),close:vi.fn(),onopen:null as null|(()=>void),onmessage:null as null|((e:{data:string})=>void)};
 const pc={addTrack:vi.fn(),createDataChannel:()=>dc,createOffer:async()=>({sdp:'v=0\r\n'}),setLocalDescription:vi.fn(),setRemoteDescription:vi.fn(),close:vi.fn(),ontrack:null,onconnectionstatechange:null};
 vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]})}});
 vi.stubGlobal('RTCPeerConnection',class{constructor(){return pc;}});
 vi.stubGlobal('Audio',class{autoplay=false;srcObject=null;pause=vi.fn();play=vi.fn(async()=>{});});
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,text:async()=> 'v=0 answer'})));
 const onState=vi.fn(),onError=vi.fn();
 const session=new SupportVoice({onState,onError,onQuestion});
 const event=(e:unknown)=>dc.onmessage!({data:JSON.stringify(e)});
 return {session,event,sent,track,dc,pc,onState,onError,onQuestion};
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('Continuous voice lifecycle',()=>{
 it('sends only the server-approved answer for speech',async()=>{const h=harness();await h.session.start();h.event({type:'input_audio_buffer.speech_started',item_id:'a'});h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'a',transcript:'מה עושים?'});await vi.waitFor(()=>expect(h.sent.some((e:unknown)=>(e as {type:string}).type==='response.create')).toBe(true));const response=h.sent.find((e:unknown)=>(e as {type:string}).type==='response.create') as {response:{instructions:string;conversation:string}};expect(response.response.instructions).toContain('תשובה מאושרת');expect(response.response.conversation).toBe('none');h.session.stop();});
 it('does not speak stale RAG output after interruption',async()=>{let resolve!:(s:string)=>void;const h=harness(vi.fn(()=>new Promise<string>(r=>{resolve=r;})));await h.session.start();h.event({type:'input_audio_buffer.speech_started',item_id:'a'});h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'a',transcript:'שאלה'});h.event({type:'input_audio_buffer.speech_started',item_id:'b'});resolve('תשובה ישנה');await Promise.resolve();await Promise.resolve();expect(h.sent.some((e:unknown)=>(e as {type:string}).type==='response.create')).toBe(false);h.session.stop();});
 it('ignores duplicate and delayed transcript events',async()=>{const h=harness();await h.session.start();h.event({type:'input_audio_buffer.speech_started',item_id:'b'});h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'a',transcript:'ישן'});expect(h.onQuestion).not.toHaveBeenCalled();h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'b',transcript:'חדש'});h.event({type:'conversation.item.input_audio_transcription.completed',item_id:'b',transcript:'חדש'});expect(h.onQuestion).toHaveBeenCalledTimes(1);h.session.stop();});
 it('handles a malformed provider event without crashing',async()=>{const h=harness();await h.session.start();h.dc.onmessage!({data:'{'});expect(h.onError).toHaveBeenCalled();h.session.stop();});
 it('aborts pending SDP negotiation when the call ends',async()=>{const h=harness();let pendingSignal:AbortSignal|undefined;vi.stubGlobal('fetch',vi.fn((_url:string,options:{signal:AbortSignal})=>{pendingSignal=options.signal;return new Promise(()=>{});}));void h.session.start();await vi.waitFor(()=>expect(pendingSignal).toBeDefined());h.session.stop();expect(pendingSignal!.aborted).toBe(true);});
 it('times out a microphone permission request that never resolves',async()=>{vi.useFakeTimers();const h=harness();vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(()=>{})}});void h.session.start();await vi.advanceTimersByTimeAsync(30000);expect(h.onError).toHaveBeenCalled();expect(h.onState).toHaveBeenLastCalledWith('disconnected');});
 it('mutes and releases the microphone on stop',async()=>{const h=harness();await h.session.start();h.session.setMuted(true);expect(h.track.enabled).toBe(false);h.session.stop();expect(h.track.stop).toHaveBeenCalled();expect(h.pc.close).toHaveBeenCalled();expect(h.dc.close).toHaveBeenCalled();expect(h.onState).toHaveBeenLastCalledWith('disconnected');});
});
