# Cloud Run image: API + WebSocket relay + story director (front end is on Firebase Hosting).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
ENV NODE_ENV=production STT_MODE=google
CMD ["node", "server/index.js"]
