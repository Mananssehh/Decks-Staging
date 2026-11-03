import type {GuestSession} from './guestApplication';
export function connectGuestStream(session:GuestSession,refresh:()=>void,terminal:()=>void,endpoint:string,socketFactory=(url:string)=>new WebSocket(url)){
 let socket:WebSocket|null=null,timer:ReturnType<typeof setTimeout>|undefined,ping:ReturnType<typeof setInterval>|undefined,stopped=false,backoff=1000;
 const close=()=>{if(timer)clearTimeout(timer);if(ping)clearInterval(ping);if(socket){socket.onclose=null;socket.onmessage=null;socket.onopen=null;socket.onerror=null;socket.close();socket=null;}};
 const start=()=>{if(stopped||!navigator.onLine)return;close();socket=socketFactory(endpoint);socket.onopen=()=>{socket?.send(JSON.stringify({type:'auth',event_id:session.event_id,token:session.token}));ping=setInterval(()=>socket?.readyState===1&&socket.send('{"type":"ping"}'),20000);};
 socket.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==='ready'){backoff=1000;refresh();}if(m.type==='invalidate'){refresh();if(m.lifecycle==='ended'){stopped=true;close();}}}catch{/* unknown hints are ignored */}};
 socket.onclose=e=>{if(ping)clearInterval(ping);if(stopped)return;if(e.code===1008){stopped=true;terminal();return;}timer=setTimeout(start,backoff+Math.random()*backoff/2);backoff=Math.min(backoff*2,30000);};socket.onerror=()=>socket?.close();};
 const wake=()=>{refresh();if(!stopped)start();},visible=()=>{if(document.visibilityState==='visible')wake();};
 const fallback=setInterval(()=>{if(!stopped&&navigator.onLine&&document.visibilityState==='visible')refresh();},30000);
 window.addEventListener('online',wake);window.addEventListener('focus',wake);document.addEventListener('visibilitychange',visible);start();
 return()=>{stopped=true;close();clearInterval(fallback);window.removeEventListener('online',wake);window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',visible);};
}