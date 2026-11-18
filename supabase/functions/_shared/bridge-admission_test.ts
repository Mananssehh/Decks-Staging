import { admissionCases } from './bridge-admission_cases.ts';
for (const [name, run] of admissionCases) Deno.test(`bridge admission: ${name}`, run);
