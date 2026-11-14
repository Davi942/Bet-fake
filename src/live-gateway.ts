import { OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { Fixtures } from './fixtures';

// Public, read-only feed. No subscribed message handlers or financial data.
@WebSocketGateway({path:'/ws/fixtures',maxPayload:1024})
export class LiveGateway implements OnModuleDestroy {
 @WebSocketServer() server?:Server;
 private snapshot?:Promise<string>;
 constructor(private readonly fixtures:Fixtures) {}
 handleConnection(client:WebSocket){void this.publish(client);}
 publish(client?:WebSocket) {
  const clients=client?[client]:Array.from(this.server?.clients??[]);
  if(!clients.length)return Promise.resolve();
  if(!this.snapshot)this.snapshot=this.fixtures.list()
   .then(fixtures=>JSON.stringify({type:'fixtures',fixtures}))
   .catch(()=>JSON.stringify({type:'unavailable'}))
   .finally(()=>{this.snapshot=undefined;});
  return this.snapshot.then(message=>{
   for(const socket of clients)if(socket.readyState===WebSocket.OPEN){
    // A slow peer resynchronizes on reconnect instead of retaining stale frames.
    if(socket.bufferedAmount>1024*1024)socket.terminate();else socket.send(message);
   }
  }).catch(error=>{console.error('Atualização ao vivo:',error instanceof Error?error.message:error);});
 }
 onModuleDestroy(){for(const client of this.server?.clients??[])client.terminate();}
}
