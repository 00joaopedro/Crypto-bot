import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
it("rejects a source from another experiment before replay", () => {
 const directory = mkdtempSync(join(tmpdir(), "limited-"));
 try {
  writeFileSync(join(directory,"source.json"), JSON.stringify({complete:true, studySha256:"wrong",assets:[]}));
  expect(() => execFileSync(process.execPath,["--import","tsx","src/limited-experiments-cli.ts","examples/universe-validation.study.json",directory],{stdio:["ignore","pipe","pipe"]})).toThrow(/Frozen source/);
 } finally { rmSync(directory,{recursive:true,force:true}); }
});
