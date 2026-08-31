# Horizon sandbox image

Build this image from an immutable base reference:

```sh
docker build --build-arg BASE_IMAGE=node:24-bookworm-slim@sha256:<digest> -t <registry>/constal-horizon-runner:<version> sandbox
```

The platform `sandbox-pool/constal-code` Resource pins the published image. The image contains only common toolchains and the non-authoritative workspace runner. Repository source, tenant Credentials, and Session state never belong in this base layer.

Horizon verifies the runner protocol and digest when preparing a Session. A runner bundled with a newer Horizon deployment may be injected into `/workspace/.constal/bin` during a rolling image upgrade; the prepared-image cache identity includes that exact runner digest.
