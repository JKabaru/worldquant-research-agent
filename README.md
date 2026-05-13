# WQ Research Agent

An LLM-powered agent that generates, simulates, and refines quantitative alpha signals for the WorldQuant BRAIN platform.

## Setup

```bash
npm install
```

## Usage

```bash
npm run dev
```

Opens at `http://localhost:3000`. Configure an API provider (e.g. OpenAI, Anthropic, local) and start a research session.

## How it works

The agent iterates through a **generate → simulate → refine** loop:

1. **Generate** — The LLM produces candidate alpha expressions in Fast Expression language using knowledge snippets retrieved from source memory
2. **Simulate** — Submits expressions to the WQ BRAIN simulator for backtesting (Sharpe, Fitness, turnover, drawdown, returns)
3. **Refine** — Feeds simulation results back into the LLM, preserving successful patterns and discarding failures across rounds

This is a single-agent loop. No multi-agent orchestration, no LangChain, no autonomous dataset fetching.

### Research flow

A session starts with user-defined intent parameters (universe, delay, neutralization, truncation). The agent generates multiple expression candidates per round, submits to simulation, and carries forward context about what worked and why. The research log tracks each iteration for post-session analysis.

## Source memory system

The curated knowledge base in `src/lib/source-memory.ts` provides distilled guidance from foundational finance texts and research papers. The retriever selects the most relevant snippets per query using token-based scoring, capped at a fixed budget — more knowledge never inflates the prompt.

### Current sources

| Source | Focus |
|---|---|
| World Quant Brief | Fast Expression syntax, operators, delay/decay/neutralization, simulation settings |
| Active Portfolio Management (Grinold & Kahn) | IR, Fundamental Law, breadth, implementation, data-mining caution |
| Expected Returns (Ilmanen) | Regime awareness, diversification, style premia, risk management |
| Computational Paradigms | IR theory, operator semantics, fundamental/options/sentiment signals, robustness practices |
| Unique Alphas Framework | Hypothesis-first paradigm, creativity triggers, genetic diversity, regime mapping, statistical rigor (p-value, PBO/CSCV, parameter stability) |

New sources can be added by appending to `DISTILLED_SNIPPETS` and registering the source path in `SOURCE_PATHS`.

## Core concepts

- **Constraint injection** — Neutralization, truncation, delay, and pasteurization parameters are hard constraints passed to the LLM; the agent works within these boundaries
- **Reflective feedback** — Simulation metrics (Sharpe, turnover, IC, drawdown) are fed back as structured text; the LLM uses its "thinking room" to interpret results, not a separate reflection agent
- **Diversity via retrieval** — The snippet retrieval mechanism naturally diversifies guidance across research rounds; no explicit diversity manager
- **Configuration** — Provider, model, API key, and research parameters are set through the UI; config can be exported/imported as JSON

## Project structure

```
src/
├── app/          # Next.js UI (pages, components, layout)
├── lib/          # Core engine
│   ├── agent/    # Agent loop, simulation client, expression parser
│   ├── source-memory.ts  # Knowledge snippets + retrieval
│   ├── research/         # Research session logic, state management
│   └── constraints/      # Constraint injection, validation
public/           # Static assets
```

The data is the agent. The metrics are the reflection.
