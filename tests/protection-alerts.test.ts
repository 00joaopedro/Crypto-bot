import {expect,it,vi} from "vitest";
import {ProtectionAlertJournal} from "../src/protection-alerts.js";
it("journals transitions, not 500 identical supervision observations",async()=>{
 const write=vi.fn(async()=>{}),j=new ProtectionAlertJournal(write),blocked={reason:"partial_exit_without_live_coverage",position:{symbol:"NEAR/USDT",remainingNet:5e-9}};
 for(let i=0;i<500;i++)await j.observe(blocked);
 expect(write).toHaveBeenCalledTimes(1);
 await j.observe();expect(write).toHaveBeenLastCalledWith(expect.objectContaining({eventType:"DEMO_PROTECTION_RECOVERED",details:{suppressedRepeats:499}}));
 await j.observe();expect(write).toHaveBeenCalledTimes(2);
 await j.observe(blocked);expect(write).toHaveBeenCalledTimes(3);
 await j.observe({...blocked,reason:"new_failure"});expect(write).toHaveBeenCalledTimes(4);
});
it("retries a failed journal write and emits the active blocker after restart",async()=>{
 const write=vi.fn(async()=>{}).mockRejectedValueOnce(new Error("database unavailable")),j=new ProtectionAlertJournal(write);
 await expect(j.observe({reason:"blocked"})).rejects.toThrow();
 await j.observe({reason:"blocked"});expect(write).toHaveBeenCalledTimes(2);
 await new ProtectionAlertJournal(write).observe({reason:"blocked"});expect(write).toHaveBeenCalledTimes(3);
});
