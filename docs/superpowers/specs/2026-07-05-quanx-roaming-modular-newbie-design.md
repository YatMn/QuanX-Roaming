# QuanX-Roaming Modular Newbie Design

Date: 2026-07-05

## Goal

Design a beginner-friendly QuanX-Roaming distribution model that lets users add
their own node subscriptions safely while still receiving ongoing rule and
rewrite updates from GitHub.

The project should stop presenting the GitHub Raw full profile as the long-term
working configuration. Testing in Quantumult X showed that a remotely linked
profile cannot add `server_remote` resources through the resource UI or the
official `add-resource` URL scheme while it remains in a linked state.

## Decision

Use a modular model:

- User-owned local or iCloud profile: editable main configuration used day to
  day.
- GitHub-hosted resource modules: public rule and rewrite modules that can keep
  updating through `filter_remote` and `rewrite_remote`.
- GitHub-hosted profile file: an installation template, not the user's permanent
  remote-linked profile.

This keeps the user workflow simple:

1. Download or import the template profile.
2. Save or copy it as a local or iCloud profile.
3. Add private node subscriptions in Quantumult X.
4. Let public filter and rewrite resources update from GitHub.
5. Follow the changelog only when the framework profile changes.

## Non-Goals

- Do not support Git, fork, upstream merge, or generated overlay workflows for
  beginners.
- Do not require users to edit raw profile text during normal setup.
- Do not publish node subscriptions, provider names, tokens, or private node
  details.
- Do not promise that a GitHub Raw linked full profile can be edited or extended
  with node resources.
- Do not split stable framework sections so aggressively that troubleshooting
  becomes harder for new users.

## Repository Layout

Target public layout:

```text
profiles/
  QuanX-Roaming.conf

resources/
  filters/
    core.list
    ai.list
    apps.list
    media.list
    finance.list
  rewrites/
    core.conf
    optional.conf

docs/
  install.md
  update.md
  changelog.md
```

`profiles/QuanX-Roaming.conf` remains the beginner template. The README should
describe it as a template to save as local or iCloud before adding nodes.

`resources/filters/*.list` and `resources/rewrites/*.conf` are public,
non-secret modules referenced by the template through GitHub Raw URLs.

## Profile Boundaries

Keep these sections in the editable profile template:

- `[general]`
- `[task_local]`
- `[server_local]`
- `[server_remote]` empty section and user guidance
- `[dns]`
- `[policy]`
- final fallback rule
- minimal emergency local rules that must remain close to fallback behavior

Move or aggregate these into GitHub-hosted resources:

- AI filter rules
- Google, YouTube, Telegram, social, and app-specific filter rules
- media and streaming filter rules
- finance and payment filter rules
- low-risk default rewrite resources
- optional/high-risk rewrite resources

The `[policy]` group names are an API contract. Remote filter modules must only
reference stable policies that the template defines, such as `AI`, `Google`,
`YouTube`, `Telegram`, `Netflix`, `国际媒体`, `金融支付`, `广告拦截`, and
`兜底分流`.

## User Workflow

README should lead with one recommended path:

1. Get the latest `profiles/QuanX-Roaming.conf` template.
2. In Quantumult X, save or copy it as a local or iCloud configuration.
3. Switch to that local or iCloud configuration.
4. Add a node subscription from the user's provider.
5. Update node resources.
6. Confirm regional node groups and app policy groups show usable nodes.

The README may mention the Raw link, but it must warn that using it as a linked
configuration is for previewing or downloading the template. It is not the
recommended long-term working profile because linked profiles cannot be extended
with node resources in the tested flow.

## Update Model

There are two update classes.

Automatic resource updates:

- Filter modules in `resources/filters/`
- Rewrite modules in `resources/rewrites/`
- Changes that do not rename policy groups or alter framework structure

Manual framework updates:

- Policy group changes
- Node region group changes
- DNS, MITM, fallback, or server section changes
- Any change that requires users to replace or edit the local/iCloud template

`docs/changelog.md` should separate resource-only changes from framework
changes. Framework changes need a short migration note for existing users.

## Error Handling

Expected user problems and documented response:

- No nodes appear: add a node subscription to the local/iCloud profile, then
  update node resources.
- Node subscription cannot be added: confirm the current profile is local or
  iCloud, not a linked GitHub Raw configuration.
- Rule updates work but new policy groups are missing: the local framework is
  outdated; apply the latest template or follow the changelog migration note.
- App routing seems wrong: check the app-specific policy group first, then
  region node groups, then rewrite resources.
- Payment or banking breaks: switch `金融支付` to `direct` first; disable risky
  rewrite modules before changing broad routing.

## Validation

Before publishing a modular change:

- Verify every `force-policy` target exists in the template `[policy]` section.
- Verify finance rules route to `金融支付` and stay before broad proxy rules.
- Verify node region groups still exclude subscription info nodes such as
  traffic, expiry, reset, URL, and notification entries.
- Verify no private `.conf`, subscription URL, token, provider name, or node
  detail is staged.
- Re-read changed docs for consistency with the tested linked-profile behavior.

Existing validation scripts can continue to cover the template:

- `.superpowers/sdd/validate-region-policy.sh profiles/QuanX-Roaming.conf`
- `.superpowers/sdd/validate-finance-button.sh profiles/QuanX-Roaming.conf`
- `.superpowers/sdd/validate-finance-egress.sh profiles/QuanX-Roaming.conf`

Future implementation should add checks for modular resources:

- referenced remote resource files exist;
- `force-policy` values in resource modules match template policy groups;
- `.gitignore` allows only intended public modules and keeps private profiles
  ignored.

## Open Implementation Notes

The current `.gitignore` ignores all `.conf` files except
`profiles/QuanX-Roaming.conf`. Implementation must either:

- use non-`.conf` extensions for public modules where Quantumult X accepts them;
  or
- explicitly unignore selected public resource paths such as
  `resources/rewrites/*.conf`.

Do not force-add ignored files until the ignore rules are updated and the files
are confirmed to contain no secrets.
