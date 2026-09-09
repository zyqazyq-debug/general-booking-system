# Cloudflare publishes this exact package and checksum in its Bookworm amd64
# Packages index.  Updating either is a reviewed release-input change.
FROM debian:bookworm-20260824-slim@sha256:5ae3c39ebd15e229dcedd5cee596b2497182493d41ff162e824ba13fc1b2b867

ARG CLOUDFLARE_WARP_VERSION=2026.7.1377.0
ARG CLOUDFLARE_WARP_DEB_SHA256=95d33c2b4fc42f21c204981c51470a6a679d618fb0b78ee64bdd0db142230c55
ARG CLOUDFLARE_WARP_DEB_URL=https://pkg.cloudflareclient.com/pool/bookworm/main/c/cloudflare-warp/cloudflare-warp_2026.7.1377.0_amd64.deb

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl dbus socat; \
    rm -rf /var/lib/apt/lists/*; \
    curl --fail --location --proto '=https' --tlsv1.2 --output /tmp/cloudflare-warp.deb "$CLOUDFLARE_WARP_DEB_URL"; \
    echo "$CLOUDFLARE_WARP_DEB_SHA256  /tmp/cloudflare-warp.deb" | sha256sum -c -; \
    apt-get update; \
    apt-get install -y --no-install-recommends /tmp/cloudflare-warp.deb; \
    rm -f /tmp/cloudflare-warp.deb; \
    rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.vendor="Cloudflare package wrapped by HappyBooking" \
      org.opencontainers.image.title="booking-preprod Telegram egress" \
      uk.happybooking.component="telegram-egress" \
      uk.happybooking.cloudflare-warp.version="$CLOUDFLARE_WARP_VERSION" \
      uk.happybooking.cloudflare-warp.deb-sha256="$CLOUDFLARE_WARP_DEB_SHA256"

COPY entrypoint.sh healthcheck.sh /usr/local/bin/
RUN chmod 0555 /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh && \
    mkdir -p /var/lib/cloudflare-warp /var/log/cloudflare-warp /run/dbus && \
    chmod 0700 /var/lib/cloudflare-warp

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
