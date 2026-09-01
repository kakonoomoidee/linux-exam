# Build context is the repo root (needs both server/ and public/).
FROM node:26-bookworm-slim
WORKDIR /app

COPY server/package.json server/package-lock.json ./
# npm install, not ci: the lockfile may lag the dependency swap (sqlite -> pg).
RUN npm install --omit=dev

COPY server/ ./
COPY public/ /public/

EXPOSE 3000
CMD ["node", "src/server.js"]
