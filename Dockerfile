FROM node:18.14-alpine as builder

WORKDIR /app
COPY . /app
RUN ls /app
RUN npm install --production
RUN npm run build

FROM node:18.14-alpine

WORKDIR /app
COPY --from=builder /app /app
RUN rm -rf /app/src /app/node_modules
RUN ls /app

CMD "/app/docker-entrypoint.sh"
