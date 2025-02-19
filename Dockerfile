FROM node:22

WORKDIR /app

COPY package*.json ./
COPY .env ./

RUN npm install

COPY . .

EXPOSE 3000

RUN npm run build

CMD [ "npm", "run", "start:dev" ]