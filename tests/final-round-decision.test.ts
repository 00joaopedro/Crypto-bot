import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {finalRoundDecision} from '../src/final-round-decision.js';
import {semanticHash} from '../src/cost-experiments.js';
const h1=JSON.parse(readFileSync(new URL('../docs/swing-v2-results.json',import.meta.url),'utf8'));
const fixture=()=>({economicGo:false,protocolFrozenCommit:'4b95763f1f57d5ab1bdf89c69e5ceb44116bf76a',finalRound:{priorH1ResultSha256:semanticHash(h1),thisHypothesis:2},independentDataCollected:false,phases:[{name:'development',signalCount:1,runs:[{status:'modeled_replay_complete'},{status:'modeled_replay_complete'}]}]});
it('archives only the research after two complete no-go results, preserving services, repository and real-money lock',()=>{
 const h2=fixture(),before=JSON.stringify(h2),r=finalRoundDecision(h1,h2);expect(r.status).toBe('research_archived_no_approved_candidate');expect(r.researchCycleClosed).toBe(true);expect(r.repositoryArchived).toBe(false);expect(r.railwayChanged).toBe(false);expect(r.ordersSent).toBe(0);expect(r.realMoneyApproved).toBe(false);expect(JSON.stringify(h2)).toBe(before);
});
it('keeps missing/blocked evidence from being labeled a completed economic rejection',()=>{
 const h2=fixture();h2.phases[0]!.runs[0]!.status='awaiting_minute_evidence';const r=finalRoundDecision(h1,h2);expect(r.status).toBe('blocked_evidence');expect(r.researchCycleClosed).toBe(false);expect(r.realMoneyApproved).toBe(false);
});
it('requires native review even for a supplied economic pass, never authorizes orders or real funds',()=>{
 const h2={...fixture(),economicGo:true},r=finalRoundDecision(h1,h2);expect(r.status).toBe('requires_native_review');expect(r.researchCycleClosed).toBe(false);expect(r.ordersSent).toBe(0);expect(r.realMoneyApproved).toBe(false);
});
it('rejects inconsistent prior-result provenance without modifying inputs',()=>{
 const h2=fixture();h2.finalRound.priorH1ResultSha256='tampered';expect(()=>finalRoundDecision(h1,h2)).toThrow(/provenance/);expect(()=>finalRoundDecision({...h1,economicGo:true},fixture())).toThrow(/provenance/);
});
