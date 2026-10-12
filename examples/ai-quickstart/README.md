# ai-quickstart

The example built in [docs/vibe-build-walkthrough.md](../../docs/vibe-build-walkthrough.md)
— a tiny two-model "launch directory" (**products** filed under **categories**,
with a relation), the kind of schema an AI companion produces from a one-line
prompt.

```
content-objects/
  category/schema.ts    # category { description }
  product/schema.ts     # product  { tagline, price, category → relation, featured }
  index.ts              # defineSchema({ types: [category, product] })
tangen.config.ts        # minimal project config (dev env → DATABASE_URL)
__tests__/schema.test.ts
```

## Run it

```bash
# type-check the schemas (no database needed)
cd examples/ai-quickstart
bun ../../packages/cli/src/index.ts check

# validate structure
bun test examples/ai-quickstart

# push to a throwaway database (from the example dir)
DATABASE_URL=<your-empty-postgres> \
  bun ../../packages/cli/src/index.ts push --plan   # preview
DATABASE_URL=<your-empty-postgres> \
  bun ../../packages/cli/src/index.ts push          # apply
```

The push path was verified live against an isolated empty database — it creates
the `category` and `product` content tables and registers both types.
