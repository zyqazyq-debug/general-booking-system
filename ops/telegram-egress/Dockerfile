# Cloudflare publishes this exact package and checksum in its Bookworm amd64
# Packages index.  Updating either is a reviewed release-input change.  A
# digest-preserving local mirror may be selected explicitly by the builder and
# is recorded in the immutable release manifest and OCI labels.
ARG TELEGRAM_EGRESS_BASE_IMAGE=debian:bookworm-20260824-slim@sha256:5ae3c39ebd15e229dcedd5cee596b2497182493d41ff162e824ba13fc1b2b867
FROM ${TELEGRAM_EGRESS_BASE_IMAGE}

ARG CLOUDFLARE_WARP_VERSION=2026.7.1377.0
ARG CLOUDFLARE_WARP_DEB_SHA256=95d33c2b4fc42f21c204981c51470a6a679d618fb0b78ee64bdd0db142230c55
ARG CLOUDFLARE_WARP_DEB_URL=https://pkg.cloudflareclient.com/pool/bookworm/main/c/cloudflare-warp/cloudflare-warp_2026.7.1377.0_amd64.deb
ARG BOOKING_GIT_SHA
ARG BOOKING_RELEASE_ID
ARG TELEGRAM_EGRESS_BASE_IMAGE

# Bootstrap the trust store only from the reviewed base image's official APT
# configuration.  Mirror arguments are deliberately declared after this layer,
# so they cannot influence the CA installation needed to authenticate HTTPS.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    rm -rf /var/lib/apt/lists/*

ARG TELEGRAM_EGRESS_DEBIAN_MIRROR=https://deb.debian.org/debian
ARG TELEGRAM_EGRESS_DEBIAN_SECURITY_MIRROR=https://deb.debian.org/debian-security

RUN set -eux; \
    case "$TELEGRAM_EGRESS_DEBIAN_MIRROR" in https://*) ;; *) exit 20 ;; esac; \
    case "$TELEGRAM_EGRESS_DEBIAN_SECURITY_MIRROR" in https://*) ;; *) exit 20 ;; esac; \
    case "$TELEGRAM_EGRESS_DEBIAN_MIRROR" in *[!A-Za-z0-9._~:/-]*|*/) exit 20 ;; esac; \
    case "$TELEGRAM_EGRESS_DEBIAN_SECURITY_MIRROR" in *[!A-Za-z0-9._~:/-]*|*/) exit 20 ;; esac; \
    printf 'Types: deb\nURIs: %s\nSuites: bookworm bookworm-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: %s\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' \
      "$TELEGRAM_EGRESS_DEBIAN_MIRROR" "$TELEGRAM_EGRESS_DEBIAN_SECURITY_MIRROR" > /etc/apt/sources.list.d/debian.sources; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl dbus socat; \
    rm -rf /var/lib/apt/lists/*; \
    curl --fail --location --proto '=https' --tlsv1.2 --output /tmp/cloudflare-warp.deb "$CLOUDFLARE_WARP_DEB_URL"; \
    echo "$CLOUDFLARE_WARP_DEB_SHA256  /tmp/cloudflare-warp.deb" | sha256sum -c -; \
    apt-get update; \
    apt-get install -y --no-install-recommends /tmp/cloudflare-warp.deb; \
    rm -f /tmp/cloudflare-warp.deb; \
    rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.vendor="Cloudflare package wrapped by HappyBooking" \
      org.opencontainers.image.title="booking-preprod Telegram egress" \
      org.opencontainers.image.revision="$BOOKING_GIT_SHA" \
      uk.happybooking.release-id="$BOOKING_RELEASE_ID" \
      uk.happybooking.component="telegram-egress" \
      uk.happybooking.base-image="$TELEGRAM_EGRESS_BASE_IMAGE" \
      uk.happybooking.apt.debian-mirror="$TELEGRAM_EGRESS_DEBIAN_MIRROR" \
      uk.happybooking.apt.security-mirror="$TELEGRAM_EGRESS_DEBIAN_SECURITY_MIRROR" \
      uk.happybooking.cloudflare-warp.version="$CLOUDFLARE_WARP_VERSION" \
      uk.happybooking.cloudflare-warp.deb-sha256="$CLOUDFLARE_WARP_DEB_SHA256"

COPY entrypoint.sh healthcheck.sh readback.sh /usr/local/bin/
RUN test -n "$BOOKING_GIT_SHA" && test -n "$BOOKING_RELEASE_ID" && test -n "$TELEGRAM_EGRESS_BASE_IMAGE" && \
    test -n "$TELEGRAM_EGRESS_DEBIAN_MIRROR" && test -n "$TELEGRAM_EGRESS_DEBIAN_SECURITY_MIRROR" && \
    chmod 0555 /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh /usr/local/bin/readback.sh && \
    mkdir -p /var/lib/cloudflare-warp /var/log/cloudflare-warp /run/dbus && \
    chmod 0700 /var/lib/cloudflare-warp

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
