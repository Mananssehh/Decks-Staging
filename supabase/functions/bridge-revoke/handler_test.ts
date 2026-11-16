import { bridgeRevokeCases } from './cases.ts';
for (const [name, run] of bridgeRevokeCases) Deno.test(`bridge-revoke: ${name}`, run);
