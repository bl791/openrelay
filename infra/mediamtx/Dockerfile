# MediaMTX ships as a distroless image with no shell or HTTP client, so its
# `runOnReady` / `runOnNotReady` hook commands cannot run. We layer a static
# BusyBox in to provide `sh` + `wget`, which the hooks use to POST readiness to
# the engine. (BusyBox is ~1MB and statically linked, so nothing else is needed.)
FROM busybox:1.37.0-musl AS busybox

FROM bluenviron/mediamtx:1.11.3
# Static binaries — safe to drop into the distroless base.
COPY --from=busybox /bin/busybox /bin/busybox
COPY --from=busybox /bin/sh /bin/sh
COPY --from=busybox /bin/wget /bin/wget
