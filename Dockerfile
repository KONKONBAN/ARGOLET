# syntax=docker/dockerfile:1
# ARGOLET server image: Fastify API + the web app on one port (default 8080).
#   docker build -t argolet .
#   docker run -p 8080:8080 -e PEPPER=$(openssl rand -hex 32) -v argolet-data:/data argolet

FROM node:26-bookworm-slim AS build
WORKDIR /src
RUN npm install -g pnpm@10.28.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/app/package.json packages/app/
COPY packages/client/package.json packages/client/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter "@argolet/api..." --filter "@argolet/web..."
COPY packages packages
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm --filter @argolet/web build && pnpm --filter @argolet/api build

FROM node:26-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_URL=pglite:/data/pglite \
    WEB_DIST=/app/web
WORKDIR /app
# Only the native/WASM packages the bundle keeps external are needed at runtime.
COPY --from=build /src/node_modules/@node-rs ./node_modules/@node-rs
COPY --from=build /src/node_modules/@electric-sql ./node_modules/@electric-sql
# OCR: Tesseract (worker + WASM core), its Vietnamese model and their runtime dependencies.
COPY --from=build /src/node_modules/tesseract.js ./node_modules/tesseract.js
COPY --from=build /src/node_modules/tesseract.js-core ./node_modules/tesseract.js-core
COPY --from=build /src/node_modules/@tesseract.js-data ./node_modules/@tesseract.js-data
COPY --from=build /src/node_modules/bmp-js ./node_modules/bmp-js
COPY --from=build /src/node_modules/idb-keyval ./node_modules/idb-keyval
COPY --from=build /src/node_modules/is-url ./node_modules/is-url
COPY --from=build /src/node_modules/node-fetch ./node_modules/node-fetch
COPY --from=build /src/node_modules/whatwg-url ./node_modules/whatwg-url
COPY --from=build /src/node_modules/tr46 ./node_modules/tr46
COPY --from=build /src/node_modules/webidl-conversions ./node_modules/webidl-conversions
COPY --from=build /src/node_modules/opencollective-postinstall ./node_modules/opencollective-postinstall
COPY --from=build /src/node_modules/regenerator-runtime ./node_modules/regenerator-runtime
COPY --from=build /src/node_modules/wasm-feature-detect ./node_modules/wasm-feature-detect
COPY --from=build /src/node_modules/zlibjs ./node_modules/zlibjs
COPY --from=build /src/apps/api/dist ./api
COPY --from=build /src/apps/web/dist ./web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "api/main.mjs"]
