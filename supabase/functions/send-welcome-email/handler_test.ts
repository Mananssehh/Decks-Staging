import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleWelcome, type WelcomeDeps } from "./handler.ts";
const request = (kind="guest") => new Request("https://local.invalid",{method:"POST",headers:{authorization:"Bearer fake-local-token"},body:JSON.stringify({kind,recipient:"attacker@invalid.test",idempotencyKey:crypto.randomUUID()})});
const deps:WelcomeDeps={user:async()=>({id:"u",email:"fixture@invalid.test",email_confirmed_at:"2026-01-01"}),isDJ:async()=>false};
Deno.test("welcome is explicitly disabled, never sends with attacker recipient/key",async()=>{
  for(let i=0;i<12;i++) assertEquals(await handleWelcome(request(),deps),{status:200,body:{sent:false,reason:"domain_not_configured"}});
});
Deno.test("DJ welcome requires server role",async()=>assertEquals((await handleWelcome(request("dj"),deps)).status,403));
Deno.test("anonymous or unverified user cannot request welcome",async()=>assertEquals((await handleWelcome(request(),{...deps,user:async()=>({id:"u",email:"fixture@invalid.test"})})).status,400));
Deno.test("welcome role/database errors fail closed",async()=>assertEquals((await handleWelcome(request("dj"),{...deps,isDJ:async()=>{throw Error("db")}})).status,503));