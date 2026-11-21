FROM node:20-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY package*.json ./
# NOTE: switch back to `npm ci --omit=dev` once package-lock.json has been regenerated
# with `npm install` (it must include @napi-rs/canvas).
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
