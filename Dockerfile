FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
COPY config ./config
COPY migrations ./migrations
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV LISTEN_HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY config ./config
COPY migrations ./migrations
EXPOSE 8080
CMD ["sh", "-c", "node dist/src/db/migrate.js && node dist/src/server.js"]
