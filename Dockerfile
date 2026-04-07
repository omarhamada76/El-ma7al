FROM node:20-alpine

WORKDIR /app

# better-sqlite3 builds native bindings; Alpine needs a toolchain for node-gyp
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

RUN npm prune --production

EXPOSE 3001

VOLUME ["/app/data"]

ENV NODE_ENV=production

CMD ["node", "server/index.js"]
