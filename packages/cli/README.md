# @tangen/cli

The Tangen CLI — schema-as-code workflow for the Tangen headless CMS.
Requires [Bun](https://bun.sh) ≥ 1.1.

## Install

```sh
bun add -g @tangen/cli
```

## Commands

```sh
tangen create                    # Scaffold a new Tangen project (interactive)
tangen workspace create          # Add a workspace to an existing project
tangen workspace remove <slug>   # Remove a workspace

tangen check                     # Type-check schema files
tangen diff                      # Show pending schema changes
tangen push                      # Apply schema changes (runs check first)
tangen push --workspace <slug>   # Register a workspace from the registry
tangen pull                      # Regenerate TS schema files from the DB

tangen add object <name>         # Scaffold a new content type
tangen enable auth|forms         # Enable a built-in feature
tangen disable auth|forms        # Disable a built-in feature

tangen extension install <id>    # Install an extension
tangen extension create          # Scaffold a new extension (interactive)
```

Common options: `--env <name>` (default `development`), `--project <name>`
(auto-detected from cwd).

## License

MIT
