ARG GIT_COMMIT
FROM node:18
RUN echo "Based on commit: $GIT_COMMIT"

WORKDIR /usr/src/app

COPY package.json yarn.lock ./

RUN yarn install

COPY . .

EXPOSE 3000

CMD ["yarn", "start"]