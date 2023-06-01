FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
COPY index.js .
COPY logger.js .
COPY util.js .
COPY .env .

RUN npm install

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/npm", "start"]
