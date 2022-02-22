FROM node:14-alpine

WORKDIR /app

COPY package*.json ./
COPY index.js .
COPY util.js .
COPY .env .

RUN arch=$(arch | sed s/aarch64/arm64/ | sed s/x86_64/amd64/) && if [ "$arch" = "arm64" ]; then export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true; fi && npm install

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/npm", "start"]
