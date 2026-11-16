import { protocolCases } from './bridge-protocol_cases.ts';
for (const [name, run] of protocolCases) Deno.test(`bridge protocol v2: ${name}`, run);
