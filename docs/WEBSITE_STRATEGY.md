# Itera Studio Website Strategy

## Target User
Creators and solo entrepreneurs who generate AI content (images, video, text) and want to move from scattered SaaS tools to a single, self-hosted workflow builder. They value privacy, cost control, and repeatability.

## Positioning
**Itera Studio** is the self-hosted AI workflow studio. One Docker container, your API keys, full privacy. Build pipelines, run multi-model comparisons, control costs — without vendor lock-in.

Key differentiators vs. SaaS alternatives:
- **Self-hosted**: Data never leaves your machine
- **BYO keys**: Pay providers directly, no markup
- **Workflow engine**: Chain steps into repeatable pipelines, not one-off generations
- **Multi-model comparison**: Same prompt, multiple models, side-by-side results
- **Cost control**: Budget caps, per-run estimates, usage dashboard

## Information Architecture

```
/                    Landing page (marketing)
/features            Feature breakdown by outcome
/pricing             One-time license pricing + Stripe checkout
/docs                Install guide + quickstart + env reference
/security            Encryption, architecture, threat model
/license             How offline licensing works
/privacy             Privacy policy
/terms               Terms of service
/billing/success     Post-purchase next steps

/login               Local password login (app)
/setup               First-run password setup (app)

/workflows           Workflow list (app, authenticated)
/workflows/[id]      Canvas editor (app)
/prompt              One-Prompt runner (app)
/settings            App settings (app)
/settings/providers  Provider API key management (app)
/usage               Cost dashboard (app)
```

## Primary CTA & Funnel

1. **Landing page** → "Buy License" button → `/pricing`
2. **Pricing page** → "Buy Now" → Stripe Checkout (POST `/api/billing/checkout`)
3. **Stripe success** → `/billing/success` with license key delivery instructions
4. **Install** → Docker compose + set LICENSE_KEY
5. **First run** → `/setup` (create password) → `/login` → `/workflows`
6. **Onboarding** → Getting Started checklist in sidebar

Secondary CTA: "Install Guide" → `/docs` for users who already have a license.

## Performance / Accessibility / SEO Checklist

### Performance
- [x] Marketing pages are Server Components (minimal client JS)
- [x] FAQ is the only client component on marketing pages
- [x] No heavy app dependencies (React Flow, etc.) imported in marketing routes
- [x] Inline SVG icons (no icon library bundle)
- [x] System font stack (no web font downloads)
- [x] clamp() for responsive typography (no layout shifts)

### Accessibility
- [x] Semantic HTML (nav, main, section, footer, h1-h4)
- [x] Keyboard-navigable links and buttons
- [x] aria-label on icon-only buttons (sidebar collapse, mobile menu)
- [x] aria-expanded on FAQ accordion
- [x] prefers-reduced-motion: disable transitions/animations
- [x] Sufficient color contrast (light text on dark backgrounds)
- [x] Focus styles via browser defaults (not suppressed)

### SEO
- [x] Unique title + description metadata per page
- [x] OpenGraph tags on landing page
- [x] Semantic heading hierarchy
- [x] robots.txt and sitemap.xml in middleware allowlist
- [ ] Add robots.txt and sitemap.xml static files (future)
- [ ] Add og-image.png (future)
