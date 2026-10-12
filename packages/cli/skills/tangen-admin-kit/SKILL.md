---
name: tangen-admin-kit
description: Building Admin UI from a Tangen extension - pages, sidebar panels and custom field-type inputs. Read the Admin contributions documentation for the current contract; this file only points at it.
---

# Admin UI from an extension

An extension may contribute Admin pages, sidebar panels and field-type inputs.
The contract for how a component is named, exported and resolved lives in the
documentation, and it is verified there against a real registry-installed
extension:

**https://docs.tangen.app/extend/contributions/admin.md**

Follow the `tangen-developer` skill for the procedure around it: inspect the
project, read that page, implement, and prove the contribution actually appears.

## One thing worth knowing before you import anything

Earlier versions of this file taught importing shared UI from `@/kit`. **`@/` is
an alias that exists inside the Tangen repository, not in your project** - a
scaffolded project has no such path mapping, so an import written that way will
not resolve.

Do not guess a replacement specifier. Read the Admin contributions page for what
your component may import, and if it does not say, treat that as unknown and ask
rather than inventing one.
