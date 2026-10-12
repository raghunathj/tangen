import { defineObjectType, field } from "@tangen/cms";

/**
 * Pizza — a menu item filed under one category, carrying many toppings.
 * Demonstrates both relation arities (one category, many toppings) plus a
 * select, a currency, media, and a boolean in one type.
 */
export default defineObjectType({
  name: "pizza",
  label: "Pizza",
  fields: {
    description: field.textarea({
      label: "Description",
      config: { ai: { hint: "Two mouth-watering sentences about this pizza." } },
    }),
    price: field.currency({
      label: "Base price",
      config: { currencyCode: "USD" },
    }),
    category: field.relation({
      label: "Category",
      config: { targetType: "category", many: false },
    }),
    toppings: field.relation({
      label: "Toppings",
      config: { targetType: "topping", many: true },
    }),
    heat: field.select({
      label: "Heat",
      config: {
        options: [
          { label: "Mild", value: "mild" },
          { label: "Medium", value: "medium" },
          { label: "Hot", value: "hot" },
        ],
      },
    }),
    vegetarian: field.boolean({ label: "Vegetarian" }),
    photo: field.media({ label: "Photo", config: { accept: ["image"] } }),
  },
  admin: {
    listView: { columns: ["price", "heat", "vegetarian"] },
    menu: { icon: "IconPizza", label: "Pizzas", order: 1, show: true },
  },
});
