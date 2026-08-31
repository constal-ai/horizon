ARG BASE_IMAGE=docker.io/library/node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
ARG BLAXEL_SANDBOX_API_IMAGE=ghcr.io/blaxel-ai/sandbox@sha256:7c05b166d7e3cc9c98f2ed7f156657f95be80e1a669efbc8e5b9aa5aa96cd967
FROM ${BLAXEL_SANDBOX_API_IMAGE} AS blaxel-sandbox-api
FROM ${BASE_IMAGE}

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git gzip ripgrep tar \
    && rm -rf /var/lib/apt/lists/*
COPY constal-workspace-runner.mjs /usr/local/bin/constal-workspace-runner
COPY --from=blaxel-sandbox-api /sandbox-api /usr/local/bin/sandbox-api
RUN chmod 0555 /usr/local/bin/constal-workspace-runner \
    /usr/local/bin/sandbox-api \
    && /usr/local/bin/constal-workspace-runner probe
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/sandbox-api"]
