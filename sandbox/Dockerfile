ARG BASE_IMAGE
FROM ${BASE_IMAGE}

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git gzip ripgrep tar \
    && rm -rf /var/lib/apt/lists/*
COPY constal-workspace-runner.mjs /usr/local/bin/constal-workspace-runner
RUN chmod 0555 /usr/local/bin/constal-workspace-runner \
    && /usr/local/bin/constal-workspace-runner probe
WORKDIR /workspace
CMD ["sleep", "infinity"]
