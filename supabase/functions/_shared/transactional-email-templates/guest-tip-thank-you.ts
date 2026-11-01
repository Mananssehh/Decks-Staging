import { Email } from './guest-tip-thank-you.tsx'
import type { TemplateEntry } from './registry.ts'
export const template = {
  component: Email,
  subject: 'Thanks for supporting your DJ ❤️',
  displayName: 'Guest tip thank-you',
  previewData: {
    djName: 'Nova',
    eventName: 'Friday Night Set',
    songTitle: 'One More Time — Daft Punk',
    amountCents: 500,
    receiptUrl: 'https://pay.stripe.com/receipts/example',
    roomCode: 'NOVA01',
  },
} satisfies TemplateEntry
