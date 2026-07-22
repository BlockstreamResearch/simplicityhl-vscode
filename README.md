# SimplicityHL extension for VSCode

VSCode extension that provides syntax highlighting for the [SimplicityHL](https://github.com/BlockstreamResearch/SimplicityHL) programming language.

[Simplicity](https://github.com/BlockstreamResearch/simplicity) is a typed, combinator-based, functional language without loops or recursion, developed to be an alternative to Bitcoin script that is formally specified, and can be statically analyzed with upper bounds on computation resources prior to execution.

SimplicityHL is a high-level language for writing Simplicity smart contracts. SimplicityHL looks and feels like [Rust](https://www.rust-lang.org), but is compiled to Simplicity bytecode. Developers write SimplicityHL transactions, which Bitcoin/Liquid nodes verify with the Simplicity script interpreter.

## Features

- Syntax highlighting and snippets for `.simf` and `.wit` files
- Compiler diagnostics, completion, hover, signature help, symbols, references, and go to definition
- Opt-in imports and enums support in the language server and direct compiler commands

The extension installs or connects to the [SimplicityHL language server](https://github.com/BlockstreamResearch/simplicityhl-lsp), which provides language intelligence:

## Formatting

This extension provides SimplicityHL support for VS Code's native **Format Document** command and its standard keybinding. It runs the external `simfmt` formatter against the current editor contents, so unsaved changes are formatted without writing directly to disk.

Install `simfmt` separately and make it available on `PATH`, or configure its full path:

```json
{
  "simplicityhl.formatter.path": "/path/to/simfmt"
}
```

Project formatting options are read from `simfmt.toml` or `.simfmt.toml` in the document directory or one of its parents.

- Error diagnostics
![diagnostics](https://github.com/user-attachments/assets/54315645-464b-40c3-bb72-c6e8c4bc0ad5)

- Completion of user-defined functions, imported items, built-ins, and jets
![completion](https://github.com/user-attachments/assets/bbc2b9de-c286-4d31-b47e-ac95885f8916)

## Experimental features

Open Settings and search for `SimplicityHL: Experimental Features`. `Imports` and `Enums` are independent checkboxes and both are disabled by default.

Import and module syntax requires `simplicityhl.experimentalFeatures.imports`. Enum syntax requires `simplicityhl.experimentalFeatures.enums`. The extension sends these choices to the LSP and adds the matching `-Z` flags to its direct `simc` commands and tasks.

The enum switch requires `simplicityhl-lsp` and `simc` 0.7.0 or newer.

The language server owns `Simplex.toml` discovery and imported-file analysis. The extension does not duplicate that resolver. Direct `simc` commands currently add feature flags only; they do not translate Simplex dependencies into `--dep` arguments. Use the project build tooling or invoke `simc` with the required dependency mappings for projects with external imports.

For local extension development, `simplicityhl.server.path` can point to a locally built `simplicityhl-lsp` binary.

### Development

To install the extension manually or hack on the source code see [development.md](docs/development.md)
