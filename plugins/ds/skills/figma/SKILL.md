---
name: figma
description: "Read a Figma design through the REST API: render a frame to PNG, crop into detail, or pull its exact text. Use for a figma.com link when the Figma MCP refuses a call or is not installed. WebFetch on a Figma URL always fails."
---

# Reading Figma

Try the Figma MCP first (`get_metadata`, `get_screenshot`). This is the fallback when it refuses: on a View seat it runs out of tool calls.

Use the script beside this file: `${CLAUDE_SKILL_DIR}/figma`. It handles the token, the URL and the cache, and never prints the token.

```
F=${CLAUDE_SKILL_DIR}/figma
$F render '<figma url>'          # PNG + overview.png + slice<N>.png, prints paths and sizes
$F crop   '<figma url>' X0 Y0 X1 Y1   # detail crop in the full PNG's pixels
$F texts  '<figma url>'          # exact copy of every text layer
```

Quote the URL: it carries `?` and `&`.

Workflow: `render`, Read `overview.png`, find the frame you need, multiply its overview coordinates by the printed factor, `crop` that box, Read the crop. Use `texts` when the exact wording matters. If it is rate-limited, read the wording off a crop and say that you did.

## What it already gets right, so you don't have to

- **The token is `FIGMA_TOKEN`, a personal access token (`figd_…`).** The script takes it from the environment, and otherwise from a fresh login shell, where a secrets manager may set it. Never read a secrets file or decrypt anything to find it.
- **The header is `X-Figma-Token`.** A `figd_` token sent as `Authorization: Bearer` gets a 401. `/v1/me` also returns 401 with a token that works fine for files, so don't use it as a health check.
- **Rate limits are per endpoint, and they can be long.** On one account `/v1/files/:key/nodes` (which `texts` uses) returned 429 with `retry-after` of about 3 days (`x-figma-rate-limit-type: low`), while `/v1/images` (which `render` uses) kept working. The script stops on a 429 and reports the wait. Never retry or loop: each retry only extends the lockout.
- **Results are cached** in `~/.cache/figma/<key>/<node>/`, so repeat calls cost nothing. Set `FIGMA_FRESH=1` only when the design changed.
- **A wide section renders at most 16384 px across.** That is why `render` writes an overview and slices instead of one image you can't read.

## Reporting

Say the design was read from a rendered image, give the node, and quote the copy verbatim. A sticky note next to a frame is part of the design: crop the notes under and beside the frame too. If none covers the behaviour in question, say so. Silence in the design is a decision for the user, not something to fill in.
