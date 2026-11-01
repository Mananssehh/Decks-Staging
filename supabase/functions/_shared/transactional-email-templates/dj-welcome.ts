import { Email } from './dj-welcome.tsx'
import type { TemplateEntry } from './registry.ts'
export const template = {
  component: Email,
  subject: "Welcome to Decks — let's get your first set live 🎛️",
  displayName: 'DJ welcome',
  previewData: { djName: 'Nova' },
} satisfies TemplateEntry
