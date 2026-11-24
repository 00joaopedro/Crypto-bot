import { setTimeout as wait } from 'node:timers/promises';
import { OkxCandleStream } from './okx-candle-stream.js';
if(process.argv.length!==2)throw new Error('Usage: market:stream-smoke; public BTC subscriptions only, no orders');
const stream=new OkxCandleStream(['BTC/USDT']);
try{
 stream.start();const until=Date.now()+12000;
 while(Date.now()<until&&stream.summary().subscriptionsConfirmed<2&&!stream.summary().disabled&&!stream.summary().integrityFault)await wait(100);
 const result=stream.summary();
 if(!result.connected||result.subscriptionsConfirmed!==2)throw new Error('Public candle subscription not confirmed within 12 seconds');
 console.log(JSON.stringify({event:'public_market_stream_smoke',...result,confirmationScope:'15m_and_1h_subscription_ack_only_not_a_48h_test'}));
}finally{stream.stop();}
