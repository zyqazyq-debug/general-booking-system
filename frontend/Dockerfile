# Immutable H5 gateway image.  The build context must be the repository root.
ARG BOOKING_GIT_SHA
ARG BOOKING_RELEASE_ID
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
ARG BOOKING_GIT_SHA
ARG BOOKING_RELEASE_ID
WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend ./
ARG VITE_TELEGRAM_BOT_NAME
ARG VITE_TELEGRAM_BOT_DISPLAY_NAME
ENV VITE_TELEGRAM_BOT_NAME=${VITE_TELEGRAM_BOT_NAME}
ENV VITE_TELEGRAM_BOT_DISPLAY_NAME=${VITE_TELEGRAM_BOT_DISPLAY_NAME}
RUN node -e "const value=process.env.VITE_TELEGRAM_BOT_NAME||''; if(!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value)) throw new Error('valid VITE_TELEGRAM_BOT_NAME build argument is required'); if(!(process.env.VITE_TELEGRAM_BOT_DISPLAY_NAME||'').trim()) throw new Error('VITE_TELEGRAM_BOT_DISPLAY_NAME build argument is required');if(!/^[0-9a-f]{40}$/.test(process.env.BOOKING_GIT_SHA||''))throw new Error('BOOKING_GIT_SHA build arg required');if(!/^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/.test(process.env.BOOKING_RELEASE_ID||''))throw new Error('BOOKING_RELEASE_ID build arg required')"
# The repository build context excludes frontend/dist, so the compiler always
# starts from an empty output directory. The pinned compiler receives only
# trusted source and must not contact the network while producing H5 assets.
RUN test ! -d dist
ENV BOOKING_BUNDLE_AUDIT=true
RUN --network=none npm run build:h5 && npm run audit:h5-bundle && npm run strip:h5-source-maps
ENV BOOKING_BUNDLE_AUDIT=false
RUN test -s dist/build/h5/index.html

FROM nginxinc/nginx-unprivileged:1.27-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0
ARG BOOKING_GIT_SHA
ARG BOOKING_RELEASE_ID
LABEL org.opencontainers.image.revision=$BOOKING_GIT_SHA \
      uk.happybooking.release-id=$BOOKING_RELEASE_ID \
      uk.happybooking.component=gateway
COPY --from=build /workspace/frontend/dist/build/h5 /usr/share/nginx/html
COPY frontend/nginx.release.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
