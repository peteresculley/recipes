import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { RecipeInputSchema, RecipeSchema, SLUG_RE, slugify, type Recipe } from "../../schema/recipe";
import { deleteFile, getFile, GitHubError, listDir, putFile, type GitHubEnv } from "./github";

interface Env extends GitHubEnv {
  MCP_PATH_SECRET: string;
  SITE_URL: string;
}

const RECIPES_DIR = "recipes";
const recipePath = (slug: string) => `${RECIPES_DIR}/${slug}.json`;

const SlugArg = z.string().regex(SLUG_RE).describe("Recipe slug, as returned by list_recipes or save_recipe.");

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function describeError(err: unknown): string {
  if (err instanceof GitHubError && (err.status === 409 || err.status === 422)) {
    return "The recipe changed while saving (write conflict). Call get_recipe and retry.";
  }
  if (err instanceof GitHubError && (err.status === 401 || err.status === 403)) {
    return "The server's GitHub token was rejected (expired or missing permissions). The owner must rotate GITHUB_TOKEN.";
  }
  return err instanceof Error ? err.message : String(err);
}

function createServer(env: Env) {
  const server = new McpServer({ name: "recipes", version: "1.0.0" });
  const pageUrl = (slug: string) => `${env.SITE_URL.replace(/\/$/, "")}/r/${slug}/`;

  server.registerTool(
    "save_recipe",
    {
      title: "Save recipe",
      description:
        "Save a cooking recipe to the user's personal recipe site. Use when the user asks to save, add, or store a recipe, " +
        "or to change one already saved. Put each ingredient in its own entry with quantity, unit, and item split apart, " +
        "and each method step in its own entry. Keep the recipe faithful to what was discussed. To modify an existing recipe, " +
        "first call get_recipe, then send the full updated recipe with its slug and overwrite=true. " +
        "If saving fails because the slug exists, ask the user whether to replace it.",
      inputSchema: RecipeInputSchema.extend({
        overwrite: z
          .boolean()
          .default(false)
          .describe("Replace an existing recipe with the same slug. Only true when the user means to update it."),
      }),
    },
    async ({ overwrite, ...input }) => {
      const slug = input.slug ?? slugify(input.title);
      if (!slug) return fail("Could not derive a slug from the title; pass an explicit slug.");
      try {
        const existing = await getFile(env, recipePath(slug));
        if (existing && !overwrite) {
          return fail(
            `A recipe with slug "${slug}" already exists. Ask the user whether to replace it (call again with overwrite=true) ` +
              "or save it under a different slug.",
          );
        }
        let createdAt: string | undefined;
        if (existing) {
          try {
            createdAt = (JSON.parse(existing.text) as Partial<Recipe>).createdAt;
          } catch {
            // Unreadable existing file: it gets overwritten with a fresh createdAt.
          }
        }
        const now = new Date().toISOString();
        const recipe: Recipe = RecipeSchema.parse({ ...input, slug, createdAt: createdAt ?? now, updatedAt: now });
        await putFile(
          env,
          recipePath(slug),
          JSON.stringify(recipe, null, 2) + "\n",
          `${existing ? "Update" : "Add"} recipe: ${recipe.title}`,
          existing?.sha,
        );
        return ok({
          saved: true,
          action: existing ? "updated" : "created",
          slug,
          url: pageUrl(slug),
          note: "The website rebuilds automatically; the page is usually live within a few minutes.",
        });
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "get_recipe",
    {
      title: "Get recipe",
      description: "Fetch one saved recipe as JSON. Use before modifying a recipe, or when the user asks about one.",
      inputSchema: z.object({ slug: SlugArg }),
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) => {
      try {
        const file = await getFile(env, recipePath(slug));
        if (!file) return fail(`No recipe with slug "${slug}". Use list_recipes to find it.`);
        return { content: [{ type: "text" as const, text: file.text }] };
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "list_recipes",
    {
      title: "List recipes",
      description:
        "List the slugs of saved recipes (slugs are derived from titles). Optionally filter by words that appear in the slug.",
      inputSchema: z.object({
        query: z.string().max(100).optional().describe('Words to match, e.g. "chicken curry".'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      try {
        const words = (query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        const slugs = (await listDir(env, RECIPES_DIR))
          .filter((name) => name.endsWith(".json"))
          .map((name) => name.slice(0, -".json".length))
          .filter((slug) => words.every((w) => slug.includes(w)))
          .sort();
        return ok({ count: slugs.length, recipes: slugs.map((slug) => ({ slug, url: pageUrl(slug) })) });
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "delete_recipe",
    {
      title: "Delete recipe",
      description: "Permanently remove a saved recipe. Only use when the user explicitly asks to delete it.",
      inputSchema: z.object({ slug: SlugArg }),
      annotations: { destructiveHint: true },
    },
    async ({ slug }) => {
      try {
        const file = await getFile(env, recipePath(slug));
        if (!file) return fail(`No recipe with slug "${slug}".`);
        await deleteFile(env, file.path, file.sha, `Delete recipe: ${slug}`);
        return ok({ deleted: true, slug });
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  return server;
}

export default {
  fetch(request, env, ctx) {
    // The secret path segment is the only access control (ChatGPT connector in "No auth" mode).
    if (!env.MCP_PATH_SECRET || env.MCP_PATH_SECRET.length < 32) {
      return new Response("Server misconfigured", { status: 500 });
    }
    const route = `/mcp/${env.MCP_PATH_SECRET}`;
    if (new URL(request.url).pathname !== route) {
      return new Response("Not found", { status: 404 });
    }
    return createMcpHandler(() => createServer(env), { route })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
