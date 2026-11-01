import { Email } from './dj-tip-notification.tsx'
import type { TemplateEntry } from './registry.ts'
export const template = {
  component: Email,
  subject: '🎉 You received a new tip on Decks',
  displayName: 'DJ tip notification',
  previewData: {
    djName: 'Nova',
    guestName: 'Sam',
    eventName: 'Friday Night Set',
    songTitle: 'One More Time — Daft Punk',
    grossAmountCents: 500,
    netAmountCents: 350,
  },
} satisfies TemplateEntry
