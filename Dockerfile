FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
VOLUME /app/data
EXPOSE 3000
CMD ["node", "server.js"]
