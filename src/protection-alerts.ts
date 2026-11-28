type Event = {eventType:string;severity:"WARN"|"INFO";symbol?:string;details:Record<string,unknown>};
/** Transition journal, not a safety latch: supervision still executes every cycle. */
export class ProtectionAlertJournal {
 private previous:string|null=null;
 private suppressed=0;
 constructor(private readonly write:(event:Event)=>Promise<void>){}
 async observe(blocked?:{reason:string;position?:unknown}):Promise<void>{
  if(!blocked){
   if(this.previous!==null){await this.write({eventType:"DEMO_PROTECTION_RECOVERED",severity:"INFO",details:{suppressedRepeats:this.suppressed}});this.previous=null;this.suppressed=0;}
   return;
  }
  const key=JSON.stringify(blocked);
  if(key===this.previous){this.suppressed++;return;}
  const position=blocked.position;
  await this.write({eventType:"DEMO_PROTECTION_BLOCKED",severity:"WARN",
   ...(position&&typeof position==="object"&&"symbol" in position&&typeof position.symbol==="string"?{symbol:position.symbol}:{}),
   details:{reason:blocked.reason,...(position?{position}:{}),suppressedPreviousRepeats:this.suppressed}});
  this.previous=key;this.suppressed=0;
 }
}
