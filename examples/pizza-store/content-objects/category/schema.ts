import { defineObjectType, field } from "@tangen/cms";

/**
 * Category — a menu section (Pizzas, Sides, Drinks, Desserts).
 * Every content type has a built-in `title`; add only the extra fields.
 */
export default defineObjectType({
  name: "category",
  label: "Category",
  fields: {
    description: field.textarea({
      label: "Description",
      config: { ai: { hint: "One sentence describing what belongs in this menu section." } },
    }),
  },
  admin: {
    menu: { icon: "IconFolder", label: "Categories", order: 3, show: true },
  },
});
