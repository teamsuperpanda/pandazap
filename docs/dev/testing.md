# Test Suite Implementation for PandaZap Obsidian Plugin

## Overview
This project includes a small, focused test suite for core extraction and type utilities using Vitest. Tests emphasize the extraction logic (which is framework-independent) and basic type/defaults validation.

## Test Files Created

### 1. `/tests/extraction.test.ts`
Unit tests for the `extractQACardsFromText` function cover common cases and edge cases:

- Basic functionality:
  - Single-line Q/A pairs
  - Multi-line answers
  - Bold/italic label handling

- Edge cases:
  - Empty or null input
  - Input with no Q&A pairs
  - Case-insensitive matching
  - Custom question/answer words
  - Mixed formatting

- **Advanced Scenarios**:
  - Whitespace preservation
  - Stopping at next questions
  - Processing Q and A on consecutive lines

### 2. `/tests/types.test.ts`
Unit tests validating default settings and the `CardAction` enum:

- DEFAULT_SETTINGS validation:
  - Correct default values
  - Required properties present

- **CardAction enum**:
  - Correct action values (add, update, delete)

### 3. `/tests/cardExtractor.test.ts`
Contains minimal unit tests; CardExtractor's DOM/Obsidian-dependent behavior is covered only by basic pattern checks here. Full integration tests would require an Obsidian test harness and are not included.

## Configuration Files

### `/vitest.config.ts`
- Vitest is configured for TypeScript and includes the test files under `/tests/**/*.test.ts`.

## Future

1. Integration tests: run against an Obsidian test harness to exercise `CardExtractor` and UI dialogs.
2. AnkiConnector tests: add a small mock AnkiConnect server to test request/response handling and retry logic.
3. UI tests: consider recording/automating modal flows if/when an Obsidian test runner is available.

The existing tests provide a reliable base for extraction logic and basic types; expanding coverage is recommended for sync and UI code.
