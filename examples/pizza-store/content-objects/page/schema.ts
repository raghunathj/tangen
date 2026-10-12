import { defineObjectType, field } from "@tangen/cms";

/**
 * Page — every marketing page (Home, About, Contact, Product) is one `page`
 * record. `pageType` switches the intent; `sections` is the page-builder: authors
 * stack reusable blocks (hero, carousels, featured grid, store location) in any
 * order. This is the schema an AI companion produces from a website-level brief.
 */
export default defineObjectType({
  name: "page",
  label: "Page",
  fields: {
    pageType: field.select({
      label: "Page type",
      config: {
        default: "standard",
        options: [
          { label: "Standard", value: "standard" },
          { label: "Landing", value: "landing" },
          { label: "Contact", value: "contact" },
        ],
      },
    }),
    shortDescription: field.textarea({
      label: "Short description",
      config: { ai: { hint: "One-line summary used for SEO and social cards." } },
    }),

    // ── The page builder — reusable component blocks, stacked in any order ──
    sections: field.component({
      label: "Sections",
      config: {
        components: [
          {
            name: "hero",
            label: "Hero Banner",
            fields: [
              { name: "heading", label: "Heading", fieldType: "text", required: true },
              { name: "subheading", label: "Subheading", fieldType: "textarea" },
              { name: "backgroundImage", label: "Background", fieldType: "media" },
              { name: "ctaLabel", label: "Button label", fieldType: "text" },
              { name: "ctaHref", label: "Button link", fieldType: "url" },
            ],
          },
          {
            name: "product_carousel",
            label: "Product Carousel",
            fields: [
              { name: "title", label: "Title", fieldType: "text" },
              { name: "categorySlug", label: "From category", fieldType: "text" },
              { name: "limit", label: "How many", fieldType: "number" },
            ],
          },
          {
            name: "featured_grid",
            label: "Key Products",
            fields: [
              { name: "title", label: "Title", fieldType: "text" },
              { name: "limit", label: "How many", fieldType: "number" },
            ],
          },
          {
            name: "store_location",
            label: "Store Location",
            fields: [
              { name: "address", label: "Address", fieldType: "textarea" },
              { name: "mapUrl", label: "Map link", fieldType: "url" },
              { name: "hours", label: "Opening hours", fieldType: "text" },
            ],
          },
        ],
      },
    }),
  },
  admin: {
    listView: { columns: ["pageType"] },
    menu: { icon: "IconFileText", label: "Pages", order: 5, show: true },
  },
});
