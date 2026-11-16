import { bridgePairCases } from './cases.ts';
for (const [name, run] of bridgePairCases) Deno.test(`bridge-pair: ${name}`, run);
