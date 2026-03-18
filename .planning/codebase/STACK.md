# Technology Stack

**Analysis Date:** 2026-03-17

## Languages

**Primary:**
- TypeScript 5 - All source code in `src/` directory
- React 19.2.3 - UI components and pages

**Secondary:**
- JavaScript (ES2017 target) - Build configuration files

## Runtime

**Environment:**
- Node.js (version not pinned in package.json, inherits from Next.js)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Next.js 16.1.6 - Full-stack framework (App Router, Turbopack)
- React 19.2.3 - UI library
- React DOM 19.2.3 - DOM rendering

**Styling:**
- Tailwind CSS 4 - Utility-first CSS with @tailwindcss/postcss v4
- tw-animate-css 1.4.0 - Animation utilities

**UI Components:**
- shadcn/ui 3.8.5 - Component library (New York style, neutral base color)
- Radix UI 1.4.3 - Headless UI primitives
- Lucide React 0.575.0 - Icon library

**Data & Fetching:**
- SWR 2.4.0 - Data fetching with caching and revalidation
- fetch API - HTTP requests (native, no axios/node-fetch wrapper)

**Charts & Visualization:**
- Recharts 3.7.0 - Chart library (Area, Bar, Pie components)
- date-fns 4.1.0 - Date manipulation and formatting

**Utilities:**
- clsx 2.1.1 - Conditional className builder
- tailwind-merge 3.5.0 - Merge Tailwind classes efficiently
- class-variance-authority 0.7.1 - Component variant system

## File Operations & Compression

**File I/O:**
- Node.js `fs` module - File system operations
- Node.js `path` module - Path utilities
- Node.js `readline` module - Line-by-line JSONL parsing

**Compression:**
- archiver 7.0.1 - ZIP file creation for exports
- @types/archiver 7.0.0 - TypeScript types for archiver
- jszip 3.10.1 - ZIP file parsing for imports

**Streaming:**
- Node.js `stream.PassThrough` - Stream piping for export

## Development & Build Tools

**Build:**
- Turbopack - Next.js native bundler (configured via Next.js)

**Linting:**
- ESLint 9 - Code linting
- eslint-config-next 16.1.6 - Next.js ESLint rules
- eslint-config-next/core-web-vitals - Web Vitals compliance
- eslint-config-next/typescript - TypeScript support

**Styling:**
- PostCSS 4 (via @tailwindcss/postcss) - CSS processing
- `postcss.config.mjs` - PostCSS configuration

**Type Checking:**
- TypeScript 5 - Static type checking
- @types/node 20 - Node.js type definitions
- @types/react 19 - React type definitions
- @types/react-dom 19 - React DOM type definitions

**Testing:**
- Puppeteer 24.37.5 - Browser automation (dev dependency, no test framework configured)

## Configuration

**Environment:**
- No `.env` file configuration detected - All data sourced directly from local filesystem (`~/.claude/`)
- Data source toggle: Live (`~/.claude/`) vs imported (`.dashboard-data/`)

**Build Configuration:**
- `next.config.ts` - Minimal Next.js configuration (empty/defaults)
- `tsconfig.json` - TypeScript compiler with:
  - Target: ES2017
  - JSX: react-jsx
  - Path alias: `@/*` maps to `./src/*`
  - Module resolution: bundler (Next.js native)

**Component Configuration:**
- `components.json` - shadcn/ui configuration:
  - Style: New York
  - RSC: true (React Server Components enabled)
  - Base color: neutral
  - Icon library: lucide
  - Tailwind CSS variables enabled

**CSS Configuration:**
- `globals.css` - Imports Tailwind, tw-animate-css, shadcn CSS
- CSS custom properties for theming (light and dark modes)
- Custom dark theme variant with `@custom-variant dark`

## Platform Requirements

**Development:**
- Node.js runtime
- npm package manager
- POSIX filesystem for `~/.claude/` directory access

**Production:**
- Node.js runtime for server
- Filesystem access to user's home directory (`~/.claude/`)
- ZIP extraction capability for import/export features

**Constraints:**
- All data is local-first (no database)
- No authentication/authorization system
- No cloud dependencies
- Direct filesystem I/O to Claude Code's config directory

---

*Stack analysis: 2026-03-17*
