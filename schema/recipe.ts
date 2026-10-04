import { z } from "zod";

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

const text = (max: number) => z.string().trim().min(1).max(max);

export const IngredientSchema = z.object({
  item: text(200).describe('The ingredient itself, e.g. "yellow onion" or "all-purpose flour".'),
  quantity: text(40)
    .optional()
    .describe('Amount as written for a cook, e.g. "2", "1 1/2", "a pinch". Omit for "to taste".'),
  unit: text(40).optional().describe('Unit, e.g. "cup", "tbsp", "g". Omit for countable items.'),
  note: text(200).optional().describe('Prep or qualifier, e.g. "finely diced", "room temperature".'),
  section: text(80)
    .optional()
    .describe('Group heading for multi-part recipes, e.g. "Sauce" or "Dough". Use the same string for every ingredient in the group.'),
});

export const RecipeInputSchema = z.object({
  title: text(150),
  slug: z
    .string()
    .regex(SLUG_RE, "slug must be lowercase kebab-case (a-z, 0-9, hyphens)")
    .max(80)
    .optional()
    .describe("URL id. Omit for new recipes (derived from the title). Pass the existing slug when updating."),
  description: text(1000).optional().describe("One or two sentences about the dish."),
  servings: text(40).optional().describe('e.g. "4" or "12 cookies".'),
  prepTime: text(40).optional().describe('Human-readable, e.g. "15 min".'),
  cookTime: text(40).optional().describe('Human-readable, e.g. "1 hr 10 min".'),
  ingredients: z.array(IngredientSchema).min(1).max(150),
  steps: z
    .array(text(3000))
    .min(1)
    .max(100)
    .describe("Method, one step per entry, without leading numbers."),
  tags: z
    .array(text(40).toLowerCase())
    .max(20)
    .default([])
    .describe('Lowercase categories, e.g. "dinner", "vegetarian", "instant pot".'),
  source: text(500).optional().describe("Where the recipe came from: URL, book, or person."),
  notes: text(5000).optional().describe("Tips, substitutions, or my own adjustments."),
});

export const RecipeSchema = RecipeInputSchema.extend({
  slug: z.string().regex(SLUG_RE),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Ingredient = z.infer<typeof IngredientSchema>;
export type RecipeInput = z.infer<typeof RecipeInputSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
