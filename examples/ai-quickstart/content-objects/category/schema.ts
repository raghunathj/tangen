import { defineObjectType, field } from "@tangen/cms";

/**
 * Category — a grouping for products in the launch directory.
 * (Every content type has a built-in `title`; add only the extra fields.)
 */
export default defineObjectType({
  name: "category",
  label: "Category",
  fields: {
    description: field.text({
      label: "Description",
      config: { ai: { hint: "One sentence describing what belongs in this category." } },
    }),
  },
  admin: {
    menu: { icon: "IconFolder", label: "Categories", order: 2, show: true },
  },
});
