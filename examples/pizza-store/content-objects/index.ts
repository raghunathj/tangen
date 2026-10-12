import { defineSchema } from "@tangen/cms";
import category from "./category/schema";
import topping from "./topping/schema";
import pizza from "./pizza/schema";
import order from "./order/schema";
import page from "./page/schema";

// A pizza-store website backend: pizzas filed under categories, carrying many
// toppings; orders reference the pizzas a customer bought; and `page` drives the
// marketing site (Home/About/Contact/Product) via a stack of reusable component
// blocks. This is the schema an AI companion (Claude Code) produces from a
// website-level brief.
export default defineSchema({
  types: [category, topping, pizza, order, page],
});
