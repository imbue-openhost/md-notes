default: test

# Run all tests: frontend unit tests + full e2e suite (builds container).
test: test-frontend test-e2e

# Frontend unit tests (vitest).
test-frontend:
    cd frontend && npm test

# Full e2e: builds container, runs server + mock router, runs playwright.
test-e2e:
    uv run python tests/run_e2e.py
