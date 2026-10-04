# Recipes

My personal recipe site, written to from ChatGPT through an MCP server. Everything runs on free tiers.

```
ChatGPT connector ──MCP──▶ Cloudflare Worker (mcp/) ──GitHub API commit──▶ recipes/<slug>.json
                                                                                │ push
                                                     GitHub Pages ◀── Action (site/build.ts)
```

- **Site:** https://peteresculley.github.io/recipes/
- **Data:** `recipes/*.json`, one file per recipe, validated against `schema/recipe.ts`. Only the Worker writes these.
- **MCP tools:** `save_recipe`, `get_recipe`, `list_recipes`, `delete_recipe`.

## Local development

```sh
npm install
npm run build                         # recipes/ -> dist/
RECIPES_DIR=/some/dir npm run build   # build from other data
npm run typecheck
npm run mcp:dev                       # Worker on :8787, reads mcp/.dev.vars
npx @modelcontextprotocol/inspector   # connect to http://localhost:8787/mcp/<MCP_PATH_SECRET>
```

`mcp/.dev.vars` (gitignored):

```
MCP_PATH_SECRET=<32+ random chars>
GITHUB_TOKEN=<fine-grained PAT>
```

## One-time setup

1. **GitHub token:** go to GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Set the repository to `peteresculley/recipes` only, with *Contents: Read and write* as the only permission. Note the expiry date and set a reminder to rotate it.
2. **Deploy the Worker:**
   ```sh
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN -c mcp/wrangler.toml
   openssl rand -hex 24 | npx wrangler secret put MCP_PATH_SECRET -c mcp/wrangler.toml   # keep this value
   npm run mcp:deploy
   ```
3. **ChatGPT:** go to Settings → Apps & Connectors → Advanced → enable Developer mode, then create a connector:
   - URL: `https://recipes-mcp.<your-subdomain>.workers.dev/mcp/<MCP_PATH_SECRET>`
   - Authentication: **No authentication**. The secret path is the credential, so don't share the URL.

## Maintenance

- **Rotate the GitHub token:** create a new PAT, then run `npx wrangler secret put GITHUB_TOKEN -c mcp/wrangler.toml`.
- **Rotate the URL secret:** run `secret put MCP_PATH_SECRET`, then update the connector URL in ChatGPT.
- **Redesign the site:** edit `site/`. Pushing to `main` rebuilds the site; the Worker is unaffected.
- **Deploy Worker changes:** run `npm run mcp:deploy`. Pushes don't redeploy it.
