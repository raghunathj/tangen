import { defineObjectType, field } from "@tangen/cms";

/**
 * Product — an entry in the launch directory, filed under a category.
 * Demonstrates a relation across content types + typed scalar fields.
 */
export default defineObjectType({
  name: "product",
  label: "Product",
  fields: {
    tagline: field.text({
      label: "Tagline",
      config: { ai: { hint: "A punchy one-liner, under 80 characters." } },
    }),
    price: field.number({ label: "Price (USD)" }),
    category: field.relation({
      label: "Category",
      config: { targetType: "category", many: false },
    }),
    featured: field.boolean({ label: "Featured" }),
  },
  admin: {
    listView: { columns: ["price", "featured"] },
    menu: { icon: "IconRocket", label: "Products", order: 1, show: true },
  },
});
