default: test

# Run all tests: frontend unit tests + integration tests (builds container via openhost harness).
test: test-frontend test-integration

# Frontend unit tests (vitest).
test-frontend:
    cd frontend && npm test

# Integration tests: builds container, deploys on real local OpenHost router.
# Requires podman (`podman machine start` on macOS).
test-integration *ARGS:
    uv run pytest tests/test_app.py tests/test_editor.py -x -v {{ARGS}}
