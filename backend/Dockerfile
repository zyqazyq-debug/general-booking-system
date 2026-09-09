FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
ARG BOOKING_GIT_SHA
ARG BOOKING_RELEASE_ID
COPY . ./
RUN node -e "if(!/^[0-9a-f]{40}$/.test(process.env.BOOKING_GIT_SHA||''))throw new Error('BOOKING_GIT_SHA build arg required');if(!/^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/.test(process.env.BOOKING_RELEASE_ID||''))throw new Error('BOOKING_RELEASE_ID build arg required')"
RUN --network=none npm run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force
RUN node -e "for (const p of ['@nestjs/platform-express','multer']) require.resolve(p); for (const p of ['sqlite3','tar']) { try { console.error(p + ' unexpectedly installed at ' + require.resolve(p)); process.exitCode = 1 } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error } }"
ARG BOOKING_GIT_SHA
ARG BOOKING_RELEASE_ID
LABEL org.opencontainers.image.revision=$BOOKING_GIT_SHA \
      uk.happybooking.release-id=$BOOKING_RELEASE_ID \
      uk.happybooking.component=backend
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/migrations ./migration-source

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3001

# 暴露端口
EXPOSE 3001

# 启动命令
USER node
CMD ["node", "dist/src/main.js"]
