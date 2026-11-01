import { Email } from './dj-stripe-connected.tsx'
import type { TemplateEntry } from './registry.ts'
export const template = {
  component: Email,
  subject: 'Stripe connected — payouts are enabled on Decks ✅',
  displayName: 'DJ Stripe connected',
  previewData: { djName: 'Nova' },
} satisfies TemplateEntry
