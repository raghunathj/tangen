import { defineObjectType, field } from "@tangen/cms";

/**
 * Order — a customer's basket of pizzas with a fulfilment status. The
 * `fulfillment` select drives a simple kitchen workflow. (It is NOT named
 * `status`: that is the built-in publish-lifecycle column every content type
 * carries, and declaring it is rejected at definition — finding #6.)
 */
export default defineObjectType({
  name: "order",
  label: "Order",
  fields: {
    customer: field.text({ label: "Customer name" }),
    email: field.email({ label: "Email" }),
    phone: field.phone({ label: "Phone" }),
    pizzas: field.relation({
      label: "Pizzas",
      config: { targetType: "pizza", many: true },
    }),
    fulfillment: field.select({
      label: "Fulfillment",
      config: {
        default: "received",
        options: [
          { label: "Received", value: "received" },
          { label: "Preparing", value: "preparing" },
          { label: "Out for delivery", value: "out_for_delivery" },
          { label: "Delivered", value: "delivered" },
        ],
      },
    }),
    total: field.currency({ label: "Total", config: { currencyCode: "USD" } }),
    notes: field.textarea({
      label: "Notes",
      config: { ai: { hint: "Delivery or kitchen notes, e.g. 'ring the bell twice'." } },
    }),
  },
  admin: {
    listView: { columns: ["customer", "fulfillment", "total"] },
    menu: { icon: "IconReceipt", label: "Orders", order: 2, show: true },
  },
});
