FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# 先装依赖，利用层缓存
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

USER node

CMD ["node", "server.js"]
