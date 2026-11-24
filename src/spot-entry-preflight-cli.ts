import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { previewSpotEntry } from './spot-entry-preflight.js';
const [snapshot,proposal,out,...extra]=process.argv.slice(2);
if(!snapshot||!proposal||!out||extra.length)throw new Error('Usage: account:preflight-readonly -- <fresh-read-snapshot.json> <proposal.json> <NEW-output-directory>; offline preview only');
const result=previewSpotEntry(JSON.parse(await readFile(snapshot,'utf8')),JSON.parse(await readFile(proposal,'utf8')));
await mkdir(out,{recursive:false,mode:0o700});await writeFile(join(out,'preflight.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(result,null,2));
