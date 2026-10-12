import { defineSchema } from "@tangen/cms";
import category from "./category/schema";
import product from "./product/schema";

// A tiny two-model "launch directory": products filed under categories.
// This is the schema an AI companion produces from the prompts in
// docs/vibe-build-walkthrough.md.
export default defineSchema({
  types: [category, product],
});
