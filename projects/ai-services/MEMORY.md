# Project: AI Services

## What This Is
A productized service business that creates automation systems using Claude for clients, with a strong focus on MCP (Model Context Protocol) servers.

## Core Offering
- Build and configure AI communication systems for small business clients
- Stack: Gmail + WhatsApp automation via Claude + MCP
- Client operates the system independently after setup
- Repeatable, clone-able setup — not bespoke freelance

## Architecture
- **WhatsApp:** Evolution API (Baileys) + whatsapp-channel Claude Code plugin
- **Gmail:** OAuth2, staying under 100-user threshold to avoid CASA audit
- **AI layer:** Claude Code with custom MCP servers per client

## Pricing Model (proposed)
- Setup fee: €3,000–€5,000 (primary revenue event)
- Recurring: only if tied to something client cannot self-serve
- Front-load value — setup fee is the business

## Key Constraints
- WhatsApp personal inbox: unofficial libraries (Baileys, Evolution API) carry ban risk
- Requires written client consent for WhatsApp automation
- Gmail OAuth: keep under 100 users to avoid Google CASA verification

## Current Status
- Architecture defined
- WhatsApp channel plugin spec complete (see whatsapp-channel project)
- Pricing model drafted
- First clients: referrals vs cold outreach still undecided

## Open Questions
- [ ] Google Cloud project ownership at client handoff — who owns it?
- [ ] First client acquisition channel (referrals or cold?)
- [ ] Recurring revenue model — what justifies monthly fee?

## Next Actions
- [ ] Build whatsapp-channel plugin (see /whatsapp-channel)
- [ ] Define client onboarding process
- [ ] Create sales deck / one-pager
- [ ] Get first paying client
