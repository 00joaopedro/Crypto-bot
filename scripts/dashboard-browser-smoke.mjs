const { chromium } = await import(process.env.DASHBOARD_BROWSER_MODULE);
const { startDashboard, stopDashboard } = await import('../dist/dashboard.js');
let paused=true,release;
const gate=new Promise(resolve=>release=resolve);
const slowDiagnostics=()=>new Promise(()=>{});
const persistence={
 getDashboardData:async()=>({paused,settings:{symbol:'BTC/USDT',orderSizeUsdt:10,maxTrades:10,maxConcurrentPositions:10,intervalMinutes:15},metrics:{},health:{},orders:[],trades:[],snapshots:[]}),
 latestDemoDecision:async()=>null,latestDemoReconciliation:async()=>null,readControlState:async()=>({paused,pauseReason:null}),setPaused:async(value)=>{paused=value;return true}
};
const server=await startDashboard({port:0,host:'127.0.0.1',password:'test-only-password',sessionSecret:'test-only-secret'.repeat(4),persistence,supportedSymbols:['BTC/USDT'],onSettingsChanged(){},inspectDemoAccounting:slowDiagnostics,inspectDemoPositions:slowDiagnostics,onResume:async(signal)=>{await gate;if(signal?.aborted)return{status:'blocked',reason:'resume_cancelled'};paused=false;return{status:'resumed'}}});
let browser;
try { browser=await chromium.launch({executablePath:process.env.DASHBOARD_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('#password').fill('test-only-password');const start=Date.now();await page.locator('#login-submit').click();await page.locator('#login').waitFor({state:'hidden'});await page.locator('#toggle-bot').waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.getElementById('toggle-bot').disabled);
 console.log(JSON.stringify({check:'mobile login with stalled exchange diagnostics',milliseconds:Date.now()-start,loginDisplay:await page.locator('#login').evaluate(el=>getComputedStyle(el).display)}));
 await page.reload();await page.locator('#login').waitFor({state:'hidden'});await page.waitForFunction(()=>!document.getElementById('toggle-bot').disabled);
 console.log(JSON.stringify({check:'cookie survives reload',authenticated:true}));
 const resumeStart=Date.now();await page.locator('#toggle-bot').click();await page.locator('#control-message').filter({hasText:'Verificando segurança'}).waitFor();
 console.log(JSON.stringify({check:'resume acknowledges while safety check pending',milliseconds:Date.now()-resumeStart,paused}));
 await page.locator('#keep-paused').click();await page.waitForFunction(()=>!document.getElementById('toggle-bot').disabled);release();await page.waitForTimeout(100);
 if(!paused)throw new Error('late resume overrode pause');
 await page.route('**/api/dashboard?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'diagnostic unavailable'})}));
 await page.evaluate(()=>load());
 if(!await page.locator('#dashboard').isVisible()||await page.locator('#login').isVisible())throw new Error('data failure ended session');
 console.log(JSON.stringify({check:'network failure preserves authenticated panel',authenticated:true}));
 console.log(JSON.stringify({check:'manual pause cancels late resume',paused,pageErrors:errors}));
 if(errors.length)throw new Error('browser JavaScript errors');
}finally{release();await browser?.close();await stopDashboard(server)}
