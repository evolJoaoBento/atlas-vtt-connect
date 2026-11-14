import {afterEach,expect,it,vi} from 'vitest';
import {createWebSocketClient} from '../../../src/app/online/transport/WebSocketTransport';
class Socket {
 static OPEN=1;static last: Socket;readyState=1;bufferedAmount=0;binaryType='';
 onmessage: ((event:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;
 constructor(_url:string){Socket.last=this;}
 send(_data:unknown):void {this.bufferedAmount=2000;}
 close():void {this.onclose?.();}
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('remembers a high buffer that drained before the first poll and resumes transfers',async()=>{
 vi.useFakeTimers();vi.stubGlobal('WebSocket',Socket);
 const connection=createWebSocketClient({url:'https://relay.example/',token:'a'.repeat(32)}).connect('b'.repeat(32));
 Socket.last.onmessage?.({data:'{"kind":"ready"}'});const link=await connection;
 const drained=vi.fn();const stop=link.onDrain('assets',1000,drained);
 link.send('assets',new Uint8Array(10).buffer);Socket.last.bufferedAmount=0;
 await vi.advanceTimersByTimeAsync(50);expect(drained).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(100);expect(drained).toHaveBeenCalledOnce();
 link.send('assets','next');Socket.last.bufferedAmount=0;await vi.advanceTimersByTimeAsync(50);expect(drained).toHaveBeenCalledTimes(2);
 stop();link.close();
});
