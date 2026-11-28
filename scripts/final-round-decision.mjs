import fs from 'node:fs';
import {finalRoundDecision} from '../dist/final-round-decision.js';
const [h2Path,output,...extra]=process.argv.slice(2);
if(!h2Path||!output||extra.length)throw Error('Usage: node scripts/final-round-decision.mjs <H2-summary> <NEW-output>');
const h1=JSON.parse(fs.readFileSync('docs/swing-v2-results.json','utf8')),h2=JSON.parse(fs.readFileSync(h2Path,'utf8'));
fs.writeFileSync(output,JSON.stringify(finalRoundDecision(h1,h2),null,2)+'\n',{flag:'wx'});
