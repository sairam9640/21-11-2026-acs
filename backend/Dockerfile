FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Create runtime directories with node user ownership
RUN mkdir -p /app/uploads/firmware /app/data && chown -R node:node /app

USER node

EXPOSE 4000 7547
ENV NODE_ENV=production
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4000/health/live || exit 1

CMD ["node", "--dns-result-order=ipv4first", "dist/index.js"]
