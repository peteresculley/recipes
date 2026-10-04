// Builds the static site: recipes/*.json -> dist/ (index, one page per recipe, search data).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RecipeSchema, type Ingredient, type Recipe } from "../schema/recipe.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const recipesDir = process.env.RECIPES_DIR ?? join(root, "recipes");
const outDir = join(root, "dist");
const SITE_TITLE = "Recipes";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function loadRecipes(): Recipe[] {
  if (!existsSync(recipesDir)) return [];
  const recipes: Recipe[] = [];
  for (const name of readdirSync(recipesDir).filter((n) => n.endsWith(".json"))) {
    const file = join(recipesDir, name);
    // Skip bad files rather than fail, so one never blocks newer recipes from publishing.
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      console.log(`::warning file=recipes/${name}::Invalid JSON, skipped: ${(err as Error).message}`);
      continue;
    }
    const result = RecipeSchema.safeParse(json);
    if (!result.success) {
      console.log(`::warning file=recipes/${name}::Invalid recipe skipped: ${z.prettifyError(result.error).replace(/\n/g, "; ")}`);
      continue;
    }
    recipes.push(result.data);
  }
  return recipes.sort((a, b) => a.title.localeCompare(b.title));
}

function page(opts: { title: string; base: string; body: string; script?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<link rel="stylesheet" href="${opts.base}style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍳</text></svg>">
</head>
<body>
${opts.body}
${opts.script ? `<script>${opts.script}</script>` : ""}
</body>
</html>
`;
}

function formatIngredient(i: Ingredient): string {
  const amount = [i.quantity, i.unit].filter(Boolean).join(" ");
  return `${amount ? `<span class="amt">${esc(amount)}</span> ` : ""}${esc(i.item)}${
    i.note ? `<span class="note">, ${esc(i.note)}</span>` : ""
  }`;
}

function ingredientsHtml(ingredients: Ingredient[]): string {
  const groups: { section?: string; items: Ingredient[] }[] = [];
  for (const ing of ingredients) {
    const last = groups.at(-1);
    if (last && last.section === ing.section) last.items.push(ing);
    else groups.push({ section: ing.section, items: [ing] });
  }
  let n = 0;
  return groups
    .map(
      (g) =>
        (g.section ? `<h3>${esc(g.section)}</h3>` : "") +
        `<ul class="ingredients">${g.items
          .map((i) => `<li><label><input type="checkbox" id="ing-${n++}"> <span>${formatIngredient(i)}</span></label></li>`)
          .join("")}</ul>`,
    )
    .join("\n");
}

function sourceHtml(source: string): string {
  return /^https?:\/\//i.test(source)
    ? `<a href="${esc(source)}" rel="noopener noreferrer">${esc(new URL(source).hostname.replace(/^www\./, ""))}</a>`
    : esc(source);
}

function recipePage(r: Recipe): string {
  const meta = [
    r.servings && ["Serves", r.servings],
    r.prepTime && ["Prep", r.prepTime],
    r.cookTime && ["Cook", r.cookTime],
  ].filter(Boolean) as [string, string][];
  const body = `
<header class="bar"><a href="../../">← All recipes</a>
<button id="wake" type="button" hidden aria-pressed="false">Keep screen on</button></header>
<main class="recipe">
<h1>${esc(r.title)}</h1>
${r.description ? `<p class="lede">${esc(r.description)}</p>` : ""}
${meta.length ? `<dl class="meta">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
${r.tags.length ? `<p class="tags">${r.tags.map((t) => `<a class="tag" href="../../?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</p>` : ""}
<div class="cols">
<section><h2>Ingredients</h2>${ingredientsHtml(r.ingredients)}</section>
<section><h2>Method</h2><ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></section>
</div>
${r.notes ? `<section class="notes"><h2>Notes</h2>${r.notes.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("")}</section>` : ""}
<footer>${r.source ? `Source: ${sourceHtml(r.source)} · ` : ""}Updated ${r.updatedAt.slice(0, 10)}</footer>
</main>`;
  // Tick off ingredients while cooking (remembered per recipe in this browser), and keep the screen awake on request.
  const script = `
const key = "checked:${r.slug}";
let saved = []; try { saved = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
const boxes = [...document.querySelectorAll(".ingredients input")];
boxes.forEach(b => { b.checked = saved.includes(b.id); b.addEventListener("change", () => {
  try { localStorage.setItem(key, JSON.stringify(boxes.filter(x => x.checked).map(x => x.id))); } catch {}
}); });
const btn = document.getElementById("wake");
if ("wakeLock" in navigator) {
  btn.hidden = false; let lock = null;
  const set = on => { btn.setAttribute("aria-pressed", on); btn.textContent = on ? "Screen stays on ✓" : "Keep screen on"; };
  btn.onclick = async () => {
    if (lock) { await lock.release(); return; }
    try { lock = await navigator.wakeLock.request("screen"); set(true);
      lock.addEventListener("release", () => { lock = null; set(false); }); } catch {}
  };
}`;
  return page({ title: `${r.title} · ${SITE_TITLE}`, base: "../../", body, script });
}

function indexPage(recipes: Recipe[]): string {
  const tags = [...new Set(recipes.flatMap((r) => r.tags))].sort();
  const body = `
<main class="index">
<h1>${SITE_TITLE}</h1>
<input id="q" type="search" placeholder="Search ${recipes.length} recipes…" autocomplete="off" aria-label="Search recipes">
${tags.length ? `<p class="tags" id="tags">${tags.map((t) => `<button type="button" class="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</p>` : ""}
<ul class="list" id="list">
${recipes
  .map(
    (r) => `<li data-tags="${esc(r.tags.join("|"))}" data-text="${esc(
      [r.title, r.description ?? "", ...r.tags, ...r.ingredients.map((i) => i.item)].join(" ").toLowerCase(),
    )}"><a href="r/${r.slug}/"><strong>${esc(r.title)}</strong>${
      r.description ? `<span>${esc(r.description)}</span>` : ""
    }</a></li>`,
  )
  .join("\n")}
</ul>
<p id="empty" class="empty"${recipes.length ? " hidden" : ""}>${recipes.length ? "No matches." : "No recipes yet. Ask ChatGPT to save one."}</p>
</main>`;
  const script = `
const q = document.getElementById("q"), items = [...document.querySelectorAll("#list li")];
const params = new URLSearchParams(location.search);
let tag = params.get("tag");
function apply() {
  const words = q.value.toLowerCase().split(/\\s+/).filter(Boolean);
  let shown = 0;
  for (const li of items) {
    const ok = words.every(w => li.dataset.text.includes(w)) && (!tag || li.dataset.tags.split("|").includes(tag));
    li.hidden = !ok; if (ok) shown++;
  }
  document.querySelectorAll("#tags .tag").forEach(b => b.setAttribute("aria-pressed", b.dataset.tag === tag));
  if (items.length) document.getElementById("empty").hidden = shown > 0;
  const url = new URL(location.href);
  tag ? url.searchParams.set("tag", tag) : url.searchParams.delete("tag");
  history.replaceState(null, "", url);
}
q.addEventListener("input", apply);
document.querySelectorAll("#tags .tag").forEach(b => b.addEventListener("click", () => { tag = tag === b.dataset.tag ? null : b.dataset.tag; apply(); }));
apply();`;
  return page({ title: SITE_TITLE, base: "", body, script });
}

const recipes = loadRecipes();
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
copyFileSync(join(root, "site", "style.css"), join(outDir, "style.css"));
writeFileSync(join(outDir, "index.html"), indexPage(recipes));
writeFileSync(join(outDir, "recipes.json"), JSON.stringify(recipes));
for (const r of recipes) {
  mkdirSync(join(outDir, "r", r.slug), { recursive: true });
  writeFileSync(join(outDir, "r", r.slug, "index.html"), recipePage(r));
}
console.log(`Built ${recipes.length} recipe(s) into ${outDir}`);
