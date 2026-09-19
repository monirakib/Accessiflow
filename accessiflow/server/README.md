# AccessiFlow AI Proxy

The extension's users never see, enter, or hold an API key. This Worker does.

## Why a proxy at all

A Chrome extension ships as readable JavaScript. Anything the extension needs
in order to sign a request must exist, in cleartext, in the browser's memory at
the moment the request goes out, so it is visible in DevTools' Network tab no
matter how the bundle is obfuscated, encrypted, or compiled to WebAssembly.
There is no arrangement of client-side code that keeps a client-side secret.

So the token is moved out of the client entirely:

```
extension  ──(install token)──>  Worker  ──(HF_TOKEN)──>  Hugging Face
                                   ▲
                       HF_TOKEN lives only here,
                       encrypted at rest by Cloudflare
```

The extension holds a **capability token**, not a credential. It is signed with
`TOKEN_SIGNING_KEY` (also server-only), expires after 30 days, and authorises
exactly three operations with prompts fixed on the server. Extracting it gets an
attacker rate-limited alt text, not a free LLM.

## What this does and does not protect

| Goal | Status |
| --- | --- |
| User cannot read the Hugging Face token | **Achieved.** It never reaches the client. |
| User cannot use the HF token for their own projects | **Achieved.** |
| User cannot forge an install token | **Achieved.** HMAC-SHA256, key server-side. |
| Somebody cannot script `/v1/register` for many install tokens | **Mitigated, not prevented.** Per-IP caps and a global daily ceiling. |
| Endpoints are useless for general-purpose AI | **Achieved by design.** Fixed prompts, 160-token cap, three narrow operations. |

State the middle row plainly in your thesis: per-install identity is
*accounting*, not authentication. An anonymous client cannot prove it is genuine
without a user account or an attestation service, so the honest defence is to
make abuse low-value (narrow endpoints) and bounded (`GLOBAL_DAILY`).

## Setup

You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and a
free [Hugging Face](https://huggingface.co/join) account.

**1. Get a Hugging Face token.** At
[huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) create
a token with the **Make calls to Inference Providers** permission. Copy it now, because it
is shown only once.

**2. Install tooling and log in.**

```bash
cd server
npm install
npx wrangler login
```

**3. Create the rate-limit store**, then paste the printed `id` into the
`[[kv_namespaces]]` block in `wrangler.toml`:

```bash
npx wrangler kv namespace create RATE_LIMIT
```

**4. Set the two secrets.** These go into Cloudflare's encrypted store, never
into a file you commit:

```bash
npx wrangler secret put HF_TOKEN           # paste the hf_... token
npx wrangler secret put TOKEN_SIGNING_KEY  # paste output of the command below
```

Generate a signing key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**5. Deploy.**

```bash
npx wrangler deploy
```

Wrangler prints a URL such as `https://accessiflow-ai.<subdomain>.workers.dev`.

**6. Point the extension at it.** In [modules/ai-config.js](../modules/ai-config.js)
set `PROXY_ORIGIN` to that URL, and add the same origin to `host_permissions` in
[manifest.json](../manifest.json).

**7. Lock the Worker to your extension.** Load the extension, copy its ID from
`chrome://extensions`, put it in `ALLOWED_EXTENSION_IDS` in `wrangler.toml`, and
redeploy. Until you do this, any origin can call the Worker.

## Verify

```bash
curl https://accessiflow-ai.<subdomain>.workers.dev/v1/health
```

`{"ok":true,...,"configured":true}` means both secrets are set. If `configured`
is `false`, step 4 did not take effect.

Watch live requests while you click AI buttons in the extension:

```bash
npx wrangler tail
```

## Choosing models

Model availability on Hugging Face's router changes. List what is currently warm:

```bash
npx hf models ls --warm --pipeline-tag image-text-to-text --sort trending_score
```

Put your picks in `[vars]` (`VISION_MODEL`, `TEXT_MODEL`) and redeploy. No code
change is needed. If alt text starts failing while summaries still work, the vision
model has most likely gone cold; that is the first thing to check.

## Costs and free-tier limits

- **Hugging Face Inference Providers** gives a monthly credit allowance on the
  free tier. `GLOBAL_DAILY` (default 4000 calls/day) is your guard against
  burning through it; lower it if your allowance is small.
- **Workers free tier**: 100,000 requests/day.
- **Workers KV free tier**: 1,000 writes/day. Each AI call performs two counter
  writes, so the practical ceiling is roughly **500 AI calls/day** before KV
  writes are exhausted. When writes fail the Worker keeps serving requests
  without enforcing quotas, which is fine for a thesis demo and not for production.
  For real deployment, move `bump()` to a Durable Object (exact counting, no
  daily write cap) or Cloudflare's native Rate Limiting binding.

## Operational notes

- **Cut off one abusive install** without redeploying:
  ```bash
  npx wrangler kv key put --binding=RATE_LIMIT "revoked:<installId>" 1
  ```
  The install ID appears in `wrangler tail` output for its requests.
- **Error messages returned to clients are written for disabled end users.**
  Short, plain, no status codes or model names. Diagnostics go to
  `console.error`, visible only in `wrangler tail`.
- **Never commit** `.dev.vars`, and never move `HF_TOKEN` into `[vars]`.
  `[vars]` is plaintext in the deployed bundle's metadata.
