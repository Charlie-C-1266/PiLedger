# PiLedger

[![CI](https://github.com/Charlie-C-1266/PiLedger/actions/workflows/ci.yml/badge.svg)](https://github.com/Charlie-C-1266/PiLedger/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB.svg)](https://python.org)

A self-hosted personal finance dashboard for tracking current, savings, and loan/debt accounts — including historical balance trends, compound-interest projections, zero-based envelope budgeting, and net-worth tracking across multiple currencies.

## Features

- **Multi-account tracking** — current, savings, loan, credit, and investment accounts with per-account currencies
- **Transaction log** — searchable, filterable transaction history with automatic balance adjustments
- **CSV import** — bulk-import transactions from a bank or card CSV export, with column mapping and automatic duplicate detection on re-import
- **Savings goals** — named targets with progress tracking, monthly contributions, ETA, and compound-interest projections charted per goal
- **Balance history** — timestamped snapshots with step-line charts over selectable time windows
- **Savings projections** — compound-interest forecasting at 1, 2, and 5 year horizons
- **Envelope budget** — income sources, fixed and flexible spending groups, per-category envelopes with live actual-vs-budgeted tracking, and a safe-to-spend figure for discretionary spend
- **Multi-currency** — user-selected base currency with manual exchange rates; net-worth totals convert automatically
- **Net-worth control** — accounts can be set aside from the net-worth headline (e.g. pension, investment) so the overview figure stays actionable
- **Per-user isolation** — every query is scoped to the authenticated user; multi-tenant by default
- **API access** — mint personal access tokens in Settings to drive PiLedger from scripts or the companion [MCP server](https://github.com/Charlie-C-1266/piledger-mcp), without sharing your password
- **Self-contained** — SQLite database, no external services, runs fully offline once loaded
- **Dark mode + five accent themes** — chosen in Settings and remembered in your browser

## Quick Start

```bash
docker compose up -d
# Open http://localhost:8080 → Register → Start tracking
```

For local development with `uv` or `pip`, see the [Getting Started](docs/getting-started.md) guide.

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, Uvicorn |
| Frontend | React 19, TypeScript, Vite, Recharts |
| Database | SQLite (single file, integer-cents storage) |
| Auth | PBKDF2-SHA256 passwords, 30-day HttpOnly session cookies |
| CI | GitHub Actions — ruff, mypy, pytest, frontend (eslint + build + vitest), Playwright e2e, pip-audit, lockfile drift |

## MCP Server

An optional [Model Context Protocol](https://modelcontextprotocol.io) server — [**piledger-mcp**](https://github.com/Charlie-C-1266/piledger-mcp) — lets AI assistants and agents (such as Claude) work with your finances in natural language: list accounts, record transactions, and review budgets and goals.

It connects to a running PiLedger instance with a **personal access token** instead of your password or a browser session — mint one through the `/api/tokens` API and the server sends it as an `Authorization: Bearer` header. See the [piledger-mcp](https://github.com/Charlie-C-1266/piledger-mcp) repository for setup, and the [Authentication guide](docs/authentication.md) for how tokens work.

## Documentation

| Guide | Description |
|---|---|
| [Getting Started](docs/getting-started.md) | Docker, uv, and pip install paths |
| [Architecture](docs/architecture.md) | System design, requirements, file structure |
| [API Reference](docs/api-reference.md) | Every endpoint with request/response shapes |
| [Database Schema](docs/database.md) | Tables, columns, and migration history |
| [Authentication](docs/authentication.md) | Password hashing, sessions, timing-attack mitigation |
| [Frontend](docs/frontend.md) | SPA structure, charts, modals, state management |
| [Deployment](docs/deployment.md) | Environment variables, systemd, HTTPS with Caddy/nginx |
| [Backups](docs/backups.md) | SQLite `.backup` recipes, cron rotation, restore steps |
| [Testing](docs/testing.md) | pytest suites, Playwright e2e, manual smoke tests |
| [Security](docs/security.md) | What is and isn't protected |

## License

[AGPL-3.0-only](LICENSE) — free to self-host and modify; network-service operators must share their changes.
