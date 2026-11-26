const { chromium } = await import(process.env.DASHBOARD_BROWSER_MODULE);
const { startDashboard, stopDashboard } = await import('../dist/dashboard.js');
let paused=true,release,resumeMode='pending',accountReads=0;
const gate=new Promise(resolve=>release=resolve);
const slowDiagnostics=()=>new Promise(()=>{});
const persistence={
 getDashboardData:async()=>({paused,settings:{symbol:'BTC/USDT',orderSizeUsdt:10,maxTrades:10,maxConcurrentPositions:10,intervalMinutes:15},metrics:{},health:{},orders:[],trades:[],snapshots:[]}),
 latestDemoDecision:async()=>null,latestDemoReconciliation:async()=>null,readControlState:async()=>({paused,pauseReason:null}),setPaused:async(value)=>{paused=value;return true}
};
const server=await startDashboard({port:0,host:'127.0.0.1',password:'test-only-password',sessionSecret:'test-only-secret'.repeat(4),persistence,supportedSymbols:['BTC/USDT'],onSettingsChanged(){},readAccountTerms:async()=>{accountReads++;return{status:'read_only_account_terms_snapshot',environment:'real',capturedAtUtc:new Date().toISOString(),balance:{availableUsdt:17,cashUsdt:17,usableCashStatus:'spot_cash_observed'},terms:[{symbol:'BTC/USDT',takerFeeRate:.001,minimumQuantity:.00001,quantityStep:.00001}],ordersSent:0}},inspectDemoAccounting:slowDiagnostics,inspectDemoPositions:slowDiagnostics,onResume:async(signal,progress)=>{progress?.('checking_accounting');await gate;if(signal?.aborted)return{status:'blocked',reason:'resume_cancelled'};if(resumeMode==='blocked')return{status:'blocked',reason:'demo_bot_risk_attribution_unconfirmed',attributionReason:'position_balance_missing',balanceEvidence:{asset:'SOL',expected:.5,actual:null,source:'bot_position'}};paused=false;return{status:'resumed'}}});
let browser;
try { browser=await chromium.launch({executablePath:process.env.DASHBOARD_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('#password').fill('test-only-password');const start=Date.now();await page.locator('#login-submit').click();await page.locator('#login').waitFor({state:'hidden'});if(await page.locator('#toggle-bot').isVisible())throw new Error('Legacy controls must start collapsed');
 const {readFile}=await import('node:fs/promises'),{shadowConfiguration,startShadowSession}=await import('../dist/hybrid-shadow-session.js'),readJson=async p=>JSON.parse(await readFile(new URL('../examples/'+p,import.meta.url),'utf8'));
 const config=shadowConfiguration(await readJson('hybrid-shadow.profile.json'),await readJson('hybrid-research.plan.json'),await readJson('pullback-reference.study.json'));
 const quarters=Array.from({length:1000},(_,i)=>({timestamp:i*900000,open:100,high:101,low:99,close:100,volume:100})),hours=Array.from({length:250},(_,i)=>({timestamp:i*3600000,open:100,high:101,low:99,close:100,volume:400}));
 const checkpoint=startShadowSession(config,{asOfUtc:new Date(900000000).toISOString(),instruments:[{symbol:'BTC/USDT',candles15m:quarters,candles1h:hours,constraints:{minimumNotionalUsdt:0,minimumQuantity:.0001,quantityStep:.0001}}]},'a'.repeat(64),900000000);
 await page.locator('#hybrid-file').setInputFiles({name:'checkpoint.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(checkpoint))});await page.locator('#hybrid-import').click();await page.locator('#hybrid-message').filter({hasText:'Checkpoint reproduzido'}).waitFor({timeout:20000});
 if(!paused||accountReads)throw new Error('Hybrid import changed legacy execution or queried account');
 const hybridDownloadEvent=page.waitForEvent('download');await page.locator('#hybrid-download').click();const hybridDownload=await hybridDownloadEvent;if(hybridDownload.suggestedFilename()!=='crypto-bot-hybrid-session-audit.json')throw new Error('Hybrid export mislabeled');
 console.log(JSON.stringify({check:'mobile hybrid checkpoint import, isolated legacy controls and audited download',passed:true}));
 await page.locator('#legacy-panel > summary').click();await page.locator('#toggle-bot').waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.getElementById('toggle-bot').disabled);
 console.log(JSON.stringify({check:'mobile login with stalled exchange diagnostics',milliseconds:Date.now()-start,loginDisplay:await page.locator('#login').evaluate(el=>getComputedStyle(el).display)}));
 await page.reload();await page.locator('#login').waitFor({state:'hidden'});await page.locator('#legacy-panel > summary').click();await page.waitForFunction(()=>!document.getElementById('toggle-bot').disabled);
 console.log(JSON.stringify({check:'cookie survives reload',authenticated:true}));
 const resumeStart=Date.now();await page.locator('#toggle-bot').click();await page.locator('#control-message').filter({hasText:'Verificando segurança'}).waitFor();
 console.log(JSON.stringify({check:'resume acknowledges while safety check pending',milliseconds:Date.now()-resumeStart,paused}));
 await page.locator('#keep-paused').click();await page.waitForFunction(()=>!document.getElementById('toggle-bot').disabled);release();await page.waitForTimeout(100);
 if(!paused)throw new Error('late resume overrode pause');
 resumeMode='blocked';await page.locator('#toggle-bot').click();await page.locator('#control-message').filter({hasText:'SOL: esperado 0.5; lido não informado'}).waitFor();
 if(!paused)throw new Error('safety blocker was ignored');
 await page.locator('#keep-paused').click();await page.locator('#control-message').filter({hasText:'Pausa mantida por você'}).waitFor();
 if((await page.locator('#control-message').textContent()).includes('SOL: esperado'))throw new Error('old blocker survived a confirmed manual pause');
 resumeMode='safe';await page.locator('#toggle-bot').click();await page.waitForFunction(()=>document.getElementById('connection').textContent.includes('Online'));
 if(paused)throw new Error('confirmed safe resume did not run');
 console.log(JSON.stringify({check:'blocked resume details, manual pause and safe retry',passed:true}));

 if(accountReads!==0)throw new Error('account read ran without a click');
 await page.locator('#check-account-terms').click();await page.locator('#account-terms-result').filter({hasText:'REAL (somente leitura)'}).waitFor();
 if(accountReads!==1)throw new Error('manual account read did not run exactly once');
 const downloadEvent=page.waitForEvent('download');await page.locator('#download-account-terms').click();const download=await downloadEvent;
 if(!download.suggestedFilename().startsWith('crypto-bot-account-terms-real-'))throw new Error('account export mislabeled');
 console.log(JSON.stringify({check:'manual protected account read and labeled download on mobile',passed:true}));

 await page.route('**/api/dashboard?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'diagnostic unavailable'})}));
 await page.evaluate(()=>load());
 if(!await page.locator('#dashboard').isVisible()||await page.locator('#login').isVisible())throw new Error('data failure ended session');
 console.log(JSON.stringify({check:'network failure preserves authenticated panel',authenticated:true}));
 console.log(JSON.stringify({check:'manual pause cancels late resume',paused,pageErrors:errors}));
 const {startSessionExport}=await import('../dist/session-export-server.js'),fsExport=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const exportDir=await fsExport.mkdtemp(join(tmpdir(),'mobile-session-export-'));await fsExport.writeFile(join(exportDir,'checkpoint.json'),'original-checkpoint\n');await fsExport.writeFile(join(exportDir,'public-coverage.json'),'original-coverage\n');
 const exportServer=await startSessionExport({directory:exportDir,password:'test-export-password',sessionSecret:'s'.repeat(32),port:0,host:'127.0.0.1'}),exportContext=await browser.newContext({viewport:{width:390,height:844}});
 try{const exportPage=await exportContext.newPage();await exportPage.goto(`http://127.0.0.1:${exportServer.address().port}`);await exportPage.locator('input[name=password]').fill('test-export-password');await exportPage.getByRole('button',{name:'Entrar',exact:true}).click();
  for(const [name,expected]of [['checkpoint.json','original-checkpoint\n'],['public-coverage.json','original-coverage\n']]){const event=exportPage.waitForEvent('download');await exportPage.getByRole('link',{name:'Baixar '+name,exact:true}).click();const file=await event;if(file.suggestedFilename()!==name||await fsExport.readFile(await file.path(),'utf8')!==expected)throw new Error('Session exporter changed file bytes');}
  console.log(JSON.stringify({check:'mobile authenticated session export without Termux or bot startup',passed:true}));
 }finally{await exportContext.close();await new Promise(r=>exportServer.close(r));await fsExport.rm(exportDir,{recursive:true,force:true});}
 if(errors.length)throw new Error('browser JavaScript errors');
}finally{release();await browser?.close();await stopDashboard(server)}
