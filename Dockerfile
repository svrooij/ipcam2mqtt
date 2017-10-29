FROM node:boron-alpine

ENV IPCAM2MQTT_PORT=8021

WORKDIR /usr/ipcam2mqtt

COPY package.json package-lock.json ./

RUN npm install --production

COPY . .

EXPOSE 8021

CMD ["node","index.js"]