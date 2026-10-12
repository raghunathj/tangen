import { defineObjectType, field } from "@tangen/cms";

/**
 * Topping — an add-on a pizza can carry. Priced individually so the storefront
 * can compute a build-your-own total.
 */
export default defineObjectType({
  name: "topping",
  label: "Topping",
  fields: {
    price: field.currency({
      label: "Price",
      config: { ai: { hint: "Per-topping surcharge in USD." }, currencyCode: "USD" },
    }),
    vegetarian: field.boolean({ label: "Vegetarian" }),
  },
  admin: {
    listView: { columns: ["price", "vegetarian"] },
    menu: { icon: "IconLeaf", label: "Toppings", order: 4, show: true },
  },
});
