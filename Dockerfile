FROM node:22

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

RUN npm install -g @nestjs/cli

CMD [ "npm", "run", "start:dev" ]
