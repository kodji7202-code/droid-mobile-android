# Build context is this directory: docker build -t droidmobile/fcm-bridge server/fcm-bridge
FROM node:24.12.0-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24.12.0-alpine
ENV NODE_ENV=production \
    BRIDGE_HOST=0.0.0.0 \
    PORT=3102 \
    BRIDGE_DATA_DIR=/data
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3102
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
