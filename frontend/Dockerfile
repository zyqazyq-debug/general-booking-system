# Immutable H5 gateway image.  The build context must be the repository root.
FROM node:20-alpine AS build
WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build:h5

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /workspace/frontend/dist/build/h5 /usr/share/nginx/html
COPY frontend/nginx.release.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
