import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import {
  createAuthEmailHandler,
  type AuthEmailActionType,
  type AuthEmailHookData,
} from 'npm:@lovable.dev/email-js@0.6.0'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-lovable-signature, x-lovable-timestamp, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EMAIL_SUBJECTS: Record<AuthEmailActionType, string> = {
  signup: "Welcome to Decks — you've got 15 starter points",
  invite: "You've been invited to Decks",
  magiclink: 'Your Decks login link',
  recovery: 'Reset your Decks password',
  email_change: 'Confirm your new email',
  reauthentication: 'Your Decks verification code',
}

// Template mapping
const EMAIL_TEMPLATES: Record<AuthEmailActionType, React.ComponentType<never>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

// Configuration
const SITE_NAME = "Decks"
const REPLY_TO = "support@linku99.com"
const SENDER_DOMAIN = "notify.linku99.com"
const ROOT_DOMAIN = "linku99.com"
const FROM_DOMAIN = "linku99.com" // Domain shown in From address (may be root or sender subdomain)

// Sample data for preview mode ONLY (not used in actual email sending).
// URLs are baked in at scaffold time from the project's real data.
// The sample email uses a fixed placeholder URL so the Go backend
// can always find-and-replace it with the actual recipient when sending test emails,
// even if the project's domain has changed since the template was scaffolded.
const SAMPLE_PROJECT_URL = "https://linku99.com"
const SAMPLE_EMAIL = "user@example.test"
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  magiclink: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  recovery: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  invite: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  email_change: {
    siteName: SITE_NAME,
    oldEmail: SAMPLE_EMAIL,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  reauthentication: {
    token: '123456',
  },
}

// Preview endpoint handler - returns rendered HTML without sending email
async function handlePreview(req: Request): Promise<Response> {
  const previewCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: previewCorsHeaders })
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const authHeader = req.headers.get('Authorization')

  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let type: string
  try {
    const body = await req.json()
    type = body.type
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[type as AuthEmailActionType]

  if (!EmailTemplate) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const sampleData = SAMPLE_DATA[type] || {}
  const html = await renderAsync(React.createElement(EmailTemplate, sampleData))

  return new Response(html, {
    status: 200,
    headers: { ...previewCorsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// Same props the legacy hook built from the verified payload. confirmationUrl is the
// verified Auth action URL (carries the staging /auth/callback?next=... redirect).
function templateProps(data: AuthEmailHookData) {
  return {
    siteName: SITE_NAME,
    siteUrl: `https://${ROOT_DOMAIN}`,
    recipient: data.email,
    confirmationUrl: data.url,
    token: data.token ?? '',
    email: data.email,
    oldEmail: data.old_email ?? '',
    newEmail: data.new_email ?? '',
  }
}

function definition(type: AuthEmailActionType) {
  return {
    subject: EMAIL_SUBJECTS[type],
    render: (data: AuthEmailHookData) =>
      React.createElement(EMAIL_TEMPLATES[type], templateProps(data) as never),
  }
}

// Managed delivery: the SDK verifies the Lovable signature/timestamp with
// LOVABLE_API_KEY (unsigned/stale -> 401), then sends synchronously through
// Lovable's email API. No queue, log table, cron, Vault or service-role key.
const handleWebhook = createAuthEmailHandler({
  apiKey: Deno.env.get('LOVABLE_API_KEY') ?? '',
  from: { name: SITE_NAME, address: `noreply@${FROM_DOMAIN}` },
  senderDomain: SENDER_DOMAIN,
  replyTo: REPLY_TO,
  emails: {
    signup: definition('signup'),
    invite: definition('invite'),
    magiclink: definition('magiclink'),
    recovery: definition('recovery'),
    email_change: definition('email_change'),
    reauthentication: definition('reauthentication'),
  },
})

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (url.pathname.endsWith('/preview')) {
    return handlePreview(req)
  }

  try {
    const res = await handleWebhook(req)
    const headers = new Headers(res.headers)
    for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v)
    return new Response(res.body, { status: res.status, headers })
  } catch (error) {
    console.error('Webhook handler error:', error instanceof Error ? error.name : 'unknown')
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
