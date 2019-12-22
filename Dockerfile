FROM node:current-alpine
ENV IPCAM2MQTT_PORT=8021
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 8021
CMD ["node", "./index.js"]